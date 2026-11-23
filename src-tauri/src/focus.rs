//! Work sessions, kept by the backend so they can never stay open by accident.
//!
//! - A session has a planned length. When it is reached, the window is told (`focus-due`) and
//!   offers to extend or finish; without an answer within the grace period, the session is
//!   closed at its planned end (`auto_overrun`), not hours later.
//! - Time does not run while the computer sleeps or TekBoard is closed: a gap between two
//!   ticks pauses the session at the last tick (`auto_sleep`), and at start-up a session left
//!   open is closed at the last moment TekBoard saw it.
//! - No session lasts more than four hours.
//! - Ending a session logs the time worked (once) and can mark its calendar entry done.

use crate::error::{AppError, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Answer expected after the planned end before closing at the planned end.
pub const GRACE_S: i64 = 15 * 60;
/// A gap this long between two ticks means the computer slept (or the app was closed).
pub const SLEEP_GAP_S: i64 = 120;
pub const MAX_S: i64 = 4 * 3600;
/// Continuous work after which a break is suggested.
pub const BREAK_AFTER_S: i64 = 90 * 60;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Focus {
    pub id: i64,
    pub title: String,
    pub project: Option<String>,
    pub task_id: Option<i64>,
    pub event_id: Option<i64>,
    pub started_at: i64,
    pub planned_min: i64,
    pub paused_at: Option<i64>,
    pub paused_total_s: i64,
    pub last_seen_at: i64,
    pub due_notified: bool,
    /// What comes next in a mixed session ("25 min of the project, then 10 min of something else").
    pub then_title: Option<String>,
    pub then_min: Option<i64>,
    pub ended_at: Option<i64>,
    /// `done`, `stopped`, `auto_overrun`, `auto_sleep`, `auto_closed`, `max`, `discarded`.
    pub end_reason: Option<String>,
    pub seconds: Option<i64>,
}

impl Focus {
    /// Seconds worked so far (pauses excluded).
    pub fn elapsed(&self, now: i64) -> i64 {
        let until = self.ended_at.or(self.paused_at).unwrap_or(now);
        (until - self.started_at - self.paused_total_s).max(0)
    }
    pub fn planned_s(&self) -> i64 {
        self.planned_min * 60
    }
    pub fn running(&self) -> bool {
        self.ended_at.is_none()
    }
}

const COLS: &str = "id, title, project, task_id, event_id, started_at, planned_min, paused_at, paused_total_s, last_seen_at, due_notified, then_title, then_min, ended_at, end_reason, seconds";

fn row(r: &rusqlite::Row) -> rusqlite::Result<Focus> {
    Ok(Focus {
        id: r.get(0)?,
        title: r.get(1)?,
        project: r.get(2)?,
        task_id: r.get(3)?,
        event_id: r.get(4)?,
        started_at: r.get(5)?,
        planned_min: r.get(6)?,
        paused_at: r.get(7)?,
        paused_total_s: r.get(8)?,
        last_seen_at: r.get(9)?,
        due_notified: r.get::<_, i64>(10)? != 0,
        then_title: r.get(11)?,
        then_min: r.get(12)?,
        ended_at: r.get(13)?,
        end_reason: r.get(14)?,
        seconds: r.get(15)?,
    })
}

pub fn current(conn: &Connection) -> Result<Option<Focus>> {
    Ok(conn.query_row(&format!("SELECT {COLS} FROM focus_sessions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1"), [], row).optional()?)
}

pub fn get(conn: &Connection, id: i64) -> Result<Focus> {
    conn.query_row(&format!("SELECT {COLS} FROM focus_sessions WHERE id = ?1"), [id], row).map_err(|_| AppError::new("not_found", "Session introuvable"))
}

/// The running session as Tika sees it.
pub fn current_json(conn: &Connection) -> Value {
    let now = chrono::Utc::now().timestamp();
    match current(conn).ok().flatten() {
        Some(f) => json!({"titre": f.title, "projet": f.project, "depuis": crate::schedule::local_iso(f.started_at), "minutesFaites": f.elapsed(now) / 60, "minutesPrevues": f.planned_min, "enPause": f.paused_at.is_some(), "ensuite": f.then_title}),
        None => Value::Null,
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Start {
    pub title: String,
    pub project: Option<String>,
    pub task_id: Option<i64>,
    pub event_id: Option<i64>,
    pub minutes: i64,
    pub then_title: Option<String>,
    pub then_min: Option<i64>,
}

pub fn start(conn: &Connection, s: &Start, now: i64) -> Result<Focus> {
    if let Some(f) = current(conn)? {
        return Err(AppError::new("busy", format!("Une session est déjà en cours : « {} ». Termine-la d'abord.", f.title)));
    }
    let title = s.title.trim();
    if title.is_empty() {
        return Err(AppError::new("invalid_focus", "Donne un titre à la session."));
    }
    let minutes = s.minutes.clamp(5, MAX_S / 60);
    conn.execute(
        "INSERT INTO focus_sessions (title, project, task_id, event_id, started_at, planned_min, last_seen_at, then_title, then_min) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?5, ?7, ?8)",
        params![title, s.project, s.task_id, s.event_id, now, minutes, s.then_title.as_deref().map(str::trim).filter(|t| !t.is_empty()), s.then_min.map(|m| m.clamp(5, 60))],
    )?;
    get(conn, conn.last_insert_rowid())
}

pub fn pause(conn: &Connection, now: i64) -> Result<Focus> {
    let f = current(conn)?.ok_or_else(none)?;
    if f.paused_at.is_none() {
        conn.execute("UPDATE focus_sessions SET paused_at = ?2, last_seen_at = ?2 WHERE id = ?1", params![f.id, now])?;
    }
    get(conn, f.id)
}

pub fn resume(conn: &Connection, now: i64) -> Result<Focus> {
    let f = current(conn)?.ok_or_else(none)?;
    if let Some(p) = f.paused_at {
        conn.execute("UPDATE focus_sessions SET paused_at = NULL, paused_total_s = paused_total_s + ?2, last_seen_at = ?3 WHERE id = ?1", params![f.id, (now - p).max(0), now])?;
    }
    get(conn, f.id)
}

/// More time: the planned length grows, the "time is up" question will come again.
pub fn extend(conn: &Connection, minutes: i64, now: i64) -> Result<Focus> {
    let f = current(conn)?.ok_or_else(none)?;
    let total = (f.elapsed(now) / 60).max(f.planned_min) + minutes.clamp(5, 120);
    conn.execute("UPDATE focus_sessions SET planned_min = ?2, due_notified = 0, last_seen_at = ?3 WHERE id = ?1", params![f.id, total.min(MAX_S / 60), now])?;
    get(conn, f.id)
}

fn none() -> AppError {
    AppError::new("no_focus", "Aucune session en cours.")
}

/// Ends the running session at `at` (normally now). Logs the time once and, when `done`,
/// marks the calendar entry and the task as done.
pub fn stop(conn: &Connection, reason: &str, at: i64, done: bool) -> Result<Focus> {
    let f = current(conn)?.ok_or_else(none)?;
    close(conn, &f, reason, at, done)
}

fn close(conn: &Connection, f: &Focus, reason: &str, at: i64, done: bool) -> Result<Focus> {
    let mut end = at.max(f.started_at);
    let paused_extra = f.paused_at.map(|p| (end - p).max(0)).unwrap_or(0);
    let mut seconds = (end - f.started_at - f.paused_total_s - paused_extra).max(0);
    if seconds > MAX_S {
        end -= seconds - MAX_S;
        seconds = MAX_S;
    }
    conn.execute("UPDATE focus_sessions SET ended_at = ?2, end_reason = ?3, seconds = ?4, paused_at = NULL, paused_total_s = paused_total_s + ?5 WHERE id = ?1", params![f.id, end, reason, seconds, paused_extra])?;
    if seconds >= 60 {
        let w = crate::planner::log_work(conn, f.project.as_deref(), f.task_id, &f.title, f.started_at, seconds)?;
        conn.execute("UPDATE work_log SET event_id = ?2 WHERE id = ?1", params![w.id, f.event_id])?;
    }
    if done {
        if let Some(e) = f.event_id {
            conn.execute("UPDATE plan_events SET done = 1 WHERE id = ?1", [e])?;
        }
        if let Some(t) = f.task_id {
            conn.execute("UPDATE tasks SET done_at = ?2 WHERE id = ?1 AND done_at IS NULL", params![t, at])?;
        }
    }
    get(conn, f.id)
}

/// Cancels a session as if it never happened (also the undo of "start a session").
pub fn discard(conn: &Connection, id: i64, now: i64) -> Result<()> {
    let f = get(conn, id)?;
    if f.running() {
        conn.execute("UPDATE focus_sessions SET ended_at = ?2, end_reason = 'discarded', seconds = 0 WHERE id = ?1", params![id, now])?;
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Notice {
    /// The planned length is reached.
    Due { id: i64, title: String, then_title: Option<String> },
    /// Closed at its planned end: nobody answered.
    Closed { id: i64, title: String, reason: String, minutes: i64 },
    /// The computer slept: paused at the last tick.
    Paused { id: i64, title: String },
    /// Long stretch without a break.
    Break { id: i64, minutes: i64 },
}

/// Called every 30 s by the app (and once at start-up with `startup: true`).
pub fn tick(conn: &Connection, now: i64, startup: bool) -> Result<Vec<Notice>> {
    let Some(f) = current(conn)? else { return Ok(vec![]) };
    let mut out = Vec::new();
    let gap = now - f.last_seen_at;
    if gap > SLEEP_GAP_S && f.paused_at.is_none() {
        if startup {
            // TekBoard was closed: the session ends where TekBoard last saw it.
            let c = close(conn, &f, "auto_closed", f.last_seen_at, false)?;
            out.push(Notice::Closed { id: f.id, title: f.title.clone(), reason: "auto_closed".into(), minutes: c.seconds.unwrap_or(0) / 60 });
            return Ok(out);
        }
        conn.execute("UPDATE focus_sessions SET paused_at = ?2 WHERE id = ?1", params![f.id, f.last_seen_at])?;
        out.push(Notice::Paused { id: f.id, title: f.title.clone() });
        conn.execute("UPDATE focus_sessions SET last_seen_at = ?2 WHERE id = ?1", params![f.id, now])?;
        return Ok(out);
    }
    conn.execute("UPDATE focus_sessions SET last_seen_at = ?2 WHERE id = ?1", params![f.id, now])?;
    if f.paused_at.is_some() {
        // A pause left for hours ends the session too.
        if now - f.paused_at.unwrap_or(now) > 2 * 3600 {
            let c = close(conn, &f, "stopped", now, false)?;
            out.push(Notice::Closed { id: f.id, title: f.title.clone(), reason: "stopped".into(), minutes: c.seconds.unwrap_or(0) / 60 });
        }
        return Ok(out);
    }
    let elapsed = f.elapsed(now);
    if elapsed >= MAX_S {
        let c = close(conn, &f, "max", now, false)?;
        out.push(Notice::Closed { id: f.id, title: f.title.clone(), reason: "max".into(), minutes: c.seconds.unwrap_or(0) / 60 });
    } else if elapsed >= f.planned_s() + GRACE_S {
        // Closed at the planned end, not now: the extra quarter of an hour was not worked for sure.
        let end = now - (elapsed - f.planned_s());
        let c = close(conn, &f, "auto_overrun", end, false)?;
        out.push(Notice::Closed { id: f.id, title: f.title.clone(), reason: "auto_overrun".into(), minutes: c.seconds.unwrap_or(0) / 60 });
    } else if elapsed >= f.planned_s() && !f.due_notified {
        conn.execute("UPDATE focus_sessions SET due_notified = 1 WHERE id = ?1", [f.id])?;
        out.push(Notice::Due { id: f.id, title: f.title.clone(), then_title: f.then_title.clone() });
    } else if elapsed >= BREAK_AFTER_S && (elapsed - 30) < BREAK_AFTER_S {
        out.push(Notice::Break { id: f.id, minutes: elapsed / 60 });
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub total_min: i64,
    pub sessions: i64,
    /// Sessions closed by TekBoard (forgotten, slept).
    pub auto_closed: i64,
    pub by_project: Vec<(Option<String>, i64)>,
    /// (local day `YYYY-MM-DD`, minutes).
    pub by_day: Vec<(String, i64)>,
    pub longest_min: i64,
}

pub fn stats(conn: &Connection, from: i64, to: i64) -> Result<Stats> {
    let mut st = conn.prepare(&format!("SELECT {COLS} FROM focus_sessions WHERE ended_at IS NOT NULL AND end_reason != 'discarded' AND started_at >= ?1 AND started_at < ?2"))?;
    let rows: Vec<Focus> = st.query_map(params![from, to], row)?.collect::<std::result::Result<_, _>>()?;
    let mut s = Stats::default();
    let mut proj: std::collections::BTreeMap<Option<String>, i64> = Default::default();
    let mut days: std::collections::BTreeMap<String, i64> = Default::default();
    for f in rows {
        let m = f.seconds.unwrap_or(0) / 60;
        s.total_min += m;
        s.sessions += 1;
        if matches!(f.end_reason.as_deref(), Some("auto_overrun" | "auto_closed" | "max")) {
            s.auto_closed += 1;
        }
        s.longest_min = s.longest_min.max(m);
        *proj.entry(f.project.clone()).or_default() += m;
        *days.entry(crate::schedule::local_iso(f.started_at)[..10].to_string()).or_default() += m;
    }
    s.by_project = proj.into_iter().collect();
    s.by_project.sort_by(|a, b| b.1.cmp(&a.1));
    s.by_day = days.into_iter().collect();
    Ok(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Ticks every 30 s from `from` to `to`, as the app does.
    fn run_clock(c: &Connection, from: i64, to: i64) -> Vec<Notice> {
        let mut out = Vec::new();
        let mut t = from;
        while t < to {
            t = (t + 30).min(to);
            out.extend(tick(c, t, false).unwrap());
        }
        out
    }

    fn begin(c: &Connection, minutes: i64, at: i64) -> Focus {
        start(c, &Start { title: "my_rpg".into(), project: Some("/p/rpg".into()), minutes, ..Default::default() }, at).unwrap()
    }

    #[test]
    fn one_session_at_a_time_and_time_is_logged_once() {
        let c = crate::db::open_in_memory().unwrap();
        crate::planner::set_project(&c, "/p/rpg", None, Some(Some(120)), None).unwrap();
        let f = begin(&c, 25, 1000);
        assert_eq!(start(&c, &Start { title: "x".into(), minutes: 10, ..Default::default() }, 1001).unwrap_err().code(), "busy");
        let done = stop(&c, "done", 1000 + 25 * 60, true).unwrap();
        assert_eq!(done.seconds, Some(1500));
        let logged: i64 = c.query_row("SELECT COUNT(*) FROM work_log", [], |r| r.get(0)).unwrap();
        assert_eq!(logged, 1);
        let est: i64 = c.query_row("SELECT estimate_min FROM plan_projects WHERE key = '/p/rpg'", [], |r| r.get(0)).unwrap();
        assert_eq!(est, 95);
        assert!(current(&c).unwrap().is_none());
        assert!(stop(&c, "done", 5000, false).is_err(), "nothing left to stop");
        let _ = f;
    }

    #[test]
    fn a_forgotten_session_closes_at_its_planned_end() {
        let c = crate::db::open_in_memory().unwrap();
        let t0 = 10_000;
        begin(&c, 25, t0);
        let mut t = t0;
        let mut notices = Vec::new();
        // Ticks every 30 s for 50 minutes, nobody answers.
        while t < t0 + 50 * 60 {
            t += 30;
            notices.extend(tick(&c, t, false).unwrap());
        }
        assert!(notices.iter().any(|n| matches!(n, Notice::Due { .. })), "{notices:?}");
        let closed = notices.iter().find_map(|n| if let Notice::Closed { reason, minutes, .. } = n { Some((reason.clone(), *minutes)) } else { None }).unwrap();
        assert_eq!(closed, ("auto_overrun".into(), 25), "logged at the planned length, not 40 min");
        assert!(current(&c).unwrap().is_none());
    }

    #[test]
    fn sleep_pauses_and_a_closed_app_does_not_count() {
        let c = crate::db::open_in_memory().unwrap();
        begin(&c, 60, 0);
        run_clock(&c, 0, 600);
        // The laptop slept 3 hours.
        let n = tick(&c, 600 + 3 * 3600, false).unwrap();
        assert!(matches!(n[0], Notice::Paused { .. }));
        let f = current(&c).unwrap().unwrap();
        assert_eq!(f.elapsed(600 + 3 * 3600), 600, "the night is not counted");
        resume(&c, 600 + 3 * 3600).unwrap();
        tick(&c, 700 + 3 * 3600, false).unwrap();
        // TekBoard is closed, then reopened the next day.
        let n = tick(&c, 100_000, true).unwrap();
        match &n[0] {
            Notice::Closed { reason, minutes, .. } => assert_eq!((reason.as_str(), *minutes), ("auto_closed", 11)),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn extend_and_hard_ceiling() {
        let c = crate::db::open_in_memory().unwrap();
        begin(&c, 25, 0);
        run_clock(&c, 0, 26 * 60);
        let f = extend(&c, 10, 26 * 60).unwrap();
        assert_eq!((f.planned_min, f.due_notified), (36, false));
        let s = stats(&c, 0, 10).unwrap();
        assert_eq!(s.sessions, 0, "running sessions are not in the stats");
        // A session cannot be planned beyond four hours.
        run_clock(&c, 26 * 60, 30 * 60);
        stop(&c, "stopped", 30 * 60, false).unwrap();
        let long = start(&c, &Start { title: "long".into(), minutes: 900, ..Default::default() }, 40 * 60).unwrap();
        assert_eq!(long.planned_min, 240);
        discard(&c, long.id, 41 * 60).unwrap();
        let s = stats(&c, 0, 100_000).unwrap();
        assert_eq!((s.sessions, s.total_min), (1, 30), "discarded sessions are not counted");
    }
}
