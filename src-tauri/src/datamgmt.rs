//! Tekboard's own files: where they are, a backup you can carry to another computer, its
//! restoration, and the resets. Everything here stays inside Tekboard's data and cache folders
//! (XDG: `~/.local/share/dev.tekboard.app`, `~/.cache/dev.tekboard.app`): repositories and
//! projects folders are never read, moved or deleted.
//!
//! A backup is a zip: `manifest.json`, a consistent copy of the database (`VACUUM INTO`),
//! `templates/`, `subjects/` and `libraries/`. It never holds the MY Epitech browser session
//! (cookies) nor the cache, and the database holds no token or password.

use crate::db;
use crate::error::{AppError, Result};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

/// Folders of the data directory that a backup carries.
pub const CARRIED: &[&str] = &["templates", "subjects", "libraries"];
const DB_FILE: &str = "tekboard.db";
const MANIFEST: &str = "manifest.json";
const FORMAT: u32 = 1;
/// The browser session of the MY Epitech window: sensitive, never exported.
pub const SESSION_DIR: &str = "my-session";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub app: String,
    pub format: u32,
    pub version: String,
    /// `PRAGMA user_version` of the database inside.
    pub schema: u32,
    pub created_at: i64,
    /// Data folder of the computer that made it: paths under it are moved on restore.
    pub data_dir: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Location {
    /// `data`, `session`, `cache`.
    pub kind: &'static str,
    pub path: String,
    pub bytes: u64,
}

pub fn dir_size(path: &Path) -> u64 {
    let Ok(meta) = fs::symlink_metadata(path) else { return 0 };
    if meta.is_file() {
        return meta.len();
    }
    if !meta.is_dir() {
        return 0;
    }
    fs::read_dir(path).map(|rd| rd.flatten().map(|e| dir_size(&e.path())).sum()).unwrap_or(0)
}

pub fn locations(data_dir: &Path, cache_dir: &Path) -> Vec<Location> {
    let session = data_dir.join(SESSION_DIR);
    let data = dir_size(data_dir).saturating_sub(dir_size(&session));
    vec![
        Location { kind: "data", path: data_dir.to_string_lossy().into_owned(), bytes: data },
        Location { kind: "session", path: session.to_string_lossy().into_owned(), bytes: dir_size(&session) },
        Location { kind: "cache", path: cache_dir.to_string_lossy().into_owned(), bytes: dir_size(cache_dir) },
    ]
}

fn schema_of(conn: &Connection) -> Result<u32> {
    Ok(conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? as u32)
}

fn zerr(e: zip::result::ZipError) -> AppError {
    AppError::new("backup_unreadable", format!("Archive illisible : {e}"))
}

fn stamp() -> String {
    chrono::Local::now().format("%Y%m%d-%H%M%S").to_string()
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportSummary {
    pub path: String,
    pub bytes: u64,
    pub files: usize,
}

/// Writes a backup to `dest` (replaced only once the new one is complete).
pub fn export(conn: &Connection, data_dir: &Path, scratch: &Path, dest: &Path, version: &str, now: i64) -> Result<ExportSummary> {
    fs::create_dir_all(scratch)?;
    let snapshot = scratch.join(format!("export-{}-{}.db", std::process::id(), stamp()));
    let _ = fs::remove_file(&snapshot);
    conn.execute("VACUUM INTO ?1", [snapshot.to_string_lossy()])?;
    let result = (|| -> Result<ExportSummary> {
        let manifest = Manifest { app: "tekboard".into(), format: FORMAT, version: version.into(), schema: schema_of(conn)?, created_at: now, data_dir: data_dir.to_string_lossy().into_owned() };
        let partial = dest.with_extension("partial");
        let file = fs::File::create(&partial)?;
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated).unix_permissions(0o600);
        zip.start_file(MANIFEST, options).map_err(zerr)?;
        zip.write_all(serde_json::to_string_pretty(&manifest)?.as_bytes())?;
        zip.start_file(DB_FILE, options).map_err(zerr)?;
        std::io::copy(&mut fs::File::open(&snapshot)?, &mut zip)?;
        let mut files = 2;
        for dir in CARRIED {
            files += add_dir(&mut zip, &data_dir.join(dir), dir, options)?;
        }
        zip.finish().map_err(zerr)?;
        fs::rename(&partial, dest)?;
        Ok(ExportSummary { path: dest.to_string_lossy().into_owned(), bytes: fs::metadata(dest)?.len(), files })
    })();
    let _ = fs::remove_file(&snapshot);
    if result.is_err() {
        let _ = fs::remove_file(dest.with_extension("partial"));
    }
    result
}

