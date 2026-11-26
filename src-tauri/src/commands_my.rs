//! MY Epitech commands: sign-in window, manual sync, cached data, forgetting the session.

use crate::commands::{now, AppState};
use crate::error::{AppError, Result};
use crate::myepitech::{self, Entry, SyncReport, SyncRow};
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

fn session_dir(state: &AppState) -> PathBuf {
    state.data_dir.join("my-session")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MyStatus {
    pub window_open: bool,
    /// A token was received from the sign-in window and has not expired.
    pub connected: bool,
    pub expires_at: Option<i64>,
    pub account: Option<String>,
    /// The window exists but is not shown (reopened in the background at startup).
    pub window_hidden: bool,
    /// Minutes between automatic syncs (0 = off) and when the last one ran.
    pub sync_minutes: u32,
    pub last_sync: Option<i64>,
    /// A browser session is kept on disk for the sign-in window.
    pub session_stored: bool,
    pub routes: usize,
}

#[tauri::command(async)]
pub fn my_status(app: AppHandle, state: State<'_, AppState>) -> MyStatus {
    let session = state.my.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let info = session.token.as_deref().and_then(myepitech::token_info);
    let expires_at = info.as_ref().and_then(|i| i.expires_at);
    MyStatus {
        window_open: app.get_webview_window(myepitech::WINDOW).is_some(),
        window_hidden: app.get_webview_window(myepitech::WINDOW).is_some_and(|w| !w.is_visible().unwrap_or(true)),
        sync_minutes: state.settings().map(|s| s.my_sync_minutes).unwrap_or(0),
        last_sync: state.conn().query_row("SELECT MAX(at) FROM my_sync_log", [], |r| r.get(0)).ok().flatten(),
        connected: session.token.is_some() && expires_at.is_none_or(|e| e > now()),
        expires_at,
        account: info.and_then(|i| i.account),
        session_stored: session_dir(&state).is_dir(),
        routes: myepitech::ROUTES.len(),
    }
}

/// Creates the MY Epitech window (the real site, its own storage folder). Hidden when `visible` is false.
fn open_window(app: &AppHandle, state: &AppState, visible: bool) -> Result<()> {
    if let Some(w) = app.get_webview_window(myepitech::WINDOW) {
        if visible {
            let _ = w.show();
            let _ = w.set_focus();
        }
        return Ok(());
    }
    let dir = session_dir(state);
    std::fs::create_dir_all(&dir)?;
    let url = myepitech::ORIGIN.parse().map_err(|_| AppError::new("invalid_url", "Adresse MY Epitech invalide"))?;
    WebviewWindowBuilder::new(app, myepitech::WINDOW, WebviewUrl::External(url))
        .title("MY Epitech — sign in")
        .inner_size(1100.0, 780.0)
        .visible(visible)
        .data_directory(dir)
        .initialization_script(myepitech::INIT_SCRIPT)
        .on_document_title_changed(|window, title| {
            // Only the token hand-off uses the title; the window keeps its own.
            let Some(token) = myepitech::token_from_title(&title) else { return };
            let state = window.state::<AppState>();
            let mut session = state.my.lock().unwrap_or_else(|e| e.into_inner());
            session.token = token;
            session.received_at = now();
        })
        .build()
        .map_err(|e| AppError::new("window_failed", format!("La fenêtre de connexion n'a pas pu s'ouvrir : {e}")))?;
    Ok(())
}

/// Opens the real MY Epitech site in its own window, with its own storage folder.
#[tauri::command]
pub async fn my_connect(app: AppHandle, state: State<'_, AppState>) -> Result<()> {
    open_window(&app, &state, true)
}

fn valid_token(state: &AppState) -> Option<String> {
    let token = state.my.lock().unwrap_or_else(|e| e.into_inner()).token.clone()?;
    let expired = myepitech::token_info(&token).and_then(|i| i.expires_at).is_some_and(|e| e <= now());
    (!expired).then_some(token)
}

/// One sync: reads the fixed list of routes with the token in memory, caches the answers,
/// then lets the new hand-in dates reach the repositories.
pub(crate) fn sync_now(state: &AppState) -> Result<SyncReport> {
    let token = valid_token(state).ok_or_else(myepitech::not_connected)?;
    {
        let mut busy = state.my_syncing.lock().unwrap_or_else(|e| e.into_inner());
        if *busy {
            return Err(AppError::new("busy", "Une synchronisation est déjà en cours"));
        }
        *busy = true;
    }
    let fetched = myepitech::fetch_all(&token);
    *state.my_syncing.lock().unwrap_or_else(|e| e.into_inner()) = false;
    let mut report = myepitech::store(&state.conn(), &fetched.fetched, fetched.skipped_details, now())?;
    if report.unauthorized {
        state.my.lock().unwrap_or_else(|e| e.into_inner()).token = None;
    } else {
        // The new hand-in dates reach the repositories right away (typed dates are kept).
        let _ = crate::commands::load_repos(state);
        let (imported, problems) = import_subjects(state, &token);
        report.subjects_imported = imported;
        // New and moved repositories get their subject; what is uncertain waits for the user.
        if let Ok(a) = crate::commands::associate_subjects(state) {
            report.subjects_linked = a.linked;
            report.subjects_to_confirm = a.suggestions.len();
        }
        if !problems.is_empty() {
            let note = format!("subjects not imported: {}", problems.join("; "));
            report.detail = if report.detail.is_empty() { note } else { format!("{}; {note}", report.detail) };
        }
    }
    // New subjects are read at once when the user asked for it (Settings → AI).
    if report.subjects_imported > 0 && crate::ai::chat::AiSettings::load(&state.conn()).auto_analyze {
        let fresh: Vec<i64> = state.conn().prepare("SELECT s.id FROM subjects s WHERE s.added_at > ?1 AND s.repo_path IS NOT NULL AND NOT EXISTS (SELECT 1 FROM project_briefs b WHERE b.subject_id = s.id)").and_then(|mut st| st.query_map([now() - 3600], |r| r.get(0)).and_then(|r| r.collect())).unwrap_or_default();
        for id in fresh.into_iter().take(3) {
            let _ = crate::ai::subject::analyze(state, id);
        }
    }
    // Manual or automatic: every screen fed by MY Epitech re-reads it (planning included).
    crate::notify::changed(&["my"]);
    Ok(report)
}

const MAX_SUBJECTS_PER_SYNC: usize = 12;

/// Adds to the subjects library the PDFs MY Epitech attaches to running and coming projects,
/// linked to the matching repository when there is one. A document already in the library
/// (same name and size) is not downloaded again. Returns how many were added, and what failed.
pub(crate) fn import_subjects(state: &AppState, token: &str) -> (usize, Vec<String>) {
    use crate::myres;
    let mut problems = Vec::new();
    let Ok((_, overview)) = crate::commands::load_repos(state) else { return (0, vec!["projects could not be listed".into()]) };
    let library = crate::db::list_subjects(&state.conn()).unwrap_or_default();
    // (document, MY Epitech project, its repository, project still running)
    let mut wanted: Vec<(myres::Resource, Option<String>, bool)> = Vec::new();
    for p in overview.projects.iter().filter(|p| p.ongoing || p.upcoming) {
        let body: Option<String> = state.conn().query_row("SELECT body FROM my_cache WHERE route = ?1 AND status BETWEEN 200 AND 299", [myres::listing_route(p.id)], |r| r.get(0)).ok();
        let Some(listing) = body.and_then(|b| serde_json::from_str::<serde_json::Value>(&b).ok()) else { continue };
        let mut files: Vec<myres::Resource> = myres::parse_listing(p.id, &listing).into_iter().filter(myres::is_pdf).collect();
        // The project's own subject is imported last, so it is the most recent one linked to the repository.
        files.sort_by_key(|f| f.main);
        for f in files {
            match library.iter().find(|s| s.name == f.name && f.size.is_none_or(|size| size == s.size)) {
                // Already in the library: it now knows which MY Epitech project it belongs to,
                // which is what ties it to the right repository (see `associate_subjects`).
                Some(known) => {
                    if known.my_project_id.is_none() || (f.main && !known.main) {
                        let _ = crate::db::set_subject_origin(&state.conn(), known.id, Some(p.id), f.main);
                    }
                }
                None => wanted.push((f, p.repo_path.clone(), p.ongoing)),
            }
        }
    }
    // Subjects before bootstraps and annexes, running projects before coming ones.
    wanted.sort_by_key(|(f, _, ongoing)| (!f.main, !ongoing));
    let skipped = wanted.len().saturating_sub(MAX_SUBJECTS_PER_SYNC);
    if skipped > 0 {
        problems.push(format!("{skipped} more document(s) left for the next sync"));
    }
    let dir = state.cache_dir.join("my-resources");
    let mut imported = 0;
    for (res, repo, _) in wanted.into_iter().take(MAX_SUBJECTS_PER_SYNC) {
        let outcome = (|| -> Result<bool> {
            let route = myres::link_route(&res).ok_or_else(|| AppError::new("invalid_path", "unusable file name"))?;
            std::thread::sleep(std::time::Duration::from_millis(500));
            let (status, body) = myepitech::get_once(token, &route);
            if !(200..300).contains(&status) {
                return Err(AppError::new("download_failed", format!("the site answered HTTP {status}")));
            }
            let url = myres::link_from_body(&body).ok_or_else(|| AppError::new("download_failed", "the site did not answer with a download link"))?;
            std::fs::create_dir_all(&dir)?;
            // Only the last path component of the name is used on disk.
            let file_name = std::path::Path::new(&res.name).file_name().map(|n| n.to_owned()).ok_or_else(|| AppError::new("invalid_path", "unusable file name"))?;
            let tmp = dir.join(file_name);
            let result = myres::download(&url, &tmp).and_then(|_| {
                if !myres::looks_like_pdf(&tmp) {
                    return Err(AppError::new("download_failed", "what was downloaded is not a PDF"));
                }
                crate::subjects::import(&state.conn(), &state.subjects(), &tmp, repo.as_deref(), now())
            });
            let _ = std::fs::remove_file(&tmp);
            let r = result?;
            let _ = crate::db::set_subject_origin(&state.conn(), r.subject.id, Some(res.project_id), res.main);
            if r.subject.repo_path.is_some() {
                let _ = state.conn().execute("UPDATE subjects SET link_source = 'auto' WHERE id = ?1 AND link_source IS NULL", [r.subject.id]);
            }
            if !r.duplicate {
                // A new version of a project's subject: what was read from the old one is out of date.
                if let Some(rp) = &repo {
                    let _ = state.conn().execute("UPDATE project_briefs SET stale = 1 WHERE project = ?1", [rp]);
                }
            }
            Ok(!r.duplicate)
        })();
        match outcome {
            Ok(true) => imported += 1,
            Ok(false) => {}
            Err(e) => problems.push(format!("{}: {e}", res.name)),
        }
    }
    if imported > 0 {
        let _ = crate::db::log_activity(&state.conn(), now(), "subjects_import", None, Some(&format!("{imported} from MY Epitech")));
    }
    (imported, problems)
}

/// Documents MY Epitech attaches to each project, from the last sync, and whether each PDF is in the library.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDocs {
    pub project_id: i64,
    pub project: String,
    pub module: String,
    pub repo_path: Option<String>,
    pub files: Vec<DocFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocFile {
    #[serde(flatten)]
    pub file: crate::myres::Resource,
    pub pdf: bool,
    pub in_library: bool,
}

#[tauri::command(async)]
pub fn my_documents(state: State<'_, AppState>) -> Result<Vec<ProjectDocs>> {
    use crate::myres;
    let (_, overview) = crate::commands::load_repos(&state)?;
    let conn = state.conn();
    let library = crate::db::list_subjects(&conn)?;
    let mut out = Vec::new();
    for p in &overview.projects {
        let body: Option<String> = conn.query_row("SELECT body FROM my_cache WHERE route = ?1 AND status BETWEEN 200 AND 299", [myres::listing_route(p.id)], |r| r.get(0)).ok();
        let Some(listing) = body.and_then(|b| serde_json::from_str::<serde_json::Value>(&b).ok()) else { continue };
        let files: Vec<DocFile> = myres::parse_listing(p.id, &listing).into_iter().map(|f| DocFile { pdf: myres::is_pdf(&f), in_library: library.iter().any(|s| s.name == f.name && f.size.is_none_or(|size| size == s.size)), file: f }).collect();
        if !files.is_empty() {
            out.push(ProjectDocs { project_id: p.id, project: p.name.clone(), module: p.unit_code.clone(), repo_path: p.repo_path.clone(), files });
        }
    }
    Ok(out)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectsImport {
    pub imported: usize,
    pub problems: Vec<String>,
}

/// Fetches the subject PDFs listed at the last sync that are not in the library yet. Needs a live session.
#[tauri::command(async)]
pub fn my_import_subjects(state: State<'_, AppState>) -> Result<SubjectsImport> {
    let token = valid_token(&state).ok_or_else(myepitech::not_connected)?;
    let (imported, problems) = import_subjects(&state, &token);
    let _ = crate::commands::associate_subjects(&state);
    Ok(SubjectsImport { imported, problems })
}

#[tauri::command(async)]
pub fn my_sync(state: State<'_, AppState>) -> Result<SyncReport> {
    sync_now(&state)
}

/// What the one-button sync went through, sent as `my-sync-progress` while it runs.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SyncProgress {
    /// `connecting` (session being reopened), `sign-in` (the window waits for the user),
    /// `syncing`, `done` or `failed`.
    pub phase: &'static str,
}

/// How long a stored session gets to hand its token over before the window is shown.
const SILENT_WAIT_MS: u64 = 12_000;
/// How long the user has to sign in once the window is shown.
const SIGN_IN_WAIT_MS: u64 = 5 * 60_000;

/// Waits for a valid token. `Err(true)` when the window was closed, `Err(false)` on timeout.
fn wait_for_token(app: &AppHandle, state: &AppState, ms: u64) -> std::result::Result<String, bool> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(ms);
    loop {
        if let Some(t) = valid_token(state) {
            return Ok(t);
        }
        if app.get_webview_window(myepitech::WINDOW).is_none() {
            return Err(true);
        }
        if std::time::Instant::now() >= deadline {
            return Err(false);
        }
        std::thread::sleep(std::time::Duration::from_millis(300));
    }
}

