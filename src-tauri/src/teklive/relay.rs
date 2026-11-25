//! A WebSocket relay compatible with P2P Live Share (kermanx.p2p-live-share 0.1.x), so that
//! TekBoard can host a session without Node.js or Bun and know what happens in it.
//!
//! Protocol (ported from the extension's `src/sync/ws/server.ts` and `protocol.ts`):
//! - a client connects to `ws://host:port/<roomId>/<peerId>` (ids match `[\w-]+`);
//! - uplink `{action, data, targetPeers?, metadata?}`, downlink `{action, data?, peerId, metadata?}`
//!   where `peerId` is the sender; text frames are JSON, binary frames are a u32 little-endian
//!   length, that many bytes of JSON (the message without `data`), then the raw `data`;
//! - a message goes to `targetPeers` (one id or a list) or to everyone else in the room;
//! - whenever someone joins or leaves, everyone gets `{action: "__update_peers__", data: [ids], peerId: "server"}`.
//!
//! TekBoard's additions: it listens on one LAN address only; the first room must be opened from
//! this computer (the host's VS Code) and is then the only room; optionally only the addresses
//! of TekBoard contacts may join. It stops with the session.

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, Mutex};
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::StatusCode;
use tokio_tungstenite::tungstenite::Message;

pub const UPDATE_PEERS: &str = "__update_peers__";
const MAX_MESSAGE: usize = 64 * 1024 * 1024;

#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayState {
    pub room: Option<String>,
    /// Peer ids in the room (the host's first).
    pub peers: Vec<String>,
    /// `(peer id, address)`.
    pub addresses: Vec<(String, String)>,
    pub refused: u32,
    pub bytes: u64,
}

struct Shared {
    state: RelayState,
    clients: HashMap<String, mpsc::UnboundedSender<Message>>,
    local: HashSet<IpAddr>,
    /// When set, only these addresses (and this computer) may join.
    allowed: Option<HashSet<IpAddr>>,
}

