//! Conversations with Artix.
//!
//! A turn is one Claude Code run (`runner`) with no built-in tool and TekBoard's tools over MCP.
//! The conversation continues through Claude Code's own session (`--session-id`, then
//! `--resume`), so earlier turns are not re-sent by TekBoard. Each turn starts with a small
//! context card (≈ 1–2 k tokens): the screen, the day, the next hand-ins, the running session,
//! the most useful memories and what the user decided since the last turn. Anything else is
//! fetched by Artix through its tools, only when needed.
//!
//! Messages are kept 30 days (temporary history); durable facts live in `memory`.

use super::{ipc, memory, runner, tools};
use crate::commands::AppState;
use crate::error::{AppError, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

pub const MAX_QUESTION: usize = 6000;

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Screen {
    /// `today`, `projects`, `planning`, `school`, `stats`, `resources`, `settings`.
    pub page: String,
    /// Project open on screen (its key).
    pub project: Option<String>,
    pub tab: Option<String>,
    /// What the user selected (an entry, a report), in a few words.
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Thread {
    pub id: i64,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub messages: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: i64,
    pub role: String,
    pub text: String,
    pub meta: Value,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AiSettings {
    /// `none`, `claude`, `openrouter` or `ollama` (see `provider`). Empty in settings saved
    /// before 0.7: set once at start (`provider::migrate`).
    pub provider: String,
    /// Model alias for conversations (`sonnet`, `opus`, `haiku`, or a full name; empty = Claude Code's default).
    pub chat_model: String,
    /// Model for agents (moulinette, test generation, subject analysis).
    pub agent_model: String,
    /// Spending limit per agent task, in dollars (0 = none).
    pub agent_budget_usd: f64,
    /// Minutes an agent may run.
    pub agent_minutes: i64,
    /// Analyse new subjects without asking.
    pub auto_analyze: bool,
    /// OpenRouter model id (`qwen/qwen3-coder:free`…).
    pub openrouter_model: String,
    /// Paid OpenRouter models may be used. Only ever set by the user, after a confirmation.
    pub allow_paid: bool,
    /// Ollama model (`qwen2.5:7b`…) and where the service answers.
    pub ollama_model: String,
    pub ollama_url: String,
}

impl Default for AiSettings {
    fn default() -> Self {
        AiSettings { provider: String::new(), chat_model: "sonnet".into(), agent_model: "opus".into(), agent_budget_usd: 0.0, agent_minutes: 15, auto_analyze: false, openrouter_model: String::new(), allow_paid: false, ollama_model: String::new(), ollama_url: super::ollama::DEFAULT_URL.into() }
    }
}

/// A model name as providers write them (`sonnet`, `qwen/qwen3:free`, `qwen2.5:7b`), nothing else.
pub fn clean_model(m: &str) -> String {
    m.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '[' | ']' | '_' | '/' | ':' | '@')).take(100).collect()
}

impl AiSettings {
    pub fn load(conn: &Connection) -> AiSettings {
        crate::db::get_setting(conn, "ai_settings").ok().flatten().and_then(|v| serde_json::from_str(&v).ok()).unwrap_or_default()
    }
    pub fn save(&self, conn: &Connection) -> Result<()> {
        let provider = super::provider::Kind::parse(&self.provider).map(|k| k.id().to_string()).unwrap_or_default();
        let s = AiSettings {
            provider,
            chat_model: clean_model(&self.chat_model),
            agent_model: clean_model(&self.agent_model),
            agent_budget_usd: self.agent_budget_usd.clamp(0.0, 50.0),
            agent_minutes: self.agent_minutes.clamp(3, 60),
            auto_analyze: self.auto_analyze,
            openrouter_model: clean_model(&self.openrouter_model),
            allow_paid: self.allow_paid,
            ollama_model: clean_model(&self.ollama_model),
            ollama_url: super::ollama::clean_url(&self.ollama_url).unwrap_or_else(|| super::ollama::DEFAULT_URL.into()),
        };
        crate::db::set_setting(conn, "ai_settings", &serde_json::to_string(&s)?)?;
        super::provider::set_current(&s);
        Ok(())
    }
}

/// The last turns of a thread, oldest first, for providers that keep no session.
fn history(conn: &Connection, thread: i64, max: usize) -> Result<Vec<(String, String)>> {
    let mut st = conn.prepare("SELECT role, text FROM ai_messages WHERE thread_id = ?1 AND role IN ('user', 'assistant') ORDER BY id DESC LIMIT ?2")?;
    let mut rows: Vec<(String, String)> = st.query_map(params![thread, max as i64], |r| Ok((r.get::<_, String>(0)?, crate::ai::stream::clip(&r.get::<_, String>(1)?, 4000))))?.collect::<std::result::Result<_, _>>()?;
    rows.reverse();
    Ok(rows)
}

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

pub fn threads(conn: &Connection) -> Result<Vec<Thread>> {
    let mut st = conn.prepare("SELECT t.id, t.title, t.created_at, t.updated_at, (SELECT COUNT(*) FROM ai_messages m WHERE m.thread_id = t.id) FROM ai_threads t ORDER BY t.updated_at DESC LIMIT 50")?;
    let rows = st.query_map([], |r| Ok(Thread { id: r.get(0)?, title: r.get(1)?, created_at: r.get(2)?, updated_at: r.get(3)?, messages: r.get(4)? }))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

pub fn messages(conn: &Connection, thread: i64) -> Result<Vec<Message>> {
    let mut st = conn.prepare("SELECT id, role, text, meta, created_at FROM ai_messages WHERE thread_id = ?1 ORDER BY id")?;
    let rows = st.query_map([thread], |r| Ok(Message { id: r.get(0)?, role: r.get(1)?, text: r.get(2)?, meta: serde_json::from_str(&r.get::<_, String>(3)?).unwrap_or(json!({})), created_at: r.get(4)? }))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

pub fn delete_thread(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM ai_messages WHERE thread_id = ?1", [id])?;
    conn.execute("DELETE FROM ai_threads WHERE id = ?1", [id])?;
    Ok(())
}

fn add_message(conn: &Connection, thread: i64, role: &str, text: &str, meta: &Value) -> Result<i64> {
    let t = now();
    conn.execute("INSERT INTO ai_messages (thread_id, role, text, meta, created_at) VALUES (?1, ?2, ?3, ?4, ?5)", params![thread, role, text, meta.to_string(), t])?;
    let id = conn.last_insert_rowid();
    conn.execute("UPDATE ai_threads SET updated_at = ?2 WHERE id = ?1", params![thread, t])?;
    Ok(id)
}

fn title_from(text: &str) -> String {
    let t: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    crate::ai::stream::clip(&t, 60)
}

/// What the user decided since the last turn of this thread (proposals, undone actions):
/// Artix must not believe a proposal was applied when it was refused.
fn decisions_since(conn: &Connection, thread: i64, since: i64) -> Result<Vec<String>> {
    let mut out = Vec::new();
    let mut st = conn.prepare("SELECT id, title, status, outcome FROM ai_proposals WHERE thread_id = ?1 AND decided_at >= ?2 ORDER BY id")?;
    for r in st.query_map(params![thread, since], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, Option<String>>(3)?)))? {
        let (id, title, status, outcome) = r?;
        let detail = outcome.and_then(|o| serde_json::from_str::<Value>(&o).ok()).map(|o| if o["accepted"] == true { format!(" ({} sur {} changements appliqués)", o["kept"], o["of"]) } else { String::new() }).unwrap_or_default();
        out.push(format!("Proposition #{id} « {title} » : {}{detail}.", if status == "accepted" { "acceptée" } else { "refusée" }));
    }
    let mut st = conn.prepare("SELECT summary FROM ai_actions WHERE thread_id = ?1 AND status = 'undone' AND created_at >= ?2")?;
    for r in st.query_map(params![thread, since - 3600], |r| r.get::<_, String>(0))? {
        out.push(format!("L'utilisateur a annulé : {}.", r?));
    }
    let pending: i64 = conn.query_row("SELECT COUNT(*) FROM ai_proposals WHERE thread_id = ?1 AND status = 'pending'", [thread], |r| r.get(0))?;
    if pending > 0 {
        out.push(format!("{pending} proposition(s) attendent encore sa décision."));
    }
    Ok(out)
}

/// The context card given at the start of a turn.
pub fn context_card(state: &AppState, screen: &Screen, thread: Option<i64>, since: i64) -> Result<String> {
    let mut lines: Vec<String> = Vec::new();
    let t = now();
    let day = crate::schedule::day_of(t);
    lines.push(format!("[Contexte TekBoard · {} · {}]", crate::schedule::day_label(day), &crate::schedule::local_iso(t)[11..]));
    let page = match screen.page.as_str() {
        "today" => "Aujourd'hui",
        "projects" => "Projets",
        "planning" => "Planning",
        "school" => "École",
        "stats" => "Stats",
        "lab" => "Labo (Code Playground, Algorithm Arena)",
        "connect" => "TekBoard Connect (personnes du réseau local)",
        "resources" => "Ressources",
        "settings" => "Réglages",
        _ => "TekBoard",
    };
    let mut on = format!("Écran : {page}");
    if let Some(p) = &screen.project {
        on.push_str(&format!(" · projet {p}"));
    }
    if let Some(tab) = &screen.tab {
        on.push_str(&format!(" · onglet {tab}"));
    }
    if let Some(d) = &screen.detail {
        on.push_str(&format!(" · {}", crate::ai::stream::clip(d, 120)));
    }
    lines.push(on);
    if state.settings().map(|s| s.language == "en").unwrap_or(false) {
        lines.push("Langue de l'utilisateur : anglais. Réponds en anglais, intitulés de tâches et d'entrées compris.".into());
    }
    // The day, from the same engine as the tools (cheap: the repository scan is shared).
    if let Ok((repos, overview)) = crate::commands::load_repos(state) {
        let board = crate::projects::board(&repos, &overview, chrono::Utc::now());
        let conn = state.conn();
        let agenda = crate::mydata::agenda(&conn, &overview, &board);
        let plan = crate::planner::state(&conn, t)?;
        let rhythm = crate::schedule::Rhythm::load(&conn);
        let busy = crate::schedule::busy_from(&plan.events, &agenda.items);
        let load = crate::schedule::day_load(&busy, &rhythm, day);
        let next: Vec<String> = busy.iter().filter(|b| b.end > t && b.start < crate::schedule::next_day(day) && b.kind != "protected").take(4).map(|b| format!("{} {}", &crate::schedule::local_iso(b.start)[11..], b.title)).collect();
        lines.push(format!("Aujourd'hui : {} de travail prévu{} (plafond {}, rythme {}){}", crate::schedule::dur(load.work_min), if load.school_min > 0 { format!(" + {} d'école", crate::schedule::dur(load.school_min)) } else { String::new() }, crate::schedule::dur(load.max_min), crate::schedule::mode_label(&rhythm.mode), if next.is_empty() { String::new() } else { format!(" ; à venir : {}", next.join(", ")) }));
        let soon: Vec<String> = board.iter().filter(|b| b.state != "unknown" && b.status != "done").take(3).map(|b| format!("{} ({}{})", b.title, b.at.clone().or(b.day.clone()).unwrap_or_default().chars().take(16).collect::<String>(), if b.state == "overdue" { ", en retard" } else { "" })).collect();
        if !soon.is_empty() {
            lines.push(format!("Rendus proches : {}", soon.join(" ; ")));
        }
    }
    let conn = state.conn();
    if let Some(f) = crate::focus::current(&conn)? {
        lines.push(format!("Session en cours : « {} », {} min sur {}{}", f.title, f.elapsed(t) / 60, f.planned_min, if f.paused_at.is_some() { " (en pause)" } else { "" }));
    }
    let mems = memory::context_lines(&conn, screen.project.as_deref(), 1800, t)?;
    if !mems.is_empty() {
        lines.push("Souvenirs :".into());
        lines.extend(mems.into_iter().map(|m| format!("- {m}")));
    }
    if let Some(th) = thread {
        let d = decisions_since(&conn, th, since)?;
        if !d.is_empty() {
            lines.push("Depuis ton dernier message :".into());
            lines.extend(d.into_iter().map(|m| format!("- {m}")));
        }
    }
    lines.push("[Fin du contexte]".into());
    Ok(lines.join("\n"))
}

/// Starts a turn. Returns `(thread id, job id)`; the answer arrives through the job.
pub fn send(state: &AppState, thread: Option<i64>, text: &str, screen: &Screen) -> Result<(i64, u64)> {
    let text = text.trim();
    if text.is_empty() || text.len() > MAX_QUESTION {
        return Err(AppError::new("invalid_question", format!("Écris une demande de {MAX_QUESTION} caractères au plus.")));
    }
    let kind = super::provider::require(super::provider::Feature::Chat)?;
    let t = now();
    let (thread, session, last_turn) = {
        let conn = state.conn();
        let id = match thread {
            Some(id) if conn.query_row("SELECT 1 FROM ai_threads WHERE id = ?1", [id], |_| Ok(())).optional()?.is_some() => id,
            _ => {
                conn.execute("INSERT INTO ai_threads (title, created_at, updated_at) VALUES (?1, ?2, ?2)", params![title_from(text), t])?;
                conn.last_insert_rowid()
            }
        };
        let session: Option<String> = conn.query_row("SELECT session_id FROM ai_threads WHERE id = ?1", [id], |r| r.get(0))?;
        let last: i64 = conn.query_row("SELECT COALESCE(MAX(created_at), 0) FROM ai_messages WHERE thread_id = ?1 AND role = 'assistant'", [id], |r| r.get(0))?;
        (id, session, last)
    };
    let key = format!("thread:{thread}");
    if state.jobs.active("assistant", Some(&key)).is_some() {
        return Err(AppError::new("busy", "Artix répond déjà dans cette conversation : attends la réponse ou interromps-la."));
    }
    let card = context_card(state, screen, Some(thread), last_turn)?;
    let (persona, settings, past) = {
        let conn = state.conn();
        // Earlier turns, for providers without a session of their own (read before this one is added).
        let past = if kind == super::provider::Kind::Claude { Vec::new() } else { history(&conn, thread, 16)? };
        add_message(&conn, thread, "user", text, &json!({"screen": screen}))?;
        (crate::prompts::template(&conn, crate::prompts::PERSONA)?, AiSettings::load(&conn), past)
    };
    crate::notify::changed(&["ai"]);
    let grant = ipc::grant(&state.cache_dir, tools::Caller { thread_id: Some(thread), allowed: tools::chat_tools(), ..Default::default() })?;
    let dir = state.cache_dir.join("assistant");
    std::fs::create_dir_all(&dir)?;
    let mut req = runner::Request::new(format!("{card}\n\n{text}"), runner::Tools::None, Duration::from_secs(600));
    req.system = Some(persona);
    req.mcp = Some(runner::Mcp { config: grant.config.clone(), allow: vec!["*".into()] });
    req.model = Some(settings.chat_model.clone()).filter(|m| !m.is_empty());
    req.partial = true;
    req.history = past;
    let new_session = session.is_none();
    let session_id = session.unwrap_or_else(runner::new_session_id);
    req.session = if new_session { runner::Session::Start(session_id.clone()) } else { runner::Session::Resume(session_id.clone()) };
    let db = state.db.clone();
    let title = format!("Artix · {}", title_from(text));
    let job = state.jobs.start(state.db.clone(), "assistant", Some(key), title, &[("answer", "Artix réfléchit")], move |job| {
        let _grant = grant;
        job.start("answer");
        job.set("threadId", thread);
        let (o, answer) = runner::run(job, &dir, &req, &mut |_| {})?;
        let conn = db.lock().unwrap_or_else(|e| e.into_inner());
        // The tool calls of this turn, for the conversation view.
        let steps: Vec<Value> = job_events(job).into_iter().filter(|e| e["kind"] == "tool").map(|e| json!({"label": e["label"], "detail": e["detail"], "status": e["status"], "tool": e["tool"]})).collect();
        let proposals: Vec<i64> = {
            let mut st = conn.prepare("SELECT id FROM ai_proposals WHERE thread_id = ?1 AND created_at >= ?2 ORDER BY id")?;
            let r = st.query_map(params![thread, t], |r| r.get::<_, i64>(0))?.collect::<std::result::Result<Vec<_>, _>>()?;
            r
        };
        let actions: Vec<i64> = {
            let mut st = conn.prepare("SELECT id FROM ai_actions WHERE thread_id = ?1 AND created_at >= ?2 ORDER BY id")?;
            let r = st.query_map(params![thread, t], |r| r.get::<_, i64>(0))?.collect::<std::result::Result<Vec<_>, _>>()?;
            r
        };
        let status = match &answer {
            Ok(a) => {
                conn.execute("UPDATE ai_threads SET session_id = ?2 WHERE id = ?1", params![thread, a.session_id.clone().unwrap_or(session_id.clone())])?;
                add_message(&conn, thread, "assistant", &a.text, &json!({"steps": steps, "proposals": proposals, "actions": actions, "costUsd": a.cost_usd}))?;
                job.set("reply", &a.text);
                "success"
            }
            Err(e) if o.cancelled || e.code() == "cancelled" => {
                add_message(&conn, thread, "system", "Réponse interrompue.", &json!({"steps": steps, "proposals": proposals, "actions": actions}))?;
                "cancelled"
            }
            Err(e) => {
                // A resumed session that Claude Code no longer has: the next turn starts a new one.
                if !new_session && e.to_string().to_lowercase().contains("session") {
                    conn.execute("UPDATE ai_threads SET session_id = NULL WHERE id = ?1", [thread])?;
                }
                add_message(&conn, thread, "system", &format!("Artix n'a pas pu répondre : {e}"), &json!({"steps": steps, "proposals": proposals, "actions": actions, "error": true}))?;
                "failed"
            }
        };
        drop(conn);
        runner::end_step(job, "answer", &answer, |a| a.turns.map(|n| format!("{n} étape(s)")).unwrap_or_default());
        crate::notify::changed(&["ai"]);
        Ok(status)
    });
    Ok((thread, job))
}

fn job_events(job: &crate::jobs::Job) -> Vec<Value> {
    job.events()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decisions_reach_the_next_turn() {
        let c = crate::db::open_in_memory().unwrap();
        c.execute("INSERT INTO ai_threads (title, created_at, updated_at) VALUES ('t', 0, 0)", []).unwrap();
        c.execute("INSERT INTO ai_proposals (thread_id, kind, title, payload, status, outcome, created_at, decided_at) VALUES (1, 'schedule', 'Semaine', '{}', 'rejected', '{\"accepted\":false}', 10, 20)", []).unwrap();
        c.execute("INSERT INTO ai_proposals (thread_id, kind, title, payload, status, outcome, created_at, decided_at) VALUES (1, 'schedule', 'Jeudi', '{}', 'accepted', '{\"accepted\":true,\"kept\":2,\"of\":3}', 10, 30)", []).unwrap();
        c.execute("INSERT INTO ai_proposals (thread_id, kind, title, payload, created_at) VALUES (1, 'schedule', 'Vendredi', '{}', 40)", []).unwrap();
        let d = decisions_since(&c, 1, 15).unwrap();
        assert!(d[0].contains("Semaine") && d[0].contains("refusée"), "{d:?}");
        assert!(d[1].contains("2 sur 3"), "{d:?}");
        assert!(d[2].contains("attendent"), "{d:?}");
        assert!(decisions_since(&c, 1, 35).unwrap().iter().all(|l| !l.contains("Semaine")), "older decisions are not repeated");
    }

    #[test]
    fn settings_of_older_versions_still_load() {
        let c = crate::db::open_in_memory().unwrap();
        crate::db::set_setting(&c, "ai_settings", r#"{"chatModel":"opus","agentModel":"opus","agentBudgetUsd":2.0,"agentMinutes":20,"autoAnalyze":true}"#).unwrap();
        let s = AiSettings::load(&c);
        assert_eq!((s.chat_model.as_str(), s.agent_minutes, s.auto_analyze, s.provider.as_str()), ("opus", 20, true, ""));
        assert_eq!(s.ollama_url, "http://localhost:11434");
    }

    #[test]
    fn history_is_oldest_first_and_bounded() {
        let c = crate::db::open_in_memory().unwrap();
        c.execute("INSERT INTO ai_threads (title, created_at, updated_at) VALUES ('t', 0, 0)", []).unwrap();
        for (i, role) in ["user", "assistant", "system", "user", "assistant"].iter().enumerate() {
            add_message(&c, 1, role, &format!("m{i}"), &json!({})).unwrap();
        }
        let h = history(&c, 1, 3).unwrap();
        assert_eq!(h, vec![("assistant".to_string(), "m1".to_string()), ("user".into(), "m3".into()), ("assistant".into(), "m4".into())], "system notes are left out");
    }

    #[test]
    fn settings_are_bounded() {
        let c = crate::db::open_in_memory().unwrap();
        AiSettings { chat_model: "sonnet; rm -rf".into(), agent_model: "opus".into(), agent_budget_usd: 999.0, agent_minutes: 0, auto_analyze: true, provider: "bogus".into(), openrouter_model: "qwen/qwen3-coder:free".into(), ollama_model: "qwen2.5:7b".into(), ollama_url: "file:///etc".into(), allow_paid: false }.save(&c).unwrap();
        let s = AiSettings::load(&c);
        assert_eq!((s.chat_model.as_str(), s.agent_budget_usd, s.agent_minutes), ("sonnetrm-rf", 50.0, 3));
        assert_eq!((s.openrouter_model.as_str(), s.ollama_model.as_str()), ("qwen/qwen3-coder:free", "qwen2.5:7b"), "provider model names keep / and :");
        assert_eq!((s.provider.as_str(), s.ollama_url.as_str()), ("", "http://localhost:11434"), "unknown values are not kept");
        assert_eq!(title_from("  Organise   ma\njournée "), "Organise ma journée");
    }
}
