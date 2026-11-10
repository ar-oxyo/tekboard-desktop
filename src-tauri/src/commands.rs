//! The only surface the UI can reach. Each command validates its inputs:
//! paths must belong to a configured projects folder or to the template library.

use crate::analytics::{self, Analytics};
use crate::cozy::{self, Companion};
use crate::db::{self, Activity, ProjectSheet, Subject};
use crate::doctor::{self, EnvStatus, SshCheck};
use crate::epitech;
use crate::error::{AppError, Result};
use crate::git::{self, Branch, Change, Commit, RepoStatus};
use crate::github::{self, GhStatus};
use crate::launcher::{self, Candidate, CloneOutcome, LocalContext};
use crate::scanner::{self, RepoInfo};
use crate::settings::{self, RootSuggestion, Settings};
use crate::subjects::{self, PdfFile};
use crate::templates::{self, ApplyReport, FilePreview, ImportReport, PlanEntry, TemplateFile, TemplateSummary, Vars};
use crate::workspace::{self, RunReport};
use rusqlite::Connection;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use tauri::{Manager, State};

pub struct AppState {
    pub db: std::sync::Arc<Mutex<Connection>>,
    pub data_dir: PathBuf,
    /// Disposable files: clean-clone test folders, generated archives.
    pub cache_dir: PathBuf,
    pub jobs: crate::jobs::Jobs,
}

impl AppState {
    pub(crate) fn conn(&self) -> MutexGuard<'_, Connection> {
        self.db.lock().unwrap_or_else(|e| e.into_inner())
    }
    pub(crate) fn templates(&self) -> PathBuf {
        self.data_dir.join("templates")
    }
    pub(crate) fn backups(&self) -> PathBuf {
        self.data_dir.join("backups")
    }
    pub(crate) fn subjects(&self) -> PathBuf {
        self.data_dir.join("subjects")
    }
    pub(crate) fn settings(&self) -> Result<Settings> {
        settings::load(&self.conn())
    }
}

pub(crate) fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

/// Resolves `path` and checks it lives inside one of the configured roots.
pub(crate) fn project_dir(state: &AppState, path: &str) -> Result<PathBuf> {
    let canon = std::fs::canonicalize(path).map_err(|_| AppError::new("invalid_target", format!("{path} no longer exists")))?;
    let s = state.settings()?;
    if !canon.is_dir() || !settings::is_inside_any(&canon, &s.roots) {
        return Err(AppError::new("outside_roots", "This folder is not inside one of your projects folders (see Settings)."));
    }
    Ok(canon)
}

pub(crate) fn repo_dir(state: &AppState, path: &str) -> Result<PathBuf> {
    let dir = project_dir(state, path)?;
    if !git::is_repo(&dir) {
        return Err(AppError::new("not_a_repo", "This folder is not a git repository"));
    }
    Ok(dir)
}

// ───────────────────────────── settings & environment ─────────────────────────────

#[tauri::command(async)]
pub fn get_settings(state: State<'_, AppState>) -> Result<Settings> {
    state.settings()
}

#[tauri::command(async)]
pub fn save_settings(state: State<'_, AppState>, settings: Settings) -> Result<Settings> {
    settings::save(&state.conn(), &settings)
}

#[tauri::command(async)]
pub fn suggest_roots() -> Vec<RootSuggestion> {
    std::env::var_os("HOME").map(|h| settings::suggest_roots(Path::new(&h))).unwrap_or_default()
}

#[tauri::command(async)]
pub fn env_status() -> EnvStatus {
    doctor::check()
}

#[tauri::command(async)]
pub fn test_github_ssh() -> SshCheck {
    doctor::test_github_ssh()
}

// ───────────────────────────── repositories ─────────────────────────────

#[tauri::command(async)]
pub fn scan_repos(state: State<'_, AppState>) -> Result<Vec<RepoInfo>> {
    let (roots, meta) = {
        let conn = state.conn();
        (settings::load(&conn)?.roots, db::all_meta(&conn)?)
    };
    Ok(scanner::scan(&roots, &meta))
}

#[tauri::command(async)]
pub fn set_favorite(state: State<'_, AppState>, path: String, favorite: bool) -> Result<()> {
    let dir = repo_dir(&state, &path)?;
    db::set_favorite(&state.conn(), &dir.to_string_lossy(), favorite)
}