pub struct Relay {
    pub addr: SocketAddr,
    shared: Arc<Mutex<Shared>>,
    stop: watch::Sender<bool>,
    on_change: Arc<dyn Fn(&RelayState) + Send + Sync>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn valid_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 128 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// `/room/peer` → `(room, peer)`.
pub fn parse_path(path: &str) -> Option<(String, String)> {
    let p = path.split('?').next()?;
    let mut parts = p.strip_prefix('/')?.split('/');
    let (room, peer) = (parts.next()?, parts.next()?);
    (parts.next().is_none() && valid_id(room) && valid_id(peer)).then(|| (room.to_string(), peer.to_string()))
}

/// Turns an uplink frame from `sender` into the downlink frame and its targets.
pub fn downlink(msg: &Message, sender: &str) -> Option<(Message, Option<Vec<String>>)> {
    let targets_of = |v: &Value| -> Option<Vec<String>> {
        match &v["targetPeers"] {
            Value::String(s) => Some(vec![s.clone()]),
            Value::Array(a) => Some(a.iter().filter_map(|x| x.as_str().map(String::from)).collect()),
            _ => None,
        }
    };
    let rewrite = |v: &Value, with_data: bool| -> Value {
        let mut out = Map::new();
        out.insert("action".into(), v["action"].clone());
        if with_data && !v.get("data").is_none_or(Value::is_null) {
            out.insert("data".into(), v["data"].clone());
        }
        out.insert("peerId".into(), json!(sender));
        if let Some(m) = v.get("metadata").filter(|m| !m.is_null()) {
            out.insert("metadata".into(), m.clone());
        }
        Value::Object(out)
    };
    match msg {
        Message::Text(t) => {
            let v: Value = serde_json::from_str(t).ok()?;
            v.get("action")?.as_str()?;
            Some((Message::Text(rewrite(&v, true).to_string().into()), targets_of(&v)))
        }
        Message::Binary(b) => {
            if b.len() < 4 {
                return None;
            }
            let n = u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize;
            if 4 + n > b.len() {
                return None;
            }
            let v: Value = serde_json::from_slice(&b[4..4 + n]).ok()?;
            v.get("action")?.as_str()?;
            let meta = rewrite(&v, false).to_string();
            let mut out = Vec::with_capacity(4 + meta.len() + b.len() - 4 - n);
            out.extend_from_slice(&(meta.len() as u32).to_le_bytes());
            out.extend_from_slice(meta.as_bytes());
            out.extend_from_slice(&b[4 + n..]);
            Some((Message::Binary(out.into()), targets_of(&v)))
        }
        _ => None,
    }
}

fn local_ips() -> HashSet<IpAddr> {
    let mut s: HashSet<IpAddr> = if_addrs::get_if_addrs().unwrap_or_default().into_iter().map(|i| i.ip()).collect();
    s.insert("127.0.0.1".parse().unwrap());
    s.insert("::1".parse().unwrap());
    s
}

impl Relay {
    /// Listens on `ip` (port picked by the system).
    pub async fn start(ip: IpAddr, allowed: Option<HashSet<IpAddr>>, on_change: Arc<dyn Fn(&RelayState) + Send + Sync>) -> std::io::Result<Arc<Relay>> {
        let listener = tokio::net::TcpListener::bind(SocketAddr::new(ip, 0)).await?;
        let addr = listener.local_addr()?;
        let (stop, mut stopped) = watch::channel(false);
        let relay = Arc::new(Relay { addr, shared: Arc::new(Mutex::new(Shared { state: RelayState::default(), clients: HashMap::new(), local: local_ips(), allowed })), stop, on_change });
        let r = relay.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = stopped.changed() => break,
                    acc = listener.accept() => {
                        let Ok((sock, from)) = acc else { continue };
                        let r2 = r.clone();
                        tokio::spawn(async move { r2.serve(sock, from).await });
                    }
                }
            }
        });
        Ok(relay)
    }

    pub fn state(&self) -> RelayState {
        lock(&self.shared).state.clone()
    }

    pub fn set_allowed(&self, allowed: Option<HashSet<IpAddr>>) {
        lock(&self.shared).allowed = allowed;
    }

    pub fn stop(&self) {
        let _ = self.stop.send(true);
        for (_, tx) in lock(&self.shared).clients.drain() {
            let _ = tx.send(Message::Close(None));
        }
    }

    fn changed(&self) {
        let s = self.state();
        (self.on_change)(&s);
    }

    fn broadcast_peers(&self) {
        let sh = lock(&self.shared);
        let msg = Message::Text(json!({"action": UPDATE_PEERS, "data": sh.state.peers, "peerId": "server"}).to_string().into());
        for tx in sh.clients.values() {
            let _ = tx.send(msg.clone());
        }
    }

    async fn serve(self: Arc<Self>, sock: tokio::net::TcpStream, from: SocketAddr) {
        let mut ids: Option<(String, String)> = None;
        let shared = self.shared.clone();
        let check = |req: &Request, resp: Response| -> Result<Response, ErrorResponse> {
            let deny = |code: StatusCode| {
                let mut r = ErrorResponse::new(None);
                *r.status_mut() = code;
                r
            };
            let Some((room, peer)) = parse_path(req.uri().path()) else { return Err(deny(StatusCode::NOT_FOUND)) };
            let mut sh = lock(&shared);
            let is_local = sh.local.contains(&from.ip());
            match &sh.state.room {
                // The first room is opened by the host, from this computer.
                None if !is_local => return Err(deny(StatusCode::FORBIDDEN)),
                Some(r) if r != &room => return Err(deny(StatusCode::FORBIDDEN)),
                _ => {}
            }
            if !is_local && sh.allowed.as_ref().is_some_and(|a| !a.contains(&from.ip())) {
                sh.state.refused += 1;
                return Err(deny(StatusCode::FORBIDDEN));
            }
            if sh.clients.contains_key(&peer) {
                return Err(deny(StatusCode::CONFLICT));
            }
            ids = Some((room, peer));
            Ok(resp)
        };
        let mut cfg = tokio_tungstenite::tungstenite::protocol::WebSocketConfig::default();
        cfg.max_message_size = Some(MAX_MESSAGE);
        cfg.max_frame_size = Some(MAX_MESSAGE);
        let ws = match tokio_tungstenite::accept_hdr_async_with_config(sock, check, Some(cfg)).await {
            Ok(ws) => ws,
            Err(_) => {
                self.changed();
                return;
            }
        };
        let Some((room, peer)) = ids else { return };
        let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
        {
            let mut sh = lock(&self.shared);
            sh.state.room.get_or_insert(room);
            sh.state.peers.push(peer.clone());
            sh.state.addresses.push((peer.clone(), from.to_string()));
            sh.clients.insert(peer.clone(), tx);
        }
        self.broadcast_peers();
        self.changed();
        let (mut sink, mut stream) = ws.split();
        let writer = tokio::spawn(async move {
            while let Some(m) = rx.recv().await {
                let close = matches!(m, Message::Close(_));
                if sink.send(m).await.is_err() || close {
                    break;
                }
            }
            let _ = sink.close().await;
        });
        while let Some(Ok(msg)) = stream.next().await {
            if matches!(msg, Message::Close(_)) {
                break;
            }
            let Some((out, targets)) = downlink(&msg, &peer) else { continue };
            let mut sh = lock(&self.shared);
            sh.state.bytes += match &out {
                Message::Binary(b) => b.len() as u64,
                Message::Text(t) => t.len() as u64,
                _ => 0,
            };
            for (id, tx) in sh.clients.iter() {
                if id == &peer || targets.as_ref().is_some_and(|t| !t.contains(id)) {
                    continue;
                }
                let _ = tx.send(out.clone());
            }
        }
        {
            let mut sh = lock(&self.shared);
            sh.clients.remove(&peer);
            sh.state.peers.retain(|p| p != &peer);
            sh.state.addresses.retain(|(p, _)| p != &peer);
        }
        writer.abort();
        self.broadcast_peers();
        self.changed();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_and_frames_follow_the_extension() {
        assert_eq!(parse_path("/myproj-ab12cd/peer_1"), Some(("myproj-ab12cd".into(), "peer_1".into())));
        assert!(parse_path("/a/b/c").is_none());
        assert!(parse_path("/a").is_none());
        assert!(parse_path("/a.b/c").is_none());
        let (m, t) = downlink(&Message::Text(r#"{"action":"edit","data":{"x":1},"targetPeers":"p2","metadata":{"m":true}}"#.into()), "p1").unwrap();
        let v: Value = serde_json::from_str(m.to_text().unwrap()).unwrap();
        assert_eq!(v, json!({"action": "edit", "data": {"x": 1}, "peerId": "p1", "metadata": {"m": true}}));
        assert_eq!(t, Some(vec!["p2".to_string()]));
        // Binary: u32 LE length, metadata JSON, payload.
        let meta = br#"{"action":"blob","targetPeers":["a","b"]}"#;
        let mut frame = (meta.len() as u32).to_le_bytes().to_vec();
        frame.extend_from_slice(meta);
        frame.extend_from_slice(&[1, 2, 3]);
        let (m, t) = downlink(&Message::Binary(frame.into()), "host").unwrap();
        let Message::Binary(b) = m else { panic!() };
        let n = u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize;
        let v: Value = serde_json::from_slice(&b[4..4 + n]).unwrap();
        assert_eq!(v, json!({"action": "blob", "peerId": "host"}));
        assert_eq!(&b[4 + n..], &[1, 2, 3]);
        assert_eq!(t.unwrap().len(), 2);
        assert!(downlink(&Message::Text("not json".into()), "x").is_none());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_room_relays_between_peers_like_the_original_server() {
        use tokio_tungstenite::connect_async;
        let changes = Arc::new(Mutex::new(0u32));
        let c = changes.clone();
        let relay = Relay::start("127.0.0.1".parse().unwrap(), None, Arc::new(move |_| *lock(&c) += 1)).await.unwrap();
        let url = |room: &str, peer: &str| format!("ws://{}/{room}/{peer}", relay.addr);
        let (mut host, _) = connect_async(url("proj-abc123", "host")).await.unwrap();
        let first = host.next().await.unwrap().unwrap();
        assert!(first.to_text().unwrap().contains(UPDATE_PEERS));
        let (mut guest, _) = connect_async(url("proj-abc123", "guest")).await.unwrap();
        let peers: Value = serde_json::from_str(guest.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(peers["data"], json!(["host", "guest"]));
        let _ = host.next().await; // its own peer update
        assert!(connect_async(url("other-room", "x")).await.is_err(), "only the host's room");
        assert!(connect_async(url("proj-abc123", "guest")).await.is_err(), "ids are unique");
        guest.send(Message::Text(r#"{"action":"hello","data":"hi"}"#.into())).await.unwrap();
        let got: Value = serde_json::from_str(host.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(got, json!({"action": "hello", "data": "hi", "peerId": "guest"}));
        assert_eq!(relay.state().room.as_deref(), Some("proj-abc123"));
        assert_eq!(relay.state().peers.len(), 2);
        drop(guest);
        let left: Value = serde_json::from_str(host.next().await.unwrap().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(left["data"], json!(["host"]));
        relay.stop();
        assert!(*lock(&changes) >= 3);
    }
}
