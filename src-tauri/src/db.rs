//! Local SQLite store. Holds preferences and per-repository metadata only:
//! no token, password or cookie is ever written here.

use crate::error::Result;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;

const MIGRATIONS: &[&str] = &[
    // v1
    "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
     CREATE TABLE repo_meta (
        path TEXT PRIMARY KEY,
        favorite INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        last_opened_at INTEGER,
        deadline TEXT,
        build_cmd TEXT,
        run_cmd TEXT,
        notes TEXT
     );
     CREATE TABLE activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        kind TEXT NOT NULL,
        repo_path TEXT,
        detail TEXT
     );
     CREATE INDEX activity_ts ON activity(ts DESC);",
    // v2: subjects library
    "CREATE TABLE subjects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        file TEXT NOT NULL UNIQUE,
        hash TEXT NOT NULL UNIQUE,
        size INTEGER NOT NULL,
        repo_path TEXT,
        added_at INTEGER NOT NULL
     );",
];

pub fn open(path: &Path) -> Result<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    migrate(&conn)?;
    Ok(conn)
}

pub fn open_in_memory() -> Result<Connection> {
    let conn = Connection::open_in_memory()?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> Result<()> {
    let current: usize = conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? as usize;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current) {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (i + 1) as i64)?;
        tx.commit()?;
    }
    Ok(())
}

pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0)).optional()?)
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoMeta {
    pub favorite: bool,
    pub archived: bool,
    pub last_opened_at: Option<i64>,
    pub deadline: Option<String>,
}

pub fn all_meta(conn: &Connection) -> Result<HashMap<String, RepoMeta>> {
    let mut stmt = conn.prepare("SELECT path, favorite, archived, last_opened_at, deadline FROM repo_meta")?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            RepoMeta { favorite: r.get::<_, i64>(1)? != 0, archived: r.get::<_, i64>(2)? != 0, last_opened_at: r.get(3)?, deadline: r.get(4)? },
        ))
    })?;
    let mut map = HashMap::new();
    for row in rows {
        let (path, meta) = row?;
        map.insert(path, meta);
    }
    Ok(map)
}

pub fn set_favorite(conn: &Connection, path: &str, favorite: bool) -> Result<()> {
    conn.execute(
        "INSERT INTO repo_meta (path, favorite) VALUES (?1, ?2) ON CONFLICT(path) DO UPDATE SET favorite = excluded.favorite",
        params![path, favorite as i64],
    )?;
    Ok(())
}

pub fn touch_opened(conn: &Connection, path: &str, ts: i64) -> Result<()> {
    conn.execute(
        "INSERT INTO repo_meta (path, last_opened_at) VALUES (?1, ?2) ON CONFLICT(path) DO UPDATE SET last_opened_at = excluded.last_opened_at",
        params![path, ts],
    )?;
    Ok(())
}

/// Editable part of a project: what the student writes, as opposed to what git reports.
#[derive(Debug, Clone, Default, Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ProjectSheet {
    /// `YYYY-MM-DD`, entered by hand. Never guessed.
    pub deadline: Option<String>,
    pub build_cmd: Option<String>,
    pub notes: String,
    /// Marked as finished. The repository itself is never touched.
    pub archived: bool,
}

pub fn get_sheet(conn: &Connection, path: &str) -> Result<ProjectSheet> {
    let row = conn
        .query_row("SELECT deadline, build_cmd, notes, archived FROM repo_meta WHERE path = ?1", [path], |r| {
            Ok(ProjectSheet { deadline: r.get(0)?, build_cmd: r.get(1)?, notes: r.get::<_, Option<String>>(2)?.unwrap_or_default(), archived: r.get::<_, i64>(3)? != 0 })
        })
        .optional()?;
    Ok(row.unwrap_or_default())
}