fn add_dir(zip: &mut zip::ZipWriter<fs::File>, dir: &Path, prefix: &str, options: zip::write::SimpleFileOptions) -> Result<usize> {
    let Ok(rd) = fs::read_dir(dir) else { return Ok(0) };
    let mut count = 0;
    let mut entries: Vec<_> = rd.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        let name = format!("{prefix}/{}", e.file_name().to_string_lossy());
        // Links are not followed: a backup holds Tekboard's own files only.
        let Ok(meta) = fs::symlink_metadata(e.path()) else { continue };
        if meta.is_dir() {
            count += add_dir(zip, &e.path(), &name, options)?;
        } else if meta.is_file() {
            zip.start_file(&name, options).map_err(zerr)?;
            std::io::copy(&mut fs::File::open(e.path())?, zip)?;
            count += 1;
        }
    }
    Ok(count)
}

/// Reads the manifest of a backup and checks it can be restored by this version.
pub fn inspect(path: &Path) -> Result<Manifest> {
    let mut zip = zip::ZipArchive::new(fs::File::open(path).map_err(|e| AppError::new("backup_unreadable", format!("Fichier illisible : {e}")))?).map_err(|_| AppError::new("backup_unreadable", "Ce fichier n'est pas une sauvegarde Tekboard (archive zip attendue)"))?;
    let mut text = String::new();
    zip.by_name(MANIFEST).map_err(|_| AppError::new("backup_unreadable", "Ce fichier n'est pas une sauvegarde Tekboard : manifest.json manquant"))?.take(64 * 1024).read_to_string(&mut text)?;
    let m: Manifest = serde_json::from_str(&text).map_err(|_| AppError::new("backup_unreadable", "Le manifeste de cette sauvegarde est illisible"))?;
    if m.app != "tekboard" {
        return Err(AppError::new("backup_unreadable", "Ce fichier n'est pas une sauvegarde Tekboard"));
    }
    if m.format > FORMAT || m.schema as usize > db::schema_version() {
        return Err(AppError::new("backup_newer", format!("Cette sauvegarde vient de Tekboard {}, plus récent que cette version. Mets Tekboard à jour, puis restaure-la.", m.version)));
    }
    Ok(m)
}

/// Unpacks a backup into `staging` (a new folder) and prepares its database: integrity
/// checked, migrated to this version, paths moved to this computer's data folder.
pub fn stage(path: &Path, staging: &Path, data_dir: &Path) -> Result<Manifest> {
    let manifest = inspect(path)?;
    if staging.exists() {
        fs::remove_dir_all(staging)?;
    }
    fs::create_dir_all(staging)?;
    let mut zip = zip::ZipArchive::new(fs::File::open(path)?).map_err(zerr)?;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(zerr)?;
        // `enclosed_name` refuses absolute paths and `..`: nothing lands outside `staging`.
        let Some(rel) = entry.enclosed_name() else {
            return Err(AppError::new("backup_unsafe", format!("Sauvegarde refusée : chemin interdit « {} »", entry.name().unwrap_or_default())));
        };
        let top = rel.components().next().map(|c| c.as_os_str().to_string_lossy().into_owned()).unwrap_or_default();
        if !(top == DB_FILE || top == MANIFEST || CARRIED.contains(&top.as_str())) {
            continue;
        }
        let out = staging.join(&rel);
        if entry.is_dir() {
            fs::create_dir_all(&out)?;
            continue;
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut f = fs::File::create(&out)?;
        std::io::copy(&mut entry, &mut f)?;
    }
    let db_path = staging.join(DB_FILE);
    if !db_path.is_file() {
        return Err(AppError::new("backup_unreadable", "Cette sauvegarde ne contient pas de base de données"));
    }
    {
        let conn = Connection::open(&db_path).map_err(|_| AppError::new("backup_corrupt", "La base de données de cette sauvegarde est illisible"))?;
        let check: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0)).map_err(|_| AppError::new("backup_corrupt", "La base de données de cette sauvegarde est illisible"))?;
        if check != "ok" {
            return Err(AppError::new("backup_corrupt", "La base de données de cette sauvegarde est abîmée"));
        }
    }
    let conn = db::open(&db_path)?;
    let old = manifest.data_dir.trim_end_matches('/');
    let new = data_dir.to_string_lossy();
    if !old.is_empty() && old != new.trim_end_matches('/') {
        conn.execute("UPDATE libraries SET path = ?2 || substr(path, length(?1) + 1) WHERE path = ?1 OR path LIKE ?1 || '/%'", [old, new.trim_end_matches('/')])?;
    }
    conn.pragma_update(None, "journal_mode", "DELETE")?;
    drop(conn);
    Ok(manifest)
}