static FLOW: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// The one Sync button: uses the session in memory, otherwise reopens the stored one (hidden),
/// otherwise shows MY Epitech for the user to sign in; syncs as soon as a token is there.
/// The window is closed afterwards only when this sync opened it: a window the user (or
/// the startup reconnection) opened stays as it was.
#[tauri::command]
pub async fn my_sync_auto(app: AppHandle) -> Result<SyncReport> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || sync_blocking(&handle)).await.map_err(|e| AppError::new("sync_failed", e.to_string()))?
}

/// The whole flow, on the calling thread (never the main one: it waits for the sign-in).
pub fn sync_blocking(app: &AppHandle) -> Result<SyncReport> {
    use std::sync::atomic::Ordering;
    if FLOW.swap(true, Ordering::SeqCst) {
        return Err(AppError::new("busy", "Une synchronisation est déjà en cours"));
    }
    let outcome = sync_flow(app);
    FLOW.store(false, Ordering::SeqCst);
    crate::notify::emit("my-sync-progress", SyncProgress { phase: if outcome.is_ok() { "done" } else { "failed" } });
    outcome
}

fn sync_flow(app: &AppHandle) -> Result<SyncReport> {
    let state = app.state::<AppState>();
    let progress = |phase: &'static str| crate::notify::emit("my-sync-progress", SyncProgress { phase });
    // A window that was already there (opened by the user, or hidden by the startup
    // reconnection) is left as it was found: never closed, hidden again if it was hidden.
    let found_hidden = app.get_webview_window(myepitech::WINDOW).is_some_and(|w| !w.is_visible().unwrap_or(true));
    let mut opened_here = false;
    let mut shown_here = false;
    let restore = |opened_here: bool, shown_here: bool| {
        let Some(w) = app.get_webview_window(myepitech::WINDOW) else { return };
        if opened_here {
            let _ = w.close();
        } else if shown_here && found_hidden {
            let _ = w.hide();
        }
    };
    // Two rounds at most: the site may refuse the token in memory (session expired there).
    for round in 0..2 {
        if valid_token(&state).is_none() {
            progress("connecting");
            if app.get_webview_window(myepitech::WINDOW).is_none() {
                // A stored session is tried out of sight first; without one, sign-in is needed anyway.
                let silent = round == 0 && session_dir(&state).is_dir();
                open_on_main(app, !silent)?;
                opened_here = true;
            }
            let visible = app.get_webview_window(myepitech::WINDOW).is_some_and(|w| w.is_visible().unwrap_or(false));
            let mut got = if visible { Err(false) } else { wait_for_token(app, &state, SILENT_WAIT_MS) };
            if got == Err(false) {
                // The site needs the user: show the window and wait for the sign-in.
                progress("sign-in");
                if let Some(w) = app.get_webview_window(myepitech::WINDOW) {
                    shown_here = shown_here || !visible;
                    let _ = w.show();
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                }
                got = wait_for_token(app, &state, SIGN_IN_WAIT_MS);
            }
            match got {
                Ok(_) => {}
                Err(true) => return Err(AppError::new("my_cancelled", "Fenêtre MY Epitech fermée avant la connexion : rien n'a été synchronisé.")),
                Err(false) => {
                    restore(opened_here, shown_here);
                    return Err(AppError::new("my_timeout", "Pas de connexion à MY Epitech au bout de 5 minutes : rien n'a été synchronisé."));
                }
            }
        }
        progress("syncing");
        let report = sync_now(&state)?;
        if report.unauthorized {
            if round == 0 {
                continue;
            }
            return Err(AppError::new("my_unauthorized", "MY Epitech refuse la session : reconnecte-toi dans la fenêtre MY Epitech."));
        }
        restore(opened_here, shown_here);
        if report.ok == 0 {
            return Err(AppError::new("my_network", "MY Epitech ne répond pas (réseau ou site indisponible). Les données déjà gardées restent affichées."));
        }
        return Ok(report);
    }
    unreachable!("the loop returns on its second round")
}

