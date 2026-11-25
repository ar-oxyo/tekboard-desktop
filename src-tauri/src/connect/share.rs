//! TekShare: sending a TekBoard resource (a file, a folder, a C function, a library, a
//! template, a prompt, tests, a benchmark, a log, a patch, a note, a draft…) to a paired
//! device, which can then put it where it belongs.
//!
//! - A resource travels as a bundle: a zip with a manifest (`tekshare.json`: kind, title,
//!   metadata) and its files under `files/`. Nothing in it is ever executed on arrival.
//! - Before sending: sensitive file names and secrets in the content (keys, tokens, cookies)
//!   block the transfer; files from a school project raise the teaching-rules warning, and
//!   a whole school repository cannot be sent.
//! - The receiver sees an offer (sender, kind, preview, size) and accepts or declines. The
//!   bundle then comes in chunks, lands in a quarantine folder and is checked (size, SHA-256)
//!   before it is offered for import; extraction refuses absolute paths, `..`, links, too
//!   many files and suspicious compression ratios.

use super::{Incoming, Service};
use crate::commands::AppState;
use crate::error::{AppError, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};

pub const MAX_BUNDLE: u64 = 50 * 1024 * 1024;
const MAX_UNPACKED: u64 = 200 * 1024 * 1024;
const MAX_ENTRIES: usize = 5000;
const CHUNK: usize = 256 * 1024;
const MAX_OFFERS_PER_PEER: usize = 5;
const OFFER_TTL: i64 = 15 * 60;

/// What the sender picks.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Resource {
    File { path: String },
    Folder { path: String },
    Snippet { title: String, text: String, #[serde(default)] lang: String },
    Draft { id: i64 },
    #[serde(rename_all = "camelCase")]
    LibraryFiles { library_id: i64, files: Vec<String> },
    Library { id: i64 },
    Template { id: String },
    Prompt { id: String, preset: String },
    Tests { repo: String },
    #[serde(rename_all = "camelCase")]
    ArenaRun { run_id: i64 },
    Log { title: String, text: String },
    Error { title: String, text: String },
    Patch { repo: String },
    Note { title: String, text: String },
    Board { id: String },
    Config {},
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub v: u32,
    /// `file`, `folder`, `snippet`, `cfunction`, `library`, `template`, `prompt`, `tests`,
    /// `arena`, `log`, `error`, `patch`, `note`, `draft`, `board`, `config`.
    pub kind: String,
    pub title: String,
    #[serde(default)]
    pub meta: Value,
    #[serde(default)]
    pub files: Vec<String>,
}

pub struct Built {
    pub manifest: Manifest,
    pub files: Vec<(String, Vec<u8>)>,
    /// The school project the content comes from, if any (teaching-rules warning).
    pub school: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub kind: String,
    pub title: String,
    pub files: Vec<String>,
    pub bytes: u64,
    pub preview: String,
    pub school: Option<String>,
    /// Reasons the transfer cannot happen (secrets, sizes…). Empty = it can.
    pub blocked: Vec<String>,
}

// ───────────────────────────── building a bundle ─────────────────────────────

const SKIP_DIRS: &[&str] = &[".git", "node_modules", "target", "dist", "build", ".venv", "venv", "__pycache__", ".cache", ".idea", "coverage", ".mouli"];

fn read_tree(root: &Path, prefix: &str, out: &mut Vec<(String, Vec<u8>)>, total: &mut u64) -> Result<()> {
    let mut stack = vec![root.to_path_buf()];
    while let Some(d) = stack.pop() {
        let mut entries: Vec<_> = std::fs::read_dir(&d)?.flatten().collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let p = e.path();
            let name = e.file_name().to_string_lossy().into_owned();
            let meta = std::fs::symlink_metadata(&p)?;
            if meta.file_type().is_symlink() {
                continue;
            }
            if meta.is_dir() {
                if !SKIP_DIRS.contains(&name.as_str()) {
                    stack.push(p);
                }
                continue;
            }
            if !meta.is_file() || name.ends_with(".o") || name.ends_with(".a") || name.ends_with(".so") || name.starts_with("vgcore.") {
                continue;
            }
            *total += meta.len();
            if *total > MAX_UNPACKED || out.len() >= MAX_ENTRIES {
                return Err(AppError::new("too_big", "Ce dossier est trop gros pour TekShare (200 Mo, 5 000 fichiers au plus)"));
            }
            let rel = p.strip_prefix(root).map(|r| r.to_string_lossy().into_owned()).unwrap_or(name);
            out.push((if prefix.is_empty() { rel } else { format!("{prefix}/{rel}") }, std::fs::read(&p)?));
        }
    }
    Ok(())
}

/// The school project (an Epitech repository) holding `path`, if any.
fn school_of(state: &AppState, path: &Path) -> Option<(String, PathBuf)> {
    let (repos, _) = crate::commands::load_repos_all(state).ok()?;
    repos.into_iter().filter(|r| r.kind == "epitech" && path.starts_with(&r.path)).max_by_key(|r| r.path.len()).map(|r| (r.name.clone(), PathBuf::from(r.path)))
}

fn text_bundle(kind: &str, title: &str, name: &str, text: &str, meta: Value) -> Built {
    Built { manifest: Manifest { v: 1, kind: kind.into(), title: title.chars().take(120).collect(), meta, files: vec![] }, files: vec![(name.into(), text.as_bytes().to_vec())], school: None }
}

