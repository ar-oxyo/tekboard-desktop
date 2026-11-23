//! Things worth saying before being asked, found by plain rules (no model, no cost).
//!
//! Each insight has a stable key, so it is said once: it can be acted on (its buttons run a
//! tool or hand a request to Tika), put off, or dismissed for good. An insight whose cause
//! disappears is withdrawn by itself. How often the window shows one as a nudge is limited
//! there; the rest waits in the suggestions box.

use crate::commands::AppState;
use crate::error::Result;
use crate::schedule::{self, Busy, Rhythm};
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Insight {
    pub key: String,
    /// `deadline`, `stalled`, `overload`, `missed`, `tests`, `subject`.
    pub kind: &'static str,
    pub title: String,
    pub body: String,
    /// `[{label, tool, args}]` or `[{label, ask}]`.
    pub actions: Value,
}

fn tool(label: &str, name: &str, args: Value) -> Value {
    json!({"label": label, "tool": name, "args": args})
}
fn ask(label: &str, text: &str) -> Value {
    json!({"label": label, "ask": text})
}

/// What the rules look at.
pub struct Facts<'a> {
    pub now: i64,
    pub board: &'a [crate::projects::BoardItem],
    pub repos: &'a [crate::scanner::RepoInfo],
    pub events: &'a [crate::planner::PlanEvent],
    pub busy: &'a [Busy],
    pub rhythm: &'a Rhythm,
    /// (project, kind, started_at) of recent runs.
    pub runs: &'a [(String, String, i64)],
    /// (project, last focus start).
    pub focus: &'a [(String, i64)],
    /// (subject id, name, project) imported recently with no analysis yet.
    pub new_subjects: &'a [(i64, String, Option<String>)],
}

fn due_of(b: &crate::projects::BoardItem) -> Option<i64> {
    b.at.as_deref().and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok()).map(|d| d.timestamp()).or_else(|| b.day.as_deref().and_then(|d| crate::planner::parse_local(&format!("{d}T23:59")).ok()))
}

fn planned(events: &[crate::planner::PlanEvent], key: &str, now: i64) -> i64 {
    events.iter().filter(|e| (e.kind == "session" || e.kind == "task") && e.project.as_deref() == Some(key) && !e.done && e.end > now).map(|e| (e.end - e.start.max(now)) / 60).sum()
}

fn hours(s: i64) -> String {
    if s < 36 * 3600 {
        format!("{} h", (s / 3600).max(1))
    } else {
        format!("{} jours", (s + 43_200) / 86_400)
    }
}

