//! Activity statistics computed from local `git log`. Counts commits and lines;
//! it does not measure time spent or quality, and the UI says so.

use crate::git;
use chrono::{DateTime, Datelike, Duration, NaiveDate, Timelike};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;

#[derive(Debug, Clone)]
pub struct RawCommit {
    pub hash: String,
    /// Author date as written in the commit (author's own timezone).
    pub date: NaiveDate,
    pub hour: u32,
    pub iso: String,
    pub email: String,
    pub name: String,
}

pub fn parse_log(text: &str) -> Vec<RawCommit> {
    text.lines()
        .filter_map(|line| {
            let mut it = line.split('\u{1f}');
            let hash = it.next()?.to_string();
            let iso = it.next()?.to_string();
            let email = it.next()?.to_lowercase();
            let name = it.next()?.to_string();
            let dt = DateTime::parse_from_rfc3339(&iso).ok()?;
            Some(RawCommit { hash, date: dt.date_naive(), hour: dt.hour(), iso, email, name })
        })
        .collect()
}

/// Every commit reachable from a local branch, merges excluded.
pub fn collect(repo: &Path) -> Vec<RawCommit> {
    match git::run_raw(Some(repo), &["log", "--branches", "--no-merges", "--format=%H%x1f%aI%x1f%ae%x1f%an"]) {
        Ok(out) if out.ok => parse_log(&out.stdout),
        _ => vec![],
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Day {
    pub date: String,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Contributor {
    pub name: String,
    pub commits: u32,
    pub me: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoStat {
    pub path: String,
    pub name: String,
    pub mine: u32,
    pub others: u32,
    pub contributors: Vec<Contributor>,
    pub first: Option<String>,
    pub last: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Language {
    pub name: String,
    pub files: u32,
    pub lines: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Analytics {
    /// Author e-mails counted as "you": taken from git config, global and per repository.
    pub my_emails: Vec<String>,
    pub total_commits: u32,
    pub my_commits: u32,
    /// Your commits per day over the last 53 weeks, oldest first, ending today.
    pub days: Vec<Day>,
    pub active_days: u32,
    pub current_streak: u32,
    pub longest_streak: u32,
    pub last_commit: Option<String>,
    /// Your commits by hour of day (0–23), in the timezone each commit was made in.
    pub by_hour: Vec<u32>,
    /// Monday first.
    pub by_weekday: Vec<u32>,
    /// Your commits per month over the last 12 months, oldest first.
    pub monthly: Vec<Day>,
    pub repos: Vec<RepoStat>,
    pub languages: Vec<Language>,
    pub solo_repos: u32,
    pub shared_repos: u32,
}

pub struct RepoInput {
    pub path: String,
    pub name: String,
    pub commits: Vec<RawCommit>,
}

pub const WINDOW_DAYS: i64 = 53 * 7;

pub fn aggregate(repos: Vec<RepoInput>, my_emails: &HashSet<String>, today: NaiveDate, languages: Vec<Language>) -> Analytics {
    let mut seen: HashSet<String> = HashSet::new();
    let mut per_day: BTreeMap<NaiveDate, u32> = BTreeMap::new();
    let mut by_hour = vec![0u32; 24];
    let mut by_weekday = vec![0u32; 7];
    let mut total = 0u32;
    let mut mine_total = 0u32;
    let mut last_commit: Option<String> = None;
    let mut stats = Vec::new();

    for repo in repos {
        let mut mine = 0u32;
        let mut others = 0u32;
        let mut people: HashMap<String, (String, u32, bool)> = HashMap::new();
        let mut first: Option<String> = None;
        let mut last: Option<String> = None;
        for c in &repo.commits {
            let me = my_emails.contains(&c.email);
            let entry = people.entry(c.email.clone()).or_insert_with(|| (c.name.clone(), 0, me));
            entry.1 += 1;
            if me { mine += 1 } else { others += 1 }
            if first.as_ref().is_none_or(|f| c.iso < *f) {
                first = Some(c.iso.clone());
            }
            if last.as_ref().is_none_or(|l| c.iso > *l) {
                last = Some(c.iso.clone());
            }
            // The same commit can live in two folders (a second clone, a "(Copy)"): count it once globally.
            if !seen.insert(c.hash.clone()) {
                continue;
            }
            total += 1;
            if me {
                mine_total += 1;
                *per_day.entry(c.date).or_default() += 1;
                by_hour[c.hour as usize % 24] += 1;
                by_weekday[c.date.weekday().num_days_from_monday() as usize] += 1;
                if last_commit.as_ref().is_none_or(|l| c.iso > *l) {
                    last_commit = Some(c.iso.clone());
                }
            }
        }
        let mut contributors: Vec<Contributor> = people.into_values().map(|(name, commits, me)| Contributor { name, commits, me }).collect();
        contributors.sort_by(|a, b| b.commits.cmp(&a.commits).then(a.name.cmp(&b.name)));
        stats.push(RepoStat { path: repo.path, name: repo.name, mine, others, contributors, first, last });
    }
    stats.retain(|r| r.mine + r.others > 0);
    stats.sort_by(|a, b| b.mine.cmp(&a.mine).then(a.name.cmp(&b.name)));

    let start = today - Duration::days(WINDOW_DAYS - 1);
    let days: Vec<Day> = (0..WINDOW_DAYS)
        .map(|i| {
            let d = start + Duration::days(i);
            Day { date: d.format("%Y-%m-%d").to_string(), count: per_day.get(&d).copied().unwrap_or(0) }
        })
        .collect();
    let active_days = days.iter().filter(|d| d.count > 0).count() as u32;

    // Streaks over the whole history; the current one may end today or yesterday.
    let mut longest = 0u32;
    let mut run = 0u32;
    let mut prev: Option<NaiveDate> = None;
    for d in per_day.keys() {
        run = if prev.is_some_and(|p| *d - p == Duration::days(1)) { run + 1 } else { 1 };
        longest = longest.max(run);
        prev = Some(*d);
    }
    let mut current = 0u32;
    let mut cursor = if per_day.contains_key(&today) { today } else { today - Duration::days(1) };
    while per_day.contains_key(&cursor) {
        current += 1;
        cursor -= Duration::days(1);
    }

    let mut monthly = Vec::new();
    let (mut y, mut m) = (today.year(), today.month());
    for _ in 0..12 {
        let count: u32 = per_day.iter().filter(|(d, _)| d.year() == y && d.month() == m).map(|(_, n)| *n).sum();
        monthly.push(Day { date: format!("{y:04}-{m:02}"), count });
        if m == 1 {
            y -= 1;
            m = 12;
        } else {
            m -= 1;
        }
    }
    monthly.reverse();

    let mine_repos: Vec<&RepoStat> = stats.iter().filter(|r| r.mine > 0).collect();
    let shared = mine_repos.iter().filter(|r| r.others > 0).count() as u32;
    let solo = mine_repos.len() as u32 - shared;
    let mut emails: Vec<String> = my_emails.iter().cloned().collect();
    emails.sort();

    Analytics { my_emails: emails, total_commits: total, my_commits: mine_total, days, active_days, current_streak: current, longest_streak: longest, last_commit, by_hour, by_weekday, monthly, repos: stats, languages, solo_repos: solo, shared_repos: shared }
}

fn language_of(path: &str) -> Option<&'static str> {
    let file = path.rsplit('/').next().unwrap_or(path);
    if file == "Makefile" || file.ends_with(".mk") {
        return Some("Makefile");
    }
    let ext = file.rsplit_once('.')?.1.to_ascii_lowercase();
    Some(match ext.as_str() {
        "c" => "C",
        "h" => "C header",
        "cpp" | "cc" | "cxx" | "hpp" => "C++",
        "py" => "Python",
        "js" | "mjs" | "cjs" | "jsx" => "JavaScript",
        "ts" | "tsx" | "mts" => "TypeScript",
        "rs" => "Rust",
        "sh" | "bash" | "zsh" => "Shell",
        "java" => "Java",
        "cs" => "C#",
        "go" => "Go",
        "html" | "htm" => "HTML",
        "css" | "scss" => "CSS",
        "hs" => "Haskell",
        "asm" | "s" => "Assembly",
        "pl" => "Perl",
        _ => return None,
    })
}

const MAX_FILE: u64 = 1024 * 1024;

/// Lines of tracked source files, by language. Generated and oversized files are skipped.
pub fn count_languages(repo: &Path, into: &mut BTreeMap<&'static str, (u32, u64)>) {
    let Ok(out) = git::run_raw(Some(repo), &["ls-files", "-z"]) else { return };
    if !out.ok {
        return;
    }
    for rel in out.stdout.split('\0').filter(|p| !p.is_empty()) {
        if rel.contains("node_modules/") || rel.ends_with(".min.js") || rel.ends_with("-lock.json") {
            continue;
        }
        let Some(lang) = language_of(rel) else { continue };
        let path = repo.join(rel);
        let Ok(meta) = std::fs::symlink_metadata(&path) else { continue };
        if !meta.is_file() || meta.len() > MAX_FILE {
            continue;
        }
        let Ok(bytes) = std::fs::read(&path) else { continue };
        let lines = bytes.iter().filter(|b| **b == b'\n').count() as u64 + u64::from(bytes.last().is_some_and(|b| *b != b'\n'));
        let entry = into.entry(lang).or_default();
        entry.0 += 1;
        entry.1 += lines;
    }
}

pub fn languages_vec(map: BTreeMap<&'static str, (u32, u64)>) -> Vec<Language> {
    let mut v: Vec<Language> = map.into_iter().map(|(name, (files, lines))| Language { name: name.to_string(), files, lines }).collect();
    v.sort_by(|a, b| b.lines.cmp(&a.lines).then(a.name.cmp(&b.name)));
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(hash: &str, iso: &str, email: &str) -> RawCommit {
        let dt = DateTime::parse_from_rfc3339(iso).unwrap();
        RawCommit { hash: hash.into(), date: dt.date_naive(), hour: dt.hour(), iso: iso.into(), email: email.into(), name: email.split('@').next().unwrap().into() }
    }

    fn me() -> HashSet<String> {
        ["me@x.io".to_string()].into_iter().collect()
    }

    #[test]
    fn parses_git_log_lines() {
        let text = "abc\u{1f}2026-11-09T23:10:00+01:00\u{1f}Me@X.io\u{1f}Me\nbroken line\n";
        let v = parse_log(text);
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].email, "me@x.io");
        assert_eq!(v[0].hour, 23);
        assert_eq!(v[0].date, NaiveDate::from_ymd_opt(2026, 11, 9).unwrap(), "date in the author's timezone");
    }

    #[test]
    fn aggregates_mine_vs_others_and_dedupes_copies() {
        let today = NaiveDate::from_ymd_opt(2026, 11, 10).unwrap();
        let solo = vec![c("1", "2026-11-10T09:00:00+01:00", "me@x.io"), c("2", "2026-11-09T22:00:00+01:00", "me@x.io"), c("3", "2026-11-08T10:00:00+01:00", "me@x.io"), c("4", "2026-11-05T10:00:00+01:00", "me@x.io")];
        let copy = solo.clone();
        let team = vec![c("5", "2026-10-01T10:00:00+02:00", "me@x.io"), c("6", "2026-10-01T11:00:00+02:00", "mate@x.io"), c("7", "2026-10-02T11:00:00+02:00", "mate@x.io")];
        let foreign = vec![c("8", "2020-01-01T00:00:00Z", "stranger@x.io")];
        let a = aggregate(
            vec![
                RepoInput { path: "/solo".into(), name: "solo".into(), commits: solo },
                RepoInput { path: "/solo (Copy)".into(), name: "solo (Copy)".into(), commits: copy },
                RepoInput { path: "/team".into(), name: "team".into(), commits: team },
                RepoInput { path: "/lib".into(), name: "lib".into(), commits: foreign },
                RepoInput { path: "/empty".into(), name: "empty".into(), commits: vec![] },
            ],
            &me(),
            today,
            vec![],
        );
        assert_eq!(a.total_commits, 8, "the copy adds nothing");
        assert_eq!(a.my_commits, 5);
        assert_eq!(a.current_streak, 3);
        assert_eq!(a.longest_streak, 3);
        assert_eq!(a.active_days, 5);
        assert_eq!(a.days.len(), 371);
        assert_eq!(a.days.last().unwrap(), &Day { date: "2026-11-10".into(), count: 1 });
        assert_eq!(a.by_hour[22], 1);
        assert_eq!(a.by_weekday[1], 1, "2026-11-10 is a Tuesday");
        assert_eq!(a.monthly.len(), 12);
        assert_eq!(a.monthly.last().unwrap(), &Day { date: "2026-11".into(), count: 4 });
        assert_eq!(a.monthly[10], Day { date: "2026-10".into(), count: 1 });
        assert_eq!(a.repos.len(), 4, "empty repositories are left out");
        let team = a.repos.iter().find(|r| r.name == "team").unwrap();
        assert_eq!((team.mine, team.others), (1, 2));
        assert_eq!(team.contributors[0], Contributor { name: "mate".into(), commits: 2, me: false });
        assert_eq!((a.solo_repos, a.shared_repos), (2, 1), "the foreign library is neither");
        assert_eq!(a.last_commit.as_deref(), Some("2026-11-10T09:00:00+01:00"));
    }

    #[test]
    fn streak_counts_from_yesterday_when_today_is_empty() {
        let today = NaiveDate::from_ymd_opt(2026, 11, 10).unwrap();
        let commits = vec![c("1", "2026-11-09T10:00:00Z", "me@x.io"), c("2", "2026-11-08T10:00:00Z", "me@x.io")];
        let a = aggregate(vec![RepoInput { path: "/r".into(), name: "r".into(), commits }], &me(), today, vec![]);
        assert_eq!(a.current_streak, 2);
        let old = vec![c("1", "2026-11-01T10:00:00Z", "me@x.io")];
        let a = aggregate(vec![RepoInput { path: "/r".into(), name: "r".into(), commits: old }], &me(), today, vec![]);
        assert_eq!(a.current_streak, 0);
    }

    #[test]
    fn language_detection_and_counting() {
        assert_eq!(language_of("src/main.c"), Some("C"));
        assert_eq!(language_of("include/my.h"), Some("C header"));
        assert_eq!(language_of("lib/my/Makefile"), Some("Makefile"));
        assert_eq!(language_of("README.md"), None);
        assert_eq!(language_of("binary"), None);

        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path();
        git::run(Some(repo), &["init", "-q", "-b", "main"]).unwrap();
        std::fs::write(repo.join("a.c"), "int main(void)\n{\n    return 0;\n}\n").unwrap();
        std::fs::write(repo.join("b.c"), "no newline at end").unwrap();
        std::fs::write(repo.join("untracked.c"), "x\n").unwrap();
        std::fs::write(repo.join("Makefile"), "all:\n").unwrap();
        git::add(repo, &["a.c".into(), "b.c".into(), "Makefile".into()]).unwrap();
        let mut map = BTreeMap::new();
        count_languages(repo, &mut map);
        let v = languages_vec(map);
        assert_eq!(v[0], Language { name: "C".into(), files: 2, lines: 5 });
        assert_eq!(v[1], Language { name: "Makefile".into(), files: 1, lines: 1 });
    }
}
