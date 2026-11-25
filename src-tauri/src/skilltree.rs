//! The Skill Tree: academic progression as a tree, from MY Epitech's own data only.
//!
//! Read from the cache of the last synchronisation (`my_cache`), so it works offline:
//! - branches: the competency blocks (`validations/me` → `competencyBlocks`, with their credit
//!   thresholds), plus the units that belong to none (`unassignedBlockIds`);
//! - units: `blocks` (this semester) and `nextSemesterBlocks` (next one), with credits, grade
//!   and learning outcomes;
//! - skills: the learning outcomes of each unit;
//! - projects: `graph/me` project nodes, linked to skills by the graph's own `project_skill` links.
//!
//! Every node and link comes from those answers. The one thing TekBoard deduces is the
//! domain of a unit (programming, maths, system…), from the unit code of its projects: it is
//! marked `domain_estimated` and shown as an estimate. Nothing else is invented: a value the
//! site does not give stays empty.

use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Credits {
    /// Credits acquired over the whole cursus (`totalAcquiredCredits`).
    pub acquired: Option<i64>,
    /// Acquired before this semester.
    pub prior: Option<i64>,
    pub this_semester: Option<i64>,
    /// The goal set by the school (`creditsThreshold`).
    pub threshold: Option<i64>,
    pub secure: Option<i64>,
    pub reachable: Option<i64>,
    pub lost: i64,
    pub at_risk: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Semester {
    pub num: i64,
    pub school_year: Option<i64>,
    pub current: bool,
    pub future: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub threshold: Option<f64>,
    pub secure: Option<f64>,
    pub reachable: Option<f64>,
    pub available: Option<f64>,
    pub alert: Option<String>,
    pub units: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub id: String,
    /// `unit`, `skill` or `project`.
    pub kind: &'static str,
    pub label: String,
    /// `acquired`, `in_progress`, `available`, `failed` or `locked` (not open yet).
    pub status: &'static str,
    /// Where the status comes from: `graph` (MY Epitech's graph) or `validations`.
    pub status_from: &'static str,
    pub branch: Option<String>,
    /// The unit a skill belongs to.
    pub parent: Option<String>,
    pub semester: Option<i64>,
    pub school_year: Option<i64>,
    pub upcoming: bool,
    pub credits: Option<f64>,
    pub grade: Option<String>,
    /// Learning outcomes validated / total (units).
    pub validated: Option<i64>,
    pub total: Option<i64>,
    pub level_percent: Option<f64>,
    pub mandatory: Option<bool>,
    pub unit_code: Option<String>,
    pub domain: Option<String>,
    /// Always true when `domain` is set: TekBoard's estimate, not MY Epitech's.
    pub domain_estimated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    pub source: String,
    pub target: String,
    /// `skill_unit` (a learning outcome of a unit) or `project_skill` (graph link).
    pub kind: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEvent {
    /// Unix seconds.
    pub at: i64,
    pub label: String,
    /// `mark` or `project`.
    pub kind: &'static str,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tree {
    pub synced_at: Option<i64>,
    pub credits: Credits,
    pub semester: Option<i64>,
    pub semesters: Vec<Semester>,
    pub branches: Vec<Branch>,
    pub nodes: Vec<Node>,
    pub links: Vec<Link>,
    pub history: Vec<HistoryEvent>,
    /// What could not be read, in words.
    pub notes: Vec<String>,
}

fn cached(conn: &Connection, route: &str) -> Option<Value> {
    let (status, body): (i64, String) = conn.query_row("SELECT status, body FROM my_cache WHERE route = ?1", [route], |r| Ok((r.get(0)?, r.get(1)?))).ok()?;
    (200..300).contains(&status).then(|| serde_json::from_str(&body).ok()).flatten()
}

fn id_of(v: &Value) -> Option<String> {
    v.as_i64().map(|i| i.to_string()).or_else(|| v.as_str().map(str::to_string))
}

fn text(v: &Value, fr: &str, en: &str) -> String {
    v[fr].as_str().filter(|s| !s.is_empty()).or(v[en].as_str()).unwrap_or_default().to_string()
}

/// TekBoard's estimate of the domain of a unit code (`G-CPE-110` → programming).
pub fn domain_of(code: &str) -> String {
    let part = code.split('-').nth(1).unwrap_or(code).to_uppercase();
    match part.as_str() {
        "CPE" => "Programmation",
        "PSU" => "Système",
        "NWP" => "Réseau",
        "MAT" => "Mathématiques",
        "MUL" => "Graphique",
        "AIA" => "Intelligence artificielle",
        "SEC" => "Sécurité",
        "WEB" => "Web",
        "OOP" => "Programmation objet",
        "FUN" => "Programmation fonctionnelle",
        "DOP" => "DevOps",
        "INN" => "Innovation",
        "PRO" => "Professionnel",
        "EIP" => "EIP",
        _ => return format!("Autre ({part})"),
    }
    .to_string()
}

fn graph_status(s: &str) -> &'static str {
    match s {
        "completed" => "acquired",
        "in_progress" => "in_progress",
        "failed" => "failed",
        "unavailable" => "locked",
        _ => "available",
    }
}

fn parse_date(s: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(s).map(|d| d.timestamp()).ok().or_else(|| chrono::NaiveDate::parse_from_str(&s[..s.len().min(10)], "%Y-%m-%d").ok().and_then(|d| d.and_hms_opt(12, 0, 0)).map(|d| d.and_utc().timestamp()))
}

pub fn build(conn: &Connection) -> Tree {
    let mut t = Tree { synced_at: conn.query_row("SELECT MAX(fetched_at) FROM my_cache WHERE route = '/evaluations/validations/me'", [], |r| r.get(0)).ok().flatten(), ..Default::default() };
    let Some(v) = cached(conn, "/evaluations/validations/me") else {
        t.notes.push("Aucune donnée de validation : synchronise MY Epitech (École → MY Epitech).".into());
        return t;
    };
    t.semester = v["semester"].as_i64().or(v["currentSemester"].as_i64());
    let next = v["nextSemester"].as_i64();
    for s in v["attendedSemesters"].as_array().into_iter().flatten() {
        if let Some(num) = s["semesterNum"].as_i64() {
            t.semesters.push(Semester { num, school_year: s["schoolYear"].as_i64(), current: Some(num) == t.semester, future: s["isFuture"].as_bool().unwrap_or(false) });
        }
    }
    let year_of = |num: Option<i64>| t.semesters.iter().find(|s| Some(s.num) == num).and_then(|s| s.school_year);
    let (year_now, year_next) = (year_of(t.semester), year_of(next));
    t.credits.acquired = v["totalAcquiredCredits"].as_i64();
    t.credits.prior = v["priorCredits"].as_i64();
    t.credits.this_semester = v["acquiredCredits"].as_i64();

    // Units and their learning outcomes.
    let mut index: HashMap<String, usize> = HashMap::new();
    for (list, semester, year, upcoming) in [("blocks", t.semester, year_now, false), ("nextSemesterBlocks", next, year_next, true)] {
        for b in v[list].as_array().into_iter().flatten() {
            let Some(bid) = id_of(&b["id"]) else { continue };
            let uid = format!("u:{bid}");
            if index.contains_key(&uid) {
                continue;
            }
            let validated = b["validatedCount"].as_i64();
            let total = b["totalCount"].as_i64();
            let status = if b["allLearningOutcomesValidated"].as_bool() == Some(true) && total.unwrap_or(0) > 0 {
                "acquired"
            } else if validated.unwrap_or(0) > 0 {
                "in_progress"
            } else if upcoming {
                "locked"
            } else {
                "available"
            };
            index.insert(uid.clone(), t.nodes.len());
            t.nodes.push(Node { id: uid.clone(), kind: "unit", label: text(b, "titleFr", "title"), status, status_from: "validations", branch: None, parent: None, semester, school_year: year, upcoming, credits: b["credits"].as_f64(), grade: b["grade"].as_str().map(str::to_string), validated, total, level_percent: b["averageScore"].as_f64(), mandatory: None, unit_code: None, domain: None, domain_estimated: false });
            for o in b["learningOutcomes"].as_array().into_iter().flatten() {
                let Some(oid) = id_of(&o["id"]) else { continue };
                let sid = format!("s:{oid}");
                let status = if o["isValidated"].as_bool() == Some(true) {
                    "acquired"
                } else if o["acquiredPoints"].as_f64().unwrap_or(0.0) > 0.0 || o["levelPercent"].as_f64().unwrap_or(0.0) > 0.0 {
                    "in_progress"
                } else if upcoming {
                    "locked"
                } else {
                    "available"
                };
                index.insert(sid.clone(), t.nodes.len());
                t.nodes.push(Node { id: sid.clone(), kind: "skill", label: text(o, "titleFr", "title"), status, status_from: "validations", branch: None, parent: Some(uid.clone()), semester, school_year: year, upcoming, credits: None, grade: None, validated: None, total: None, level_percent: o["levelPercent"].as_f64(), mandatory: o["isMandatory"].as_bool(), unit_code: None, domain: None, domain_estimated: false });
                t.links.push(Link { source: sid, target: uid.clone(), kind: "skill_unit" });
            }
        }
    }

    // Branches: the competency blocks, then what belongs to none.
    let mut branch_of: HashMap<String, String> = HashMap::new();
    for cb in v["competencyBlocks"].as_array().into_iter().flatten() {
        let Some(cid) = id_of(&cb["id"]) else { continue };
        let id = format!("c:{cid}");
        let mut units: Vec<String> = cb["blockIds"].as_array().into_iter().flatten().filter_map(id_of).map(|b| format!("u:{b}")).collect();
        for n in v["nextSemesterCompetencyBlocks"].as_array().into_iter().flatten().filter(|n| id_of(&n["id"]).as_deref() == Some(&cid)) {
            units.extend(n["blockIds"].as_array().into_iter().flatten().filter_map(id_of).map(|b| format!("u:{b}")));
        }
        units.retain(|u| index.contains_key(u));
        units.dedup();
        for u in &units {
            branch_of.insert(u.clone(), id.clone());
        }
        t.branches.push(Branch { id, name: text(cb, "nameFr", "name"), color: cb["color"].as_str().map(str::to_string), threshold: cb["threshold"].as_f64(), secure: cb["secureCredits"].as_f64(), reachable: cb["reachableCredits"].as_f64(), available: cb["availableCredits"].as_f64(), alert: cb["alertLevel"].as_str().map(str::to_string), units });
    }
    let loose: Vec<String> = t.nodes.iter().filter(|n| n.kind == "unit" && !branch_of.contains_key(&n.id)).map(|n| n.id.clone()).collect();
    if !loose.is_empty() {
        for u in &loose {
            branch_of.insert(u.clone(), "c:none".into());
        }
        t.branches.push(Branch { id: "c:none".into(), name: "Hors bloc de compétences".into(), color: None, threshold: None, secure: None, reachable: None, available: None, alert: None, units: loose });
    }

    // The graph: official statuses, projects and their links to skills.
    let mut codes: HashMap<String, BTreeMap<String, usize>> = HashMap::new();
    match cached(conn, "/evaluations/validations/graph/me") {
        None => t.notes.push("Le graphe de validation n'est pas en cache : les projets ne sont pas reliés aux compétences.".into()),
        Some(g) => {
            let mut gid: HashMap<String, String> = HashMap::new();
            for n in g["nodes"].as_array().into_iter().flatten() {
                let (Some(id), Some(entity)) = (n["id"].as_str(), id_of(&n["entityId"])) else { continue };
                let ours = match n["kind"].as_str() {
                    Some("block") => format!("u:{entity}"),
                    Some("skill") => format!("s:{entity}"),
                    Some("project") => format!("p:{id}"),
                    _ => continue,
                };
                let status = graph_status(n["status"].as_str().unwrap_or_default());
                match index.get(&ours) {
                    Some(&i) => {
                        t.nodes[i].status = status;
                        t.nodes[i].status_from = "graph";
                    }
                    None if n["kind"] == "project" => {
                        let m = &n["meta"];
                        let code = m["unitCode"].as_str().map(str::to_string);
                        index.insert(ours.clone(), t.nodes.len());
                        t.nodes.push(Node { id: ours.clone(), kind: "project", label: text(n, "labelFr", "label"), status, status_from: "graph", branch: None, parent: None, semester: None, school_year: m["schoolYear"].as_i64(), upcoming: false, credits: None, grade: None, validated: m["completedAchievementsCount"].as_i64(), total: m["achievementCount"].as_i64(), level_percent: None, mandatory: None, domain: code.as_deref().map(domain_of), domain_estimated: code.is_some(), unit_code: code });
                    }
                    None => continue,
                }
                gid.insert(id.to_string(), ours);
            }
            for l in g["links"].as_array().into_iter().flatten() {
                if l["kind"] != "project_skill" {
                    continue;
                }
                let (Some(s), Some(d)) = (l["source"].as_str().and_then(|s| gid.get(s)), l["target"].as_str().and_then(|s| gid.get(s))) else { continue };
                if let (Some(code), Some(unit)) = (t.nodes[index[s]].unit_code.clone(), t.nodes[index[d]].parent.clone()) {
                    *codes.entry(unit).or_default().entry(code).or_default() += 1;
                }
                t.links.push(Link { source: s.clone(), target: d.clone(), kind: "project_skill" });
            }
        }
    }

    // A unit's code is the one most of its projects carry: the domain derived from it is an estimate.
    for n in &mut t.nodes {
        n.branch = n.parent.as_ref().and_then(|p| branch_of.get(p)).or_else(|| branch_of.get(&n.id)).cloned();
        if n.kind == "unit" {
            if let Some(code) = codes.get(&n.id).and_then(|c| c.iter().max_by_key(|(_, k)| **k)).map(|(c, _)| c.clone()) {
                n.domain = Some(domain_of(&code));
                n.domain_estimated = true;
                n.unit_code = Some(code);
            }
        }
    }
    let unit_domain: HashMap<String, Option<String>> = t.nodes.iter().filter(|n| n.kind == "unit").map(|n| (n.id.clone(), n.domain.clone())).collect();
    for n in t.nodes.iter_mut().filter(|n| n.kind == "skill") {
        if let Some(d) = n.parent.as_ref().and_then(|p| unit_domain.get(p)).cloned().flatten() {
            n.domain = Some(d);
            n.domain_estimated = true;
        }
    }
    // A project sits in the branch of the skills it trains.
    let skill_branch: HashMap<String, Option<String>> = t.nodes.iter().filter(|n| n.kind == "skill").map(|n| (n.id.clone(), n.branch.clone())).collect();
    let project_branch: HashMap<String, String> = t.links.iter().filter(|l| l.kind == "project_skill").filter_map(|l| skill_branch.get(&l.target).cloned().flatten().map(|b| (l.source.clone(), b))).collect();
    for n in t.nodes.iter_mut().filter(|n| n.kind == "project") {
        n.branch = project_branch.get(&n.id).cloned();
    }

    if let Some(a) = cached(conn, "/evaluations/validations/alerts/me") {
        t.credits.threshold = a["creditsThreshold"].as_i64();
        t.credits.secure = a["secureCredits"].as_i64();
        t.credits.reachable = a["reachableCredits"].as_i64();
        t.credits.lost = a["creditsLost"].as_array().into_iter().flatten().filter_map(|c| c["credits"].as_i64()).sum();
        t.credits.at_risk = a["creditsAtRisk"].as_array().into_iter().flatten().filter_map(|c| c["credits"].as_i64()).sum();
        if t.credits.acquired.is_none() {
            t.credits.acquired = a["totalAcquiredCredits"].as_i64();
        }
    }

    // History: dated facts only (marks, end of validated projects).
    if let Some(m) = cached(conn, "/students/evaluations/marks") {
        for x in m.as_array().into_iter().flatten() {
            if let Some(at) = x["date"].as_str().and_then(parse_date) {
                t.history.push(HistoryEvent { at, label: x["activityTitle"].as_str().or(x["eventTitle"].as_str()).unwrap_or("Note").to_string(), kind: "mark" });
            }
        }
    }
    if let Some(p) = cached(conn, "/units/instances/projects?page=1&limit=50&registeredOnly=true") {
        let completed: Vec<&Node> = t.nodes.iter().filter(|n| n.kind == "project" && n.status == "acquired").collect();
        for x in p["data"].as_array().into_iter().flatten() {
            let name = x["name"].as_str().unwrap_or_default();
            if let (Some(end), true) = (x["endDate"].as_str().and_then(parse_date), completed.iter().any(|n| n.label == name)) {
                t.history.push(HistoryEvent { at: end, label: name.to_string(), kind: "project" });
            }
        }
    }
    t.history.sort_by_key(|e| e.at);
    t
}

#[cfg(test)]
mod tests {
    use super::*;

    fn put(c: &Connection, route: &str, body: &str) {
        c.execute("INSERT INTO my_cache (route, fetched_at, status, body) VALUES (?1, 100, 200, ?2)", [route, body]).unwrap();
    }

    #[test]
    fn the_tree_follows_the_official_links() {
        let c = crate::db::open_in_memory().unwrap();
        put(&c, "/evaluations/validations/me", r##"{"semester":1,"nextSemester":2,"totalAcquiredCredits":12,"priorCredits":0,"acquiredCredits":12,
            "attendedSemesters":[{"semesterNum":1,"schoolYear":2026,"isFuture":false},{"semesterNum":2,"schoolYear":2026,"isFuture":true}],
            "blocks":[{"id":10,"title":"Unix","titleFr":"Unix FR","credits":4,"grade":"in progress","validatedCount":1,"totalCount":2,"allLearningOutcomesValidated":false,
                "learningOutcomes":[{"id":101,"title":"Shell","isValidated":true,"isMandatory":true},{"id":102,"title":"Pipes","isValidated":false,"acquiredPoints":0}]},
              {"id":11,"title":"Maths","credits":2,"validatedCount":0,"totalCount":1,"learningOutcomes":[{"id":111,"title":"Algebra"}]}],
            "nextSemesterBlocks":[{"id":20,"title":"Network","credits":3,"validatedCount":0,"totalCount":0,"learningOutcomes":[]}],
            "competencyBlocks":[{"id":1,"name":"Tech","nameFr":"Technique","color":"#38f","threshold":10,"secureCredits":4,"reachableCredits":9,"availableCredits":9,"blockIds":[10]}],
            "nextSemesterCompetencyBlocks":[{"id":1,"blockIds":[20]}],"unassignedBlockIds":[11]}"##);
        put(&c, "/evaluations/validations/graph/me", r#"{"nodes":[
            {"id":"b10","kind":"block","entityId":10,"label":"Unix","status":"in_progress"},
            {"id":"k102","kind":"skill","entityId":102,"label":"Pipes","status":"in_progress"},
            {"id":"p1","kind":"project","entityId":5,"label":"minishell","status":"completed","meta":{"unitCode":"G-PSU-100","schoolYear":2026}},
            {"id":"p2","kind":"project","entityId":6,"label":"locked one","status":"unavailable","meta":{"unitCode":"G-PSU-100"}}],
            "links":[{"source":"p1","target":"k102","kind":"project_skill"},{"source":"k102","target":"b10","kind":"skill_block"}]}"#);
        put(&c, "/evaluations/validations/alerts/me", r#"{"creditsThreshold":60,"secureCredits":8,"reachableCredits":30,"creditsLost":[{"credits":2}],"creditsAtRisk":[]}"#);
        put(&c, "/students/evaluations/marks", r#"[{"date":"2026-10-02T10:00:00Z","activityTitle":"Review"}]"#);
        let t = build(&c);
        let n = |id: &str| t.nodes.iter().find(|n| n.id == id).unwrap_or_else(|| panic!("{id}"));
        assert_eq!((t.credits.acquired, t.credits.threshold, t.credits.lost), (Some(12), Some(60), 2));
        assert_eq!(n("u:10").label, "Unix FR", "French titles first");
        assert_eq!((n("u:10").status, n("u:10").status_from), ("in_progress", "graph"));
        assert_eq!((n("s:101").status, n("s:101").status_from), ("acquired", "validations"));
        assert_eq!((n("s:102").status, n("s:102").status_from), ("in_progress", "graph"), "the graph's status wins");
        assert_eq!(n("u:20").status, "locked");
        assert!(n("u:20").upcoming && n("u:20").semester == Some(2));
        assert_eq!(n("u:20").branch.as_deref(), Some("c:1"), "next semester units join their competency");
        assert_eq!(n("u:11").branch.as_deref(), Some("c:none"));
        assert_eq!(n("p:p1").branch.as_deref(), Some("c:1"), "a project sits in the branch of its skills");
        assert_eq!(n("p:p2").status, "locked");
        assert!(t.links.iter().any(|l| l.source == "p:p1" && l.target == "s:102" && l.kind == "project_skill"));
        // The only deduction is the domain, and it says so.
        assert_eq!((n("u:10").domain.as_deref(), n("u:10").domain_estimated), (Some("Système"), true));
        assert_eq!(n("u:11").domain, None, "no project, no guess");
        assert_eq!(t.history.len(), 1);
        assert_eq!(t.branches[0].threshold, Some(10.0));
    }

    #[test]
    fn nothing_synced_says_so() {
        let c = crate::db::open_in_memory().unwrap();
        let t = build(&c);
        assert!(t.nodes.is_empty() && t.notes[0].contains("synchronise"));
        assert_eq!(domain_of("G-CPE-110"), "Programmation");
        assert_eq!(domain_of("S-XYZ-001"), "Autre (XYZ)");
    }
}
