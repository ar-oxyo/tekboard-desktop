//! TekBoard Connect: a local, opt-in network layer between TekBoards on the same network.
//!
//! - Off by default. When on, it listens on one interface (the default one or the one
//!   chosen) and advertises itself with mDNS / DNS-SD (`_tekboard._tcp`) unless the status
//!   is "invisible". It never scans: other devices are found because they advertise.
//! - Every connection is mutual TLS 1.3 (see `tls`), then a WebSocket. A device is known by
//!   its certificate fingerprint. The first contact needs pairing: both people check the
//!   same six-digit code on their screens and accept. Afterwards the fingerprint is pinned.
//! - Until paired, a connection only carries pairing messages. Blocked devices are dropped
//!   right after the handshake. Message size and rate are limited per connection.
//! - Other modules (TekShare, TekLive, TekSpace, whiteboard) register a handler for their
//!   message prefix (`share.`, `space.`…) and send through `send` / `send_binary`.
//! - No server, no Internet, no firewall change: when the network isolates devices, the
//!   diagnosis says so and the manual invitation code is the fallback.

pub mod identity;
pub mod netdiag;
pub mod proto;
pub mod store;
pub mod tls;

use crate::error::{AppError, Result};
use futures_util::{SinkExt, StreamExt};
use identity::Identity;
use proto::{Hello, Profile};
use rusqlite::Connection;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::time::{Duration, Instant};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::protocol::{Message, WebSocketConfig};

const HANDSHAKE: Duration = Duration::from_secs(10);
const PAIR_TIMEOUT: Duration = Duration::from_secs(180);
const MAX_PEERS: usize = 64;
const MAX_FRAMES_PER_SEC: u32 = 400;

/// What a module receives.
pub enum Incoming {
    Text(Value),
    Binary(Value, Vec<u8>),
}

type Handler = Arc<dyn Fn(&Service, &str, Incoming) + Send + Sync>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerView {
    pub fp: String,
    pub short: String,
    pub profile: Profile,
    /// Connected right now over an authenticated channel.
    pub online: bool,
    /// Seen on the network by mDNS (not authenticated: name and status as announced).
    pub discovered: bool,
    pub trusted: bool,
    pub blocked: bool,
    pub addr: Option<String>,
    pub app: Option<String>,
    pub since: Option<i64>,
    pub last_seen: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestView {
    pub id: u64,
    pub fp: String,
    pub short: String,
    pub profile: Profile,
    pub addr: String,
    /// The code both people compare.
    pub code: String,
    /// `incoming` (they asked), `waiting` (we asked, they have not answered), `confirm`
    /// (they accepted: confirm the code on our side too).
    pub state: String,
    pub at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateView {
    pub enabled: bool,
    pub running: bool,
    pub fp: String,
    pub short: String,
    pub profile: Profile,
    pub ip: Option<String>,
    pub port: Option<u16>,
    pub interface: String,
    pub invite: Option<String>,
    pub mdns: bool,
    pub peers: Vec<PeerView>,
    pub requests: Vec<RequestView>,
    pub problems: Vec<String>,
    pub space: bool,
}

struct Peer {
    profile: Profile,
    addr: SocketAddr,
    tx: mpsc::UnboundedSender<Message>,
    since: i64,
    app: String,
    /// Fingerprint of the side that dialed (tie-break when both dial at once).
    dialer: String,
    conn_id: u64,
    /// Frames handed to the writer and not yet written (back-pressure for transfers).
    queued: Arc<AtomicUsize>,
}

struct Pending {
    id: u64,
    fp: String,
    profile: Profile,
    addr: SocketAddr,
    state: &'static str,
    at: Instant,
    tx: mpsc::UnboundedSender<Message>,
    conn_id: u64,
    queued: Arc<AtomicUsize>,
}

#[derive(Clone)]
struct Discovered {
    profile: Profile,
    addrs: Vec<IpAddr>,
    port: u16,
    seen: Instant,
}

struct Running {
    ip: IpAddr,
    port: u16,
    stop: tokio::sync::watch::Sender<bool>,
    mdns: Option<mdns_sd::ServiceDaemon>,
    mdns_name: Option<String>,
}

pub struct Service {
    pub identity: Identity,
    db: Arc<Mutex<Connection>>,
    config: Mutex<store::Config>,
    peers: Mutex<HashMap<String, Peer>>,
    pending: Mutex<Vec<Pending>>,
    discovered: Mutex<HashMap<String, Discovered>>,
    running: Mutex<Option<Running>>,
    problems: Mutex<Vec<String>>,
    handlers: RwLock<Vec<(String, Handler)>>,
    dialing: Mutex<HashMap<String, Instant>>,
    seq: AtomicU64,
}

static SERVICE: OnceLock<Arc<Service>> = OnceLock::new();

/// The service, once `init` ran (at start).
pub fn service() -> Option<Arc<Service>> {
    SERVICE.get().cloned()
}

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Creates the service (identity loaded or made) and starts it when Connect is on.
pub fn init(data_dir: PathBuf, db: Arc<Mutex<Connection>>) -> Result<Arc<Service>> {
    if let Some(s) = SERVICE.get() {
        return Ok(s.clone());
    }
    let s = Arc::new(Service::new(&data_dir.join("connect"), db)?);
    let _ = SERVICE.set(s.clone());
    if lock(&s.config).enabled {
        let s2 = s.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = s2.start().await {
                s2.problem(format!("Connect n'a pas démarré : {e}"));
            }
        });
    }
    Ok(s)
}

