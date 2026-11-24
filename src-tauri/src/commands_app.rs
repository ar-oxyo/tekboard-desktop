//! The app itself: its data (where, backup, restore, resets), its updates and what happened
//! at start. See `datamgmt` and `updates`.

use crate::commands::{now, AppState};
use crate::datamgmt::{self, ExportSummary, Location, Manifest};
use crate::error::{AppError, Result};
use crate::updates::{self, Available, UpdateInfo};
use crate::{myepitech, settings, workspace};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

/// Messages for the user about the start (database set aside, settings repaired), shown once.
#[derive(Default)]
pub struct StartupNotices(pub Mutex<Vec<String>>);

#[tauri::command]
pub fn startup_notices(notices: State<'_, StartupNotices>) -> Vec<String> {
    std::mem::take(&mut *notices.0.lock().unwrap_or_else(|e| e.into_inner()))
}

fn idle(state: &AppState) -> Result<()> {
    if state.jobs.any_running() {
        return Err(AppError::new("busy", "Une tâche est en cours (tests, moulinette, clonage…). Attends qu'elle se termine, puis réessaie."));
    }
    Ok(())
}

#[tauri::command(async)]
pub fn data_locations(state: State<'_, AppState>) -> Vec<Location> {
    datamgmt::locations(&state.data_dir, &state.cache_dir)
}

#[tauri::command(async)]
pub fn data_open(state: State<'_, AppState>, kind: String) -> Result<()> {
    let dir = if kind == "cache" { &state.cache_dir } else { &state.data_dir };
    workspace::reveal(dir)
}

fn backup_name() -> String {
    format!("tekboard-{}.zip", chrono::Local::now().format("%Y-%m-%d-%H%M"))
}

#[tauri::command(async)]
pub fn data_export(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<ExportSummary> {
    let mut dest = PathBuf::from(path.trim());
    if !dest.is_absolute() {
        return Err(AppError::new("invalid_path", "Choisis où enregistrer la sauvegarde"));
    }
    if dest.extension().is_none() {
        dest.set_extension("zip");
    }
    if dest.starts_with(&state.data_dir) || dest.starts_with(&state.cache_dir) {
        return Err(AppError::new("invalid_path", "Enregistre la sauvegarde hors des dossiers de Tekboard (par exemple dans Documents), sinon une réinitialisation l'effacerait."));
    }
    let version = app.package_info().version.to_string();
    let conn = state.conn();
    datamgmt::export(&conn, &state.data_dir, &state.cache_dir, &dest, &version, now())
}

#[tauri::command(async)]
pub fn data_inspect(path: String) -> Result<Manifest> {
    datamgmt::inspect(Path::new(&path))
}

/// Restores a backup. The current data is saved first in `backups/before-import-<date>.zip`.
#[tauri::command(async)]
pub fn data_import(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<String> {
    idle(&state)?;
    let src = PathBuf::from(&path);
    let staging = state.data_dir.join(format!(".import-{}", std::process::id()));
    let result = (|| -> Result<String> {
        datamgmt::stage(&src, &staging, &state.data_dir)?;
        let backups = state.backups();
        std::fs::create_dir_all(&backups)?;
        let before = backups.join(format!("before-import-{}", backup_name().trim_start_matches("tekboard-")));
        {
            let conn = state.conn();
            datamgmt::export(&conn, &state.data_dir, &state.cache_dir, &before, &app.package_info().version.to_string(), now())?;
        }
        datamgmt::swap_in(&state.db, &staging, &state.data_dir)?;
        Ok(before.to_string_lossy().into_owned())
    })();
    if staging.exists() {
        let _ = std::fs::remove_dir_all(&staging);
    }
    if result.is_ok() {
        let s = state.settings().ok();
        crate::toolenv::set_override("claude", s.as_ref().and_then(|s| s.claude_path.as_deref()));
    }
    result
}

#[tauri::command(async)]
pub fn data_clear_cache(state: State<'_, AppState>) -> Result<u64> {
    idle(&state)?;
    datamgmt::clear_cache(&state.cache_dir)
}

#[tauri::command(async)]
pub fn settings_reset(state: State<'_, AppState>) -> Result<settings::Settings> {
    datamgmt::reset_settings(&state.conn())?;
    state.settings()
}

/// Erases all of Tekboard's data and restarts it as on the first day. Repositories and
/// projects folders are not touched. `confirm` is the word the user typed.
#[tauri::command(async)]
pub fn app_reset_all(app: AppHandle, state: State<'_, AppState>, confirm: String) -> Result<()> {
    let word = confirm.trim().to_uppercase();
    if word != "RÉINITIALISER" && word != "REINITIALISER" && word != "RESET" {
        return Err(AppError::new("not_confirmed", "Tape RÉINITIALISER pour confirmer."));
    }
    idle(&state)?;
    let keep: Vec<PathBuf> = state.settings().map(|s| s.roots.iter().chain(s.epitech_dirs.iter()).filter_map(|r| std::fs::canonicalize(r).ok()).collect()).unwrap_or_default();
    if let Some(w) = app.get_webview_window(myepitech::WINDOW) {
        let _ = w.destroy();
    }
    {
        let mut guard = state.db.lock().unwrap_or_else(|e| e.into_inner());
        *guard = crate::db::open_in_memory()?;
    }
    let identifier = app.config().identifier.clone();
    let data_dir = std::fs::canonicalize(&state.data_dir).unwrap_or(state.data_dir.clone());
    let cache_dir = std::fs::canonicalize(&state.cache_dir).unwrap_or(state.cache_dir.clone());
    datamgmt::erase_all(&data_dir, &cache_dir, &identifier, &keep)?;
    app.restart();
}

#[tauri::command]
pub fn app_restart(app: AppHandle) {
    app.restart();
}

#[tauri::command]
pub fn update_info(app: AppHandle) -> UpdateInfo {
    updates::info(&app)
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<Option<Available>> {
    updates::check(&app).await
}

#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<()> {
    updates::install(&app).await
}

#[tauri::command]
pub async fn update_save_package(app: AppHandle) -> Result<String> {
    let path = updates::save_package(&app).await?;
    let _ = workspace::reveal(Path::new(&path));
    Ok(path)
}

/// Opens the releases page (a fixed address) in the default browser.
#[tauri::command(async)]
pub fn update_open_releases() -> Result<()> {
    workspace::spawn_detached(&["xdg-open".to_string(), updates::RELEASES_URL.to_string()], &std::env::temp_dir())
}