pub fn build(state: &AppState, r: &Resource) -> Result<Built> {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    let real = |p: &str| -> Result<PathBuf> {
        let c = std::fs::canonicalize(p).map_err(|_| AppError::new("not_found", format!("{p} n'existe plus")))?;
        if !c.starts_with(&home) {
            return Err(AppError::new("outside_home", "TekShare n'envoie que des fichiers de ton dossier personnel"));
        }
        Ok(c)
    };
    let mut b = match r {
        Resource::File { path } => {
            let p = real(path)?;
            let meta = std::fs::metadata(&p)?;
            if !meta.is_file() {
                return Err(AppError::new("not_a_file", "Choisis un fichier"));
            }
            if meta.len() > MAX_UNPACKED {
                return Err(AppError::new("too_big", "Fichier trop gros pour TekShare"));
            }
            let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "fichier".into());
            let school = school_of(state, &p).map(|s| s.0);
            Built { manifest: Manifest { v: 1, kind: "file".into(), title: name.clone(), meta: json!({}), files: vec![] }, files: vec![(name, std::fs::read(&p)?)], school }
        }
        Resource::Folder { path } => {
            let p = real(path)?;
            if let Some((name, root)) = school_of(state, &p) {
                if root == p {
                    return Err(AppError::new("school_repo", format!("« {name} » est un dépôt de projet de l'école : il ne peut pas être envoyé en entier. Partage plutôt un fichier, une fonction ou un patch, en respectant les règles de l'école.")));
                }
            }
            let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "dossier".into());
            let mut files = Vec::new();
            read_tree(&p, &name, &mut files, &mut 0)?;
            Built { manifest: Manifest { v: 1, kind: "folder".into(), title: name, meta: json!({}), files: vec![] }, files, school: school_of(state, &p).map(|s| s.0) }
        }
        Resource::Snippet { title, text, lang } => text_bundle("snippet", title, &format!("snippet.{}", if lang.is_empty() { "c" } else { lang.as_str() }), text, json!({"lang": lang})),
        Resource::Log { title, text } => text_bundle("log", title, "log.txt", text, json!({})),
        Resource::Error { title, text } => text_bundle("error", title, "error.txt", text, json!({})),
        Resource::Note { title, text } => text_bundle("note", title, "note.md", text, json!({})),
        Resource::Draft { id } => {
            let d = crate::playground::get(&state.conn(), *id)?;
            Built { manifest: Manifest { v: 1, kind: "draft".into(), title: d.title.clone(), meta: json!({"settings": d.settings}), files: vec![] }, files: d.files.iter().map(|f| (f.name.clone(), f.content.as_bytes().to_vec())).collect(), school: None }
        }
        Resource::LibraryFiles { library_id, files } => {
            let (lib, meta) = {
                let conn = state.conn();
                (crate::library::get(&conn, *library_id)?, crate::library::all_meta(&conn, *library_id)?)
            };
            let catalog = crate::library::catalog(&lib, &meta)?;
            let drafts = crate::playground::library_files(&lib, &catalog, files)?;
            let functions: Vec<String> = catalog.files.iter().filter(|f| files.contains(&f.rel)).flat_map(|f| f.functions.iter().map(|x| x.name.clone())).collect();
            let title = if functions.len() == 1 { format!("{}()", functions[0]) } else { format!("{} fichier(s) de {}", files.len(), lib.name) };
            Built { manifest: Manifest { v: 1, kind: "cfunction".into(), title, meta: json!({"library": lib.name, "functions": functions, "selected": files}), files: vec![] }, files: drafts.into_iter().map(|f| (f.name.trim_start_matches("lib/").to_string(), f.content.into_bytes())).collect(), school: None }
        }
        Resource::Library { id } => {
            let lib = crate::library::get(&state.conn(), *id)?;
            let mut files = Vec::new();
            read_tree(Path::new(&lib.path), "", &mut files, &mut 0)?;
            Built { manifest: Manifest { v: 1, kind: "library".into(), title: lib.name.clone(), meta: json!({"name": lib.name}), files: vec![] }, files, school: None }
        }
        Resource::Template { id } => {
            if crate::templates::safe_rel(id).is_none() {
                return Err(AppError::new("invalid", "Modèle invalide"));
            }
            let dir = state.templates().join(id);
            let mut files = Vec::new();
            read_tree(&dir, "", &mut files, &mut 0)?;
            Built { manifest: Manifest { v: 1, kind: "template".into(), title: id.clone(), meta: json!({"id": id}), files: vec![] }, files, school: None }
        }
        Resource::Prompt { id, preset } => {
            let conn = state.conn();
            let body: Option<String> = conn.query_row("SELECT body FROM prompts WHERE id = ?1 AND preset = ?2", params![id, preset], |r| r.get(0)).optional()?;
            let body = match body {
                Some(b) => b,
                None => crate::prompts::template(&conn, id)?,
            };
            text_bundle("prompt", &format!("{id} · {preset}"), "prompt.md", &body, json!({"id": id, "preset": preset}))
        }
        Resource::Tests { repo } => {
            let dir = crate::commands::project_dir(state, repo)?;
            let tests = dir.join("tests");
            if !tests.is_dir() {
                return Err(AppError::new("no_tests", "Ce projet n'a pas de dossier tests/"));
            }
            let mut files = Vec::new();
            read_tree(&tests, "tests", &mut files, &mut 0)?;
            let name = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            Built { manifest: Manifest { v: 1, kind: "tests".into(), title: format!("Tests de {name}"), meta: json!({"project": name}), files: vec![] }, files, school: school_of(state, &dir).map(|s| s.0) }
        }
        Resource::ArenaRun { run_id } => {
            let run = crate::db::get_run(&state.conn(), *run_id)?.ok_or_else(|| AppError::new("not_found", "Ce benchmark n'existe plus"))?;
            let results = run.summary.get("arena").cloned().ok_or_else(|| AppError::new("no_results", "Ce benchmark n'a pas de résultats"))?;
            let report = run.summary.get("report").cloned();
            text_bundle("arena", run.title.trim_start_matches("Arena · "), "arena.json", &serde_json::to_string_pretty(&json!({"results": results, "report": report, "status": run.status, "startedAt": run.started_at}))?, json!({}))
        }
        Resource::Patch { repo } => {
            let dir = crate::commands::repo_dir(state, repo)?;
            let diff = crate::git::run(Some(&dir), &["diff", "HEAD", "--no-color", "--no-ext-diff"]).map_err(|e| AppError::new("git_failed", e.to_string()))?;
            if diff.trim().is_empty() {
                return Err(AppError::new("no_changes", "Aucune modification non commitée à partager"));
            }
            let name = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            let mut b = text_bundle("patch", &format!("Modifications de {name}"), "changes.patch", &diff, json!({"project": name}));
            b.school = school_of(state, &dir).map(|s| s.0);
            b
        }
        Resource::Board { id } => {
            let (name, json) = crate::boards::export_json(&state.conn(), &state.data_dir, id)?;
            text_bundle("board", &name, "board.tekboard-board", &json, json!({}))
        }
        Resource::Config {} => {
            let s = state.settings()?;
            // Only looks: never commands (an IDE or terminal command line would run on their computer).
            let safe = json!({"theme": s.theme, "glassEffects": s.glass_effects, "epitechOnly": s.epitech_only});
            text_bundle("config", "Réglages d'apparence TekBoard", "config.json", &serde_json::to_string_pretty(&safe)?, json!({}))
        }
    };
    b.manifest.files = b.files.iter().map(|(n, _)| n.clone()).collect();
    Ok(b)
}

