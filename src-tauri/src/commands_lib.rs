//! Library manager commands.

use crate::commands::{now, project_dir, AppState};
use crate::db;
use crate::error::{AppError, Result};
use crate::library::{self, ApplyReport, Backup, Catalog, ImportAnalysis, ImportItem, ImportReport, Library, Meta, Plan, PlanRequest, Preset, ProjectStatus};
use crate::workspace::{self, RunReport};
use std::path::{Path, PathBuf};
use tauri::State;

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default()
}

#[tauri::command(async)]
pub fn library_list(state: State<'_, AppState>) -> Result<Vec<Library>> {
    library::list(&state.conn())
}

/// Folders that look like a C library and are not registered yet.
#[tauri::command(async)]
pub fn library_suggestions(state: State<'_, AppState>) -> Result<Vec<String>> {
    let registered = library::list(&state.conn())?;
    Ok(library::suggestions(&home(), &state.templates(), &registered))
}

/// Registers a folder as a library. With `copy`, its sources are first copied into TekBoard's
/// own data folder, so the original (a template, an old project) is never written to.
#[tauri::command(async)]
pub fn library_add(state: State<'_, AppState>, name: String, path: String, copy: bool) -> Result<Library> {
    let src = PathBuf::from(&path);
    if !copy {
        return library::add(&state.conn(), &name, &src, now());
    }
    let slug: String = name.trim().chars().map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' }).collect();
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        return Err(AppError::new("invalid_name", "Give the library a name"));
    }
    // Keep the folder's own name last: it becomes `lib/<name>` in projects.
    let base = src.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "my".into());
    let dest = state.data_dir.join("libraries").join(&slug).join(base);
    library::copy_sources(&src, &dest)?;
    library::add(&state.conn(), &name, &dest, now())
}

#[tauri::command(async)]
pub fn library_unregister(state: State<'_, AppState>, id: i64) -> Result<()> {
    library::unregister(&state.conn(), id)
}

#[tauri::command(async)]
pub fn library_catalog(state: State<'_, AppState>, id: i64) -> Result<Catalog> {
    let (lib, meta) = {
        let conn = state.conn();
        (library::get(&conn, id)?, library::all_meta(&conn, id)?)
    };
    library::catalog(&lib, &meta)
}

#[tauri::command(async)]
pub fn library_read(state: State<'_, AppState>, id: i64, rel: String) -> Result<String> {
    let lib = library::get(&state.conn(), id)?;
    library::read_source(&lib, &rel)
}

#[tauri::command(async)]
pub fn library_set_meta(state: State<'_, AppState>, id: i64, rel: String, meta: Meta) -> Result<()> {
    let meta = Meta {
        description: meta.description.map(|d| d.trim().to_string()).filter(|d| !d.is_empty()),
        tags: meta.tags.into_iter().map(|t| t.trim().to_lowercase()).filter(|t| !t.is_empty()).collect(),
        deps: meta.deps,
    };
    library::set_meta(&state.conn(), id, &rel, &meta)
}

#[tauri::command(async)]
pub fn library_presets(state: State<'_, AppState>, id: i64) -> Result<Vec<Preset>> {
    library::presets(&state.conn(), id)
}

#[tauri::command(async)]
pub fn library_preset_save(state: State<'_, AppState>, id: i64, name: String, files: Vec<String>) -> Result<()> {
    library::save_preset(&state.conn(), id, &name, &files)
}

#[tauri::command(async)]
pub fn library_preset_delete(state: State<'_, AppState>, preset_id: i64) -> Result<()> {
    library::delete_preset(&state.conn(), preset_id)
}

fn lib_dir_key(repo: &Path, id: i64) -> String {
    format!("libdir|{id}|{}", repo.display())
}

/// State of a library inside a project. `lib_dir` changes (and remembers) where it lives there.
#[tauri::command(async)]
pub fn library_project(state: State<'_, AppState>, repo: String, id: i64, lib_dir: Option<String>) -> Result<ProjectStatus> {
    let dir = project_dir(&state, &repo)?;
    let conn = state.conn();
    let lib = library::get(&conn, id)?;
    let key = lib_dir_key(&dir, id);
    let chosen = match lib_dir.map(|d| d.trim().trim_matches('/').to_string()).filter(|d| !d.is_empty()) {
        Some(d) => {
            library::safe_rel(&d)?;
            db::set_setting(&conn, &key, &d)?;
            d
        }
        None => db::get_setting(&conn, &key)?.unwrap_or_else(|| library::default_lib_dir(&lib)),
    };
    library::project_status(&conn, &dir, &lib, &chosen)
}

