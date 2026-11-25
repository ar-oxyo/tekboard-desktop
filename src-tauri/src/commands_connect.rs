//! Commands of TekBoard Connect (presence, pairing, contacts, network diagnosis).

use crate::connect::{self, netdiag, proto, store::Config, StateView};
use crate::error::{AppError, Result};
use serde::Serialize;
use std::net::SocketAddr;
use std::time::Duration;

fn svc() -> Result<std::sync::Arc<connect::Service>> {
    connect::service().ok_or_else(|| AppError::new("connect_unavailable", "TekBoard Connect n'a pas pu démarrer (identité de l'appareil illisible)"))
}

#[tauri::command(async)]
pub fn connect_state() -> Result<StateView> {
    Ok(svc()?.view())
}

/// Turns Connect on or off, changes the profile (pseudonym, avatar, status) or the interface.
#[tauri::command]
pub async fn connect_configure(config: Config) -> Result<StateView> {
    let s = svc()?;
    s.set_config(config).await?;
    Ok(s.view())
}

/// Asks a device seen on the network to pair.
#[tauri::command(async)]
pub fn connect_pair(fp: String) -> Result<()> {
    let s = svc()?;
    if !s.is_running() {
        return Err(AppError::new("connect_off", "Active TekBoard Connect d'abord"));
    }
    s.pair_discovered(&fp)
}

/// Connects by invitation code (`tb1:…`) or `IP:PORT`, to pair.
#[tauri::command]
pub async fn connect_dial(target: String) -> Result<()> {
    let s = svc()?;
    let t = proto::parse_target(&target).ok_or_else(|| AppError::new("invalid_target", "Colle un code d'invitation TekBoard (tb1:…) ou une adresse IP:PORT"))?;
    s.dial(SocketAddr::new(t.host, t.port), t.fp, true).await
}

#[tauri::command(async)]
pub fn connect_answer(id: u64, accept: bool) -> Result<()> {
    svc()?.answer(id, accept)
}

#[tauri::command(async)]
pub fn connect_block(fp: String, blocked: bool) -> Result<()> {
    svc()?.block(&fp, blocked)
}

#[tauri::command(async)]
pub fn connect_forget(fp: String) -> Result<()> {
    svc()?.forget(&fp)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnosis {
    pub interfaces: Vec<netdiag::Iface>,
    pub listening: Option<String>,
    pub mdns: bool,
    pub seen: usize,
    pub probe: Option<netdiag::Reach>,
    pub probe_text: Option<String>,
    /// Plain advice, most important first.
    pub advice: Vec<String>,
}

/// What works on this network. With `target`, also tries one connection to that address.
#[tauri::command(async)]
pub fn connect_diagnose(target: Option<String>) -> Result<Diagnosis> {
    let s = svc()?;
    let v = s.view();
    let interfaces = netdiag::interfaces();
    let seen = v.peers.iter().filter(|p| p.discovered).count();
    let mut advice = Vec::new();
    if interfaces.iter().all(|i| i.kind == "virtual") {
        advice.push("Aucune interface réseau réelle : connecte-toi à un réseau Wi-Fi ou filaire.".to_string());
    }
    if !v.running {
        advice.push("Connect est désactivé : rien n'écoute et rien n'est annoncé.".into());
    } else if !v.mdns {
        advice.push("La découverte automatique ne fonctionne pas ici : utilise le code d'invitation.".into());
    } else if seen == 0 {
        advice.push("Aucun autre TekBoard vu pour l'instant. Si un ami a activé Connect sur le même réseau et que vous ne vous voyez pas, le réseau bloque sans doute la diffusion locale (mDNS) : essayez le code d'invitation.".into());
    }
    let (probe, probe_text) = match target.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
        Some(t) => {
            let parsed = proto::parse_target(t).ok_or_else(|| AppError::new("invalid_target", "Adresse attendue : tb1:… ou IP:PORT"))?;
            let r = netdiag::probe(SocketAddr::new(parsed.host, parsed.port), Duration::from_secs(3));
            let text = netdiag::explain(&r);
            if r == netdiag::Reach::Timeout {
                advice.insert(0, text.clone());
            }
            (Some(r), Some(text))
        }
        None => (None, None),
    };
    Ok(Diagnosis { interfaces, listening: v.ip.zip(v.port).map(|(ip, p)| format!("{ip}:{p}")), mdns: v.mdns, seen, probe, probe_text, advice })
}
