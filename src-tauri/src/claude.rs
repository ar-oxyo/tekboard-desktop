//! Claude Code, run headless and on a short leash.
//!
//! Every call names the built-in tools Claude may use; `Bash` is never among them, so it
//! cannot run a command. Reading is limited to the project folder minus secret-looking
//! files; writing, when allowed at all, is limited to the folders given. The exact command
//! is available beforehand (`plan`) so the UI can show it before anything starts.

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

/// The executable to run, or an error that says exactly what is wrong.
pub fn executable() -> Result<String> {
    let info = detect();
    match (info.state, info.path) {
        ("ready", Some(p)) => Ok(p),
        ("not_found", _) => Err(AppError::new("claude_missing", "Claude Code was not found (no `claude` program in the PATH, the per-user folders or your shell's PATH). Set its path in Settings → Tools.")),
        (_, p) => Err(AppError::new("claude_missing", format!("Claude Code cannot be used ({}): {}", p.unwrap_or_default(), info.detail.unwrap_or_default()))),
    }
}

/// Files Claude is never allowed to read, whatever the task.
const DENY_READ: &[&str] = &["Read(./.env)", "Read(./.env.*)", "Read(./**/.env)", "Read(./**/.env.*)", "Read(./**/*.pem)", "Read(./**/*.key)", "Read(./**/id_rsa*)", "Read(./**/id_ed25519*)", "Read(./**/.netrc)", "Read(./**/*.p12)", "Read(./**/credentials*)", "Read(./.git/**)"];

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
pub fn build_argv(prompt: &str, write_dirs: &[&str]) -> Vec<String> {
    let mut argv: Vec<String> = ["claude", "-p", "--output-format", "json", "--no-session-persistence", "--strict-mcp-config", "--tools"].iter().map(|s| s.to_string()).collect();
    let mut tools = vec!["Read", "Glob", "Grep"];
    if !write_dirs.is_empty() {
        tools.extend(["Write", "Edit"]);
    }
    argv.extend(tools.iter().map(|s| s.to_string()));
    argv.push("--allowedTools".into());
    argv.extend(["Read", "Glob", "Grep"].iter().map(|s| s.to_string()));
    for d in write_dirs {
        argv.push(format!("Edit(./{d}/**)"));
        argv.push(format!("Write(./{d}/**)"));
    }
    argv.push("--disallowedTools".into());
    argv.extend(DENY_READ.iter().map(|s| s.to_string()));
    argv.push("--".into());
    argv.push(prompt.to_string());
    argv
}

pub fn plan(write_dirs: &[&str]) -> Plan {
    let info = detect();
    let mut argv = build_argv("<instructions>", write_dirs);
    if let Some(p) = &info.path {
        argv[0] = p.clone();
    }
    argv.truncate(argv.len() - 1);
    argv.push("<instructions shown below>".into());
    Plan {
        available: info.state == "ready",
        version: info.version,
        argv,
        can_read: "Files of this project folder, except .git and files that look like secrets (.env, keys, credentials). What it reads is sent to Anthropic to produce the answer.".into(),
        can_write: if write_dirs.is_empty() { "Nothing. This run is read-only.".into() } else { format!("Only files inside {}. Nothing else in the project, nothing outside it.", write_dirs.iter().map(|d| format!("{d}/")).collect::<Vec<_>>().join(", ")) },
        cannot: "Run commands (no shell), use the network tools, or use your connected services (MCP is disabled for this run).".into(),
        account: "Uses the Claude Code installed on this computer, with your login. It counts toward your Claude usage; an active plan or API credit is required.".into(),
    }
}

#[derive(Debug, Clone)]
pub struct Answer {
    pub text: String,
    pub cost_usd: Option<f64>,
    pub turns: Option<u64>,
}

/// Reads the JSON printed by `claude -p --output-format json`.
pub fn parse_answer(output: &str) -> Result<Answer> {
    let line = output.lines().rev().find(|l| l.trim_start().starts_with('{') || l.trim_start().starts_with('[')).ok_or_else(|| AppError::new("claude_failed", last_line(output)))?;
    let value: serde_json::Value = serde_json::from_str(line.trim()).map_err(|_| AppError::new("claude_failed", last_line(output)))?;
    // Either one result object, or an array of events ending with it.
    let result = match &value {
        serde_json::Value::Array(items) => items.iter().rev().find(|v| v["type"] == "result").cloned().unwrap_or(serde_json::Value::Null),
        other => other.clone(),
    };
    let text = result["result"].as_str().unwrap_or_default().to_string();
    if result["is_error"].as_bool().unwrap_or(false) || text.is_empty() {
        let why = if text.is_empty() { result["subtype"].as_str().unwrap_or("Claude Code returned no answer").to_string() } else { text };
        return Err(AppError::new("claude_failed", why));
    }
    Ok(Answer { text, cost_usd: result["total_cost_usd"].as_f64(), turns: result["num_turns"].as_u64() })
}