impl Service {
    pub fn new(dir: &std::path::Path, db: Arc<Mutex<Connection>>) -> Result<Service> {
        let identity = identity::load_or_create(dir)?;
        let config = store::load(&lock(&db));
        Ok(Service { identity, db, config: Mutex::new(config), peers: Default::default(), pending: Default::default(), discovered: Default::default(), running: Default::default(), problems: Default::default(), handlers: Default::default(), dialing: Default::default(), seq: AtomicU64::new(1) })
    }

    pub fn config(&self) -> store::Config {
        lock(&self.config).clone()
    }

    fn problem(&self, p: String) {
        let mut v = lock(&self.problems);
        if !v.contains(&p) {
            v.push(p);
            if v.len() > 8 {
                v.remove(0);
            }
        }
        drop(v);
        self.changed();
    }

    /// Tells the window the state changed.
    pub fn changed(&self) {
        crate::notify::emit("connect-state", self.view());
    }

    /// Registers what to do with messages whose type starts with `prefix` (`share.`).
    pub fn on(&self, prefix: &str, f: impl Fn(&Service, &str, Incoming) + Send + Sync + 'static) {
        let mut h = self.handlers.write().unwrap_or_else(|e| e.into_inner());
        h.retain(|(p, _)| p != prefix);
        h.push((prefix.to_string(), Arc::new(f)));
    }

    pub fn is_running(&self) -> bool {
        lock(&self.running).is_some()
    }

    pub fn online(&self, fp: &str) -> bool {
        lock(&self.peers).contains_key(fp)
    }

    pub fn peer_profile(&self, fp: &str) -> Option<Profile> {
        lock(&self.peers).get(fp).map(|p| p.profile.clone())
    }

    /// Fingerprints of the paired devices connected right now.
    pub fn online_peers(&self) -> Vec<String> {
        lock(&self.peers).keys().cloned().collect()
    }

    /// Sends a message to a paired, connected device.
    pub fn send(&self, fp: &str, msg: Value) -> Result<()> {
        let text = msg.to_string();
        if text.len() > proto::MAX_TEXT {
            return Err(AppError::new("too_big", "Message trop gros"));
        }
        let peers = lock(&self.peers);
        let p = peers.get(fp).ok_or_else(|| AppError::new("offline", "Cette personne n'est pas connectée"))?;
        p.queued.fetch_add(1, Ordering::SeqCst);
        p.tx.send(Message::Text(text.into())).map_err(|_| AppError::new("offline", "Connexion fermée"))
    }

    pub fn send_binary(&self, fp: &str, header: &Value, payload: &[u8]) -> Result<()> {
        let frame = proto::encode_binary(header, payload);
        if frame.len() > proto::MAX_BINARY {
            return Err(AppError::new("too_big", "Morceau trop gros"));
        }
        let peers = lock(&self.peers);
        let p = peers.get(fp).ok_or_else(|| AppError::new("offline", "Cette personne n'est pas connectée"))?;
        p.queued.fetch_add(1, Ordering::SeqCst);
        p.tx.send(Message::Binary(frame.into())).map_err(|_| AppError::new("offline", "Connexion fermée"))
    }

    /// Number of frames waiting to be written to a peer (back-pressure for transfers).
    pub fn queued(&self, fp: &str) -> Option<usize> {
        lock(&self.peers).get(fp).map(|p| p.queued.load(Ordering::SeqCst))
    }

