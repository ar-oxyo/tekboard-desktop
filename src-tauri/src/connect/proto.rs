//! What two TekBoards say to each other. Text frames carry one JSON message
//! (`{"t": "...", ...}`); binary frames carry a JSON header and raw bytes (file chunks):
//! `[u32 big-endian header length][header JSON][payload]`. Limits are checked on receipt.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Bumped when two versions can no longer understand each other.
pub const VERSION: u32 = 1;
pub const MAX_TEXT: usize = 256 * 1024;
pub const MAX_BINARY: usize = 1024 * 1024 + 64 * 1024;
pub const SERVICE_TYPE: &str = "_tekboard._tcp.local.";

pub const STATUSES: &[&str] = &["available", "coding", "session", "dnd", "invisible", "helping"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub nick: String,
    /// Compact avatar description (see the TekSpace module), at most 48 characters.
    #[serde(default)]
    pub avatar: String,
    pub status: String,
}

/// A nickname as shown to others: no control characters, 24 characters at most, and never a
/// slur or a threat (`crate::moderation`): a refused one is shown as "Anonyme".
pub fn clean_nick(s: &str) -> String {
    let n: String = s.chars().filter(|c| !c.is_control()).collect::<String>().trim().chars().take(24).collect();
    if n.is_empty() || crate::moderation::refused(&n).is_some() { "Anonyme".into() } else { n }
}

pub fn clean_status(s: &str) -> String {
    if STATUSES.contains(&s) { s.into() } else { "available".into() }
}

pub fn clean_avatar(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '.').take(48).collect()
}

impl Profile {
    pub fn cleaned(&self) -> Profile {
        Profile { nick: clean_nick(&self.nick), avatar: clean_avatar(&self.avatar), status: clean_status(&self.status) }
    }
}

/// First message on every connection, in both directions.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hello {
    pub v: u32,
    pub app: String,
    pub profile: Profile,
}

pub fn encode_binary(header: &Value, payload: &[u8]) -> Vec<u8> {
    let h = header.to_string();
    let mut out = Vec::with_capacity(4 + h.len() + payload.len());
    out.extend_from_slice(&(h.len() as u32).to_be_bytes());
    out.extend_from_slice(h.as_bytes());
    out.extend_from_slice(payload);
    out
}

pub fn decode_binary(frame: &[u8]) -> Option<(Value, &[u8])> {
    if frame.len() < 4 || frame.len() > MAX_BINARY {
        return None;
    }
    let n = u32::from_be_bytes([frame[0], frame[1], frame[2], frame[3]]) as usize;
    if n > 16 * 1024 || 4 + n > frame.len() {
        return None;
    }
    let header: Value = serde_json::from_slice(&frame[4..4 + n]).ok()?;
    header.is_object().then_some((header, &frame[4 + n..]))
}

/// Invitation to connect by hand when discovery does not work: `tb1:IP:PORT:FINGERPRINT`.
pub fn invite_code(ip: &str, port: u16, fp: &str) -> String {
    format!("tb1:{ip}:{port}:{fp}")
}

#[derive(Debug, Clone, PartialEq)]
pub struct Target {
    pub host: std::net::IpAddr,
    pub port: u16,
    /// Expected fingerprint (from an invitation), checked after the handshake.
    pub fp: Option<String>,
}

/// Reads an invitation code, or a plain `IP:PORT`.
pub fn parse_target(text: &str) -> Option<Target> {
    let t = text.trim();
    if let Some(rest) = t.strip_prefix("tb1:") {
        let mut parts = rest.rsplitn(3, ':');
        let fp = parts.next()?.to_string();
        let port = parts.next()?.parse().ok()?;
        let host = parts.next()?.trim_matches(['[', ']']).parse().ok()?;
        return super::identity::is_fingerprint(&fp).then_some(Target { host, port, fp: Some(fp) });
    }
    let addr: std::net::SocketAddr = t.parse().ok()?;
    Some(Target { host: addr.ip(), port: addr.port(), fp: None })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binary_frames_round_trip_and_bad_ones_are_refused() {
        let f = encode_binary(&serde_json::json!({"t": "chunk", "i": 3}), b"abc");
        let (h, p) = decode_binary(&f).unwrap();
        assert_eq!(h["i"], 3);
        assert_eq!(p, b"abc");
        assert!(decode_binary(&[0, 0, 0, 200, 1]).is_none());
        assert!(decode_binary(&encode_binary(&serde_json::json!([1]), b"")).is_none());
        assert!(decode_binary(&vec![0u8; MAX_BINARY + 1]).is_none());
    }

    #[test]
    fn invitations_and_addresses() {
        let fp = "ab".repeat(32);
        let code = invite_code("10.0.0.5", 41234, &fp);
        let t = parse_target(&code).unwrap();
        assert_eq!((t.host.to_string(), t.port, t.fp.as_deref()), ("10.0.0.5".into(), 41234, Some(fp.as_str())));
        assert_eq!(parse_target("192.168.1.2:5000").unwrap().fp, None);
        assert!(parse_target("tb1:10.0.0.5:1:nothex").is_none());
        assert!(parse_target("hello").is_none());
    }

    #[test]
    fn profiles_are_cleaned() {
        let p = Profile { nick: "  \u{7}Thibault le très long pseudonyme  ".into(), avatar: "b1<script>".into(), status: "root".into() }.cleaned();
        assert_eq!(p.nick.chars().count(), 24);
        assert_eq!(p.avatar, "b1script");
        assert_eq!(p.status, "available");
        assert_eq!(clean_nick("   "), "Anonyme");
    }
}
