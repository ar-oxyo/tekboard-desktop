//! What the user is listening to, to share at a TekSpace table, from two real sources:
//! - **MPRIS** (Linux): the desktop player (Spotify's app first, else any MPRIS player),
//!   read with `busctl --user --json`, no account and no network;
//! - **Spotify account** (OAuth with PKCE, the user's own app client id): the account's
//!   current playback, whatever device plays it.
//!
//! Only what is really playing is read; nothing is controlled, synchronised or made up.
//! Covers are fetched by the backend (the window's CSP allows no outside image) from
//! Spotify's image host only, kept small, and handed to the window as data URLs.

use crate::error::{AppError, Result};
use base64::Engine;
use serde::Serialize;
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::sync::Mutex;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    pub title: String,
    pub artist: String,
    /// Cover as a data URL (≤ 150 KB), when there is one.
    pub art: Option<String>,
    pub playing: bool,
    pub source: String,
    /// Which player (MPRIS) or device (Spotify).
    pub player: String,
}

// ───────────────────────────── MPRIS ─────────────────────────────

/// Player names on the session bus (`org.mpris.MediaPlayer2.*`), Spotify first.
fn mpris_players() -> Vec<String> {
    let Ok(out) = crate::toolenv::command("busctl").args(["--user", "--json=short", "list"]).stdin(std::process::Stdio::null()).output() else { return Vec::new() };
    let v: Value = serde_json::from_slice(&out.stdout).unwrap_or(Value::Null);
    let mut names: Vec<String> = v.as_array().into_iter().flatten().filter_map(|x| x["name"].as_str()).filter(|n| n.starts_with("org.mpris.MediaPlayer2.")).map(String::from).collect();
    names.sort_by_key(|n| (!n.contains("spotify"), n.clone()));
    names
}

/// Reads `busctl --json=short call … GetAll` of the Player interface.
pub fn parse_mpris(json: &str, player: &str) -> Option<NowPlaying> {
    let v: Value = serde_json::from_str(json).ok()?;
    let props = &v["data"][0];
    let meta = &props["Metadata"]["data"];
    let title = meta["xesam:title"]["data"].as_str().unwrap_or("").trim().to_string();
    if title.is_empty() {
        return None;
    }
    let artist = match &meta["xesam:artist"]["data"] {
        Value::Array(a) => a.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join(", "),
        Value::String(s) => s.clone(),
        _ => String::new(),
    };
    let art_url = meta["mpris:artUrl"]["data"].as_str().unwrap_or("").to_string();
    let playing = props["PlaybackStatus"]["data"].as_str() == Some("Playing");
    let short = player.trim_start_matches("org.mpris.MediaPlayer2.").split('.').next().unwrap_or("").to_string();
    Some(NowPlaying { title, artist, art: (!art_url.is_empty()).then_some(art_url), playing, source: "mpris".into(), player: short })
}

pub fn mpris_now() -> Result<Option<NowPlaying>> {
    if crate::toolenv::which("busctl").is_none() {
        return Err(AppError::new("no_busctl", "busctl est introuvable : la lecture du lecteur de musique (MPRIS) demande systemd."));
    }
    // `playerctld` only mirrors another player: skipped. A player that plays wins over a paused one.
    let mut found: Vec<NowPlaying> = Vec::new();
    for player in mpris_players().into_iter().filter(|p| !p.ends_with(".playerctld")) {
        let out = crate::toolenv::command("busctl").args(["--user", "--json=short", "call", &player, "/org/mpris/MediaPlayer2", "org.freedesktop.DBus.Properties", "GetAll", "s", "org.mpris.MediaPlayer2.Player"]).stdin(std::process::Stdio::null()).output()?;
        if let Some(np) = parse_mpris(&String::from_utf8_lossy(&out.stdout), &player) {
            found.push(np);
        }
    }
    let pick = found.iter().position(|n| n.playing).unwrap_or(0);
    Ok((!found.is_empty()).then(|| {
        let mut np = found.swap_remove(pick);
        np.art = np.art.and_then(|u| cover(&u));
        np
    }))
}

// ───────────────────────────── covers ─────────────────────────────

static COVER: Mutex<Option<(String, Option<String>)>> = Mutex::new(None);

/// Only Spotify's image host is fetched (covers from MPRIS and the Web API live there).
pub fn cover_allowed(url: &str) -> bool {
    url.starts_with("https://i.scdn.co/image/") && url.len() < 200 && url["https://i.scdn.co/image/".len()..].chars().all(|c| c.is_ascii_alphanumeric())
}