/// Secrets, sizes and names: what forbids sending.
pub fn blockers(b: &Built) -> Vec<String> {
    let mut out = Vec::new();
    let mut total = 0u64;
    for (name, bytes) in &b.files {
        total += bytes.len() as u64;
        let base = name.rsplit('/').next().unwrap_or(name);
        if crate::packager::sensitive_name(base) {
            out.push(format!("{name} ressemble à un fichier secret (clé, identifiants, .env) : retire-le."));
            continue;
        }
        if bytes.len() < 4 * 1024 * 1024 {
            if let Ok(text) = std::str::from_utf8(bytes) {
                if let Some(kind) = crate::packager::secret_in(text) {
                    out.push(format!("{name} contient ce qui ressemble à un secret ({kind}) : retire-le avant de partager."));
                }
            }
        }
    }
    if total > MAX_UNPACKED {
        out.push("Trop gros pour TekShare (200 Mo au plus).".into());
    }
    if b.files.is_empty() {
        out.push("Rien à envoyer.".into());
    }
    out
}

pub fn preview_of(b: &Built) -> String {
    let first = b.files.iter().find(|(n, _)| !n.ends_with(".png")).map(|(n, bytes)| (n, String::from_utf8_lossy(&bytes[..bytes.len().min(1500)]).into_owned()));
    match first {
        Some((_, text)) if b.files.len() == 1 => text,
        Some((n, text)) => format!("{n}\n{text}"),
        None => String::new(),
    }
}

pub fn check(state: &AppState, r: &Resource) -> Result<Check> {
    let b = build(state, r)?;
    Ok(Check { kind: b.manifest.kind.clone(), title: b.manifest.title.clone(), files: b.manifest.files.clone(), bytes: b.files.iter().map(|f| f.1.len() as u64).sum(), preview: preview_of(&b), school: b.school.clone(), blocked: blockers(&b) })
}

pub fn pack(b: &Built) -> Result<Vec<u8>> {
    let mut buf = std::io::Cursor::new(Vec::new());
    {
        let mut z = zip::ZipWriter::new(&mut buf);
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated).unix_permissions(0o644);
        z.start_file("tekshare.json", opts).map_err(|e| AppError::new("zip", e.to_string()))?;
        z.write_all(serde_json::to_string(&b.manifest)?.as_bytes())?;
        for (name, bytes) in &b.files {
            z.start_file(format!("files/{name}"), opts).map_err(|e| AppError::new("zip", e.to_string()))?;
            z.write_all(bytes)?;
        }
        z.finish().map_err(|e| AppError::new("zip", e.to_string()))?;
    }
    Ok(buf.into_inner())
}

/// A relative path that stays inside the destination (no root, no `..`, no hidden traversal).
pub fn safe_rel(name: &str) -> Option<PathBuf> {
    let p = Path::new(name);
    if name.is_empty() || name.contains('\0') || name.contains('\\') || p.is_absolute() {
        return None;
    }
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::Normal(s) => out.push(s),
            _ => return None,
        }
    }
    (!out.as_os_str().is_empty()).then_some(out)
}

