//! Commands for long checks (tests, clean clone, Banana, pre-check), AI packaging and README.

use crate::checker::{self, CheckerInfo};
use crate::claude::{self, ClaudeInfo};
use crate::commands::{project_dir, repo_dir, AppState};
use crate::db::{self, Run};
use crate::error::{AppError, Result};
use crate::jobs::{argv_of, JobView};
use crate::moulinette;
use crate::packager::{self, Package, Preview};
use crate::prompts;
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
pub fn job_get(state: State<'_, AppState>, id: u64, log_from: Option<usize>, events_from: Option<usize>) -> Result<JobView> {
    let view = match (log_from, events_from) {
        (None, None) => state.jobs.get(id),
        (l, e) => state.jobs.get_since(id, l.unwrap_or(0), e.unwrap_or(0)),
    };
    view.ok_or_else(|| AppError::new("unknown_job", "Cette tâche n'est plus en mémoire : consulte l'historique."))
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

// ───────────────────────────── quick commands ─────────────────────────────

const QUICK_HISTORY: u32 = 15;

/// Runs one command typed or picked by the user in the repository folder: a program and its
/// arguments, started without a shell, with a live log, an exit code and a Stop button.
/// Reachable only from TekBoard's own window, on an explicit click; nothing read from a
/// repository, a document or MY Epitech is ever passed here.
#[tauri::command(async)]
pub fn quick_run(state: State<'_, AppState>, repo: String, command: String) -> Result<u64> {
    let dir = repo_dir(&state, &repo)?;
    let key = dir.to_string_lossy().into_owned();
    let command = command.trim().to_string();
    if command.len() > 2000 {
        return Err(AppError::new("invalid_command", "This command is too long"));
    }
    let argv = crate::jobs::split_command(&command)?;
    if state.jobs.active("command", Some(&key)).is_some() {
        return Err(AppError::new("busy", "A command is already running in this repository. Stop it first."));
    }
    db::remember_command(&state.conn(), &key, &command, crate::commands::now(), QUICK_HISTORY)?;
    let title = title_for(&dir, &command);
    let shown = command.clone();
    Ok(state.jobs.start(state.db.clone(), "command", Some(key), title, &[("run", "Running the command")], move |job| {
        job.start("run");
        job.set("command", &shown);
        let o = match job.run(&argv, &dir, Duration::from_secs(1800), &[]) {
            Ok(o) => o,
            Err(e) => {
                job.set("exitCode", Option::<i32>::None);
                job.end("run", "failed", Some(e.to_string()));
                return Err(e);
            }
        };
        job.set("exitCode", o.code);
        job.set("timedOut", o.timed_out);
        if o.cancelled {
            job.end("run", "cancelled", Some("stopped".to_string()));
            return Ok("cancelled");
        }
        let (status, detail) = match o.code {
            Some(0) => ("success", "exit code 0".to_string()),
            Some(c) => ("failed", format!("exit code {c}")),
            None if o.timed_out => ("failed", "stopped after 30 minutes".to_string()),
            None => ("failed", "ended by a signal".to_string()),
        };
        job.end("run", status, Some(detail));
        Ok(status)
    }))
}

#[tauri::command(async)]
pub fn quick_history(state: State<'_, AppState>, repo: String) -> Result<Vec<String>> {
    let dir = repo_dir(&state, &repo)?;
    db::recent_commands(&state.conn(), &dir.to_string_lossy(), QUICK_HISTORY)
}

#[tauri::command(async)]
pub fn quick_forget(state: State<'_, AppState>, repo: String, command: String) -> Result<()> {
    let dir = repo_dir(&state, &repo)?;
    db::forget_command(&state.conn(), &dir.to_string_lossy(), &command)
}

/// The job of this kind running on this repository, if any (to show it again after leaving the screen).
#[tauri::command(async)]
pub fn job_active(state: State<'_, AppState>, repo: String, kind: String) -> Result<Option<u64>> {
    let dir = repo_dir(&state, &repo)?;
    Ok(state.jobs.active(&kind, Some(&dir.to_string_lossy())))
}

// ───────────────────────────── Claude Code detection ─────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeReport {
    #[serde(flatten)]
    pub info: ClaudeInfo,
    /// Path picked in Settings, if any.
    pub configured: Option<String>,
    /// What this application received as PATH, and what the login shell has: the difference
    /// is why a program can work in a terminal and be "missing" here.
    pub app_path: Vec<String>,
    pub shell_path: Vec<String>,
    pub shell: Option<String>,
}

