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

// ───────────────────────────── Algorithm Arena ─────────────────────────────

use crate::arena::{self, BenchConfig, Saved};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArenaTools {
    pub sandbox: Option<String>,
    pub valgrind: bool,
    pub callgrind_annotate: bool,
    pub python: bool,
    pub compiler: bool,
}

#[tauri::command(async)]
pub fn arena_tools() -> ArenaTools {
    let has = |b: &str| crate::toolenv::which(b).is_some();
    ArenaTools { sandbox: crate::ai::sandbox::check().err(), valgrind: has("valgrind"), callgrind_annotate: has("callgrind_annotate"), python: has("python3"), compiler: has("gcc") || has("cc") }
}

#[tauri::command(async)]
pub fn arena_list(state: State<'_, AppState>) -> Result<Vec<Saved>> {
    arena::list(&state.conn())
}

#[tauri::command(async)]
pub fn arena_save(state: State<'_, AppState>, id: Option<i64>, config: BenchConfig) -> Result<Saved> {
    arena::save(&state.conn(), id, &config, now())
}

#[tauri::command(async)]
pub fn arena_delete(state: State<'_, AppState>, id: i64) -> Result<()> {
    arena::delete(&state.conn(), id)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Revisions {
    pub current: Option<String>,
    pub branches: Vec<String>,
    /// `(short hash, subject)` of the latest commits.
    pub commits: Vec<(String, String)>,
}

/// Branches and recent commits of a project, to compare versions without checking them out.
#[tauri::command(async)]
pub fn arena_revisions(state: State<'_, AppState>, path: String) -> Result<Revisions> {
    let dir = crate::commands::repo_dir(&state, &path)?;
    let current = crate::git::run(Some(&dir), &["rev-parse", "--abbrev-ref", "HEAD"]).ok().map(|s| s.trim().to_string());
    let branches = crate::git::run(Some(&dir), &["for-each-ref", "--format=%(refname:short)", "refs/heads"]).unwrap_or_default().lines().map(str::to_string).take(50).collect();
    let commits = crate::git::run(Some(&dir), &["log", "--format=%h%x09%s", "-n", "25"]).unwrap_or_default().lines().filter_map(|l| l.split_once('\t').map(|(h, s)| (h.to_string(), s.chars().take(80).collect()))).collect();
    Ok(Revisions { current, branches, commits })
}

fn arena_root(state: &AppState, what: &str) -> std::path::PathBuf {
    state.cache_dir.join("arena").join(format!("{what}-{}", chrono::Utc::now().timestamp_micros()))
}

/// Runs a benchmark in a job (steps: prepare, build, generate, measure, profile, analyze).
#[tauri::command(async)]
pub fn arena_run(state: State<'_, AppState>, config: BenchConfig) -> Result<u64> {
    arena::validate(&config)?;
    if let Err(why) = crate::ai::sandbox::check() {
        return Err(AppError::new("sandbox_missing", format!("L'Arena exécute les programmes dans un bac à sable, indisponible ici : {why}")));
    }
    if state.jobs.active("arena", None).is_some() {
        return Err(AppError::new("busy", "Un benchmark tourne déjà : les mesures seraient faussées. Attends sa fin ou arrête-le."));
    }
    let roots = state.settings()?.roots;
    let root = arena_root(&state, "run");
    let db = state.db.clone();
    let title = format!("Arena · {}", config.name);
    Ok(state.jobs.start(state.db.clone(), "arena", None, title, arena::STEPS, move |job| {
        let r = arena::run_in_job(job, &db, &config, &root, &roots);
        let _ = std::fs::remove_dir_all(&root);
        r
    }))
}

/// Artix writes generators and scenarios for the first variant (shown, never run by itself).
#[tauri::command(async)]
pub fn arena_generate(state: State<'_, AppState>, config: BenchConfig, focus: String) -> Result<u64> {
    crate::ai::provider::require(crate::ai::provider::Feature::ReadFiles)?;
    let variant = config.variants.first().cloned().ok_or_else(|| AppError::new("invalid_bench", "Choisis d'abord le programme à mesurer"))?;
    let roots = state.settings()?.roots;
    let root = arena_root(&state, "ai");
    let db = state.db.clone();
    let focus: String = focus.chars().take(1000).collect();
    Ok(state.jobs.start(state.db.clone(), "arena_ai", None, format!("Arena · environnement par Artix ({})", variant.label), &[("generate", "Écriture des générateurs")], move |job| {
        let dir = root.join("src");
        let r = arena::prepare_variant(&db, &variant, &dir, &roots).and_then(|_| arena::ai::generate_in_job(job, &dir, &config, &focus));
        let _ = std::fs::remove_dir_all(&root);
        r
    }))
}

/// Artix writes the final report from the measured results of a finished benchmark run.
#[tauri::command(async)]
pub fn arena_report(state: State<'_, AppState>, run_id: i64) -> Result<u64> {
    crate::ai::provider::require(crate::ai::provider::Feature::Text)?;
    let run = crate::db::get_run(&state.conn(), run_id)?.ok_or_else(|| AppError::new("not_found", "Ce benchmark n'existe plus"))?;
    let results = run.summary.get("arena").cloned().ok_or_else(|| AppError::new("no_results", "Ce benchmark n'a pas de résultats"))?;
    let root = arena_root(&state, "report");
    Ok(state.jobs.start(state.db.clone(), "arena_report", None, format!("Arena · rapport d'Artix ({})", run.title.trim_start_matches("Arena · ")), &[("report", "Rapport")], move |job| {
        job.set("runId", run_id);
        let _ = std::fs::create_dir_all(&root);
        let r = arena::ai::report_in_job(job, &root, &results);
        let _ = std::fs::remove_dir_all(&root);
        r
    }))
}
