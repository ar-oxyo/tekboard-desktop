//! The working copy an agent works on: the project as it is right now (committed or not),
//! without `.git`, without what git ignores and without secret-looking files. The real
//! project is never touched by an agent; what it produced comes back only as a diff the user
//! applies (with a backup of every file replaced).

use crate::error::{AppError, Result};
use serde::Serialize;
use std::path::{Path, PathBuf};

const MAX_FILES: usize = 6000;
const MAX_BYTES: u64 = 300 * 1024 * 1024;

/// Files of the working tree: tracked and untracked, minus ignored ones.
fn files_of(repo: &Path) -> Result<Vec<String>> {
    let out = crate::git::run(Some(repo), &["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).map_err(|e| AppError::new("git_failed", format!("Liste des fichiers impossible : {e}")))?;
    Ok(out.split('\0').filter(|p| !p.is_empty()).map(str::to_string).collect())
}

fn safe(rel: &str) -> bool {
    let p = Path::new(rel);
    !p.is_absolute() && p.components().all(|c| matches!(c, std::path::Component::Normal(_))) && !rel.starts_with(".git/")
}

/// Copies `repo` into `dest` (created). Returns the number of files copied.
pub fn copy(repo: &Path, dest: &Path) -> Result<usize> {
    std::fs::create_dir_all(dest)?;
    let mut total = 0u64;
    let mut n = 0;
    for rel in files_of(repo)? {
        if !safe(&rel) {
            continue;
        }
        let name = Path::new(&rel).file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default();
        if crate::packager::sensitive_name(&name) {
            continue;
        }
        let src = repo.join(&rel);
        let Ok(meta) = std::fs::symlink_metadata(&src) else { continue };
        // Links are not followed: they could point anywhere on the computer.
        if !meta.is_file() {
            continue;
        }
        total += meta.len();
        n += 1;
        if n > MAX_FILES || total > MAX_BYTES {
            return Err(AppError::new("too_big", "Ce projet est trop gros pour une copie de travail (plus de 6000 fichiers ou 300 Mo)."));
        }
        let to = dest.join(&rel);
        if let Some(parent) = to.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::copy(&src, &to)?;
    }
    std::fs::create_dir_all(dest.join(".mouli"))?;
    Ok(n)
}

#[derive(Debug, Clone, Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub path: String,
    /// `added` or `modified`.
    pub status: String,
    pub before: Option<String>,
    pub after: String,
}

fn walk(base: &Path, dir: &Path, out: &mut Vec<PathBuf>) {
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                walk(base, &p, out);
            } else if e.file_type().map(|t| t.is_file()).unwrap_or(false) {
                out.push(p.strip_prefix(base).map(Path::to_path_buf).unwrap_or(p));
            }
        }
    }
}