#[tauri::command(async)]
pub fn claude_info() -> ClaudeReport {
    let dirs = |v: Vec<std::path::PathBuf>| v.into_iter().map(|p| p.to_string_lossy().into_owned()).collect();
    ClaudeReport {
        info: claude::detect(),
        configured: crate::toolenv::override_for("claude").map(|p| p.to_string_lossy().into_owned()),
        app_path: std::env::var_os("PATH").map(|p| dirs(std::env::split_paths(&p).collect())).unwrap_or_default(),
        shell_path: dirs(crate::toolenv::shell_dirs().to_vec()),
        shell: std::env::var("SHELL").ok(),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeCheck {
    pub ok: bool,
    pub answer: Option<String>,
    pub error: Option<String>,
    pub cost_usd: Option<f64>,
    pub duration_ms: u64,
}

/// Really asks Claude Code something, headless, in an empty folder: proves that the
/// program found is logged in and answers. Counts toward the user's Claude usage.
#[tauri::command(async)]
pub fn claude_check(state: State<'_, AppState>) -> Result<ClaudeCheck> {
    claude::forget();
    let exe = claude::executable()?;
    let dir = state.cache_dir.join("claude-check");
    std::fs::create_dir_all(&dir)?;
    // Same command line as every real run (isolated, restricted), so this proves they work.
    let argv = crate::ai::runner::argv(&exe, &crate::ai::runner::Request::new("Réponds exactement par un mot : prêt", crate::ai::runner::Tools::None, Duration::from_secs(120)));
    let report = workspace::run_argv_captured(&argv, &dir, Duration::from_secs(120), &[])?;
    let (answer, error, cost_usd) = if report.timed_out {
        (None, Some("Claude Code n'a pas répondu en 2 minutes".to_string()), None)
    } else {
        let events: Vec<_> = report.output.lines().flat_map(crate::ai::stream::parse_line).collect();
        match events.iter().rev().find_map(|e| if let crate::ai::stream::Event::Result(f) = e { Some(f.clone()) } else { None }) {
            Some(f) if f.ok => (Some(f.text.trim().chars().take(200).collect()), None, f.cost_usd),
            Some(f) => (None, Some(crate::ai::stream::explain(&f)), None),
            None => (None, Some(events.iter().rev().find_map(|e| if let crate::ai::stream::Event::Raw(l) = e { Some(crate::ai::stream::explain_raw(l)) } else { None }).unwrap_or_else(|| "Claude Code s'est arrêté sans réponse".into())), None),
        }
    };
    Ok(ClaudeCheck { ok: error.is_none(), answer, error, cost_usd, duration_ms: report.duration_ms })
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
    /// A terminal command is configured (for "open a terminal here").
    pub terminal: bool,
    pub default_image: &'static str,
    /// File name of the subject linked to this project.
    pub subject: Option<String>,
    pub has_remote: bool,
}

fn linked_subject(state: &AppState, dir: &Path) -> Result<Option<(String, PathBuf)>> {
    let key = dir.to_string_lossy();
    let linked: Vec<db::Subject> = db::list_subjects(&state.conn())?.into_iter().filter(|s| s.repo_path.as_deref() == Some(key.as_ref())).collect();
    Ok(pick_subject(&linked).map(|s| (s.name.clone(), subjects::file_path(&state.subjects(), s))))
}

/// Among the documents linked to a project, the one to check the code against: the
/// subject itself rather than a bootstrap or a workshop, the most recent when several remain.
pub fn pick_subject(linked: &[db::Subject]) -> Option<&db::Subject> {
    let side = |s: &&db::Subject| ["bootstrap", "workshop", "kick-off", "kickoff"].iter().any(|w| s.name.to_lowercase().contains(w));
    linked.iter().find(|s| !side(s)).or_else(|| linked.first())
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
        terminal: !state.settings()?.terminal_cmd.trim().is_empty(),
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
    let template = prompts::template(&state.conn(), prompts::SUBJECT)?;
    let title = title_for(&dir, "Claude Moulinette");
    Ok(state.jobs.start(state.db.clone(), "moulinette", Some(key), title, moulinette::STEPS, move |job| moulinette::run(job, &dir, &params, subject, &template)))
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
            Ok(ClaudeBrief { plan: claude::plan(&["tests"]), prompt: moulinette::tests_prompt(&prompts::template(&state.conn(), prompts::TESTS)?, &dir, &d, has_rule) })
        }
        "readme" => {
            let subject = linked_subject(&state, &dir)?;
            let draft = readme::draft(&dir, &readme::Facts { subject: subject.as_ref().map(|(n, _)| n.as_str()), ai_disclosure: disclosure });
            Ok(ClaudeBrief { plan: claude::plan(&[]), prompt: readme::ai_prompt(&prompts::template(&state.conn(), prompts::README)?, &dir, &draft.proposed, disclosure) })
        }
        "subject" => Ok(ClaudeBrief { plan: claude::plan(&[]), prompt: moulinette::subject_prompt(&prompts::template(&state.conn(), prompts::SUBJECT)?, &dir, "<the text of the linked subject PDF>") }),
        "analysis" => Ok(ClaudeBrief { plan: claude::plan(&[]), prompt: prompts::render(&prompts::template(&state.conn(), prompts::ANALYZE)?, &prompts::common_values(&dir)) }),
        _ => Err(AppError::new("invalid_mode", "Unknown task")),
    }
}