    pub fn view(&self) -> StateView {
        let config = self.config();
        let running = lock(&self.running);
        let (ip, port, mdns) = running.as_ref().map(|r| (Some(r.ip.to_string()), Some(r.port), r.mdns.is_some())).unwrap_or((None, None, false));
        drop(running);
        let contacts = store::contacts(&lock(&self.db)).unwrap_or_default();
        let peers = lock(&self.peers);
        let discovered = lock(&self.discovered);
        let mut out: Vec<PeerView> = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for c in &contacts {
            if !(c.trusted || c.blocked || peers.contains_key(&c.fp)) {
                continue;
            }
            seen.insert(c.fp.clone());
            let live = peers.get(&c.fp);
            let disc = discovered.get(&c.fp);
            let profile = live.map(|p| p.profile.clone()).or_else(|| disc.map(|d| d.profile.clone())).unwrap_or(Profile { nick: c.nick.clone(), avatar: c.avatar.clone(), status: "offline".into() });
            out.push(PeerView { fp: c.fp.clone(), short: identity::short(&c.fp), profile, online: live.is_some(), discovered: disc.is_some(), trusted: c.trusted, blocked: c.blocked, addr: live.map(|p| p.addr.to_string()).or(c.last_addr.clone()), app: live.map(|p| p.app.clone()), since: live.map(|p| p.since), last_seen: Some(c.last_seen) });
        }
        for (fp, d) in discovered.iter() {
            if seen.contains(fp) {
                continue;
            }
            out.push(PeerView { fp: fp.clone(), short: identity::short(fp), profile: d.profile.clone(), online: false, discovered: true, trusted: false, blocked: false, addr: d.addrs.first().map(|a| SocketAddr::new(*a, d.port).to_string()), app: None, since: None, last_seen: None });
        }
        drop(peers);
        drop(discovered);
        let requests = lock(&self.pending).iter().map(|p| RequestView { id: p.id, fp: p.fp.clone(), short: identity::short(&p.fp), profile: p.profile.clone(), addr: p.addr.to_string(), code: identity::pairing_code(&self.identity.fp, &p.fp), state: p.state.into(), at: now() - p.at.elapsed().as_secs() as i64 }).collect();
        StateView {
            enabled: config.enabled,
            running: ip.is_some(),
            fp: self.identity.fp.clone(),
            short: identity::short(&self.identity.fp),
            profile: config.profile.clone(),
            invite: ip.as_ref().zip(port).map(|(ip, port)| proto::invite_code(ip, port, &self.identity.fp)),
            ip,
            port,
            interface: config.interface.clone(),
            mdns,
            peers: out,
            requests,
            problems: lock(&self.problems).clone(),
            space: config.space,
        }
    }

    // ───────────────────────────── settings ─────────────────────────────

    pub async fn set_config(self: &Arc<Self>, next: store::Config) -> Result<()> {
        let prev = self.config();
        let next = store::Config { profile: next.profile.cleaned(), ..next };
        store::save(&lock(&self.db), &next)?;
        *lock(&self.config) = next.clone();
        let restart = prev.enabled != next.enabled || prev.interface != next.interface || (prev.profile.status == "invisible") != (next.profile.status == "invisible");
        if restart || !next.enabled {
            self.stop().await;
            if next.enabled {
                self.start().await?;
            }
        } else if prev.profile != next.profile {
            self.advertise();
            let msg = json!({"t": "profile", "profile": next.profile});
            for fp in self.online_peers() {
                let _ = self.send(&fp, msg.clone());
            }
        }
        self.changed();
        Ok(())
    }

    // ───────────────────────────── lifecycle ─────────────────────────────

    /// Listens and advertises. `bind` overrides the interface (tests use 127.0.0.1).
    pub async fn start(self: &Arc<Self>) -> Result<()> {
        self.start_on(None).await
    }

