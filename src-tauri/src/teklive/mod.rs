//! TekLive: P2P Live Share sessions started from TekBoard.
//!
//! What the extension (kermanx.p2p-live-share) offers, read in its source: commands without
//! arguments (`p2p-live-share.host`, `.join`, `.stop`…), the settings `p2p-live-share.servers`
//! and `p2p-live-share.userName`, no URI handler and no API for other extensions; a session
//! link looks like `p2p-live-share://ws.<room>.<host:port>/` and opening a folder with that
//! URI joins it. So TekBoard:
//! 1. runs a compatible WebSocket relay itself (no Node.js, no Bun), on the LAN address;
//! 2. opens the project in VS Code and asks its small "TekBoard Bridge" extension (generated
//!    here, installed after confirmation) to put that relay first in `p2p-live-share.servers`
//!    (official configuration API) and to run `p2p-live-share.host`: the host only confirms
//!    the server in the extension's own list;
//! 3. sees the room open on its relay, builds the real invitation link from it, shows who is
//!    connected, and sends the link to TekBoard contacts through Connect;
//! 4. a guest accepts and TekBoard opens `code --folder-uri <link>` (extension installed first,
//!    after confirmation, when missing).
//! Nothing is opened to the Internet, no firewall is changed; the relay stops with the session.

pub mod relay;

use crate::error::{AppError, Result};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::io::Write;
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub const EXTENSION: &str = "kermanx.p2p-live-share";
/// The version whose protocol the relay was ported from and tested against.
pub const TESTED_VERSION: &str = "0.1.4";
pub const BRIDGE: &str = "tekboard.tekboard-bridge";
pub const BRIDGE_VERSION: &str = "0.1.6";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Setup {
    pub code: Option<String>,
    pub code_version: Option<String>,
    pub extension: Option<String>,
    pub bridge: Option<String>,
    /// Problems in words, nothing when ready.
    pub missing: Vec<String>,
}

fn code_bin() -> Option<PathBuf> {
    crate::toolenv::which("code").or_else(|| crate::toolenv::which("codium"))
}

fn run_code(args: &[&str], timeout: Duration) -> Result<String> {
    let bin = code_bin().ok_or_else(|| AppError::new("no_vscode", "VS Code (commande `code`) est introuvable"))?;
    let r = crate::workspace::run_argv_captured(&std::iter::once(bin.to_string_lossy().into_owned()).chain(args.iter().map(|s| s.to_string())).collect::<Vec<_>>(), Path::new("/"), timeout, &[])?;
    Ok(r.output)
}

/// Installed versions of an extension list (`id@version` lines).
pub fn version_in(list: &str, id: &str) -> Option<String> {
    list.lines().find_map(|l| l.trim().strip_prefix(&format!("{id}@")).map(String::from))
}

pub fn setup() -> Setup {
    let code = code_bin().map(|p| p.to_string_lossy().into_owned());
    let mut missing = Vec::new();
    let (code_version, list) = if code.is_some() {
        (run_code(&["--version"], Duration::from_secs(20)).ok().and_then(|o| o.lines().next().map(String::from)), run_code(&["--list-extensions", "--show-versions"], Duration::from_secs(30)).unwrap_or_default())
    } else {
        missing.push("VS Code n'est pas installé (commande `code`).".to_string());
        (None, String::new())
    };
    let extension = version_in(&list, EXTENSION);
    let bridge = version_in(&list, BRIDGE);
    if code.is_some() && extension.is_none() {
        missing.push(format!("L'extension P2P Live Share ({EXTENSION}) n'est pas installée."));
    }
    if code.is_some() && bridge.as_deref() != Some(BRIDGE_VERSION) {
        missing.push("L'extension TekBoard Bridge n'est pas installée (elle prépare la session dans VS Code).".into());
    }
    Setup { code, code_version, extension, bridge, missing }
}

const BRIDGE_JS: &str = r#"// TekBoard Bridge: lets TekBoard start or stop a P2P Live Share session in this window.
// TekBoard writes a one-shot request in $XDG_RUNTIME_DIR/tekboard (a folder only you can open);
// the window whose folder matches takes it, sets the relay server and your name through the
// official configuration API, and runs the extension's own command. Nothing else.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');

function dir() { return path.join(process.env.XDG_RUNTIME_DIR || os.tmpdir(), 'tekboard'); }
let log = { info() {}, error() {} };
let state = null;