/// Reads and checks a received bundle without writing anything: the manifest and the files.
pub fn open_bundle(bytes: &[u8]) -> Result<(Manifest, Vec<(PathBuf, Vec<u8>)>)> {
    let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| AppError::new("bad_bundle", format!("Paquet illisible : {e}")))?;
    if z.len() > MAX_ENTRIES + 1 {
        return Err(AppError::new("bad_bundle", "Trop de fichiers dans le paquet"));
    }
    let mut manifest: Option<Manifest> = None;
    let mut files = Vec::new();
    let mut total = 0u64;
    for i in 0..z.len() {
        let mut f = z.by_index(i).map_err(|e| AppError::new("bad_bundle", e.to_string()))?;
        let name = f.name().map_err(|e| AppError::new("bad_bundle", e.to_string()))?.to_string();
        if f.is_dir() {
            continue;
        }
        // Symbolic links and special files are refused outright.
        if f.unix_mode().is_some_and(|m| m & 0o170000 != 0o100000 && m & 0o170000 != 0) {
            return Err(AppError::new("bad_bundle", format!("« {name} » n'est pas un fichier ordinaire : paquet refusé")));
        }
        let declared = f.size();
        if f.compressed_size() > 0 && declared / f.compressed_size().max(1) > 200 && declared > 1024 * 1024 {
            return Err(AppError::new("bad_bundle", "Taux de compression suspect (archive piégée) : paquet refusé"));
        }
        total += declared;
        if total > MAX_UNPACKED {
            return Err(AppError::new("bad_bundle", "Paquet trop gros une fois décompressé"));
        }
        let mut data = Vec::with_capacity(declared.min(16 * 1024 * 1024) as usize);
        (&mut f).take(MAX_UNPACKED).read_to_end(&mut data)?;
        if name == "tekshare.json" {
            manifest = serde_json::from_slice(&data).ok();
        } else if let Some(rest) = name.strip_prefix("files/") {
            let rel = safe_rel(rest).ok_or_else(|| AppError::new("bad_bundle", format!("Chemin dangereux refusé : {name}")))?;
            files.push((rel, data));
        }
    }
    let manifest = manifest.ok_or_else(|| AppError::new("bad_bundle", "Paquet sans manifeste"))?;
    Ok((manifest, files))
}

/// Writes checked files under `dest` (created, must not exist): plain files, 0644, no overwrite.
pub fn extract(files: &[(PathBuf, Vec<u8>)], dest: &Path) -> Result<()> {
    if dest.exists() {
        return Err(AppError::new("exists", format!("{} existe déjà", dest.display())));
    }
    std::fs::create_dir_all(dest)?;
    for (rel, data) in files {
        let path = dest.join(rel);
        if !path.starts_with(dest) {
            return Err(AppError::new("bad_bundle", "Chemin dangereux"));
        }
        if let Some(p) = path.parent() {
            std::fs::create_dir_all(p)?;
        }
        let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(&path)?;
        f.write_all(data)?;
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644))?;
    }
    Ok(())
}

// ───────────────────────────── transfers ─────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transfer {
    pub id: String,
    /// `in` or `out`.
    pub direction: String,
    pub peer: String,
    pub peer_nick: String,
    pub kind: String,
    pub title: String,
    pub size: u64,
    pub sha256: String,
    /// `offered`, `sending`, `sent`, `receiving`, `received`, `imported`, `declined`,
    /// `failed`, `cancelled`, `expired`.
    pub status: String,
    pub detail: Option<String>,
    pub progress: u64,
    pub preview: String,
    pub files: Vec<String>,
    pub school: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

pub struct Ctx {
    db: Arc<Mutex<Connection>>,
    dir: PathBuf,
    active: Mutex<HashMap<String, std::fs::File>>,
    svc: std::sync::Weak<Service>,
}

