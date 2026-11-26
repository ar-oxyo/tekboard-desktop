//! Typed views over the cached MY Epitech answers, for the screens that are not the MY
//! Epitech page itself: the agenda (hand-ins, sessions, holidays) and the academic part of
//! Analytics (credits, units, skills, log time, automated test results).
//! Field names are the ones observed in real answers. A field that is absent stays absent:
//! nothing is estimated, and each view says which answers it could not read.

use crate::deadlines;
use crate::myview::Overview;
use crate::projects::BoardItem;
use chrono::{DateTime, Local, NaiveDate};
use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};

pub const EVENTS: &str = "/events?startDate={from}&endDate={to}";
/// Sessions the student is registered to (to the session itself or to one of its slots).
pub const MY_EVENTS: &str = "/events?startDate={from}&endDate={to}&registered=me";

/// A cached answer, or why there is none (`never synced`, `HTTP 403`…).
fn cached(conn: &Connection, route: &str) -> std::result::Result<Value, String> {
    let row: Option<(i64, String)> = conn.query_row("SELECT status, body FROM my_cache WHERE route = ?1", [route], |r| Ok((r.get(0)?, r.get(1)?))).ok();
    match row {
        None => Err("never synced".into()),
        Some((status, body)) if (200..300).contains(&status) => serde_json::from_str(&body).map_err(|_| "unreadable answer".to_string()),
        Some((0, _)) => Err("no answer from the site".into()),
        Some((status, _)) => Err(format!("refused by the site (HTTP {status})")),
    }
}

fn s(v: &Value) -> Option<String> {
    v.as_str().map(str::trim).filter(|x| !x.is_empty()).map(str::to_string)
}

fn local_day(iso: &str) -> Option<String> {
    DateTime::parse_from_rfc3339(iso).ok().map(|d| d.with_timezone(&Local).format("%Y-%m-%d").to_string())
}

// ───────────────────────────── agenda ─────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgendaItem {
    /// `deadline` (hand-in), `start` (a project opens), `activity` (a session of one of your
    /// projects), `event` (a session listed for the campus), `holiday`.
    pub kind: &'static str,
    pub title: String,
    /// Local day the item is listed under (`YYYY-MM-DD`).
    pub day: String,
    /// Instants (RFC 3339) when known; a hand-in typed without hour has none.
    pub start: Option<String>,
    pub end: Option<String>,
    pub module: Option<String>,
    /// Rooms, attendance status, or where the date comes from.
    pub detail: Option<String>,
    /// Concerns you for certain: your hand-ins, your projects' sessions, sessions of your modules.
    pub mine: bool,
    pub mandatory: bool,
    pub exam: bool,
    pub repo_path: Option<String>,
    /// Last day, for a period (holidays).
    pub until: Option<String>,
    /// Your attendance to a session, as MY Epitech words it (`registered`, `not_registered`, `absent`…).
    pub status: Option<String>,
    /// MY Epitech session id, to look up its free slots on demand.
    pub event_id: Option<i64>,
    /// Planning key of the project the item belongs to (repository path, or `my:<id>` when it
    /// is not cloned): what "leave this project out of the calendar" applies to.
    pub project_key: Option<String>,
    /// Whose agenda it comes from: `student`, `aer` (the AER account, see `myaer`) or `both`
    /// (the same session in both agendas, shown once).
    pub account: &'static str,
}