/// Puts a staged backup in place of the current data. The connection behind `slot` is
/// swapped, so every holder of the shared database sees the restored one.
pub fn swap_in(slot: &std::sync::Mutex<Connection>, staging: &Path, data_dir: &Path) -> Result<()> {
    let old = data_dir.join(format!(".before-restore-{}", stamp()));
    fs::create_dir_all(&old)?;
    let mut guard = slot.lock().unwrap_or_else(|e| e.into_inner());
    // Closes the current database before its file moves.
    let current = std::mem::replace(&mut *guard, db::open_in_memory()?);
    drop(current);
    let moved = (|| -> Result<()> {
        for suffix in ["", "-wal", "-shm"] {
            let f = data_dir.join(format!("{DB_FILE}{suffix}"));
            if f.exists() {
                fs::rename(&f, old.join(format!("{DB_FILE}{suffix}")))?;
            }
        }
        fs::rename(staging.join(DB_FILE), data_dir.join(DB_FILE))?;
        for dir in CARRIED {
            let cur = data_dir.join(dir);
            if cur.exists() {
                fs::rename(&cur, old.join(dir))?;
            }
            let new = staging.join(dir);
            if new.exists() {
                fs::rename(&new, &cur)?;
            }
        }
        Ok(())
    })();
    if let Err(e) = moved {
        // Put everything back as it was.
        let _ = fs::remove_file(data_dir.join(DB_FILE));
        for suffix in ["", "-wal", "-shm"] {
            let f = old.join(format!("{DB_FILE}{suffix}"));
            if f.exists() {
                let _ = fs::rename(&f, data_dir.join(format!("{DB_FILE}{suffix}")));
            }
        }
        for dir in CARRIED {
            if old.join(dir).exists() {
                let _ = fs::remove_dir_all(data_dir.join(dir));
                let _ = fs::rename(old.join(dir), data_dir.join(dir));
            }
        }
        *guard = db::open(&data_dir.join(DB_FILE))?;
        let _ = fs::remove_dir_all(&old);
        return Err(e);
    }
    *guard = db::open(&data_dir.join(DB_FILE))?;
    drop(guard);
    let _ = fs::remove_dir_all(&old);
    let _ = fs::remove_dir_all(staging);
    Ok(())
}

/// Empties the cache folder (the folder itself stays). Returns the bytes freed.
pub fn clear_cache(cache_dir: &Path) -> Result<u64> {
    let before = dir_size(cache_dir);
    if let Ok(rd) = fs::read_dir(cache_dir) {
        for e in rd.flatten() {
            remove_entry(&e.path())?;
        }
    }
    Ok(before.saturating_sub(dir_size(cache_dir)))
}

fn remove_entry(path: &Path) -> Result<()> {
    let meta = fs::symlink_metadata(path)?;
    // A link is removed itself, never what it points to.
    if meta.is_dir() {
        fs::remove_dir_all(path)?;
    } else {
        fs::remove_file(path)?;
    }
    Ok(())
}

/// Settings keys reset by "Réinitialiser les paramètres": preferences only, not your work.
pub const SETTING_KEYS: &[&str] = &["app", "ui_prefs", "ai_settings"];

pub fn reset_settings(conn: &Connection) -> Result<()> {
    for k in SETTING_KEYS {
        conn.execute("DELETE FROM settings WHERE key = ?1", [k])?;
    }
    Ok(())
}

