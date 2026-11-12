//! Turns the cached MY Epitech answers into what TekBoard shows: projects with their
//! hand-in dates, the local repository each one corresponds to, latest automated test
//! results, credits and validations. Field names are the ones observed in real answers;
//! anything absent is simply left out.

use crate::scanner::RepoInfo;
use chrono::{DateTime, Local, Utc};
use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;

fn cached(conn: &Connection, route: &str) -> Option<Value> {
    conn.query_row("SELECT body FROM my_cache WHERE route = ?1 AND status BETWEEN 200 AND 299", [route], |r| r.get::<_, String>(0)).ok().and_then(|b| serde_json::from_str(&b).ok())
}

/// `my_ls`, `[CPool] Day13`, `SettingUp` → `myls`, `cpoolday13`, `settingup`.
pub fn norm(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_alphanumeric()).map(|c| c.to_ascii_lowercase()).collect()
}

/// Local calendar day of a UTC timestamp: a hand-in at 18:42 UTC is still that day in France.
pub fn local_day(iso: &str) -> Option<String> {
    DateTime::parse_from_rfc3339(iso).ok().map(|d| d.with_timezone(&Local).format("%Y-%m-%d").to_string())
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub name: String,
    pub start: Option<String>,
    pub end: Option<String>,
    pub mandatory: bool,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TestRun {
    pub date: Option<String>,
    pub commit: Option<String>,
    pub passed: Option<i64>,
    pub total: Option<i64>,
    pub flags: Vec<String>,
    pub style_fatal: i64,
    pub style_major: i64,
    pub style_minor: i64,
    pub style_info: i64,
    /// Skills with at least one failed test: (name, passed, count).
    pub failing_skills: Vec<(String, i64, i64)>,
    pub repo_link: Option<String>,
    pub runs: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: i64,
    pub name: String,
    pub unit_code: String,
    pub unit_name: Option<String>,
    pub start: Option<String>,
    pub end: Option<String>,
    /// Hand-in day in local time (`YYYY-MM-DD`).
    pub deadline: Option<String>,
    /// Hand-in instant with the local offset.
    pub deadline_at: Option<String>,
    /// Started and not handed in yet, at the time of the call (not at the time of the sync).
    pub ongoing: bool,
    /// Starts later.
    pub upcoming: bool,
    pub group_max: Option<i64>,
    /// Logins of the registered group (the user's own included), as MY Epitech lists them.
    pub group: Vec<String>,
    pub group_name: Option<String>,
    /// A repository is expected for this project.
    pub repo_enabled: Option<bool>,
    pub url: Option<String>,
    /// Local repository this project corresponds to, when the match is certain.
    pub repo_path: Option<String>,
    /// How the repository was matched: `your choice`, `repository link` or `module and name`.
    pub matched_by: Option<&'static str>,
    /// Deadline currently saved in TekBoard for that repository.
    pub repo_deadline: Option<String>,
    /// `manual` when the user typed that date: MY Epitech does not replace it.
    pub repo_deadline_source: Option<String>,
    pub activities: Vec<Activity>,
    pub last_test: Option<TestRun>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Block {
    pub title: String,
    pub grade: Option<String>,
    pub credits: Option<i64>,
    pub validated: i64,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Exam {
    pub label: String,
    pub best: Option<i64>,
    pub required: Option<i64>,
    pub max: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub synced_at: Option<i64>,
    pub account: Option<String>,
    pub projects: Vec<Project>,
    pub credits_acquired: Option<i64>,
    pub credits_total: Option<i64>,
    pub blocks: Vec<Block>,
    pub exams: Vec<Exam>,
}

fn s(v: &Value) -> Option<String> {
    v.as_str().filter(|x| !x.is_empty()).map(str::to_string)
}

fn test_run(v: &Value) -> Option<TestRun> {
    let results = v["results"].as_array()?;
    let last = results.iter().max_by_key(|r| r["properties"]["date"].as_str().unwrap_or("").to_string())?;
    let style = &last["codingStyle"]["value"];
    let mut failing: Vec<(String, i64, i64)> = last["skillBreakdowns"].as_object().map(|m| m.iter().filter_map(|(k, b)| {
        let (count, passed) = (b["count"].as_i64()?, b["passed"].as_i64()?);
        (passed < count).then(|| (k.clone(), passed, count))
    }).collect()).unwrap_or_default();
    failing.sort();
    Some(TestRun {
        date: s(&last["properties"]["date"]),
        commit: s(&last["properties"]["commit"]),
        passed: last["achievementSummary"]["passed"].as_i64(),
        total: last["achievementSummary"]["total"].as_i64(),
        flags: last["failureFlags"].as_array().map(|a| a.iter().filter_map(s).collect()).unwrap_or_default(),
        style_fatal: style["fatal"].as_i64().unwrap_or(0),
        style_major: style["major"].as_i64().unwrap_or(0),
        style_minor: style["minor"].as_i64().unwrap_or(0),
        style_info: style["info"].as_i64().unwrap_or(0),
        failing_skills: failing,
        repo_link: s(&last["repoLink"]),
        runs: results.len(),
    })
}

/// `https://github.com/Org/Name` → (`org`, `name`), lowercased.
fn owner_name(link: &str) -> Option<(String, String)> {
    let rest = link.trim_end_matches('/').trim_end_matches(".git");
    let mut parts = rest.rsplit('/');
    let name = parts.next()?.to_lowercase();
    let owner = parts.next()?.to_lowercase();
    (!name.is_empty() && !owner.is_empty()).then_some((owner, name))
}

/// The one local repository matching a project, or none when zero or several do.
/// A repository the user tied to a project by hand always wins, and is never offered to another project.
pub fn match_repo<'a>(repos: &'a [RepoInfo], id: i64, unit_code: &str, name: &str, repo_link: Option<&str>) -> Option<(&'a RepoInfo, &'static str)> {
    if let Some(r) = repos.iter().find(|r| r.meta.my_project_id == Some(id)) {
        return Some((r, "your choice"));
    }
    let free = |r: &&RepoInfo| r.meta.my_project_id.is_none();
    if let Some((owner, repo_name)) = repo_link.and_then(owner_name) {
        let hits: Vec<&RepoInfo> = repos.iter().filter(free).filter(|r| r.remote.as_ref().is_some_and(|x| x.owner.to_lowercase() == owner && x.name.to_lowercase() == repo_name)).collect();
        if hits.len() == 1 {
            return Some((hits[0], "repository link"));
        }
    }
    let wanted = norm(name);
    let hits: Vec<&RepoInfo> = repos.iter().filter(free).filter(|r| r.epitech.as_ref().is_some_and(|e| e.module == unit_code && norm(&e.project) == wanted)).collect();
    (hits.len() == 1 && !wanted.is_empty()).then(|| (hits[0], "module and name"))
}

/// Organisations (lowercased) that host the repositories MY Epitech tested for this account.
pub fn known_orgs(conn: &Connection) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let Ok(mut st) = conn.prepare("SELECT body FROM my_cache WHERE route LIKE '/units/instances/projects/%/test-results' AND status BETWEEN 200 AND 299") else { return out };
    let Ok(rows) = st.query_map([], |r| r.get::<_, String>(0)) else { return out };
    for body in rows.flatten() {
        let Ok(v) = serde_json::from_str::<Value>(&body) else { continue };
        for r in v["results"].as_array().into_iter().flatten() {
            if let Some((owner, _)) = r["repoLink"].as_str().and_then(owner_name) {
                if !out.contains(&owner) {
                    out.push(owner);
                }
            }
        }
    }
    out
}

fn instant(iso: Option<&str>) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(iso?).ok().map(|d| d.with_timezone(&Utc))
}