pub fn detect(f: &Facts) -> Vec<Insight> {
    let mut out = Vec::new();
    for b in f.board.iter().filter(|b| b.status != "done") {
        let Some(due) = due_of(b) else { continue };
        let left = due - f.now;
        if left <= 0 {
            continue;
        }
        let key = b.repo_path.clone().or(b.my_id.map(|i| format!("my:{i}"))).unwrap_or_default();
        // Hand-in close, nothing planned.
        if left < 72 * 3600 && planned(f.events, &key, f.now) == 0 {
            out.push(Insight {
                key: format!("deadline:{key}:{}", b.day.clone().unwrap_or_default()),
                kind: "deadline",
                title: format!("Rendu de {} dans {}", b.title, hours(left)),
                body: "Aucune session n'est prévue d'ici là.".into(),
                actions: json!([tool("Planifier", "suggest_plan", json!({"scope": "week", "project": key})), ask("Trouver une solution", &format!("Le rendu de {} est dans {} et rien n'est prévu : aide-moi à m'organiser.", b.title, hours(left)))]),
            });
        }
        // Close hand-in, nothing tested lately.
        if left < 5 * 86_400 && b.cloned && !f.runs.iter().any(|(p, k, at)| p == &key && f.now - at < 7 * 86_400 && ["tests", "moulinette", "moulinette_ai", "testrepo", "checks"].contains(&k.as_str())) {
            out.push(Insight {
                key: format!("tests:{key}:{}", b.day.clone().unwrap_or_default()),
                kind: "tests",
                title: format!("{} n'a pas été testé cette semaine", b.title),
                body: format!("Le rendu est dans {}. Une moulinette maintenant évite les mauvaises surprises.", hours(left)),
                actions: json!([ask("Lancer une moulinette", &format!("Lance une moulinette sur {} (clé {key}) et explique les problèmes.", b.title)), tool("Ouvrir les vérifications", "navigate", json!({"page": "projects", "project": key, "tab": "checks"}))]),
            });
        }
        // A project that stopped moving while its hand-in comes.
        if left < 10 * 86_400 {
            let last_commit = f.repos.iter().find(|r| Some(&r.path) == b.repo_path.as_ref()).and_then(|r| r.last_commit.as_ref()).and_then(|c| chrono::DateTime::parse_from_rfc3339(&c.date).ok()).map(|d| d.timestamp());
            let last_focus = f.focus.iter().filter(|(p, _)| p == &key).map(|(_, t)| *t).max();
            let last = last_commit.into_iter().chain(last_focus).max();
            if let Some(last) = last.filter(|l| f.now - l > 4 * 86_400) {
                out.push(Insight {
                    key: format!("stalled:{key}:{}", (f.now - last) / (7 * 86_400)),
                    kind: "stalled",
                    title: format!("{} n'avance plus depuis {}", b.title, hours(f.now - last)),
                    body: format!("Rendu dans {}.", hours(left)),
                    actions: json!([ask("Trouver une solution", &format!("Je suis en retard sur {} (clé {key}), trouve une solution réaliste.", b.title)), tool("Démarrer 25 min", "start_focus", json!({"title": b.title, "project": key, "minutes": 25}))]),
                });
            }
        }
    }
    // Days over the ceiling in the coming week.
    let mut day = schedule::day_of(f.now);
    for _ in 0..7 {
        let l = schedule::day_load(f.busy, f.rhythm, day);
        if l.state == "over" && l.work_min > 0 {
            out.push(Insight {
                key: format!("overload:{}", schedule::local_iso(day).get(..10).unwrap_or_default()),
                kind: "overload",
                title: format!("{} est trop chargé", capitalize(&l.label)),
                body: format!("{} de travail{} pour un plafond de {}.", schedule::dur(l.work_min), if l.school_min > 0 { format!(" + {} d'école", schedule::dur(l.school_min)) } else { String::new() }, schedule::dur(l.max_min)),
                actions: json!([ask("Alléger", &format!("{} est trop chargé : propose-moi de déplacer du travail sur des jours plus légers.", l.label))]),
            });
        }
        day = schedule::next_day(day);
    }
    // Sessions that ended without being done.
    let missed = f.events.iter().filter(|e| (e.kind == "session" || e.kind == "task") && !e.done && e.end <= f.now && e.end > f.now - 3 * 86_400).count();
    if missed > 0 {
        out.push(Insight {
            key: format!("missed:{}", schedule::local_iso(schedule::day_of(f.now)).get(..10).unwrap_or_default()),
            kind: "missed",
            title: format!("{missed} session{} passée{} non faite{}", if missed > 1 { "s" } else { "" }, if missed > 1 { "s" } else { "" }, if missed > 1 { "s" } else { "" }),
            body: "Tu peux les marquer faites dans le planning, ou les replacer.".into(),
            actions: json!([tool("Replacer", "suggest_plan", json!({"scope": "reorganize"})), tool("Voir le planning", "navigate", json!({"page": "planning"}))]),
        });
    }
    for (id, name, project) in f.new_subjects {
        out.push(Insight {
            key: format!("subject:{id}"),
            kind: "subject",
            title: format!("Nouveau sujet : {name}"),
            body: "Tika peut le lire une fois pour toutes, en tirer les exigences et une estimation.".into(),
            actions: json!([ask("Analyser", &format!("Analyse le sujet {name}{} et dis-moi ce qu'il faut faire.", project.as_ref().map(|p| format!(" du projet {p}")).unwrap_or_default()))]),
        });
    }
    out
}