async function handle(file) {
  let req;
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || (st.mode & 0o077) !== 0 || st.uid !== process.getuid()) return;
    req = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return; }
  const folders = (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath);
  if (!req || !req.folder || !folders.includes(req.folder)) return;
  // Only one window acts on a request: the one that removes it.
  try { fs.unlinkSync(file); } catch { return; }
  log.info('request ' + req.action + ' for ' + req.folder);
  if (!req.expires || Date.now() > req.expires) return;
  const cfg = vscode.workspace.getConfiguration('p2p-live-share');
  if (typeof req.userName === 'string' && req.userName) await cfg.update('userName', req.userName, vscode.ConfigurationTarget.Global);
  if (req.action === 'host' && typeof req.server === 'string' && /^ws:\/\/[\w.:\[\]-]+$/.test(req.server)) {
    // Relays of earlier TekBoard sessions are gone: drop the ones this bridge added, keep the user's.
    const ours = (state && state.get('tekboard.servers', [])) || [];
    const servers = (cfg.get('servers') || []).filter((s) => s !== req.server && !ours.includes(s));
    await cfg.update('servers', [req.server, ...servers], vscode.ConfigurationTarget.Global);
    if (state) await state.update('tekboard.servers', [req.server]);
    vscode.window.setStatusBarMessage('TekBoard : choisis « ' + req.server + ' » (premier de la liste) pour lancer la session.', 20000);
    // P2P Live Share ignores "host" while its session service starts (it checks whether to
    // join a session), and its server list closes if its own panel takes the focus while
    // loading. A list that stays open keeps the command pending until the user picks: a call
    // that comes back at once was ignored, so try again a few times.
    const ext = vscode.extensions.getExtension('kermanx.p2p-live-share');
    if (ext && !ext.isActive) await ext.activate();
    for (let attempt = 1; attempt <= 6; attempt++) {
      await new Promise((r) => setTimeout(r, attempt === 1 ? 2500 : 2000));
      const t0 = Date.now();
      try {
        await vscode.commands.executeCommand('p2p-live-share.host');
      } catch (e) {
        log.error('host failed: ' + e);
        break;
      }
      const ms = Date.now() - t0;
      log.info('host attempt ' + attempt + ' came back after ' + ms + ' ms');
      if (ms > 1500) break;
    }
  } else if (req.action === 'stop') {
    try { await vscode.commands.executeCommand('p2p-live-share.stop'); } catch {}
  }
}

function scan() {
  let names = [];
  try { names = fs.readdirSync(dir()); } catch { return; }
  for (const n of names) if (/^live-[a-f0-9]{16,64}\.json$/.test(n)) handle(path.join(dir(), n));
}

function activate(context) {
  log = vscode.window.createOutputChannel('TekBoard Bridge', { log: true });
  state = context.globalState;
  context.subscriptions.push(log);
  scan();
  const t = setInterval(scan, 1500);
  context.subscriptions.push({ dispose: () => clearInterval(t) });
}

function deactivate() {}

module.exports = { activate, deactivate };
"#;

fn bridge_package() -> String {
    json!({
        "name": "tekboard-bridge",
        "displayName": "TekBoard Bridge",
        "description": "Lets TekBoard start P2P Live Share sessions (settings and the extension's own commands only).",
        "publisher": "tekboard",
        "version": BRIDGE_VERSION,
        "license": "GPL-3.0-only",
        "engines": {"vscode": "^1.90.0"},
        "main": "./extension.js",
        "activationEvents": ["onStartupFinished"],
        "extensionKind": ["workspace"],
        "contributes": {}
    })
    .to_string()
}

/// The bridge as a `.vsix` (a zip with a manifest), made here: no build tools needed.
pub fn bridge_vsix() -> Result<Vec<u8>> {
    let manifest = format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="tekboard-bridge" Version="{BRIDGE_VERSION}" Publisher="tekboard"/>
    <DisplayName>TekBoard Bridge</DisplayName>
    <Description xml:space="preserve">Lets TekBoard start P2P Live Share sessions.</Description>
    <Categories>Other</Categories>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.90.0"/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value=""/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value=""/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace"/>
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code"/>
  </Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
  </Assets>
</PackageManifest>
"#
    );
    let types = r#"<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension=".json" ContentType="application/json"/><Default Extension=".js" ContentType="application/javascript"/><Default Extension=".vsixmanifest" ContentType="text/xml"/></Types>
