//! Project Launcher: which remote repository should be started next, and the
//! clone step. Scoring is a pure function so its reasoning can be tested and shown.

use crate::epitech::{self, EpitechName};
use crate::error::{AppError, Result};
use crate::git;
use crate::github::RemoteRepo;
use crate::scanner::RepoInfo;
use chrono::{DateTime, Utc};
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Confidence {
    High,
    Medium,
    Low,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub repo: RemoteRepo,
    pub epitech: Option<EpitechName>,
    /// 0–100. A ranking aid, not a certainty.
    pub score: u32,
    pub confidence: Confidence,
    /// Human-readable facts behind the score.
    pub reasons: Vec<String>,
}

/// What the local clones tell us about this student's school repositories.
#[derive(Debug, Default)]
pub struct LocalContext {
    pub cloned: HashSet<String>,
    /// Owners (organizations) that already host Epitech-named local repositories.
    pub school_owners: HashSet<String>,
    /// Cities seen in local Epitech repository names.
    pub cities: HashSet<String>,
}

impl LocalContext {
    pub fn from_repos(repos: &[RepoInfo]) -> Self {
        let mut ctx = LocalContext::default();
        for repo in repos {
            if let Some(remote) = &repo.remote {
                ctx.cloned.insert(remote.key());
                if let Some(ep) = &repo.epitech {
                    ctx.school_owners.insert(remote.owner.to_lowercase());
                    ctx.cities.insert(ep.city.clone());
                }
            }
        }
        ctx
    }
}

pub fn rank(remote: Vec<RemoteRepo>, ctx: &LocalContext, now: DateTime<Utc>) -> Vec<Candidate> {
    let mut out: Vec<Candidate> = remote
        .into_iter()
        .filter(|r| !ctx.cloned.contains(&format!("{}/{}", r.owner, r.name).to_lowercase()))
        .map(|r| score(r, ctx, now))
        .collect();
    out.sort_by(|a, b| b.score.cmp(&a.score).then(b.repo.created_at.cmp(&a.repo.created_at)));
    out
}

fn score(repo: RemoteRepo, ctx: &LocalContext, now: DateTime<Utc>) -> Candidate {
    let mut score: i32 = 0;
    let mut reasons = Vec::new();
    let epitech = epitech::parse_repo_name(&repo.name);

    if let Some(ep) = &epitech {
        score += 35;
        reasons.push(format!("Name follows the Epitech pattern (module {})", ep.module));
        if ctx.cities.contains(&ep.city) {
            score += 5;
        }
    } else {
        reasons.push("Name does not follow the Epitech pattern".to_string());
    }

    if ctx.school_owners.contains(&repo.owner.to_lowercase()) {
        score += 25;
        reasons.push(format!("{} already hosts your school repositories", repo.owner));
    }

    match DateTime::parse_from_rfc3339(&repo.created_at) {
        Ok(created) => {
            let days = (now - created.with_timezone(&Utc)).num_days().max(0);
            let (pts, label) = match days {
                0 => (25, "Created today".to_string()),
                1..=3 => (25, format!("Created {} ago", plural(days, "day"))),
                4..=14 => (15, format!("Created {} ago", plural(days, "day"))),
                15..=30 => (5, format!("Created {} ago", plural(days, "day"))),
                _ => (-15, format!("Created {} ago — probably not a new assignment", plural(days, "day"))),
            };
            score += pts;
            reasons.push(label);
        }
        Err(_) => reasons.push("Creation date unknown".to_string()),
    }

    reasons.push("Not cloned on this machine yet".to_string());
    score += 10;

    if repo.archived {
        score -= 40;
        reasons.push("Archived on GitHub".to_string());
    }
    if repo.fork {
        score -= 10;
        reasons.push("Fork".to_string());
    }

    let score = score.clamp(0, 100) as u32;
    let confidence = match score {
        70..=100 => Confidence::High,
        40..=69 => Confidence::Medium,
        _ => Confidence::Low,
    };
    Candidate { repo, epitech, score, confidence, reasons }
}