fn last_line(output: &str) -> String {
    output.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("Claude Code printed nothing").trim().chars().take(400).collect()
}

/// Runs Claude Code in `dir` as part of a job. The prompt is logged in full first.
pub fn run(job: &Job, dir: &Path, prompt: &str, write_dirs: &[&str], timeout: Duration) -> Result<(Outcome, Result<Answer>)> {
    let exe = executable()?;
    job.log(&format!("Instructions given to Claude Code:\n{prompt}\n"));
    let mut argv = build_argv(prompt, write_dirs);
    // The absolute path found by `detect`, never the bare name: the desktop PATH may not have it.
    argv[0] = exe;
    // The log shows the command with the prompt elided: it is printed just above.
    let o = job.run(&argv, dir, timeout, &[])?;
    let answer = if o.cancelled {
        Err(AppError::new("cancelled", "Cancelled"))
    } else if o.timed_out {
        Err(AppError::new("claude_failed", "Claude Code did not finish in time"))
    } else {
        parse_answer(&o.output)
    };
    Ok((o, answer))
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
    fn read_only_runs_get_no_writing_tool_and_never_a_shell() {
        let argv = build_argv("hello", &[]);
        let tools_at = argv.iter().position(|a| a == "--tools").unwrap();
        let allowed_at = argv.iter().position(|a| a == "--allowedTools").unwrap();
        assert_eq!(&argv[tools_at + 1..allowed_at], ["Read", "Glob", "Grep"]);
        assert!(!argv.iter().any(|a| a.contains("Bash") || a.starts_with("Write") || a.starts_with("Edit")));
        assert!(argv.contains(&"Read(./.env)".to_string()) && argv.contains(&"--strict-mcp-config".to_string()));
        assert_eq!(argv[argv.len() - 2..], ["--", "hello"]);
    }

    #[test]
    fn writing_is_scoped_to_the_given_folder() {
        let argv = build_argv("x", &["tests"]);
        assert!(argv.contains(&"Edit(./tests/**)".to_string()) && argv.contains(&"Write(./tests/**)".to_string()));
        let allowed_at = argv.iter().position(|a| a == "--allowedTools").unwrap();
        assert!(!argv[allowed_at..].iter().any(|a| a == "Edit" || a == "Write"), "no blanket edit permission: {argv:?}");
        assert!(!argv.iter().any(|a| a.contains("Bash")));
        assert!(plan(&["tests"]).can_write.contains("tests/"));
        assert!(plan(&[]).can_write.contains("read-only"));
    }

    #[test]
    fn answers_and_errors_are_read_from_the_json() {
        let ok = parse_answer("noise\n{\"type\":\"result\",\"is_error\":false,\"result\":\"done\",\"total_cost_usd\":0.02,\"num_turns\":3}\n").unwrap();
        assert_eq!((ok.text.as_str(), ok.turns), ("done", Some(3)));
        let arr = parse_answer("[{\"type\":\"system\"},{\"type\":\"result\",\"result\":\"ok\"}]").unwrap();
        assert_eq!(arr.text, "ok");
        assert!(parse_answer("{\"type\":\"result\",\"is_error\":true,\"result\":\"Invalid API key\"}").unwrap_err().to_string().contains("Invalid API key"));
        assert!(parse_answer("command not logged in\n").unwrap_err().to_string().contains("not logged in"));
    }

    #[test]
    fn fenced_blocks_are_extracted() {
        assert_eq!(fenced("Here:\n```json\n[1, 2]\n```\nbye", "json"), "[1, 2]");
        assert_eq!(fenced("```markdown\n# T\n\n```c\nint x;\n```\n\nend\n```", "markdown"), "# T\n\n```c\nint x;\n```\n\nend");
        assert_eq!(fenced("plain", "json"), "plain");
    }
}