/// `not_registered` → `not registered`.
fn status_text(status: &str) -> &str {
    match status {
        "not_registered" => "not registered",
        other => other,
    }
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Agenda {
    pub items: Vec<AgendaItem>,
    pub synced_at: Option<i64>,
    /// Module codes of your registered projects: what "mine" means for campus sessions.
    pub modules: Vec<String>,
    /// What could not be shown and why.
    pub notes: Vec<String>,
    /// Peer evaluations assigned to you and not submitted yet (activity names).
    pub peer_todo: Vec<String>,
}

fn sort_key(i: &AgendaItem) -> (String, u8, i64, String) {
    // Inside a day: periods first, then by real instant (answers mix UTC and local offsets),
    // items without an hour last.
    let rank = if i.kind == "holiday" { 0 } else { 1 };
    let at = i.start.as_deref().and_then(|x| DateTime::parse_from_rfc3339(x).ok()).map(|d| d.timestamp()).unwrap_or(i64::MAX);
    (i.day.clone(), rank, at, i.title.to_lowercase())
}

/// The agendas the planning shows (`myaer::sources`): the student's, the AER account's
/// sessions beside it when connected, or one of them only. The same session in both is
/// shown once; two sessions at the same hour stay two.
pub fn agenda(conn: &Connection, overview: &Overview, board: &[BoardItem]) -> Agenda {
    let sources = crate::myaer::sources(conn);
    let mut a = student_agenda(conn, overview, board);
    if !sources.student {
        // Hand-ins, project openings and holidays stay: they are work, not the timetable.
        a.items.retain(|i| !matches!(i.kind, "activity" | "event"));
    }
    if sources.aer {
        if let Some(v) = crate::myaer::events(conn) {
            merge_aer(&mut a.items, &v);
        }
    }
    a.items.sort_by_key(sort_key);
    a
}

/// Adds the sessions of the AER account. A session already in the student's agenda (same
/// MY Epitech id, or same title at the same start and end) is marked `both` instead.
pub fn merge_aer(items: &mut Vec<AgendaItem>, events: &Value) {
    for e in events.as_array().into_iter().flatten() {
        let id = e["id"].as_i64();
        let slot = s(&e["mySlotStartDate"]);
        let Some(start) = slot.clone().or_else(|| s(&e["startDate"])) else { continue };
        let Some(day) = local_day(&start) else { continue };
        let end = if slot.is_some() { s(&e["mySlotEndDate"]).or_else(|| s(&e["endDate"])) } else { s(&e["endDate"]) };
        let title = s(&e["fullTitle"]).or_else(|| s(&e["title"])).or_else(|| s(&e["activityName"])).unwrap_or_else(|| "Session".into());
        let instant = |x: &Option<String>| x.as_deref().and_then(|t| DateTime::parse_from_rfc3339(t).ok()).map(|d| d.timestamp());
        let same = items.iter_mut().find(|i| matches!(i.kind, "activity" | "event") && ((id.is_some() && i.event_id == id) || (i.title == title && instant(&i.start) == instant(&Some(start.clone())) && instant(&i.end) == instant(&end))));
        if let Some(existing) = same {
            existing.account = "both";
            existing.mine = true;
            continue;
        }
        let detail = [Some("AER".to_string()), s(&e["unitName"])].into_iter().flatten().collect::<Vec<_>>().join(" · ");
        items.push(AgendaItem { kind: "activity", title, day, start: Some(start), end, module: s(&e["unitCode"]), detail: Some(detail), mine: true, mandatory: false, exam: e["isExam"].as_bool().unwrap_or(false), repo_path: None, until: None, status: Some("registered".into()), event_id: id, project_key: None, account: "aer" });
    }
}

fn student_agenda(conn: &Connection, overview: &Overview, board: &[BoardItem]) -> Agenda {
    let mut a = Agenda { synced_at: overview.synced_at, ..Default::default() };
    let mut modules: Vec<String> = overview.projects.iter().map(|p| p.unit_code.clone()).filter(|u| !u.is_empty()).collect();
    modules.sort();
    modules.dedup();
    let mine: HashSet<&str> = modules.iter().map(String::as_str).collect();

    // Hand-ins: the same list as the dashboard, so both always agree.
    for b in board {
        let Some(day) = &b.day else { continue };
        let origin = match b.source.as_deref() {
            Some("my") => "hand-in, from MY Epitech",
            Some("manual") => "hand-in, typed by you",
            _ => "hand-in",
        };
        a.items.push(AgendaItem { kind: "deadline", title: b.title.clone(), day: day.clone(), start: b.at.clone(), end: None, module: b.module.clone(), detail: Some(if b.cloned { origin.to_string() } else { format!("{origin} · not cloned") }), mine: true, mandatory: true, exam: false, repo_path: b.repo_path.clone(), until: None, status: None, event_id: None, project_key: b.repo_path.clone().or_else(|| b.my_id.map(|i| format!("my:{i}"))), account: "student" });
    }
    // Projects that open later.
    for p in overview.projects.iter().filter(|p| p.upcoming) {
        if let Some(due) = p.start.as_deref().and_then(deadlines::from_instant) {
            a.items.push(AgendaItem { kind: "start", title: format!("{} opens", p.name), day: due.day, start: due.at, end: None, module: Some(p.unit_code.clone()).filter(|u| !u.is_empty()), detail: p.unit_name.clone(), mine: true, mandatory: false, exam: false, repo_path: p.repo_path.clone(), until: None, status: None, event_id: None, project_key: Some(p.repo_path.clone().unwrap_or_else(|| format!("my:{}", p.id))), account: "student" });
        }
    }
    // Your attendance per session, from the activities of your projects: `registered`,
    // `not_registered`, `absent`, `present`…, and whether the session is mandatory.
    let mut attendance: HashMap<i64, (Option<String>, bool)> = HashMap::new();
    let mut activities: Vec<(&crate::myview::Project, Value)> = Vec::new();
    for p in &overview.projects {
        let Ok(v) = cached(conn, &format!("/units/instances/projects/{}/my-activities", p.id)) else { continue };
        for x in v.as_array().into_iter().flatten() {
            if let Some(id) = x["eventId"].as_i64() {
                attendance.insert(id, (s(&x["status"]), x["mandatory"].as_bool().unwrap_or(false)));
            }
            activities.push((p, x.clone()));
        }
    }
    let mut seen_events: HashSet<i64> = HashSet::new();
    // 1. Your timetable: the sessions you are registered to, at the hours of your own slot
    //    when you hold one inside a longer session (a review, a defence).
    if let Ok(v) = cached(conn, MY_EVENTS) {
        for e in v.as_array().into_iter().flatten() {
            let id = e["id"].as_i64();
            if id.is_some_and(|id| !seen_events.insert(id)) {
                continue;
            }
            let slot = s(&e["mySlotStartDate"]);
            let Some(start) = slot.clone().or_else(|| s(&e["startDate"])) else { continue };
            let Some(day) = local_day(&start) else { continue };
            let end = if slot.is_some() { s(&e["mySlotEndDate"]).filter(|x| *x != start).or_else(|| s(&e["endDate"])) } else { s(&e["endDate"]) };
            let project = e["projectInstanceId"].as_i64().and_then(|pid| overview.projects.iter().find(|p| p.id == pid));
            let (status, mandatory) = id.and_then(|i| attendance.get(&i).cloned()).unwrap_or((Some("registered".into()), false));
            let status = status.or(Some("registered".into()));
            let detail = [s(&e["unitName"]), slot.is_some().then(|| "your slot".to_string()), status.as_deref().map(|x| status_text(x).to_string())].into_iter().flatten().collect::<Vec<_>>().join(" · ");
            a.items.push(AgendaItem {
                kind: "activity",
                title: s(&e["fullTitle"]).or_else(|| s(&e["title"])).or_else(|| s(&e["activityName"])).unwrap_or_else(|| "Session".into()),
                day,
                start: Some(start),
                end,
                module: s(&e["unitCode"]),
                detail: Some(detail),
                mine: true,
                mandatory,
                exam: e["isExam"].as_bool().unwrap_or(false),
                repo_path: project.and_then(|p| p.repo_path.clone()),
                until: None,
                status,
                event_id: id,
                project_key: project.map(|p| p.repo_path.clone().unwrap_or_else(|| format!("my:{}", p.id))),
                account: "student",
            });
        }
    }
    // 2. Sessions of your projects that are not in your timetable: mostly the ones you are
    //    not registered to yet, which is worth knowing.
    for (p, x) in activities {
        let (Some(start), Some(title)) = (s(&x["startDate"]), s(&x["name"])) else { continue };
        let Some(day) = local_day(&start) else { continue };
        if x["eventId"].as_i64().is_some_and(|id| !seen_events.insert(id)) {
            continue;
        }
        let status = s(&x["status"]);
        a.items.push(AgendaItem { kind: "activity", title, day, start: Some(start), end: s(&x["endDate"]), module: Some(p.unit_code.clone()).filter(|u| !u.is_empty()), detail: status.as_deref().map(status_text).map(str::to_string), mine: true, mandatory: x["mandatory"].as_bool().unwrap_or(false), exam: false, repo_path: p.repo_path.clone(), until: None, status, event_id: x["eventId"].as_i64(), project_key: Some(p.repo_path.clone().unwrap_or_else(|| format!("my:{}", p.id))), account: "student" });
    }
    // Sessions listed for the campus in the synced window.
    match cached(conn, EVENTS) {
        Err(why) => a.notes.push(format!("Sessions: {why}.")),
        Ok(v) => {
            for e in v.as_array().into_iter().flatten() {
                if e["id"].as_i64().is_some_and(|id| seen_events.contains(&id)) {
                    continue;
                }
                let Some(start) = s(&e["startDate"]) else { continue };
                let Some(day) = local_day(&start) else { continue };
                let module = s(&e["unitCode"]);
                let rooms: Vec<String> = e["rooms"].as_array().map(|r| r.iter().filter_map(|x| s(&x["name"])).collect()).unwrap_or_default();
                let unit = s(&e["unitName"]);
                let detail = [unit, (!rooms.is_empty()).then(|| rooms.join(", "))].into_iter().flatten().collect::<Vec<_>>().join(" · ");
                a.items.push(AgendaItem {
                    kind: "event",
                    title: s(&e["fullTitle"]).or_else(|| s(&e["title"])).or_else(|| s(&e["activityName"])).unwrap_or_else(|| "Session".into()),
                    day,
                    start: Some(start),
                    end: s(&e["endDate"]),
                    mine: module.as_deref().is_some_and(|m| mine.contains(m)),
                    module,
                    detail: Some(detail).filter(|d| !d.is_empty()),
                    mandatory: false,
                    exam: e["isExam"].as_bool().unwrap_or(false),
                    repo_path: None,
                    until: None,
                    status: None,
                    event_id: e["id"].as_i64(),
                    project_key: None,
                    account: "student",
                });
            }
        }
    }
    // Public holidays of the attendance plan.
    match cached(conn, "/cursus/me/attendance-plan") {
        Err(why) => a.notes.push(format!("Attendance plan: {why}.")),
        Ok(v) => {
            for x in v.as_array().into_iter().flatten().filter(|x| x["type"] == "PUBLIC_HOLIDAY") {
                let (Some(from), Some(to)) = (s(&x["from"]), s(&x["to"])) else { continue };
                if NaiveDate::parse_from_str(&from, "%Y-%m-%d").is_err() {
                    continue;
                }
                a.items.push(AgendaItem { kind: "holiday", title: s(&x["name"]).unwrap_or_else(|| "Public holiday".into()), day: from.clone(), start: None, end: None, module: None, detail: None, mine: true, mandatory: false, exam: false, repo_path: None, until: Some(to).filter(|t| *t != from), status: None, event_id: None, project_key: None, account: "student" });
            }
        }
    }
    if let Ok(v) = cached(conn, "/peer-evaluations/assignments/me") {
        a.peer_todo = v.as_array().into_iter().flatten().filter(|x| x["status"].as_str().is_some_and(|st| st != "submitted") && x["submittedAt"].is_null()).filter_map(|x| s(&x["activityName"])).collect();
    }
    a.items.sort_by_key(sort_key);
    a.modules = modules;
    a
}

// ───────────────────────────── academic analytics ─────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub title: String,
    pub validated: bool,
    pub mandatory: bool,
    pub points: Option<f64>,
    pub total: Option<f64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Unit {
    pub title: String,
    pub grade: Option<String>,
    pub credits: Option<i64>,
    pub validated: i64,
    pub total: i64,
    pub counts_in_gpa: Option<bool>,
    pub alert: Option<String>,
    pub outcomes: Vec<Outcome>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Competency {
    pub name: String,
    pub available: Option<i64>,
    pub secure: Option<i64>,
    pub reachable: Option<i64>,
    pub alert: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LogDay {
    pub date: String,
    /// Seconds logged that day.
    pub mine: f64,
    /// Average of the promotion, when the site gives it.
    pub promo: Option<f64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Mark {
    pub date: Option<String>,
    pub title: String,
    pub mark: Option<f64>,
    pub evaluator: Option<String>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TestPoint {
    pub project: String,
    pub module: String,
    pub date: Option<String>,
    pub passed: i64,
    pub total: i64,
    pub runs: usize,
    pub style_major: i64,
    pub style_minor: i64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Academic {
    pub synced_at: Option<i64>,
    pub credits_acquired: Option<i64>,
    pub credits_total: Option<i64>,
    pub semester: Option<i64>,
    pub units: Vec<Unit>,
    pub competencies: Vec<Competency>,
    pub exams: Vec<crate::myview::Exam>,
    pub logtime: Vec<LogDay>,
    pub tests: Vec<TestPoint>,
    /// Marks given on sessions (reviews, defences…), most recent first.
    pub marks: Vec<Mark>,
    /// Nodes of the validation graph by kind and status: (kind, status, count).
    pub graph: Vec<(String, String, usize)>,
    /// MY Epitech's own warning levels (`green`, `orange`, `red`…), as it words them.
    pub global_alert: Option<String>,
    pub credits_alert: Option<String>,
    /// Units whose credits MY Epitech counts as lost or at risk: (title, credits).
    pub credits_lost: Vec<(String, i64)>,
    pub credits_at_risk: Vec<(String, i64)>,
    pub level: Option<i64>,
    pub xp: Option<i64>,
    pub xp_to_next: Option<i64>,
    /// Projects registered, and how many are over.
    pub projects_total: usize,
    pub projects_done: usize,
    pub notes: Vec<String>,
}

/// Seconds of an ISO 8601 duration such as `PT5365S`, `PT1H30M` or `PT1576.857S`.
pub fn duration_secs(iso: &str) -> Option<f64> {
    let rest = iso.trim().strip_prefix("PT")?;
    if rest.is_empty() {
        return None;
    }
    let mut total = 0.0;
    let mut num = String::new();
    for c in rest.chars() {
        match c {
            '0'..='9' | '.' => num.push(c),
            'H' | 'M' | 'S' => {
                let n: f64 = num.parse().ok()?;
                total += n * if c == 'H' { 3600.0 } else if c == 'M' { 60.0 } else { 1.0 };
                num.clear();
            }
            _ => return None,
        }
    }
    num.is_empty().then_some(total)
}

pub fn academic(conn: &Connection, overview: &Overview) -> Academic {
    let mut a = Academic { synced_at: overview.synced_at, credits_acquired: overview.credits_acquired, credits_total: overview.credits_total, exams: overview.exams.clone(), ..Default::default() };
    a.projects_total = overview.projects.len();
    a.projects_done = overview.projects.iter().filter(|p| !p.ongoing && !p.upcoming).count();
    match cached(conn, "/evaluations/validations/me") {
        Err(why) => a.notes.push(format!("Units and skills: {why}.")),
        Ok(v) => {
            a.semester = v["semester"].as_i64();
            a.units = v["blocks"].as_array().into_iter().flatten().map(|b| Unit {
                title: s(&b["title"]).unwrap_or_default(),
                grade: s(&b["grade"]),
                credits: b["credits"].as_i64(),
                validated: b["validatedCount"].as_i64().unwrap_or(0),
                total: b["totalCount"].as_i64().unwrap_or(0),
                counts_in_gpa: b["countsInGpa"].as_bool(),
                alert: s(&b["alertLevel"]),
                outcomes: b["learningOutcomes"].as_array().into_iter().flatten().map(|o| Outcome { title: s(&o["title"]).unwrap_or_default(), validated: o["isValidated"].as_bool().unwrap_or(false), mandatory: o["isMandatory"].as_bool().unwrap_or(false), points: o["acquiredPoints"].as_f64(), total: o["totalPoints"].as_f64() }).collect(),
            }).collect();
            a.competencies = v["competencyBlocks"].as_array().into_iter().flatten().map(|c| Competency { name: s(&c["name"]).unwrap_or_default(), available: c["availableCredits"].as_i64(), secure: c["secureCredits"].as_i64(), reachable: c["reachableCredits"].as_i64(), alert: s(&c["alertLevel"]) }).collect();
        }
    }
    if let Ok(v) = cached(conn, "/evaluations/validations/alerts/me") {
        let list = |key: &str| v[key].as_array().into_iter().flatten().filter_map(|x| Some((s(&x["title"])?, x["credits"].as_i64()?))).collect::<Vec<_>>();
        a.global_alert = s(&v["globalAlert"]);
        a.credits_alert = s(&v["creditsAlert"]);
        a.credits_lost = list("creditsLost");
        a.credits_at_risk = list("creditsAtRisk");
    }
    if let Ok(v) = cached(conn, "/gamification/xp/me") {
        a.level = v["level"].as_i64();
        a.xp = v["totalXp"].as_i64();
        a.xp_to_next = v["xpToNext"].as_i64();
    }
    if let Ok(v) = cached(conn, "/students/evaluations/marks") {
        a.marks = v.as_array().into_iter().flatten().filter_map(|m| Some(Mark { date: s(&m["date"]), title: s(&m["activityTitle"]).or_else(|| s(&m["eventTitle"]))?, mark: m["mark"].as_f64(), evaluator: s(&m["evaluator"]), comment: s(&m["comment"]) })).collect();
        a.marks.sort_by(|x, y| y.date.cmp(&x.date));
    }
    match cached(conn, "/students/logtime") {
        Err(why) => a.notes.push(format!("Log time: {why}.")),
        Ok(v) => {
            a.logtime = v.as_array().into_iter().flatten().filter_map(|d| Some(LogDay { date: s(&d["date"])?, mine: d["log_time"].as_str().and_then(duration_secs)?, promo: d["promo_log_time"].as_str().and_then(duration_secs) })).collect();
            a.logtime.sort_by(|x, y| x.date.cmp(&y.date));
        }
    }
    match cached(conn, "/evaluations/validations/graph/me") {
        Err(why) => a.notes.push(format!("Validation graph: {why}.")),
        Ok(v) => {
            let mut counts: std::collections::BTreeMap<(String, String), usize> = Default::default();
            for n in v["nodes"].as_array().into_iter().flatten() {
                if let (Some(kind), Some(status)) = (s(&n["kind"]), s(&n["status"])) {
                    *counts.entry((kind, status)).or_default() += 1;
                }
            }
            a.graph = counts.into_iter().map(|((k, st), n)| (k, st, n)).collect();
        }
    }
    a.tests = overview.projects.iter().filter_map(|p| {
        let t = p.last_test.as_ref()?;
        Some(TestPoint { project: p.name.clone(), module: p.unit_code.clone(), date: t.date.clone(), passed: t.passed?, total: t.total?, runs: t.runs, style_major: t.style_major, style_minor: t.style_minor })
    }).collect();
    a.tests.sort_by(|x, y| x.date.cmp(&y.date));
    if a.tests.is_empty() && !overview.projects.is_empty() {
        a.notes.push("Automated test results: none synced yet (they are read for ongoing projects).".into());
    }
    a
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::myview;
    use chrono::Utc;

    fn session(id: i64, title: &str, start: &str, end: &str) -> AgendaItem {
        AgendaItem { kind: "activity", title: title.into(), day: "2026-11-20".into(), start: Some(start.into()), end: Some(end.into()), module: None, detail: None, mine: true, mandatory: false, exam: false, repo_path: None, until: None, status: None, event_id: Some(id), project_key: None, account: "student" }
    }

    #[test]
    fn the_aer_agenda_joins_the_student_one_without_real_duplicates() {
        let mut items = vec![session(7, "Review", "2026-11-20T10:00:00Z", "2026-11-20T11:00:00Z"), session(5, "Bootstrap", "2026-11-20T14:00:00Z", "2026-11-20T16:00:00Z")];
        let aer = serde_json::json!([
            // The same session (same id): one line, from both agendas.
            {"id": 7, "title": "Review", "startDate": "2026-11-20T10:00:00Z", "endDate": "2026-11-20T11:00:00Z"},
            // Same title, same instants written with another offset: a real duplicate.
            {"id": 50, "title": "Bootstrap", "startDate": "2026-11-20T15:00:00+01:00", "endDate": "2026-11-20T17:00:00+01:00"},
            // Another session at the same hour: kept, marked AER.
            {"id": 9, "title": "Kick-off AER", "startDate": "2026-11-20T10:00:00Z", "endDate": "2026-11-20T11:00:00Z", "unitName": "Pédagogie"}
        ]);
        merge_aer(&mut items, &aer);
        assert_eq!(items.iter().map(|i| (i.event_id, i.account)).collect::<Vec<_>>(), vec![(Some(7), "both"), (Some(5), "both"), (Some(9), "aer")]);
        assert_eq!(items[2].detail.as_deref(), Some("AER · Pédagogie"));
    }

    fn put(conn: &Connection, route: &str, status: i64, body: &str) {
        conn.execute("INSERT INTO my_cache (route, fetched_at, status, body) VALUES (?1, 500, ?2, ?3)", rusqlite::params![route, status, body]).unwrap();
    }

    const ALL: &str = "/units/instances/projects?page=1&limit=50&registeredOnly=true";

    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-11-11T12:00:00Z").unwrap().with_timezone(&Utc)
    }

    fn school(conn: &Connection) -> Overview {
        put(conn, ALL, 200, r#"{"data":[
            {"id":2,"name":"SettingUp","startDate":"2026-10-24T06:42:00.000Z","endDate":"2026-11-13T18:42:00.000Z","unitInstance":{"unitCode":"G-CPE-110","name":"Elementary programming"}},
            {"id":5,"name":"my_sudo","startDate":"2026-11-14T07:42:00.000Z","endDate":"2026-12-04T18:42:00.000Z","unitInstance":{"unitCode":"G-PSU-100","name":"Unix"}}]}"#);
        put(conn, "/units/instances/projects/2/my-activities", 200, r#"[{"name":"Review - Setting Up","startDate":"2026-11-12T13:00:00.000Z","endDate":"2026-11-12T13:30:00.000Z","mandatory":true,"eventId":77,"status":"registered"}]"#);
        myview::overview_at(conn, &[], now())
    }

    #[test]
    fn the_agenda_merges_hand_ins_sessions_and_holidays_without_repeating_them() {
        let conn = db::open_in_memory().unwrap();
        let o = school(&conn);
        put(&conn, EVENTS, 200, r#"[
            {"id":77,"title":"Review","fullTitle":"Review - Setting Up","startDate":"2026-11-12T13:00:00.000Z","endDate":"2026-11-12T13:30:00.000Z","unitCode":"G-CPE-110","rooms":[]},
            {"id":78,"title":"Bootstrap","fullTitle":"Bootstrap - my_sudo","startDate":"2026-11-16T08:00:00.000Z","endDate":"2026-11-16T10:00:00.000Z","unitCode":"G-PSU-100","unitName":"Unix","rooms":[{"name":"108 -> Donald Knuth"},{"name":"109"}],"isExam":false},
            {"id":79,"title":"Follow-up","startDate":"2026-11-13T08:30:00.000Z","endDate":"2026-11-13T16:30:00.000Z","unitCode":"D-MKT-902","unitName":"Marketing","rooms":[]},
            {"id":80,"title":"No date"}]"#);
        put(&conn, "/cursus/me/attendance-plan", 200, r#"[{"type":"SCHOOL","from":"2026-11-09","to":"2026-11-13"},{"type":"PUBLIC_HOLIDAY","from":"2026-11-11","to":"2026-11-11","name":null},{"type":"PUBLIC_HOLIDAY","from":"2026-12-21","to":"2027-01-01","name":"Winter break"}]"#);
        let board = crate::projects::board(&[], &o, now());
        let a = agenda(&conn, &o, &board);
        let got: Vec<(&str, &str, bool)> = a.items.iter().map(|i| (i.kind, i.title.as_str(), i.mine)).collect();
        assert_eq!(got, vec![
            ("holiday", "Public holiday", true),
            ("activity", "Review - Setting Up", true),
            ("event", "Follow-up", false),
            ("deadline", "SettingUp", true),
            ("start", "my_sudo opens", true),
            ("event", "Bootstrap - my_sudo", true),
            ("deadline", "my_sudo", true),
            ("holiday", "Winter break", true),
        ]);
        assert_eq!(a.items.iter().filter(|i| i.title.starts_with("Review")).count(), 1, "the session of your project is not listed a second time as a campus session");
        let bootstrap = a.items.iter().find(|i| i.title.starts_with("Bootstrap")).unwrap();
        assert_eq!(bootstrap.detail.as_deref(), Some("Unix · 108 -> Donald Knuth, 109"));
        assert!(a.items[1].mandatory && a.items[1].detail.as_deref() == Some("registered"));
        assert_eq!(a.items.last().unwrap().until.as_deref(), Some("2027-01-01"));
        assert_eq!(a.modules, vec!["G-CPE-110", "G-PSU-100"]);
        assert!(a.peer_todo.is_empty());
        put(&conn, "/peer-evaluations/assignments/me", 200, r#"[{"activityName":"Pitch","status":"submitted","submittedAt":"2026-11-09T13:52:18Z"},{"activityName":"E-mail","status":"pending","submittedAt":null}]"#);
        assert_eq!(agenda(&conn, &o, &board).peer_todo, vec!["E-mail"]);
        assert!(a.notes.is_empty());
    }

    #[test]
    fn sessions_you_are_registered_to_are_yours_at_the_hours_of_your_slot() {
        let conn = db::open_in_memory().unwrap();
        let o = school(&conn);
        put(&conn, MY_EVENTS, 200, r#"[
            {"id":77,"fullTitle":"Review - Setting Up","startDate":"2026-11-12T13:00:00.000Z","endDate":"2026-11-12T13:30:00.000Z","unitCode":"G-CPE-110"},
            {"id":90,"fullTitle":"Defence - SettingUp","startDate":"2026-11-17T08:00:00.000Z","endDate":"2026-11-17T17:00:00.000Z","mySlotStartDate":"2026-11-17T10:20:00.000Z","mySlotEndDate":"2026-11-17T10:40:00.000Z","unitCode":"G-CPE-110","unitName":"Elementary programming","projectInstanceId":2,"isExam":true},
            {"id":91,"title":"Conference","startDate":"2026-11-18T09:00:00.000Z","endDate":"2026-11-18T10:00:00.000Z","unitCode":"X-OTH-000"}]"#);
        put(&conn, EVENTS, 200, r#"[{"id":90,"title":"Defence","startDate":"2026-11-17T08:00:00.000Z","endDate":"2026-11-17T17:00:00.000Z","unitCode":"G-CPE-110","rooms":[]},
            {"id":91,"title":"Conference","startDate":"2026-11-18T09:00:00.000Z","endDate":"2026-11-18T10:00:00.000Z","unitCode":"X-OTH-000","rooms":[]}]"#);
        put(&conn, "/cursus/me/attendance-plan", 200, "[]");
        let a = agenda(&conn, &o, &[]);
        let sessions: Vec<_> = a.items.iter().filter(|i| i.kind == "activity" || i.kind == "event").collect();
        assert_eq!(sessions.iter().map(|i| (i.kind, i.title.as_str())).collect::<Vec<_>>(), vec![("activity", "Review - Setting Up"), ("activity", "Defence - SettingUp"), ("activity", "Conference")], "nothing repeated, and a registered session of another module is still yours");
        let defence = sessions[1];
        assert_eq!((defence.start.as_deref(), defence.end.as_deref(), defence.exam, defence.mine), (Some("2026-11-17T10:20:00.000Z"), Some("2026-11-17T10:40:00.000Z"), true, true));
        assert_eq!(defence.detail.as_deref(), Some("Elementary programming · your slot · registered"));
    }

    #[test]
    fn your_slot_wins_over_the_whole_session_and_unregistered_sessions_are_flagged() {
        let conn = db::open_in_memory().unwrap();
        school(&conn);
        put(&conn, "/units/instances/projects/5/my-activities", 200, r#"[{"name":"Defense - my_sudo","startDate":"2026-11-17T08:00:00.000Z","endDate":"2026-11-17T11:00:00.000Z","mandatory":true,"eventId":90,"status":"registered"},
            {"name":"Final defense - my_sudo","startDate":"2026-12-05T08:00:00.000Z","endDate":"2026-12-05T11:00:00.000Z","mandatory":true,"eventId":91,"status":"not_registered"}]"#);
        let o = myview::overview_at(&conn, &[], now());
        put(&conn, MY_EVENTS, 200, r#"[{"id":90,"fullTitle":"Defense - my_sudo","startDate":"2026-11-17T08:00:00.000Z","endDate":"2026-11-17T11:00:00.000Z","mySlotStartDate":"2026-11-17T08:00:00.000Z","mySlotEndDate":"2026-11-17T09:00:00.000Z","unitCode":"G-PSU-100","projectInstanceId":5}]"#);
        let a = agenda(&conn, &o, &[]);
        let defence = a.items.iter().filter(|i| i.title == "Defense - my_sudo").collect::<Vec<_>>();
        assert_eq!(defence.len(), 1, "listed once");
        assert_eq!((defence[0].end.as_deref(), defence[0].mandatory, defence[0].status.as_deref()), (Some("2026-11-17T09:00:00.000Z"), true, Some("registered")));
        let fin = a.items.iter().find(|i| i.title == "Final defense - my_sudo").unwrap();
        assert_eq!((fin.status.as_deref(), fin.detail.as_deref(), fin.mandatory), (Some("not_registered"), Some("not registered"), true));
    }

    #[test]
    fn what_was_refused_or_never_synced_is_said_not_invented() {
        let conn = db::open_in_memory().unwrap();
        let o = school(&conn);
        put(&conn, EVENTS, 400, r#"{"message":"window too large"}"#);
        let a = agenda(&conn, &o, &[]);
        assert_eq!(a.notes, vec!["Sessions: refused by the site (HTTP 400).", "Attendance plan: never synced."]);
        assert!(a.items.iter().all(|i| i.kind != "event" && i.kind != "holiday"));
        let ac = academic(&conn, &o);
        assert!(ac.units.is_empty() && ac.logtime.is_empty() && ac.credits_acquired.is_none());
        assert_eq!(ac.notes.len(), 4, "{:?}", ac.notes);
        let empty = agenda(&db::open_in_memory().unwrap(), &Overview::default(), &[]);
        assert!(empty.items.is_empty() && empty.synced_at.is_none());
    }

    #[test]
    fn academic_view_reads_units_skills_log_time_and_test_results() {
        let conn = db::open_in_memory().unwrap();
        school(&conn);
        put(&conn, "/evaluations/validations/me", 200, r#"{"semester":1,"blocks":[{"title":"Applied Mathematics I","grade":"in progress","credits":2,"validatedCount":1,"totalCount":4,"countsInGpa":true,"alertLevel":"green","learningOutcomes":[{"title":"Solve","isValidated":true,"isMandatory":true,"acquiredPoints":3,"totalPoints":4},{"title":"Model","isValidated":false}]}],"competencyBlocks":[{"name":"Innovation","availableCredits":2,"secureCredits":0,"reachableCredits":1,"alertLevel":"green"}]}"#);
        put(&conn, "/evaluations/validations/credits/me", 200, r#"{"acquiredCredits":3,"totalAcquiredCredits":5}"#);
        put(&conn, "/students/logtime", 200, r#"[{"date":"2026-09-17","log_time":"PT1H30M","promo_log_time":null},{"date":"2026-09-16","log_time":"PT5365S","promo_log_time":"PT1576.857S"},{"date":"bad"}]"#);
        put(&conn, "/evaluations/validations/graph/me", 200, r#"{"nodes":[{"kind":"project","status":"completed"},{"kind":"project","status":"completed"},{"kind":"skill","status":"available"},{"kind":"skill"}]}"#);
        put(&conn, "/units/instances/projects/2/test-results", 200, r#"{"results":[{"properties":{"date":"2026-11-10T12:21:47Z"},"achievementSummary":{"passed":20,"total":24},"codingStyle":{"value":{"major":1,"minor":2}}}]}"#);
        let o = myview::overview_at(&conn, &[], now());
        let a = academic(&conn, &o);
        assert_eq!((a.credits_acquired, a.credits_total, a.semester), (Some(3), Some(5), Some(1)));
        assert_eq!((a.units[0].validated, a.units[0].total, a.units[0].outcomes.len()), (1, 4, 2));
        assert_eq!(a.units[0].outcomes[0], Outcome { title: "Solve".into(), validated: true, mandatory: true, points: Some(3.0), total: Some(4.0) });
        assert_eq!(a.competencies[0].reachable, Some(1));
        assert_eq!(a.logtime.iter().map(|d| (d.date.as_str(), d.mine, d.promo)).collect::<Vec<_>>(), vec![("2026-09-16", 5365.0, Some(1576.857)), ("2026-09-17", 5400.0, None)]);
        assert_eq!(a.graph, vec![("project".into(), "completed".into(), 2), ("skill".into(), "available".into(), 1)]);
        assert_eq!(a.tests, vec![TestPoint { project: "SettingUp".into(), module: "G-CPE-110".into(), date: Some("2026-11-10T12:21:47Z".into()), passed: 20, total: 24, runs: 1, style_major: 1, style_minor: 2 }]);
        assert_eq!((a.projects_total, a.projects_done), (2, 0));
        assert_eq!((a.global_alert.clone(), a.level, a.credits_lost.len()), (None, None, 0), "absent answers stay absent");
        put(&conn, "/evaluations/validations/alerts/me", 200, r#"{"globalAlert":"orange","creditsAlert":"green","creditsLost":[{"blockId":1,"title":"C Pool","credits":4},{"title":"no credits"}],"creditsAtRisk":[]}"#);
        put(&conn, "/gamification/xp/me", 200, r#"{"level":3,"totalXp":1250,"xpToNext":250}"#);
        let a = academic(&conn, &o);
        assert_eq!((a.global_alert.as_deref(), a.credits_alert.as_deref(), a.credits_lost.clone()), (Some("orange"), Some("green"), vec![("C Pool".to_string(), 4)]));
        assert_eq!((a.level, a.xp, a.xp_to_next), (Some(3), Some(1250), Some(250)));
        assert!(a.notes.is_empty(), "{:?}", a.notes);
    }

    #[test]
    fn durations() {
        assert_eq!(duration_secs("PT5365S"), Some(5365.0));
        assert_eq!(duration_secs("PT1576.857S"), Some(1576.857));
        assert_eq!(duration_secs("PT1H30M"), Some(5400.0));
        assert_eq!(duration_secs("PT0S"), Some(0.0));
        for bad in ["", "PT", "5365", "PT12", "P1D", "PTxS"] {
            assert_eq!(duration_secs(bad), None, "{bad}");
        }
    }
}