/// Windows are created on the main thread.
fn open_on_main(app: &AppHandle, visible: bool) -> Result<()> {
    let (tx, rx) = std::sync::mpsc::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let state = handle.state::<AppState>();
        let _ = tx.send(open_window(&handle, &state, visible));
    })
    .map_err(|e| AppError::new("window_failed", e.to_string()))?;
    rx.recv_timeout(std::time::Duration::from_secs(10)).map_err(|_| AppError::new("window_failed", "La fenêtre MY Epitech ne s'est pas ouverte"))?
}


/// Whether an automatic sync is due: the interval is set, and the last attempt is older than it.
pub fn sync_due(interval_minutes: u32, last_sync: Option<i64>, now: i64) -> bool {
    interval_minutes > 0 && last_sync.is_none_or(|at| now - at >= interval_minutes as i64 * 60)
}

/// Development aid, absent from release builds: with `TEKBOARD_MY_PROBE=<routes file>:<report file>`,
/// reads each listed route once (GET, on the signed-in account, half a second apart) and
/// writes its HTTP status and the *shape* of the answer (field names and types, no values).
/// Used to find out what a student account may read before adding a route to the sync.
#[cfg(debug_assertions)]
fn probe(app: AppHandle) {
    let Ok(spec) = std::env::var("TEKBOARD_MY_PROBE") else { return };
    let Some((input, output)) = spec.split_once(':') else { return };
    let (input, output) = (input.to_string(), output.to_string());
    std::thread::spawn(move || {
        // A route written `!/path` also shows short text values (names, kinds), not only types.
        fn shape(v: &serde_json::Value, depth: usize) -> serde_json::Value {
            use serde_json::{json, Value};
            match v {
                Value::String(t) if depth >= 100 && t.len() <= 90 && !t.starts_with("http") => json!(t),
                Value::String(t) if depth >= 100 && t.starts_with("http") => json!(format!("(link to {}, {} characters)", t.split('/').nth(2).unwrap_or("?"), t.len())),
                Value::Number(n) if depth >= 100 => json!(n),
                Value::Object(m) if depth >= 100 => Value::Object(m.iter().take(40).map(|(k, x)| (k.clone(), shape(x, depth + 1))).collect()),
                Value::Array(a) if depth >= 100 => Value::Array(a.iter().take(6).map(|x| shape(x, depth + 1)).collect()),
                Value::Object(m) if depth < 4 => Value::Object(m.iter().take(40).map(|(k, x)| (k.clone(), shape(x, depth + 1))).collect()),
                Value::Object(m) => json!(format!("{{…{} fields}}", m.len())),
                Value::Array(a) => json!([format!("{} item(s)", a.len()), a.first().map(|x| shape(x, depth + 1)).unwrap_or(Value::Null)]),
                Value::String(_) => json!("string"),
                Value::Number(_) => json!("number"),
                Value::Bool(_) => json!("bool"),
                Value::Null => Value::Null,
            }
        }
        let mut report = String::new();
        let token = (0..600).find_map(|_| {
            std::thread::sleep(std::time::Duration::from_millis(500));
            valid_token(&app.state::<AppState>())
        });
        let Some(token) = token else {
            let _ = std::fs::write(&output, "no token received within 5 minutes: sign-in is required\n");
            return;
        };
        let routes = std::fs::read_to_string(&input).unwrap_or_default();
        for line in routes.lines().map(str::trim).filter(|r| r.trim_start_matches('!').starts_with('/') && !r.contains("token")) {
            std::thread::sleep(std::time::Duration::from_millis(500));
            let route = line.trim_start_matches('!');
            let (status, body) = myepitech::get_once(&token, route);
            let described = serde_json::from_str::<serde_json::Value>(&body).map(|v| shape(&v, if line.starts_with('!') { 100 } else { 0 }).to_string()).unwrap_or_else(|_| format!("(not JSON, {} bytes)", body.len()));
            report.push_str(&format!("{status} {route}\n    {}\n", described.chars().take(2600).collect::<String>()));
            let _ = std::fs::write(&output, &report);
        }
        if std::env::var_os("TEKBOARD_MY_PROBE_SYNC").is_some() {
            match sync_now(&app.state::<AppState>()) {
                Ok(r) => report.push_str(&format!("sync: {} read, {} not available, {} subject(s) imported; {}\n", r.ok, r.failed, r.subjects_imported, r.detail)),
                Err(e) => report.push_str(&format!("sync failed: {e}\n")),
            }
        }
        report.push_str("done\n");
        let _ = std::fs::write(&output, &report);
    });
}