#[tauri::command(async)]
pub fn library_plan(state: State<'_, AppState>, repo: String, id: i64, request: PlanRequest) -> Result<Plan> {
    let dir = project_dir(&state, &repo)?;
    let conn = state.conn();
    let lib = library::get(&conn, id)?;
    library::plan(&conn, &dir, &lib, &library::all_meta(&conn, id)?, &request)
}

/// Recomputes the plan from the same request and carries it out, so what is written is what
/// the project looks like now, not what it looked like when the preview was drawn.
#[tauri::command(async)]
pub fn library_apply(state: State<'_, AppState>, repo: String, id: i64, request: PlanRequest, confirmed: Vec<String>) -> Result<ApplyReport> {
    crate::commands::forget_scan();
    let dir = project_dir(&state, &repo)?;
    let conn = state.conn();
    let lib = library::get(&conn, id)?;
    let plan = library::plan(&conn, &dir, &lib, &library::all_meta(&conn, id)?, &request)?;
    let report = library::apply(&conn, &dir, &lib, &plan, &confirmed, &state.backups(), now())?;
    if !report.written.is_empty() || !report.deleted.is_empty() {
        let detail = format!("{}: {} written, {} removed", lib.name, report.written.len(), report.deleted.len());
        db::log_activity(&conn, now(), "library", Some(&dir.to_string_lossy()), Some(&detail))?;
    }
    Ok(report)
}

#[tauri::command(async)]
pub fn library_diff(state: State<'_, AppState>, repo: String, id: i64, lib_dir: String, rel: String) -> Result<String> {
    let dir = project_dir(&state, &repo)?;
    let lib = library::get(&state.conn(), id)?;
    library::diff_with_source(&dir, &lib, &lib_dir, &rel)
}

#[tauri::command(async)]
pub fn library_backups(state: State<'_, AppState>, repo: String, path: String) -> Result<Vec<Backup>> {
    let dir = project_dir(&state, &repo)?;
    library::backups_of(&dir, &state.backups(), &path)
}

#[tauri::command(async)]
pub fn library_restore(state: State<'_, AppState>, repo: String, path: String, stamp: String) -> Result<()> {
    crate::commands::forget_scan();
    let dir = project_dir(&state, &repo)?;
    library::restore_backup(&dir, &state.backups(), &path, &stamp)
}

/// Runs `make` in the project's library folder, to check it still compiles.
#[tauri::command(async)]
pub fn library_build(state: State<'_, AppState>, repo: String, lib_dir: String) -> Result<RunReport> {
    let dir = project_dir(&state, &repo)?;
    let rel = library::safe_rel(&lib_dir)?;
    let target = dir.join(rel);
    library::ensure_inside(&dir, &target)?;
    if !target.join("Makefile").is_file() {
        return Err(AppError::new("not_configured", format!("{lib_dir} has no Makefile")));
    }
    workspace::run_argv_captured(&["make".to_string()], &target, std::time::Duration::from_secs(180), &[])
}

#[tauri::command(async)]
pub fn library_import_analyze(state: State<'_, AppState>, id: i64, paths: Vec<String>) -> Result<ImportAnalysis> {
    let lib = library::get(&state.conn(), id)?;
    // Archives are unpacked in a folder of ours, emptied before each use.
    let scratch = state.data_dir.join("tmp").join("import");
    let _ = std::fs::remove_dir_all(&scratch);
    std::fs::create_dir_all(&scratch)?;
    library::analyze_import(&lib, &paths, &scratch)
}

#[tauri::command(async)]
pub fn library_import(state: State<'_, AppState>, id: i64, items: Vec<ImportItem>, header: Option<String>) -> Result<ImportReport> {
    let conn = state.conn();
    let lib = library::get(&conn, id)?;
    let report = library::import_files(&lib, &items, header.as_deref(), &state.backups())?;
    if !report.imported.is_empty() {
        db::log_activity(&conn, now(), "library_import", None, Some(&format!("{}: {} file(s)", lib.name, report.imported.len())))?;
    }
    Ok(report)
}

#[tauri::command(async)]
pub fn library_reveal(state: State<'_, AppState>, id: i64) -> Result<()> {
    let lib = library::get(&state.conn(), id)?;
    workspace::reveal(Path::new(&lib.path))
}
