//! The one way TekBoard runs Claude Code.
//!
//! Every run is headless and isolated from the user's own Claude Code configuration:
//! - `--restricted`: user, project and local settings files are not loaded (no hooks, no
//!   plugins, no permission mode set elsewhere), the file tools stay in the working folder,
//!   and the tools that run commands are removed unless named in `--tools`. TekBoard never
//!   names them: commands only ever run through its own `exec` tool, inside bubblewrap.
//! - `--strict-mcp-config`: only the MCP servers TekBoard passes (its own, when asked).
//! - `--permission-mode dontAsk --permission-prompts none`: anything not explicitly allowed
//!   is refused at once instead of waiting for an answer nobody can give.
//! - `--output-format stream-json`: progress is read as it happens (`stream.rs`).
//!
//! The exact command can be shown beforehand (`preview`).

use super::stream::{self, Event, Final};
use crate::error::{AppError, Result};
use crate::jobs::{Job, Outcome};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Files Claude is never allowed to read, whatever the task.
pub const DENY_READ: &[&str] = &["Read(./.env)", "Read(./.env.*)", "Read(./**/.env)", "Read(./**/.env.*)", "Read(./**/*.pem)", "Read(./**/*.key)", "Read(./**/id_rsa*)", "Read(./**/id_ed25519*)", "Read(./**/.netrc)", "Read(./**/*.p12)", "Read(./**/credentials*)", "Read(./.git/**)"];

/// Built-in tools of a run.
#[derive(Debug, Clone, PartialEq)]
pub enum Tools {
    /// No built-in tool: only TekBoard's MCP tools, if any.
    None,
    /// Read, Glob, Grep in the working folder.
    Read,
    /// Read, plus editing files that match these globs (relative to the working folder).
    ReadEdit(Vec<String>),
}

#[derive(Debug, Clone, PartialEq)]
pub enum Session {
    /// Not saved: cannot be continued.
    Once,
    /// First turn of a conversation that will be continued with this id.
    Start(String),
    /// Next turn of that conversation.
    Resume(String),
}

