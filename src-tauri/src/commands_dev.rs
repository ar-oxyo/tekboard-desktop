//! Commands for long checks (tests, clean clone, Banana, pre-check), AI packaging and README.

use crate::checker::{self, CheckerInfo};
use crate::claude::{self, ClaudeInfo};
use crate::commands::{project_dir, repo_dir, AppState};
use crate::db::{self, Run};
use crate::error::{AppError, Result};
use crate::jobs::{argv_of, JobView};
use crate::moulinette;
use crate::packager::{self, Package, Preview};
use crate::readme::{self, Draft};
use crate::settings;
use crate::subjects;
use crate::testing::{self, Detection};
use crate::testrepo::{self, TestEnv};
use crate::workspace;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::State;

// ───────────────────────────── per-project commands ─────────────────────────────

/// Commands the user set for one project. Empty fields fall back to what is detected.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProjectConfig {
    pub test_cmd: Option<String>,
    /// Program and arguments, used by the memory check.
    pub run_cmd: Option<String>,
    pub image: Option<String>,
}

fn config_key(dir: &Path) -> String {
    format!("projcfg|{}", dir.display())
}

fn load_config(state: &AppState, dir: &Path) -> Result<ProjectConfig> {
    Ok(db::get_setting(&state.conn(), &config_key(dir))?.and_then(|v| serde_json::from_str(&v).ok()).unwrap_or_default())
}

#[tauri::command(async)]
pub fn project_config_get(state: State<'_, AppState>, repo: String) -> Result<ProjectConfig> {
    load_config(&state, &project_dir(&state, &repo)?)
}

#[tauri::command(async)]
pub fn project_config_set(state: State<'_, AppState>, repo: String, config: ProjectConfig) -> Result<ProjectConfig> {
    let dir = project_dir(&state, &repo)?;
    let clean = |v: Option<String>| v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let config = ProjectConfig { test_cmd: clean(config.test_cmd), run_cmd: clean(config.run_cmd), image: clean(config.image) };
    for cmd in [&config.test_cmd, &config.run_cmd].into_iter().flatten() {
        argv_of(cmd)?;
    }
    if config.image.as_deref().is_some_and(|i| !testrepo::valid_image(i)) {
        return Err(AppError::new("invalid_image", "This container image name is not valid"));
    }
    db::set_setting(&state.conn(), &config_key(&dir), &serde_json::to_string(&config)?)?;
    Ok(config)
}

// ───────────────────────────── jobs and history ─────────────────────────────

#[tauri::command(async)]
pub fn job_get(state: State<'_, AppState>, id: u64) -> Result<JobView> {
    state.jobs.get(id).ok_or_else(|| AppError::new("unknown_job", "This task is no longer in memory; see the history."))
}

#[tauri::command(async)]
pub fn job_cancel(state: State<'_, AppState>, id: u64) -> Result<()> {
    state.jobs.cancel(id);
    Ok(())
}

#[tauri::command(async)]
pub fn runs_list(state: State<'_, AppState>, repo: Option<String>, kind: Option<String>, limit: u32) -> Result<Vec<Run>> {
    db::list_runs(&state.conn(), repo.as_deref(), kind.as_deref(), limit.min(200))
}

#[tauri::command(async)]
pub fn run_get(state: State<'_, AppState>, id: i64) -> Result<Run> {
    db::get_run(&state.conn(), id)?.ok_or_else(|| AppError::new("unknown_run", "This report no longer exists"))
}

fn title_for(dir: &Path, what: &str) -> String {
    format!("{} — {what}", dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default())
}

// ───────────────────────────── testing center ─────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestingInfo {
    pub detection: Detection,
    pub config: ProjectConfig,
    pub default_build: String,
    pub claude: ClaudeInfo,
    pub banana: CheckerInfo,
    pub docker: bool,
    pub valgrind: bool,
    pub default_image: &'static str,
    /// File name of the subject linked to this project.
    pub subject: Option<String>,
    pub has_remote: bool,
}