#[tauri::command(async)]
pub fn recent_activity(state: State<'_, AppState>, limit: u32) -> Result<Vec<Activity>> {
    db::recent_activity(&state.conn(), limit.min(200))
}

// ───────────────────────────── workspace ─────────────────────────────

fn record_open(state: &AppState, dir: &Path, kind: &str) -> Result<()> {
    let conn = state.conn();
    let p = dir.to_string_lossy();
    db::touch_opened(&conn, &p, now())?;
    db::log_activity(&conn, now(), kind, Some(&p), None)
}

#[tauri::command(async)]
pub fn open_ide(state: State<'_, AppState>, path: String) -> Result<()> {
    let dir = project_dir(&state, &path)?;
    workspace::launch(&state.settings()?.ide_cmd, &dir)?;
    record_open(&state, &dir, "open_ide")
}

#[tauri::command(async)]
pub fn open_terminal(state: State<'_, AppState>, path: String) -> Result<()> {
    let dir = project_dir(&state, &path)?;
    workspace::launch(&state.settings()?.terminal_cmd, &dir)?;
    record_open(&state, &dir, "open_terminal")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceReport {
    pub ide: Option<String>,
    pub terminal: Option<String>,
}

/// IDE + terminal. One failing does not prevent the other; both outcomes are reported.
#[tauri::command(async)]
pub fn open_workspace(state: State<'_, AppState>, path: String) -> Result<WorkspaceReport> {
    let dir = project_dir(&state, &path)?;
    let s = state.settings()?;
    let ide = workspace::launch(&s.ide_cmd, &dir).err().map(|e| e.to_string());
    let terminal = workspace::launch(&s.terminal_cmd, &dir).err().map(|e| e.to_string());
    if ide.is_some() && terminal.is_some() {
        return Err(AppError::new("workspace_failed", format!("IDE: {} — Terminal: {}", ide.unwrap_or_default(), terminal.unwrap_or_default())));
    }
    record_open(&state, &dir, "open_workspace")?;
    Ok(WorkspaceReport { ide, terminal })
}

#[tauri::command(async)]
pub fn reveal_in_files(state: State<'_, AppState>, path: String) -> Result<()> {
    let canon = std::fs::canonicalize(&path).map_err(|_| AppError::new("invalid_target", format!("{path} no longer exists")))?;
    let allowed = settings::is_inside_any(&canon, &state.settings()?.roots) || canon.starts_with(&state.data_dir);
    if !allowed {
        return Err(AppError::new("outside_roots", "This folder is not managed by TekBoard"));
    }
    workspace::reveal(&canon)
}

// ───────────────────────────── GitHub & launcher ─────────────────────────────

#[tauri::command(async)]
pub fn github_status() -> GhStatus {
    github::status()
}

/// Remote repositories not cloned yet, ranked. Needs the network and `gh`.
#[tauri::command(async)]
pub fn launch_candidates(state: State<'_, AppState>) -> Result<Vec<Candidate>> {
    let remote = github::list_repos()?;
    let (roots, meta) = {
        let conn = state.conn();
        (settings::load(&conn)?.roots, db::all_meta(&conn)?)
    };
    let local = scanner::scan(&roots, &meta);
    Ok(launcher::rank(remote, &LocalContext::from_repos(&local), chrono::Utc::now()))
}

#[tauri::command(async)]
pub fn clone_project(state: State<'_, AppState>, url: String, parent: String) -> Result<CloneOutcome> {
    let parent = project_dir(&state, &parent)?;
    let outcome = launcher::clone_into(&url, &parent)?;
    if !outcome.already_present {
        db::log_activity(&state.conn(), now(), "clone", Some(&outcome.path), Some(url.trim()))?;
    }
    Ok(outcome)
}

/// Values offered for the template variables of a given project. Editable in the UI.
#[tauri::command(async)]
pub fn default_vars(state: State<'_, AppState>, target: String) -> Result<Vars> {
    let dir = project_dir(&state, &target)?;
    let folder = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let repo_name = git::origin_url(&dir).as_deref().and_then(epitech::parse_remote).map(|r| r.name).unwrap_or(folder);
    let ep = epitech::parse_repo_name(&repo_name);
    let project = ep.as_ref().map(|e| e.project.clone()).unwrap_or_else(|| repo_name.clone());
    let local = chrono::Local::now();
    let mut vars = Vars::new();
    vars.insert("PROJECT_NAME_UPPER".into(), templates::c_ident_upper(&project));
    vars.insert("BINARY_NAME".into(), project.clone());
    vars.insert("PROJECT_NAME".into(), project);
    vars.insert("REPO_NAME".into(), repo_name);
    vars.insert("MODULE".into(), ep.map(|e| e.module).unwrap_or_default());
    vars.insert("AUTHOR".into(), git::config_get(Some(&dir), "user.name").unwrap_or_default());
    vars.insert("YEAR".into(), local.format("%Y").to_string());
    vars.insert("CREATION_DATE".into(), local.format("%Y-%m-%d").to_string());
    Ok(vars)
}

// ───────────────────────────── templates ─────────────────────────────

#[tauri::command(async)]
pub fn templates_list(state: State<'_, AppState>) -> Result<Vec<TemplateSummary>> {
    templates::list(&state.templates())
}

#[tauri::command(async)]
pub fn template_files(state: State<'_, AppState>, id: String) -> Result<Vec<TemplateFile>> {
    templates::files(&state.templates(), &id)
}

#[tauri::command(async)]
pub fn template_read_file(state: State<'_, AppState>, id: String, rel: String) -> Result<FilePreview> {
    templates::read_file(&state.templates(), &id, &rel)
}

#[tauri::command(async)]
pub fn template_import(state: State<'_, AppState>, source: String, name: String, description: String) -> Result<ImportReport> {
    let report = templates::import_dir(&state.templates(), Path::new(&source), &name, &description)?;
    db::log_activity(&state.conn(), now(), "template_import", None, Some(name.trim()))?;
    Ok(report)
}

#[tauri::command(async)]
pub fn template_duplicate(state: State<'_, AppState>, id: String, name: String) -> Result<String> {
    templates::duplicate(&state.templates(), &id, &name)
}

#[tauri::command(async)]
pub fn template_delete(state: State<'_, AppState>, id: String) -> Result<()> {
    templates::delete(&state.templates(), &id)?;
    let conn = state.conn();
    let mut s = settings::load(&conn)?;
    if s.default_template.as_deref() == Some(id.as_str()) {
        s.default_template = None;
        settings::save(&conn, &s)?;
    }
    Ok(())
}

/// Existing folders that look like ready-made project skeletons, offered for import.
/// Only checks that they exist; nothing is read or copied here.
#[tauri::command(async)]
pub fn template_sources() -> Vec<String> {
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else { return vec![] };
    let config = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).unwrap_or_else(|| home.join(".config"));
    let mut out = Vec::new();
    let tekinit = config.join("tekinit/blueprint");
    if tekinit.is_dir() {
        out.push(tekinit);
    }
    if let Ok(entries) = std::fs::read_dir(home.join("Templates")) {
        let mut dirs: Vec<PathBuf> = entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
        dirs.sort();
        out.extend(dirs);
    }
    out.into_iter().map(|p| p.to_string_lossy().into_owned()).collect()
}