    pub async fn start_on(self: &Arc<Self>, bind: Option<IpAddr>) -> Result<()> {
        if self.is_running() {
            return Ok(());
        }
        lock(&self.problems).clear();
        let config = self.config();
        let ip: IpAddr = match bind {
            Some(ip) => ip,
            None => IpAddr::V4(netdiag::pick(&config.interface).ok_or_else(|| AppError::new("no_network", "Aucune interface réseau utilisable : es-tu connecté à un réseau ?"))?),
        };
        let listener = match tokio::net::TcpListener::bind(SocketAddr::new(ip, config.port)).await {
            Ok(l) => l,
            Err(_) if config.port != 0 => tokio::net::TcpListener::bind(SocketAddr::new(ip, 0)).await?,
            Err(e) => return Err(e.into()),
        };
        let port = listener.local_addr()?.port();
        if port != config.port && bind.is_none() {
            let mut c = lock(&self.config);
            c.port = port;
            let _ = store::save(&lock(&self.db), &c);
        }
        let (stop_tx, stop_rx) = tokio::sync::watch::channel(false);
        *lock(&self.running) = Some(Running { ip, port, stop: stop_tx, mdns: None, mdns_name: None });
        let me = self.clone();
        let mut stop = stop_rx.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = stop.changed() => break,
                    acc = listener.accept() => {
                        let Ok((sock, addr)) = acc else { continue };
                        if lock(&me.peers).len() + lock(&me.pending).len() >= MAX_PEERS {
                            continue;
                        }
                        let me2 = me.clone();
                        tokio::spawn(async move { me2.accept(sock, addr).await; });
                    }
                }
            }
        });
        if bind.is_none() {
            self.start_mdns();
        }
        let me = self.clone();
        let mut stop = stop_rx;
        tokio::spawn(async move {
            // Reconnects to paired devices and expires pairing requests left unanswered.
            loop {
                tokio::select! {
                    _ = stop.changed() => break,
                    _ = tokio::time::sleep(Duration::from_secs(15)) => me.housekeeping(),
                }
            }
        });
        self.changed();
        Ok(())
    }

    pub async fn stop(&self) {
        let running = lock(&self.running).take();
        if let Some(r) = running {
            let _ = r.stop.send(true);
            if let (Some(d), Some(name)) = (&r.mdns, &r.mdns_name) {
                let _ = d.unregister(name);
            }
            if let Some(d) = r.mdns {
                let _ = d.shutdown();
            }
        }
        for (_, p) in lock(&self.peers).drain() {
            let _ = p.tx.send(Message::Close(None));
        }
        for p in lock(&self.pending).drain(..) {
            let _ = p.tx.send(Message::Close(None));
        }
        lock(&self.discovered).clear();
        self.changed();
    }

    fn housekeeping(self: &Arc<Self>) {
        lock(&self.pending).retain(|p| p.at.elapsed() < PAIR_TIMEOUT);
        lock(&self.discovered).retain(|_, d| d.seen.elapsed() < Duration::from_secs(600));
        if self.config().profile.status == "invisible" {
            return;
        }
        let contacts = store::contacts(&lock(&self.db)).unwrap_or_default();
        for c in contacts.into_iter().filter(|c| c.trusted && !c.blocked) {
            if self.online(&c.fp) {
                continue;
            }
            let addr = lock(&self.discovered).get(&c.fp).and_then(|d| d.addrs.first().map(|a| SocketAddr::new(*a, d.port))).or_else(|| c.last_addr.as_deref().and_then(|a| a.parse().ok()));
            if let Some(addr) = addr {
                self.dial_bg(addr, Some(c.fp.clone()), false);
            }
        }
    }

    // ───────────────────────────── mDNS ─────────────────────────────

    fn start_mdns(self: &Arc<Self>) {
        let daemon = match mdns_sd::ServiceDaemon::new() {
            Ok(d) => d,
            Err(e) => {
                self.problem(format!("Découverte automatique (mDNS) indisponible : {e}. La connexion par invitation reste possible."));
                return;
            }
        };
        let receiver = match daemon.browse(proto::SERVICE_TYPE) {
            Ok(r) => r,
            Err(e) => {
                self.problem(format!("Recherche mDNS impossible : {e}"));
                return;
            }
        };
        if let Some(r) = lock(&self.running).as_mut() {
            r.mdns = Some(daemon);
        }
        self.advertise();
        let me = self.clone();
        std::thread::spawn(move || {
            while let Ok(ev) = receiver.recv() {
                match ev {
                    mdns_sd::ServiceEvent::ServiceResolved(info) => me.on_resolved(&info),
                    mdns_sd::ServiceEvent::ServiceRemoved(_, fullname) => {
                        let fp = fullname.split('.').next().and_then(|n| n.rsplit('-').next()).unwrap_or("").to_string();
                        let mut d = lock(&me.discovered);
                        let removed = d.keys().find(|k| k.starts_with(&fp) && fp.len() >= 12).cloned();
                        if let Some(k) = removed {
                            d.remove(&k);
                            drop(d);
                            me.changed();
                        }
                    }
                    mdns_sd::ServiceEvent::SearchStopped(_) => break,
                    _ => {}
                }
            }
        });
    }

    /// (Re)publishes this device, unless invisible.
    fn advertise(&self) {
        let config = self.config();
        let mut running = lock(&self.running);
        let Some(r) = running.as_mut() else { return };
        let Some(d) = r.mdns.as_ref() else { return };
        if let Some(name) = r.mdns_name.take() {
            let _ = d.unregister(&name);
        }
        if config.profile.status == "invisible" {
            return;
        }
        let instance = format!("{}-{}", config.profile.nick.chars().filter(|c| c.is_ascii_alphanumeric()).take(16).collect::<String>(), &self.identity.fp[..16]);
        let host = format!("tekboard-{}.local.", &self.identity.fp[..12]);
        let props = [("v", proto::VERSION.to_string()), ("fp", self.identity.fp.clone()), ("nick", config.profile.nick.clone()), ("st", config.profile.status.clone()), ("av", config.profile.avatar.clone())];
        match mdns_sd::ServiceInfo::new(proto::SERVICE_TYPE, &instance, &host, r.ip, r.port, &props[..]) {
            Ok(info) => {
                let name = info.get_fullname().to_string();
                if d.register(info).is_ok() {
                    r.mdns_name = Some(name);
                }
            }
            Err(e) => {
                drop(running);
                self.problem(format!("Annonce mDNS impossible : {e}"));
            }
        }
    }

    fn on_resolved(self: &Arc<Self>, info: &mdns_sd::ResolvedService) {
        let props = &info.txt_properties;
        let fp = props.get_property_val_str("fp").unwrap_or("").to_string();
        if !identity::is_fingerprint(&fp) || fp == self.identity.fp {
            return;
        }
        let v: u32 = props.get_property_val_str("v").and_then(|v| v.parse().ok()).unwrap_or(0);
        let profile = Profile { nick: proto::clean_nick(props.get_property_val_str("nick").unwrap_or("")), avatar: proto::clean_avatar(props.get_property_val_str("av").unwrap_or("")), status: proto::clean_status(props.get_property_val_str("st").unwrap_or("")) };
        let addrs: Vec<IpAddr> = info.get_addresses_v4().into_iter().map(IpAddr::V4).collect();
        if addrs.is_empty() {
            return;
        }
        let port = info.get_port();
        lock(&self.discovered).insert(fp.clone(), Discovered { profile, addrs: addrs.clone(), port, seen: Instant::now() });
        if v != proto::VERSION {
            self.problem("Un TekBoard d'une autre version a été vu sur le réseau : mettez-vous à jour tous les deux pour vous connecter.".into());
        }
        let contact = store::get(&lock(&self.db), &fp).ok().flatten();
        if contact.as_ref().is_some_and(|c| c.trusted && !c.blocked) && !self.online(&fp) && self.config().profile.status != "invisible" {
            self.dial_bg(SocketAddr::new(addrs[0], port), Some(fp), false);
        }
        self.changed();
    }

    // ───────────────────────────── connections ─────────────────────────────

    /// Connects to a device (to pair when `pair`). Returns at once; progress shows in the state.
    pub fn dial_bg(self: &Arc<Self>, addr: SocketAddr, expect: Option<String>, pair: bool) {
        if let Some(fp) = &expect {
            let mut d = lock(&self.dialing);
            if d.get(fp).is_some_and(|t| t.elapsed() < Duration::from_secs(10)) {
                return;
            }
            d.insert(fp.clone(), Instant::now());
        }
        let me = self.clone();
        tokio_spawn(async move {
            if let Err(e) = me.dial(addr, expect, pair).await {
                if pair {
                    me.problem(format!("Connexion à {addr} impossible : {e}"));
                }
            }
        });
    }

    pub async fn dial(self: &Arc<Self>, addr: SocketAddr, expect: Option<String>, pair: bool) -> Result<()> {
        if !self.is_running() {
            return Err(AppError::new("connect_off", "TekBoard Connect est désactivé"));
        }
        let tcp = tokio::time::timeout(HANDSHAKE, tokio::net::TcpStream::connect(addr)).await.map_err(|_| AppError::new("timeout", netdiag::explain(&netdiag::Reach::Timeout)))??;
        let connector = tokio_rustls::TlsConnector::from(tls::client_config(&self.identity).map_err(|e| AppError::new("tls", e.to_string()))?);
        let name = rustls::pki_types::ServerName::try_from("tekboard.local").map_err(|e| AppError::new("tls", e.to_string()))?;
        let stream = tokio::time::timeout(HANDSHAKE, connector.connect(name, tcp)).await.map_err(|_| AppError::new("timeout", "Pas de réponse TLS"))??;
        let fp = tls::peer_fp(stream.get_ref().1.peer_certificates()).ok_or_else(|| AppError::new("tls", "Aucun certificat"))?;
        if let Some(e) = &expect {
            if e != &fp {
                return Err(AppError::new("fingerprint", "L'appareil qui répond n'est pas celui de l'invitation (empreinte différente) : connexion refusée."));
            }
        }
        let cfg = ws_config();
        let (ws, _) = tokio::time::timeout(HANDSHAKE, tokio_tungstenite::client_async_with_config("ws://tekboard.local/tekboard/1", stream, Some(cfg))).await.map_err(|_| AppError::new("timeout", "Pas de réponse WebSocket"))?.map_err(|e| AppError::new("ws", e.to_string()))?;
        // The connection lives on in the background; what happens next shows in the state.
        let me = self.clone();
        let dialer = self.identity.fp.clone();
        tokio_spawn(async move {
            if let Err(e) = me.clone().session(ws, fp, addr, dialer, pair).await {
                if pair && e.code() != "version" {
                    me.problem(format!("Connexion interrompue : {e}"));
                }
            }
        });
        Ok(())
    }

    async fn accept(self: Arc<Self>, sock: tokio::net::TcpStream, addr: SocketAddr) {
        let Ok(cfg) = tls::server_config(&self.identity) else { return };
        let acceptor = tokio_rustls::TlsAcceptor::from(cfg);
        let Ok(Ok(stream)) = tokio::time::timeout(HANDSHAKE, acceptor.accept(sock)).await else { return };
        let Some(fp) = tls::peer_fp(stream.get_ref().1.peer_certificates()) else { return };
        let Ok(Ok(ws)) = tokio::time::timeout(HANDSHAKE, tokio_tungstenite::accept_async_with_config(stream, Some(ws_config()))).await else { return };
        let _ = self.session(ws, fp.clone(), addr, fp, false).await;
    }

    /// One authenticated connection, from the hello to the close.
    async fn session<S>(self: Arc<Self>, ws: tokio_tungstenite::WebSocketStream<S>, fp: String, addr: SocketAddr, dialer: String, pair: bool) -> Result<()>
    where
        S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    {
        if fp == self.identity.fp {
            return Err(AppError::new("self", "C'est cet ordinateur"));
        }
        let contact = store::get(&lock(&self.db), &fp)?;
        if contact.as_ref().is_some_and(|c| c.blocked) {
            return Err(AppError::new("blocked", "Appareil bloqué"));
        }
        let (mut sink, mut stream) = ws.split();
        let hello = Hello { v: proto::VERSION, app: env!("CARGO_PKG_VERSION").into(), profile: self.config().profile };
        sink.send(Message::Text(json!({"t": "hello", "hello": hello}).to_string().into())).await.map_err(|e| AppError::new("ws", e.to_string()))?;
        let theirs: Hello = match tokio::time::timeout(HANDSHAKE, stream.next()).await {
            Ok(Some(Ok(Message::Text(t)))) => serde_json::from_str::<Value>(&t).ok().and_then(|v| serde_json::from_value(v["hello"].clone()).ok()).ok_or_else(|| AppError::new("proto", "Salutation illisible"))?,
            _ => return Err(AppError::new("proto", "Pas de salutation")),
        };
        if theirs.v != proto::VERSION {
            let _ = sink.send(Message::Text(json!({"t": "bye", "reason": "version", "v": proto::VERSION}).to_string().into())).await;
            self.problem(format!("{} utilise une autre version de TekBoard Connect ({} contre {}) : mettez-vous à jour.", proto::clean_nick(&theirs.profile.nick), theirs.app, env!("CARGO_PKG_VERSION")));
            return Err(AppError::new("version", "Versions incompatibles"));
        }
        let profile = theirs.profile.cleaned();
        store::seen(&lock(&self.db), &fp, &profile, &addr.to_string(), now())?;
        let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
        let conn_id = self.seq.fetch_add(1, Ordering::SeqCst);
        let queued = Arc::new(AtomicUsize::new(0));
        let q = queued.clone();
        // Writer: everything the rest of TekBoard sends to this device goes through here.
        let writer = tokio::spawn(async move {
            while let Some(m) = rx.recv().await {
                let close = matches!(m, Message::Close(_));
                let counted = matches!(m, Message::Text(_) | Message::Binary(_));
                let failed = sink.send(m).await.is_err();
                if counted {
                    let _ = q.try_update(Ordering::SeqCst, Ordering::SeqCst, |n| Some(n.saturating_sub(1)));
                }
                if failed || close {
                    break;
                }
            }
            let _ = sink.close().await;
        });
        let trusted = contact.as_ref().is_some_and(|c| c.trusted);
        if trusted {
            self.register(&fp, Peer { profile: profile.clone(), addr, tx: tx.clone(), since: now(), app: theirs.app.clone(), dialer: dialer.clone(), conn_id, queued: queued.clone() });
        } else if pair {
            let _ = tx.send(Message::Text(json!({"t": "pair"}).to_string().into()));
            self.add_pending(Pending { id: self.seq.fetch_add(1, Ordering::SeqCst), fp: fp.clone(), profile: profile.clone(), addr, state: "waiting", at: Instant::now(), tx: tx.clone(), conn_id, queued: queued.clone() });
        } else {
            // Not paired and not asked to pair: keep the line open a while for a pairing request.
            self.add_pending(Pending { id: self.seq.fetch_add(1, Ordering::SeqCst), fp: fp.clone(), profile: profile.clone(), addr, state: "silent", at: Instant::now(), tx: tx.clone(), conn_id, queued: queued.clone() });
        }
        let mut window = Instant::now();
        let mut frames = 0u32;
        let idle = Duration::from_secs(75);
        let mut ping = tokio::time::interval(Duration::from_secs(25));
        loop {
            let msg = tokio::select! {
                m = tokio::time::timeout(idle, stream.next()) => match m { Ok(Some(Ok(m))) => m, _ => break },
                _ = ping.tick() => { let _ = tx.send(Message::Ping(Vec::new().into())); continue; }
            };
            if window.elapsed() >= Duration::from_secs(1) {
                window = Instant::now();
                frames = 0;
            }
            frames += 1;
            if frames > MAX_FRAMES_PER_SEC {
                self.problem(format!("{} envoie trop de messages : connexion coupée.", profile.nick));
                break;
            }
            match msg {
                Message::Text(t) => {
                    if t.len() > proto::MAX_TEXT {
                        break;
                    }
                    let Ok(v) = serde_json::from_str::<Value>(&t) else { continue };
                    if !self.handle_text(&fp, conn_id, v) {
                        break;
                    }
                }
                Message::Binary(b) => {
                    if !self.online(&fp) {
                        continue;
                    }
                    if let Some((h, payload)) = proto::decode_binary(&b) {
                        self.dispatch(&fp, h.clone(), Some(payload.to_vec()));
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
        // Gone: forget the live connection (only if it is still this one).
        {
            let mut peers = lock(&self.peers);
            if peers.get(&fp).is_some_and(|p| p.conn_id == conn_id) {
                peers.remove(&fp);
            }
        }
        lock(&self.pending).retain(|p| p.conn_id != conn_id || p.state == "confirm");
        writer.abort();
        self.dispatch(&fp, json!({"t": "connect.gone"}), None);
        self.changed();
        Ok(())
    }

    fn register(&self, fp: &str, peer: Peer) {
        let mut peers = lock(&self.peers);
        if let Some(existing) = peers.get(fp) {
            // Both sides dialed at once: keep the connection opened by the lower fingerprint.
            if existing.dialer < peer.dialer {
                let _ = peer.tx.send(Message::Close(None));
                return;
            }
            let _ = existing.tx.send(Message::Close(None));
        }
        peers.insert(fp.to_string(), peer);
        drop(peers);
        lock(&self.pending).retain(|p| p.fp != fp);
        self.changed();
    }

    fn add_pending(&self, p: Pending) {
        let mut v = lock(&self.pending);
        v.retain(|x| !(x.fp == p.fp && x.state == p.state));
        v.push(p);
        drop(v);
        self.changed();
    }

    /// `false` closes the connection.
    fn handle_text(&self, fp: &str, conn_id: u64, v: Value) -> bool {
        let t = v["t"].as_str().unwrap_or("");
        match t {
            "pair" => {
                // They ask to pair: show it, with the code, until the user answers.
                let mut pend = lock(&self.pending);
                if let Some(p) = pend.iter_mut().find(|p| p.fp == fp && p.conn_id == conn_id) {
                    p.state = "incoming";
                    p.at = Instant::now();
                }
                drop(pend);
                self.changed();
                crate::notify::emit("connect-request", fp);
                true
            }
            "pair_ok" => {
                let mut pend = lock(&self.pending);
                if let Some(p) = pend.iter_mut().find(|p| p.fp == fp && p.conn_id == conn_id && p.state == "waiting") {
                    p.state = "confirm";
                }
                drop(pend);
                self.changed();
                true
            }
            "pair_no" => {
                lock(&self.pending).retain(|p| !(p.fp == fp && p.conn_id == conn_id));
                self.problem("La demande de connexion a été refusée.".into());
                false
            }
            "bye" => false,
            "profile" => {
                if let Ok(p) = serde_json::from_value::<Profile>(v["profile"].clone()) {
                    let p = p.cleaned();
                    if let Some(peer) = lock(&self.peers).get_mut(fp) {
                        peer.profile = p;
                    }
                    self.changed();
                }
                true
            }
            _ => {
                // Everything else is for the modules, and only between paired devices.
                if self.online(fp) {
                    self.dispatch(fp, v, None);
                }
                true
            }
        }
    }

    fn dispatch(&self, fp: &str, header: Value, payload: Option<Vec<u8>>) {
        let t = header["t"].as_str().unwrap_or("").to_string();
        let handlers: Vec<Handler> = self.handlers.read().unwrap_or_else(|e| e.into_inner()).iter().filter(|(p, _)| t.starts_with(p.as_str()) || t == "connect.gone").map(|(_, h)| h.clone()).collect();
        for h in handlers {
            let msg = match &payload {
                Some(b) => Incoming::Binary(header.clone(), b.clone()),
                None => Incoming::Text(header.clone()),
            };
            h(self, fp, msg);
        }
    }

    // ───────────────────────────── pairing, contacts ─────────────────────────────

    /// The user answers a request: `accept` pairs (pins the fingerprint), else refuses.
    pub fn answer(&self, id: u64, accept: bool) -> Result<()> {
        let mut pend = lock(&self.pending);
        let i = pend.iter().position(|p| p.id == id).ok_or_else(|| AppError::new("not_found", "Cette demande a expiré"))?;
        let p = pend.remove(i);
        drop(pend);
        if !accept {
            let _ = p.tx.send(Message::Text(json!({"t": "pair_no"}).to_string().into()));
            let _ = p.tx.send(Message::Close(None));
            self.changed();
            return Ok(());
        }
        store::set_trusted(&lock(&self.db), &p.fp, true)?;
        if p.state == "incoming" {
            let _ = p.tx.send(Message::Text(json!({"t": "pair_ok"}).to_string().into()));
        }
        // From now on the connection carries everything.
        self.register(&p.fp, Peer { profile: p.profile, addr: p.addr, tx: p.tx, since: now(), app: String::new(), dialer: self.identity.fp.clone(), conn_id: p.conn_id, queued: p.queued });
        self.changed();
        Ok(())
    }

    pub fn block(&self, fp: &str, blocked: bool) -> Result<()> {
        store::set_blocked(&lock(&self.db), fp, blocked, now())?;
        if blocked {
            if let Some(p) = lock(&self.peers).remove(fp) {
                let _ = p.tx.send(Message::Close(None));
            }
            lock(&self.pending).retain(|p| p.fp != fp);
        }
        self.changed();
        Ok(())
    }

    pub fn forget(&self, fp: &str) -> Result<()> {
        store::forget(&lock(&self.db), fp)?;
        if let Some(p) = lock(&self.peers).remove(fp) {
            let _ = p.tx.send(Message::Close(None));
        }
        self.changed();
        Ok(())
    }

    /// Pairs with a device seen by mDNS.
    pub fn pair_discovered(self: &Arc<Self>, fp: &str) -> Result<()> {
        let d = lock(&self.discovered).get(fp).cloned().ok_or_else(|| AppError::new("not_found", "Cet appareil n'est plus visible sur le réseau"))?;
        let addr = SocketAddr::new(*d.addrs.first().ok_or_else(|| AppError::new("not_found", "Adresse inconnue"))?, d.port);
        self.dial_bg(addr, Some(fp.to_string()), true);
        Ok(())
    }
}

fn ws_config() -> WebSocketConfig {
    let mut c = WebSocketConfig::default();
    c.max_message_size = Some(proto::MAX_BINARY);
    c.max_frame_size = Some(proto::MAX_BINARY);
    c
}

/// Spawns on the current runtime when there is one (tests), on Tauri's otherwise.
pub fn tokio_spawn<F>(f: F)
where
    F: std::future::Future<Output = ()> + Send + 'static,
{
    match tokio::runtime::Handle::try_current() {
        Ok(h) => {
            h.spawn(f);
        }
        Err(_) => {
            tauri::async_runtime::spawn(f);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(dir: &std::path::Path, nick: &str) -> Arc<Service> {
        let db = Arc::new(Mutex::new(crate::db::open_in_memory().unwrap()));
        let s = Arc::new(Service::new(dir, db).unwrap());
        lock(&s.config).profile.nick = nick.into();
        s
    }

    async fn until(what: &str, mut f: impl FnMut() -> bool) {
        for _ in 0..200 {
            if f() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        panic!("timed out waiting for {what}");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn two_devices_pair_with_the_same_code_then_talk() {
        let tmp = tempfile::tempdir().unwrap();
        let (a, b) = (node(&tmp.path().join("a"), "Alice"), node(&tmp.path().join("b"), "Bob"));
        let lo: IpAddr = "127.0.0.1".parse().unwrap();
        a.start_on(Some(lo)).await.unwrap();
        b.start_on(Some(lo)).await.unwrap();
        let b_addr = SocketAddr::new(lo, b.view().port.unwrap());

        // Wrong fingerprint in an invitation: refused before anything else.
        assert!(a.dial(b_addr, Some("0".repeat(64)), true).await.is_err());

        // Alice asks; Bob sees the request with the same code.
        a.dial_bg(b_addr, Some(b.identity.fp.clone()), true);
        until("Bob's request", || b.view().requests.iter().any(|r| r.state == "incoming")).await;
        let code_b = b.view().requests[0].code.clone();
        let code_a = a.view().requests.iter().find(|r| r.fp == b.identity.fp).unwrap().code.clone();
        assert_eq!(code_a, code_b);

        // Nothing but pairing passes before both accept.
        let got: Arc<Mutex<Vec<String>>> = Default::default();
        let g = got.clone();
        b.on("test.", move |_, fp, m| {
            if let Incoming::Text(v) = m {
                lock(&g).push(format!("{}:{}", &fp[..4], v["x"]));
            }
        });
        assert!(a.send(&b.identity.fp, json!({"t": "test.hi", "x": 0})).is_err(), "not paired yet");

        let id = b.view().requests[0].id;
        b.answer(id, true).unwrap();
        until("Alice's confirmation step", || a.view().requests.iter().any(|r| r.state == "confirm")).await;
        let id = a.view().requests.iter().find(|r| r.state == "confirm").unwrap().id;
        a.answer(id, true).unwrap();
        until("both online", || a.online(&b.identity.fp) && b.online(&a.identity.fp)).await;

        a.send(&b.identity.fp, json!({"t": "test.hi", "x": 42})).unwrap();
        let fp_a = a.identity.fp[..4].to_string();
        until("message", || lock(&got).contains(&format!("{fp_a}:42"))).await;

        // Binary frames reach the handler too.
        let bin: Arc<Mutex<usize>> = Default::default();
        let bb = bin.clone();
        b.on("bin.", move |_, _, m| {
            if let Incoming::Binary(_, p) = m {
                *lock(&bb) += p.len();
            }
        });
        a.send_binary(&b.identity.fp, &json!({"t": "bin.chunk"}), &vec![7u8; 100_000]).unwrap();
        until("binary", || *lock(&bin) == 100_000).await;

        // Profiles travel.
        let mut cfg = a.config();
        cfg.profile.status = "coding".into();
        *lock(&a.config) = cfg.clone();
        a.send(&b.identity.fp, json!({"t": "profile", "profile": cfg.profile})).unwrap();
        until("status", || b.peer_profile(&a.identity.fp).is_some_and(|p| p.status == "coding")).await;

        // Blocking cuts the line and refuses it next time.
        b.block(&a.identity.fp, true).unwrap();
        until("offline after block", || !a.online(&b.identity.fp)).await;
        let _ = a.dial(b_addr, Some(b.identity.fp.clone()), false).await;
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert!(!b.online(&a.identity.fp));
        a.stop().await;
        b.stop().await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_refusal_is_final_and_unpaired_devices_cannot_send() {
        let tmp = tempfile::tempdir().unwrap();
        let (a, b) = (node(&tmp.path().join("a"), "A"), node(&tmp.path().join("b"), "B"));
        let lo: IpAddr = "127.0.0.1".parse().unwrap();
        a.start_on(Some(lo)).await.unwrap();
        b.start_on(Some(lo)).await.unwrap();
        let b_addr = SocketAddr::new(lo, b.view().port.unwrap());
        a.dial_bg(b_addr, None, true);
        until("request", || b.view().requests.iter().any(|r| r.state == "incoming")).await;
        let id = b.view().requests[0].id;
        b.answer(id, false).unwrap();
        until("refused", || a.view().requests.is_empty()).await;
        assert!(!store::get(&lock(&a.db), &b.identity.fp).unwrap().unwrap().trusted);
        assert!(!b.online(&a.identity.fp));
        a.stop().await;
        b.stop().await;
    }
}
