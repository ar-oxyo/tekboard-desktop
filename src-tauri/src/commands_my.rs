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
        connected: session.token.is_some() && expires_at.is_none_or(|e| e > now()),
        expires_at,
        account: info.and_then(|i| i.account),
        session_stored: session_dir(&state).is_dir(),
        routes: myepitech::ROUTES.len(),
    }
}

/// Opens the real MY Epitech site in its own window, with its own storage folder.
#[tauri::command]
pub async fn my_connect(app: AppHandle, state: State<'_, AppState>) -> Result<()> {
    if let Some(w) = app.get_webview_window(myepitech::WINDOW) {
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    let dir = session_dir(&state);
    std::fs::create_dir_all(&dir)?;
    let url = myepitech::ORIGIN.parse().map_err(|_| AppError::new("invalid_url", "Bad MY Epitech address"))?;
    WebviewWindowBuilder::new(&app, myepitech::WINDOW, WebviewUrl::External(url))
        .title("MY Epitech — sign in")
        .inner_size(1100.0, 780.0)
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

/// Reads the fixed list of routes once with the token in memory, and caches the answers.
#[tauri::command(async)]
pub fn my_sync(state: State<'_, AppState>) -> Result<SyncReport> {
    let token = state.my.lock().unwrap_or_else(|e| e.into_inner()).token.clone().ok_or_else(myepitech::not_connected)?;
    {
        let mut busy = state.my_syncing.lock().unwrap_or_else(|e| e.into_inner());
        if *busy {
            return Err(AppError::new("busy", "A synchronisation is already running"));
        }
        *busy = true;
    }
    let fetched = myepitech::fetch_all(&token);
    *state.my_syncing.lock().unwrap_or_else(|e| e.into_inner()) = false;
    let report = myepitech::store(&state.conn(), &fetched, now())?;
    if report.unauthorized {
        state.my.lock().unwrap_or_else(|e| e.into_inner()).token = None;
    }
    Ok(report)
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
