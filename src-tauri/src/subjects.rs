//! Subjects library: PDF copies kept in TekBoard's data folder, each optionally
//! linked to a project. Importing copies the file; the original is never moved.

use crate::db::{self, Subject};
use crate::error::{AppError, Result};
use rusqlite::Connection;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

const MAX_SIZE: u64 = 200 * 1024 * 1024;

/// Lowercase letters and digits only: `Setting_Up` → `settingup`.
pub fn normalize(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).flat_map(|c| c.to_lowercase()).collect()
}

/// What a subject file name is about, stripped of decoration:
/// `G-PSU-100_my_ls_bootstrap (2).pdf` → `myls`.
pub fn subject_key(file_name: &str) -> String {
    let stem = file_name.rsplit_once('.').map(|(s, _)| s).unwrap_or(file_name);
    // Browser duplicate marker: "name (2)".
    let stem = match stem.rsplit_once(" (") {
        Some((left, right)) if right.ends_with(')') && right[..right.len() - 1].chars().all(|c| c.is_ascii_digit()) => left,
        _ => stem,
    };
    // Module prefix: "G-PSU-100_".
    let b = stem.as_bytes();
    let has_prefix = b.len() > 10 && b[0].is_ascii_uppercase() && b[1] == b'-' && b[2..5].iter().all(u8::is_ascii_uppercase) && b[5] == b'-' && b[6..9].iter().all(u8::is_ascii_digit) && (b[9] == b'_' || b[9] == b'-');
    let stem = if has_prefix { &stem[10..] } else { stem };
    let mut key = normalize(stem);
    for suffix in ["project", "bootstrap", "subject"] {
        if key.len() > suffix.len() {
            if let Some(rest) = key.strip_suffix(suffix) {
                key = rest.to_string();
            }
        }
    }
    key
}

/// Index of the project a subject most plausibly belongs to, or `None` when unsure.
/// `projects` holds project names (`settingup`, `cpoolday09`…).
pub fn best_match(file_name: &str, projects: &[String]) -> Option<usize> {
    let key = subject_key(file_name);
    if key.is_empty() {
        return None;
    }
    let mut best: Option<(usize, usize)> = None; // (rank, index); higher rank wins
    for (i, project) in projects.iter().enumerate() {
        let p = normalize(project);
        let rank = if p.is_empty() {
            0
        } else if key == p {
            1000
        } else if key.ends_with(&p) && p.len() >= 4 {
            500 + p.len()
        } else if key.contains(&p) && p.len() >= 6 {
            p.len()
        } else {
            0
        };
        if rank > 0 && best.map_or(true, |(r, _)| rank > r) {
            best = Some((rank, i));
        }
    }
    best.map(|(_, i)| i)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfFile {
    pub path: String,
    pub name: String,
    pub size: u64,
    /// Unix seconds.
    pub modified: i64,
}

/// PDF files directly inside `dir` (not recursive), newest first.
pub fn list_pdfs(dir: &Path) -> Result<Vec<PdfFile>> {
    let mut out = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let is_pdf = path.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf"));
        let Ok(meta) = entry.metadata() else { continue };
        if !is_pdf || !meta.is_file() {
            continue;
        }
        let modified = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs() as i64).unwrap_or(0);
        out.push(PdfFile { name: entry.file_name().to_string_lossy().into_owned(), path: path.to_string_lossy().into_owned(), size: meta.len(), modified });
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified).then(a.name.cmp(&b.name)));
    Ok(out)
}

pub fn sha256_file(path: &Path) -> Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOutcome {
    pub subject: Subject,
    /// The same document (same content) was already in the library: nothing was copied.
    pub duplicate: bool,
}

fn safe_file_name(name: &str) -> String {
    let cleaned: String = name.chars().map(|c| if c == '/' || c == '\0' || c.is_control() { '_' } else { c }).collect();
    let cleaned = cleaned.trim().trim_start_matches('.').to_string();
    if cleaned.is_empty() { "subject.pdf".to_string() } else { cleaned }
}

/// Copies `src` into the library and records it. Identical content is detected by hash.
pub fn import(conn: &Connection, store: &Path, src: &Path, repo_path: Option<&str>, now: i64) -> Result<ImportOutcome> {
    let meta = fs::symlink_metadata(src).map_err(|_| AppError::new("invalid_source", format!("{} no longer exists", src.display())))?;
    if !meta.is_file() {
        return Err(AppError::new("invalid_source", format!("{} is not a regular file", src.display())));
    }
    if !src.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf")) {
        return Err(AppError::new("invalid_source", "Seuls des PDF peuvent être ajoutés aux sujets"));
    }
    if meta.len() > MAX_SIZE {
        return Err(AppError::new("invalid_source", "Ce fichier dépasse 200 Mo"));
    }
    let hash = sha256_file(src)?;
    if let Some(existing) = db::subject_by_hash(conn, &hash)? {
        // Keep an existing link; fill it in when the duplicate brings one.
        if existing.repo_path.is_none() && repo_path.is_some() {
            db::link_subject(conn, existing.id, repo_path)?;
        }
        let subject = db::get_subject(conn, existing.id)?.unwrap_or(existing);
        return Ok(ImportOutcome { subject, duplicate: true });
    }
    fs::create_dir_all(store)?;
    let name = safe_file_name(&src.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
    let file = format!("{}-{}", &hash[..10], name);
    let dest = store.join(&file);
    fs::copy(src, &dest)?;
    let id = match db::insert_subject(conn, &name, &file, &hash, meta.len() as i64, repo_path, now) {
        Ok(id) => id,
        Err(e) => {
            let _ = fs::remove_file(&dest);
            return Err(e);
        }
    };
    let subject = db::get_subject(conn, id)?.ok_or_else(|| AppError::new("database", "Le sujet a disparu après l'insertion"))?;
    Ok(ImportOutcome { subject, duplicate: false })
}

