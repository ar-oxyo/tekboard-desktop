//! Finding Claude Code, and the small helpers its callers share. Runs go through
//! `ai::runner`, which isolates them from the user's own Claude Code configuration.

use crate::ai::runner::{self, Tools};
use crate::error::{AppError, Result};
use crate::jobs::{Job, Outcome};
use serde::Serialize;
use std::path::Path;
use std::time::Duration;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeInfo {
    /// The executable that will be run. `None` when none was found.
    pub path: Option<String>,
    /// What the link points to, when `path` is a symbolic link.
    pub target: Option<String>,
    pub version: Option<String>,
    /// `ready`, `not_found`, `not_executable` (the path picked in Settings is wrong) or
    /// `version_failed` (found, but `--version` did not answer).
    pub state: &'static str,
    /// Where it was found: `settings`, `path`, `user` (a per-user install folder) or `shell` (the login shell's PATH).
    pub source: Option<&'static str>,
    /// What went wrong, in the program's own words when it said something.
    pub detail: Option<String>,
}

/// Finds Claude Code and checks that it answers. Nothing is assumed about where it is installed.
pub fn detect() -> ClaudeInfo {
    let picked = crate::toolenv::override_for("claude");
    if let Some(p) = picked.as_ref().filter(|p| !crate::toolenv::is_executable(p)) {
        return ClaudeInfo { path: Some(p.to_string_lossy().into_owned()), target: None, version: None, state: "not_executable", source: Some("settings"), detail: Some("The path set in Settings is not an executable file.".into()) };
    }
    let Some(found) = crate::toolenv::find("claude") else {
        return ClaudeInfo { path: None, target: None, version: None, state: "not_found", source: None, detail: Some("No `claude` program in this application's PATH, in the usual per-user folders, or in your login shell's PATH.".into()) };
    };
    let target = std::fs::canonicalize(&found.path).ok().filter(|t| *t != found.path).map(|t| t.to_string_lossy().into_owned());
    let path = Some(found.path.to_string_lossy().into_owned());
    match crate::toolenv::first_line(&found.path, &["--version"], Duration::from_secs(8)) {
        Ok(version) => ClaudeInfo { path, target, version: Some(version), state: "ready", source: Some(found.source), detail: None },
        Err(why) => ClaudeInfo { path, target, version: None, state: "version_failed", source: Some(found.source), detail: Some(format!("`--version` failed: {why}")) },
    }
}

/// Last detection, reused for a minute: `executable()` is called before every run and
/// `--version` costs a Node start. Settings changes call `forget()`.
static CACHE: std::sync::Mutex<Option<(ClaudeInfo, std::time::Instant)>> = std::sync::Mutex::new(None);

pub fn forget() {
    *CACHE.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

fn cached() -> ClaudeInfo {
    let mut c = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((info, at)) = c.as_ref() {
        if info.state == "ready" && at.elapsed() < Duration::from_secs(60) {
            return info.clone();
        }
    }
    let info = detect();
    *c = Some((info.clone(), std::time::Instant::now()));
    info
}

/// The executable to run, or an error that says exactly what is wrong.
pub fn executable() -> Result<String> {
    let info = cached();
    match (info.state, info.path) {
        ("ready", Some(p)) => Ok(p),
        ("not_found", _) => Err(AppError::new("claude_missing", "Claude Code est introuvable (pas de programme `claude` dans le PATH, les dossiers utilisateur ou le PATH de ton shell). Indique son chemin dans Réglages → Outils.")),
        (_, p) => Err(AppError::new("claude_missing", format!("Claude Code ne peut pas être utilisé ({}) : {}", p.unwrap_or_default(), info.detail.unwrap_or_default()))),
    }
}

/// What a headless run is allowed to do, in words the UI can show as they are.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub available: bool,
    pub version: Option<String>,
    pub argv: Vec<String>,
    pub can_read: String,
    pub can_write: String,
    pub cannot: String,
    pub account: String,
}

