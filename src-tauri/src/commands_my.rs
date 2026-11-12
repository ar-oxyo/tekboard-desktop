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
    let url = myepitech::ORIGIN.parse().map_err(|_| AppError::new("invalid_url", "Bad MY Epitech address"))?;
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
        .map_err(|e| AppError::new("window_failed", format!("The sign-in window could not open: {e}")))?;
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
            return Err(AppError::new("busy", "A synchronisation is already running"));
        }
        *busy = true;
    }
    let fetched = myepitech::fetch_all(&token);
    *state.my_syncing.lock().unwrap_or_else(|e| e.into_inner()) = false;
    let report = myepitech::store(&state.conn(), &fetched.fetched, fetched.skipped_details, now())?;
    if report.unauthorized {
        state.my.lock().unwrap_or_else(|e| e.into_inner()).token = None;
    } else {
        // The new hand-in dates reach the repositories right away (typed dates are kept).
        let _ = crate::commands::load_repos(state);
    }
    Ok(report)
}

#[tauri::command(async)]
pub fn my_sync(state: State<'_, AppState>) -> Result<SyncReport> {
    sync_now(&state)
}

/// Whether an automatic sync is due: the interval is set, and the last attempt is older than it.
pub fn sync_due(interval_minutes: u32, last_sync: Option<i64>, now: i64) -> bool {
    interval_minutes > 0 && last_sync.is_none_or(|at| now - at >= interval_minutes as i64 * 60)
}

/// Background companion of the MY Epitech connector: reopens the stored session at startup
/// when asked to, then syncs at the interval chosen in Settings while a valid token is in
/// memory. It never signs in by itself and never retries a failed sync before the next interval.
pub fn start_background(app: AppHandle) {
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
