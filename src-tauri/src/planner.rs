//! Planning: the student's own tasks, calendar entries, estimates and time really spent.
//!
//! Everything here is typed by the user or proposed by an assistant and accepted by the
//! user. MY Epitech data is never written to these tables, and a sync never touches them:
//! official sessions and hand-ins are merged on screen only.
//!
//! `project` is a repository path, or `my:<id>` for a MY Epitech project with no local
//! repository yet (`rekey` moves the latter to the path once the project is cloned).

use crate::error::{AppError, Result};
use chrono::{DateTime, Local, NaiveDate, NaiveDateTime, TimeZone};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// `block`: time the user is not available (nothing is planned over it).
pub const EVENT_KINDS: &[&str] = &["session", "event", "reminder", "task", "block"];
pub const TASK_KINDS: &[&str] = &["task", "idea"];
const MAX_SPAN: i64 = 14 * 86_400;
const MAX_ESTIMATE: i64 = 2_000 * 60;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Task {
    /// 0 for a task that does not exist yet.
    pub id: i64,
    pub title: String,
    pub notes: String,
    pub project: Option<String>,
    /// Sub-task of this task.
    pub parent_id: Option<i64>,
    /// `task` or `idea` (a note captured on the fly, never scheduled by itself).
    pub kind: String,
    /// 0 none, 1 low, 2 medium, 3 high.
    pub priority: i64,
    pub estimate_min: Option<i64>,
    pub due_day: Option<String>,
    pub done_at: Option<i64>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PlanEvent {
    pub id: i64,
    /// `session` (work on a project), `task` (a task placed in the calendar), `event`, `reminder`.
    pub kind: String,
    pub title: String,
    /// Unix seconds.
    pub start: i64,
    pub end: i64,
    pub all_day: bool,
    pub project: Option<String>,
    pub task_id: Option<i64>,
    /// `#rrggbb`, when the user picked one.
    pub color: Option<String>,
    pub notes: String,
    /// `me`, `auto` (local scheduling) or `claude`.
    pub origin: String,
    pub done: bool,
    /// Category chosen by the user (`plan_categories.id`). `None` = the category of its kind.
    pub category: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProjectPlan {
    pub key: String,
    pub priority: i64,
    /// Work still to do, in minutes, as the user estimates it. Time logged is taken off it.
    pub estimate_min: Option<i64>,
    pub color: Option<String>,
    /// Left out of the calendar (hand-ins, openings and sessions from MY Epitech). Nothing is deleted.
    pub calendar_hidden: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WorkLog {
    pub id: i64,
    pub project: Option<String>,
    pub task_id: Option<i64>,
    pub title: String,
    pub started_at: i64,
    pub seconds: i64,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub tasks: Vec<Task>,
    pub events: Vec<PlanEvent>,
    pub projects: Vec<ProjectPlan>,
    pub log: Vec<WorkLog>,
}

fn invalid(what: impl Into<String>) -> AppError {
    AppError::new("invalid_plan", what)
}

fn clean_title(title: &str) -> Result<String> {
    let t = title.trim();
    if t.is_empty() {
        return Err(invalid("Un titre est nécessaire"));
    }
    Ok(t.chars().take(200).collect())
}

fn clean_project(project: Option<&str>) -> Result<Option<String>> {
    match project.map(str::trim).filter(|p| !p.is_empty()) {
        None => Ok(None),
        Some(p) if p.len() > 600 => Err(invalid("Projet inconnu")),
        Some(p) => Ok(Some(p.to_string())),
    }
}

fn clean_color(color: Option<&str>) -> Result<Option<String>> {
    match color.map(str::trim).filter(|c| !c.is_empty()) {
        None => Ok(None),
        Some(c) if c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|x| x.is_ascii_hexdigit()) => Ok(Some(c.to_lowercase())),
        Some(c) => Err(invalid(format!("« {c} » n'est pas une couleur (#rrggbb)"))),
    }
}

fn clean_day(day: Option<&str>) -> Result<Option<String>> {
    match day.map(str::trim).filter(|d| !d.is_empty()) {
        None => Ok(None),
        Some(d) => NaiveDate::parse_from_str(d, "%Y-%m-%d").map(|x| Some(x.format("%Y-%m-%d").to_string())).map_err(|_| invalid(format!("« {d} » n'est pas une date (AAAA-MM-JJ)"))),
    }
}

fn clean_estimate(minutes: Option<i64>) -> Result<Option<i64>> {
    match minutes {
        Some(m) if !(0..=MAX_ESTIMATE).contains(&m) => Err(invalid("Une estimation est comprise entre 0 et 2000 heures")),
        other => Ok(other),
    }
}

fn clean_priority(p: i64) -> Result<i64> {
    if (0..=3).contains(&p) { Ok(p) } else { Err(invalid("Une priorité va de 0 (aucune) à 3 (haute)")) }
}

fn check_span(start: i64, end: i64) -> Result<()> {
    if end <= start {
        return Err(invalid("Une entrée doit finir après avoir commencé"));
    }
    if end - start > MAX_SPAN {
        return Err(invalid("Une entrée ne peut pas durer plus de deux semaines"));
    }
    Ok(())
}

// ───────────────────────────── reading ─────────────────────────────

fn task_row(r: &rusqlite::Row) -> rusqlite::Result<Task> {
    Ok(Task { id: r.get(0)?, title: r.get(1)?, notes: r.get(2)?, project: r.get(3)?, parent_id: r.get(4)?, kind: r.get(5)?, priority: r.get(6)?, estimate_min: r.get(7)?, due_day: r.get(8)?, done_at: r.get(9)?, created_at: r.get(10)? })
}

fn event_row(r: &rusqlite::Row) -> rusqlite::Result<PlanEvent> {
    Ok(PlanEvent { id: r.get(0)?, kind: r.get(1)?, title: r.get(2)?, start: r.get(3)?, end: r.get(4)?, all_day: r.get::<_, i64>(5)? != 0, project: r.get(6)?, task_id: r.get(7)?, color: r.get(8)?, notes: r.get(9)?, origin: r.get(10)?, done: r.get::<_, i64>(11)? != 0, category: r.get(12)? })
}

const TASK_COLS: &str = "id, title, notes, project, parent_id, kind, priority, estimate_min, due_day, done_at, created_at";
const EVENT_COLS: &str = "id, kind, title, start_at, end_at, all_day, project, task_id, color, notes, origin, done, category";

/// Open tasks and those finished in the last 60 days; calendar entries and time logged since 120 days.
pub fn state(conn: &Connection, now: i64) -> Result<State> {
    let mut st = conn.prepare(&format!("SELECT {TASK_COLS} FROM tasks WHERE done_at IS NULL OR done_at >= ?1 ORDER BY done_at IS NOT NULL, priority DESC, COALESCE(due_day, '9999'), id"))?;
    let tasks = st.query_map([now - 60 * 86_400], task_row)?.collect::<std::result::Result<_, _>>()?;
    let mut st = conn.prepare(&format!("SELECT {EVENT_COLS} FROM plan_events WHERE end_at >= ?1 ORDER BY start_at, id"))?;
    let events = st.query_map([now - 120 * 86_400], event_row)?.collect::<std::result::Result<_, _>>()?;
    let mut st = conn.prepare("SELECT key, priority, estimate_min, color, calendar_hidden FROM plan_projects ORDER BY key")?;
    let projects = st.query_map([], |r| Ok(ProjectPlan { key: r.get(0)?, priority: r.get(1)?, estimate_min: r.get(2)?, color: r.get(3)?, calendar_hidden: r.get::<_, i64>(4)? != 0 }))?.collect::<std::result::Result<_, _>>()?;
    let mut st = conn.prepare("SELECT id, project, task_id, title, started_at, seconds FROM work_log WHERE started_at >= ?1 ORDER BY started_at DESC")?;
    let log = st.query_map([now - 120 * 86_400], |r| Ok(WorkLog { id: r.get(0)?, project: r.get(1)?, task_id: r.get(2)?, title: r.get(3)?, started_at: r.get(4)?, seconds: r.get(5)? }))?.collect::<std::result::Result<_, _>>()?;
    Ok(State { tasks, events, projects, log })
}

pub fn get_task(conn: &Connection, id: i64) -> Result<Task> {
    conn.query_row(&format!("SELECT {TASK_COLS} FROM tasks WHERE id = ?1"), [id], task_row).map_err(|_| AppError::new("not_found", "Cette tâche n'existe plus"))
}

pub fn get_event(conn: &Connection, id: i64) -> Result<PlanEvent> {
    conn.query_row(&format!("SELECT {EVENT_COLS} FROM plan_events WHERE id = ?1"), [id], event_row).map_err(|_| AppError::new("not_found", "Cette entrée du calendrier n'existe plus"))
}

// ───────────────────────────── writing ─────────────────────────────

/// Creates (`id == 0`) or updates a task. `created_at` of an existing task is kept.
pub fn save_task(conn: &Connection, t: &Task, now: i64) -> Result<Task> {
    let title = clean_title(&t.title)?;
    let kind = if t.kind.is_empty() { "task" } else { t.kind.as_str() };
    if !TASK_KINDS.contains(&kind) {
        return Err(invalid("Type de tâche inconnu"));
    }
    let (project, due, estimate, priority) = (clean_project(t.project.as_deref())?, clean_day(t.due_day.as_deref())?, clean_estimate(t.estimate_min)?, clean_priority(t.priority)?);
    let parent = t.parent_id.filter(|p| *p != t.id && *p > 0);
    let notes: String = t.notes.chars().take(8000).collect();
    let id = if t.id == 0 {
        conn.execute("INSERT INTO tasks (title, notes, project, parent_id, kind, priority, estimate_min, due_day, done_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)", params![title, notes, project, parent, kind, priority, estimate, due, t.done_at, now])?;
        conn.last_insert_rowid()
    } else {
        let n = conn.execute("UPDATE tasks SET title = ?1, notes = ?2, project = ?3, parent_id = ?4, kind = ?5, priority = ?6, estimate_min = ?7, due_day = ?8, done_at = ?9 WHERE id = ?10", params![title, notes, project, parent, kind, priority, estimate, due, t.done_at, t.id])?;
        if n == 0 {
            return Err(AppError::new("not_found", "Cette tâche n'existe plus"));
        }
        // A finished task leaves the calendar entries that were holding it marked as done.
        if t.done_at.is_some() {
            conn.execute("UPDATE plan_events SET done = 1 WHERE task_id = ?1 AND end_at <= ?2", params![t.id, now])?;
        }
        t.id
    };
    get_task(conn, id)
}

/// Removes a task and its sub-tasks. Calendar entries that pointed to it stay, unlinked.
pub fn delete_task(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("UPDATE plan_events SET task_id = NULL WHERE task_id = ?1 OR task_id IN (SELECT id FROM tasks WHERE parent_id = ?1)", [id])?;
    conn.execute("DELETE FROM tasks WHERE id = ?1 OR parent_id = ?1", [id])?;
    Ok(())
}

pub fn save_event(conn: &Connection, e: &PlanEvent, now: i64) -> Result<PlanEvent> {
    let title = clean_title(&e.title)?;
    if !EVENT_KINDS.contains(&e.kind.as_str()) {
        return Err(invalid("Type d'entrée de calendrier inconnu"));
    }
    check_span(e.start, e.end)?;
    let (project, color) = (clean_project(e.project.as_deref())?, clean_color(e.color.as_deref())?);
    let notes: String = e.notes.chars().take(8000).collect();
    let origin = if ["me", "auto", "claude"].contains(&e.origin.as_str()) { e.origin.as_str() } else { "me" };
    // A category that no longer exists falls back to the entry's kind.
    let category = e.category.as_deref().filter(|c| !c.is_empty() && !EVENT_KINDS.contains(c)).filter(|c| conn.query_row("SELECT 1 FROM plan_categories WHERE id = ?1", [c], |_| Ok(())).is_ok());
    let id = if e.id == 0 {
        conn.execute("INSERT INTO plan_events (kind, title, start_at, end_at, all_day, project, task_id, color, notes, origin, done, created_at, category) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)", params![e.kind, title, e.start, e.end, e.all_day as i64, project, e.task_id, color, notes, origin, e.done as i64, now, category])?;
        conn.last_insert_rowid()
    } else {
        let n = conn.execute("UPDATE plan_events SET kind = ?1, title = ?2, start_at = ?3, end_at = ?4, all_day = ?5, project = ?6, task_id = ?7, color = ?8, notes = ?9, done = ?10, category = ?12 WHERE id = ?11", params![e.kind, title, e.start, e.end, e.all_day as i64, project, e.task_id, color, notes, e.done as i64, e.id, category])?;
        if n == 0 {
            return Err(AppError::new("not_found", "Cette entrée du calendrier n'existe plus"));
        }
        e.id
    };
    get_event(conn, id)
}

pub fn delete_event(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM plan_events WHERE id = ?1", [id])?;
    Ok(())
}

/// Priority, remaining work and colour of a project. `None` leaves a value alone;
/// `Some(None)` clears it.
pub fn set_project(conn: &Connection, key: &str, priority: Option<i64>, estimate_min: Option<Option<i64>>, color: Option<Option<String>>) -> Result<ProjectPlan> {
    let key = clean_project(Some(key))?.ok_or_else(|| invalid("Projet inconnu"))?;
    conn.execute("INSERT INTO plan_projects (key) VALUES (?1) ON CONFLICT(key) DO NOTHING", [&key])?;
    if let Some(p) = priority {
        conn.execute("UPDATE plan_projects SET priority = ?2 WHERE key = ?1", params![key, clean_priority(p)?])?;
    }
    if let Some(e) = estimate_min {
        conn.execute("UPDATE plan_projects SET estimate_min = ?2 WHERE key = ?1", params![key, clean_estimate(e)?])?;
    }
    if let Some(c) = color {
        conn.execute("UPDATE plan_projects SET color = ?2 WHERE key = ?1", params![key, clean_color(c.as_deref())?])?;
    }
    Ok(conn.query_row("SELECT key, priority, estimate_min, color, calendar_hidden FROM plan_projects WHERE key = ?1", [&key], |r| Ok(ProjectPlan { key: r.get(0)?, priority: r.get(1)?, estimate_min: r.get(2)?, color: r.get(3)?, calendar_hidden: r.get::<_, i64>(4)? != 0 }))?)
}

/// Leaves a project out of the calendar, or shows it again. Its data is untouched.
pub fn set_calendar_hidden(conn: &Connection, key: &str, hidden: bool) -> Result<()> {
    let key = clean_project(Some(key))?.ok_or_else(|| invalid("Projet inconnu"))?;
    conn.execute("INSERT INTO plan_projects (key, calendar_hidden) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET calendar_hidden = excluded.calendar_hidden", params![key, hidden as i64])?;
    Ok(())
}

// ───────────────────────────── categories ─────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: String,
    pub name: String,
    pub color: String,
    /// One of the five kinds the planning engine understands: renamed and recoloured, never deleted.
    pub builtin: bool,
}

/// Built-in categories: the kinds of entries, with their default name and colour.
pub const BUILTIN_CATEGORIES: &[(&str, &str, &str)] = &[("session", "Session de travail", "#8b7cf6"), ("event", "Événement", "#5fb4e8"), ("reminder", "Rappel", "#e2a93b"), ("block", "Indisponible", "#6b7280"), ("task", "Tâche", "#8b7cf6")];

pub fn categories(conn: &Connection) -> Result<Vec<Category>> {
    let mut st = conn.prepare("SELECT id, name, color FROM plan_categories ORDER BY position, created_at, id")?;
    let stored: Vec<(String, String, String)> = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<std::result::Result<_, _>>()?;
    let mut out: Vec<Category> = BUILTIN_CATEGORIES
        .iter()
        .map(|(id, name, color)| match stored.iter().find(|(s, _, _)| s == id) {
            Some((_, n, c)) => Category { id: id.to_string(), name: n.clone(), color: c.clone(), builtin: true },
            None => Category { id: id.to_string(), name: name.to_string(), color: color.to_string(), builtin: true },
        })
        .collect();
    out.extend(stored.into_iter().filter(|(id, _, _)| !EVENT_KINDS.contains(&id.as_str())).map(|(id, name, color)| Category { id, name, color, builtin: false }));
    Ok(out)
}

/// Creates (`id` empty) or renames / recolours a category.
pub fn save_category(conn: &Connection, id: Option<&str>, name: &str, color: &str, now: i64) -> Result<Category> {
    let name: String = name.trim().chars().take(40).collect();
    if name.is_empty() {
        return Err(invalid("Une catégorie a besoin d'un nom"));
    }
    let color = clean_color(Some(color))?.ok_or_else(|| invalid("Une catégorie a besoin d'une couleur"))?;
    let id = match id.filter(|i| !i.is_empty()) {
        Some(i) => {
            let known = EVENT_KINDS.contains(&i) || conn.query_row("SELECT 1 FROM plan_categories WHERE id = ?1", [i], |_| Ok(())).is_ok();
            if !known {
                return Err(AppError::new("not_found", "Cette catégorie n'existe plus"));
            }
            i.to_string()
        }
        None => format!("c{now}{}", conn.query_row("SELECT COUNT(*) FROM plan_categories", [], |r| r.get::<_, i64>(0))?),
    };
    conn.execute("INSERT INTO plan_categories (id, name, color, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color", params![id, name, color, now])?;
    categories(conn)?.into_iter().find(|c| c.id == id).ok_or_else(|| AppError::new("database", "Catégorie introuvable après l'enregistrement"))
}

/// Deletes a category of the user's; its entries go back to the category of their kind.
pub fn delete_category(conn: &Connection, id: &str) -> Result<()> {
    if EVENT_KINDS.contains(&id) {
        return Err(invalid("Les catégories de base se renomment mais ne se suppriment pas"));
    }
    conn.execute("UPDATE plan_events SET category = NULL WHERE category = ?1", [id])?;
    conn.execute("DELETE FROM plan_categories WHERE id = ?1", [id])?;
    Ok(())
}

/// Records time really spent. The project's remaining estimate, when there is one, goes down by as much.
pub fn log_work(conn: &Connection, project: Option<&str>, task_id: Option<i64>, title: &str, started_at: i64, seconds: i64) -> Result<WorkLog> {
    if !(1..=24 * 3600).contains(&seconds) {
        return Err(invalid("Une session de travail dure entre une seconde et une journée"));
    }
    let project = clean_project(project)?;
    let title = clean_title(title)?;
    conn.execute("INSERT INTO work_log (project, task_id, title, started_at, seconds) VALUES (?1, ?2, ?3, ?4, ?5)", params![project, task_id, title, started_at, seconds])?;
    let id = conn.last_insert_rowid();
    if let Some(p) = &project {
        conn.execute("UPDATE plan_projects SET estimate_min = MAX(0, estimate_min - ?2) WHERE key = ?1 AND estimate_min IS NOT NULL", params![p, (seconds + 30) / 60])?;
    }
    Ok(WorkLog { id, project, task_id, title, started_at, seconds })
}

/// A MY Epitech project that was planned before being cloned keeps its plan under the repository path.
/// Returns how many rows moved (the window re-reads the plan when some did).
pub fn rekey(conn: &Connection, links: &[(i64, String)]) -> Result<usize> {
    let pending: i64 = conn.query_row("SELECT (SELECT COUNT(*) FROM tasks WHERE project LIKE 'my:%') + (SELECT COUNT(*) FROM plan_events WHERE project LIKE 'my:%') + (SELECT COUNT(*) FROM plan_projects WHERE key LIKE 'my:%') + (SELECT COUNT(*) FROM work_log WHERE project LIKE 'my:%')", [], |r| r.get(0))?;
    if pending == 0 {
        return Ok(0);
    }
    let mut moved = 0;
    for (id, path) in links {
        let old = format!("my:{id}");
        for table in ["tasks", "plan_events", "work_log"] {
            moved += conn.execute(&format!("UPDATE {table} SET project = ?2 WHERE project = ?1"), params![old, path])?;
        }
        // The repository's own row wins when both exist.
        moved += conn.execute("UPDATE OR IGNORE plan_projects SET key = ?2 WHERE key = ?1", params![old, path])?;
        conn.execute("DELETE FROM plan_projects WHERE key = ?1", [&old])?;
    }
    Ok(moved)
}

// ───────────────────────────── plans (previewed, then applied) ─────────────────────────────

/// One change of a proposed plan. Produced by the local scheduler or by Claude, shown to the
/// user, and applied only on "Apply plan". Times are local (`YYYY-MM-DDTHH:MM`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum Action {
    CreateSession { project: Option<String>, title: String, start: String, end: String, task_id: Option<i64>, kind: Option<String> },
    MoveEvent { id: i64, start: String, end: String },
    DeleteEvent { id: i64 },
    CreateTask {
        project: Option<String>,
        title: String,
        estimate_min: Option<i64>,
        priority: Option<i64>,
        due_day: Option<String>,
        #[serde(default)]
        subtasks: Vec<String>,
    },
    SetPriority { project: String, priority: i64 },
    SetEstimate { project: String, estimate_min: i64 },
}