/// Background companion of the MY Epitech connector: reopens the stored session at startup
/// when asked to, then syncs at the interval chosen in Settings while a valid token is in
/// memory. It never signs in by itself and never retries a failed sync before the next interval.
pub fn start_background(app: AppHandle) {
    #[cfg(debug_assertions)]
    probe(app.clone());
    std::thread::spawn(move || {
        use tauri::Emitter;
        std::thread::sleep(std::time::Duration::from_secs(3));
        {
            let state = app.state::<AppState>();
            let wanted = state.settings().map(|s| s.my_auto_reconnect).unwrap_or(false);
            if wanted && session_dir(&state).is_dir() {
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || {
                    let state = handle.state::<AppState>();
                    let _ = open_window(&handle, &state, false);
                });
            }
        }
        loop {
            std::thread::sleep(std::time::Duration::from_secs(30));
            let state = app.state::<AppState>();
            let Ok(settings) = state.settings() else { continue };
            let last: Option<i64> = state.conn().query_row("SELECT MAX(at) FROM my_sync_log", [], |r| r.get(0)).ok().flatten();
            if !sync_due(settings.my_sync_minutes, last, now()) || valid_token(&state).is_none() {
                continue;
            }
            if let Ok(report) = sync_now(&state) {
                let _ = app.emit("my-synced", &report);
            }
        }
    });
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MyData {
    pub entries: Vec<Entry>,
    pub history: Vec<SyncRow>,
}

