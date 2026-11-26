//! Agents that work on a copy of a project: Artix's moulinette (a simulated evaluation) and
//! test generation. Both:
//! 1. copy the project as it is now (`workcopy`) into a throwaway folder;
//! 2. check that the sandbox works (no unsandboxed fallback);
//! 3. run Claude Code there with read tools, writes limited to a few paths of the copy, and
//!    TekBoard's `exec` tool for commands (bubblewrap, no network);
//! 4. report through the job: steps and checks appear as the agent declares and runs them.

use super::{ipc, runner, sandbox, tools::Caller, workcopy};
use crate::commands::AppState;
use crate::error::{AppError, Result};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::Duration;

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

/// Text of the project's subject: its digest when analysed, else the PDF text.
pub(crate) fn subject_text(state: &AppState, repo: &Path) -> Option<String> {
    let key = repo.to_string_lossy().into_owned();
    let conn = state.conn();
    if let Ok(b) = conn.query_row("SELECT brief FROM project_briefs WHERE project = ?1 AND stale = 0", [&key], |r| r.get::<_, String>(0)) {
        return Some(format!("Résumé du sujet (analysé par TekBoard) :\n{b}"));
    }
    let linked: Vec<crate::db::Subject> = crate::db::list_subjects(&conn).ok()?.into_iter().filter(|s| s.repo_path.as_deref() == Some(key.as_str())).collect();
    let s = crate::commands_dev::pick_subject(&linked)?;
    let path = crate::subjects::file_path(&state.subjects(), s);
    drop(conn);
    crate::claude::pdf_text(&path, 40_000).map(|t| format!("Texte du sujet « {} » :\n\n{t}", s.name))
}

/// What a job needs from the app, owned (jobs run on their own threads).
#[derive(Clone)]
struct Ctx {
    db: std::sync::Arc<std::sync::Mutex<rusqlite::Connection>>,
    cache: PathBuf,
    subject: Option<String>,
}

impl Ctx {
    fn of(state: &AppState, repo: &Path) -> Ctx {
        Ctx { db: state.db.clone(), cache: state.cache_dir.clone(), subject: subject_text(state, repo) }
    }
    fn conn(&self) -> std::sync::MutexGuard<'_, rusqlite::Connection> {
        self.db.lock().unwrap_or_else(|e| e.into_inner())
    }
}

fn prepare(job: &crate::jobs::Job, ctx: &Ctx, repo: &Path, kind: &str) -> Result<Option<PathBuf>> {
    job.start("prepare");
    if let Err(why) = sandbox::check() {
        job.end("prepare", "failed", Some(why.clone()));
        job.set("error", format!("Bac à sable indisponible : {why}. Rien n'a été exécuté."));
        return Ok(None);
    }
    let base = ctx.cache.join("agents").join(format!("{kind}-{}", now()));
    let work = base.join("work");
    let n = workcopy::copy(repo, &work)?;
    if let Some(text) = &ctx.subject {
        std::fs::write(work.join(".mouli/SUBJECT.md"), text)?;
        job.set("subject", true);
    }
    job.end("prepare", "success", Some(format!("{n} fichiers copiés, bac à sable prêt{}", if work.join(".mouli/SUBJECT.md").exists() { ", sujet joint" } else { ", pas de sujet lié" })));
    Ok(Some(work))
}

fn cleanup(work: &Path) {
    if let Some(base) = work.parent() {
        let _ = std::fs::remove_dir_all(base);
    }
}

struct Agent<'a> {
    kind: &'static str,
    persona: String,
    prompt: String,
    edit: Vec<String>,
    tools: Vec<&'static str>,
    ctx: &'a Ctx,
}