"#;
    let mut buf = std::io::Cursor::new(Vec::new());
    {
        let mut z = zip::ZipWriter::new(&mut buf);
        let o = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for (name, body) in [("[Content_Types].xml", types.to_string()), ("extension.vsixmanifest", manifest), ("extension/package.json", bridge_package()), ("extension/extension.js", BRIDGE_JS.to_string())] {
            z.start_file(name, o).map_err(|e| AppError::new("zip", e.to_string()))?;
            z.write_all(body.as_bytes())?;
        }
        z.finish().map_err(|e| AppError::new("zip", e.to_string()))?;
    }
    Ok(buf.into_inner())
}

/// Installs what is missing (P2P Live Share at the tested version, the bridge). The user
/// confirmed beforehand in the window.
pub fn install(cache: &Path, what: &str) -> Result<String> {
    match what {
        "extension" => {
            let out = run_code(&["--install-extension", &format!("{EXTENSION}@{TESTED_VERSION}")], Duration::from_secs(180))?;
            if version_in(&run_code(&["--list-extensions", "--show-versions"], Duration::from_secs(30))?, EXTENSION).is_none() {
                return Err(AppError::new("install_failed", format!("Installation de P2P Live Share impossible :\n{}", out.trim())));
            }
            Ok(format!("P2P Live Share {TESTED_VERSION} installée"))
        }
        "bridge" => {
            std::fs::create_dir_all(cache)?;
            let path = cache.join(format!("tekboard-bridge-{BRIDGE_VERSION}.vsix"));
            std::fs::write(&path, bridge_vsix()?)?;
            let out = run_code(&["--install-extension", &path.to_string_lossy(), "--force"], Duration::from_secs(120))?;
            if version_in(&run_code(&["--list-extensions", "--show-versions"], Duration::from_secs(30))?, BRIDGE).as_deref() != Some(BRIDGE_VERSION) {
                return Err(AppError::new("install_failed", format!("Installation de TekBoard Bridge impossible :\n{}", out.trim())));
            }
            Ok("TekBoard Bridge installée".into())
        }
        _ => Err(AppError::new("invalid", "Rien à installer de ce nom")),
    }
}

// ───────────────────────────── sessions ─────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub project: String,
    pub name: String,
    /// `waiting` (VS Code opened, the host has not picked the server yet), `live`, `stopped`.
    pub state: String,
    pub server: String,
    pub link: Option<String>,
    pub room: Option<String>,
    /// Peer ids connected (the host included), as the relay sees them.
    pub peers: Vec<String>,
    /// Addresses of the guests (not the host).
    pub guests: Vec<String>,
    pub refused: u32,
    pub started_at: i64,
    pub contacts_only: bool,
    pub show_project: bool,
    /// Fingerprints of the TekBoard contacts invited.
    pub invited: Vec<String>,
    /// Network interface the server listens on (`wlp2s0`).
    pub interface: String,
    /// Something to know about this session (the usual port was taken…).
    pub note: Option<String>,
}

struct Live {
    session: Session,
    relay: Arc<relay::Relay>,
}

static CURRENT: Mutex<Option<Live>> = Mutex::new(None);

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn emit() {
    crate::notify::emit("teklive-state", current());
}

pub fn current() -> Option<Session> {
    lock(&CURRENT).as_ref().map(|l| l.session.clone())
}

fn requests_dir() -> PathBuf {
    std::env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from).unwrap_or_else(std::env::temp_dir).join("tekboard")
}

/// A one-shot request for the bridge (0600, in the user's private runtime folder).
pub fn write_request(folder: &Path, body: Value) -> Result<PathBuf> {
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let dir = requests_dir();
    std::fs::create_dir_all(&dir)?;
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))?;
    let mut bytes = [0u8; 16];
    if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
        use std::io::Read;
        let _ = f.read_exact(&mut bytes);
    }
    let id: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    let path = dir.join(format!("live-{id}.json"));
    let mut body = body;
    body["folder"] = json!(folder.to_string_lossy());
    body["expires"] = json!(chrono::Utc::now().timestamp_millis() + 120_000);
    let mut f = std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(&path)?;
    f.write_all(body.to_string().as_bytes())?;
    Ok(path)
}

/// Invitation link of a room on this relay, as the extension writes it.
pub fn link_of(room: &str, addr: &std::net::SocketAddr) -> String {
    let host = match addr.ip() {
        IpAddr::V6(v6) => format!("[{v6}]:{}", addr.port()),
        IpAddr::V4(v4) => format!("{v4}:{}", addr.port()),
    };
    format!("p2p-live-share://ws.{room}.{host}/")
}