#[tauri::command(async)]
pub fn my_data(state: State<'_, AppState>) -> Result<MyData> {
    let conn = state.conn();
    Ok(MyData { entries: myepitech::entries(&conn)?, history: myepitech::history(&conn, 20)? })
}

/// Closes the window, drops the token and erases the stored browser session.
/// With `erase_cache`, the synced data goes too.
#[tauri::command]
pub async fn my_forget(app: AppHandle, state: State<'_, AppState>, erase_cache: bool) -> Result<()> {
    state.my.lock().unwrap_or_else(|e| e.into_inner()).token = None;
    if let Some(w) = app.get_webview_window(myepitech::WINDOW) {
        let _ = w.clear_all_browsing_data();
        let _ = w.destroy();
    }
    let dir = session_dir(&state);
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir)?;
    }
    if erase_cache {
        myepitech::clear_cache(&state.conn())?;
    }
    Ok(())
}

/// Projects, deadlines, test results and credits, read from the cache and matched with local repositories.
#[tauri::command(async)]
pub fn my_overview(state: State<'_, AppState>) -> Result<crate::myview::Overview> {
    Ok(crate::commands::load_repos(&state)?.1)
}

/// Saves the hand-in date of the given MY Epitech projects on their matched repository,
/// unless a date was typed by hand there. Only TekBoard's own data changes.
#[tauri::command(async)]
pub fn my_apply_deadlines(state: State<'_, AppState>, project_ids: Vec<i64>) -> Result<usize> {
    let (_, overview) = crate::commands::load_repos(&state)?;
    crate::projects::apply_my_deadlines(&state.conn(), &overview, Some(&project_ids))
}