fn plural(n: i64, unit: &str) -> String {
    if n == 1 { format!("1 {unit}") } else { format!("{n} {unit}s") }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneOutcome {
    pub path: String,
    /// The same repository was already there: nothing was downloaded or changed.
    pub already_present: bool,
}

/// Clones `url` into `parent/<repo name>`. Never touches an existing folder.
pub fn clone_into(url: &str, parent: &Path) -> Result<CloneOutcome> {
    git::validate_clone_url(url)?;
    let name = epitech::repo_dir_name(url).ok_or_else(|| AppError::new("invalid_url", "Cannot derive a folder name from this URL"))?;
    if !parent.is_dir() {
        return Err(AppError::new("invalid_target", format!("{} is not an existing directory", parent.display())));
    }
    let dest: PathBuf = parent.join(&name);
    if dest.exists() {
        let same = git::is_repo(&dest)
            && match (git::origin_url(&dest).as_deref().and_then(epitech::parse_remote), epitech::parse_remote(url)) {
                (Some(a), Some(b)) => a.key() == b.key(),
                _ => git::origin_url(&dest).as_deref() == Some(url.trim()),
            };
        if same {
            return Ok(CloneOutcome { path: dest.to_string_lossy().into_owned(), already_present: true });
        }
        return Err(AppError::new("target_exists", format!("{} already exists and is not a clone of this repository. Nothing was changed.", dest.display())));
    }
    git::clone(url, &dest)?;
    Ok(CloneOutcome { path: dest.to_string_lossy().into_owned(), already_present: false })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn remote(owner: &str, name: &str, created: &str) -> RemoteRepo {
        RemoteRepo {
            name: name.into(),
            full_name: format!("{owner}/{name}"),
            owner: owner.into(),
            ssh_url: format!("git@github.com:{owner}/{name}.git"),
            created_at: created.into(),
            pushed_at: None,
            private: true,
            archived: false,
            fork: false,
        }
    }

    fn ctx() -> LocalContext {
        let mut c = LocalContext::default();
        c.school_owners.insert("epitechorg".into());
        c.cities.insert("LYN".into());
        c.cloned.insert("epitechorg/g-cpe-100-lyn-1-1-done-1".into());
        c
    }

    fn now() -> DateTime<Utc> {
        "2026-11-10T12:00:00Z".parse().unwrap()
    }

    #[test]
    fn fresh_school_repo_ranks_first_with_high_confidence() {
        let list = vec![
            remote("me", "old-side-project", "2024-01-01T00:00:00Z"),
            remote("EpitechOrg", "G-PSU-100-LYN-1-1-mytop-4", "2026-11-09T08:00:00Z"),
            remote("me", "brand-new-toy", "2026-11-10T08:00:00Z"),
        ];
        let ranked = rank(list, &ctx(), now());
        assert_eq!(ranked[0].repo.name, "G-PSU-100-LYN-1-1-mytop-4");
        assert_eq!(ranked[0].confidence, Confidence::High);
        assert_eq!(ranked[0].score, 100);
        // Recency alone is not enough to be trusted.
        let toy = ranked.iter().find(|c| c.repo.name == "brand-new-toy").unwrap();
        assert_eq!(toy.confidence, Confidence::Low);
        assert_eq!(ranked.last().unwrap().repo.name, "old-side-project");
    }

    #[test]
    fn already_cloned_repos_are_not_suggested() {
        let list = vec![remote("EpitechOrg", "G-CPE-100-LYN-1-1-done-1", "2026-11-09T08:00:00Z")];
        assert!(rank(list, &ctx(), now()).is_empty());
    }

    #[test]
    fn old_school_repo_is_medium_and_says_why() {
        let c = &rank(vec![remote("EpitechOrg", "G-CPE-100-LYN-1-1-old-1", "2026-09-01T00:00:00Z")], &ctx(), now())[0];
        assert_eq!(c.score, 60);
        assert_eq!(c.confidence, Confidence::Medium);
        assert!(c.reasons.iter().any(|r| r.contains("probably not a new assignment")));
    }

    #[test]
    fn archived_repo_drops() {
        let mut r = remote("EpitechOrg", "G-CPE-100-LYN-1-1-x-1", "2026-11-09T08:00:00Z");
        r.archived = true;
        let c = &rank(vec![r], &ctx(), now())[0];
        assert_eq!(c.score, 60);
        assert_eq!(c.confidence, Confidence::Medium);
        assert!(c.reasons.iter().any(|r| r == "Archived on GitHub"));
    }

    fn make_origin(dir: &Path) -> String {
        fs::create_dir_all(dir).unwrap();
        git::run(Some(dir), &["init", "-q", "-b", "main"]).unwrap();
        git::run(Some(dir), &["config", "user.name", "T"]).unwrap();
        git::run(Some(dir), &["config", "user.email", "t@example.com"]).unwrap();
        fs::write(dir.join("README.md"), "hi\n").unwrap();
        git::add(dir, &["README.md".into()]).unwrap();
        git::commit(dir, "init").unwrap();
        format!("file://{}", dir.display())
    }

    #[test]
    fn clone_then_reclone_is_a_noop() {
        let tmp = tempfile::tempdir().unwrap();
        let url = make_origin(&tmp.path().join("remote/G-CPE-110-LYN-1-1-demo-1"));
        let parent = tmp.path().join("work");
        fs::create_dir_all(&parent).unwrap();
        let first = clone_into(&url, &parent).unwrap();
        assert!(!first.already_present);
        assert!(Path::new(&first.path).join("README.md").exists());
        let again = clone_into(&url, &parent).unwrap();
        assert!(again.already_present);
        assert_eq!(again.path, first.path);
    }

    #[test]
    fn existing_unrelated_folder_is_left_alone() {
        let tmp = tempfile::tempdir().unwrap();
        let url = make_origin(&tmp.path().join("remote/proj"));
        let parent = tmp.path().join("work");
        fs::create_dir_all(parent.join("proj")).unwrap();
        fs::write(parent.join("proj/mine.txt"), "keep").unwrap();
        let err = clone_into(&url, &parent).unwrap_err();
        assert_eq!(err.code(), "target_exists");
        assert_eq!(fs::read_to_string(parent.join("proj/mine.txt")).unwrap(), "keep");
    }

    #[test]
    fn failed_clone_leaves_no_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let parent = tmp.path().join("work");
        fs::create_dir_all(&parent).unwrap();
        let url = format!("file://{}/missing/nothing", tmp.path().display());
        assert!(clone_into(&url, &parent).is_err());
        assert!(!parent.join("nothing").exists());
        assert_eq!(clone_into(&url, &tmp.path().join("nope")).unwrap_err().code(), "invalid_target");
    }
}