/// Is this a session link TekBoard can open (ws only: the relay of a TekBoard on the LAN)?
pub fn valid_link(link: &str) -> bool {
    let Some(rest) = link.strip_prefix("p2p-live-share://ws.") else { return false };
    let authority = rest.split('/').next().unwrap_or("");
    let Some((room, host)) = authority.split_once('.') else { return false };
    room.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') && !room.is_empty() && host.parse::<std::net::SocketAddr>().is_ok() && rest[authority.len()..].chars().all(|c| c == '/')
}

/// Addresses of the TekBoard contacts connected right now (who may join when `contacts_only`).
fn contact_addresses() -> HashSet<IpAddr> {
    crate::connect::service().map(|s| s.view().peers.into_iter().filter(|p| p.trusted && p.online).filter_map(|p| p.addr.and_then(|a| a.parse::<std::net::SocketAddr>().ok()).map(|a| a.ip())).collect()).unwrap_or_default()
}

/// Port tried first, so the address stays the same from one session to the next.
pub const PREFERRED_PORT: u16 = 8765;

/// The address others can reach: the interface chosen, else Connect's, else the default
/// route's, never a virtual interface (Docker, VPN) when a real one exists, never localhost.
fn pick_ip(interface: Option<&str>) -> Option<IpAddr> {
    if let Some(i) = interface.filter(|i| !i.trim().is_empty()) {
        return crate::connect::netdiag::pick(i).map(IpAddr::V4);
    }
    crate::connect::service().and_then(|c| c.view().ip).and_then(|ip| ip.parse::<IpAddr>().ok()).or_else(|| crate::connect::netdiag::pick("").map(IpAddr::V4))
}

/// Starts a session for `project`: relay, VS Code, bridge request.
pub async fn start(project: &Path, nick: &str, contacts_only: bool, show_project: bool, interface: Option<&str>) -> Result<Session> {
    if current().is_some_and(|s| s.state != "stopped") {
        return Err(AppError::new("busy", "Une session TekLive est déjà en cours : arrête-la d'abord."));
    }
    let s = setup();
    if let Some(m) = s.missing.first() {
        return Err(AppError::new("setup", m.clone()));
    }
    let ip = pick_ip(interface).ok_or_else(|| AppError::new("no_network", "Aucune adresse réseau : connecte-toi à un réseau Wi-Fi ou filaire."))?;
    let on_change: Arc<dyn Fn(&relay::RelayState) + Send + Sync> = Arc::new(|st: &relay::RelayState| {
        let mut cur = lock(&CURRENT);
        if let Some(l) = cur.as_mut() {
            l.session.room = st.room.clone();
            l.session.peers = st.peers.clone();
            l.session.refused = st.refused;
            let host_peer = st.peers.first().cloned();
            l.session.guests = st.addresses.iter().filter(|(p, _)| Some(p) != host_peer.as_ref()).map(|(_, a)| a.clone()).collect();
            if let Some(room) = &st.room {
                l.session.link = Some(link_of(room, &l.relay.addr));
                if l.session.state == "waiting" {
                    l.session.state = "live".into();
                }
            }
        }
        drop(cur);
        emit();
    });
    let allowed = contacts_only.then(contact_addresses);
    // The usual port when it is free; otherwise one the system picks, and the screen says so.
    let mut note = None;
    let relay = match relay::Relay::start(ip, PREFERRED_PORT, allowed.clone(), on_change.clone()).await {
        Ok(r) => r,
        Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
            let r = relay::Relay::start(ip, 0, allowed, on_change).await.map_err(|e| AppError::new("relay_failed", format!("Le serveur TekLive ne démarre pas sur {ip} : {e}")))?;
            note = Some(format!("Le port {PREFERRED_PORT} est déjà utilisé sur cette machine : TekLive écoute sur le port {}.", r.addr.port()));
            r
        }
        Err(e) if e.kind() == std::io::ErrorKind::AddrNotAvailable => return Err(AppError::new("relay_failed", format!("L'adresse {ip} n'est plus disponible : le réseau a changé, choisis une autre interface."))),
        Err(e) => return Err(AppError::new("relay_failed", format!("Le serveur TekLive ne démarre pas sur {ip} : {e}"))),
    };
    let server = server_url(&relay.addr);
    let name = project.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let iface = crate::connect::netdiag::interfaces().into_iter().find(|i| i.ip == ip.to_string()).map(|i| i.name).unwrap_or_default();
    let session = Session { project: project.to_string_lossy().into_owned(), name, state: "waiting".into(), server: server.clone(), link: None, room: None, peers: vec![], guests: vec![], refused: 0, started_at: chrono::Utc::now().timestamp(), contacts_only, show_project, invited: vec![], interface: iface, note };
    *lock(&CURRENT) = Some(Live { session: session.clone(), relay });
    // Anything failing from here closes the relay again: a half-started session used to stay
    // "busy" and refuse every new start until stopped by hand.
    let launched = (|| -> Result<()> {
        write_request(project, json!({"action": "host", "server": server, "userName": nick}))?;
        let bin = code_bin().ok_or_else(|| AppError::new("no_vscode", "VS Code est introuvable"))?;
        crate::workspace::spawn_detached(&[bin.to_string_lossy().into_owned(), project.to_string_lossy().into_owned()], project)?;
        Ok(())
    })();
    if let Err(e) = launched {
        if let Some(l) = lock(&CURRENT).take() {
            l.relay.stop();
        }
        emit();
        return Err(e);
    }
    emit();
    Ok(session)
}