/// Hand-ins, sessions and holidays in one list, for the Agenda screen.
#[tauri::command(async)]
pub fn my_agenda(state: State<'_, AppState>) -> Result<crate::mydata::Agenda> {
    let (repos, overview) = crate::commands::load_repos(&state)?;
    let board = crate::projects::board(&repos, &overview, chrono::Utc::now());
    Ok(crate::mydata::agenda(&state.conn(), &overview, &board))
}

/// Log time per week against the weekly goal, from the last sync.
#[tauri::command(async)]
pub fn my_logtime(state: State<'_, AppState>) -> crate::logtime::Logtime {
    crate::logtime::read(&state.conn(), chrono::Local::now().date_naive())
}

/// Credits, units, skills, log time and automated test results, for Analytics.
#[tauri::command(async)]
pub fn my_academic(state: State<'_, AppState>) -> Result<crate::mydata::Academic> {
    let (_, overview) = crate::commands::load_repos(&state)?;
    Ok(crate::mydata::academic(&state.conn(), &overview))
}

#[cfg(test)]
mod tests {
    use super::sync_due;

    #[test]
    fn automatic_sync_waits_for_its_interval_and_never_runs_when_off() {
        assert!(!sync_due(0, None, 1_000), "off");
        assert!(!sync_due(0, Some(0), 1_000_000));
        assert!(sync_due(15, None, 1_000), "never synced");
        assert!(!sync_due(15, Some(1_000), 1_000 + 14 * 60));
        assert!(sync_due(15, Some(1_000), 1_000 + 15 * 60));
        // A failed attempt is logged too, so it is not retried before the next interval.
        assert!(!sync_due(60, Some(5_000), 5_000 + 30));
    }
}