/// A cover the player saved locally (`file://…` in the home folder): a small PNG or JPEG only.
fn local_cover(url: &str) -> Option<String> {
    let path = std::path::PathBuf::from(url.strip_prefix("file://")?);
    let home = std::path::PathBuf::from(std::env::var_os("HOME")?);
    let real = std::fs::canonicalize(&path).ok()?;
    let meta = std::fs::metadata(&real).ok()?;
    let kind = match real.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        _ => return None,
    };
    if !real.starts_with(&home) || !meta.is_file() || meta.len() > 150_000 {
        return None;
    }
    let bytes = std::fs::read(&real).ok()?;
    // The file must really be an image of that kind.
    let magic_ok = if kind == "image/png" { bytes.starts_with(&[0x89, b'P', b'N', b'G']) } else { bytes.starts_with(&[0xFF, 0xD8]) };
    magic_ok.then(|| format!("data:{kind};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

fn cover(url: &str) -> Option<String> {
    if url.starts_with("file://") {
        return local_cover(url);
    }
    if !cover_allowed(url) {
        return None;
    }
    if let Some((u, data)) = COVER.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        if u == url {
            return data.clone();
        }
    }
    let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(8))).max_redirects(0).build().into();
    let data = agent.get(url).call().ok().and_then(|mut r| {
        let kind = r.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("image/jpeg").to_string();
        let bytes = r.body_mut().with_config().limit(150_000).read_to_vec().ok()?;
        matches!(kind.as_str(), "image/jpeg" | "image/png" | "image/webp").then(|| format!("data:{kind};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
    });
    *COVER.lock().unwrap_or_else(|e| e.into_inner()) = Some((url.to_string(), data.clone()));
    data
}

// ───────────────────────────── Spotify account (OAuth PKCE) ─────────────────────────────

/// Loopback address registered as redirect URI in the user's Spotify app.
pub const REDIRECT_PORT: u16 = 43_821;
pub fn redirect_uri() -> String {
    format!("http://127.0.0.1:{REDIRECT_PORT}/callback")
}
const SCOPES: &str = "user-read-currently-playing user-read-playback-state";
const SECRET: &str = "spotify_refresh_token";
const CLIENT: &str = "spotify_client_id";

static ACCESS: Mutex<Option<(String, std::time::Instant)>> = Mutex::new(None);

fn random_token(n: usize) -> String {
    let mut bytes = vec![0u8; n];
    if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
        use std::io::Read;
        let _ = f.read_exact(&mut bytes);
    }
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// PKCE challenge of a verifier (S256).
pub fn challenge(verifier: &str) -> String {
    use sha2::{Digest, Sha256};
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

pub fn valid_client_id(id: &str) -> bool {
    id.len() == 32 && id.chars().all(|c| c.is_ascii_hexdigit())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpotifyStatus {
    pub client_id: Option<String>,
    pub connected: bool,
    pub redirect_uri: String,
}

pub fn status() -> SpotifyStatus {
    SpotifyStatus { client_id: crate::ai::secrets::get(CLIENT), connected: crate::ai::secrets::get(SECRET).is_some(), redirect_uri: redirect_uri() }
}

pub fn logout() -> Result<()> {
    crate::ai::secrets::set(SECRET, None)?;
    *ACCESS.lock().unwrap_or_else(|e| e.into_inner()) = None;
    Ok(())
}

/// Authorization URL and the local listener waiting for Spotify's answer.
pub fn login(client_id: &str) -> Result<(String, std::thread::JoinHandle<Result<()>>)> {
    if !valid_client_id(client_id) {
        return Err(AppError::new("invalid_client", "Le Client ID Spotify fait 32 caractères hexadécimaux (tableau de bord Spotify for Developers)."));
    }
    let listener = std::net::TcpListener::bind(("127.0.0.1", REDIRECT_PORT)).map_err(|e| AppError::new("port_busy", format!("Le port {REDIRECT_PORT} est déjà pris sur cet ordinateur : ferme ce qui l'utilise puis réessaie ({e}).")))?;
    let verifier = random_token(48);
    let state = random_token(16);
    let url = format!(
        "https://accounts.spotify.com/authorize?client_id={client_id}&response_type=code&redirect_uri={}&code_challenge_method=S256&code_challenge={}&scope={}&state={state}",
        urlencode(&redirect_uri()),
        challenge(&verifier),
        urlencode(SCOPES)
    );
    crate::ai::secrets::set(CLIENT, Some(client_id))?;
    let id = client_id.to_string();
    let handle = std::thread::spawn(move || -> Result<()> {
        listener.set_nonblocking(false)?;
        // Three minutes to sign in, then the listener closes.
        let deadline = std::time::Instant::now() + Duration::from_secs(180);
        listener.set_nonblocking(true)?;
        loop {
            if std::time::Instant::now() > deadline {
                return Err(AppError::new("timeout", "Connexion à Spotify abandonnée (pas de réponse en 3 minutes)."));
            }
            match listener.accept() {
                Ok((mut sock, _)) => {
                    sock.set_nonblocking(false)?;
                    let mut line = String::new();
                    BufReader::new(&sock).read_line(&mut line)?;
                    let query = line.split_whitespace().nth(1).and_then(|p| p.split_once('?')).map(|x| x.1).unwrap_or("");
                    let get = |k: &str| query.split('&').find_map(|kv| kv.split_once('=').filter(|(a, _)| *a == k).map(|(_, b)| b.to_string()));
                    let ok = get("state").as_deref() == Some(state.as_str()) && get("code").is_some();
                    let body = if ok { "TekBoard est relié à ton compte Spotify. Tu peux fermer cet onglet." } else { "Connexion à Spotify refusée ou annulée. Tu peux fermer cet onglet." };
                    let _ = write!(sock, "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}", body.len());
                    if !ok {
                        return Err(AppError::new("denied", "Spotify n'a pas donné l'accès."));
                    }
                    return exchange(&id, &get("code").unwrap_or_default(), &verifier);
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(200)),
                Err(e) => return Err(e.into()),
            }
        }
    });
    Ok((url, handle))
}

fn urlencode(s: &str) -> String {
    s.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
}

fn token_request(form: &[(&str, &str)]) -> Result<Value> {
    let agent: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).timeout_global(Some(Duration::from_secs(15))).build().into();
    let mut resp = agent.post("https://accounts.spotify.com/api/token").send_form(form.iter().copied()).map_err(|e| AppError::new("spotify_failed", format!("Spotify ne répond pas : {e}")))?;
    let status = resp.status().as_u16();
    let v: Value = serde_json::from_str(&resp.body_mut().read_to_string().unwrap_or_default()).unwrap_or(Value::Null);
    if status != 200 {
        return Err(AppError::new("spotify_failed", format!("Spotify refuse ({status}) : {}", v["error_description"].as_str().or(v["error"].as_str()).unwrap_or("raison inconnue"))));
    }
    Ok(v)
}

fn keep_tokens(v: &Value) -> Result<String> {
    let access = v["access_token"].as_str().ok_or_else(|| AppError::new("spotify_failed", "Réponse de Spotify sans jeton"))?.to_string();
    if let Some(refresh) = v["refresh_token"].as_str() {
        crate::ai::secrets::set(SECRET, Some(refresh))?;
    }
    let secs = v["expires_in"].as_u64().unwrap_or(3600).saturating_sub(60);
    *ACCESS.lock().unwrap_or_else(|e| e.into_inner()) = Some((access.clone(), std::time::Instant::now() + Duration::from_secs(secs)));
    Ok(access)
}

fn exchange(client_id: &str, code: &str, verifier: &str) -> Result<()> {
    let r = redirect_uri();
    keep_tokens(&token_request(&[("grant_type", "authorization_code"), ("code", code), ("redirect_uri", &r), ("client_id", client_id), ("code_verifier", verifier)])?)?;
    Ok(())
}

fn access_token() -> Result<String> {
    if let Some((tok, until)) = ACCESS.lock().unwrap_or_else(|e| e.into_inner()).clone() {
        if std::time::Instant::now() < until {
            return Ok(tok);
        }
    }
    let refresh = crate::ai::secrets::get(SECRET).ok_or_else(|| AppError::new("not_connected", "Compte Spotify non relié"))?;
    let client = crate::ai::secrets::get(CLIENT).ok_or_else(|| AppError::new("not_connected", "Client ID Spotify manquant"))?;
    keep_tokens(&token_request(&[("grant_type", "refresh_token"), ("refresh_token", &refresh), ("client_id", &client)])?)
}

/// `GET /v1/me/player/currently-playing` (204: nothing playing).
pub fn parse_current(v: &Value) -> Option<NowPlaying> {
    let item = &v["item"];
    let title = item["name"].as_str()?.trim().to_string();
    let artist = item["artists"].as_array().into_iter().flatten().filter_map(|a| a["name"].as_str()).collect::<Vec<_>>().join(", ");
    // The smallest cover at least 64 px wide: enough for a table bubble, light to share.
    let mut imgs: Vec<&Value> = item["album"]["images"].as_array().into_iter().flatten().collect();
    imgs.sort_by_key(|i| i["width"].as_u64().unwrap_or(0));
    let art = imgs.iter().find(|i| i["width"].as_u64().unwrap_or(0) >= 64).or(imgs.last()).and_then(|i| i["url"].as_str()).map(String::from);
    Some(NowPlaying { title, artist, art, playing: v["is_playing"].as_bool().unwrap_or(false), source: "spotify".into(), player: v["device"]["name"].as_str().unwrap_or("Spotify").to_string() })
}

pub fn spotify_now() -> Result<Option<NowPlaying>> {
    let token = access_token()?;
    let agent: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).timeout_global(Some(Duration::from_secs(10))).build().into();
    let mut resp = agent.get("https://api.spotify.com/v1/me/player/currently-playing").header("Authorization", &format!("Bearer {token}")).call().map_err(|e| AppError::new("spotify_failed", format!("Spotify ne répond pas : {e}")))?;
    match resp.status().as_u16() {
        204 => Ok(None),
        200 => {
            let v: Value = serde_json::from_str(&resp.body_mut().with_config().limit(1_000_000).read_to_string().unwrap_or_default()).unwrap_or(Value::Null);
            Ok(parse_current(&v).map(|mut np| {
                np.art = np.art.and_then(|u| cover(&u));
                np
            }))
        }
        401 => {
            *ACCESS.lock().unwrap_or_else(|e| e.into_inner()) = None;
            Err(AppError::new("not_connected", "Accès Spotify expiré : reconnecte ton compte."))
        }
        s => Err(AppError::new("spotify_failed", format!("Spotify a répondu {s}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mpris_answers_are_read() {
        let json = r#"{"type":"a{sv}","data":[{"PlaybackStatus":{"type":"s","data":"Playing"},"Metadata":{"type":"a{sv}","data":{"xesam:title":{"type":"s","data":"Midnight City"},"xesam:artist":{"type":"as","data":["M83"]},"mpris:artUrl":{"type":"s","data":"https://i.scdn.co/image/ab67616d0000b273abc"}}}}]}"#;
        let np = parse_mpris(json, "org.mpris.MediaPlayer2.spotify").unwrap();
        assert_eq!((np.title.as_str(), np.artist.as_str(), np.playing, np.player.as_str()), ("Midnight City", "M83", true, "spotify"));
        assert_eq!(np.art.as_deref(), Some("https://i.scdn.co/image/ab67616d0000b273abc"));
        // A player with nothing loaded has no title: nothing to share.
        assert!(parse_mpris(r#"{"data":[{"PlaybackStatus":{"data":"Stopped"},"Metadata":{"data":{}}}]}"#, "x").is_none());
    }

    #[test]
    fn the_web_api_answer_is_read_and_the_small_cover_picked() {
        let v: Value = serde_json::from_str(r#"{"is_playing":false,"device":{"name":"Téléphone"},"item":{"name":"Intro","artists":[{"name":"The xx"},{"name":"X"}],"album":{"images":[{"url":"https://i.scdn.co/image/big","width":640},{"url":"https://i.scdn.co/image/small","width":64},{"url":"https://i.scdn.co/image/tiny","width":32}]}}}"#).unwrap();
        let np = parse_current(&v).unwrap();
        assert_eq!((np.title.as_str(), np.artist.as_str(), np.playing), ("Intro", "The xx, X", false));
        assert_eq!(np.art.as_deref(), Some("https://i.scdn.co/image/small"));
        assert!(parse_current(&serde_json::json!({"item": null})).is_none());
    }

    #[test]
    fn only_spotify_covers_are_fetched_and_pkce_is_standard() {
        assert!(cover_allowed("https://i.scdn.co/image/ab67616d00004851abc123"));
        assert!(!cover_allowed("http://i.scdn.co/image/x"));
        assert!(!cover_allowed("https://evil.example/image.png"));
        assert!(!cover_allowed("https://i.scdn.co/image/../../x"));
        // RFC 7636, appendix B.
        assert_eq!(challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
        assert!(valid_client_id("0123456789abcdef0123456789abcdef"));
        assert!(!valid_client_id("not-a-client"));
        assert_eq!(urlencode("a b:/"), "a%20b%3A%2F");
    }
}
