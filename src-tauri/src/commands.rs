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
    /// MY Epitech access token, in memory only.
    pub my: Mutex<crate::myepitech::Session>,
    pub my_syncing: Mutex<bool>,
}

impl AppState {
    /// A state without a window (end-to-end checks).
    pub fn for_tests(db: std::sync::Arc<Mutex<Connection>>, data_dir: PathBuf, cache_dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&data_dir);
        let _ = std::fs::create_dir_all(&cache_dir);
        AppState { db, data_dir, cache_dir, jobs: crate::jobs::Jobs::default(), my: Mutex::new(crate::myepitech::Session::default()), my_syncing: Mutex::new(false) }
    }

    pub fn conn(&self) -> MutexGuard<'_, Connection> {
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
        return Err(AppError::new("outside_roots", "Ce dossier n'est dans aucun de tes dossiers de projets (voir Réglages)."));
    }
    Ok(canon)
}

pub(crate) fn repo_dir(state: &AppState, path: &str) -> Result<PathBuf> {
    let dir = project_dir(state, path)?;
    if !git::is_repo(&dir) {
        return Err(AppError::new("not_a_repo", "Ce dossier n'est pas un dépôt git"));
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
    let saved = settings::save(&state.conn(), &settings)?;
    crate::toolenv::set_override("claude", saved.claude_path.as_deref());
    crate::claude::forget();
    Ok(saved)
}

/// Small interface preferences (sort order, filters, folded sections), kept as one JSON object.
#[tauri::command(async)]
pub fn ui_prefs_get(state: State<'_, AppState>) -> Result<serde_json::Value> {
    Ok(db::get_setting(&state.conn(), "ui_prefs")?.and_then(|v| serde_json::from_str(&v).ok()).unwrap_or_else(|| serde_json::json!({})))
}

#[tauri::command(async)]
pub fn ui_prefs_set(state: State<'_, AppState>, prefs: serde_json::Value) -> Result<()> {
    let text = prefs.to_string();
    if !prefs.is_object() || text.len() > 16 * 1024 {
        return Err(AppError::new("invalid_prefs", "Les préférences doivent être un petit objet JSON"));
    }
    db::set_setting(&state.conn(), "ui_prefs", &text)
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

/// Every repository with what TekBoard knows about it, and the MY Epitech view it was matched against.
/// Hand-in dates reported by MY Epitech are saved on the way, so every screen reads the same date.
/// A repository inside the configured folders, for code that is not a command (Artix's tools).
pub(crate) fn repo_dir_of(state: &AppState, path: &str) -> Result<PathBuf> {
    let roots = settings::load(&state.conn())?.roots;
    let p = std::fs::canonicalize(path).map_err(|_| AppError::new("not_found", format!("« {path} » n'est pas un dépôt local : clone le projet d'abord.")))?;
    if !roots.iter().filter_map(|r| std::fs::canonicalize(r).ok()).any(|r| p.starts_with(&r)) {
        return Err(AppError::new("outside_roots", "Ce dossier n'est pas dans tes dossiers de projets."));
    }
    if !p.join(".git").exists() {
        return Err(AppError::new("not_a_repo", "Ce dossier n'est pas un dépôt git."));
    }
    Ok(p)
}

/// Last scan of the repositories. The dashboard, the deadline board and the agenda all ask
/// for it at the same moment after a change: one scan serves them (a caller that arrives
/// while a scan runs waits for it), then the result is reused for a very short while.
static SCAN: Mutex<Option<(std::time::Instant, Vec<String>, Vec<RepoInfo>)>> = Mutex::new(None);
const SCAN_REUSE: std::time::Duration = std::time::Duration::from_millis(900);

/// Forgets the last scan: the next reader sees the disk as it is now.
pub(crate) fn forget_scan() {
    *SCAN.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

fn scan_shared(roots: &[String], meta: &std::collections::HashMap<String, db::RepoMeta>) -> Vec<RepoInfo> {
    let mut last = SCAN.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((at, r, repos)) = last.as_ref() {
        if at.elapsed() < SCAN_REUSE && r == roots {
            // Same git state; the stored metadata (favorite, status, notes…) is read fresh.
            return repos.iter().cloned().map(|mut x| {
                x.meta = meta.get(&x.path).cloned().unwrap_or_default();
                x
            }).collect();
        }
    }
    let repos = scanner::scan(roots, meta);
    *last = Some((std::time::Instant::now(), roots.to_vec(), repos.clone()));
    repos
}

/// The projects every screen works with: hidden ones (copies, zombies) are left out, and so
/// are personal projects when "Epitech projects only" is on.
pub(crate) fn load_repos(state: &AppState) -> Result<(Vec<RepoInfo>, crate::myview::Overview)> {
    let only_school = state.settings().map(|s| s.epitech_only).unwrap_or(true);
    let (mut repos, overview) = load_repos_all(state)?;
    if only_school {
        repos.retain(|r| r.kind == "epitech");
    }
    Ok((repos, overview))
}

/// Every project that is not hidden, personal ones included.
pub(crate) fn load_repos_all(state: &AppState) -> Result<(Vec<RepoInfo>, crate::myview::Overview)> {
    let (repos, _hidden, overview) = load_repos_split(state)?;
    Ok((repos, overview))
}

/// Shown projects, hidden ones, and the MY Epitech view matched against the shown ones only:
/// a hidden copy can neither take a MY Epitech project nor make the matching ambiguous.
pub(crate) fn load_repos_split(state: &AppState) -> Result<(Vec<RepoInfo>, Vec<RepoInfo>, crate::myview::Overview)> {
    let (s, meta) = {
        let conn = state.conn();
        (settings::load(&conn)?, db::all_meta(&conn)?)
    };
    let mut all = scan_shared(&s.roots, &meta);
    crate::projects::mark_duplicates(&mut all);
    let (mut repos, hidden): (Vec<RepoInfo>, Vec<RepoInfo>) = all.into_iter().partition(|r| r.meta.visibility.as_deref() != Some("hidden"));
    let now = chrono::Utc::now();
    let conn = state.conn();
    let mut overview = crate::myview::overview_at(&conn, &repos, now);
    if crate::projects::apply_my_deadlines(&conn, &overview, None)? > 0 {
        let meta = db::all_meta(&conn)?;
        for r in repos.iter_mut() {
            r.meta = meta.get(&r.path).cloned().unwrap_or_default();
        }
        overview = crate::myview::overview_at(&conn, &repos, now);
    }
    crate::projects::enrich(&mut repos, &overview, &crate::myview::known_orgs(&conn), &s.epitech_dirs, now);
    // What was planned for a MY Epitech project before it was cloned follows the repository.
    let links: Vec<(i64, String)> = repos.iter().filter_map(|r| r.my.as_ref().map(|m| (m.id, r.path.clone()))).collect();
    if crate::planner::rekey(&conn, &links)? > 0 {
        crate::notify::changed(&["plan"]);
    }
    Ok((repos, hidden, overview))
}

/// Links subjects to repositories (see `subjects::associate`) and returns what needs the user.
pub(crate) fn associate_subjects(state: &AppState) -> Result<crate::subjects::Association> {
    let (repos, _, overview) = load_repos_split(state)?;
    // Copies are not candidates: the folder kept is.
    let candidates: Vec<crate::subjects::Candidate> = repos
        .iter()
        .filter(|r| r.duplicate_of.is_none())
        .map(|r| {
            let mut names: Vec<&str> = vec![r.name.as_str()];
            if let Some(e) = &r.epitech {
                names.push(e.project.as_str());
            }
            if let Some(m) = &r.my {
                names.push(m.name.as_str());
            }
            if let Some(rem) = &r.remote {
                names.push(rem.name.as_str());
            }
            crate::subjects::Candidate { path: r.path.as_str(), names, module: r.my.as_ref().map(|m| m.unit_code.as_str()).or(r.epitech.as_ref().map(|e| e.module.as_str())) }
        })
        .collect();
    let my_repo_of = |id: i64| overview.projects.iter().find(|p| p.id == id).and_then(|p| p.repo_path.clone());
    let a = crate::subjects::associate(&state.conn(), &candidates, &my_repo_of)?;
    if a.linked > 0 {
        let _ = db::log_activity(&state.conn(), now(), "subjects_linked", None, Some(&format!("{} linked automatically", a.linked)));
        crate::notify::changed(&["subjects"]);
    }
    Ok(a)
}

/// Runs the association and returns the links waiting for the user's decision.
#[tauri::command(async)]
pub fn subjects_associate(state: State<'_, AppState>) -> Result<crate::subjects::Association> {
    associate_subjects(&state)
}

/// Accepts (`accept`) or refuses a suggested link.
#[tauri::command(async)]
pub fn subject_suggestion_decide(state: State<'_, AppState>, id: i64, repo_path: String, accept: bool) -> Result<()> {
    let dir = repo_dir(&state, &repo_path)?.to_string_lossy().into_owned();
    if accept {
        db::link_subject_by_hand(&state.conn(), id, Some(&dir))
    } else {
        db::reject_subject_link(&state.conn(), id, &dir)
    }
}

/// Hides, archives or shows again a project. Only TekBoard's view changes: the folder stays.
#[tauri::command(async)]
pub fn project_set_visibility(state: State<'_, AppState>, path: String, visibility: Option<String>) -> Result<()> {
    if let Some(v) = &visibility {
        if !db::VISIBILITIES.contains(&v.as_str()) {
            return Err(AppError::new("invalid_visibility", format!("Visibilité inconnue « {v} »")));
        }
    }
    let dir = repo_dir(&state, &path)?;
    db::set_visibility(&state.conn(), &dir.to_string_lossy(), visibility.as_deref())?;
    crate::notify::changed(&["repos", "plan", "subjects"]);
    Ok(())
}

/// Hidden projects, to show them again.
#[tauri::command(async)]
pub fn hidden_repos(state: State<'_, AppState>) -> Result<Vec<RepoInfo>> {
    Ok(load_repos_split(&state)?.1)
}

#[tauri::command(async)]
pub fn scan_repos(state: State<'_, AppState>) -> Result<Vec<RepoInfo>> {
    // Personal projects included: the window applies "Epitech projects only" itself, so they
    // stay reachable from the project list.
    Ok(load_repos_all(&state)?.0)
}

/// Unfinished work and its hand-in state, MY Epitech projects not cloned yet included.
#[tauri::command(async)]
pub fn deadline_board(state: State<'_, AppState>) -> Result<Vec<crate::projects::BoardItem>> {
    let (repos, overview) = load_repos(&state)?;
    Ok(crate::projects::board(&repos, &overview, chrono::Utc::now()))
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
        return Err(AppError::new("outside_roots", "Ce dossier n'est pas géré par TekBoard"));
    }
    workspace::reveal(&canon)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedRemote {
    pub url: String,
    /// `firefox`, or `default` when Firefox is not installed and the system browser was used.
    pub browser: &'static str,
}

/// Opens the repository's page on its host, in Firefox. The address comes from the real git remote.
#[tauri::command(async)]
pub fn open_remote(state: State<'_, AppState>, path: String) -> Result<OpenedRemote> {
    let dir = repo_dir(&state, &path)?;
    let remote = git::any_remote_url(&dir).ok_or_else(|| AppError::new("no_remote", "Ce dépôt n'a pas de dépôt distant : rien à ouvrir. Ajoutes-en un avec `git remote add origin <url>`."))?;
    let url = git::web_url(&remote, git::ssh_hostname).ok_or_else(|| AppError::new("no_web_remote", format!("Le dépôt distant « {remote} » n'est pas une adresse web que TekBoard peut ouvrir (un chemin local, ou un alias SSH inconnu de ssh).")))?;
    let browser = match crate::toolenv::which("firefox") {
        Some(firefox) => {
            workspace::spawn_detached(&[firefox.to_string_lossy().into_owned(), "--new-tab".into(), url.clone()], &dir)?;
            "firefox"
        }
        None => {
            workspace::spawn_detached(&["xdg-open".to_string(), url.clone()], &dir).map_err(|e| AppError::new("no_browser", format!("Firefox n'est pas installé et le navigateur par défaut n'a pas pu démarrer : {e}")))?;
            "default"
        }
    };
    Ok(OpenedRemote { url, browser })
}

/// Which program "Launch Binary" would start for this project.
#[tauri::command(async)]
pub fn project_run_info(state: State<'_, AppState>, path: String) -> Result<crate::runner::BinaryInfo> {
    let dir = repo_dir(&state, &path)?;
    let sheet = db::get_sheet(&state.conn(), &dir.to_string_lossy())?;
    Ok(crate::runner::info(&dir, sheet.run_bin.as_deref(), sheet.run_args.as_deref(), &state.settings()?.terminal_run_cmd))
}

/// Starts the project's program in a terminal window. Returns at once; the program belongs to that window.
#[tauri::command(async)]
pub fn project_launch(state: State<'_, AppState>, path: String) -> Result<String> {
    let dir = repo_dir(&state, &path)?;
    let sheet = db::get_sheet(&state.conn(), &dir.to_string_lossy())?;
    let terminal = state.settings()?.terminal_run_cmd;
    let bin = sheet.run_bin.clone().or_else(|| crate::runner::detect(&dir).map(|(n, _)| n)).ok_or_else(|| AppError::new("binary_unknown", "TekBoard ne sait pas quel programme ce projet compile (pas de NAME simple dans le Makefile, pas d'exécutable à la racine). Indique le binaire dans la fiche du projet."))?;
    crate::runner::launch(&terminal, &dir, &bin, sheet.run_args.as_deref())?;
    db::log_activity(&state.conn(), now(), "launch", Some(&dir.to_string_lossy()), Some(&bin))?;
    Ok(bin)
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
    let (local, overview) = load_repos(&state)?;
    let ranked = launcher::rank(remote, &LocalContext::from_repos(&local), chrono::Utc::now());
    // Projects MY Epitech expects and that are not cloned yet come first.
    let day = |iso: &Option<String>| iso.as_deref().and_then(crate::myview::local_day).unwrap_or_default();
    let expected: Vec<launcher::Expected> = overview
        .projects
        .iter()
        .filter(|p| p.repo_path.is_none() && (p.ongoing || p.upcoming) && p.repo_enabled != Some(false))
        .map(|p| launcher::Expected { name: p.name.clone(), unit_code: p.unit_code.clone(), when: if p.upcoming { format!("starts {}", day(&p.start)) } else { format!("hand-in {}", day(&p.end)) } })
        .collect();
    Ok(launcher::prefer_expected(ranked, &expected))
}

#[tauri::command(async)]
pub fn clone_project(state: State<'_, AppState>, url: String, parent: String) -> Result<CloneOutcome> {
    crate::commands::forget_scan();
    let parent = project_dir(&state, &parent)?;
    // Already cloned somewhere in the project folders: that copy is used, nothing is cloned again.
    if let Some(wanted) = epitech::parse_remote(url.trim()) {
        if let Ok((repos, _)) = load_repos(&state) {
            if let Some(r) = repos.iter().find(|r| r.duplicate_of.is_none() && r.remote.as_ref().is_some_and(|x| x.key() == wanted.key())) {
                return Ok(CloneOutcome { path: r.path.clone(), already_present: true });
            }
        }
    }
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
    let t = templates::list(&state.templates())?.into_iter().find(|t| t.id == id).ok_or_else(|| AppError::new("invalid_template", "Modèle inconnu"))?;
    workspace::launch(&state.settings()?.ide_cmd, Path::new(&t.path))
}

#[tauri::command(async)]
pub fn template_plan(state: State<'_, AppState>, id: String, target: String, vars: Vars) -> Result<Vec<PlanEntry>> {
    let dir = project_dir(&state, &target)?;
    templates::plan(&state.templates(), &id, &dir, &vars)
}

#[tauri::command(async)]
pub fn template_apply(state: State<'_, AppState>, id: String, target: String, vars: Vars, selected: Vec<String>, overwrite: Vec<String>) -> Result<ApplyReport> {
    crate::commands::forget_scan();
    let dir = project_dir(&state, &target)?;
    let report = templates::apply(&state.templates(), &id, &dir, &vars, &selected, &overwrite, &state.backups())?;
    db::log_activity(&state.conn(), now(), "template_apply", Some(&dir.to_string_lossy()), Some(&id))?;
    Ok(report)
}

// ───────────────────────────── first commit ─────────────────────────────

/// Stages exactly the given files. Nothing is committed or pushed.
#[tauri::command(async)]
pub fn stage_files(state: State<'_, AppState>, repo: String, files: Vec<String>) -> Result<RepoStatus> {
    crate::commands::forget_scan();
    let dir = repo_dir(&state, &repo)?;
    for f in &files {
        if templates::safe_rel(f).is_none() {
            return Err(AppError::new("invalid_path", format!("Chemin de fichier invalide : {f}")));
        }
    }
    git::add(&dir, &files)?;
    git::status(&dir)
}

/// Commits what is staged. Never pushes.
#[tauri::command(async)]
pub fn commit_staged(state: State<'_, AppState>, repo: String, message: String) -> Result<RepoStatus> {
    crate::commands::forget_scan();
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

/// What the sheet sends back. The date is a local day, optionally with a local `HH:MM`.
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SheetInput {
    pub deadline: Option<String>,
    pub deadline_time: Option<String>,
    pub build_cmd: Option<String>,
    pub notes: String,
    pub run_bin: Option<String>,
    pub run_args: Option<String>,
}

fn same_instant(a: Option<&str>, b: Option<&str>) -> bool {
    let ts = |v: Option<&str>| v.and_then(|x| chrono::DateTime::parse_from_rfc3339(x).ok()).map(|d| d.timestamp());
    ts(a) == ts(b)
}

#[tauri::command(async)]
pub fn project_save(state: State<'_, AppState>, path: String, sheet: SheetInput) -> Result<ProjectSheet> {
    let dir = repo_dir(&state, &path)?;
    let key = dir.to_string_lossy().into_owned();
    let conn = state.conn();
    let cur = db::get_sheet(&conn, &key)?;
    let clean = |v: Option<String>| v.map(|c| c.trim().to_string()).filter(|c| !c.is_empty());
    let mut next = ProjectSheet { build_cmd: clean(sheet.build_cmd), notes: sheet.notes, run_bin: clean(sheet.run_bin), run_args: clean(sheet.run_args), ..cur.clone() };
    match clean(sheet.deadline) {
        // Clearing the date also forgets where it came from: MY Epitech may fill it again.
        None => {
            next.deadline = None;
            next.deadline_at = None;
            next.deadline_source = None;
        }
        Some(day) => {
            let due = crate::deadlines::from_input(&day, sheet.deadline_time.as_deref())?;
            // Only a date the user actually changed becomes "typed by hand".
            if cur.deadline.as_deref() != Some(due.day.as_str()) || !same_instant(cur.deadline_at.as_deref(), due.at.as_deref()) {
                next.deadline = Some(due.day);
                next.deadline_at = due.at;
                next.deadline_source = Some("manual".into());
            }
        }
    }
    if let Some(bin) = &next.run_bin {
        if templates::safe_rel(bin).is_none() {
            return Err(AppError::new("invalid_path", "Le binaire doit être un chemin dans le dossier du projet (par exemple `my_hunter` ou `build/app`)"));
        }
    }
    if let Some(args) = &next.run_args {
        crate::jobs::split_command(&format!("x {args}"))?;
    }
    db::save_sheet(&conn, &key, &next)?;
    Ok(next)
}

/// `todo`, `in_progress` or `done`. Applied at once, in both directions: a project marked
/// done by mistake goes back to work with its deadline and notes untouched.
#[tauri::command(async)]
pub fn project_set_status(state: State<'_, AppState>, path: String, status: String) -> Result<()> {
    let dir = repo_dir(&state, &path)?;
    if !db::STATUSES.contains(&status.as_str()) {
        return Err(AppError::new("invalid_status", "Statut inconnu"));
    }
    let conn = state.conn();
    db::set_status(&conn, &dir.to_string_lossy(), &status)?;
    db::log_activity(&conn, now(), "status", Some(&dir.to_string_lossy()), Some(&status))
}

/// `epitech`, `personal`, or nothing to let TekBoard decide again.
#[tauri::command(async)]
pub fn project_set_kind(state: State<'_, AppState>, path: String, kind: Option<String>) -> Result<()> {
    let dir = repo_dir(&state, &path)?;
    if kind.as_deref().is_some_and(|k| k != "epitech" && k != "personal") {
        return Err(AppError::new("invalid_kind", "Classement inconnu"));
    }
    db::set_kind_override(&state.conn(), &dir.to_string_lossy(), kind.as_deref())
}

/// Ties this repository to a MY Epitech project chosen by hand (or unties it).
#[tauri::command(async)]
pub fn project_set_my(state: State<'_, AppState>, path: String, project_id: Option<i64>) -> Result<()> {
    let dir = repo_dir(&state, &path)?;
    let conn = state.conn();
    if let Some(id) = project_id {
        // One repository per project: the previous holder of that project is released.
        conn.execute("UPDATE repo_meta SET my_project_id = NULL WHERE my_project_id = ?1", [id])?;
    }
    db::set_my_project(&conn, &dir.to_string_lossy(), project_id)
}

/// Drops a hand-typed date so that the MY Epitech one applies again (at the next listing).
#[tauri::command(async)]
pub fn project_deadline_from_my(state: State<'_, AppState>, path: String) -> Result<()> {
    let dir = repo_dir(&state, &path)?;
    db::set_deadline(&state.conn(), &dir.to_string_lossy(), None, None, None)
}

/// Runs the project's build command (default `make`) and returns its output.
#[tauri::command(async)]
pub fn project_build(state: State<'_, AppState>, path: String) -> Result<RunReport> {
    crate::commands::forget_scan();
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
        None => app.path().download_dir().map_err(|_| AppError::new("no_downloads", "Le dossier Téléchargements est introuvable"))?,
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
        // A project picked in the import list is the user's choice.
        if let (Ok(o), Some(r)) = (&res, &repo) {
            if o.subject.repo_path.as_deref() == Some(r.as_str()) {
                let _ = db::link_subject_by_hand(&state.conn(), o.subject.id, Some(r));
            }
        }
        out.push(match res {
            Ok(o) => SubjectImportResult { path: item.path, subject: Some(o.subject), duplicate: o.duplicate, error: None },
            Err(e) => SubjectImportResult { path: item.path, subject: None, duplicate: false, error: Some(e.to_string()) },
        });
    }
    let added = out.iter().filter(|r| r.subject.is_some() && !r.duplicate).count();
    if added > 0 {
        db::log_activity(&state.conn(), now(), "subjects_import", None, Some(&format!("{added} document{}", if added == 1 { "" } else { "s" })))?;
        // Documents imported without a project are matched right away.
        let _ = associate_subjects(&state);
    }
    Ok(out)
}

#[tauri::command(async)]
pub fn subject_link(state: State<'_, AppState>, id: i64, repo_path: Option<String>) -> Result<()> {
    let repo = match repo_path {
        Some(p) => Some(repo_dir(&state, &p)?.to_string_lossy().into_owned()),
        None => None,
    };
    db::link_subject_by_hand(&state.conn(), id, repo.as_deref())
}

/// Deletes TekBoard's copy only.
#[tauri::command(async)]
pub fn subject_remove(state: State<'_, AppState>, id: i64) -> Result<()> {
    subjects::remove(&state.conn(), &state.subjects(), id)
}

#[tauri::command(async)]
pub fn subject_open(state: State<'_, AppState>, id: i64) -> Result<()> {
    let subject = db::get_subject(&state.conn(), id)?.ok_or_else(|| AppError::new("not_found", "Sujet inconnu"))?;
    let path = subjects::file_path(&state.subjects(), &subject);
    if !path.is_file() {
        return Err(AppError::new("not_found", "Le fichier manque dans la bibliothèque"));
    }
    workspace::reveal(&path)
}

// ───────────────────────────── git ─────────────────────────────

fn rel_files(files: &[String]) -> Result<()> {
    for f in files {
        if templates::safe_rel(f).is_none() {
            return Err(AppError::new("invalid_path", format!("Chemin de fichier invalide : {f}")));
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
    crate::commands::forget_scan();
    let dir = repo_dir(&state, &repo)?;
    rel_files(&files)?;
    git::unstage(&dir, &files)
}

/// `op` is `fetch`, `pull` (fast-forward only) or `push` (never forced).
#[tauri::command(async)]
pub fn git_sync(state: State<'_, AppState>, repo: String, op: String) -> Result<String> {
    crate::commands::forget_scan();
    let dir = repo_dir(&state, &repo)?;
    let kind = match op.as_str() {
        "fetch" => git::Sync::Fetch,
        "pull" => git::Sync::Pull,
        "push" => git::Sync::Push,
        _ => return Err(AppError::new("invalid_op", "Opération inconnue")),
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
    crate::commands::forget_scan();
    let dir = repo_dir(&state, &repo)?;
    git::create_branch(&dir, &name)?;
    db::log_activity(&state.conn(), now(), "branch", Some(&dir.to_string_lossy()), Some(name.trim()))
}

#[tauri::command(async)]
pub fn git_switch_branch(state: State<'_, AppState>, repo: String, name: String) -> Result<()> {
    crate::commands::forget_scan();
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
    cozy::Paths::from_env(state.backups().join("cozy")).ok_or_else(|| AppError::new("cozy_missing", "HOME n'est pas défini"))
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
    /// Library files to tick at startup, comma separated (with `--page library --repo …`).
    pub pick: Option<String>,
    /// `package` or `readme`: opens that tool on `--repo`.
    pub tool: Option<String>,
    /// Starts a check on `--repo`: `tests`, `banana`, `testrepo`, `testrepo-remote`, `moulinette`.
    pub run: Option<String>,
    /// Opens a finished report of the history on the Testing screen.
    pub report: Option<i64>,
    /// Id of a section of the page to scroll to (`--anchor academic`).
    pub anchor: Option<String>,
}

/// `tekboard --page analytics` or `tekboard --sheet <repository path>` opens the app there.
#[tauri::command]
pub fn startup() -> Startup {
    let args: Vec<String> = std::env::args().collect();
    let value = |flag: &str| args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1)).cloned();
    Startup { page: value("--page"), sheet: value("--sheet"), repo: value("--repo"), pick: value("--pick"), tool: value("--tool"), run: value("--run"), report: value("--report").and_then(|v| v.parse().ok()), anchor: value("--anchor").filter(|a| a.len() <= 40 && a.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')), theme: value("--theme").filter(|t| settings::THEMES.contains(&t.as_str())) }
}