/// Opens the template folder in the IDE so its files can be edited directly.
#[tauri::command(async)]
pub fn template_edit(state: State<'_, AppState>, id: String) -> Result<()> {
    let t = templates::list(&state.templates())?.into_iter().find(|t| t.id == id).ok_or_else(|| AppError::new("invalid_template", "Unknown template"))?;
    workspace::launch(&state.settings()?.ide_cmd, Path::new(&t.path))
}

#[tauri::command(async)]
pub fn template_plan(state: State<'_, AppState>, id: String, target: String, vars: Vars) -> Result<Vec<PlanEntry>> {
    let dir = project_dir(&state, &target)?;
    templates::plan(&state.templates(), &id, &dir, &vars)
}

#[tauri::command(async)]
pub fn template_apply(state: State<'_, AppState>, id: String, target: String, vars: Vars, selected: Vec<String>, overwrite: Vec<String>) -> Result<ApplyReport> {
    let dir = project_dir(&state, &target)?;
    let report = templates::apply(&state.templates(), &id, &dir, &vars, &selected, &overwrite, &state.backups())?;
    db::log_activity(&state.conn(), now(), "template_apply", Some(&dir.to_string_lossy()), Some(&id))?;
    Ok(report)
}

// ───────────────────────────── first commit ─────────────────────────────

