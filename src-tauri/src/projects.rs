//! Ties each local repository to what is known about it: the status the user chose, its
//! hand-in date and where that date comes from, the MY Epitech project it corresponds to,
//! and whether it belongs to the curriculum. Also builds the list of deadlines shown on
//! the dashboard, which includes MY Epitech projects that are not cloned yet.

use crate::db::{self, RepoMeta};
use crate::deadlines;
use crate::error::Result;
use crate::myview::{Overview, Project};
use crate::scanner::RepoInfo;
use chrono::{DateTime, Utc};
use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashMap;

/// What MY Epitech says about the project behind a repository.
#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MyLink {
    pub id: i64,
    pub name: String,
    pub unit_code: String,
    pub unit_name: Option<String>,
    pub start: Option<String>,
    pub end: Option<String>,
    /// Hand-in day and instant according to MY Epitech, whatever is saved for the repository.
    pub deadline: Option<String>,
    pub deadline_at: Option<String>,
    pub ongoing: bool,
    pub url: Option<String>,
    pub group: Vec<String>,
    pub matched_by: String,
    /// Latest automated test run: passed, total.
    pub tests_passed: Option<i64>,
    pub tests_total: Option<i64>,
    /// Moulinette runs: (total, remaining), when the project has a quota.
    pub quota: Option<(i64, i64)>,
    pub delivery: Option<crate::myview::Delivery>,
    pub too_many_absences: bool,
    pub non_compliant: bool,
}

fn link(p: &Project) -> MyLink {
    MyLink {
        id: p.id,
        name: p.name.clone(),
        unit_code: p.unit_code.clone(),
        unit_name: p.unit_name.clone(),
        start: p.start.clone(),
        end: p.end.clone(),
        deadline: p.deadline.clone(),
        deadline_at: p.deadline_at.clone(),
        ongoing: p.ongoing,
        url: p.url.clone(),
        group: p.group.clone(),
        matched_by: p.matched_by.unwrap_or_default().to_string(),
        tests_passed: p.last_test.as_ref().and_then(|t| t.passed),
        tests_total: p.last_test.as_ref().and_then(|t| t.total),
        quota: p.quota,
        delivery: p.delivery.clone(),
        too_many_absences: p.too_many_absences,
        non_compliant: p.non_compliant,
    }
}

/// Saves the MY Epitech hand-in date of every matched repository, unless the user typed
/// a date of their own for it. Returns how many repositories changed.
pub fn apply_my_deadlines(conn: &Connection, overview: &Overview, only: Option<&[i64]>) -> Result<usize> {
    let meta = db::all_meta(conn)?;
    let mut changed = 0;
    for p in &overview.projects {
        if only.is_some_and(|ids| !ids.contains(&p.id)) {
            continue;
        }
        let (Some(path), Some(day)) = (&p.repo_path, &p.deadline) else { continue };
        let cur = meta.get(path).cloned().unwrap_or_default();
        match cur.deadline_source.as_deref() {
            Some("manual") => continue,
            // A date saved before 0.3 has no recorded origin. If it differs from MY Epitech's,
            // someone typed it: keep it and remember that.
            None if cur.deadline.as_deref().is_some_and(|d| d != day) => {
                db::set_deadline(conn, path, cur.deadline.as_deref(), cur.deadline_at.as_deref(), Some("manual"))?;
                continue;
            }
            _ => {}
        }
        if cur.deadline.as_deref() != Some(day.as_str()) || cur.deadline_at != p.deadline_at || cur.deadline_source.as_deref() != Some("my") {
            db::set_deadline(conn, path, Some(day), p.deadline_at.as_deref(), Some("my"))?;
            changed += 1;
        }
    }
    Ok(changed)
}

/// Folders (inside the projects folders) the user declared as holding school work.
fn inside(path: &str, dirs: &[String]) -> Option<String> {
    dirs.iter().find(|d| !d.is_empty() && std::path::Path::new(path).starts_with(d.as_str())).cloned()
}

/// `epitech` or `personal`, and why. The repository name is only the last clue.
pub fn classify(repo: &RepoInfo, my: Option<&MyLink>, orgs: &[String], epitech_dirs: &[String]) -> (&'static str, String) {
    match repo.meta.kind_override.as_deref() {
        Some("epitech") => return ("epitech", "set by you".into()),
        Some("personal") => return ("personal", "set by you".into()),
        _ => {}
    }
    if let Some(m) = my {
        return ("epitech", format!("MY Epitech project “{}” ({})", m.name, m.matched_by));
    }
    if let Some(remote) = &repo.remote {
        let owner = remote.owner.to_lowercase();
        if orgs.contains(&owner) || owner.starts_with("epitechpge") || owner.starts_with("epitechmsc") || owner.starts_with("epitechpromo") {
            return ("epitech", format!("remote organisation {}", remote.owner));
        }
    }
    if let Some(dir) = inside(&repo.path, epitech_dirs) {
        return ("epitech", format!("inside {dir}"));
    }
    if let Some(e) = &repo.epitech {
        return ("epitech", format!("repository name ({})", e.module));
    }
    ("personal", "no link with MY Epitech, an Epitech organisation, a school folder or a module name".into())
}