fn run_agent(job: &crate::jobs::Job, a: Agent, work: &Path) -> Result<(crate::jobs::Outcome, Result<runner::Answer>)> {
    let settings = super::chat::AiSettings::load(&a.ctx.conn());
    let grant = ipc::grant(&a.ctx.cache, Caller { job_id: Some(job.id()), work_dir: Some(work.to_path_buf()), allowed: a.tools.clone(), ..Default::default() })?;
    let mut req = runner::Request::new(a.prompt, runner::Tools::ReadEdit(a.edit), Duration::from_secs(settings.agent_minutes as u64 * 60));
    req.system = Some(a.persona);
    req.mcp = Some(runner::Mcp { config: grant.config.clone(), allow: a.tools.iter().map(|t| t.to_string()).collect() });
    req.model = Some(settings.agent_model.clone()).filter(|m| !m.is_empty());
    req.budget_usd = Some(settings.agent_budget_usd).filter(|b| *b > 0.0);
    job.set("kind", a.kind);
    let r = runner::run(job, work, &req, &mut |_| {});
    drop(grant);
    r
}

pub const MOULI_STEPS: &[(&str, &str)] = &[("prepare", "Copie de travail et bac à sable"), ("agent", "Évaluation par Artix")];

/// Artix's moulinette on `repo`. Returns the job id.
pub fn moulinette(state: &AppState, repo: PathBuf) -> Result<u64> {
    super::provider::require(super::provider::Feature::Agent)?;
    let key = repo.to_string_lossy().into_owned();
    if let Some(id) = state.jobs.active("moulinette_ai", Some(&key)) {
        return Ok(id);
    }
    let persona = crate::prompts::template(&state.conn(), crate::prompts::MOULI_AGENT)?;
    let name = repo.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let binary = crate::runner::detect(&repo).map(|(b, _)| b);
    let ctx = Ctx::of(state, &repo);
    let title = format!("Moulinette d'Artix · {name}");
    Ok(state.jobs.start(state.db.clone(), "moulinette_ai", Some(key.clone()), title, MOULI_STEPS, move |job| {
        let Some(work) = prepare(job, &ctx, &repo, "mouli")? else { return Ok("failed") };
        job.start("agent");
        let prompt = format!("Évalue le projet « {name} » qui se trouve dans ce dossier{}. Suis tes étapes, rends compte de chaque vérification avec les outils prévus, puis termine par finish_report.", binary.as_ref().map(|b| format!(" (binaire attendu d'après le Makefile : {b})")).unwrap_or_default());
        let r = run_agent(job, Agent { kind: "moulinette_ai", persona, prompt, edit: vec![".mouli/**".into()], tools: super::agent_tools::ALL.to_vec(), ctx: &ctx }, &work);
        cleanup(&work);
        let (o, answer) = r?;
        let events = job.events();
        let checks: Vec<&Value> = events.iter().filter(|e| e["kind"] == "check").collect();
        let count = |s: &str| checks.iter().filter(|c| c["status"] == s).count();
        let (passed, failed, warned) = (count("passed"), count("failed"), count("warning"));
        job.set("counts", json!({"passed": passed, "failed": failed, "warning": warned, "planned": count("planned"), "total": checks.len()}));
        if job.events().iter().all(|e| e["phase"] != "report") {
            if let Ok(a) = &answer {
                job.set("report", &a.text);
            }
        }
        runner::end_step(job, "agent", &answer, |a| format!("{} vérifications · {} réussies · {} échouées{}", checks.len(), passed, failed, a.cost_usd.map(|c| format!(" · ≈ {c:.2} $")).unwrap_or_default()));
        if o.cancelled {
            return Ok("cancelled");
        }
        if answer.is_err() {
            return Ok("failed");
        }
        // What was found stays in Artix's memory for the next conversations.
        let verdict = job_summary_str(job, "verdict").unwrap_or_else(|| format!("{passed} vérifications réussies, {failed} échouées"));
        let failed_titles: Vec<String> = checks.iter().filter(|c| c["status"] == "failed").filter_map(|c| c["title"].as_str()).take(5).map(str::to_string).collect();
        let memo = format!("Moulinette du {} : {verdict}{}", crate::schedule::local_iso(now()).get(..10).unwrap_or_default(), if failed_titles.is_empty() { String::new() } else { format!(" Échecs : {}.", failed_titles.join(" ; ")) });
        let conn = ctx.conn();
        let _ = conn.execute("DELETE FROM ai_memories WHERE scope = ?1 AND kind = 'test_report' AND source = 'system'", [super::memory::project_scope(&key)]);
        let _ = super::memory::add(&conn, &super::memory::project_scope(&key), "test_report", &crate::ai::stream::clip(&memo, 580), "system", false, true, now());
        drop(conn);
        crate::notify::changed(&["memory", "insights"]);
        Ok(if failed > 0 || warned > 0 { "warning" } else { "success" })
    }))
}