/// Text files the agent created or changed among `scopes` (`tests` = the folder, `Makefile` =
/// one file), compared with the real project. Binaries and build products are left out.
pub fn changes(repo: &Path, work: &Path, scopes: &[&str]) -> Vec<Change> {
    let mut rels = Vec::new();
    for s in scopes {
        let p = work.join(s);
        if p.is_dir() {
            walk(work, &p, &mut rels);
        } else if p.is_file() {
            rels.push(PathBuf::from(s));
        }
    }
    let mut out = Vec::new();
    for rel in rels {
        let r = rel.to_string_lossy().into_owned();
        let Ok(after) = std::fs::read(work.join(&rel)) else { continue };
        if after.len() > 256 * 1024 || after.contains(&0) || r.ends_with(".o") || r.ends_with(".gcda") || r.ends_with(".gcno") {
            continue;
        }
        let after = String::from_utf8_lossy(&after).into_owned();
        let before = std::fs::read_to_string(repo.join(&rel)).ok();
        if before.as_deref() == Some(after.as_str()) {
            continue;
        }
        out.push(Change { status: if before.is_some() { "modified" } else { "added" }.into(), path: r, before, after });
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

/// Writes chosen changes into the project. Every replaced file is copied to `backups` first.
pub fn apply(repo: &Path, changes: &[Change], backups: &Path) -> Result<usize> {
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let mut n = 0;
    for c in changes {
        if !safe(&c.path) {
            return Err(AppError::new("invalid_path", format!("Chemin refusé : {}", c.path)));
        }
        let to = repo.join(&c.path);
        // A file changed since the agent read it is not overwritten.
        let now = std::fs::read_to_string(&to).ok();
        if now != c.before {
            return Err(AppError::new("changed_meanwhile", format!("{} a changé depuis : relance la génération.", c.path)));
        }
        if let Some(old) = &now {
            let b = backups.join(&stamp).join(&c.path);
            if let Some(p) = b.parent() {
                std::fs::create_dir_all(p)?;
            }
            std::fs::write(&b, old)?;
        }
        if let Some(p) = to.parent() {
            std::fs::create_dir_all(p)?;
        }
        std::fs::write(&to, &c.after)?;
        n += 1;
    }
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn repo() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        let g = |a: &[&str]| assert!(Command::new("git").args(a).current_dir(d.path()).output().unwrap().status.success());
        g(&["init", "-q"]);
        std::fs::write(d.path().join("main.c"), "int main(void){return 0;}\n").unwrap();
        std::fs::write(d.path().join("Makefile"), "NAME = a\n").unwrap();
        std::fs::write(d.path().join(".gitignore"), "*.o\n").unwrap();
        std::fs::write(d.path().join("x.o"), "obj").unwrap();
        std::fs::write(d.path().join(".env"), "TOKEN=1").unwrap();
        std::fs::write(d.path().join("wip.c"), "/* not committed */").unwrap();
        g(&["add", "main.c", "Makefile", ".gitignore"]);
        g(&["-c", "user.email=a@b", "-c", "user.name=a", "commit", "-qm", "x"]);
        d
    }

    #[test]
    fn the_copy_is_the_work_in_progress_without_secrets_or_build_products() {
        let r = repo();
        let w = tempfile::tempdir().unwrap();
        copy(r.path(), w.path()).unwrap();
        assert!(w.path().join("main.c").exists() && w.path().join("wip.c").exists());
        assert!(!w.path().join("x.o").exists() && !w.path().join(".env").exists() && !w.path().join(".git").exists());
    }

    #[test]
    fn changes_come_back_as_a_diff_applied_with_backups() {
        let r = repo();
        let w = tempfile::tempdir().unwrap();
        copy(r.path(), w.path()).unwrap();
        std::fs::create_dir_all(w.path().join("tests")).unwrap();
        std::fs::write(w.path().join("tests/test_a.c"), "#include <criterion/criterion.h>\n").unwrap();
        std::fs::write(w.path().join("Makefile"), "NAME = a\ntests_run:\n").unwrap();
        std::fs::write(w.path().join("tests/test_a.o"), "bin").unwrap();
        let c = changes(r.path(), w.path(), &["tests", "Makefile"]);
        assert_eq!(c.iter().map(|x| (x.path.as_str(), x.status.as_str())).collect::<Vec<_>>(), [("Makefile", "modified"), ("tests/test_a.c", "added")]);
        let b = tempfile::tempdir().unwrap();
        assert_eq!(apply(r.path(), &c, b.path()).unwrap(), 2);
        assert!(std::fs::read_to_string(r.path().join("Makefile")).unwrap().contains("tests_run"));
        // The old Makefile is kept.
        let mut saved = Vec::new();
        walk(b.path(), b.path(), &mut saved);
        assert_eq!(saved.len(), 1);
        // Applying again is refused: the file changed meanwhile.
        assert_eq!(apply(r.path(), &c, b.path()).unwrap_err().code(), "changed_meanwhile");
    }
}