/// Test generation by Tika on a working copy: the result is a diff to validate.
#[tauri::command(async)]
pub fn gen_tests_start(state: State<'_, AppState>, repo: String) -> Result<u64> {
    let dir = repo_dir(&state, &repo)?;
    crate::ai::agents::generate_tests(&state, dir)
}

/// Writes the chosen generated test files into the project (backups of replaced files).
#[tauri::command(async)]
pub fn gen_tests_apply(state: State<'_, AppState>, repo: String, run_id: i64, paths: Vec<String>) -> Result<usize> {
    let dir = repo_dir(&state, &repo)?;
    crate::ai::agents::apply_tests(&state, &dir, run_id, &paths)
}

/// Tika's moulinette: an agent evaluates a working copy, in the sandbox.
#[tauri::command(async)]
pub fn moulinette_ai_start(state: State<'_, AppState>, repo: String) -> Result<u64> {
    let dir = repo_dir(&state, &repo)?;
    crate::ai::agents::moulinette(&state, dir)
}

/// Whether the agents' sandbox works here, and why not.
#[tauri::command(async)]
pub fn sandbox_check() -> std::result::Result<(), String> {
    crate::ai::sandbox::check()
}

/// Asks Claude Code (read-only) for a review of the repository. The report lands in the job summary.
#[tauri::command(async)]
pub fn analysis_start(state: State<'_, AppState>, repo: String) -> Result<u64> {
    let dir = repo_dir(&state, &repo)?;
    let key = dir.to_string_lossy().into_owned();
    if let Some(id) = state.jobs.active("analysis", Some(&key)) {
        return Ok(id);
    }
    let prompt = prompts::render(&prompts::template(&state.conn(), prompts::ANALYZE)?, &prompts::common_values(&dir));
    let title = title_for(&dir, "Repository analysis");
    Ok(state.jobs.start(state.db.clone(), "analysis", Some(key), title, &[("claude", "Claude Code reads the project")], move |job| {
        job.start("claude");
        let (o, answer) = claude::run(job, &dir, &prompt, &[], Duration::from_secs(900))?;
        if o.cancelled {
            return Ok("cancelled");
        }
        match answer {
            Ok(a) => {
                job.set("report", format!("{}\n", claude::fenced(&a.text, "markdown").trim_end()));
                job.set("costUsd", a.cost_usd);
                job.end("claude", "success", Some(format!("{} turn(s) — Claude's reading of the code, not a measurement", a.turns.unwrap_or(0))));
                Ok("success")
            }
            Err(e) => {
                job.end("claude", "failed", Some(e.to_string()));
                Ok("failed")
            }
        }
    }))
}

// ───────────────────────────── prompts ─────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetView {
    pub name: String,
    pub body: String,
    pub updated_at: i64,
    /// Why this variant is not usable any more, if so (it then falls back to the default).
    pub problem: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptView {
    #[serde(flatten)]
    pub def: prompts::Def,
    pub presets: Vec<PresetView>,
    /// Variant in use; `None` = the default.
    pub active: Option<String>,
}

#[tauri::command(async)]
pub fn prompts_list(state: State<'_, AppState>) -> Result<Vec<PromptView>> {
    let conn = state.conn();
    prompts::DEFS
        .iter()
        .map(|d| {
            let presets = db::prompt_variants(&conn, d.id)?.into_iter().map(|(name, body, updated_at)| PresetView { problem: prompts::validate(d, &body).err().map(|e| e.to_string()), name, body, updated_at }).collect();
            Ok(PromptView { def: *d, presets, active: prompts::active_preset(&conn, d.id)? })
        })
        .collect()
}