/// Stages exactly the given files. Nothing is committed or pushed.
#[tauri::command(async)]
pub fn stage_files(state: State<'_, AppState>, repo: String, files: Vec<String>) -> Result<RepoStatus> {
    let dir = repo_dir(&state, &repo)?;
    for f in &files {
        if templates::safe_rel(f).is_none() {
            return Err(AppError::new("invalid_path", format!("Invalid file path: {f}")));
        }
    }
    git::add(&dir, &files)?;
    git::status(&dir)
}

/// Commits what is staged. Never pushes.
#[tauri::command(async)]
pub fn commit_staged(state: State<'_, AppState>, repo: String, message: String) -> Result<RepoStatus> {
    let dir = repo_dir(&state, &repo)?;
    if git::config_get(Some(&dir), "user.name").is_none() || git::config_get(Some(&dir), "user.email").is_none() {
        return Err(AppError::new("no_identity", "git user.name / user.email are not configured. Set them with git config before committing."));
    }
    git::commit(&dir, &message)?;
    db::log_activity(&state.conn(), now(), "commit", Some(&dir.to_string_lossy()), Some(message.trim()))?;
    git::status(&dir)
}

// ───────────────────────────── project sheet ─────────────────────────────

#[tauri::command(async)]
pub fn project_get(state: State<'_, AppState>, path: String) -> Result<ProjectSheet> {
    let dir = repo_dir(&state, &path)?;
    db::get_sheet(&state.conn(), &dir.to_string_lossy())
}

#[tauri::command(async)]
pub fn project_save(state: State<'_, AppState>, path: String, sheet: ProjectSheet) -> Result<ProjectSheet> {
    let dir = repo_dir(&state, &path)?;
    let mut sheet = sheet;
    sheet.deadline = sheet.deadline.map(|d| d.trim().to_string()).filter(|d| !d.is_empty());
    if let Some(d) = &sheet.deadline {
        chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").map_err(|_| AppError::new("invalid_date", format!("“{d}” is not a valid date (expected YYYY-MM-DD)")))?;
    }
    sheet.build_cmd = sheet.build_cmd.map(|c| c.trim().to_string()).filter(|c| !c.is_empty());
    db::save_sheet(&state.conn(), &dir.to_string_lossy(), &sheet)?;
    Ok(sheet)
}