#[derive(serde::Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FreeSlot {
    pub start: String,
    pub end: String,
}

/// Slots of a session nobody holds yet and that are still ahead, from `/events/{id}/slots`.
pub fn free_slots(body: &str, now: chrono::DateTime<chrono::Utc>) -> Option<Vec<FreeSlot>> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    let mut out: Vec<FreeSlot> = v
        .as_array()?
        .iter()
        .filter(|x| x["registration"].is_null())
        .filter_map(|x| Some(FreeSlot { start: x["startDate"].as_str()?.to_string(), end: x["endDate"].as_str()?.to_string() }))
        .filter(|f| chrono::DateTime::parse_from_rfc3339(&f.start).is_ok_and(|t| t > now))
        .collect();
    out.sort_by(|a, b| a.start.cmp(&b.start));
    Some(out)
}

/// Asked when the student wants to see them, never during a sync: one GET with the session in memory.
#[tauri::command(async)]
pub fn my_free_slots(state: State<'_, AppState>, event_id: i64) -> Result<Vec<FreeSlot>> {
    let token = valid_token(&state).ok_or_else(myepitech::not_connected)?;
    let (status, body) = myepitech::get_once(&token, &format!("/events/{event_id}/slots"));
    if status != 200 {
        return Err(AppError::new("my_failed", format!("MY Epitech a répondu {status} pour les créneaux de cette séance")));
    }
    free_slots(&body, chrono::Utc::now()).ok_or_else(|| AppError::new("my_failed", "Liste de créneaux illisible"))
}

