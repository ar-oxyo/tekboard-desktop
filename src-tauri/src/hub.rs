//! Projet HUB: a student project from the first idea to its presentation. A project needs a
//! name and nothing else; everything else (pitch, problem, solution, technologies, repository,
//! credits estimate…) is added when it exists. It reuses what TekBoard already has: tasks and
//! work sessions are planning entries whose project key is `hub:<id>`, time worked comes from
//! the work log, boards and the calendar work as for any project. Its own data is the project
//! (`hub_projects`) and a few kinds of items (`hub_items`): milestones, links, files, journal
//! entries, decisions and members. Progress is stated as facts (milestones reached, tasks done,
//! time worked), never as an invented percentage.

use crate::error::{AppError, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// Stages of a project, in order. Archived projects leave the daily list.
pub const STAGES: &[&str] = &["idea", "prep", "dev", "testing", "pitch", "done", "archived"];
pub const ITEM_KINDS: &[&str] = &["milestone", "link", "file", "log", "decision", "member"];
pub const ROLES: &[&str] = &["owner", "editor", "viewer"];
/// The text fields a project may hold. Anything else is dropped.
pub const FIELDS: &[&str] = &["pitch", "description", "problem", "solution", "objectives", "technologies", "dependencies", "skills", "personalGoals", "notes", "keyPoints", "demos", "difficulties", "learned", "nextSteps", "checklist"];
const MAX_TEXT: usize = 8000;
const MAX_LIST: usize = 60;

pub fn key(id: i64) -> String {
    format!("hub:{id}")
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Project {
    /// 0 for a project that does not exist yet.
    pub id: i64,
    pub name: String,
    pub stage: String,
    /// The optional texts of `FIELDS` (strings, or lists of strings for technologies, skills,
    /// dependencies and the checklist).
    pub fields: Map<String, Value>,
    /// A local repository (inside the project folders), a remote one, both or none.
    pub repo_path: Option<String>,
    pub repo_url: Option<String>,
    /// The student's own estimate of the credits, a range. Never an official figure.
    pub credits_min: Option<f64>,
    pub credits_max: Option<f64>,
    /// Estimated work, minutes.
    pub estimate_min: Option<i64>,
    /// `None` for my projects; the owner's device fingerprint for a copy shared with me.
    pub owner: Option<String>,
    pub owner_nick: Option<String>,
    /// My role: `owner` for my projects, `editor` or `viewer` on a shared copy.
    pub role: String,
    /// On a shared copy: the project's id on its owner's device (what messages name).
    pub remote_id: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Item {
    pub id: i64,
    pub project_id: i64,
    /// `milestone`, `link`, `file`, `log`, `decision`, `member`.
    pub kind: String,
    pub title: String,
    pub body: String,
    pub url: Option<String>,
    /// A file kept by TekBoard (`file`): its name inside the project's folder.
    pub path: Option<String>,
    pub due_day: Option<String>,
    pub done: bool,
    /// A milestone's member in charge (nickname); a member's device fingerprint is in `url`.
    pub assignee: Option<String>,
    /// A member's role (`editor`, `viewer`).
    pub role: Option<String>,
    pub author: Option<String>,
    pub created_at: i64,
}

fn invalid(msg: impl Into<String>) -> AppError {
    AppError::new("invalid_hub", msg)
}

fn clip(s: &str, max: usize) -> String {
    s.trim().chars().take(max).collect()
}

/// Keeps the known fields only, each a string or a list of strings, within limits.
pub fn clean_fields(fields: &Map<String, Value>) -> Map<String, Value> {
    let mut out = Map::new();
    for name in FIELDS {
        match fields.get(*name) {
            Some(Value::String(s)) if !s.trim().is_empty() => {
                out.insert(name.to_string(), Value::String(clip(s, MAX_TEXT)));
            }
            Some(Value::Array(a)) => {
                let list: Vec<Value> = a.iter().filter_map(|v| v.as_str()).map(|s| clip(s, 200)).filter(|s| !s.is_empty()).take(MAX_LIST).map(Value::String).collect();
                if !list.is_empty() {
                    out.insert(name.to_string(), Value::Array(list));
                }
            }
            _ => {}
        }
    }
    out
}

fn clean_day(day: Option<&str>) -> Result<Option<String>> {
    match day.map(str::trim).filter(|d| !d.is_empty()) {
        None => Ok(None),
        Some(d) => chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").map(|_| Some(d.to_string())).map_err(|_| invalid(format!("« {d} » n'est pas une date (AAAA-MM-JJ)"))),
    }
}

fn clean_url(url: Option<&str>) -> Result<Option<String>> {
    match url.map(str::trim).filter(|u| !u.is_empty()) {
        None => Ok(None),
        Some(u) if u.len() <= 2000 && (u.starts_with("https://") || u.starts_with("http://")) && !u.chars().any(|c| c.is_whitespace() || c.is_control()) => Ok(Some(u.to_string())),
        Some(u) => Err(invalid(format!("« {} » n'est pas une adresse web (https://…)", clip(u, 60)))),
    }
}

fn clean_credits(v: Option<f64>) -> Result<Option<f64>> {
    match v {
        None => Ok(None),
        Some(c) if c.is_finite() && (0.0..=60.0).contains(&c) => Ok(Some((c * 2.0).round() / 2.0)),
        Some(_) => Err(invalid("Une estimation de crédits est entre 0 et 60")),
    }
}

fn project_row(r: &rusqlite::Row) -> rusqlite::Result<Project> {
    let fields: String = r.get(3)?;
    Ok(Project {
        id: r.get(0)?,
        name: r.get(1)?,
        stage: r.get(2)?,
        fields: serde_json::from_str(&fields).unwrap_or_default(),
        repo_path: r.get(4)?,
        repo_url: r.get(5)?,
        credits_min: r.get(6)?,
        credits_max: r.get(7)?,
        estimate_min: r.get(8)?,
        owner: r.get(9)?,
        owner_nick: r.get(10)?,
        role: r.get(11)?,
        created_at: r.get(12)?,
        updated_at: r.get(13)?,
        remote_id: r.get::<_, Option<String>>(14)?.and_then(|o| o.rsplit_once('#').and_then(|(_, id)| id.parse().ok())),
    })
}

const PROJECT_COLS: &str = "id, name, stage, fields, repo_path, repo_url, credits_min, credits_max, estimate_min, owner, owner_nick, role, created_at, updated_at, origin";
const ITEM_COLS: &str = "id, project_id, kind, title, body, url, path, due_day, done, assignee, role, author, created_at";

fn item_row(r: &rusqlite::Row) -> rusqlite::Result<Item> {
    Ok(Item { id: r.get(0)?, project_id: r.get(1)?, kind: r.get(2)?, title: r.get(3)?, body: r.get(4)?, url: r.get(5)?, path: r.get(6)?, due_day: r.get(7)?, done: r.get::<_, i64>(8)? != 0, assignee: r.get(9)?, role: r.get(10)?, author: r.get(11)?, created_at: r.get(12)? })
}

pub fn list(conn: &Connection) -> Result<Vec<Project>> {
    let mut st = conn.prepare(&format!("SELECT {PROJECT_COLS} FROM hub_projects ORDER BY updated_at DESC, id DESC"))?;
    let rows = st.query_map([], project_row)?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

pub fn get(conn: &Connection, id: i64) -> Result<Project> {
    conn.query_row(&format!("SELECT {PROJECT_COLS} FROM hub_projects WHERE id = ?1"), [id], project_row).optional()?.ok_or_else(|| AppError::new("not_found", "Ce projet HUB n'existe plus"))
}

pub fn items(conn: &Connection, project: i64) -> Result<Vec<Item>> {
    let mut st = conn.prepare(&format!("SELECT {ITEM_COLS} FROM hub_items WHERE project_id = ?1 ORDER BY kind, COALESCE(due_day, '9999'), created_at, id"))?;
    let rows = st.query_map([project], item_row)?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

/// Creates (`id == 0`) or updates one of my projects (or a shared copy I may edit). The
/// repository path is checked by the caller (it must be inside the project folders).
pub fn save(conn: &Connection, p: &Project, now: i64) -> Result<Project> {
    let name = clip(&p.name, 120);
    if name.is_empty() {
        return Err(invalid("Donne un nom au projet"));
    }
    let stage = if p.stage.is_empty() { "idea" } else { p.stage.as_str() };
    if !STAGES.contains(&stage) {
        return Err(invalid("Étape inconnue"));
    }
    let fields = serde_json::to_string(&clean_fields(&p.fields))?;
    let (cmin, cmax) = (clean_credits(p.credits_min)?, clean_credits(p.credits_max)?);
    let (cmin, cmax) = match (cmin, cmax) {
        (Some(a), Some(b)) if a > b => (Some(b), Some(a)),
        other => other,
    };
    let estimate = p.estimate_min.filter(|m| *m > 0).map(|m| m.min(2000 * 60));
    let repo_url = clean_url(p.repo_url.as_deref())?;
    let repo_path = p.repo_path.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    if p.id == 0 {
        conn.execute(
            "INSERT INTO hub_projects (name, stage, fields, repo_path, repo_url, credits_min, credits_max, estimate_min, owner, owner_nick, role, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, NULL, 'owner', ?9, ?9)",
            params![name, stage, fields, repo_path, repo_url, cmin, cmax, estimate, now],
        )?;
        return get(conn, conn.last_insert_rowid());
    }
    let old = get(conn, p.id)?;
    if old.role == "viewer" {
        return Err(AppError::new("forbidden", "Ce projet t'est partagé en lecture seule"));
    }
    conn.execute(
        "UPDATE hub_projects SET name = ?1, stage = ?2, fields = ?3, repo_path = ?4, repo_url = ?5, credits_min = ?6, credits_max = ?7, estimate_min = ?8, updated_at = ?9 WHERE id = ?10",
        params![name, stage, fields, repo_path, repo_url, cmin, cmax, estimate, now, p.id],
    )?;
    get(conn, p.id)
}

/// Removes one of my projects and its items. Its planning entries stay, unlinked from it.
pub fn delete(conn: &Connection, id: i64) -> Result<()> {
    get(conn, id)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM hub_items WHERE project_id = ?1", [id])?;
    tx.execute("DELETE FROM hub_projects WHERE id = ?1", [id])?;
    tx.commit()?;
    Ok(())
}

pub fn get_item(conn: &Connection, id: i64) -> Result<Item> {
    conn.query_row(&format!("SELECT {ITEM_COLS} FROM hub_items WHERE id = ?1"), [id], item_row).optional()?.ok_or_else(|| AppError::new("not_found", "Cet élément n'existe plus"))
}

pub fn save_item(conn: &Connection, it: &Item, now: i64) -> Result<Item> {
    let project = get(conn, it.project_id)?;
    if project.role == "viewer" {
        return Err(AppError::new("forbidden", "Ce projet t'est partagé en lecture seule"));
    }
    if !ITEM_KINDS.contains(&it.kind.as_str()) {
        return Err(invalid("Type d'élément inconnu"));
    }
    if it.kind == "member" && project.role != "owner" {
        return Err(AppError::new("forbidden", "Seul le propriétaire gère les membres"));
    }
    let title = clip(&it.title, 200);
    if title.is_empty() {
        return Err(invalid("Donne un titre"));
    }
    let body = clip(&it.body, MAX_TEXT);
    let url = if it.kind == "member" { it.url.as_deref().map(|u| clip(u, 128)) } else { clean_url(it.url.as_deref())? };
    let due = clean_day(it.due_day.as_deref())?;
    let role = match it.kind.as_str() {
        "member" => Some(it.role.as_deref().filter(|r| *r == "editor" || *r == "viewer").unwrap_or("viewer").to_string()),
        _ => None,
    };
    let assignee = it.assignee.as_deref().map(|a| clip(a, 60)).filter(|a| !a.is_empty());
    let author = it.author.as_deref().map(|a| clip(a, 60)).filter(|a| !a.is_empty());
    if it.id == 0 {
        conn.execute(
            "INSERT INTO hub_items (project_id, kind, title, body, url, path, due_day, done, assignee, role, author, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![it.project_id, it.kind, title, body, url, it.path, due, it.done as i64, assignee, role, author, now],
        )?;
        let id = conn.last_insert_rowid();
        touch(conn, it.project_id, now)?;
        return get_item(conn, id);
    }
    let old = get_item(conn, it.id)?;
    if old.project_id != it.project_id || old.kind != it.kind {
        return Err(invalid("Un élément garde son projet et son type"));
    }
    conn.execute("UPDATE hub_items SET title = ?1, body = ?2, url = ?3, due_day = ?4, done = ?5, assignee = ?6, role = ?7 WHERE id = ?8", params![title, body, url, due, it.done as i64, assignee, role, it.id])?;
    touch(conn, it.project_id, now)?;
    get_item(conn, it.id)
}

pub fn delete_item(conn: &Connection, id: i64, now: i64) -> Result<Item> {
    let it = get_item(conn, id)?;
    let project = get(conn, it.project_id)?;
    if project.role == "viewer" || (it.kind == "member" && project.role != "owner") {
        return Err(AppError::new("forbidden", "Tu ne peux pas retirer cet élément"));
    }
    conn.execute("DELETE FROM hub_items WHERE id = ?1", [id])?;
    touch(conn, it.project_id, now)?;
    Ok(it)
}

fn touch(conn: &Connection, project: i64, now: i64) -> Result<()> {
    conn.execute("UPDATE hub_projects SET updated_at = ?1 WHERE id = ?2", params![now, project])?;
    Ok(())
}

/// Concrete facts on a project, for its row and its overview.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Facts {
    pub milestones: i64,
    pub milestones_done: i64,
    pub tasks: i64,
    pub tasks_done: i64,
    /// Time logged on the project (focus sessions) plus planned work sessions marked done, minutes.
    pub minutes_worked: i64,
    /// Work sessions still ahead in the calendar, minutes.
    pub minutes_planned: i64,
    /// The next open milestone with a date.
    pub next_milestone: Option<String>,
    pub next_due: Option<String>,
    pub resources: i64,
    pub journal: i64,
    pub members: i64,
}

pub fn facts(conn: &Connection, id: i64, now: i64) -> Result<Facts> {
    let k = key(id);
    let count = |sql: &str| -> Result<i64> { Ok(conn.query_row(sql, params![id], |r| r.get(0))?) };
    let mut f = Facts {
        milestones: count("SELECT COUNT(*) FROM hub_items WHERE project_id = ?1 AND kind = 'milestone'")?,
        milestones_done: count("SELECT COUNT(*) FROM hub_items WHERE project_id = ?1 AND kind = 'milestone' AND done = 1")?,
        resources: count("SELECT COUNT(*) FROM hub_items WHERE project_id = ?1 AND kind IN ('link', 'file')")?,
        journal: count("SELECT COUNT(*) FROM hub_items WHERE project_id = ?1 AND kind IN ('log', 'decision')")?,
        members: count("SELECT COUNT(*) FROM hub_items WHERE project_id = ?1 AND kind = 'member'")?,
        ..Default::default()
    };
    f.tasks = conn.query_row("SELECT COUNT(*) FROM tasks WHERE project = ?1 AND kind = 'task' AND archived_at IS NULL", [&k], |r| r.get(0))?;
    f.tasks_done = conn.query_row("SELECT COUNT(*) FROM tasks WHERE project = ?1 AND kind = 'task' AND archived_at IS NULL AND done_at IS NOT NULL", [&k], |r| r.get(0))?;
    let logged: i64 = conn.query_row("SELECT COALESCE(SUM(seconds), 0) FROM work_log WHERE project = ?1", [&k], |r| r.get(0))?;
    // Planned sessions marked done count too, unless the same time was logged by a focus session.
    let done_sessions: i64 = conn.query_row("SELECT COALESCE(SUM(end_at - start_at), 0) FROM plan_events WHERE project = ?1 AND kind IN ('session', 'task') AND done = 1 AND end_at <= ?2", params![k, now], |r| r.get(0))?;
    f.minutes_worked = logged.max(done_sessions) / 60;
    f.minutes_planned = conn.query_row("SELECT COALESCE(SUM(end_at - MAX(start_at, ?2)), 0) FROM plan_events WHERE project = ?1 AND kind IN ('session', 'task') AND done = 0 AND end_at > ?2", params![k, now], |r| r.get::<_, i64>(0))? / 60;
    let next: Option<(String, String)> = conn
        .query_row("SELECT title, due_day FROM hub_items WHERE project_id = ?1 AND kind = 'milestone' AND done = 0 AND due_day IS NOT NULL ORDER BY due_day LIMIT 1", [id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?;
    if let Some((t, d)) = next {
        f.next_milestone = Some(t);
        f.next_due = Some(d);
    }
    Ok(f)
}

/// What a member's device receives: the project and its shared items, never the owner's local
/// paths (repository folder, kept files) nor the members' fingerprints.
pub fn snapshot(conn: &Connection, id: i64) -> Result<Value> {
    let p = get(conn, id)?;
    let items: Vec<Value> = items(conn, id)?
        .into_iter()
        .filter(|i| i.kind != "file")
        .map(|i| serde_json::json!({ "kind": i.kind, "title": i.title, "body": i.body, "url": if i.kind == "member" { Value::Null } else { serde_json::to_value(&i.url).unwrap_or_default() }, "dueDay": i.due_day, "done": i.done, "assignee": i.assignee, "role": i.role, "author": i.author, "createdAt": i.created_at }))
        .collect();
    Ok(serde_json::json!({ "name": p.name, "stage": p.stage, "fields": p.fields, "repoUrl": p.repo_url, "creditsMin": p.credits_min, "creditsMax": p.credits_max, "estimateMin": p.estimate_min, "items": items, "updatedAt": p.updated_at }))
}

/// Keeps (or refreshes) the copy of a project shared with me by `owner`, with my `role` in it.
/// The copy is replaced as a whole: the owner's device is the reference.
pub fn import_shared(conn: &Connection, owner: &str, owner_nick: &str, remote_id: i64, role: &str, snap: &Value, now: i64) -> Result<Project> {
    if !ROLES[1..].contains(&role) {
        return Err(invalid("Rôle inconnu"));
    }
    let origin = format!("{owner}#{remote_id}");
    let name = clip(snap["name"].as_str().unwrap_or(""), 120);
    if name.is_empty() {
        return Err(invalid("Projet partagé sans nom"));
    }
    let stage = snap["stage"].as_str().filter(|s| STAGES.contains(s)).unwrap_or("idea");
    let fields = serde_json::to_string(&clean_fields(snap["fields"].as_object().unwrap_or(&Map::new())))?;
    let repo_url = clean_url(snap["repoUrl"].as_str()).unwrap_or(None);
    let tx = conn.unchecked_transaction()?;
    let existing: Option<i64> = tx.query_row("SELECT id FROM hub_projects WHERE origin = ?1", [&origin], |r| r.get(0)).optional()?;
    let id = match existing {
        Some(id) => {
            tx.execute("UPDATE hub_projects SET name = ?1, stage = ?2, fields = ?3, repo_url = ?4, credits_min = ?5, credits_max = ?6, estimate_min = ?7, owner_nick = ?8, role = ?9, updated_at = ?10 WHERE id = ?11", params![name, stage, fields, repo_url, snap["creditsMin"].as_f64(), snap["creditsMax"].as_f64(), snap["estimateMin"].as_i64(), owner_nick, role, now, id])?;
            tx.execute("DELETE FROM hub_items WHERE project_id = ?1", [id])?;
            id
        }
        None => {
            tx.execute(
                "INSERT INTO hub_projects (name, stage, fields, repo_url, credits_min, credits_max, estimate_min, owner, owner_nick, role, origin, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)",
                params![name, stage, fields, repo_url, snap["creditsMin"].as_f64(), snap["creditsMax"].as_f64(), snap["estimateMin"].as_i64(), owner, owner_nick, role, origin, now],
            )?;
            tx.last_insert_rowid()
        }
    };
    for it in snap["items"].as_array().into_iter().flatten().take(500) {
        let kind = it["kind"].as_str().unwrap_or("");
        if !ITEM_KINDS.contains(&kind) || kind == "file" {
            continue;
        }
        let title = clip(it["title"].as_str().unwrap_or(""), 200);
        if title.is_empty() {
            continue;
        }
        tx.execute(
            "INSERT INTO hub_items (project_id, kind, title, body, url, path, due_day, done, assignee, role, author, created_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![id, kind, title, clip(it["body"].as_str().unwrap_or(""), MAX_TEXT), clean_url(it["url"].as_str()).unwrap_or(None), clean_day(it["dueDay"].as_str()).unwrap_or(None), it["done"].as_bool().unwrap_or(false) as i64, it["assignee"].as_str().map(|a| clip(a, 60)), it["role"].as_str().filter(|r| ROLES[1..].contains(r)), it["author"].as_str().map(|a| clip(a, 60)), it["createdAt"].as_i64().unwrap_or(now)],
        )?;
    }
    tx.commit()?;
    get(conn, id)
}

/// The role of a member's device in one of my projects, when it is a member.
pub fn member_role(conn: &Connection, project: i64, fp: &str) -> Result<Option<String>> {
    let p = get(conn, project)?;
    if p.role != "owner" {
        return Ok(None);
    }
    Ok(conn.query_row("SELECT role FROM hub_items WHERE project_id = ?1 AND kind = 'member' AND url = ?2", params![project, fp], |r| r.get(0)).optional()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    const NOW: i64 = 1_794_480_000;

    #[test]
    fn a_project_starts_with_a_name_and_keeps_only_known_fields() {
        let conn = db::open_in_memory().unwrap();
        assert!(save(&conn, &Project { name: "  ".into(), ..Default::default() }, NOW).is_err());
        let mut fields = Map::new();
        fields.insert("pitch".into(), Value::String(" Une appli de covoiturage étudiant ".into()));
        fields.insert("technologies".into(), serde_json::json!(["Rust", "", "React"]));
        fields.insert("script".into(), Value::String("rm -rf /".into()));
        let p = save(&conn, &Project { name: "Covoit".into(), fields, credits_min: Some(4.0), credits_max: Some(2.0), ..Default::default() }, NOW).unwrap();
        assert_eq!((p.stage.as_str(), p.role.as_str()), ("idea", "owner"));
        assert_eq!(p.fields["pitch"], "Une appli de covoiturage étudiant");
        assert_eq!(p.fields["technologies"], serde_json::json!(["Rust", "React"]));
        assert!(!p.fields.contains_key("script"));
        assert_eq!((p.credits_min, p.credits_max), (Some(2.0), Some(4.0)), "a reversed range is put back in order");
        assert!(save(&conn, &Project { name: "x".into(), stage: "shipping".into(), ..Default::default() }, NOW).is_err());
        assert!(save(&conn, &Project { name: "x".into(), repo_url: Some("javascript:alert(1)".into()), ..Default::default() }, NOW).is_err());
    }

    #[test]
    fn progress_is_counted_from_real_things() {
        let conn = db::open_in_memory().unwrap();
        let p = save(&conn, &Project { name: "Covoit".into(), ..Default::default() }, NOW).unwrap();
        for (t, done, day) in [("Maquette", true, Some("2026-11-10")), ("Prototype", false, Some("2026-12-01")), ("Démo", false, None)] {
            save_item(&conn, &Item { project_id: p.id, kind: "milestone".into(), title: t.into(), done, due_day: day.map(str::to_string), ..Default::default() }, NOW).unwrap();
        }
        crate::planner::save_task(&conn, &crate::planner::Task { title: "API".into(), project: Some(key(p.id)), done_at: Some(NOW), ..Default::default() }, NOW).unwrap();
        crate::planner::save_task(&conn, &crate::planner::Task { title: "UI".into(), project: Some(key(p.id)), ..Default::default() }, NOW).unwrap();
        crate::planner::log_work(&conn, Some(&key(p.id)), None, "Focus", NOW - 7200, 5400).unwrap();
        let f = facts(&conn, p.id, NOW).unwrap();
        assert_eq!((f.milestones, f.milestones_done, f.tasks, f.tasks_done, f.minutes_worked), (3, 1, 2, 1, 90));
        assert_eq!((f.next_milestone.as_deref(), f.next_due.as_deref()), (Some("Prototype"), Some("2026-12-01")));
    }

    #[test]
    fn a_shared_copy_follows_the_owner_and_respects_its_role() {
        let conn = db::open_in_memory().unwrap();
        let mine = save(&conn, &Project { name: "Covoit".into(), repo_path: Some("/home/me/secret".into()), ..Default::default() }, NOW).unwrap();
        save_item(&conn, &Item { project_id: mine.id, kind: "member".into(), title: "Lou".into(), url: Some("fp-lou".into()), role: Some("editor".into()), ..Default::default() }, NOW).unwrap();
        save_item(&conn, &Item { project_id: mine.id, kind: "file".into(), title: "slides.pdf".into(), path: Some("slides.pdf".into()), ..Default::default() }, NOW).unwrap();
        assert_eq!(member_role(&conn, mine.id, "fp-lou").unwrap().as_deref(), Some("editor"));
        assert_eq!(member_role(&conn, mine.id, "fp-stranger").unwrap(), None, "a device that is not a member gets nothing");
        let snap = snapshot(&conn, mine.id).unwrap();
        let text = snap.to_string();
        assert!(!text.contains("/home/me/secret") && !text.contains("fp-lou") && !text.contains("slides.pdf"), "no local path, fingerprint or kept file leaves: {text}");
        // On the member's device.
        let other = db::open_in_memory().unwrap();
        let copy = import_shared(&other, "fp-owner", "Sam", 7, "viewer", &snap, NOW).unwrap();
        assert_eq!((copy.role.as_str(), copy.owner.as_deref(), copy.remote_id), ("viewer", Some("fp-owner"), Some(7)));
        assert!(save(&other, &Project { name: "Pirate".into(), ..copy.clone() }, NOW).is_err(), "a viewer cannot change the copy");
        assert!(save_item(&other, &Item { project_id: copy.id, kind: "link".into(), title: "x".into(), ..Default::default() }, NOW).is_err());
        // The owner's next state replaces the copy, it never duplicates it.
        let again = import_shared(&other, "fp-owner", "Sam", 7, "editor", &snap, NOW + 5).unwrap();
        assert_eq!(again.id, copy.id);
        assert_eq!(list(&other).unwrap().len(), 1);
        assert_eq!(items(&other, copy.id).unwrap().iter().filter(|i| i.kind == "member").count(), 1);
    }
}