const ACTIVE_DAYS: i64 = 21;

/// The status the user chose, else one that follows the facts: handed in according to
/// MY Epitech → done; touched recently → in progress; otherwise to do.
fn status_of(meta: &RepoMeta, my: Option<&MyLink>, last_commit: Option<&str>, now: DateTime<Utc>) -> (String, bool) {
    if let Some(s) = meta.status.as_deref().filter(|s| db::STATUSES.contains(s)) {
        return (s.to_string(), false);
    }
    if meta.archived {
        return ("done".into(), false);
    }
    let closed = my.and_then(|m| m.end.as_deref()).and_then(|e| DateTime::parse_from_rfc3339(e).ok()).is_some_and(|e| e < now);
    if closed {
        return ("done".into(), true);
    }
    let recent = now.timestamp() - ACTIVE_DAYS * 86_400;
    let committed = last_commit.and_then(|d| DateTime::parse_from_rfc3339(d).ok()).is_some_and(|d| d.timestamp() >= recent);
    let opened = meta.last_opened_at.is_some_and(|t| t >= recent);
    (if committed || opened || my.is_some_and(|m| m.ongoing) { "in_progress" } else { "todo" }.into(), true)
}

/// Fills the fields of `RepoInfo` that depend on the database: MY Epitech link, kind, status, deadline state.
pub fn enrich(repos: &mut [RepoInfo], overview: &Overview, orgs: &[String], epitech_dirs: &[String], now: DateTime<Utc>) {
    let mut links: HashMap<&str, MyLink> = HashMap::new();
    for p in &overview.projects {
        if let Some(path) = p.repo_path.as_deref() {
            links.entry(path).or_insert_with(|| link(p));
        }
    }
    let local = now.with_timezone(&chrono::Local);
    for r in repos.iter_mut() {
        let my = links.get(r.path.as_str()).cloned();
        let (kind, reason) = classify(r, my.as_ref(), orgs, epitech_dirs);
        let (status, inferred) = status_of(&r.meta, my.as_ref(), r.last_commit.as_ref().map(|c| c.date.as_str()), now);
        r.kind = kind.to_string();
        r.kind_reason = reason;
        r.progress = status;
        r.progress_inferred = inferred;
        r.deadline_state = deadlines::state_in(r.meta.deadline.as_deref(), r.meta.deadline_at.as_deref(), &local).to_string();
        r.my = my;
    }
}

/// One line of the dashboard's deadlines: a local repository, or a MY Epitech project not cloned yet.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BoardItem {
    pub title: String,
    pub module: Option<String>,
    pub repo_path: Option<String>,
    pub my_id: Option<i64>,
    pub day: Option<String>,
    pub at: Option<String>,
    /// `manual`, `my`, or none for a date saved before 0.3.
    pub source: Option<String>,
    /// `upcoming`, `today`, `overdue`, `unknown`.
    pub state: String,
    pub status: String,
    /// False for a MY Epitech project with no local repository.
    pub cloned: bool,
    /// MY Epitech expects a repository for this project (false for activities without one).
    pub repo_expected: bool,
    /// Not started yet according to MY Epitech.
    pub starts: Option<String>,
    /// What MY Epitech says when the saved date differs from it.
    pub my_day: Option<String>,
}

fn title_of(r: &RepoInfo) -> String {
    r.my.as_ref().map(|m| m.name.clone()).or_else(|| r.epitech.as_ref().map(|e| e.project.clone())).unwrap_or_else(|| r.name.clone())
}