pub fn save_sheet(conn: &Connection, path: &str, sheet: &ProjectSheet) -> Result<()> {
    conn.execute(
        "INSERT INTO repo_meta (path, deadline, build_cmd, notes, archived) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(path) DO UPDATE SET deadline = excluded.deadline, build_cmd = excluded.build_cmd, notes = excluded.notes, archived = excluded.archived",
        params![path, sheet.deadline, sheet.build_cmd, sheet.notes, sheet.archived as i64],
    )?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Subject {
    pub id: i64,
    pub name: String,
    /// File name inside the library folder.
    pub file: String,
    pub hash: String,
    pub size: i64,
    pub repo_path: Option<String>,
    pub added_at: i64,
}

fn subject_from_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Subject> {
    Ok(Subject { id: r.get(0)?, name: r.get(1)?, file: r.get(2)?, hash: r.get(3)?, size: r.get(4)?, repo_path: r.get(5)?, added_at: r.get(6)? })
}

const SUBJECT_COLS: &str = "id, name, file, hash, size, repo_path, added_at";

pub fn list_subjects(conn: &Connection) -> Result<Vec<Subject>> {
    let mut stmt = conn.prepare(&format!("SELECT {SUBJECT_COLS} FROM subjects ORDER BY added_at DESC, id DESC"))?;
    let rows = stmt.query_map([], subject_from_row)?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}

pub fn get_subject(conn: &Connection, id: i64) -> Result<Option<Subject>> {
    Ok(conn.query_row(&format!("SELECT {SUBJECT_COLS} FROM subjects WHERE id = ?1"), [id], subject_from_row).optional()?)
}

pub fn subject_by_hash(conn: &Connection, hash: &str) -> Result<Option<Subject>> {
    Ok(conn.query_row(&format!("SELECT {SUBJECT_COLS} FROM subjects WHERE hash = ?1"), [hash], subject_from_row).optional()?)
}

pub fn insert_subject(conn: &Connection, name: &str, file: &str, hash: &str, size: i64, repo_path: Option<&str>, added_at: i64) -> Result<i64> {
    conn.execute("INSERT INTO subjects (name, file, hash, size, repo_path, added_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)", params![name, file, hash, size, repo_path, added_at])?;
    Ok(conn.last_insert_rowid())
}

pub fn link_subject(conn: &Connection, id: i64, repo_path: Option<&str>) -> Result<()> {
    conn.execute("UPDATE subjects SET repo_path = ?2 WHERE id = ?1", params![id, repo_path])?;
    Ok(())
}

pub fn delete_subject(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM subjects WHERE id = ?1", [id])?;
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub id: i64,
    pub ts: i64,
    pub kind: String,
    pub repo_path: Option<String>,
    pub detail: Option<String>,
}

pub fn log_activity(conn: &Connection, ts: i64, kind: &str, repo_path: Option<&str>, detail: Option<&str>) -> Result<()> {
    conn.execute("INSERT INTO activity (ts, kind, repo_path, detail) VALUES (?1, ?2, ?3, ?4)", params![ts, kind, repo_path, detail])?;
    Ok(())
}

pub fn recent_activity(conn: &Connection, limit: u32) -> Result<Vec<Activity>> {
    let mut stmt = conn.prepare("SELECT id, ts, kind, repo_path, detail FROM activity ORDER BY ts DESC, id DESC LIMIT ?1")?;
    let rows = stmt.query_map([limit], |r| Ok(Activity { id: r.get(0)?, ts: r.get(1)?, kind: r.get(2)?, repo_path: r.get(3)?, detail: r.get(4)? }))?;
    Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_are_idempotent() {
        let conn = open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v as usize, MIGRATIONS.len());
    }

    #[test]
    fn settings_roundtrip() {
        let conn = open_in_memory().unwrap();
        assert_eq!(get_setting(&conn, "k").unwrap(), None);
        set_setting(&conn, "k", "1").unwrap();
        set_setting(&conn, "k", "2").unwrap();
        assert_eq!(get_setting(&conn, "k").unwrap().as_deref(), Some("2"));
    }

    #[test]
    fn meta_fields_do_not_clobber_each_other() {
        let conn = open_in_memory().unwrap();
        set_favorite(&conn, "/r", true).unwrap();
        touch_opened(&conn, "/r", 42).unwrap();
        let meta = all_meta(&conn).unwrap();
        assert!(meta["/r"].favorite);
        assert_eq!(meta["/r"].last_opened_at, Some(42));
        set_favorite(&conn, "/r", false).unwrap();
        assert_eq!(all_meta(&conn).unwrap()["/r"].last_opened_at, Some(42));
    }

    #[test]
    fn sheet_roundtrip_keeps_other_meta() {
        let conn = open_in_memory().unwrap();
        assert_eq!(get_sheet(&conn, "/r").unwrap(), ProjectSheet::default());
        set_favorite(&conn, "/r", true).unwrap();
        let sheet = ProjectSheet { deadline: Some("2026-11-22".into()), build_cmd: Some("make".into()), notes: "# todo".into(), archived: true };
        save_sheet(&conn, "/r", &sheet).unwrap();
        assert_eq!(get_sheet(&conn, "/r").unwrap(), sheet);
        let meta = &all_meta(&conn).unwrap()["/r"];
        assert!(meta.favorite && meta.archived);
        assert_eq!(meta.deadline.as_deref(), Some("2026-11-22"));
    }

    #[test]
    fn subjects_crud_and_unique_hash() {
        let conn = open_in_memory().unwrap();
        let id = insert_subject(&conn, "my_ls.pdf", "ab-my_ls.pdf", "abc", 10, None, 1).unwrap();
        assert!(insert_subject(&conn, "copy.pdf", "x.pdf", "abc", 10, None, 2).is_err());
        assert_eq!(subject_by_hash(&conn, "abc").unwrap().unwrap().id, id);
        link_subject(&conn, id, Some("/r")).unwrap();
        assert_eq!(list_subjects(&conn).unwrap()[0].repo_path.as_deref(), Some("/r"));
        delete_subject(&conn, id).unwrap();
        assert!(get_subject(&conn, id).unwrap().is_none());
    }

    #[test]
    fn activity_is_newest_first() {
        let conn = open_in_memory().unwrap();
        log_activity(&conn, 1, "open", Some("/a"), None).unwrap();
        log_activity(&conn, 3, "clone", Some("/b"), Some("x")).unwrap();
        log_activity(&conn, 2, "open", None, None).unwrap();
        let acts = recent_activity(&conn, 2).unwrap();
        assert_eq!(acts.iter().map(|a| a.ts).collect::<Vec<_>>(), vec![3, 2]);
    }
}