/// `write_dirs`: folders (relative to the project) Claude may create or edit files in. Empty = read-only.
pub fn plan(write_dirs: &[&str]) -> Plan {
    let info = cached();
    let tools = if write_dirs.is_empty() { Tools::Read } else { Tools::ReadEdit(write_dirs.iter().map(|d| format!("{d}/**")).collect()) };
    Plan {
        available: info.state == "ready",
        version: info.version,
        argv: runner::preview(&runner::Request::new("", tools, Duration::from_secs(1))),
        can_read: "Les fichiers de ce dossier de projet, sauf .git et ce qui ressemble à un secret (.env, clés, identifiants). Ce qui est lu est envoyé à Anthropic pour produire la réponse.".into(),
        can_write: if write_dirs.is_empty() { "Rien : cette exécution est en lecture seule.".into() } else { format!("Uniquement les fichiers dans {}. Rien d'autre dans le projet, rien en dehors.", write_dirs.iter().map(|d| format!("{d}/")).collect::<Vec<_>>().join(", ")) },
        cannot: "Lancer des commandes (pas de shell), utiliser le réseau ou tes services connectés. Tes réglages, hooks et plugins Claude Code ne sont pas chargés.".into(),
        account: "Utilise le Claude Code installé sur cet ordinateur, avec ton compte. Cela compte dans ton usage de Claude.".into(),
    }
}

pub type Answer = runner::Answer;

/// A question answered from the text of the prompt alone: no tool at all.
pub fn run_chat(job: &Job, dir: &Path, prompt: &str, timeout: Duration) -> Result<(Outcome, Result<Answer>)> {
    job.log(&format!("Instructions données à Claude Code (aucun outil) :\n{prompt}\n"));
    runner::run(job, dir, &runner::Request::new(prompt, Tools::None, timeout), &mut |_| {})
}

/// Runs Claude Code in `dir` as part of a job: reads the project, writes only in `write_dirs`.
pub fn run(job: &Job, dir: &Path, prompt: &str, write_dirs: &[&str], timeout: Duration) -> Result<(Outcome, Result<Answer>)> {
    job.log(&format!("Instructions données à Claude Code :\n{prompt}\n"));
    let tools = if write_dirs.is_empty() { Tools::Read } else { Tools::ReadEdit(write_dirs.iter().map(|d| format!("{d}/**")).collect()) };
    runner::run(job, dir, &runner::Request::new(prompt, tools, timeout), &mut |_| {})
}

/// First fenced block of the answer (or the whole text when there is none).
pub fn fenced(text: &str, lang: &str) -> String {
    let open = format!("```{lang}");
    let start = text.find(&open).map(|i| i + open.len()).or_else(|| text.find("```").map(|i| i + 3));
    match start {
        Some(s) => {
            let body = &text[s..];
            let body = body.strip_prefix('\n').unwrap_or(body);
            body[..body.rfind("```").unwrap_or(body.len())].trim_end().to_string()
        }
        None => text.trim().to_string(),
    }
}

/// Text of a PDF, through `pdftotext`. `None` when the tool is missing or the file has no text.
pub fn pdf_text(pdf: &Path, max_chars: usize) -> Option<String> {
    let out = crate::toolenv::command("pdftotext").arg("-layout").arg(pdf).arg("-").stdin(std::process::Stdio::null()).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let trimmed: String = text.chars().take(max_chars).collect();
    (trimmed.trim().len() > 40).then_some(trimmed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_plan_shown_matches_what_runs() {
        let p = plan(&["tests"]);
        assert!(p.can_write.contains("tests/"));
        assert!(p.argv.contains(&"Edit(./tests/**)".to_string()) && p.argv.contains(&"--restricted".to_string()));
        assert!(plan(&[]).can_write.contains("lecture seule"));
    }

    #[test]
    fn fenced_blocks_are_extracted() {
        assert_eq!(fenced("Here:\n```json\n[1, 2]\n```\nbye", "json"), "[1, 2]");
        assert_eq!(fenced("```markdown\n# T\n\n```c\nint x;\n```\n\nend\n```", "markdown"), "# T\n\n```c\nint x;\n```\n\nend");
        assert_eq!(fenced("plain", "json"), "plain");
    }
}
