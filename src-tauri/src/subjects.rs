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
    let stem = if module_prefix(stem).is_some() { &stem[10..] } else { stem };
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

/// How well a subject key fits a project name: 1000 = same name, 500+ = the subject name
/// ends with the project's, a few points = contains it. 0 = no relation.
pub fn rank(key: &str, project: &str) -> usize {
    let p = normalize(project);
    if p.is_empty() || key.is_empty() {
        0
    } else if key == p {
        1000
    } else if key.ends_with(&p) && p.len() >= 4 {
        500 + p.len()
    } else if key.contains(&p) && p.len() >= 6 {
        p.len()
    } else {
        0
    }
}

/// Index of the project a subject most plausibly belongs to, or `None` when unsure.
/// `projects` holds project names (`settingup`, `cpoolday09`…).
pub fn best_match(file_name: &str, projects: &[String]) -> Option<usize> {
    let key = subject_key(file_name);
    let mut best: Option<(usize, usize)> = None; // (rank, index); higher rank wins
    for (i, project) in projects.iter().enumerate() {
        let r = rank(&key, project);
        if r > 0 && best.map_or(true, |(b, _)| r > b) {
            best = Some((r, i));
        }
    }
    best.map(|(_, i)| i)
}

/// Module code a subject file name starts with: `G-PSU-100_my_ls.pdf` → `G-PSU-100`.
pub fn module_prefix(file_name: &str) -> Option<&str> {
    let b = file_name.as_bytes();
    let ok = b.len() > 10 && b[0].is_ascii_uppercase() && b[1] == b'-' && b[2..5].iter().all(u8::is_ascii_uppercase) && b[5] == b'-' && b[6..9].iter().all(u8::is_ascii_digit) && (b[9] == b'_' || b[9] == b'-');
    ok.then(|| &file_name[..9])
}

/// A link Tekboard is not sure enough about to make alone: shown for the user to accept or refuse.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LinkSuggestion {
    pub subject_id: i64,
    pub repo_path: String,
    pub reason: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Association {
    /// Links made or corrected by this pass.
    pub linked: usize,
    pub suggestions: Vec<LinkSuggestion>,
}

/// A local repository as the matching sees it.
pub struct Candidate<'a> {
    pub path: &'a str,
    /// Names the project is known by: the Epitech project part of the folder name, the folder, the remote.
    pub names: Vec<&'a str>,
    pub module: Option<&'a str>,
}

