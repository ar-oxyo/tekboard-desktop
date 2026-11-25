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

// ───────────────────────────── TekShare ─────────────────────────────

use crate::commands::AppState;
use crate::connect::{inbox, share};
use tauri::{Manager, State};

/// What would be sent (files, size, preview) and what blocks it (secrets…), before sending.
#[tauri::command(async)]
pub fn share_check(state: State<'_, AppState>, resource: share::Resource) -> Result<share::Check> {
    share::check(&state, &resource)
}

#[tauri::command(async)]
pub fn share_offer(state: State<'_, AppState>, fp: String, resource: share::Resource, confirmed_school: bool) -> Result<share::Transfer> {
    let s = svc()?;
    share::offer(&state, &s, &fp, &resource, confirmed_school)
}

#[tauri::command(async)]
pub fn share_list(state: State<'_, AppState>) -> Result<Vec<share::Transfer>> {
    share::list(&state.conn())
}

#[tauri::command(async)]
pub fn share_answer(id: String, accept: bool) -> Result<()> {
    share::answer(&*svc()?, &id, accept)
}

#[tauri::command(async)]
pub fn share_cancel(id: String) -> Result<()> {
    share::cancel(&*svc()?, &id)
}

#[tauri::command(async)]
pub fn share_forget(id: String) -> Result<()> {
    share::forget(&*svc()?, &id)
}

#[tauri::command(async)]
pub fn share_open(id: String) -> Result<inbox::Opened> {
    inbox::open(&*svc()?, &id)
}

/// Puts a received resource where it belongs. Nothing is run.
#[tauri::command(async)]
pub fn share_import(app: tauri::AppHandle, state: State<'_, AppState>, id: String, target: inbox::Target) -> Result<inbox::Imported> {
    let downloads = app.path().download_dir().map_err(|_| AppError::new("no_downloads", "Le dossier Téléchargements est introuvable"))?;
    let r = inbox::import(&state, &*svc()?, &downloads, &id, &target)?;
    if let Some(dir) = r.open.get("reveal").and_then(|v| v.as_str()) {
        let _ = crate::workspace::reveal(std::path::Path::new(dir));
    }
    Ok(r)
}

// ───────────────────────────── TekLive ─────────────────────────────

use crate::teklive;

#[tauri::command(async)]
pub fn live_setup() -> teklive::Setup {
    teklive::setup()
}

/// Installs P2P Live Share (tested version) or the TekBoard Bridge into VS Code. The window
/// asks for confirmation before calling this.
#[tauri::command(async)]
pub fn live_install(state: State<'_, AppState>, what: String) -> Result<String> {
    teklive::install(&state.cache_dir.join("teklive"), &what)
}

#[tauri::command]
pub async fn live_start(state: State<'_, AppState>, project: String, contacts_only: bool, show_project: bool) -> Result<teklive::Session> {
    let dir = crate::commands::project_dir(&state, &project)?;
    let nick = connect::service().map(|s| s.config().profile.nick).unwrap_or_else(|| std::env::var("USER").unwrap_or_default());
    teklive::start(&dir, &nick, contacts_only, show_project).await
}

#[tauri::command(async)]
pub fn live_stop() -> Result<()> {
    teklive::stop()
}

#[tauri::command(async)]
pub fn live_state() -> Option<teklive::Session> {
    teklive::current()
}

#[tauri::command(async)]
pub fn live_invite(fp: String) -> Result<()> {
    teklive::invite(&fp)
}

#[tauri::command(async)]
pub fn live_invitations() -> Vec<teklive::Invitation> {
    teklive::invitations()
}

#[tauri::command(async)]
pub fn live_join(id: String) -> Result<()> {
    teklive::join(&id)
}

#[tauri::command(async)]
pub fn live_decline(id: String) {
    teklive::decline(&id)
}
