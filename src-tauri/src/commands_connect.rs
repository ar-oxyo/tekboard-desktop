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
    // Checked here too: what others see must pass moderation, whatever the window allowed.
    if let Some(cat) = crate::moderation::refused(&config.profile.nick) {
        return Err(AppError::new("refused_text", format!("Ce pseudonyme est refusé ({cat}). Les gros mots ordinaires passent, les propos haineux non.")));
    }
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
pub async fn live_start(state: State<'_, AppState>, project: String, contacts_only: bool, show_project: bool, interface: Option<String>) -> Result<teklive::Session> {
    let dir = crate::commands::project_dir(&state, &project)?;
    let nick = connect::service().map(|s| s.config().profile.nick).unwrap_or_else(|| std::env::var("USER").unwrap_or_default());
    teklive::start(&dir, &nick, contacts_only, show_project, interface.as_deref()).await
}

/// Network interfaces others could reach this computer on (real ones first), to choose
/// where TekLive listens when there are several.
#[tauri::command(async)]
pub fn live_interfaces() -> Vec<netdiag::Iface> {
    netdiag::interfaces().into_iter().filter(|i| i.kind != "virtual").collect()
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

// ───────────────────────────── TekSpace / shared whiteboards ─────────────────────────────

/// Sends a TekSpace or whiteboard message to a paired, connected device.
#[tauri::command(async)]
pub fn session_send(fp: String, msg: serde_json::Value) -> Result<()> {
    let t = msg["t"].as_str().unwrap_or("");
    if !(t.starts_with("space.") || t.starts_with("board.") || t.starts_with("hub.")) {
        return Err(AppError::new("invalid", "Message de session invalide"));
    }
    svc()?.send(&fp, msg)
}

/// Same message to several devices (skips the ones that left).
#[tauri::command(async)]
pub fn session_broadcast(fps: Vec<String>, msg: serde_json::Value) -> Result<usize> {
    let t = msg["t"].as_str().unwrap_or("");
    if !(t.starts_with("space.") || t.starts_with("board.")) {
        return Err(AppError::new("invalid", "Message de session invalide"));
    }
    let s = svc()?;
    Ok(fps.iter().filter(|fp| s.send(fp, msg.clone()).is_ok()).count())
}

/// A Spotify Jam invitation link, and nothing else: https://open.spotify.com/socialsession/… or https://spotify.link/….
pub fn valid_jam(url: &str) -> bool {
    let id_ok = |id: &str| !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if url.len() > 300 || url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return false;
    }
    if let Some(rest) = url.strip_prefix("https://open.spotify.com/socialsession/") {
        // An optional `?si=…` tracking parameter is fine; the session id is what matters.
        let (id, query) = rest.split_once('?').unwrap_or((rest, ""));
        return id_ok(id) && query.chars().all(|c| c.is_ascii_alphanumeric() || "=&_-".contains(c));
    }
    url.strip_prefix("https://spotify.link/").is_some_and(id_ok)
}

/// What is playing now, from the desktop player (`mpris`) or the Spotify account (`spotify`).
/// Read on request only (the table's share polls it while visible), never in the background.
#[tauri::command(async)]
pub fn music_now(source: String) -> Result<Option<crate::music::NowPlaying>> {
    match source.as_str() {
        "mpris" => crate::music::mpris_now(),
        "spotify" => crate::music::spotify_now(),
        _ => Err(AppError::new("invalid_source", "Source inconnue")),
    }
}

#[tauri::command(async)]
pub fn spotify_status() -> crate::music::SpotifyStatus {
    crate::music::status()
}

/// Opens Spotify's consent page in the browser and waits (3 min at most) for its answer on
/// the local redirect address; `spotify-linked` tells the window how it ended.
#[tauri::command(async)]
pub fn spotify_login(client_id: String) -> Result<String> {
    let (url, wait) = crate::music::login(client_id.trim())?;
    crate::workspace::spawn_detached(&["xdg-open".to_string(), url.clone()], &std::env::temp_dir()).map_err(|e| AppError::new("no_browser", format!("Le navigateur n'a pas pu démarrer : {e}")))?;
    std::thread::spawn(move || {
        let outcome = wait.join().unwrap_or_else(|_| Err(AppError::new("failed", "Connexion interrompue")));
        crate::notify::emit("spotify-linked", serde_json::json!({ "ok": outcome.is_ok(), "error": outcome.err().map(|e| e.to_string()) }));
    });
    Ok(url)
}

#[tauri::command(async)]
pub fn spotify_logout() -> Result<()> {
    crate::music::logout()
}

/// Opens a table's Spotify Jam in the browser (TekBoard never plays or relays any audio from it).
#[tauri::command(async)]
pub fn space_open_jam(url: String) -> Result<()> {
    if !valid_jam(&url) {
        return Err(AppError::new("url_refused", "Seuls les liens d'invitation Spotify Jam s'ouvrent ici."));
    }
    crate::workspace::spawn_detached(&["xdg-open".to_string(), url], &std::env::temp_dir()).map_err(|e| AppError::new("no_browser", format!("Le navigateur n'a pas pu démarrer : {e}")))
}

#[cfg(test)]
mod tests {
    use super::valid_jam;

    #[test]
    fn only_spotify_jam_links_open() {
        assert!(valid_jam("https://open.spotify.com/socialsession/AbC123"));
        assert!(valid_jam("https://open.spotify.com/socialsession/AbC123?si=xyz"));
        assert!(valid_jam("https://spotify.link/aBcD12"));
        for bad in ["http://open.spotify.com/socialsession/a", "https://open.spotify.com/track/a", "https://spotify.link/a b", "https://evil.com/https://spotify.link/a", "https://spotify.link/a?x=1", "https://open.spotify.com/socialsession/", "file:///etc/passwd"] {
            assert!(!valid_jam(bad), "{bad}");
        }
    }
}