fn job_summary_str(job: &crate::jobs::Job, key: &str) -> Option<String> {
    job.summary_value(key).and_then(|v| v.as_str().map(str::to_string))
}

pub const GEN_STEPS: &[(&str, &str)] = &[("prepare", "Copie de travail et bac à sable"), ("agent", "Artix écrit et lance les tests"), ("diff", "Changements à valider")];

/// Test generation on a copy; the result is a diff (`summary.changes`) applied by `apply_tests`.
pub fn generate_tests(state: &AppState, repo: PathBuf) -> Result<u64> {
    super::provider::require(super::provider::Feature::Agent)?;
    let key = repo.to_string_lossy().into_owned();
    if let Some(id) = state.jobs.active("gen_tests", Some(&key)) {
        return Ok(id);
    }
    let persona = crate::prompts::template(&state.conn(), crate::prompts::TESTS_AGENT)?;
    let name = repo.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let ctx = Ctx::of(state, &repo);
    Ok(state.jobs.start(state.db.clone(), "gen_tests", Some(key), format!("Tests générés par Artix · {name}"), GEN_STEPS, move |job| {
        let Some(work) = prepare(job, &ctx, &repo, "tests")? else { return Ok("failed") };
        job.start("agent");
        let has_tests = repo.join("tests").is_dir();
        let prompt = format!("Écris des tests unitaires Criterion pour « {name} »{}. Compile-les et lance-les avec exec jusqu'à ce qu'ils compilent, puis résume.", if has_tests { " (des tests existent déjà dans tests/ : complète-les sans les casser)" } else { "" });
        let r = run_agent(job, Agent { kind: "gen_tests", persona, prompt, edit: vec!["tests/**".into(), "Makefile".into(), ".mouli/**".into()], tools: vec!["exec", "phase"], ctx: &ctx }, &work);
        let changes = workcopy::changes(&repo, &work, &["tests", "Makefile"]);
        cleanup(&work);
        let (o, answer) = r?;
        if let Ok(a) = &answer {
            job.set("report", &a.text);
        }
        runner::end_step(job, "agent", &answer, |a| a.turns.map(|t| format!("{t} étapes")).unwrap_or_default());
        // Even when the run stopped early, what was written is shown: nothing is lost silently.
        job.start("diff");
        job.set("changes", &changes);
        job.end("diff", if changes.is_empty() { "warning" } else { "success" }, Some(if changes.is_empty() { "aucun fichier écrit".into() } else { format!("{} fichier(s) à valider : rien n'est encore écrit dans ton projet", changes.len()) }));
        if o.cancelled {
            return Ok("cancelled");
        }
        Ok(match (&answer, changes.is_empty()) {
            (Ok(_), false) => "success",
            (Err(_), true) => "failed",
            _ => "warning",
        })
    }))
}

/// Writes the chosen generated files into the project (backups of what they replace).
pub fn apply_tests(state: &AppState, repo: &Path, run_id: i64, paths: &[String]) -> Result<usize> {
    let run = crate::db::get_run(&state.conn(), run_id)?.ok_or_else(|| AppError::new("not_found", "Exécution introuvable"))?;
    if run.kind != "gen_tests" || run.repo_path.as_deref() != Some(repo.to_string_lossy().as_ref()) {
        return Err(AppError::new("invalid_args", "Cette exécution ne concerne pas ce projet."));
    }
    let all: Vec<workcopy::Change> = serde_json::from_value(run.summary["changes"].clone()).unwrap_or_default();
    let chosen: Vec<workcopy::Change> = all.into_iter().filter(|c| paths.contains(&c.path)).collect();
    let n = workcopy::apply(repo, &chosen, &state.backups())?;
    crate::commands::forget_scan();
    crate::notify::changed(&["repos", "runs"]);
    Ok(n)
}
