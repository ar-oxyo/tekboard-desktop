//! Discovers local repositories under the configured roots and reads their state.
//! Read-only: only `git status`, `git log` and `git config --get` are run.

use crate::db::RepoMeta;
use crate::epitech::{self, EpitechName, RemoteRef};
use crate::git::{self, Commit, RepoStatus};
use crate::settings::find_repos;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    pub path: String,
    pub name: String,
    /// Path relative to its root, parent part only (e.g. `Tek`).
    pub group: String,
    pub remote_url: Option<String>,
    pub remote: Option<RemoteRef>,
    pub epitech: Option<EpitechName>,
    pub status: Option<RepoStatus>,
    pub last_commit: Option<Commit>,
    /// Set when git could not read the repository.
    pub error: Option<String>,
    pub meta: RepoMeta,
}

const MAX_DEPTH: usize = 5;

pub fn discover(roots: &[String]) -> Vec<(PathBuf, PathBuf)> {
    let mut found = Vec::new();
    for root in roots {
        let root = PathBuf::from(root);
        let mut repos = Vec::new();
        find_repos(&root, 0, MAX_DEPTH, &mut repos);
        for repo in repos {
            if !found.iter().any(|(_, r)| r == &repo) {
                found.push((root.clone(), repo));
            }
        }
    }
    found
}

pub fn inspect(root: &Path, repo: &Path, meta: RepoMeta) -> RepoInfo {
    let name = repo.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let group = repo.parent().and_then(|p| p.strip_prefix(root).ok()).map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    let remote_url = git::origin_url(repo);
    let remote = remote_url.as_deref().and_then(epitech::parse_remote);
    // The remote name is authoritative: a folder may have been renamed ("… (Copy)").
    let epitech = remote.as_ref().and_then(|r| epitech::parse_repo_name(&r.name)).or_else(|| epitech::parse_repo_name(&name));
    let (status, error) = match git::status(repo) {
        Ok(s) => (Some(s), None),
        Err(e) => (None, Some(e.to_string())),
    };
    RepoInfo { path: repo.to_string_lossy().into_owned(), name, group, remote_url, remote, epitech, status, last_commit: git::last_commit(repo), error, meta }
}

pub fn scan(roots: &[String], meta: &HashMap<String, RepoMeta>) -> Vec<RepoInfo> {
    let found = discover(roots);
    let workers = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8);
    let chunk = found.len().div_ceil(workers).max(1);
    let mut infos: Vec<RepoInfo> = std::thread::scope(|scope| {
        let handles: Vec<_> = found
            .chunks(chunk)
            .map(|part| {
                scope.spawn(move || {
                    part.iter()
                        .map(|(root, repo)| inspect(root, repo, meta.get(repo.to_string_lossy().as_ref()).cloned().unwrap_or_default()))
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        handles.into_iter().flat_map(|h| h.join().unwrap_or_default()).collect()
    });
    // Most recently touched first: opened in TekBoard, else last commit.
    infos.sort_by(|a, b| sort_key(b).cmp(&sort_key(a)).then(a.name.cmp(&b.name)));
    infos
}

fn sort_key(r: &RepoInfo) -> String {
    r.last_commit.as_ref().map(|c| c.date.clone()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn init(repo: &Path) {
        fs::create_dir_all(repo).unwrap();
        git::run(Some(repo), &["init", "-q", "-b", "main"]).unwrap();
        git::run(Some(repo), &["config", "user.name", "T"]).unwrap();
        git::run(Some(repo), &["config", "user.email", "t@example.com"]).unwrap();
    }

    #[test]
    fn scans_nested_repos_and_reads_state() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("root");
        let a = root.join("Tek/G-CPE-110-LYN-1-1-settingup-27 (Copy)");
        let b = root.join("Perso/tool");
        init(&a);
        init(&b);
        git::run(Some(&a), &["remote", "add", "origin", "git@github.com:Org/G-CPE-110-LYN-1-1-settingup-27.git"]).unwrap();
        fs::write(b.join("x"), "x").unwrap();
        fs::create_dir_all(root.join("Perso/tool/inner/.git")).unwrap();

        let roots = vec![root.to_string_lossy().into_owned()];
        let infos = scan(&roots, &HashMap::new());
        assert_eq!(infos.len(), 2, "a repo nested inside a repo is not listed separately");
        let ia = infos.iter().find(|r| r.name.contains("settingup")).unwrap();
        assert_eq!(ia.group, "Tek");
        assert_eq!(ia.epitech.as_ref().unwrap().project, "settingup");
        assert_eq!(ia.remote.as_ref().unwrap().owner, "Org");
        assert!(ia.status.as_ref().unwrap().unborn);
        let ib = infos.iter().find(|r| r.name == "tool").unwrap();
        assert_eq!(ib.status.as_ref().unwrap().untracked, 1);
        assert!(ib.epitech.is_none() && ib.remote_url.is_none());
    }

    #[test]
    fn overlapping_roots_do_not_duplicate() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("root");
        init(&root.join("sub/a"));
        let roots = vec![root.to_string_lossy().into_owned(), root.join("sub").to_string_lossy().into_owned()];
        assert_eq!(discover(&roots).len(), 1);
    }

    #[test]
    fn missing_root_is_ignored() {
        assert!(scan(&["/nonexistent/tekboard-test".to_string()], &HashMap::new()).is_empty());
    }
}