/// Saves a variant of a prompt. Returns warnings (the variant is saved anyway).
#[tauri::command(async)]
pub fn prompt_save(state: State<'_, AppState>, id: String, preset: String, body: String, activate: bool) -> Result<Vec<String>> {
    let conn = state.conn();
    let warnings = prompts::save(&conn, &id, &preset, &body, crate::commands::now())?;
    if activate {
        prompts::set_active(&conn, &id, Some(preset.trim()))?;
    }
    Ok(warnings)
}

#[tauri::command(async)]
pub fn prompt_delete(state: State<'_, AppState>, id: String, preset: String) -> Result<()> {
    prompts::delete(&state.conn(), &id, &preset)
}

/// Chooses the variant in use; `None` restores the default.
#[tauri::command(async)]
pub fn prompt_activate(state: State<'_, AppState>, id: String, preset: Option<String>) -> Result<()> {
    prompts::set_active(&state.conn(), &id, preset.as_deref())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptPreview {
    /// The prompt as Claude Code would receive it.
    pub text: String,
    /// Each variable used, its value's origin (`project` or `sample`) and length.
    pub variables: Vec<(String, &'static str, usize)>,
    pub error: Option<String>,
    pub warnings: Vec<String>,
}

/// Resolves a prompt being edited, with the values of `repo` when given (samples otherwise). Nothing is run.
#[tauri::command(async)]
pub fn prompt_preview(state: State<'_, AppState>, id: String, body: String, repo: Option<String>) -> Result<PromptPreview> {
    let d = prompts::def(&id)?;
    let mut values = prompts::sample_values(d);
    let mut real: Vec<String> = Vec::new();
    if let Some(repo) = repo {
        let dir = repo_dir(&state, &repo)?;
        let mut found = prompts::common_values(&dir);
        match d.id {
            prompts::TESTS => {
                let det = testing::detect(&dir);
                let has_rule = det.suites.iter().any(|s| s.trusted);
                found.extend(moulinette::tests_values(&dir, &det, has_rule));
            }
            prompts::README => {
                let subject = linked_subject(&state, &dir)?;
                let draft = readme::draft(&dir, &readme::Facts { subject: subject.as_ref().map(|(n, _)| n.as_str()), ai_disclosure: false });
                found.extend(readme::ai_values(&dir, &draft.proposed, false));
            }
            prompts::SUBJECT => {
                if let Some(text) = linked_subject(&state, &dir)?.and_then(|(_, p)| claude::pdf_text(&p, 60_000)) {
                    found.insert("SUBJECT".into(), text);
                }
            }
            _ => {}
        }
        real = found.keys().cloned().collect();
        values.extend(found);
    }
    let (error, warnings) = match prompts::validate(d, &body) {
        Ok(w) => (None, w),
        Err(e) => (Some(e.to_string()), vec![]),
    };
    let variables = prompts::variables_in(&body).into_iter().filter(|n| values.contains_key(n)).map(|n| {
        let len = values[&n].chars().count();
        let origin = if real.contains(&n) { "project" } else { "sample" };
        (n, origin, len)
    }).collect();
    Ok(PromptPreview { text: prompts::render(&body, &values), variables, error, warnings })
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
    crate::commands::forget_scan();
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
    let prompt = readme::ai_prompt(&prompts::template(&state.conn(), prompts::README)?, &dir, &draft.proposed, disclosure);
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

#[cfg(test)]
mod tests {
    use super::pick_subject;
    use crate::db::Subject;

    fn doc(id: i64, name: &str) -> Subject {
        Subject { id, name: name.into(), file: name.into(), hash: id.to_string(), size: 1, repo_path: Some("/r".into()), added_at: id }
    }

    #[test]
    fn the_subject_is_preferred_to_a_bootstrap_whatever_was_imported_last() {
        // Newest first, as the library lists them.
        let linked = vec![doc(3, "102architect-bootstrap.pdf"), doc(2, "G-MAT-100_102architect.pdf"), doc(1, "old_102architect.pdf")];
        assert_eq!(pick_subject(&linked).unwrap().name, "G-MAT-100_102architect.pdf");
        assert_eq!(pick_subject(&linked[..1]).unwrap().name, "102architect-bootstrap.pdf", "a bootstrap is better than nothing");
        assert!(pick_subject(&[]).is_none());
    }
}