const ALL: &str = "/units/instances/projects?page=1&limit=50&registeredOnly=true";
const ONGOING: &str = "/units/instances/projects?page=1&limit=50&status=ongoing&registeredOnly=true";

pub fn overview(conn: &Connection, repos: &[RepoInfo]) -> Overview {
    overview_at(conn, repos, Utc::now())
}

pub fn overview_at(conn: &Connection, repos: &[RepoInfo], now: DateTime<Utc>) -> Overview {
    let mut o = Overview::default();
    o.synced_at = conn.query_row("SELECT MAX(fetched_at) FROM my_cache", [], |r| r.get(0)).ok().flatten();
    o.account = cached(conn, "/auth/verify").and_then(|v| s(&v["login"]));
    let ongoing_ids: Vec<i64> = cached(conn, ONGOING).and_then(|v| v["data"].as_array().map(|a| a.iter().filter_map(|p| p["id"].as_i64()).collect())).unwrap_or_default();
    let list = cached(conn, ALL).or_else(|| cached(conn, ONGOING));
    for p in list.as_ref().and_then(|v| v["data"].as_array()).into_iter().flatten() {
        let Some(id) = p["id"].as_i64() else { continue };
        let name = s(&p["name"]).unwrap_or_default();
        let unit_code = s(&p["unitInstance"]["unitCode"]).unwrap_or_default();
        let end = s(&p["endDate"]);
        let last_test = cached(conn, &format!("/units/instances/projects/{id}/test-results")).as_ref().and_then(test_run);
        let activities = cached(conn, &format!("/units/instances/projects/{id}/my-activities")).and_then(|v| v.as_array().map(|a| a.iter().map(|x| Activity { name: s(&x["name"]).unwrap_or_default(), start: s(&x["startDate"]), end: s(&x["endDate"]), mandatory: x["mandatory"].as_bool().unwrap_or(false), status: s(&x["status"]) }).collect())).unwrap_or_default();
        let hit = match_repo(repos, id, &unit_code, &name, last_test.as_ref().and_then(|t| t.repo_link.as_deref()));
        let start = s(&p["startDate"]);
        // "Ongoing" is a fact about now. The list MY Epitech gave at sync time is only used when a date is missing.
        let (ongoing, upcoming) = match (instant(start.as_deref()), instant(end.as_deref())) {
            (Some(a), Some(b)) => (a <= now && now <= b, now < a),
            (None, Some(b)) => (now <= b && ongoing_ids.contains(&id), false),
            _ => (ongoing_ids.contains(&id), false),
        };
        let due = end.as_deref().and_then(crate::deadlines::from_instant);
        let reg = p["registrations"].as_array().and_then(|a| a.first());
        o.projects.push(Project {
            id,
            deadline: due.as_ref().map(|d| d.day.clone()).or_else(|| end.as_deref().and_then(local_day)),
            deadline_at: due.and_then(|d| d.at),
            ongoing,
            upcoming,
            group: reg.and_then(|r| r["members"].as_array()).map(|m| m.iter().filter_map(|x| s(&x["login"])).collect()).unwrap_or_default(),
            group_name: reg.and_then(|r| s(&r["groupName"])),
            repo_enabled: p["repoEnabled"].as_bool(),
            unit_name: s(&p["unitInstance"]["name"]),
            start,
            end,
            group_max: p["groupSizeMax"].as_i64(),
            url: s(&p["hermesActivityUrl"]).filter(|u| u.starts_with("https://")),
            repo_path: hit.map(|(r, _)| r.path.clone()),
            matched_by: hit.map(|(_, how)| how),
            repo_deadline: hit.and_then(|(r, _)| r.meta.deadline.clone()),
            repo_deadline_source: hit.and_then(|(r, _)| r.meta.deadline_source.clone()),
            activities,
            last_test,
            name,
            unit_code,
        });
    }
    // Ongoing first, nearest hand-in first; then the ones to come; then finished ones, most recent first.
    let rank = |p: &Project| if p.ongoing { 0 } else if p.upcoming { 1 } else { 2 };
    o.projects.sort_by(|a, b| rank(a).cmp(&rank(b)).then_with(|| if rank(a) < 2 { a.end.cmp(&b.end) } else { b.end.cmp(&a.end) }));
    if let Some(c) = cached(conn, "/evaluations/validations/credits/me") {
        o.credits_acquired = c["acquiredCredits"].as_i64();
        o.credits_total = c["totalAcquiredCredits"].as_i64();
    }
    if let Some(v) = cached(conn, "/evaluations/validations/me") {
        o.blocks = v["blocks"].as_array().map(|a| a.iter().map(|b| Block { title: s(&b["title"]).unwrap_or_default(), grade: s(&b["grade"]), credits: b["credits"].as_i64(), validated: b["validatedCount"].as_i64().unwrap_or(0), total: b["totalCount"].as_i64().unwrap_or(0) }).collect()).unwrap_or_default();
    }
    if let Some(v) = cached(conn, "/students/exams") {
        o.exams = v["exams"].as_array().map(|a| a.iter().map(|e| Exam { label: s(&e["label"]).unwrap_or_default(), best: e["best"]["score"].as_i64(), required: e["requiredScore"].as_i64(), max: e["maxMark"].as_i64() }).collect()).unwrap_or_default();
    }
    o
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{self, RepoMeta};
    use crate::epitech::{parse_remote, parse_repo_name};

    fn repo(dir: &str, remote: Option<&str>) -> RepoInfo {
        let name = dir.rsplit('/').next().unwrap().to_string();
        RepoInfo { path: dir.into(), epitech: parse_repo_name(&name), name, group: "Tek".into(), remote_url: remote.map(str::to_string), remote: remote.and_then(parse_remote), meta: RepoMeta::default(), ..Default::default() }
    }

    fn put(conn: &Connection, route: &str, body: &str) {
        conn.execute("INSERT INTO my_cache (route, fetched_at, status, body) VALUES (?1, 500, 200, ?2)", rusqlite::params![route, body]).unwrap();
    }

    #[test]
    fn names_are_compared_without_punctuation() {
        assert_eq!((norm("my_ls"), norm("[CPool] Day13"), norm("SettingUp")), ("myls".into(), "cpoolday13".into(), "settingup".into()));
    }

    #[test]
    fn repositories_match_by_link_then_by_module_and_name_and_never_ambiguously() {
        let repos = vec![
            repo("/r/G-CPE-110-LYN-1-1-settingup-27", Some("git@github.com:EpitechPGE1-2026/G-CPE-110-LYN-1-1-settingup-27.git")),
            repo("/r/G-PSU-100-LYN-1-1-myls-1", None),
            repo("/r/G-CPE-101-LYN-1-1-myprintf-8", None),
            repo("/r/copy/G-CPE-101-LYN-1-1-myprintf-8", None),
        ];
        let (r, how) = match_repo(&repos, 1, "G-XXX-000", "whatever", Some("https://github.com/EpitechPGE1-2026/G-CPE-110-LYN-1-1-settingup-27")).unwrap();
        assert_eq!((r.path.as_str(), how), ("/r/G-CPE-110-LYN-1-1-settingup-27", "repository link"));
        assert_eq!(match_repo(&repos, 2, "G-PSU-100", "my_ls", None).unwrap().1, "module and name");
        assert!(match_repo(&repos, 2, "G-PSU-101", "my_ls", None).is_none(), "same name, other module");
        assert!(match_repo(&repos, 3, "G-CPE-101", "my_printf", None).is_none(), "two copies: no guess");
    }

    #[test]
    fn a_manual_association_settles_ambiguity_and_is_exclusive() {
        let mut repos = vec![repo("/r/G-CPE-101-LYN-1-1-myprintf-8", None), repo("/r/copy/G-CPE-101-LYN-1-1-myprintf-8", None), repo("/r/whatever", None)];
        repos[1].meta.my_project_id = Some(3);
        let (r, how) = match_repo(&repos, 3, "G-CPE-101", "my_printf", None).unwrap();
        assert_eq!((r.path.as_str(), how), ("/r/copy/G-CPE-101-LYN-1-1-myprintf-8", "your choice"));
        // A repository tied to project 9 is not offered to project 3 even when its name fits.
        repos[1].meta.my_project_id = Some(9);
        let (r, how) = match_repo(&repos, 3, "G-CPE-101", "my_printf", None).unwrap();
        assert_eq!((r.path.as_str(), how), ("/r/G-CPE-101-LYN-1-1-myprintf-8", "module and name"));
        repos[2].meta.my_project_id = Some(3);
        assert_eq!(match_repo(&repos, 3, "G-CPE-101", "my_printf", None).unwrap().0.path, "/r/whatever", "any repository can be chosen by hand");
    }

    #[test]
    fn ongoing_is_decided_by_the_clock_not_by_the_last_sync() {
        let conn = db::open_in_memory().unwrap();
        let p = r#"{"id":7,"name":"my_sudo","startDate":"2026-11-14T07:42:00.000Z","endDate":"2026-12-04T18:42:00.000Z","repoEnabled":true,"registrations":[{"groupName":"g","members":[{"login":"a@epitech.eu"},{"login":"b@epitech.eu"}]}],"unitInstance":{"unitCode":"G-PSU-100"}}"#;
        put(&conn, ALL, &format!(r#"{{"data":[{p}]}}"#));
        put(&conn, ONGOING, r#"{"data":[]}"#);
        let at = |iso: &str| DateTime::parse_from_rfc3339(iso).unwrap().with_timezone(&Utc);
        let before = overview_at(&conn, &[], at("2026-11-11T12:00:00Z"));
        assert_eq!((before.projects[0].ongoing, before.projects[0].upcoming), (false, true));
        let during = overview_at(&conn, &[], at("2026-11-20T12:00:00Z"));
        assert_eq!((during.projects[0].ongoing, during.projects[0].upcoming), (true, false), "started since the sync");
        let after = overview_at(&conn, &[], at("2026-12-04T18:42:01Z"));
        assert_eq!((after.projects[0].ongoing, after.projects[0].upcoming), (false, false), "over as soon as the hand-in passes");
        assert_eq!(during.projects[0].group, vec!["a@epitech.eu", "b@epitech.eu"]);
        assert_eq!(during.projects[0].repo_enabled, Some(true));
    }

    #[test]
    fn overview_reads_projects_deadlines_tests_and_credits() {
        let conn = db::open_in_memory().unwrap();
        put(&conn, "/auth/verify", r#"{"login":"me@epitech.eu"}"#);
        let p = |id: i64, name: &str, unit: &str, end: &str| format!(r#"{{"id":{id},"name":"{name}","startDate":"2026-10-24T06:42:00.000Z","endDate":"{end}","groupSizeMax":1,"hermesActivityUrl":"https://hermes.epitest.eu/activity/i/1","unitInstance":{{"unitCode":"{unit}","name":"Unit"}}}}"#);
        put(&conn, ALL, &format!(r#"{{"data":[{},{}]}}"#, p(1, "my_ls", "G-PSU-100", "2026-11-06T18:42:00.000Z"), p(2, "SettingUp", "G-CPE-110", "2026-11-13T18:42:00.000Z")));
        put(&conn, ONGOING, &format!(r#"{{"data":[{}]}}"#, p(2, "SettingUp", "G-CPE-110", "2026-11-13T18:42:00.000Z")));
        put(&conn, "/units/instances/projects/2/my-activities", r#"[{"name":"Kick-off","startDate":"2026-10-26T08:00:00.000Z","endDate":"2026-10-26T08:30:00.000Z","mandatory":false,"status":"present"}]"#);
        put(&conn, "/units/instances/projects/2/test-results", r#"{"results":[{"properties":{"date":"2026-11-09T23:59:55Z","commit":"aaa"},"failureFlags":["make-error"],"achievementSummary":{"passed":0,"total":24},"codingStyle":{"value":{"fatal":0,"major":2,"minor":1,"info":0}},"skillBreakdowns":{"Basics":{"count":3,"passed":0}}},{"properties":{"date":"2026-11-10T12:21:47Z","commit":"bbb"},"failureFlags":[],"achievementSummary":{"passed":20,"total":24},"codingStyle":{"value":{"fatal":0,"major":0,"minor":1,"info":0}},"skillBreakdowns":{"Basics":{"count":3,"passed":3},"Parsing":{"count":4,"passed":2}},"repoLink":"https://github.com/Org/G-CPE-110-LYN-1-1-settingup-27"}]}"#);
        put(&conn, "/evaluations/validations/credits/me", r#"{"acquiredCredits":3,"priorCredits":0,"totalAcquiredCredits":3}"#);
        put(&conn, "/evaluations/validations/me", r#"{"blocks":[{"title":"Applied Mathematics I","grade":"in progress","credits":2,"validatedCount":0,"totalCount":4}]}"#);
        put(&conn, "/students/exams", r#"{"exams":[{"label":"TEPitech","maxMark":990,"requiredScore":600,"best":{"score":735}}]}"#);
        let repos = vec![repo("/r/G-CPE-110-LYN-1-1-settingup-27", Some("git@github.com:Org/G-CPE-110-LYN-1-1-settingup-27.git")), repo("/r/G-PSU-100-LYN-1-1-myls-1", None)];
        let o = overview_at(&conn, &repos, DateTime::parse_from_rfc3339("2026-11-10T12:00:00Z").unwrap().with_timezone(&Utc));
        assert_eq!((o.account.as_deref(), o.synced_at, o.credits_acquired), (Some("me@epitech.eu"), Some(500), Some(3)));
        assert_eq!(o.projects.iter().map(|p| (p.name.as_str(), p.ongoing)).collect::<Vec<_>>(), vec![("SettingUp", true), ("my_ls", false)]);
        let su = &o.projects[0];
        assert_eq!((su.matched_by, su.repo_path.as_deref()), (Some("repository link"), Some("/r/G-CPE-110-LYN-1-1-settingup-27")));
        assert_eq!(su.deadline, crate::deadlines::from_instant("2026-11-13T18:42:00.000Z").map(|d| d.day));
        assert!(su.deadline_at.is_some());
        assert_eq!(known_orgs(&conn), vec!["org".to_string()]);
        let t = su.last_test.as_ref().unwrap();
        assert_eq!((t.commit.as_deref(), t.passed, t.total, t.runs, t.style_minor), (Some("bbb"), Some(20), Some(24), 2, 1));
        assert_eq!(t.failing_skills, vec![("Parsing".to_string(), 2, 4)]);
        assert_eq!(su.activities[0].name, "Kick-off");
        assert_eq!(o.projects[1].matched_by, Some("module and name"));
        assert_eq!((o.blocks[0].total, o.exams[0].best), (4, Some(735)));
    }

    #[test]
    fn an_empty_cache_gives_an_empty_overview() {
        let o = overview(&db::open_in_memory().unwrap(), &[]);
        assert!(o.projects.is_empty() && o.synced_at.is_none());
    }
}