fn capitalize(s: &str) -> String {
    let mut c = s.chars();
    c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
}

/// Stores what was found: new insights appear, known ones keep their state, and the ones
/// whose cause is gone are withdrawn. Returns the keys that are new.
pub fn store(conn: &Connection, found: &[Insight], now: i64) -> Result<Vec<String>> {
    let mut new = Vec::new();
    for i in found {
        let n = conn.execute(
            "INSERT INTO ai_insights (key, kind, title, body, actions, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, 'new', ?6, ?6) ON CONFLICT(key) DO UPDATE SET title = excluded.title, body = excluded.body, actions = excluded.actions, updated_at = excluded.updated_at, status = CASE WHEN status = 'resolved' THEN 'new' ELSE status END",
            params![i.key, i.kind, i.title, i.body, i.actions.to_string(), now],
        )?;
        let created: i64 = conn.query_row("SELECT created_at FROM ai_insights WHERE key = ?1", [&i.key], |r| r.get(0))?;
        if n > 0 && created == now {
            new.push(i.key.clone());
        }
    }
    let keys: Vec<&str> = found.iter().map(|i| i.key.as_str()).collect();
    let mut st = conn.prepare("SELECT id, key FROM ai_insights WHERE status IN ('new', 'snoozed')")?;
    let open: Vec<(i64, String)> = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<std::result::Result<_, _>>()?;
    for (id, key) in open {
        if !keys.contains(&key.as_str()) {
            conn.execute("UPDATE ai_insights SET status = 'resolved', updated_at = ?2 WHERE id = ?1", params![id, now])?;
        }
    }
    conn.execute("DELETE FROM ai_insights WHERE updated_at < ?1 AND status IN ('resolved', 'dismissed', 'done')", [now - 30 * 86_400])?;
    Ok(new)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stored {
    pub id: i64,
    pub key: String,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub actions: Value,
    pub created_at: i64,
}

/// What the suggestions box shows now.
pub fn list(conn: &Connection, now: i64) -> Result<Vec<Stored>> {
    let mut st = conn.prepare("SELECT id, key, kind, title, body, actions, created_at FROM ai_insights WHERE status = 'new' OR (status = 'snoozed' AND snooze_until <= ?1) ORDER BY created_at DESC LIMIT 20")?;
    let rows = st.query_map([now], |r| Ok(Stored { id: r.get(0)?, key: r.get(1)?, kind: r.get(2)?, title: r.get(3)?, body: r.get(4)?, actions: serde_json::from_str(&r.get::<_, String>(5)?).unwrap_or(json!([])), created_at: r.get(6)? }))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

pub fn set_status(conn: &Connection, id: i64, status: &str, snooze_until: Option<i64>, now: i64) -> Result<()> {
    conn.execute("UPDATE ai_insights SET status = ?2, snooze_until = ?3, updated_at = ?4 WHERE id = ?1", params![id, status, snooze_until, now])?;
    Ok(())
}

/// Gathers the facts and runs the rules. Called every few minutes in the background.
pub fn refresh(state: &AppState) -> Result<Vec<String>> {
    let now = chrono::Utc::now().timestamp();
    let (repos, overview) = crate::commands::load_repos(state)?;
    let board = crate::projects::board(&repos, &overview, chrono::Utc::now());
    let conn = state.conn();
    let agenda = crate::mydata::agenda(&conn, &overview, &board);
    let plan = crate::planner::state(&conn, now)?;
    let rhythm = Rhythm::load(&conn);
    let busy = schedule::busy_from(&plan.events, &agenda.items);
    let runs: Vec<(String, String, i64)> = conn.prepare("SELECT repo_path, kind, started_at FROM runs WHERE repo_path IS NOT NULL AND started_at > ?1")?.query_map([now - 8 * 86_400], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<std::result::Result<_, _>>()?;
    let focus: Vec<(String, i64)> = conn.prepare("SELECT project, MAX(started_at) FROM focus_sessions WHERE project IS NOT NULL GROUP BY project")?.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<std::result::Result<_, _>>()?;
    let new_subjects: Vec<(i64, String, Option<String>)> = conn
        .prepare("SELECT s.id, s.name, s.repo_path FROM subjects s WHERE s.added_at > ?1 AND NOT EXISTS (SELECT 1 FROM project_briefs b WHERE b.subject_id = s.id)")?
        .query_map([now - 3 * 86_400], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<std::result::Result<_, _>>()?;
    let found = detect(&Facts { now, board: &board, repos: &repos, events: &plan.events, busy: &busy, rhythm: &rhythm, runs: &runs, focus: &focus, new_subjects: &new_subjects });
    let new = store(&conn, &found, now)?;
    Ok(new)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn board(title: &str, path: &str, day: &str) -> crate::projects::BoardItem {
        crate::projects::BoardItem { title: title.into(), module: None, repo_path: Some(path.into()), my_id: None, day: Some(day.into()), at: None, source: None, state: "upcoming".into(), status: "in_progress".into(), cloned: true, repo_expected: true, starts: None, my_day: None }
    }

    #[test]
    fn close_hand_in_without_plan_or_tests_is_said_once_and_withdrawn_when_fixed() {
        let c = crate::db::open_in_memory().unwrap();
        let now = crate::planner::parse_local("2026-03-02T09:00").unwrap();
        let b = [board("my_rpg", "/p/rpg", "2026-03-04")];
        let r = Rhythm::default();
        let facts = |events: &[crate::planner::PlanEvent], runs: &[(String, String, i64)]| detect(&Facts { now, board: &b, repos: &[], events, busy: &[], rhythm: &r, runs, focus: &[], new_subjects: &[] });
        let found = facts(&[], &[]);
        assert!(found.iter().any(|i| i.kind == "deadline") && found.iter().any(|i| i.kind == "tests"), "{found:?}");
        assert_eq!(store(&c, &found, now).unwrap().len(), 2);
        assert!(store(&c, &found, now + 300).unwrap().is_empty(), "said once");
        let id = list(&c, now).unwrap().iter().find(|i| i.kind == "tests").unwrap().id;
        set_status(&c, id, "dismissed", None, now).unwrap();
        // A session gets planned and tests run: everything is withdrawn.
        let ev = crate::planner::PlanEvent { id: 1, kind: "session".into(), title: "s".into(), start: now + 3600, end: now + 7200, project: Some("/p/rpg".into()), ..Default::default() };
        let fixed = facts(&[ev], &[("/p/rpg".into(), "tests".into(), now)]);
        assert!(fixed.is_empty(), "{fixed:?}");
        store(&c, &fixed, now + 600).unwrap();
        assert!(list(&c, now + 600).unwrap().is_empty());
    }

    #[test]
    fn overloaded_days_and_missed_sessions() {
        let now = crate::planner::parse_local("2026-03-02T21:00").unwrap();
        let day = schedule::day_of(now) + 86_400;
        let busy = vec![Busy { start: day + 9 * 3600, end: day + 15 * 3600, title: "x".into(), kind: "work", event_id: None }];
        let missed = crate::planner::PlanEvent { id: 2, kind: "session".into(), title: "s".into(), start: now - 7200, end: now - 3600, ..Default::default() };
        let r = Rhythm::default();
        let found = detect(&Facts { now, board: &[], repos: &[], events: &[missed], busy: &busy, rhythm: &r, runs: &[], focus: &[], new_subjects: &[(5, "B-CPE-110 sujet.pdf".into(), None)] });
        let kinds: Vec<&str> = found.iter().map(|i| i.kind).collect();
        assert!(kinds.contains(&"overload") && kinds.contains(&"missed") && kinds.contains(&"subject"), "{kinds:?}");
    }
}