/// TekBoard's own MCP server for this run.
#[derive(Debug, Clone)]
pub struct Mcp {
    /// `--mcp-config` file (written by `ai::ipc`).
    pub config: PathBuf,
    /// Tool names allowed (`get_today`…), or `["*"]` for every tool the server lists.
    pub allow: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct Request {
    pub prompt: String,
    pub system: Option<String>,
    pub tools: Tools,
    pub mcp: Option<Mcp>,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub session: Session,
    pub json_schema: Option<String>,
    pub budget_usd: Option<f64>,
    pub timeout: Duration,
    /// Text being written is reported as it comes (chat).
    pub partial: bool,
    /// Earlier turns `(role, text)`, for providers that keep no conversation themselves
    /// (OpenRouter, Ollama). Claude Code continues its own session instead.
    pub history: Vec<(String, String)>,
}

impl Request {
    pub fn new(prompt: impl Into<String>, tools: Tools, timeout: Duration) -> Self {
        Request { prompt: prompt.into(), system: None, tools, mcp: None, model: None, effort: None, session: Session::Once, json_schema: None, budget_usd: None, timeout, partial: false, history: Vec::new() }
    }
}

pub fn argv(exe: &str, r: &Request) -> Vec<String> {
    let mut a: Vec<String> = vec![exe.into(), "-p".into(), "--restricted".into(), "--strict-mcp-config".into(), "--permission-mode".into(), "dontAsk".into(), "--permission-prompts".into(), "none".into(), "--output-format".into(), "stream-json".into(), "--verbose".into()];
    if r.partial {
        a.push("--include-partial-messages".into());
    }
    match &r.session {
        Session::Once => a.push("--no-session-persistence".into()),
        Session::Start(id) => a.extend(["--session-id".into(), id.clone()]),
        Session::Resume(id) => a.extend(["--resume".into(), id.clone()]),
    }
    if let Some(m) = r.model.as_deref().filter(|m| !m.is_empty()) {
        a.extend(["--model".into(), m.to_string()]);
    }
    if let Some(e) = r.effort.as_deref().filter(|e| !e.is_empty()) {
        a.extend(["--effort".into(), e.to_string()]);
    }
    if let Some(b) = r.budget_usd.filter(|b| *b > 0.0) {
        a.extend(["--max-budget-usd".into(), format!("{b:.2}")]);
    }
    if let Some(s) = r.system.as_deref().filter(|s| !s.is_empty()) {
        a.extend(["--append-system-prompt".into(), s.to_string()]);
    }
    if let Some(schema) = &r.json_schema {
        a.extend(["--json-schema".into(), schema.clone()]);
    }
    if let Some(m) = &r.mcp {
        a.extend(["--mcp-config".into(), m.config.to_string_lossy().into_owned()]);
    }
    // Built-in tools that exist for this run.
    a.push("--tools".into());
    match &r.tools {
        Tools::None => a.push(String::new()),
        Tools::Read => a.extend(["Read", "Glob", "Grep"].map(String::from)),
        Tools::ReadEdit(_) => a.extend(["Read", "Glob", "Grep", "Edit", "Write"].map(String::from)),
    }
    // What runs without asking. Everything else is refused (`dontAsk`).
    let mut allow: Vec<String> = Vec::new();
    if r.tools != Tools::None {
        allow.extend(["Read", "Glob", "Grep"].map(String::from));
    }
    if let Tools::ReadEdit(globs) = &r.tools {
        // `Edit(...)` rules cover every file-writing tool, `Write` included.
        allow.extend(globs.iter().map(|g| format!("Edit(./{})", g.trim_start_matches("./"))));
    }
    if let Some(m) = &r.mcp {
        if m.allow.iter().any(|t| t == "*") {
            allow.push("mcp__tekboard__*".into());
        } else {
            allow.extend(m.allow.iter().map(|t| format!("mcp__tekboard__{t}")));
        }
    }
    if !allow.is_empty() {
        a.push("--allowedTools".into());
        a.extend(allow);
    }
    a.push("--disallowedTools".into());
    a.extend(DENY_READ.iter().map(|s| s.to_string()));
    a.push("--".into());
    a.push(r.prompt.clone());
    a
}

/// The command as it will run, with the prompt replaced by a placeholder.
pub fn preview(r: &Request) -> Vec<String> {
    let exe = crate::claude::detect().path.unwrap_or_else(|| "claude".into());
    let mut a = argv(&exe, &Request { prompt: "<instructions>".into(), system: r.system.as_ref().map(|_| "<rôle>".into()), ..r.clone() });
    if let Some(i) = a.iter().position(|x| x == "--json-schema") {
        a[i + 1] = "<schéma>".into();
    }
    a
}

#[derive(Debug, Clone)]
pub struct Answer {
    pub text: String,
    pub cost_usd: Option<f64>,
    pub turns: Option<u64>,
    pub session_id: Option<String>,
    pub structured: Option<Value>,
    pub denials: Vec<String>,
}

/// Runs a request with the AI the user chose (`provider`), as part of `job`, in `dir`. Every
/// tool call becomes an activity entry of the job (`job.event`), the text written so far is
/// kept in the summary under `partial` when `partial` is set, and `on_event` sees every event
/// (for callers that react to them). A request the provider cannot handle (an agent with
/// OpenRouter…) is refused before anything runs.
pub fn run(job: &Job, dir: &Path, r: &Request, on_event: &mut dyn FnMut(&Event)) -> Result<(Outcome, Result<Answer>)> {
    match super::provider::route(r)? {
        super::provider::Route::Claude => run_claude(job, dir, r, on_event),
        super::provider::Route::Compat(ep) => super::toolloop::run(job, dir, r, ep, on_event),
    }
}

/// What every provider shows of a run: text blocks and tool calls in the activity feed.
pub fn show(job: &Job, ev: &Event) {
    let label = |t: &str| super::tools::label(t);
    match ev {
        Event::Text(t) => job.event(json!({"kind": "text", "text": stream::clip(t, 4000), "at": now()})),
        Event::ToolUse { id, name, input } => {
            let (label, detail) = stream::describe(name, input, &label);
            job.log(&format!("→ {label} {detail}"));
            job.event(json!({"kind": "tool", "id": id, "tool": name, "label": label, "detail": detail, "status": "running", "at": now()}));
        }
        Event::ToolResult { id, ok, text: out } => {
            if !ok {
                job.log(&format!("  ✗ {}", stream::clip(out, 300)));
            }
            let excerpt = stream::clip(out, 600);
            job.update_event(id, |e| {
                e["status"] = json!(if *ok { "ok" } else { "error" });
                e["result"] = json!(excerpt);
            });
        }
        _ => {}
    }
}

fn run_claude(job: &Job, dir: &Path, r: &Request, on_event: &mut dyn FnMut(&Event)) -> Result<(Outcome, Result<Answer>)> {
    let exe = crate::claude::executable()?;
    let argv = argv(&exe, r);
    job.log(&format!("$ {}", preview(r).join(" ")));
    let mut last: Option<Final> = None;
    let mut raw: Vec<String> = Vec::new();
    let mut text = String::new();
    let mut session: Option<String> = None;
    let o = job.run_lines(&argv, dir, r.timeout, &[], false, &mut |line| {
        for ev in stream::parse_line(line) {
            match &ev {
                Event::Init { session_id, model } => {
                    session = Some(session_id.clone());
                    job.log(&format!("Claude Code démarré ({model})"));
                }
                Event::Delta(d) if r.partial => {
                    text.push_str(d);
                    job.set("partial", &text);
                }
                Event::Text(t) => {
                    if !r.partial {
                        text.push_str(t);
                        text.push('\n');
                    }
                    show(job, &ev);
                }
                Event::ToolUse { .. } | Event::ToolResult { .. } => show(job, &ev),
                Event::Result(f) => {
                    last = Some(f.clone());
                }
                Event::Raw(l) => {
                    job.log(l);
                    if raw.len() < 40 {
                        raw.push(l.clone());
                    }
                }
                Event::Delta(_) => {}
            }
            on_event(&ev);
        }
    })?;
    let answer = if o.cancelled {
        Err(AppError::new("cancelled", "Annulé"))
    } else if o.timed_out {
        Err(AppError::new("claude_failed", format!("Claude Code n'a pas fini dans le temps imparti ({} min).", r.timeout.as_secs() / 60)))
    } else {
        match last {
            Some(f) if f.ok => {
                let structured = f.structured.clone().or_else(|| r.json_schema.as_ref().and_then(|_| serde_json::from_str(crate::claude::fenced(&f.text, "json").trim()).ok()));
                Ok(Answer { text: if f.text.is_empty() { text.trim().to_string() } else { f.text.clone() }, cost_usd: f.cost_usd, turns: f.turns, session_id: f.session_id.clone().or(session), structured, denials: f.denials.clone() })
            }
            Some(f) => Err(AppError::new("claude_failed", stream::explain(&f))),
            None => Err(AppError::new("claude_failed", raw.iter().rev().find(|l| !l.trim().is_empty()).map(|l| stream::explain_raw(l)).unwrap_or_else(|| format!("Claude Code s'est arrêté sans réponse (code {}).", o.code.map(|c| c.to_string()).unwrap_or_else(|| "?".into()))))),
        }
    };
    if let Ok(a) = &answer {
        if let Some(c) = a.cost_usd {
            job.set("costUsd", c);
        }
        if !a.denials.is_empty() {
            job.log(&format!("Refusé par les règles de TekBoard : {}", a.denials.join(", ")));
        }
    }
    Ok((o, answer))
}

/// Ends a step from a Claude answer the same way everywhere: success with `ok_detail`,
/// or the error written in the step and in the summary (`error`).
pub fn end_step(job: &Job, step: &str, answer: &Result<Answer>, ok_detail: impl FnOnce(&Answer) -> String) {
    match answer {
        Ok(a) => job.end(step, "success", Some(ok_detail(a))),
        Err(e) if e.code() == "cancelled" => job.end(step, "cancelled", None),
        Err(e) => {
            job.set("error", e.to_string());
            job.end(step, "failed", Some(e.to_string()));
        }
    }
}

fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

pub fn new_session_id() -> String {
    // A random UUID v4 from the OS random source; no extra crate needed.
    let mut b = [0u8; 16];
    if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
        use std::io::Read;
        let _ = f.read_exact(&mut b);
    }
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
    format!("{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pos(a: &[String], s: &str) -> usize {
        a.iter().position(|x| x == s).unwrap_or_else(|| panic!("{s} missing in {a:?}"))
    }

