//! Discovers local repositories under the configured roots and reads their state.
//! Read-only: only `git status`, `git log` and `git config --get` are run.

use crate::db::RepoMeta;
use crate::epitech::{self, EpitechName, RemoteRef};
use crate::git::{self, Commit, RepoStatus};
use crate::settings::find_repos;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default, Serialize)]
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
    /// When the folder appeared on this computer (unix seconds): its creation time, else its first commit.
    pub added_at: Option<i64>,
    // The fields below are filled by `projects::enrich`, from the user's choices and the MY Epitech cache.
    /// Where the project stands: `todo`, `in_progress` or `done` (`status` above is git's).
    pub progress: String,
    /// The progress was not chosen by the user: it follows the hand-in date and recent activity.
    pub progress_inferred: bool,
    /// `epitech` or `personal`.
    pub kind: String,
    /// Why, in words: shown next to the classification.
    pub kind_reason: String,
    /// `upcoming`, `today`, `overdue` or `unknown`.
    pub deadline_state: String,
    /// MY Epitech project this repository corresponds to.
    pub my: Option<crate::projects::MyLink>,
    /// Another folder holds the same project (same remote, or same name and same last commit):
    /// this one looks like the copy. A clue for the user, never acted upon alone.
    pub duplicate_of: Option<String>,
}

fn added_at(repo: &Path) -> Option<i64> {
    let created = std::fs::metadata(repo).ok().and_then(|m| m.created().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs() as i64);
    created.or_else(|| git::run(Some(repo), &["log", "--max-parents=0", "--format=%ct", "-1"]).ok().and_then(|t| t.trim().parse().ok()))
}

/// Levels below a root: `Epitech/Année 1/Maths/Semestre 1/101pong` is found.
const MAX_DEPTH: usize = 8;

pub fn discover(roots: &[String]) -> Vec<(PathBuf, PathBuf)> {
    let mut found = Vec::new();
    for root in roots {
        let root = PathBuf::from(root);
        let mut repos = Vec::new();
        find_repos(&root, 0, MAX_DEPTH, &mut repos);
        for repo in repos {
            // The same folder reached through two roots, or through a link, is listed once.
            let real = std::fs::canonicalize(&repo).unwrap_or_else(|_| repo.clone());
            if !found.iter().any(|(_, r)| r == &repo || std::fs::canonicalize(r).map(|x| x == real).unwrap_or(false)) {
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
    RepoInfo { path: repo.to_string_lossy().into_owned(), name, group, remote_url, remote, epitech, status, last_commit: git::last_commit(repo), error, meta, added_at: added_at(repo), ..Default::default() }
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
        // An empty `.git` folder is not a repository.
        fs::create_dir_all(root.join("Perso/tool/inner/.git")).unwrap();

        let roots = vec![root.to_string_lossy().into_owned()];
        let infos = scan(&roots, &HashMap::new());
        assert_eq!(infos.len(), 2, "a half-made .git is not listed");
        let ia = infos.iter().find(|r| r.name.contains("settingup")).unwrap();
        assert_eq!(ia.group, "Tek");
        assert_eq!(ia.epitech.as_ref().unwrap().project, "settingup");
        assert_eq!(ia.remote.as_ref().unwrap().owner, "Org");
        assert!(ia.status.as_ref().unwrap().unborn);
        let ib = infos.iter().find(|r| r.name == "tool").unwrap();
        assert_eq!(ib.status.as_ref().unwrap().untracked, 1);
        assert!(ib.epitech.is_none() && ib.remote_url.is_none());
        assert!(ib.added_at.is_some_and(|t| t > 1_600_000_000), "the folder's creation time is read");
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
    fn deep_school_trees_are_found_with_their_groups() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("Epitech");
        for p in ["Maths/101pong", "Maths/102architect", "Graphical/my_hunter", "C_Programming/my_printf", "C_Programming/my_ls", "Year1/S1/Unix/Shell/minishell1"] {
            init(&root.join(p));
        }
        // Dependencies and caches are not searched; a project named like a skipped folder is kept.
        init(&root.join("Graphical/my_hunter/node_modules/dep"));
        init(&root.join("Tools/build"));
        fs::create_dir_all(root.join("Maths/__pycache__")).unwrap();
        let found = discover(&[root.to_string_lossy().into_owned()]);
        let mut names: Vec<String> = found.iter().map(|(_, r)| r.strip_prefix(&root).unwrap().to_string_lossy().into_owned()).collect();
        names.sort();
        assert_eq!(names, ["C_Programming/my_ls", "C_Programming/my_printf", "Graphical/my_hunter", "Maths/101pong", "Maths/102architect", "Tools/build", "Year1/S1/Unix/Shell/minishell1"]);
        let info = inspect(&root, &root.join("Year1/S1/Unix/Shell/minishell1"), RepoMeta::default());
        assert_eq!(info.group, "Year1/S1/Unix/Shell", "the user's own folders become the group");
    }

    #[test]
    fn a_versioned_folder_of_projects_and_submodules() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("root");
        let school = root.join("Epitech");
        init(&school);
        init(&school.join("Maths/101pong"));
        // A submodule: its `.git` is a file pointing into the parent's `.git/modules`.
        fs::create_dir_all(school.join(".git/modules/lib/my")).unwrap();
        fs::write(school.join(".git/modules/lib/my/HEAD"), "ref: refs/heads/main\n").unwrap();
        fs::create_dir_all(school.join("lib/my")).unwrap();
        fs::write(school.join("lib/my/.git"), "gitdir: ../../.git/modules/lib/my\n").unwrap();
        fs::write(school.join(".gitmodules"), "[submodule \"lib/my\"]\n\tpath = lib/my\n\turl = x\n").unwrap();
        assert_eq!(git::repo_kind(&school.join("lib/my")), Some(git::RepoKind::Submodule));
        let found: Vec<PathBuf> = discover(&[root.to_string_lossy().into_owned()]).into_iter().map(|(_, r)| r).collect();
        assert_eq!(found, vec![school.clone(), school.join("Maths/101pong")], "independent repos inside a repo are found, submodules are not");
    }

    #[test]
    fn links_are_followed_once_without_loops() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("root");
        let elsewhere = tmp.path().join("elsewhere");
        init(&elsewhere.join("my_rpg"));
        fs::create_dir_all(&root).unwrap();
        std::os::unix::fs::symlink(&elsewhere, root.join("linked")).unwrap();
        std::os::unix::fs::symlink(&root, root.join("loop")).unwrap();
        let roots = vec![root.to_string_lossy().into_owned(), elsewhere.to_string_lossy().into_owned()];
        let found = discover(&roots);
        assert_eq!(found.len(), 1, "{found:?}");
        assert!(found[0].1.ends_with("my_rpg"));
    }

    #[test]
    fn missing_root_is_ignored() {
        assert!(scan(&["/nonexistent/tekboard-test".to_string()], &HashMap::new()).is_empty());
    }
}