pub fn file_path(store: &Path, subject: &Subject) -> PathBuf {
    store.join(&subject.file)
}

/// Removes the library copy and its record. The original download is not touched.
pub fn remove(conn: &Connection, store: &Path, id: i64) -> Result<()> {
    let subject = db::get_subject(conn, id)?.ok_or_else(|| AppError::new("not_found", "Sujet inconnu"))?;
    let path = file_path(store, &subject);
    if path.is_file() {
        fs::remove_file(path)?;
    }
    db::delete_subject(conn, id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_strip_decoration() {
        assert_eq!(subject_key("G-PSU-100_my_ls.pdf"), "myls");
        assert_eq!(subject_key("G-PSU-100_my_ls_bootstrap.pdf"), "myls");
        assert_eq!(subject_key("Setting_Up-project.pdf"), "settingup");
        assert_eq!(subject_key("cpool_Day09.pdf"), "cpoolday09");
        assert_eq!(subject_key("how_to_write_unit_tests (2).pdf"), "howtowriteunittests");
        assert_eq!(subject_key("project.pdf"), "project");
        assert_eq!(subject_key("Arrêté de modification.pdf"), "arrêtédemodification");
    }

    #[test]
    fn matches_real_world_names() {
        let projects: Vec<String> = ["settingup", "myls", "cpoolday09", "cpoolday01", "rush1", "star", "countisland", "myprintf", "miniprintf", "101pong"].iter().map(|s| s.to_string()).collect();
        let m = |f: &str| best_match(f, &projects).map(|i| projects[i].as_str());
        assert_eq!(m("Setting_Up-project.pdf"), Some("settingup"));
        assert_eq!(m("G-PSU-100_my_ls.pdf"), Some("myls"));
        assert_eq!(m("G-PSU-100_my_ls_bootstrap.pdf"), Some("myls"));
        assert_eq!(m("cpool_Day09.pdf"), Some("cpoolday09"));
        assert_eq!(m("cpool_Rush1.pdf"), Some("rush1"));
        assert_eq!(m("cpool_Star.pdf"), Some("star"));
        assert_eq!(m("cpool_CountIsland.pdf"), Some("countisland"));
        assert_eq!(m("my_printf-project.pdf"), Some("myprintf"));
        assert_eq!(m("mini_printf-bootstrap.pdf"), Some("miniprintf"));
        assert_eq!(m("G-MAT-100_101pong.pdf"), Some("101pong"));
        assert_eq!(m("101pong-bootstrap.pdf"), Some("101pong"));
        assert_eq!(m("epitech_c_coding_style.pdf"), None);
        assert_eq!(m("Arrêté de modification.pdf"), None);
        assert_eq!(m("cpool_Day02.pdf"), None, "day02 is not day01 or day09");
    }

    #[test]
    fn import_copies_once_and_detects_duplicates() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = db::open_in_memory().unwrap();
        let store = tmp.path().join("subjects");
        let a = tmp.path().join("my_ls.pdf");
        let b = tmp.path().join("my_ls (2).pdf");
        fs::write(&a, b"%PDF-1.4 same").unwrap();
        fs::write(&b, b"%PDF-1.4 same").unwrap();

        let first = import(&conn, &store, &a, None, 1).unwrap();
        assert!(!first.duplicate);
        assert!(file_path(&store, &first.subject).is_file());
        assert!(a.exists(), "original stays in place");

        let second = import(&conn, &store, &b, Some("/repo"), 2).unwrap();
        assert!(second.duplicate);
        assert_eq!(second.subject.id, first.subject.id);
        assert_eq!(second.subject.repo_path.as_deref(), Some("/repo"), "the duplicate fills in a missing link");
        assert_eq!(fs::read_dir(&store).unwrap().count(), 1);

        remove(&conn, &store, first.subject.id).unwrap();
        assert_eq!(fs::read_dir(&store).unwrap().count(), 0);
        assert!(db::list_subjects(&conn).unwrap().is_empty());
        assert!(a.exists());
    }

    #[test]
    fn import_rejects_what_is_not_a_pdf_file() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = db::open_in_memory().unwrap();
        let store = tmp.path().join("subjects");
        fs::write(tmp.path().join("notes.txt"), "x").unwrap();
        fs::create_dir(tmp.path().join("dir.pdf")).unwrap();
        for bad in ["notes.txt", "dir.pdf", "missing.pdf"] {
            assert_eq!(import(&conn, &store, &tmp.path().join(bad), None, 1).unwrap_err().code(), "invalid_source", "{bad}");
        }
        assert!(!store.exists());
    }

    #[test]
    fn lists_only_pdfs_newest_first() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("a.pdf"), "a").unwrap();
        fs::write(tmp.path().join("B.PDF"), "b").unwrap();
        fs::write(tmp.path().join("c.txt"), "c").unwrap();
        fs::create_dir(tmp.path().join("d.pdf")).unwrap();
        let names: Vec<String> = list_pdfs(tmp.path()).unwrap().into_iter().map(|p| p.name).collect();
        assert_eq!(names.len(), 2);
        assert!(names.contains(&"a.pdf".to_string()) && names.contains(&"B.PDF".to_string()));
    }
}
