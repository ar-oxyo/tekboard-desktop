//! Commands of the assistant (memory, journal, proposals) and of work sessions.

use crate::ai::{chat, memory, tools};
use crate::commands::AppState;
use crate::error::{AppError, Result};
use crate::focus;
use serde_json::{json, Value};
use tauri::State;

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

// ───────────────────────────── conversations ─────────────────────────────

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sent {
    pub thread_id: i64,
    pub job_id: u64,
}

#[tauri::command(async)]
pub fn ai_send(state: State<'_, AppState>, thread: Option<i64>, text: String, screen: chat::Screen) -> Result<Sent> {
    let (thread_id, job_id) = chat::send(&state, thread, &text, &screen)?;
    Ok(Sent { thread_id, job_id })
}

#[tauri::command(async)]
pub fn ai_threads(state: State<'_, AppState>) -> Result<Vec<chat::Thread>> {
    chat::threads(&state.conn())
}

#[tauri::command(async)]
pub fn ai_thread(state: State<'_, AppState>, id: i64) -> Result<Vec<chat::Message>> {
    chat::messages(&state.conn(), id)
}

#[tauri::command(async)]
pub fn ai_thread_delete(state: State<'_, AppState>, id: i64) -> Result<()> {
    chat::delete_thread(&state.conn(), id)
}

/// The context card Tika would receive now (shown in Settings → AI, for transparency).
#[tauri::command(async)]
pub fn ai_context_preview(state: State<'_, AppState>, screen: chat::Screen) -> Result<String> {
    chat::context_card(&state, &screen, None, 0)
}

#[tauri::command(async)]
pub fn ai_settings_get(state: State<'_, AppState>) -> Result<chat::AiSettings> {
    Ok(chat::AiSettings::load(&state.conn()))
}

#[tauri::command(async)]
pub fn ai_settings_set(state: State<'_, AppState>, settings: chat::AiSettings) -> Result<chat::AiSettings> {
    let conn = state.conn();
    settings.save(&conn)?;
    Ok(chat::AiSettings::load(&conn))
}

// ───────────────────────────── memory ─────────────────────────────

#[tauri::command(async)]
pub fn memory_list(state: State<'_, AppState>, scope: Option<String>, archived: Option<bool>) -> Result<Vec<memory::Memory>> {
    memory::list(&state.conn(), scope.as_deref(), archived.unwrap_or(false), now())
}

#[tauri::command(async)]
pub fn memory_add(state: State<'_, AppState>, scope: String, kind: String, content: String, pinned: bool) -> Result<memory::Memory> {
    match memory::add(&state.conn(), &scope, &kind, &content, "user", pinned, true, now())? {
        memory::Added::Saved { memory } => Ok(memory),
        memory::Added::Similar { .. } => Err(AppError::new("similar", "Un souvenir très proche existe déjà.")),
    }
}

#[tauri::command(async)]
pub fn memory_update(state: State<'_, AppState>, id: i64, patch: memory::Patch) -> Result<memory::Memory> {
    memory::update(&state.conn(), id, &patch, now())
}

#[tauri::command(async)]
pub fn memory_delete(state: State<'_, AppState>, id: i64) -> Result<()> {
    memory::delete(&state.conn(), id).map(|_| ())
}

// ───────────────────────────── journal and proposals ─────────────────────────────

#[tauri::command(async)]
pub fn ai_undo(state: State<'_, AppState>, id: i64) -> Result<String> {
    tools::undo(&state, id)
}