    #[test]
    fn every_run_is_isolated_and_never_gets_a_shell() {
        for tools in [Tools::None, Tools::Read, Tools::ReadEdit(vec!["tests/**".into()])] {
            let a = argv("claude", &Request::new("x", tools, Duration::from_secs(5)));
            for flag in ["--restricted", "--strict-mcp-config", "--permission-prompts", "dontAsk", "stream-json"] {
                assert!(a.contains(&flag.to_string()), "{flag}: {a:?}");
            }
            assert!(!a.iter().any(|x| x.contains("Bash")), "no shell: {a:?}");
            assert_eq!(a[a.len() - 2..], ["--", "x"]);
        }
    }

    #[test]
    fn tool_lists_and_permissions() {
        let a = argv("claude", &Request::new("x", Tools::None, Duration::from_secs(5)));
        assert_eq!(a[pos(&a, "--tools") + 1], "", "an empty list disables every built-in tool");
        assert!(!a.contains(&"--allowedTools".to_string()));

        let mut r = Request::new("x", Tools::ReadEdit(vec!["tests/**".into(), "./Makefile".into()]), Duration::from_secs(5));
        r.mcp = Some(Mcp { config: "/tmp/m.json".into(), allow: vec!["exec".into()] });
        let a = argv("claude", &r);
        let allowed = &a[pos(&a, "--allowedTools") + 1..pos(&a, "--disallowedTools")];
        assert_eq!(allowed, ["Read", "Glob", "Grep", "Edit(./tests/**)", "Edit(./Makefile)", "mcp__tekboard__exec"]);
        assert!(!allowed.iter().any(|x| x == "Edit" || x == "Write"), "no blanket edit permission");
        assert_eq!(a[pos(&a, "--mcp-config") + 1], "/tmp/m.json");
    }

    #[test]
    fn sessions_and_options() {
        let mut r = Request::new("x", Tools::None, Duration::from_secs(5));
        assert!(argv("claude", &r).contains(&"--no-session-persistence".to_string()));
        r.session = Session::Start("u1".into());
        r.model = Some("sonnet".into());
        r.budget_usd = Some(0.5);
        r.partial = true;
        let a = argv("claude", &r);
        assert_eq!(a[pos(&a, "--session-id") + 1], "u1");
        assert_eq!(a[pos(&a, "--model") + 1], "sonnet");
        assert_eq!(a[pos(&a, "--max-budget-usd") + 1], "0.50");
        assert!(a.contains(&"--include-partial-messages".to_string()) && !a.contains(&"--no-session-persistence".to_string()));
        r.session = Session::Resume("u1".into());
        assert_eq!(argv("claude", &r)[pos(&argv("claude", &r), "--resume") + 1], "u1");
    }

    #[test]
    fn session_ids_are_uuids() {
        let id = new_session_id();
        assert_eq!(id.len(), 36);
        assert_eq!(&id[14..15], "4");
        assert_ne!(id, new_session_id());
    }
}