/// Runs the project's build command (default `make`) and returns its output.
#[tauri::command(async)]
pub fn project_build(state: State<'_, AppState>, path: String) -> Result<RunReport> {
    let dir = repo_dir(&state, &path)?;
    let cmd = db::get_sheet(&state.conn(), &dir.to_string_lossy())?.build_cmd.unwrap_or_else(|| "make".to_string());
    let report = workspace::run_captured(&cmd, &dir, std::time::Duration::from_secs(300))?;
    fox_signal(&state, if report.code == Some(0) { "build-ok" } else { "build-fail" });
    let detail = if report.timed_out { "timed out".to_string() } else { format!("exit {}", report.code.map(|c| c.to_string()).unwrap_or_else(|| "?".into())) };
    db::log_activity(&state.conn(), now(), "build", Some(&dir.to_string_lossy()), Some(&detail))?;
    // Build history: same table as tests and checks.
    let status = if report.code == Some(0) { if crate::testrepo::count_warnings(&report.output) > 0 { "warning" } else { "success" } } else { "failed" };
    let head = git::run(Some(&dir), &["rev-parse", "--short", "HEAD"]).map(|t| t.trim().to_string()).unwrap_or_default();
    let summary = serde_json::json!({ "command": cmd, "exitCode": report.code, "warnings": crate::testrepo::count_warnings(&report.output), "commit": head, "timedOut": report.timed_out });
    let title = format!("{} — {cmd}", dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
    db::insert_run(&state.conn(), "build", Some(&dir.to_string_lossy()), now() - (report.duration_ms / 1000) as i64, report.duration_ms as i64, status, &title, &summary.to_string(), &report.output)?;
    Ok(report)
}

// ───────────────────────────── subjects ─────────────────────────────

#[tauri::command(async)]
pub fn subjects_list(state: State<'_, AppState>) -> Result<Vec<Subject>> {
    db::list_subjects(&state.conn())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectCandidate {
    #[serde(flatten)]
    pub file: PdfFile,
    /// Repository this document most plausibly belongs to. A suggestion, never applied silently.
    pub suggested_repo: Option<String>,
    /// A document with the same name and size is already in the library.
    pub in_library: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectScan {
    pub dir: String,
    pub files: Vec<SubjectCandidate>,
}

/// Lists the PDFs of the Downloads folder (or `dir`) with a suggested project. Reads names and sizes only.
#[tauri::command(async)]
pub fn subjects_scan(app: tauri::AppHandle, state: State<'_, AppState>, dir: Option<String>) -> Result<SubjectScan> {
    let dir = match dir {
        Some(d) => PathBuf::from(d),
        None => app.path().download_dir().map_err(|_| AppError::new("no_downloads", "The Downloads folder could not be located"))?,
    };
    if !dir.is_dir() {
        return Err(AppError::new("invalid_source", format!("{} is not a directory", dir.display())));
    }
    let (roots, meta, library) = {
        let conn = state.conn();
        (settings::load(&conn)?.roots, db::all_meta(&conn)?, db::list_subjects(&conn)?)
    };
    // One entry per project name; the folder that kept its original name wins over a renamed copy.
    let mut repos = scanner::scan(&roots, &meta);
    repos.sort_by_key(|r| r.remote.as_ref().map(|rem| rem.name != r.name).unwrap_or(false));
    let mut names: Vec<String> = Vec::new();
    let mut paths: Vec<String> = Vec::new();
    for r in &repos {
        let name = r.epitech.as_ref().map(|e| e.project.clone()).unwrap_or_else(|| r.name.clone());
        if !names.contains(&name) {
            names.push(name);
            paths.push(r.path.clone());
        }
    }
    let files = subjects::list_pdfs(&dir)?
        .into_iter()
        .map(|file| SubjectCandidate {
            suggested_repo: subjects::best_match(&file.name, &names).map(|i| paths[i].clone()),
            in_library: library.iter().any(|s| s.name == file.name && s.size as u64 == file.size),
            file,
        })
        .collect();
    Ok(SubjectScan { dir: dir.to_string_lossy().into_owned(), files })
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectImport {
    pub path: String,
    pub repo_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubjectImportResult {
    pub path: String,
    pub subject: Option<Subject>,
    pub duplicate: bool,
    pub error: Option<String>,
}

/// Copies the given PDFs into the library. One failing file does not stop the others.
#[tauri::command(async)]
pub fn subjects_import(state: State<'_, AppState>, items: Vec<SubjectImport>) -> Result<Vec<SubjectImportResult>> {
    let store = state.subjects();
    let mut out = Vec::new();
    for item in items {
        let repo = match &item.repo_path {
            Some(p) => match repo_dir(&state, p) {
                Ok(dir) => Some(dir.to_string_lossy().into_owned()),
                Err(e) => {
                    out.push(SubjectImportResult { path: item.path, subject: None, duplicate: false, error: Some(e.to_string()) });
                    continue;
                }
            },
            None => None,
        };
        let res = subjects::import(&state.conn(), &store, Path::new(&item.path), repo.as_deref(), now());
        out.push(match res {
            Ok(o) => SubjectImportResult { path: item.path, subject: Some(o.subject), duplicate: o.duplicate, error: None },
            Err(e) => SubjectImportResult { path: item.path, subject: None, duplicate: false, error: Some(e.to_string()) },
        });
    }
    let added = out.iter().filter(|r| r.subject.is_some() && !r.duplicate).count();
    if added > 0 {
        db::log_activity(&state.conn(), now(), "subjects_import", None, Some(&format!("{added} document{}", if added == 1 { "" } else { "s" })))?;
    }
    Ok(out)
}

#[tauri::command(async)]
pub fn subject_link(state: State<'_, AppState>, id: i64, repo_path: Option<String>) -> Result<()> {
    let repo = match repo_path {
        Some(p) => Some(repo_dir(&state, &p)?.to_string_lossy().into_owned()),
        None => None,
    };
    db::link_subject(&state.conn(), id, repo.as_deref())
}

/// Deletes TekBoard's copy only.
#[tauri::command(async)]
pub fn subject_remove(state: State<'_, AppState>, id: i64) -> Result<()> {
    subjects::remove(&state.conn(), &state.subjects(), id)
}

#[tauri::command(async)]
pub fn subject_open(state: State<'_, AppState>, id: i64) -> Result<()> {
    let subject = db::get_subject(&state.conn(), id)?.ok_or_else(|| AppError::new("not_found", "Unknown subject"))?;
    let path = subjects::file_path(&state.subjects(), &subject);
    if !path.is_file() {
        return Err(AppError::new("not_found", "The file is missing from the library"));
    }
    workspace::reveal(&path)
}

// ───────────────────────────── git ─────────────────────────────

fn rel_files(files: &[String]) -> Result<()> {
    for f in files {
        if templates::safe_rel(f).is_none() {
            return Err(AppError::new("invalid_path", format!("Invalid file path: {f}")));
        }
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDetail {
    pub status: RepoStatus,
    pub changes: Vec<Change>,
    pub branches: Vec<Branch>,
    pub log: Vec<Commit>,
    /// Commits a push would send (empty when there is no upstream yet: see `status.upstream`).
    pub outgoing: Vec<Commit>,
    /// Commits a pull would bring, as of the last fetch.
    pub incoming: Vec<Commit>,
}

#[tauri::command(async)]
pub fn git_detail(state: State<'_, AppState>, repo: String) -> Result<GitDetail> {
    let dir = repo_dir(&state, &repo)?;
    let status = git::status(&dir)?;
    let (outgoing, incoming) = if status.upstream.is_some() {
        (git::log(&dir, Some("@{u}..HEAD"), 50)?, git::log(&dir, Some("HEAD..@{u}"), 50)?)
    } else {
        (vec![], vec![])
    };
    Ok(GitDetail { changes: git::changes(&dir)?, branches: git::branches(&dir)?, log: git::log(&dir, None, 30)?, outgoing, incoming, status })
}

#[tauri::command(async)]
pub fn git_diff(state: State<'_, AppState>, repo: String, path: String, staged: bool, untracked: bool) -> Result<String> {
    let dir = repo_dir(&state, &repo)?;
    rel_files(std::slice::from_ref(&path))?;
    if untracked { git::untracked_preview(&dir, &path) } else { git::diff(&dir, &path, staged) }
}

#[tauri::command(async)]
pub fn git_unstage(state: State<'_, AppState>, repo: String, files: Vec<String>) -> Result<()> {
    let dir = repo_dir(&state, &repo)?;
    rel_files(&files)?;
    git::unstage(&dir, &files)
}

/// `op` is `fetch`, `pull` (fast-forward only) or `push` (never forced).
#[tauri::command(async)]
pub fn git_sync(state: State<'_, AppState>, repo: String, op: String) -> Result<String> {
    let dir = repo_dir(&state, &repo)?;
    let kind = match op.as_str() {
        "fetch" => git::Sync::Fetch,
        "pull" => git::Sync::Pull,
        "push" => git::Sync::Push,
        _ => return Err(AppError::new("invalid_op", "Unknown operation")),
    };
    let result = git::sync(&dir, kind);
    if kind == git::Sync::Push {
        fox_signal(&state, if result.is_ok() { "push" } else { "push-fail" });
    }
    let out = result?;
    if kind != git::Sync::Fetch {
        db::log_activity(&state.conn(), now(), &op, Some(&dir.to_string_lossy()), None)?;
    }
    Ok(out)
}

#[tauri::command(async)]
pub fn git_create_branch(state: State<'_, AppState>, repo: String, name: String) -> Result<()> {
    let dir = repo_dir(&state, &repo)?;
    git::create_branch(&dir, &name)?;
    db::log_activity(&state.conn(), now(), "branch", Some(&dir.to_string_lossy()), Some(name.trim()))
}

#[tauri::command(async)]
pub fn git_switch_branch(state: State<'_, AppState>, repo: String, name: String) -> Result<()> {
    let dir = repo_dir(&state, &repo)?;
    git::switch_branch(&dir, &name)
}

// ───────────────────────────── analytics ─────────────────────────────

#[tauri::command(async)]
pub fn analytics(state: State<'_, AppState>) -> Result<Analytics> {
    let (roots, meta) = {
        let conn = state.conn();
        (settings::load(&conn)?.roots, db::all_meta(&conn)?)
    };
    let repos = scanner::scan(&roots, &meta);
    let mut emails: std::collections::HashSet<String> = std::collections::HashSet::new();
    if let Some(e) = git::config_get(None, "user.email") {
        emails.insert(e.to_lowercase());
    }
    let mut inputs = Vec::new();
    for r in &repos {
        let dir = Path::new(&r.path);
        if let Some(e) = git::config_get(Some(dir), "user.email") {
            emails.insert(e.to_lowercase());
        }
        let name = match (&r.epitech, &r.remote) {
            (Some(ep), Some(rem)) if r.name != rem.name && r.name.starts_with(&rem.name) => format!("{}{}", ep.project, &r.name[rem.name.len()..]),
            (Some(ep), _) => ep.project.clone(),
            _ => r.name.clone(),
        };
        inputs.push(analytics::RepoInput { path: r.path.clone(), name, commits: analytics::collect(dir) });
    }
    // Lines of code: only repositories you committed to, each remote counted once.
    let mut langs = std::collections::BTreeMap::new();
    let mut counted: std::collections::HashSet<String> = std::collections::HashSet::new();
    for (r, input) in repos.iter().zip(&inputs) {
        if !input.commits.iter().any(|c| emails.contains(&c.email)) {
            continue;
        }
        let key = r.remote.as_ref().map(|rem| rem.key()).unwrap_or_else(|| r.path.clone());
        if counted.insert(key) {
            analytics::count_languages(Path::new(&r.path), &mut langs);
        }
    }
    Ok(analytics::aggregate(inputs, &emails, chrono::Local::now().date_naive(), analytics::languages_vec(langs)))
}

// ───────────────────────────── Cozy Fox ─────────────────────────────

fn cozy_paths(state: &AppState) -> Result<cozy::Paths> {
    cozy::Paths::from_env(state.backups().join("cozy")).ok_or_else(|| AppError::new("cozy_missing", "HOME is not set"))
}

/// Best effort: the fox reacting to a build or a push must never make that action fail.
pub(crate) fn fox_signal(state: &AppState, command: &str) {
    let enabled = state.settings().map(|s| s.fox_signals).unwrap_or(false);
    if let (true, Ok(paths)) = (enabled, cozy_paths(state)) {
        let _ = cozy::send(&paths, command);
    }
}

#[tauri::command(async)]
pub fn cozy_status(state: State<'_, AppState>) -> Result<cozy::Status> {
    Ok(cozy::status(&cozy_paths(&state)?))
}

#[tauri::command(async)]
pub fn cozy_update(state: State<'_, AppState>, patch: Companion) -> Result<cozy::Status> {
    cozy::update(&cozy_paths(&state)?, &patch)
}

#[tauri::command(async)]
pub fn cozy_send(state: State<'_, AppState>, command: String) -> Result<()> {
    cozy::send(&cozy_paths(&state)?, &command)
}

#[tauri::command(async)]
pub fn cozy_restore(state: State<'_, AppState>, name: String) -> Result<cozy::Status> {
    cozy::restore(&cozy_paths(&state)?, &name)
}

// ───────────────────────────── startup ─────────────────────────────

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Startup {
    pub page: Option<String>,
    pub sheet: Option<String>,
    /// Design to show for this run only (preview); the saved setting is not changed.
    pub theme: Option<String>,
    /// Project to preselect on the Library, Testing and Git screens.
    pub repo: Option<String>,
}

/// `tekboard --page analytics` or `tekboard --sheet <repository path>` opens the app there.
#[tauri::command]
pub fn startup() -> Startup {
    let args: Vec<String> = std::env::args().collect();
    let value = |flag: &str| args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1)).cloned();
    Startup { page: value("--page"), sheet: value("--sheet"), repo: value("--repo"), theme: value("--theme").filter(|t| settings::THEMES.contains(&t.as_str())) }
}
