//! Commands of the Labo section: Code Playground (and, later, Algorithm Arena).

use crate::commands::{now, project_dir, AppState};
use crate::error::{AppError, Result};
use crate::playground::{self, Draft, DraftFile, DraftSettings, Tools};
use tauri::State;

#[tauri::command(async)]
pub fn playground_tools() -> Tools {
    playground::tools()
}

#[tauri::command(async)]
pub fn playground_list(state: State<'_, AppState>) -> Result<Vec<Draft>> {
    playground::list(&state.conn())
}

#[tauri::command(async)]
pub fn playground_create(state: State<'_, AppState>, title: String, files: Option<Vec<DraftFile>>, settings: Option<DraftSettings>) -> Result<Draft> {
    playground::create(&state.conn(), &title, files, settings, now())
}

#[tauri::command(async)]
pub fn playground_save(state: State<'_, AppState>, id: i64, title: String, files: Vec<DraftFile>, settings: DraftSettings) -> Result<Draft> {
    playground::save(&state.conn(), id, &title, &files, &settings, now())
}

#[tauri::command(async)]
pub fn playground_set_open(state: State<'_, AppState>, id: i64, open: bool) -> Result<()> {
    playground::set_open(&state.conn(), id, open)
}

#[tauri::command(async)]
pub fn playground_delete(state: State<'_, AppState>, id: i64) -> Result<()> {
    playground::delete(&state.conn(), id)
}

/// Saves the draft as given, then compiles and runs it in a job (steps `compile`, `run`).
#[tauri::command(async)]
pub fn playground_run(state: State<'_, AppState>, id: i64, title: String, files: Vec<DraftFile>, settings: DraftSettings) -> Result<u64> {
    let draft = playground::save(&state.conn(), id, &title, &files, &settings, now())?;
    if let Err(why) = crate::ai::sandbox::check() {
        return Err(AppError::new("sandbox_missing", format!("Le Playground exécute le code dans un bac à sable, indisponible ici : {why}")));
    }
    if state.jobs.find_running("playground", |s| s.get("draftId").and_then(|x| x.as_i64()) == Some(id)).is_some() {
        return Err(AppError::new("busy", "Ce brouillon tourne déjà : arrête-le d'abord."));
    }
    let root = state.cache_dir.join("playground").join(format!("{id}-{}", chrono::Utc::now().timestamp_micros()));
    let title = format!("Playground · {}", draft.title);
    Ok(state.jobs.start(state.db.clone(), "playground", None, title, &[("compile", "Compilation"), ("run", "Exécution")], move |job| {
        let result = playground::run_in_job(job, draft.id, &draft.files, &draft.settings, &root);
        // The program and its copy are throwaway: the files live in the draft, the output in the report.
        let _ = std::fs::remove_dir_all(&root);
        result
    }))
}

#[tauri::command(async)]
pub fn playground_import_library(state: State<'_, AppState>, library_id: i64, files: Vec<String>) -> Result<Vec<DraftFile>> {
    let (lib, meta) = {
        let conn = state.conn();
        (crate::library::get(&conn, library_id)?, crate::library::all_meta(&conn, library_id)?)
    };
    let catalog = crate::library::catalog(&lib, &meta)?;
    playground::library_files(&lib, &catalog, &files)
}

#[tauri::command(async)]
pub fn playground_export_preview(state: State<'_, AppState>, id: i64, name: String) -> Result<Vec<DraftFile>> {
    let draft = playground::get(&state.conn(), id)?;
    playground::export_plan(&draft, &name)
}

/// Creates a project folder from the draft inside one of the project roots.
#[tauri::command(async)]
pub fn playground_export(state: State<'_, AppState>, id: i64, parent: String, name: String, git_init: bool) -> Result<String> {
    let parent = project_dir(&state, &parent)?;
    let draft = playground::get(&state.conn(), id)?;
    let dest = playground::export(&draft, &parent, &name, git_init)?;
    crate::notify::changed(&["repos"]);
    Ok(dest.to_string_lossy().into_owned())
}