/// `ws://192.168.1.42:8765` (IPv6 between brackets).
pub fn server_url(addr: &std::net::SocketAddr) -> String {
    format!("ws://{}", match addr.ip() {
        IpAddr::V6(v6) => format!("[{v6}]:{}", addr.port()),
        IpAddr::V4(v4) => format!("{v4}:{}", addr.port()),
    })
}

pub fn stop() -> Result<()> {
    let live = lock(&CURRENT).take();
    if let Some(l) = live {
        // Ask the host's VS Code to leave cleanly, then close the relay (which ends it anyway).
        let _ = write_request(Path::new(&l.session.project), json!({"action": "stop"}));
        l.relay.stop();
    }
    emit();
    Ok(())
}

/// Refreshes the list of addresses allowed in (contacts who just connected).
pub fn refresh_allowed() {
    if let Some(l) = lock(&CURRENT).as_ref() {
        if l.session.contacts_only {
            l.relay.set_allowed(Some(contact_addresses()));
        }
    }
}

/// Sends the session link to a TekBoard contact through Connect.
pub fn invite(fp: &str) -> Result<()> {
    let svc = crate::connect::service().ok_or_else(|| AppError::new("connect_off", "TekBoard Connect est désactivé"))?;
    let s = current().ok_or_else(|| AppError::new("no_session", "Aucune session en cours"))?;
    let link = s.link.clone().ok_or_else(|| AppError::new("not_ready", "La session n'a pas encore démarré dans VS Code : choisis le serveur TekBoard dans la liste de l'extension."))?;
    let nick = svc.config().profile.nick;
    svc.send(fp, json!({"t": "live.invite", "link": link, "host": nick, "project": if s.show_project { Some(s.name.clone()) } else { None }}))?;
    if let Some(l) = lock(&CURRENT).as_mut() {
        if !l.session.invited.iter().any(|x| x == fp) {
            l.session.invited.push(fp.to_string());
        }
    }
    refresh_allowed();
    emit();
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Invitation {
    pub id: String,
    pub from: String,
    pub host: String,
    pub project: Option<String>,
    pub link: String,
    pub at: i64,
}

static INVITES: Mutex<Vec<Invitation>> = Mutex::new(Vec::new());

pub fn invitations() -> Vec<Invitation> {
    lock(&INVITES).clone()
}

/// Receives invitations from contacts (registered on Connect at start).
pub fn init(svc: &crate::connect::Service) {
    svc.on("live.", |_svc, fp, m| {
        let crate::connect::Incoming::Text(v) = m else { return };
        if v["t"] != "live.invite" {
            return;
        }
        let link = v["link"].as_str().unwrap_or("").to_string();
        if !valid_link(&link) {
            return;
        }
        let inv = Invitation { id: format!("{}-{}", &fp[..8.min(fp.len())], chrono::Utc::now().timestamp_millis()), from: fp.to_string(), host: crate::connect::proto::clean_nick(v["host"].as_str().unwrap_or("")), project: v["project"].as_str().map(|p| p.chars().take(80).collect()), link, at: chrono::Utc::now().timestamp() };
        {
            let mut all = lock(&INVITES);
            all.retain(|i| i.from != fp);
            all.push(inv.clone());
        }
        crate::notify::emit("teklive-invite", inv);
    });
}

/// Accepts an invitation: opens the session in VS Code (the extension joins by itself).
pub fn join(id: &str) -> Result<()> {
    let inv = lock(&INVITES).iter().find(|i| i.id == id).cloned().ok_or_else(|| AppError::new("not_found", "Cette invitation n'existe plus"))?;
    let s = setup();
    if s.code.is_none() {
        return Err(AppError::new("no_vscode", "VS Code (commande `code`) est introuvable"));
    }
    if s.extension.is_none() {
        return Err(AppError::new("no_extension", "L'extension P2P Live Share n'est pas installée"));
    }
    let bin = code_bin().ok_or_else(|| AppError::new("no_vscode", "VS Code est introuvable"))?;
    crate::workspace::spawn_detached(&[bin.to_string_lossy().into_owned(), "--folder-uri".into(), inv.link.clone()], Path::new("/"))?;
    lock(&INVITES).retain(|i| i.id != id);
    Ok(())
}

pub fn decline(id: &str) {
    lock(&INVITES).retain(|i| i.id != id);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_server_address_is_what_vs_code_expects() {
        assert_eq!(server_url(&"192.168.1.42:8765".parse().unwrap()), "ws://192.168.1.42:8765");
        assert_eq!(server_url(&"[fe80::1]:9000".parse().unwrap()), "ws://[fe80::1]:9000");
        // Never localhost when a network exists.
        if let Some(ip) = pick_ip(None) {
            assert!(!ip.is_loopback());
        }
    }

    #[test]
    fn links_are_built_and_checked_like_the_extension() {
        let a: std::net::SocketAddr = "192.168.1.20:41234".parse().unwrap();
        let l = link_of("myproj-ab12cd", &a);
        assert_eq!(l, "p2p-live-share://ws.myproj-ab12cd.192.168.1.20:41234/");
        assert!(valid_link(&l));
        for bad in ["p2p-live-share://trystero.room.mqtt/", "https://evil/", "p2p-live-share://ws.room.host/", "p2p-live-share://ws.ro om.1.2.3.4:5/", "p2p-live-share://ws.room.1.2.3.4:5/x"] {
            assert!(!valid_link(bad), "{bad}");
        }
        assert_eq!(version_in("ms-python.python@1.0\nkermanx.p2p-live-share@0.1.4\n", EXTENSION).as_deref(), Some("0.1.4"));
    }

    #[test]
    fn the_bridge_package_is_a_valid_vsix() {
        let bytes = bridge_vsix().unwrap();
        let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        let names: Vec<String> = (0..z.len()).map(|i| z.by_index(i).unwrap().name().unwrap().to_string()).collect();
        for n in ["[Content_Types].xml", "extension.vsixmanifest", "extension/package.json", "extension/extension.js"] {
            assert!(names.contains(&n.to_string()), "{names:?}");
        }
        let pkg: Value = serde_json::from_str(&bridge_package()).unwrap();
        assert_eq!(format!("{}.{}", pkg["publisher"].as_str().unwrap(), pkg["name"].as_str().unwrap()), BRIDGE);
        assert!(BRIDGE_JS.contains("p2p-live-share.host") && BRIDGE_JS.contains("ConfigurationTarget.Global"));
    }

    #[test]
    fn bridge_requests_are_private_and_one_shot() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        // SAFETY of the test: only this test reads XDG_RUNTIME_DIR in this process path.
        let p = {
            let dir = tmp.path().join("tekboard");
            std::fs::create_dir_all(&dir).unwrap();
            let body = json!({"action": "host", "server": "ws://1.2.3.4:5"});
            let path = dir.join("live-0123456789abcdef.json");
            let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(&path).unwrap();
            f.write_all(body.to_string().as_bytes()).unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
            path
        };
        assert_eq!(std::fs::metadata(&p).unwrap().permissions().mode() & 0o777, 0o600);
        let real = write_request(tmp.path(), json!({"action": "stop"})).unwrap();
        assert_eq!(std::fs::metadata(&real).unwrap().permissions().mode() & 0o777, 0o600);
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&real).unwrap()).unwrap();
        assert_eq!(v["folder"], json!(tmp.path().to_string_lossy()));
        assert!(v["expires"].as_i64().unwrap() > chrono::Utc::now().timestamp_millis());
        std::fs::remove_file(real).unwrap();
    }
}
