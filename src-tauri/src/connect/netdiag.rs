//! What the network allows, in words. Campus networks (IONIS included) often isolate devices
//! from one another (client isolation on Wi-Fi, VLANs) and drop multicast: TekBoard then
//! cannot see or reach other computers. It says so plainly and never tries to get around it
//! (no port scan, no relay, no firewall change, no UPnP).

use serde::Serialize;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream, UdpSocket};
use std::time::Duration;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Iface {
    pub name: String,
    pub ip: String,
    /// `wifi`, `ethernet`, `virtual` (Docker, VPN, bridges) or `other`.
    pub kind: String,
    /// The interface used to reach the rest of the network.
    pub default: bool,
}

fn kind_of(name: &str) -> &'static str {
    if name.starts_with("wl") {
        "wifi"
    } else if name.starts_with("en") || name.starts_with("eth") {
        "ethernet"
    } else if ["docker", "br-", "veth", "virbr", "tun", "tap", "tailscale", "wg", "zt", "lxc", "vmnet", "vboxnet"].iter().any(|p| name.starts_with(p)) {
        "virtual"
    } else {
        "other"
    }
}

/// The local address the system would use to reach the network (no packet is sent).
pub fn default_ip() -> Option<Ipv4Addr> {
    let s = UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("192.0.2.1:9").ok()?;
    match s.local_addr().ok()?.ip() {
        IpAddr::V4(v4) if !v4.is_loopback() && !v4.is_unspecified() => Some(v4),
        _ => None,
    }
}

pub fn interfaces() -> Vec<Iface> {
    let def = default_ip();
    let mut out: Vec<Iface> = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|i| match i.ip() {
            IpAddr::V4(v4) if !v4.is_loopback() && !v4.is_link_local() => Some(Iface { kind: kind_of(&i.name).into(), default: Some(v4) == def, ip: v4.to_string(), name: i.name }),
            _ => None,
        })
        .collect();
    out.sort_by_key(|i| (!i.default, i.kind == "virtual", i.name.clone()));
    out
}

/// The address to listen on: the chosen interface, else the default one.
pub fn pick(interface: &str) -> Option<Ipv4Addr> {
    let all = interfaces();
    if !interface.is_empty() {
        if let Some(i) = all.iter().find(|i| i.name == interface || i.ip == interface) {
            return i.ip.parse().ok();
        }
    }
    all.iter().find(|i| i.default).or_else(|| all.iter().find(|i| i.kind != "virtual")).and_then(|i| i.ip.parse().ok())
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", tag = "result")]
pub enum Reach {
    /// Something answered on that port.
    Open,
    /// The computer answered but nothing listens there (TekBoard closed, Connect off).
    Refused,
    /// No answer at all: the network drops traffic between devices, or the computer is off.
    Timeout,
    Unreachable { detail: String },
}

/// One TCP connection attempt to the address given by the user (never a range).
pub fn probe(addr: SocketAddr, timeout: Duration) -> Reach {
    match TcpStream::connect_timeout(&addr, timeout) {
        Ok(_) => Reach::Open,
        Err(e) if e.kind() == std::io::ErrorKind::ConnectionRefused => Reach::Refused,
        Err(e) if e.kind() == std::io::ErrorKind::TimedOut || e.kind() == std::io::ErrorKind::WouldBlock => Reach::Timeout,
        Err(e) => Reach::Unreachable { detail: e.to_string() },
    }
}

pub fn explain(r: &Reach) -> String {
    match r {
        Reach::Open => "L'ordinateur répond : la connexion directe fonctionne sur ce réseau.".into(),
        Reach::Refused => "L'ordinateur répond, mais TekBoard Connect n'y écoute pas (application fermée, Connect désactivé, ou autre port).".into(),
        Reach::Timeout => "Aucune réponse. Le réseau isole sans doute les appareils entre eux (isolation des clients en Wi-Fi, VLAN séparés) : c'est fréquent sur les réseaux d'école. TekBoard ne peut pas et ne cherchera pas à contourner cette règle ; un réseau partagé (partage de connexion, réseau domestique) permet de se connecter.".into(),
        Reach::Unreachable { detail } => format!("Adresse injoignable depuis cet ordinateur ({detail}) : vérifiez que vous êtes sur le même réseau."),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_and_probe() {
        assert_eq!(kind_of("wlp2s0"), "wifi");
        assert_eq!(kind_of("enp3s0"), "ethernet");
        assert_eq!(kind_of("docker0"), "virtual");
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        assert_eq!(probe(SocketAddr::from(([127, 0, 0, 1], port)), Duration::from_secs(1)), Reach::Open);
        drop(l);
        assert_eq!(probe(SocketAddr::from(([127, 0, 0, 1], port)), Duration::from_secs(1)), Reach::Refused);
        assert!(explain(&Reach::Timeout).contains("isole"));
    }
}