/// Unfinished work with its hand-in state: overdue, today, upcoming (nearest first), then
/// school projects whose date is not known. Finished projects are left out.
pub fn board(repos: &[RepoInfo], overview: &Overview, now: DateTime<Utc>) -> Vec<BoardItem> {
    let local = now.with_timezone(&chrono::Local);
    let mut items: Vec<BoardItem> = Vec::new();
    for r in repos {
        if r.progress == "done" {
            continue;
        }
        let has_date = r.meta.deadline.is_some();
        if !has_date && r.kind != "epitech" {
            continue;
        }
        let my_day = r.my.as_ref().and_then(|m| m.deadline.clone()).filter(|d| has_date && Some(d) != r.meta.deadline.as_ref());
        items.push(BoardItem {
            title: title_of(r),
            module: r.my.as_ref().map(|m| m.unit_code.clone()).or_else(|| r.epitech.as_ref().map(|e| e.module.clone())),
            repo_path: Some(r.path.clone()),
            my_id: r.my.as_ref().map(|m| m.id),
            day: r.meta.deadline.clone(),
            at: r.meta.deadline_at.clone(),
            source: r.meta.deadline_source.clone(),
            state: r.deadline_state.clone(),
            status: r.progress.clone(),
            cloned: true,
            repo_expected: true,
            starts: None,
            my_day,
        });
    }
    for p in &overview.projects {
        if p.repo_path.is_some() || !(p.ongoing || p.upcoming) {
            continue;
        }
        items.push(BoardItem {
            title: p.name.clone(),
            module: Some(p.unit_code.clone()).filter(|u| !u.is_empty()),
            repo_path: None,
            my_id: Some(p.id),
            day: p.deadline.clone(),
            at: p.deadline_at.clone(),
            source: Some("my".into()),
            state: deadlines::state_in(p.deadline.as_deref(), p.deadline_at.as_deref(), &local).to_string(),
            status: if p.ongoing { "in_progress" } else { "todo" }.into(),
            cloned: false,
            repo_expected: p.repo_enabled != Some(false),
            starts: p.start.clone().filter(|_| p.upcoming),
            my_day: None,
        });
    }
    let rank = |s: &str| match s {
        "overdue" => 0,
        "today" => 1,
        "upcoming" => 2,
        _ => 3,
    };
    items.sort_by(|a, b| {
        let (ka, kb) = (deadlines::sort_key(a.day.as_deref(), a.at.as_deref()), deadlines::sort_key(b.day.as_deref(), b.at.as_deref()));
        rank(&a.state).cmp(&rank(&b.state)).then_with(|| if a.state == "overdue" { kb.cmp(&ka) } else { ka.cmp(&kb) }).then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase()))
    });
    items
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::epitech::{parse_remote, parse_repo_name};
    use crate::git::Commit;
    use crate::myview;

    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-11-11T12:00:00Z").unwrap().with_timezone(&Utc)
    }

    fn repo(dir: &str, remote: Option<&str>) -> RepoInfo {
        let name = dir.rsplit('/').next().unwrap().to_string();
        RepoInfo { path: dir.into(), epitech: parse_repo_name(&name), name, remote_url: remote.map(str::to_string), remote: remote.and_then(parse_remote), ..Default::default() }
    }

    fn put(conn: &Connection, route: &str, body: &str) {
        conn.execute("INSERT INTO my_cache (route, fetched_at, status, body) VALUES (?1, 500, 200, ?2)", rusqlite::params![route, body]).unwrap();
    }

    const ALL: &str = "/units/instances/projects?page=1&limit=50&registeredOnly=true";

    fn project(id: i64, name: &str, unit: &str, start: &str, end: &str) -> String {
        format!(r#"{{"id":{id},"name":"{name}","startDate":"{start}","endDate":"{end}","unitInstance":{{"unitCode":"{unit}","name":"Unit"}}}}"#)
    }

    /// The situation found on the real machine: one project handed in, three running, one to come and not cloned.
    fn school(conn: &Connection) {
        put(conn, ALL, &format!(
            r#"{{"data":[{},{},{},{},{}]}}"#,
            project(1, "my_ls", "G-PSU-100", "2026-10-24T06:42:00.000Z", "2026-11-06T18:42:00.000Z"),
            project(2, "SettingUp", "G-CPE-110", "2026-10-24T06:42:00.000Z", "2026-11-13T18:42:00.000Z"),
            project(3, "MyHunter", "G-MUL-100", "2026-11-02T07:42:00.000Z", "2026-11-20T18:42:00.000Z"),
            project(4, "102architect", "G-MAT-100", "2026-11-07T07:42:00.000Z", "2026-11-20T18:42:00.000Z"),
            project(5, "my_sudo", "G-PSU-100", "2026-11-14T07:42:00.000Z", "2026-12-04T18:42:00.000Z"),
        ));
    }

    fn repos() -> Vec<RepoInfo> {
        vec![
            repo("/r/Tek/G-PSU-100-LYN-1-1-myls-1", None),
            repo("/r/Tek/G-CPE-110-LYN-1-1-settingup-27", None),
            repo("/r/Tek/G-MUL-100-LYN-1-1-myhunter-13", None),
            repo("/r/Tek/G-MAT-100-LYN-1-1-102architect-19", None),
            repo("/r/Perso/tool", Some("git@github.com:me/tool.git")),
        ]
    }

    fn load(conn: &Connection, repos: &mut Vec<RepoInfo>) -> Overview {
        let meta = db::all_meta(conn).unwrap();
        for r in repos.iter_mut() {
            r.meta = meta.get(&r.path).cloned().unwrap_or_default();
        }
        let o = myview::overview_at(conn, repos, now());
        enrich(repos, &o, &[], &[], now());
        o
    }

    #[test]
    fn my_epitech_dates_reach_the_repositories_without_a_click() {
        let conn = db::open_in_memory().unwrap();
        school(&conn);
        let mut rs = repos();
        let o = load(&conn, &mut rs);
        assert_eq!(apply_my_deadlines(&conn, &o, None).unwrap(), 4);
        let meta = db::all_meta(&conn).unwrap();
        let hunter = &meta["/r/Tek/G-MUL-100-LYN-1-1-myhunter-13"];
        assert_eq!(hunter.deadline_source.as_deref(), Some("my"));
        assert_eq!(hunter.deadline, deadlines::from_instant("2026-11-20T18:42:00.000Z").map(|d| d.day));
        assert!(hunter.deadline_at.is_some(), "the hour is kept");
        // A second pass changes nothing.
        let o = load(&conn, &mut rs);
        assert_eq!(apply_my_deadlines(&conn, &o, None).unwrap(), 0);
    }

    #[test]
    fn a_date_typed_by_hand_is_never_replaced() {
        let conn = db::open_in_memory().unwrap();
        school(&conn);
        let hunter = "/r/Tek/G-MUL-100-LYN-1-1-myhunter-13";
        db::set_deadline(&conn, hunter, Some("2026-11-18"), None, Some("manual")).unwrap();
        // Saved by 0.2, no origin recorded, and different from MY Epitech: treated as typed.
        let architect = "/r/Tek/G-MAT-100-LYN-1-1-102architect-19";
        db::set_deadline(&conn, architect, Some("2026-11-19"), None, None).unwrap();
        let mut rs = repos();
        let o = load(&conn, &mut rs);
        assert_eq!(apply_my_deadlines(&conn, &o, None).unwrap(), 2, "only the two repositories without a date of their own");
        let meta = db::all_meta(&conn).unwrap();
        assert_eq!((meta[hunter].deadline.as_deref(), meta[hunter].deadline_source.as_deref()), (Some("2026-11-18"), Some("manual")));
        assert_eq!((meta[architect].deadline.as_deref(), meta[architect].deadline_source.as_deref()), (Some("2026-11-19"), Some("manual")));
        // The dashboard still says what MY Epitech reports for them.
        let o = load(&conn, &mut rs);
        let b = board(&rs, &o, now());
        let line = b.iter().find(|i| i.repo_path.as_deref() == Some(hunter)).unwrap();
        assert_eq!(line.my_day, deadlines::from_instant("2026-11-20T18:42:00.000Z").map(|d| d.day));
    }

    #[test]
    fn the_board_lists_overdue_then_upcoming_then_unknown_and_includes_uncloned_projects() {
        let conn = db::open_in_memory().unwrap();
        school(&conn);
        let mut rs = repos();
        rs.push(repo("/r/Tek/G-AIA-100-LYN-1-1-nodate-3", None));
        let o = load(&conn, &mut rs);
        apply_my_deadlines(&conn, &o, None).unwrap();
        // A hand-typed date that is already past, on a project still being worked on.
        db::set_deadline(&conn, "/r/Perso/tool", Some("2026-11-09"), None, Some("manual")).unwrap();
        db::set_status(&conn, "/r/Perso/tool", "in_progress").unwrap();
        let o = load(&conn, &mut rs);
        let b = board(&rs, &o, now());
        let got: Vec<(&str, &str, bool)> = b.iter().map(|i| (i.title.as_str(), i.state.as_str(), i.cloned)).collect();
        assert_eq!(got, vec![("tool", "overdue", true), ("SettingUp", "upcoming", true), ("102architect", "upcoming", true), ("MyHunter", "upcoming", true), ("my_sudo", "upcoming", false), ("nodate", "unknown", true)]);
        assert!(b.iter().all(|i| i.title != "my_ls"), "handed in: inferred done, not listed as overdue");
        assert!(b[4].starts.is_some(), "not started yet");
        assert_eq!(b[5].day, None, "no date is made up for a project without one");
    }

    #[test]
    fn a_project_marked_done_by_mistake_comes_back_with_its_deadline() {
        let conn = db::open_in_memory().unwrap();
        school(&conn);
        let su = "/r/Tek/G-CPE-110-LYN-1-1-settingup-27";
        db::set_status(&conn, su, "done").unwrap();
        let mut rs = repos();
        let o = load(&conn, &mut rs);
        apply_my_deadlines(&conn, &o, None).unwrap();
        let o = load(&conn, &mut rs);
        assert!(board(&rs, &o, now()).iter().all(|i| i.repo_path.as_deref() != Some(su)));
        db::set_status(&conn, su, "in_progress").unwrap();
        let o = load(&conn, &mut rs);
        let b = board(&rs, &o, now());
        let line = b.iter().find(|i| i.repo_path.as_deref() == Some(su)).unwrap();
        assert_eq!((line.state.as_str(), line.status.as_str(), line.source.as_deref()), ("upcoming", "in_progress", Some("my")));
    }

    #[test]
    fn status_follows_the_users_choice_then_the_facts() {
        let conn = db::open_in_memory().unwrap();
        school(&conn);
        let mut rs = repos();
        rs[4].last_commit = Some(Commit { hash: "a".into(), subject: "s".into(), author: "me".into(), date: "2026-11-10T10:00:00+01:00".into() });
        rs.push(repo("/r/Perso/old", None));
        rs[5].last_commit = Some(Commit { hash: "b".into(), subject: "s".into(), author: "me".into(), date: "2026-06-01T10:00:00+02:00".into() });
        load(&conn, &mut rs);
        let st = |path: &str| rs.iter().find(|r| r.path == path).map(|r| (r.progress.clone(), r.progress_inferred)).unwrap();
        assert_eq!(st("/r/Tek/G-PSU-100-LYN-1-1-myls-1"), ("done".into(), true), "the hand-in is over");
        assert_eq!(st("/r/Tek/G-MUL-100-LYN-1-1-myhunter-13"), ("in_progress".into(), true), "running on MY Epitech");
        assert_eq!(st("/r/Perso/tool"), ("in_progress".into(), true), "committed yesterday");
        assert_eq!(st("/r/Perso/old"), ("todo".into(), true));
        db::set_status(&conn, "/r/Tek/G-PSU-100-LYN-1-1-myls-1", "todo").unwrap();
        load(&conn, &mut rs);
        let st = |path: &str| rs.iter().find(|r| r.path == path).map(|r| (r.progress.clone(), r.progress_inferred)).unwrap();
        assert_eq!(st("/r/Tek/G-PSU-100-LYN-1-1-myls-1"), ("todo".into(), false), "a choice always wins");
    }

    #[test]
    fn classification_uses_my_epitech_organisations_folders_then_names() {
        let orgs = vec!["someorg".to_string()];
        let dirs = vec!["/r/School".to_string()];
        let kind = |r: &RepoInfo, my: Option<&MyLink>| classify(r, my, &orgs, &dirs);
        let plain = repo("/r/Perso/tool", Some("git@github.com:me/tool.git"));
        assert_eq!(kind(&plain, None).0, "personal");
        let my = MyLink { name: "Free project".into(), matched_by: "your choice".into(), ..Default::default() };
        assert_eq!(kind(&plain, Some(&my)), ("epitech", "MY Epitech project “Free project” (your choice)".into()));
        assert_eq!(kind(&repo("/r/x/tool", Some("git@github.com:EpitechPGE1-2026/whatever.git")), None).0, "epitech");
        assert_eq!(kind(&repo("/r/x/tool", Some("https://github.com/SomeOrg/tool")), None).1, "remote organisation SomeOrg");
        assert_eq!(kind(&repo("/r/School/tool", None), None).1, "inside /r/School");
        assert_eq!(kind(&repo("/r/Schoolbag/tool", None), None).0, "personal", "a folder is matched whole, not by prefix");
        assert_eq!(kind(&repo("/r/x/G-CPE-110-LYN-1-1-settingup-27", None), None).1, "repository name (G-CPE-110)");
        // A personal repository that only looks like a school one can be corrected, and the reverse.
        let mut fake = repo("/r/x/G-CPE-110-LYN-1-1-settingup-27", None);
        fake.meta.kind_override = Some("personal".into());
        assert_eq!(kind(&fake, Some(&my)), ("personal", "set by you".into()));
        let mut mine = repo("/r/Perso/tool", None);
        mine.meta.kind_override = Some("epitech".into());
        assert_eq!(kind(&mine, None).0, "epitech");
    }
}