/// Tekboard's folders must look like Tekboard's before anything is erased in them.
fn is_own_dir(dir: &Path, identifier: &str) -> bool {
    dir.is_absolute() && dir.file_name().is_some_and(|n| n == identifier) && dir.components().count() > 3
}

/// Erases everything inside Tekboard's data and cache folders. A projects folder that
/// happens to sit inside one of them is kept, as everything leading to it.
pub fn erase_all(data_dir: &Path, cache_dir: &Path, identifier: &str, keep: &[PathBuf]) -> Result<()> {
    for dir in [data_dir, cache_dir] {
        if !is_own_dir(dir, identifier) {
            return Err(AppError::new("unsafe_reset", format!("{} ne ressemble pas à un dossier de Tekboard : rien n'a été effacé", dir.display())));
        }
    }
    for dir in [data_dir, cache_dir] {
        erase_inside(dir, keep)?;
    }
    Ok(())
}

fn erase_inside(dir: &Path, keep: &[PathBuf]) -> Result<()> {
    let Ok(rd) = fs::read_dir(dir) else { return Ok(()) };
    for e in rd.flatten() {
        let path = e.path();
        if keep.iter().any(|k| k == &path) {
            continue;
        }
        if keep.iter().any(|k| k.starts_with(&path)) && fs::symlink_metadata(&path).map(|m| m.is_dir()).unwrap_or(false) {
            erase_inside(&path, keep)?;
            continue;
        }
        remove_entry(&path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let data = tmp.path().join("share/dev.tekboard.app");
        let cache = tmp.path().join("cache/dev.tekboard.app");
        fs::create_dir_all(data.join("templates/c-minimal")).unwrap();
        fs::create_dir_all(data.join("subjects")).unwrap();
        fs::create_dir_all(data.join(SESSION_DIR)).unwrap();
        fs::create_dir_all(cache.join("testrepo/x")).unwrap();
        fs::write(data.join("templates/c-minimal/Makefile"), "all:\n").unwrap();
        fs::write(data.join("subjects/ab-my_ls.pdf"), "%PDF").unwrap();
        fs::write(data.join(SESSION_DIR).join("Cookies"), "secret-cookie").unwrap();
        fs::write(cache.join("testrepo/x/a.o"), "obj").unwrap();
        (tmp, data, cache)
    }

    #[test]
    fn a_backup_restores_the_same_data_and_leaves_the_session_out() {
        let (tmp, data, cache) = setup();
        let conn = db::open(&data.join(DB_FILE)).unwrap();
        db::set_setting(&conn, "app", r#"{"roots":["/x"]}"#).unwrap();
        conn.execute("INSERT INTO libraries (name, path, created_at) VALUES ('mine', ?1, 1)", [data.join("libraries/mine").to_string_lossy()]).unwrap();
        let dest = tmp.path().join("backup.zip");
        let sum = export(&conn, &data, &cache, &dest, "0.6.0", 7).unwrap();
        assert_eq!(sum.files, 4);
        let names: Vec<String> = { let z = zip::ZipArchive::new(fs::File::open(&dest).unwrap()).unwrap(); z.file_names().map(|n| n.unwrap_or_default().into_owned()).collect() };
        assert!(names.iter().all(|n| !n.contains(SESSION_DIR) && !n.contains("testrepo")), "{names:?}");

        // Restored on another computer, whose data folder is elsewhere.
        let other = tmp.path().join("home2/share/dev.tekboard.app");
        fs::create_dir_all(&other).unwrap();
        let slot = std::sync::Mutex::new(db::open(&other.join(DB_FILE)).unwrap());
        db::set_setting(&slot.lock().unwrap(), "app", r#"{"roots":["/before"]}"#).unwrap();
        let staging = other.join(".import");
        let m = stage(&dest, &staging, &other).unwrap();
        assert_eq!((m.version.as_str(), m.created_at), ("0.6.0", 7));
        swap_in(&slot, &staging, &other).unwrap();
        let conn2 = slot.lock().unwrap();
        assert_eq!(db::get_setting(&conn2, "app").unwrap().as_deref(), Some(r#"{"roots":["/x"]}"#));
        let lib: String = conn2.query_row("SELECT path FROM libraries", [], |r| r.get(0)).unwrap();
        assert_eq!(lib, other.join("libraries/mine").to_string_lossy());
        assert_eq!(fs::read_to_string(other.join("subjects/ab-my_ls.pdf")).unwrap(), "%PDF");
        assert!(other.join("templates/c-minimal/Makefile").is_file());
        assert!(!staging.exists());
        assert!(fs::read_dir(&other).unwrap().flatten().all(|e| !e.file_name().to_string_lossy().starts_with(".before-restore")));
    }

    #[test]
    fn a_backup_from_a_newer_version_or_with_escaping_paths_is_refused() {
        let (tmp, data, _cache) = setup();
        let write = |name: &str, manifest: &Manifest, extra: Option<&str>| {
            let p = tmp.path().join(name);
            let mut z = zip::ZipWriter::new(fs::File::create(&p).unwrap());
            let o = zip::write::SimpleFileOptions::default();
            z.start_file(MANIFEST, o).unwrap();
            z.write_all(serde_json::to_string(manifest).unwrap().as_bytes()).unwrap();
            if let Some(evil) = extra {
                z.start_file(evil, o).unwrap();
                z.write_all(b"x").unwrap();
            }
            z.finish().unwrap();
            p
        };
        let mut m = Manifest { app: "tekboard".into(), format: 1, version: "9.0.0".into(), schema: db::schema_version() as u32 + 1, created_at: 1, data_dir: String::new() };
        let newer = write("newer.zip", &m, None);
        assert_eq!(inspect(&newer).unwrap_err().code(), "backup_newer");
        m.schema = 1;
        let evil = write("evil.zip", &m, Some("../../escaped.txt"));
        assert_eq!(stage(&evil, &data.join(".import"), &data).unwrap_err().code(), "backup_unsafe");
        assert!(!tmp.path().join("escaped.txt").exists() && !data.parent().unwrap().join("escaped.txt").exists());
        fs::write(tmp.path().join("not.zip"), "hello").unwrap();
        assert_eq!(inspect(&tmp.path().join("not.zip")).unwrap_err().code(), "backup_unreadable");
    }

    #[test]
    fn clearing_the_cache_only_empties_the_cache() {
        let (_tmp, data, cache) = setup();
        let freed = clear_cache(&cache).unwrap();
        assert_eq!(freed, 3);
        assert!(cache.is_dir() && fs::read_dir(&cache).unwrap().next().is_none());
        assert!(data.join("subjects/ab-my_ls.pdf").is_file());
    }

    #[test]
    fn a_full_reset_erases_tekboard_files_and_never_a_repository() {
        let (tmp, data, cache) = setup();
        // A repository outside, linked from the data folder, and a projects folder someone put inside it.
        let repo = tmp.path().join("delivery/my_ls");
        fs::create_dir_all(repo.join(".git")).unwrap();
        fs::write(repo.join("main.c"), "int main;").unwrap();
        std::os::unix::fs::symlink(&repo, data.join("link-to-repo")).unwrap();
        let inside = data.join("work/projects");
        fs::create_dir_all(inside.join("p/.git")).unwrap();
        fs::write(data.join("work/notes.txt"), "x").unwrap();
        db::open(&data.join(DB_FILE)).unwrap();
        erase_all(&data, &cache, "dev.tekboard.app", &[inside.clone()]).unwrap();
        assert!(repo.join("main.c").is_file() && inside.join("p/.git").is_dir());
        assert!(!data.join(DB_FILE).exists() && !data.join(SESSION_DIR).exists() && !data.join("work/notes.txt").exists());
        assert!(fs::read_dir(&cache).unwrap().next().is_none());
        // Somebody else's folder is refused outright.
        assert_eq!(erase_all(tmp.path(), &cache, "dev.tekboard.app", &[]).unwrap_err().code(), "unsafe_reset");
    }

    #[test]
    fn resetting_settings_keeps_the_work() {
        let conn = db::open_in_memory().unwrap();
        db::set_setting(&conn, "app", "{}").unwrap();
        db::set_setting(&conn, "ui_prefs", "{}").unwrap();
        db::set_setting(&conn, "prompt.subject", "mine").unwrap();
        reset_settings(&conn).unwrap();
        assert_eq!(db::get_setting(&conn, "app").unwrap(), None);
        assert_eq!(db::get_setting(&conn, "prompt.subject").unwrap().as_deref(), Some("mine"));
    }
}