fn linked_subject(state: &AppState, dir: &Path) -> Result<Option<(String, PathBuf)>> {
    let key = dir.to_string_lossy();
    let all = db::list_subjects(&state.conn())?;
    Ok(all.into_iter().find(|s| s.repo_path.as_deref() == Some(key.as_ref())).map(|s| (s.name.clone(), subjects::file_path(&state.subjects(), &s))))
}

#[tauri::command(async)]
pub fn testing_info(state: State<'_, AppState>, repo: String) -> Result<TestingInfo> {
    let dir = repo_dir(&state, &repo)?;
    let default_build = db::get_sheet(&state.conn(), &dir.to_string_lossy())?.build_cmd.unwrap_or_else(|| "make".into());
    Ok(TestingInfo {
        detection: testing::detect(&dir),
        config: load_config(&state, &dir)?,
        default_build,
        claude: claude::detect(),
        banana: checker::detect(),
        docker: settings::which("docker").is_some(),
        valgrind: settings::which("valgrind").is_some(),
        default_image: testrepo::DEFAULT_IMAGE,
        subject: linked_subject(&state, &dir)?.map(|(n, _)| n),
        has_remote: crate::git::origin_url(&dir).is_some(),
    })
}

/// Runs a test command. It must be one the repository declares, or the one saved for the
/// project; a script from the repository also needs `acknowledged`.
#[tauri::command(async)]
pub fn tests_run(state: State<'_, AppState>, repo: String, command: String, acknowledged: bool) -> Result<u64> {
    let dir = repo_dir(&state, &repo)?;
    let key = dir.to_string_lossy().into_owned();
    if let Some(id) = state.jobs.active("tests", Some(&key)) {
        return Ok(id);
    }
    let command = command.trim().to_string();
    let detection = testing::detect(&dir);
    let saved = load_config(&state, &dir)?.test_cmd;
    match detection.suites.iter().find(|s| s.command == command) {
        Some(s) if !s.trusted && !acknowledged => return Err(AppError::new("needs_confirmation", "This is a script from the repository: confirm that you read it before running it.")),
        Some(_) => {}
        None if saved.as_deref() == Some(command.as_str()) => {}
        None => return Err(AppError::new("unknown_command", "This command is neither declared by the repository nor saved for this project.")),
    }
    argv_of(&command)?;
    let title = title_for(&dir, &command);
    Ok(state.jobs.start(state.db.clone(), "tests", Some(key), title, &[("run", "Running the tests"), ("results", "Reading the results")], move |job| {
        let (status, _) = testing::run_in_job(job, &dir, &command, Duration::from_secs(900))?;
        Ok(status)
    }))
}

#[tauri::command(async)]
pub fn banana_run(state: State<'_, AppState>, repo: String) -> Result<u64> {
    let dir = repo_dir(&state, &repo)?;
    let key = dir.to_string_lossy().into_owned();
    if let Some(id) = state.jobs.active("banana", Some(&key)) {
        return Ok(id);
    }
    let title = title_for(&dir, "Banana");
    Ok(state.jobs.start(state.db.clone(), "banana", Some(key), title, checker::STEPS, move |job| checker::run(job, &dir)))
}

// ───────────────────────────── TestRepo ─────────────────────────────

fn env_root(state: &AppState) -> PathBuf {
    state.cache_dir.join("testrepo")
}

#[tauri::command(async)]
pub fn testrepo_start(state: State<'_, AppState>, repo: String, params: testrepo::Params) -> Result<u64> {
    let dir = repo_dir(&state, &repo)?;
    let key = dir.to_string_lossy().into_owned();
    if let Some(id) = state.jobs.active("testrepo", Some(&key)) {
        return Ok(id);
    }
    argv_of(&params.build)?;
    let root = env_root(&state);
    let title = title_for(&dir, if params.mode == "remote" { "TestRepo (remote clone)" } else { "TestRepo (local snapshot)" });
    Ok(state.jobs.start(state.db.clone(), "testrepo", Some(key), title, testrepo::STEPS, move |job| testrepo::run(job, &dir, &params, &root)))
}

