//! How Claude Code reaches TekBoard's tools.
//!
//! Claude Code starts `tekboard mcp` (the same program, see `mcp.rs`) as an MCP server. That
//! process holds no data: it relays each tool call over a Unix socket to the running app,
//! which runs it with its own state and rules.
//!
//! - The socket lives in the user's runtime folder, in a folder only the user can open (0700),
//!   and the socket itself is 0600.
//! - Every run gets its own random token, written in its MCP configuration file (0600) and
//!   tied to what that run may use (`Caller`: its tools, its conversation, its working copy).
//!   The token is revoked when the run ends (`Grant` is dropped).

use super::tools::{self, Caller};
use crate::commands::AppState;
use crate::error::{AppError, Result};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};

static GRANTS: Mutex<Option<HashMap<String, Caller>>> = Mutex::new(None);
static SOCKET: OnceLock<PathBuf> = OnceLock::new();
/// The same answers, for runs TekBoard drives itself (OpenRouter, Ollama: see `toolloop`).
static LOCAL: OnceLock<Answer> = OnceLock::new();

fn grants() -> std::sync::MutexGuard<'static, Option<HashMap<String, Caller>>> {
    GRANTS.lock().unwrap_or_else(|e| e.into_inner())
}

pub fn random_hex(bytes: usize) -> String {
    let mut b = vec![0u8; bytes];
    if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
        use std::io::Read;
        let _ = f.read_exact(&mut b);
    }
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// Access of one Claude Code run to TekBoard's tools. Revoked when dropped.
pub struct Grant {
    token: String,
    /// `--mcp-config` file of the run.
    pub config: PathBuf,
}

impl Drop for Grant {
    fn drop(&mut self) {
        if let Some(m) = grants().as_mut() {
            m.remove(&self.token);
        }
        let _ = std::fs::remove_file(&self.config);
    }
}

/// Gives `caller` access to its tools and writes the MCP configuration Claude Code will load.
pub fn grant(cache_dir: &Path, caller: Caller) -> Result<Grant> {
    let socket = SOCKET.get().ok_or_else(|| AppError::new("ipc_down", "Le canal des outils de TekBoard n'est pas ouvert."))?;
    let exe = std::env::current_exe()?;
    let token = random_hex(24);
    let dir = cache_dir.join("mcp");
    std::fs::create_dir_all(&dir)?;
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))?;
    let config = dir.join(format!("{}.json", &token[..12]));
    let body = json!({"mcpServers": {"tekboard": {"type": "stdio", "command": exe, "args": ["mcp", "--socket", socket], "env": {"TEKBOARD_TOKEN": token}}}});
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(&config)?;
        f.write_all(body.to_string().as_bytes())?;
    }
    grants().get_or_insert_with(HashMap::new).insert(token.clone(), caller);
    Ok(Grant { token, config })
}

fn socket_path() -> PathBuf {
    let base = std::env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    base.join("tekboard").join(format!("ipc-{}.sock", std::process::id()))
}

/// Opens the socket and answers tool calls for as long as the app runs.
pub fn serve(app: AppHandle) -> Result<()> {
    serve_with(std::sync::Arc::new(move |req: &Value| match app.try_state::<AppState>() {
        Some(state) => answer(Some(&state), req),
        None => answer(None, req),
    }))
}

/// Same, for a state that is not managed by a window (end-to-end checks, tests).
pub fn serve_static(state: &'static AppState) -> Result<()> {
    serve_with(std::sync::Arc::new(move |req: &Value| answer(Some(state), req)))
}

type Answer = std::sync::Arc<dyn Fn(&Value) -> Value + Send + Sync>;

fn serve_with(answer: Answer) -> Result<()> {
    let _ = LOCAL.set(answer.clone());
    let path = socket_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
        // Sockets of earlier runs of TekBoard that are gone.
        if let Ok(rd) = std::fs::read_dir(dir) {
            for e in rd.flatten() {
                let p = e.path();
                if p.extension().is_some_and(|x| x == "sock") && UnixStream::connect(&p).is_err() {
                    let _ = std::fs::remove_file(&p);
                }
            }
        }
    }
    let _ = std::fs::remove_file(&path);
    let listener = UnixListener::bind(&path)?;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    let _ = SOCKET.set(path);
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let answer = answer.clone();
            std::thread::spawn(move || {
                let _ = handle(stream, &answer);
            });
        }
    });
    Ok(())
}

/// The token written in an MCP configuration file by `grant`.
pub fn token_in(config: &Path) -> Option<String> {
    let v: Value = serde_json::from_str(&std::fs::read_to_string(config).ok()?).ok()?;
    v["mcpServers"]["tekboard"]["env"]["TEKBOARD_TOKEN"].as_str().map(str::to_string)
}

/// A request answered in this process, with the same checks as over the socket.
pub fn local(token: &str, op: &str, name: &str, args: &Value) -> Value {
    match LOCAL.get() {
        Some(answer) => answer(&json!({"token": token, "op": op, "name": name, "args": args})),
        None => json!({"ok": false, "error": "Le canal des outils de TekBoard n'est pas ouvert."}),
    }
}

fn handle(stream: UnixStream, answer: &Answer) -> std::io::Result<()> {
    let mut out = stream.try_clone()?;
    for line in BufReader::new(stream).lines() {
        let line = line?;
        let answer = match serde_json::from_str::<Value>(&line) {
            Ok(req) => answer(&req),
            Err(_) => json!({"ok": false, "error": "requête illisible"}),
        };
        out.write_all(answer.to_string().as_bytes())?;
        out.write_all(b"\n")?;
    }
    Ok(())
}

fn answer(state: Option<&AppState>, req: &Value) -> Value {
    let token = req["token"].as_str().unwrap_or_default();
    let caller = match grants().as_ref().and_then(|m| m.get(token).cloned()) {
        Some(c) => c,
        None => return json!({"ok": false, "error": "Accès refusé : cette exécution n'a pas (ou plus) accès aux outils de TekBoard."}),
    };
    match req["op"].as_str().unwrap_or_default() {
        "list" => json!({"ok": true, "result": tools::list_for(&caller)}),
        "call" => {
            let Some(state) = state else { return json!({"ok": false, "error": "TekBoard démarre encore"}) };
            let name = req["name"].as_str().unwrap_or_default();
            let args = req.get("args").cloned().unwrap_or(json!({}));
            match tools::call(state, &caller, name, &args) {
                Ok(v) => json!({"ok": true, "result": v}),
                Err(e) => json!({"ok": false, "error": e.to_string()}),
            }
        }
        _ => json!({"ok": false, "error": "opération inconnue"}),
    }
}