#[cfg(test)]
mod slot_tests {
    use super::*;

    #[test]
    fn only_slots_nobody_holds_and_still_ahead_are_offered() {
        let now = chrono::DateTime::parse_from_rfc3339("2026-11-20T00:00:00Z").unwrap().with_timezone(&chrono::Utc);
        let body = r#"[{"startDate":"2026-11-26T08:40:00.000Z","endDate":"2026-11-26T09:00:00.000Z","registration":null},
            {"startDate":"2026-11-26T08:00:00.000Z","endDate":"2026-11-26T08:20:00.000Z","registration":null},
            {"startDate":"2026-11-26T08:20:00.000Z","endDate":"2026-11-26T08:40:00.000Z","registration":{"id":1}},
            {"startDate":"2026-11-19T08:00:00.000Z","endDate":"2026-11-19T08:20:00.000Z","registration":null}]"#;
        let got = free_slots(body, now).unwrap();
        assert_eq!(got.iter().map(|f| f.start.as_str()).collect::<Vec<_>>(), vec!["2026-11-26T08:00:00.000Z", "2026-11-26T08:40:00.000Z"]);
        assert!(free_slots("{\"message\":\"no\"}", now).is_none());
    }
}

/// The Skill Tree, from the last synchronisation (works offline).
#[tauri::command(async)]
pub fn my_skill_tree(state: State<'_, AppState>) -> crate::skilltree::Tree {
    crate::skilltree::build(&state.conn())
}

/// Credit simulations kept by the student (never official figures).
#[tauri::command(async)]
pub fn credit_scenarios(state: State<'_, AppState>) -> Result<Vec<crate::credits::Scenario>> {
    crate::credits::list(&state.conn())
}

#[tauri::command(async)]
pub fn credit_scenario_save(state: State<'_, AppState>, id: Option<i64>, name: String, data: serde_json::Value) -> Result<crate::credits::Scenario> {
    crate::credits::save(&state.conn(), id, &name, &data, now())
}

#[tauri::command(async)]
pub fn credit_scenario_delete(state: State<'_, AppState>, id: i64) -> Result<()> {
    crate::credits::delete(&state.conn(), id)
}