#[tauri::command(async)]
pub fn ai_actions(state: State<'_, AppState>, limit: Option<u32>) -> Result<Vec<Value>> {
    let conn = state.conn();
    let mut st = conn.prepare("SELECT id, thread_id, tool, summary, status, created_at FROM ai_actions ORDER BY id DESC LIMIT ?1")?;
    let rows = st.query_map([limit.unwrap_or(50).min(200)], |r| Ok(json!({"id": r.get::<_, i64>(0)?, "threadId": r.get::<_, Option<i64>>(1)?, "tool": r.get::<_, String>(2)?, "summary": r.get::<_, String>(3)?, "status": r.get::<_, String>(4)?, "at": r.get::<_, i64>(5)?})))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

#[tauri::command(async)]
pub fn ai_proposals(state: State<'_, AppState>, status: Option<String>) -> Result<Vec<Value>> {
    let conn = state.conn();
    let mut st = conn.prepare("SELECT id, thread_id, kind, title, rationale, payload, status, outcome, created_at FROM ai_proposals WHERE (?1 IS NULL OR status = ?1) ORDER BY id DESC LIMIT 40")?;
    let rows = st.query_map([status], |r| {
        Ok(json!({"id": r.get::<_, i64>(0)?, "threadId": r.get::<_, Option<i64>>(1)?, "kind": r.get::<_, String>(2)?, "title": r.get::<_, String>(3)?, "rationale": r.get::<_, String>(4)?, "payload": serde_json::from_str::<Value>(&r.get::<_, String>(5)?).unwrap_or(Value::Null), "status": r.get::<_, String>(6)?, "outcome": r.get::<_, Option<String>>(7)?.and_then(|o| serde_json::from_str::<Value>(&o).ok()), "at": r.get::<_, i64>(8)?}))
    })?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

#[tauri::command(async)]
pub fn ai_proposal_decide(state: State<'_, AppState>, id: i64, accept: bool, keep: Option<Vec<usize>>) -> Result<Value> {
    tools::decide(&state, id, accept, keep)
}

/// Runs one of Tika's tools from the window (suggestion buttons, palette): same rules,
/// same journal as when Tika calls it.
#[tauri::command(async)]
pub fn ai_tool(state: State<'_, AppState>, name: String, args: Value) -> Result<Value> {
    let caller = tools::Caller { allowed: tools::chat_tools(), ..Default::default() };
    tools::call(&state, &caller, &name, &args)
}

// ───────────────────────────── suggestions ─────────────────────────────

#[tauri::command(async)]
pub fn insights_list(state: State<'_, AppState>) -> Result<Vec<crate::ai::insights::Stored>> {
    crate::ai::insights::list(&state.conn(), now())
}

/// `dismiss` (for good), `snooze` (for `hours`), `done` (acted on).
#[tauri::command(async)]
pub fn insight_set(state: State<'_, AppState>, id: i64, status: String, hours: Option<i64>) -> Result<()> {
    let (st, until) = match status.as_str() {
        "dismiss" => ("dismissed", None),
        "snooze" => ("snoozed", Some(now() + hours.unwrap_or(3).clamp(1, 72) * 3600)),
        "done" => ("done", None),
        _ => return Err(AppError::new("invalid_args", "dismiss, snooze ou done")),
    };
    crate::ai::insights::set_status(&state.conn(), id, st, until, now())?;
    crate::notify::changed(&["insights"]);
    Ok(())
}

#[tauri::command(async)]
pub fn insights_refresh(state: State<'_, AppState>) -> Result<usize> {
    let n = crate::ai::insights::refresh(&state)?.len();
    crate::notify::changed(&["insights"]);
    Ok(n)
}

// ───────────────────────────── work sessions ─────────────────────────────

#[tauri::command(async)]
pub fn focus_get(state: State<'_, AppState>) -> Result<Option<focus::Focus>> {
    focus::current(&state.conn())
}

fn changed<T>(r: Result<T>) -> Result<T> {
    if r.is_ok() {
        crate::notify::changed(&["focus", "plan"]);
    }
    r
}

#[tauri::command(async)]
pub fn focus_start(state: State<'_, AppState>, start: focus::Start) -> Result<focus::Focus> {
    changed(focus::start(&state.conn(), &start, now()))
}

#[tauri::command(async)]
pub fn focus_pause(state: State<'_, AppState>) -> Result<focus::Focus> {
    changed(focus::pause(&state.conn(), now()))
}

#[tauri::command(async)]
pub fn focus_resume(state: State<'_, AppState>) -> Result<focus::Focus> {
    changed(focus::resume(&state.conn(), now()))
}

#[tauri::command(async)]
pub fn focus_extend(state: State<'_, AppState>, minutes: i64) -> Result<focus::Focus> {
    changed(focus::extend(&state.conn(), minutes, now()))
}

#[tauri::command(async)]
pub fn focus_stop(state: State<'_, AppState>, done: bool) -> Result<focus::Focus> {
    changed(focus::stop(&state.conn(), if done { "done" } else { "stopped" }, now(), done))
}

#[tauri::command(async)]
pub fn focus_discard(state: State<'_, AppState>) -> Result<()> {
    let conn = state.conn();
    let f = focus::current(&conn)?.ok_or_else(|| AppError::new("no_focus", "Aucune session en cours."))?;
    changed(focus::discard(&conn, f.id, now()))
}

#[tauri::command(async)]
pub fn focus_stats(state: State<'_, AppState>, from: i64, to: i64) -> Result<focus::Stats> {
    focus::stats(&state.conn(), from, to)
}

/// Background: the work-session clock (every 30 s), memory upkeep (hourly).
pub fn start_background(app: tauri::AppHandle) {
    use tauri::Manager;
    std::thread::spawn(move || {
        let mut first = true;
        let mut ticks: u64 = 0;
        loop {
            if let Some(state) = app.try_state::<AppState>() {
                let notices = focus::tick(&state.conn(), now(), first).unwrap_or_default();
                for n in &notices {
                    crate::notify::emit("focus-notice", n);
                }
                if !notices.is_empty() {
                    crate::notify::changed(&["focus", "plan"]);
                }
                // Suggestions: a minute after start, then every five minutes.
                if ticks % 10 == 2 {
                    if let Ok(new) = crate::ai::insights::refresh(&state) {
                        crate::notify::changed(&["insights"]);
                        if !new.is_empty() {
                            crate::notify::emit("insights-new", new);
                        }
                    }
                }
                if ticks % 120 == 0 {
                    let _ = memory::purge_expired(&state.conn(), now());
                    let _ = state.conn().execute("DELETE FROM ai_messages WHERE created_at < ?1", [now() - 30 * 86_400]);
                    let _ = state.conn().execute("DELETE FROM ai_threads WHERE updated_at < ?1", [now() - 30 * 86_400]);
                }
                first = false;
                ticks += 1;
            }
            std::thread::sleep(std::time::Duration::from_secs(30));
        }
    });
}