#[tauri::command(async)]
pub fn testrepo_envs(state: State<'_, AppState>) -> Vec<TestEnv> {
    testrepo::list_envs(&env_root(&state))
}

/// Deletes one test environment. The UI asks for confirmation first; only folders TekBoard created can be named.
#[tauri::command(async)]
pub fn testrepo_env_delete(state: State<'_, AppState>, name: String) -> Result<()> {
    testrepo::delete_env(&env_root(&state), &name)
}

#[tauri::command(async)]
pub fn testrepo_env_open(state: State<'_, AppState>, name: String, terminal: bool) -> Result<()> {
    let path = testrepo::env_path(&env_root(&state), &name)?;
    if terminal {
        workspace::launch(&state.settings()?.terminal_cmd, &path)
    } else {
        workspace::reveal(&path)
    }
}

// ───────────────────────────── pre-check and Claude Code ─────────────────────────────

#[tauri::command(async)]
pub fn moulinette_start(state: State<'_, AppState>, repo: String, params: moulinette::Params) -> Result<u64> {
    let dir = repo_dir(&state, &repo)?;
    let key = dir.to_string_lossy().into_owned();
    if let Some(id) = state.jobs.active("moulinette", Some(&key)) {
        return Ok(id);
    }
    argv_of(&params.build)?;
    let subject = if params.subject_ai { linked_subject(&state, &dir)?.map(|(_, p)| p) } else { None };
    let title = title_for(&dir, "Claude Moulinette");
    Ok(state.jobs.start(state.db.clone(), "moulinette", Some(key), title, moulinette::STEPS, move |job| moulinette::run(job, &dir, &params, subject)))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeBrief {
    pub plan: claude::Plan,
    /// The instructions Claude Code will receive, word for word.
    pub prompt: String,
}

/// What a Claude Code run would do, shown before the user starts it. `task`: `tests`, `readme`, `subject`.
#[tauri::command(async)]
pub fn claude_brief(state: State<'_, AppState>, repo: String, task: String, disclosure: bool) -> Result<ClaudeBrief> {
    let dir = repo_dir(&state, &repo)?;
    match task.as_str() {
        "tests" => {
            let d = testing::detect(&dir);
            let has_rule = d.suites.iter().any(|s| s.trusted);
            Ok(ClaudeBrief { plan: claude::plan(&["tests"]), prompt: moulinette::tests_prompt(&d, has_rule) })
        }
        "readme" => {
            let subject = linked_subject(&state, &dir)?;
            let draft = readme::draft(&dir, &readme::Facts { subject: subject.as_ref().map(|(n, _)| n.as_str()), ai_disclosure: disclosure });
            Ok(ClaudeBrief { plan: claude::plan(&[]), prompt: readme::ai_prompt(&draft.proposed, disclosure) })
        }
        "subject" => Ok(ClaudeBrief { plan: claude::plan(&[]), prompt: moulinette::subject_prompt("<the text of the linked subject PDF>") }),
        _ => Err(AppError::new("invalid_mode", "Unknown task")),
    }
}

#[tauri::command(async)]
pub fn gen_tests_start(state: State<'_, AppState>, repo: String) -> Result<u64> {
    let dir = repo_dir(&state, &repo)?;
    let key = dir.to_string_lossy().into_owned();
    if let Some(id) = state.jobs.active("gen_tests", Some(&key)) {
        return Ok(id);
    }
    let title = title_for(&dir, "Generate tests with Claude");
    Ok(state.jobs.start(state.db.clone(), "gen_tests", Some(key), title, moulinette::GEN_STEPS, move |job| moulinette::generate_tests(job, &dir)))
}

// ───────────────────────────── package for AI ─────────────────────────────

fn packages_dir(state: &AppState) -> PathBuf {
    state.data_dir.join("packages")
}

#[tauri::command(async)]
pub fn package_preview(state: State<'_, AppState>, repo: String, options: packager::Options) -> Result<Preview> {
    packager::preview(&project_dir(&state, &repo)?, &options)
}

#[tauri::command(async)]
pub fn package_create(state: State<'_, AppState>, repo: String, options: packager::Options) -> Result<Package> {
    let dir = project_dir(&state, &repo)?;
    let key = dir.to_string_lossy().into_owned();
    let mut last: Vec<(String, String, String)> = Vec::new();
    for kind in ["build", "tests", "testrepo"] {
        if let Some(r) = db::list_runs(&state.conn(), Some(&key), Some(kind), 1)?.into_iter().next() {
            last.push((kind.to_string(), r.status, r.title));
        }
    }
    let pkg = packager::create(&dir, &options, &packages_dir(&state), &last)?;
    db::log_activity(&state.conn(), crate::commands::now(), "package", Some(&key), Some(&format!("{} files", pkg.files)))?;
    Ok(pkg)
}

#[tauri::command(async)]
pub fn package_reveal(state: State<'_, AppState>) -> Result<()> {
    let dir = packages_dir(&state);
    std::fs::create_dir_all(&dir)?;
    workspace::reveal(&dir)
}

// ───────────────────────────── README ─────────────────────────────

#[tauri::command(async)]
pub fn readme_draft(state: State<'_, AppState>, repo: String, disclosure: bool) -> Result<Draft> {
    let dir = repo_dir(&state, &repo)?;
    let subject = linked_subject(&state, &dir)?;
    Ok(readme::draft(&dir, &readme::Facts { subject: subject.as_ref().map(|(n, _)| n.as_str()), ai_disclosure: disclosure }))
}

#[tauri::command(async)]
pub fn readme_diff(state: State<'_, AppState>, repo: String, text: String) -> Result<String> {
    Ok(readme::diff_against_current(&repo_dir(&state, &repo)?, &text))
}

/// Writes README.md after the user validated the text. Returns where the previous version was saved.
#[tauri::command(async)]
pub fn readme_write(state: State<'_, AppState>, repo: String, content: String, expected_hash: Option<String>) -> Result<Option<String>> {
    let dir = repo_dir(&state, &repo)?;
    let saved = readme::write(&dir, &content, expected_hash.as_deref(), &state.backups())?;
    db::log_activity(&state.conn(), crate::commands::now(), "readme", Some(&dir.to_string_lossy()), None)?;
    Ok(saved)
}

/// Asks Claude Code (read-only) for a README. The text lands in the job summary; nothing is written.
#[tauri::command(async)]
pub fn readme_ai_start(state: State<'_, AppState>, repo: String, disclosure: bool) -> Result<u64> {
    let dir = repo_dir(&state, &repo)?;
    let key = dir.to_string_lossy().into_owned();
    if let Some(id) = state.jobs.active("readme", Some(&key)) {
        return Ok(id);
    }
    let subject = linked_subject(&state, &dir)?;
    let draft = readme::draft(&dir, &readme::Facts { subject: subject.as_ref().map(|(n, _)| n.as_str()), ai_disclosure: disclosure });
    let prompt = readme::ai_prompt(&draft.proposed, disclosure);
    let title = title_for(&dir, "README with Claude");
    Ok(state.jobs.start(state.db.clone(), "readme", Some(key), title, &[("claude", "Claude Code reads the project")], move |job| {
        job.start("claude");
        let (o, answer) = claude::run(job, &dir, &prompt, &[], Duration::from_secs(900))?;
        if o.cancelled {
            return Ok("cancelled");
        }
        match answer {
            Ok(a) => {
                job.set("readme", format!("{}\n", claude::fenced(&a.text, "markdown").trim_end()));
                job.set("costUsd", a.cost_usd);
                job.end("claude", "success", Some("proposal ready: review it before writing".to_string()));
                Ok("success")
            }
            Err(e) => {
                job.end("claude", "failed", Some(e.to_string()));
                Ok("failed")
            }
        }
    }))
}