/// Ties subjects to repositories, and keeps the ties current:
/// 1. a document downloaded from a MY Epitech project follows that project's repository
///    (by identifier: the most reliable signal), including when the repository moves;
/// 2. otherwise, one repository whose name is the subject's own name (and whose module agrees
///    when the file name carries one) is linked;
/// 3. anything less certain becomes a suggestion, never a link.
/// A link chosen by hand is never changed, and a refused pair is never suggested again.
pub fn associate(conn: &Connection, repos: &[Candidate], my_repo_of: &dyn Fn(i64) -> Option<String>) -> Result<Association> {
    let mut out = Association::default();
    let rejects = db::subject_rejects(conn)?;
    let refused = |id: i64, path: &str| rejects.iter().any(|(s, p)| *s == id && p == path);
    let exists = |path: &str| repos.iter().any(|r| r.path == path);
    for subject in db::list_subjects(conn)? {
        if subject.link_source.as_deref() == Some("manual") {
            continue;
        }
        let current_ok = subject.repo_path.as_deref().is_some_and(exists);
        // A link from before this version (no source recorded) that still points to a project is kept.
        if current_ok && subject.link_source.is_none() {
            continue;
        }
        // 1. By MY Epitech identifier.
        if let Some(target) = subject.my_project_id.and_then(my_repo_of).filter(|p| exists(p) && !refused(subject.id, p)) {
            if db::link_subject_auto(conn, subject.id, &target)? {
                out.linked += 1;
            }
            continue;
        }
        if current_ok {
            continue;
        }
        // 2./3. By name, for documents without a link (or whose repository is gone).
        let key = subject_key(&subject.name);
        let module = module_prefix(&subject.name);
        let mut scored: Vec<(usize, &Candidate)> = repos
            .iter()
            .filter(|r| !refused(subject.id, r.path))
            .map(|r| (r.names.iter().map(|n| rank(&key, n)).max().unwrap_or(0), r))
            .filter(|(score, r)| *score > 0 && module.is_none_or(|m| r.module.is_none_or(|rm| rm == m)))
            .collect();
        scored.sort_by(|a, b| b.0.cmp(&a.0));
        let Some(&(top, best)) = scored.first() else { continue };
        let tied = scored.iter().filter(|(s, _)| *s == top).count();
        let module_agrees = module.is_some() && best.module == module;
        if top >= 1000 && tied == 1 && (module.is_none() || module_agrees) {
            if db::link_subject_auto(conn, subject.id, best.path)? {
                out.linked += 1;
            }
        } else {
            let reason = if tied > 1 { format!("{tied} projets portent ce nom") } else if top >= 1000 { "même nom, module non confirmé".to_string() } else { "nom proche".to_string() };
            out.suggestions.push(LinkSuggestion { subject_id: subject.id, repo_path: best.path.to_string(), reason });
        }
    }
    Ok(out)
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
    fn association_is_certain_or_asks() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = db::open_in_memory().unwrap();
        let store = tmp.path().join("subjects");
        let mk = |name: &str, body: &[u8]| {
            let f = tmp.path().join(name);
            fs::write(&f, body).unwrap();
            import(&conn, &store, &f, None, 1).unwrap().subject.id
        };
        let ls = mk("G-PSU-100_my_ls.pdf", b"%PDF-1 ls");
        let hunter = mk("G-MUL-100_my_hunter.pdf", b"%PDF-1 hunter");
        let printf = mk("my_printf-bootstrap.pdf", b"%PDF-1 printf");
        let organized = mk("G-CPE-100_organized.pdf", b"%PDF-1 organized");
        let from_my = mk("Subject.pdf", b"%PDF-1 radar");
        db::set_subject_origin(&conn, from_my, Some(42), true).unwrap();
        let repos = vec![
            Candidate { path: "/p/myls", names: vec!["my_ls"], module: Some("G-PSU-100") },
            Candidate { path: "/p/hunter", names: vec!["myhunter"], module: Some("G-MUL-100") },
            Candidate { path: "/p/hunter-copy", names: vec!["myhunter"], module: Some("G-MUL-100") },
            Candidate { path: "/p/printf", names: vec!["my_printf"], module: None },
            Candidate { path: "/p/radar", names: vec!["radar"], module: Some("G-MUL-100") },
            Candidate { path: "/p/organized", names: vec!["organized"], module: None },
        ];
        let my = |id: i64| (id == 42).then(|| "/p/radar".to_string());
        let a = associate(&conn, &repos, &my).unwrap();
        let get = |id| db::get_subject(&conn, id).unwrap().unwrap();
        assert_eq!(get(ls).repo_path.as_deref(), Some("/p/myls"), "same name, same module: linked");
        assert_eq!(get(from_my).repo_path.as_deref(), Some("/p/radar"), "MY Epitech identifier wins over the name");
        assert_eq!(get(hunter).repo_path, None, "two repositories with that name: not linked");
        assert!(a.suggestions.iter().any(|s| s.subject_id == hunter && s.reason.contains("2 projets")));
        assert_eq!(get(printf).repo_path.as_deref(), Some("/p/printf"), "one repository with that exact name, no module to contradict it");
        assert_eq!(get(organized).repo_path, None, "the file names a module the repository does not confirm: asked, not linked");
        assert!(a.suggestions.iter().any(|s| s.subject_id == organized && s.repo_path == "/p/organized"));
        assert_eq!(a.linked, 3);
        // A refused suggestion is not offered again; a link made by hand is never moved.
        db::reject_subject_link(&conn, organized, "/p/organized").unwrap();
        db::link_subject_by_hand(&conn, ls, Some("/p/printf")).unwrap();
        let b = associate(&conn, &repos, &my).unwrap();
        assert!(!b.suggestions.iter().any(|s| s.subject_id == organized));
        assert_eq!(get(ls).repo_path.as_deref(), Some("/p/printf"));
        assert_eq!(b.linked, 0, "nothing changes twice");
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