/// Unix seconds of a local time written `2026-11-14T14:00` (seconds, a space instead of `T`
/// and a full RFC 3339 instant are accepted too).
pub fn parse_local_in<Tz: TimeZone>(text: &str, tz: &Tz) -> Result<i64> {
    let t = text.trim();
    if let Ok(at) = DateTime::parse_from_rfc3339(t) {
        return Ok(at.timestamp());
    }
    let naive = ["%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"].iter().find_map(|f| NaiveDateTime::parse_from_str(t, f).ok()).ok_or_else(|| invalid(format!("« {t} » n'est pas une date et une heure (AAAA-MM-JJTHH:MM)")))?;
    tz.from_local_datetime(&naive).earliest().map(|d| d.timestamp()).ok_or_else(|| invalid(format!("{t} does not exist in your time zone")))
}

pub fn parse_local(text: &str) -> Result<i64> {
    parse_local_in(text, &Local)
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Applied {
    pub created: usize,
    pub moved: usize,
    pub deleted: usize,
    pub tasks: usize,
    pub projects: usize,
}

/// Applies every action or none: the first invalid one cancels the whole plan.
pub fn apply(conn: &Connection, actions: &[Action], origin: &str, now: i64) -> Result<Applied> {
    if actions.len() > 200 {
        return Err(invalid("Un plan contient au plus 200 changements"));
    }
    let tx = conn.unchecked_transaction()?;
    let mut done = Applied::default();
    for a in actions {
        match a {
            Action::CreateSession { project, title, start, end, task_id, kind } => {
                let kind = kind.clone().unwrap_or_else(|| if task_id.is_some() { "task".into() } else { "session".into() });
                save_event(&tx, &PlanEvent { kind, title: title.clone(), start: parse_local(start)?, end: parse_local(end)?, project: project.clone(), task_id: *task_id, origin: origin.to_string(), ..Default::default() }, now)?;
                done.created += 1;
            }
            Action::MoveEvent { id, start, end } => {
                let mut e = get_event(&tx, *id)?;
                e.start = parse_local(start)?;
                e.end = parse_local(end)?;
                save_event(&tx, &e, now)?;
                done.moved += 1;
            }
            Action::DeleteEvent { id } => {
                get_event(&tx, *id)?;
                delete_event(&tx, *id)?;
                done.deleted += 1;
            }
            Action::CreateTask { project, title, estimate_min, priority, due_day, subtasks } => {
                let parent = save_task(&tx, &Task { title: title.clone(), project: project.clone(), estimate_min: *estimate_min, priority: priority.unwrap_or(0), due_day: due_day.clone(), ..Default::default() }, now)?;
                done.tasks += 1;
                for s in subtasks.iter().take(30) {
                    save_task(&tx, &Task { title: s.clone(), project: project.clone(), parent_id: Some(parent.id), ..Default::default() }, now)?;
                    done.tasks += 1;
                }
            }
            Action::SetPriority { project, priority } => {
                set_project(&tx, project, Some(*priority), None, None)?;
                done.projects += 1;
            }
            Action::SetEstimate { project, estimate_min } => {
                set_project(&tx, project, None, Some(Some(*estimate_min)), None)?;
                done.projects += 1;
            }
        }
    }
    tx.commit()?;
    Ok(done)
}

/// What Claude answered: the text for the student, the changes it proposes, and the
/// proposals that were dropped because they are not valid actions.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reply {
    pub reply: String,
    pub actions: Vec<Action>,
    pub rejected: Vec<String>,
}