fn ctx(svc: &Service) -> Result<Arc<Ctx>> {
    lock(&svc.ext).get("share").cloned().and_then(|a| a.downcast::<Ctx>().ok()).ok_or_else(|| AppError::new("connect_unavailable", "TekShare n'est pas prêt"))
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

fn row(r: &rusqlite::Row) -> rusqlite::Result<Transfer> {
    let files: String = r.get(12)?;
    Ok(Transfer { id: r.get(0)?, direction: r.get(1)?, peer: r.get(2)?, peer_nick: r.get(3)?, kind: r.get(4)?, title: r.get(5)?, size: r.get::<_, i64>(6)? as u64, sha256: r.get(7)?, status: r.get(8)?, detail: r.get(9)?, progress: r.get::<_, i64>(10)? as u64, preview: r.get(11)?, files: serde_json::from_str(&files).unwrap_or_default(), school: r.get(13)?, created_at: r.get(14)?, updated_at: r.get(15)? })
}

const COLS: &str = "id, direction, peer, peer_nick, kind, title, size, sha256, status, detail, progress, preview, files, school, created_at, updated_at";

pub fn list(conn: &Connection) -> Result<Vec<Transfer>> {
    let mut st = conn.prepare(&format!("SELECT {COLS} FROM connect_transfers ORDER BY created_at DESC LIMIT 200"))?;
    let rows = st.query_map([], row)?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

pub fn get(conn: &Connection, id: &str) -> Result<Option<Transfer>> {
    Ok(conn.query_row(&format!("SELECT {COLS} FROM connect_transfers WHERE id = ?1"), [id], row).optional()?)
}

fn insert(conn: &Connection, t: &Transfer) -> Result<()> {
    conn.execute(
        &format!("INSERT INTO connect_transfers ({COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)"),
        params![t.id, t.direction, t.peer, t.peer_nick, t.kind, t.title, t.size as i64, t.sha256, t.status, t.detail, t.progress as i64, t.preview, serde_json::to_string(&t.files)?, t.school, t.created_at, t.updated_at],
    )?;
    Ok(())
}

fn set_status(c: &Ctx, id: &str, status: &str, detail: Option<String>) {
    let _ = lock(&c.db).execute("UPDATE connect_transfers SET status = ?2, detail = ?3, updated_at = ?4 WHERE id = ?1", params![id, status, detail, now()]);
    changed();
}

fn set_progress(c: &Ctx, id: &str, progress: u64) {
    let _ = lock(&c.db).execute("UPDATE connect_transfers SET progress = ?2 WHERE id = ?1", params![id, progress as i64]);
}

fn changed() {
    crate::notify::emit("tekshare-changed", ());
}

fn bundle_path(c: &Ctx, id: &str, dir: &str) -> Result<PathBuf> {
    if !id.chars().all(|ch| ch.is_ascii_hexdigit()) || id.len() != 32 {
        return Err(AppError::new("invalid", "Identifiant de transfert invalide"));
    }
    let d = c.dir.join(dir);
    std::fs::create_dir_all(&d)?;
    Ok(d.join(format!("{id}.zip")))
}

fn new_id() -> String {
    let mut h = Sha256::new();
    h.update(format!("{:?}{}", std::time::SystemTime::now(), std::process::id()).as_bytes());
    h.update(rand_bytes());
    h.finalize().iter().take(16).map(|b| format!("{b:02x}")).collect()
}

fn rand_bytes() -> [u8; 16] {
    let mut b = [0u8; 16];
    if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
        let _ = f.read_exact(&mut b);
    }
    b
}

/// Sets up TekShare on top of Connect (`dir`: the cache folder for in/out bundles).
pub fn init(svc: &Arc<Service>, db: Arc<Mutex<Connection>>, dir: PathBuf) {
    let c: Arc<dyn std::any::Any + Send + Sync> = Arc::new(Ctx { db, dir, active: Mutex::new(HashMap::new()), svc: Arc::downgrade(svc) });
    lock(&svc.ext).insert("share", c);
    svc.on("share.", |svc, fp, m| {
        if let Err(e) = on_message(svc, fp, m) {
            eprintln!("TekShare: {e}");
        }
    });
}

/// Sends an offer to a paired, connected device. The bundle waits in the outbox until accepted.
pub fn offer(state: &AppState, svc: &Service, fp: &str, r: &Resource, confirmed_school: bool) -> Result<Transfer> {
    if !svc.online(fp) {
        return Err(AppError::new("offline", "Cette personne n'est pas connectée"));
    }
    let b = build(state, r)?;
    let blocked = blockers(&b);
    if !blocked.is_empty() {
        return Err(AppError::new("blocked", blocked.join("\n")));
    }
    if b.school.is_some() && !confirmed_school {
        return Err(AppError::new("school_confirm", "Ce contenu vient d'un projet de l'école : confirme que ce partage respecte les règles pédagogiques."));
    }
    let bytes = pack(&b)?;
    if bytes.len() as u64 > MAX_BUNDLE {
        return Err(AppError::new("too_big", "Paquet trop gros (50 Mo au plus une fois compressé)"));
    }
    let c = ctx(svc)?;
    let id = new_id();
    let sha: String = Sha256::digest(&bytes).iter().map(|x| format!("{x:02x}")).collect();
    std::fs::write(bundle_path(&c, &id, "out")?, &bytes)?;
    let nick = svc.peer_profile(fp).map(|p| p.nick).unwrap_or_default();
    let t = Transfer { id: id.clone(), direction: "out".into(), peer: fp.into(), peer_nick: nick, kind: b.manifest.kind.clone(), title: b.manifest.title.clone(), size: bytes.len() as u64, sha256: sha.clone(), status: "offered".into(), detail: None, progress: 0, preview: preview_of(&b).chars().take(1500).collect(), files: b.manifest.files.clone(), school: b.school.clone(), created_at: now(), updated_at: now() };
    insert(&lock(&c.db), &t)?;
    svc.send(fp, json!({"t": "share.offer", "id": id, "kind": t.kind, "title": t.title, "size": t.size, "sha256": sha, "preview": t.preview, "files": t.files.iter().take(200).collect::<Vec<_>>(), "count": t.files.len(), "school": t.school.is_some()}))?;
    changed();
    Ok(t)
}

/// The receiver accepts or declines an offer.
pub fn answer(svc: &Service, id: &str, accept: bool) -> Result<()> {
    let c = ctx(svc)?;
    let t = get(&lock(&c.db), id)?.ok_or_else(|| AppError::new("not_found", "Transfert inconnu"))?;
    if t.direction != "in" || t.status != "offered" {
        return Err(AppError::new("invalid", "Ce transfert n'attend pas de réponse"));
    }
    if now() - t.created_at > OFFER_TTL {
        set_status(&c, id, "expired", None);
        return Err(AppError::new("expired", "L'offre a expiré"));
    }
    if !accept {
        let _ = svc.send(&t.peer, json!({"t": "share.decline", "id": id}));
        set_status(&c, id, "declined", None);
        return Ok(());
    }
    let path = bundle_path(&c, id, "in")?;
    let f = std::fs::OpenOptions::new().write(true).create(true).truncate(true).open(&path)?;
    lock(&c.active).insert(id.to_string(), f);
    set_status(&c, id, "receiving", None);
    svc.send(&t.peer, json!({"t": "share.accept", "id": id}))
}

pub fn cancel(svc: &Service, id: &str) -> Result<()> {
    let c = ctx(svc)?;
    let t = get(&lock(&c.db), id)?.ok_or_else(|| AppError::new("not_found", "Transfert inconnu"))?;
    if ["offered", "sending", "receiving"].contains(&t.status.as_str()) {
        let _ = svc.send(&t.peer, json!({"t": "share.cancel", "id": id}));
        lock(&c.active).remove(id);
        set_status(&c, id, "cancelled", None);
    }
    Ok(())
}

fn on_message(svc: &Service, fp: &str, m: Incoming) -> Result<()> {
    let c = ctx(svc)?;
    match m {
        Incoming::Text(v) => {
            let id = v["id"].as_str().unwrap_or("").to_string();
            match v["t"].as_str().unwrap_or("") {
                "share.offer" => {
                    let open = list(&lock(&c.db))?.iter().filter(|t| t.peer == fp && t.direction == "in" && t.status == "offered").count();
                    let size = v["size"].as_u64().unwrap_or(u64::MAX);
                    if open >= MAX_OFFERS_PER_PEER || size > MAX_BUNDLE || id.len() != 32 || get(&lock(&c.db), &id)?.is_some() {
                        let _ = svc.send(fp, json!({"t": "share.decline", "id": id, "reason": "limit"}));
                        return Ok(());
                    }
                    let files: Vec<String> = v["files"].as_array().into_iter().flatten().filter_map(|f| f.as_str().map(|s| s.chars().take(300).collect())).take(200).collect();
                    let nick = svc.peer_profile(fp).map(|p| p.nick).unwrap_or_default();
                    let t = Transfer { id: id.clone(), direction: "in".into(), peer: fp.into(), peer_nick: nick.clone(), kind: v["kind"].as_str().unwrap_or("file").chars().take(20).collect(), title: v["title"].as_str().unwrap_or("").chars().take(120).collect(), size, sha256: v["sha256"].as_str().unwrap_or("").chars().take(64).collect(), status: "offered".into(), detail: None, progress: 0, preview: v["preview"].as_str().unwrap_or("").chars().take(1500).collect(), files, school: v["school"].as_bool().unwrap_or(false).then(|| "projet de l'école".to_string()), created_at: now(), updated_at: now() };
                    insert(&lock(&c.db), &t)?;
                    crate::notify::emit("tekshare-offer", json!({"id": id, "nick": nick, "title": t.title, "kind": t.kind, "size": size}));
                    changed();
                }
                "share.accept" => {
                    let Some(t) = get(&lock(&c.db), &id)? else { return Ok(()) };
                    if t.direction != "out" || t.peer != fp || t.status != "offered" {
                        return Ok(());
                    }
                    set_status(&c, &id, "sending", None);
                    let path = bundle_path(&c, &id, "out")?;
                    let fp = fp.to_string();
                    let c2 = c.clone();
                    // Chunks go out at the pace the connection drains them.
                    std::thread::spawn(move || {
                        let c = c2;
                        let Some(svc) = c.svc.upgrade() else { return };
                        let r = (|| -> Result<()> {
                            let bytes = std::fs::read(&path)?;
                            let n = bytes.len().div_ceil(CHUNK).max(1);
                            for (i, chunk) in bytes.chunks(CHUNK).enumerate() {
                                loop {
                                    let st = get(&lock(&c.db), &id)?.map(|t| t.status).unwrap_or_default();
                                    if st != "sending" {
                                        return Err(AppError::new("cancelled", "annulé"));
                                    }
                                    match svc.queued(&fp) {
                                        None => return Err(AppError::new("offline", "connexion perdue")),
                                        Some(q) if q < 8 => break,
                                        _ => std::thread::sleep(std::time::Duration::from_millis(20)),
                                    }
                                }
                                svc.send_binary(&fp, &json!({"t": "share.chunk", "id": id, "i": i, "n": n}), chunk)?;
                                set_progress(&c, &id, ((i + 1) * CHUNK).min(bytes.len()) as u64);
                                if i % 8 == 0 {
                                    changed();
                                }
                            }
                            svc.send(&fp, json!({"t": "share.done", "id": id}))?;
                            Ok(())
                        })();
                        match r {
                            Ok(()) => set_status(&c, &id, "sent", None),
                            Err(e) if e.code() == "cancelled" => {}
                            Err(e) => set_status(&c, &id, "failed", Some(e.to_string())),
                        }
                    });
                }
                "share.decline" => {
                    if get(&lock(&c.db), &id)?.is_some_and(|t| t.peer == fp && t.direction == "out") {
                        set_status(&c, &id, "declined", v["reason"].as_str().map(|r| if r == "limit" { "trop d'offres en attente ou trop gros".to_string() } else { r.to_string() }));
                        let _ = std::fs::remove_file(bundle_path(&c, &id, "out")?);
                    }
                }
                "share.cancel" => {
                    if get(&lock(&c.db), &id)?.is_some_and(|t| t.peer == fp) {
                        lock(&c.active).remove(&id);
                        set_status(&c, &id, "cancelled", Some("annulé par l'autre personne".into()));
                    }
                }
                "share.done" => {
                    let Some(t) = get(&lock(&c.db), &id)? else { return Ok(()) };
                    if t.direction != "in" || t.peer != fp || t.status != "receiving" {
                        return Ok(());
                    }
                    lock(&c.active).remove(&id);
                    let path = bundle_path(&c, &id, "in")?;
                    let bytes = std::fs::read(&path)?;
                    let sha: String = Sha256::digest(&bytes).iter().map(|x| format!("{x:02x}")).collect();
                    if bytes.len() as u64 != t.size || sha != t.sha256 {
                        let _ = std::fs::remove_file(&path);
                        set_status(&c, &id, "failed", Some("Fichier abîmé pendant le transfert (taille ou empreinte SHA-256 différente) : supprimé.".into()));
                        return Ok(());
                    }
                    if let Err(e) = open_bundle(&bytes) {
                        let _ = std::fs::remove_file(&path);
                        set_status(&c, &id, "failed", Some(e.to_string()));
                        return Ok(());
                    }
                    set_progress(&c, &id, t.size);
                    set_status(&c, &id, "received", None);
                    crate::notify::emit("tekshare-received", json!({"id": id, "title": t.title}));
                }
                "connect.gone" => {
                    // The connection dropped: whatever was moving with that device stops.
                    let all = list(&lock(&c.db))?;
                    for t in all.into_iter().filter(|t| t.peer == fp && (t.status == "sending" || t.status == "receiving")) {
                        lock(&c.active).remove(&t.id);
                        set_status(&c, &t.id, "failed", Some("connexion perdue".into()));
                    }
                }
                _ => {}
            }
        }
        Incoming::Binary(h, payload) => {
            let id = h["id"].as_str().unwrap_or("").to_string();
            let Some(t) = get(&lock(&c.db), &id)? else { return Ok(()) };
            if t.direction != "in" || t.peer != fp || t.status != "receiving" {
                return Ok(());
            }
            let mut active = lock(&c.active);
            let Some(f) = active.get_mut(&id) else { return Ok(()) };
            let len = f.metadata().map(|m| m.len()).unwrap_or(0) + payload.len() as u64;
            if len > t.size {
                active.remove(&id);
                drop(active);
                let _ = svc.send(fp, json!({"t": "share.cancel", "id": id}));
                set_status(&c, &id, "failed", Some("Plus de données que prévu : transfert arrêté.".into()));
                return Ok(());
            }
            f.write_all(&payload)?;
            drop(active);
            set_progress(&c, &id, len);
            if h["i"].as_u64().unwrap_or(0) % 8 == 0 {
                changed();
            }
        }
    }
    Ok(())
}

/// A received bundle, opened for its import screen.
pub fn opened(svc: &Service, id: &str) -> Result<(Transfer, Manifest, Vec<(PathBuf, Vec<u8>)>)> {
    let c = ctx(svc)?;
    let t = get(&lock(&c.db), id)?.ok_or_else(|| AppError::new("not_found", "Transfert inconnu"))?;
    if t.direction != "in" || !(t.status == "received" || t.status == "imported") {
        return Err(AppError::new("not_ready", "Ce transfert n'est pas encore reçu"));
    }
    let bytes = std::fs::read(bundle_path(&c, id, "in")?)?;
    let (m, files) = open_bundle(&bytes)?;
    Ok((t, m, files))
}

pub fn mark_imported(svc: &Service, id: &str, detail: String) {
    if let Ok(c) = ctx(svc) {
        set_status(&c, id, "imported", Some(detail));
    }
}

pub fn forget(svc: &Service, id: &str) -> Result<()> {
    let c = ctx(svc)?;
    lock(&c.active).remove(id);
    let _ = std::fs::remove_file(bundle_path(&c, id, "in")?);
    let _ = std::fs::remove_file(bundle_path(&c, id, "out")?);
    lock(&c.db).execute("DELETE FROM connect_transfers WHERE id = ?1 AND status NOT IN ('sending', 'receiving')", [id])?;
    changed();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn built(files: Vec<(&str, &str)>) -> Built {
        Built { manifest: Manifest { v: 1, kind: "folder".into(), title: "t".into(), meta: json!({}), files: files.iter().map(|f| f.0.to_string()).collect() }, files: files.into_iter().map(|(n, c)| (n.to_string(), c.as_bytes().to_vec())).collect(), school: None }
    }

    #[test]
    fn secrets_and_sensitive_names_block_a_transfer() {
        assert!(blockers(&built(vec![("a.c", "int main(void) { return 0; }")])).is_empty());
        assert!(!blockers(&built(vec![(".env", "X=1")])).is_empty());
        assert!(!blockers(&built(vec![("notes.txt", "clé sk-or-v1-0123456789abcdef0123456789abcdef0123456789abcdef")])).is_empty());
        assert!(!blockers(&built(vec![])).is_empty());
    }

    #[test]
    fn bundles_round_trip_and_paths_are_checked() {
        let b = built(vec![("dir/a.c", "A"), ("b.h", "B")]);
        let bytes = pack(&b).unwrap();
        let (m, files) = open_bundle(&bytes).unwrap();
        assert_eq!(m.kind, "folder");
        assert_eq!(files.len(), 2);
        let tmp = tempfile::tempdir().unwrap();
        extract(&files, &tmp.path().join("out")).unwrap();
        assert_eq!(std::fs::read_to_string(tmp.path().join("out/dir/a.c")).unwrap(), "A");
        assert!(extract(&files, &tmp.path().join("out")).is_err(), "never overwrites");
        for bad in ["../x", "/etc/passwd", "a/../../b", "", "a\\b"] {
            assert!(safe_rel(bad).is_none(), "{bad}");
        }
        assert!(safe_rel("a/b.c").is_some());
    }

    struct Node {
        svc: Arc<Service>,
        state: AppState,
        _dir: tempfile::TempDir,
    }

    fn node(nick: &str) -> Node {
        let dir = tempfile::tempdir().unwrap();
        let db = Arc::new(Mutex::new(crate::db::open_in_memory().unwrap()));
        let svc = Arc::new(Service::new(&dir.path().join("id"), db.clone()).unwrap());
        lock(&svc.config).profile.nick = nick.into();
        init(&svc, db.clone(), dir.path().join("share"));
        let state = AppState::for_tests(db, dir.path().join("data"), dir.path().join("cache"));
        Node { svc, state, _dir: dir }
    }

    async fn until(what: &str, mut f: impl FnMut() -> bool) {
        for _ in 0..400 {
            if f() {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
        panic!("timed out waiting for {what}");
    }

    fn status(n: &Node, id: &str) -> String {
        get(&n.state.conn(), id).unwrap().map(|t| t.status).unwrap_or_default()
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn a_resource_goes_across_in_chunks_and_is_checked_before_import() {
        let (a, b) = (node("Alice"), node("Bob"));
        // Paired beforehand (the pairing itself is tested in the connect module).
        for (x, y) in [(&a, &b), (&b, &a)] {
            let p = super::super::proto::Profile { nick: "x".into(), avatar: String::new(), status: "available".into() };
            super::super::store::seen(&x.state.conn(), &y.svc.identity.fp, &p, "127.0.0.1:1", 1).unwrap();
            super::super::store::set_trusted(&x.state.conn(), &y.svc.identity.fp, true).unwrap();
        }
        let lo: std::net::IpAddr = "127.0.0.1".parse().unwrap();
        a.svc.start_on(Some(lo)).await.unwrap();
        b.svc.start_on(Some(lo)).await.unwrap();
        let b_addr = std::net::SocketAddr::new(lo, b.svc.view().port.unwrap());
        a.svc.dial(b_addr, Some(b.svc.identity.fp.clone()), false).await.unwrap();
        until("connected", || a.svc.online(&b.svc.identity.fp) && b.svc.online(&a.svc.identity.fp)).await;

        // About 1.5 MB of text: several chunks.
        let text: String = (0..60_000).map(|i| format!("ligne {i} : int x{i} = {i};\n")).collect();
        let t = offer(&a.state, &a.svc, &b.svc.identity.fp, &Resource::Snippet { title: "Gros extrait".into(), text: text.clone(), lang: "c".into() }, false).unwrap();
        until("offer received", || status(&b, &t.id) == "offered").await;
        let incoming = get(&b.state.conn(), &t.id).unwrap().unwrap();
        assert_eq!((incoming.kind.as_str(), incoming.title.as_str(), incoming.peer_nick.as_str()), ("snippet", "Gros extrait", "Alice"));
        assert!(incoming.preview.starts_with("ligne 0"));
        assert!(super::super::inbox::open(&b.svc, &t.id).is_err(), "nothing to open before it arrives");

        answer(&b.svc, &t.id, true).unwrap();
        until("received", || status(&b, &t.id) == "received").await;
        until("sent", || status(&a, &t.id) == "sent").await;
        let opened = super::super::inbox::open(&b.svc, &t.id).unwrap();
        assert_eq!(opened.destinations, vec!["playground", "downloads"]);
        let dl = b._dir.path().join("Downloads");
        let r = super::super::inbox::import(&b.state, &b.svc, &dl, &t.id, &super::super::inbox::Target::Downloads).unwrap();
        assert!(r.detail.contains("TekShare"));
        let saved = std::fs::read_to_string(dl.join("TekShare/alice/gros-extrait/snippet.c")).unwrap();
        assert_eq!(saved, text);
        assert_eq!(status(&b, &t.id), "imported");
        assert!(super::super::inbox::import(&b.state, &b.svc, &dl, &t.id, &super::super::inbox::Target::Config).is_err(), "a snippet is not a configuration");

        // A refusal, and secrets never leave.
        let t2 = offer(&a.state, &a.svc, &b.svc.identity.fp, &Resource::Note { title: "n".into(), text: "salut".into() }, false).unwrap();
        until("offer 2", || status(&b, &t2.id) == "offered").await;
        answer(&b.svc, &t2.id, false).unwrap();
        until("declined", || status(&a, &t2.id) == "declined").await;
        let secret = offer(&a.state, &a.svc, &b.svc.identity.fp, &Resource::Note { title: "n".into(), text: "token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".into() }, false);
        assert!(secret.unwrap_err().to_string().contains("secret"));

        // Too many pending offers from one device are declined automatically.
        let mut ids = Vec::new();
        for i in 0..(MAX_OFFERS_PER_PEER + 1) {
            ids.push(offer(&a.state, &a.svc, &b.svc.identity.fp, &Resource::Note { title: format!("n{i}"), text: "x".into() }, false).unwrap().id);
        }
        let last = ids.last().unwrap().clone();
        until("limit", || status(&a, &last) == "declined").await;
        a.svc.stop().await;
        b.svc.stop().await;
    }

    #[test]
    fn hostile_archives_are_refused() {
        // Path traversal.
        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut z = zip::ZipWriter::new(&mut buf);
            let o = zip::write::SimpleFileOptions::default();
            z.start_file("tekshare.json", o).unwrap();
            z.write_all(br#"{"v":1,"kind":"file","title":"x"}"#).unwrap();
            z.start_file("files/../../evil.sh", o).unwrap();
            z.write_all(b"rm -rf ~").unwrap();
            z.finish().unwrap();
        }
        assert!(open_bundle(buf.get_ref()).is_err());
        // Compression bomb.
        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut z = zip::ZipWriter::new(&mut buf);
            let o = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
            z.start_file("tekshare.json", o).unwrap();
            z.write_all(br#"{"v":1,"kind":"file","title":"x"}"#).unwrap();
            z.start_file("files/zeros", o).unwrap();
            z.write_all(&vec![0u8; 20 * 1024 * 1024]).unwrap();
            z.finish().unwrap();
        }
        assert!(open_bundle(buf.get_ref()).unwrap_err().to_string().contains("compression"));
        // A link.
        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut z = zip::ZipWriter::new(&mut buf);
            let o = zip::write::SimpleFileOptions::default();
            z.start_file("tekshare.json", o).unwrap();
            z.write_all(br#"{"v":1,"kind":"file","title":"x"}"#).unwrap();
            z.add_symlink("files/link", "/etc/passwd", o).unwrap();
            z.finish().unwrap();
        }
        assert!(open_bundle(buf.get_ref()).is_err());
        assert!(open_bundle(b"not a zip").is_err());
    }
}