/// Reads `{"reply": "...", "actions": [...]}` from the answer (fenced or not). An answer
/// that is not JSON is kept as plain advice, with no action.
pub fn parse_reply(text: &str) -> Reply {
    let body = crate::claude::fenced(text, "json");
    let parsed: Option<Value> = serde_json::from_str(&body).ok().or_else(|| {
        // Some prose around a bare object.
        let (a, b) = (text.find('{')?, text.rfind('}')?);
        serde_json::from_str(&text[a..=b]).ok()
    });
    let Some(v) = parsed.filter(Value::is_object) else {
        return Reply { reply: text.trim().to_string(), ..Default::default() };
    };
    let mut out = Reply { reply: v["reply"].as_str().unwrap_or_default().trim().to_string(), ..Default::default() };
    for item in v["actions"].as_array().into_iter().flatten() {
        match serde_json::from_value::<Action>(item.clone()) {
            Ok(a) => out.actions.push(a),
            Err(e) => out.rejected.push(format!("{} ({e})", item["type"].as_str().unwrap_or("action without a type"))),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    const NOW: i64 = 1_794_480_000;

    #[test]
    fn tasks_and_entries_round_trip_and_refuse_nonsense() {
        let conn = db::open_in_memory().unwrap();
        let t = save_task(&conn, &Task { title: "  Parse the map ".into(), project: Some("/p/rpg".into()), priority: 2, estimate_min: Some(90), due_day: Some("2026-11-20".into()), ..Default::default() }, NOW).unwrap();
        assert_eq!((t.title.as_str(), t.kind.as_str(), t.created_at), ("Parse the map", "task", NOW));
        let sub = save_task(&conn, &Task { title: "sub".into(), parent_id: Some(t.id), ..Default::default() }, NOW).unwrap();
        let e = save_event(&conn, &PlanEvent { kind: "task".into(), title: "Parse".into(), start: NOW, end: NOW + 3600, task_id: Some(t.id), color: Some("#AABBCC".into()), ..Default::default() }, NOW).unwrap();
        assert_eq!((e.origin.as_str(), e.color.as_deref()), ("me", Some("#aabbcc")));
        // Finishing the task marks the past entry as done.
        save_task(&conn, &Task { done_at: Some(NOW + 7200), ..t.clone() }, NOW + 7200).unwrap();
        assert!(get_event(&conn, e.id).unwrap().done);
        for bad in [Task { title: " ".into(), ..Default::default() }, Task { title: "x".into(), priority: 9, ..Default::default() }, Task { title: "x".into(), due_day: Some("20/11".into()), ..Default::default() }, Task { title: "x".into(), kind: "epic".into(), ..Default::default() }] {
            assert_eq!(save_task(&conn, &bad, NOW).unwrap_err().code(), "invalid_plan");
        }
        for bad in [PlanEvent { kind: "session".into(), title: "x".into(), start: NOW, end: NOW, ..Default::default() }, PlanEvent { kind: "party".into(), title: "x".into(), start: NOW, end: NOW + 60, ..Default::default() }, PlanEvent { kind: "event".into(), title: "x".into(), start: NOW, end: NOW + 60, color: Some("red".into()), ..Default::default() }] {
            assert_eq!(save_event(&conn, &bad, NOW).unwrap_err().code(), "invalid_plan");
        }
        delete_task(&conn, t.id).unwrap();
        assert!(get_task(&conn, sub.id).is_err(), "sub-tasks go with their parent");
        assert_eq!(get_event(&conn, e.id).unwrap().task_id, None, "the entry stays, unlinked");
        let s = state(&conn, NOW).unwrap();
        assert_eq!((s.tasks.len(), s.events.len()), (0, 1));
    }

    #[test]
    fn logged_time_comes_off_the_remaining_estimate() {
        let conn = db::open_in_memory().unwrap();
        set_project(&conn, "/p/rpg", Some(3), Some(Some(720)), None).unwrap();
        log_work(&conn, Some("/p/rpg"), None, "Focus", NOW, 90 * 60).unwrap();
        let p = set_project(&conn, "/p/rpg", None, None, Some(Some("#112233".into()))).unwrap();
        assert_eq!((p.priority, p.estimate_min, p.color.as_deref()), (3, Some(630), Some("#112233")));
        log_work(&conn, Some("/p/rpg"), None, "Focus", NOW, 20 * 3600).unwrap();
        assert_eq!(set_project(&conn, "/p/rpg", None, None, None).unwrap().estimate_min, Some(0), "never negative");
        assert!(log_work(&conn, None, None, "x", NOW, 0).is_err());
        // A project without an estimate stays without one.
        log_work(&conn, Some("/p/other"), None, "Focus", NOW, 600).unwrap();
        assert_eq!(state(&conn, NOW).unwrap().projects.len(), 1);
    }

    #[test]
    fn a_plan_is_applied_entirely_or_not_at_all() {
        let conn = db::open_in_memory().unwrap();
        let e = save_event(&conn, &PlanEvent { kind: "session".into(), title: "old".into(), start: NOW, end: NOW + 3600, ..Default::default() }, NOW).unwrap();
        let good = vec![
            Action::CreateSession { project: Some("/p/rpg".into()), title: "MyRPG".into(), start: "2026-11-14T14:00".into(), end: "2026-11-14T16:00".into(), task_id: None, kind: None },
            Action::MoveEvent { id: e.id, start: "2026-11-15T10:00".into(), end: "2026-11-15T11:30".into() },
            Action::CreateTask { project: Some("/p/rpg".into()), title: "Inventory".into(), estimate_min: Some(120), priority: Some(2), due_day: None, subtasks: vec!["UI".into(), "Save".into()] },
            Action::SetEstimate { project: "/p/rpg".into(), estimate_min: 720 },
            Action::SetPriority { project: "/p/rpg".into(), priority: 3 },
        ];
        let mut bad = good.clone();
        bad.push(Action::DeleteEvent { id: 999 });
        assert!(apply(&conn, &bad, "claude", NOW).is_err());
        let s = state(&conn, NOW).unwrap();
        assert_eq!((s.events.len(), s.tasks.len(), s.projects.len()), (1, 0, 0), "nothing was kept from the refused plan");
        assert_eq!(get_event(&conn, e.id).unwrap().start, NOW);

        let done = apply(&conn, &good, "claude", NOW).unwrap();
        assert_eq!(done, Applied { created: 1, moved: 1, deleted: 0, tasks: 3, projects: 2 });
        let s = state(&conn, NOW).unwrap();
        let created = s.events.iter().find(|x| x.title == "MyRPG").unwrap();
        assert_eq!((created.kind.as_str(), created.origin.as_str(), created.end - created.start), ("session", "claude", 7200));
        assert_eq!(get_event(&conn, e.id).unwrap().end - get_event(&conn, e.id).unwrap().start, 5400);
        assert_eq!(s.tasks.iter().filter(|t| t.parent_id.is_some()).count(), 2);
        assert_eq!(s.projects[0], ProjectPlan { key: "/p/rpg".into(), priority: 3, estimate_min: Some(720), color: None, calendar_hidden: false });
    }

    #[test]
    fn local_times_are_read_in_the_given_zone() {
        let lyon = chrono::FixedOffset::east_opt(3600).unwrap();
        let at = parse_local_in("2026-11-14T14:00", &lyon).unwrap();
        assert_eq!(at, DateTime::parse_from_rfc3339("2026-11-14T13:00:00Z").unwrap().timestamp());
        assert_eq!(parse_local_in("2026-11-14 14:00:00", &lyon).unwrap(), at);
        assert_eq!(parse_local_in("2026-11-14T13:00:00Z", &lyon).unwrap(), at);
        assert!(parse_local_in("tomorrow 2pm", &lyon).is_err());
    }

    #[test]
    fn claude_answers_are_read_leniently_but_actions_strictly() {
        let r = parse_reply("Here you go\n```json\n{\"reply\":\"Two sessions.\",\"actions\":[{\"type\":\"create_session\",\"project\":\"/p/rpg\",\"title\":\"MyRPG\",\"start\":\"2026-11-14T14:00\",\"end\":\"2026-11-14T16:00\"},{\"type\":\"format_disk\"},{\"type\":\"move_event\",\"id\":\"x\"},{\"type\":\"create_task\",\"title\":\"T\",\"estimateMin\":60}]}\n```");
        assert_eq!(r.reply, "Two sessions.");
        assert_eq!(r.actions.len(), 2);
        assert!(matches!(&r.actions[1], Action::CreateTask { estimate_min: Some(60), subtasks, .. } if subtasks.is_empty()));
        assert_eq!(r.rejected.len(), 2);
        assert!(r.rejected[0].starts_with("format_disk"));
        let plain = parse_reply("Work on MyRPG first.");
        assert_eq!((plain.reply.as_str(), plain.actions.len()), ("Work on MyRPG first.", 0));
        let bare = parse_reply("Sure: {\"reply\":\"ok\",\"actions\":[]} done");
        assert_eq!(bare.reply, "ok");
    }

    #[test]
    fn a_plan_made_before_cloning_follows_the_repository() {
        let conn = db::open_in_memory().unwrap();
        save_task(&conn, &Task { title: "t".into(), project: Some("my:42".into()), ..Default::default() }, NOW).unwrap();
        save_event(&conn, &PlanEvent { kind: "session".into(), title: "s".into(), start: NOW, end: NOW + 60, project: Some("my:42".into()), ..Default::default() }, NOW).unwrap();
        set_project(&conn, "my:42", Some(2), Some(Some(300)), None).unwrap();
        rekey(&conn, &[(7, "/p/other".into()), (42, "/p/rpg".into())]).unwrap();
        let s = state(&conn, NOW).unwrap();
        assert_eq!(s.tasks[0].project.as_deref(), Some("/p/rpg"));
        assert_eq!(s.events[0].project.as_deref(), Some("/p/rpg"));
        assert_eq!(s.projects, vec![ProjectPlan { key: "/p/rpg".into(), priority: 2, estimate_min: Some(300), color: None, calendar_hidden: false }]);
    }

    #[test]
    fn categories_keep_the_five_kinds_and_add_the_users() {
        let c = crate::db::open_in_memory().unwrap();
        assert_eq!(categories(&c).unwrap().len(), 5);
        let sport = save_category(&c, None, "Sport", "#22AA55", 10).unwrap();
        assert!(!sport.builtin && sport.color == "#22aa55");
        save_category(&c, Some("event"), "Perso", "#112233", 11).unwrap();
        let all = categories(&c).unwrap();
        assert_eq!(all.iter().find(|x| x.id == "event").unwrap().name, "Perso", "a base category is renamed, not duplicated");
        assert_eq!(all.len(), 6);
        let ev = save_event(&c, &PlanEvent { kind: "event".into(), title: "Foot".into(), start: 1000, end: 4600, category: Some(sport.id.clone()), ..Default::default() }, 1).unwrap();
        assert_eq!(ev.category.as_deref(), Some(sport.id.as_str()));
        assert!(delete_category(&c, "session").is_err(), "base categories stay");
        delete_category(&c, &sport.id).unwrap();
        assert_eq!(get_event(&c, ev.id).unwrap().category, None, "its entries fall back to their kind");
        set_calendar_hidden(&c, "my:12", true).unwrap();
        assert!(state(&c, 0).unwrap().projects.iter().any(|p| p.key == "my:12" && p.calendar_hidden));
    }
}
