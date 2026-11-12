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
    // v3: library manager and run history
    "CREATE TABLE libraries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        path TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
     );
     CREATE TABLE lib_meta (
        library_id INTEGER NOT NULL,
        rel TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (library_id, rel)
     );
     CREATE TABLE lib_presets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        library_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        files TEXT NOT NULL,
        UNIQUE (library_id, name)
     );
     CREATE TABLE lib_installs (
        repo_path TEXT NOT NULL,
        dest_rel TEXT NOT NULL,
        library_id INTEGER NOT NULL,
        src_rel TEXT NOT NULL,
        installed_hash TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        installed_at INTEGER NOT NULL,
        PRIMARY KEY (repo_path, dest_rel)
     );
     CREATE TABLE runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        repo_path TEXT,
        started_at INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        log TEXT NOT NULL
     );
     CREATE INDEX runs_repo ON runs(repo_path, started_at DESC);
     CREATE INDEX runs_kind ON runs(kind, started_at DESC);",
    // v4: MY Epitech cache (raw answers of the user's own account) and sync history. No token is stored.
    "CREATE TABLE my_cache (
        route TEXT PRIMARY KEY,
        fetched_at INTEGER NOT NULL,
        status INTEGER NOT NULL,
        body TEXT NOT NULL
     );
     CREATE TABLE my_sync_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        ok INTEGER NOT NULL,
        failed INTEGER NOT NULL,
        detail TEXT NOT NULL
     );",
    // v5: three-state project status, hand-in instant and its origin, manual classification
    // and MY Epitech association, binary to launch; customised prompts; quick-command history.
    "ALTER TABLE repo_meta ADD COLUMN status TEXT;
     ALTER TABLE repo_meta ADD COLUMN deadline_at TEXT;
     ALTER TABLE repo_meta ADD COLUMN deadline_source TEXT;
     ALTER TABLE repo_meta ADD COLUMN kind_override TEXT;
     ALTER TABLE repo_meta ADD COLUMN my_project_id INTEGER;
     ALTER TABLE repo_meta ADD COLUMN run_bin TEXT;
     ALTER TABLE repo_meta ADD COLUMN run_args TEXT;
     UPDATE repo_meta SET status = 'done' WHERE archived != 0;
     CREATE TABLE prompts (
        id TEXT NOT NULL,
        preset TEXT NOT NULL,
        body TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (id, preset)
     );
     CREATE TABLE cmd_history (
        repo_path TEXT NOT NULL,
        command TEXT NOT NULL,
        ts INTEGER NOT NULL,
        PRIMARY KEY (repo_path, command)
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
    /// Same as `status == done`; kept for the screens that only need "finished or not".
    pub archived: bool,
    pub last_opened_at: Option<i64>,
    /// Hand-in day, local time (`YYYY-MM-DD`).
    pub deadline: Option<String>,
    /// Hand-in instant (RFC 3339) when the hour is known.
    pub deadline_at: Option<String>,
    /// `manual` or `my`. `None` for dates saved before 0.3.
    pub deadline_source: Option<String>,
    /// `todo`, `in_progress` or `done`, when the user chose one.
    pub status: Option<String>,
    /// `epitech` or `personal`, when the user corrected the classification.
    pub kind_override: Option<String>,
    /// MY Epitech project chosen by hand for this repository.
    pub my_project_id: Option<i64>,
    pub run_bin: Option<String>,
    pub run_args: Option<String>,
}

pub const STATUSES: &[&str] = &["todo", "in_progress", "done"];

pub fn all_meta(conn: &Connection) -> Result<HashMap<String, RepoMeta>> {
    let mut stmt = conn.prepare("SELECT path, favorite, archived, last_opened_at, deadline, deadline_at, deadline_source, status, kind_override, my_project_id, run_bin, run_args FROM repo_meta")?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            RepoMeta {
                favorite: r.get::<_, i64>(1)? != 0,
                archived: r.get::<_, i64>(2)? != 0,
                last_opened_at: r.get(3)?,
                deadline: r.get(4)?,
                deadline_at: r.get(5)?,
                deadline_source: r.get(6)?,
                status: r.get(7)?,
                kind_override: r.get(8)?,
                my_project_id: r.get(9)?,
                run_bin: r.get(10)?,
                run_args: r.get(11)?,
            },
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
    /// Hand-in day (`YYYY-MM-DD`, local time). Never guessed.
    pub deadline: Option<String>,
    /// Hand-in instant (RFC 3339) when the hour is known.
    pub deadline_at: Option<String>,
    /// `manual` or `my`.
    pub deadline_source: Option<String>,
    pub build_cmd: Option<String>,
    pub notes: String,
    /// Binary to launch, relative to the project folder. Empty = detected.
    pub run_bin: Option<String>,
    pub run_args: Option<String>,
}

pub fn get_sheet(conn: &Connection, path: &str) -> Result<ProjectSheet> {
    let row = conn
        .query_row("SELECT deadline, deadline_at, deadline_source, build_cmd, notes, run_bin, run_args FROM repo_meta WHERE path = ?1", [path], |r| {
            Ok(ProjectSheet { deadline: r.get(0)?, deadline_at: r.get(1)?, deadline_source: r.get(2)?, build_cmd: r.get(3)?, notes: r.get::<_, Option<String>>(4)?.unwrap_or_default(), run_bin: r.get(5)?, run_args: r.get(6)? })
        })
        .optional()?;
    Ok(row.unwrap_or_default())
}

pub fn save_sheet(conn: &Connection, path: &str, sheet: &ProjectSheet) -> Result<()> {
    conn.execute(
        "INSERT INTO repo_meta (path, deadline, deadline_at, deadline_source, build_cmd, notes, run_bin, run_args) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(path) DO UPDATE SET deadline = excluded.deadline, deadline_at = excluded.deadline_at, deadline_source = excluded.deadline_source,
            build_cmd = excluded.build_cmd, notes = excluded.notes, run_bin = excluded.run_bin, run_args = excluded.run_args",
        params![path, sheet.deadline, sheet.deadline_at, sheet.deadline_source, sheet.build_cmd, sheet.notes, sheet.run_bin, sheet.run_args],
    )?;
    Ok(())
}

/// Only the hand-in date changes; notes, commands and status are left alone.
pub fn set_deadline(conn: &Connection, path: &str, day: Option<&str>, at: Option<&str>, source: Option<&str>) -> Result<()> {
    conn.execute(
        "INSERT INTO repo_meta (path, deadline, deadline_at, deadline_source) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(path) DO UPDATE SET deadline = excluded.deadline, deadline_at = excluded.deadline_at, deadline_source = excluded.deadline_source",
        params![path, day, at, source],
    )?;
    Ok(())
}

/// `status` is one of `STATUSES`. `archived` follows it so older code keeps working.
pub fn set_status(conn: &Connection, path: &str, status: &str) -> Result<()> {
    let archived = (status == "done") as i64;
    conn.execute(
        "INSERT INTO repo_meta (path, status, archived) VALUES (?1, ?2, ?3) ON CONFLICT(path) DO UPDATE SET status = excluded.status, archived = excluded.archived",
        params![path, status, archived],
    )?;
    Ok(())
}

pub fn set_kind_override(conn: &Connection, path: &str, kind: Option<&str>) -> Result<()> {
    conn.execute("INSERT INTO repo_meta (path, kind_override) VALUES (?1, ?2) ON CONFLICT(path) DO UPDATE SET kind_override = excluded.kind_override", params![path, kind])?;
    Ok(())
}

pub fn set_my_project(conn: &Connection, path: &str, id: Option<i64>) -> Result<()> {
    conn.execute("INSERT INTO repo_meta (path, my_project_id) VALUES (?1, ?2) ON CONFLICT(path) DO UPDATE SET my_project_id = excluded.my_project_id", params![path, id])?;
    Ok(())
}

// ───────────────────────────── quick-command history ─────────────────────────────

pub fn remember_command(conn: &Connection, repo: &str, command: &str, ts: i64, keep: u32) -> Result<()> {
    conn.execute("INSERT INTO cmd_history (repo_path, command, ts) VALUES (?1, ?2, ?3) ON CONFLICT(repo_path, command) DO UPDATE SET ts = excluded.ts", params![repo, command, ts])?;
    conn.execute("DELETE FROM cmd_history WHERE repo_path = ?1 AND command NOT IN (SELECT command FROM cmd_history WHERE repo_path = ?1 ORDER BY ts DESC LIMIT ?2)", params![repo, keep])?;
    Ok(())
}

pub fn recent_commands(conn: &Connection, repo: &str, limit: u32) -> Result<Vec<String>> {
    let mut st = conn.prepare("SELECT command FROM cmd_history WHERE repo_path = ?1 ORDER BY ts DESC, command LIMIT ?2")?;
    let rows = st.query_map(params![repo, limit], |r| r.get::<_, String>(0))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

pub fn forget_command(conn: &Connection, repo: &str, command: &str) -> Result<()> {
    conn.execute("DELETE FROM cmd_history WHERE repo_path = ?1 AND command = ?2", params![repo, command])?;
    Ok(())
}

// ───────────────────────────── customised prompts ─────────────────────────────

/// (preset, body) of every saved variant of one prompt.
pub fn prompt_variants(conn: &Connection, id: &str) -> Result<Vec<(String, String, i64)>> {
    let mut st = conn.prepare("SELECT preset, body, updated_at FROM prompts WHERE id = ?1 ORDER BY preset")?;
    let rows = st.query_map([id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

pub fn prompt_save(conn: &Connection, id: &str, preset: &str, body: &str, ts: i64) -> Result<()> {
    conn.execute("INSERT INTO prompts (id, preset, body, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(id, preset) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at", params![id, preset, body, ts])?;
    Ok(())
}

pub fn prompt_delete(conn: &Connection, id: &str, preset: &str) -> Result<()> {
    conn.execute("DELETE FROM prompts WHERE id = ?1 AND preset = ?2", params![id, preset])?;
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
        set_status(&conn, "/r", "done").unwrap();
        let sheet = ProjectSheet { deadline: Some("2026-11-22".into()), deadline_at: Some("2026-11-22T19:42:00+01:00".into()), deadline_source: Some("manual".into()), build_cmd: Some("make".into()), notes: "# todo".into(), run_bin: Some("a.out".into()), run_args: Some("-x 1".into()) };
        save_sheet(&conn, "/r", &sheet).unwrap();
        assert_eq!(get_sheet(&conn, "/r").unwrap(), sheet);
        let meta = &all_meta(&conn).unwrap()["/r"];
        assert!(meta.favorite && meta.archived);
        assert_eq!((meta.deadline.as_deref(), meta.status.as_deref(), meta.run_bin.as_deref()), (Some("2026-11-22"), Some("done"), Some("a.out")));
    }

    #[test]
    fn a_finished_project_can_go_back_to_any_status() {
        let conn = open_in_memory().unwrap();
        set_deadline(&conn, "/r", Some("2026-11-13"), None, Some("my")).unwrap();
        for (status, archived) in [("done", true), ("in_progress", false), ("done", true), ("todo", false)] {
            set_status(&conn, "/r", status).unwrap();
            let meta = &all_meta(&conn).unwrap()["/r"];
            assert_eq!((meta.status.as_deref(), meta.archived), (Some(status), archived));
            assert_eq!(meta.deadline.as_deref(), Some("2026-11-13"), "the deadline survives a status change");
        }
    }

    #[test]
    fn projects_archived_before_v5_become_done() {
        let conn = Connection::open_in_memory().unwrap();
        for (i, sql) in MIGRATIONS.iter().enumerate().take(4) {
            conn.execute_batch(sql).unwrap();
            conn.pragma_update(None, "user_version", (i + 1) as i64).unwrap();
        }
        conn.execute("INSERT INTO repo_meta (path, archived, deadline) VALUES ('/old', 1, '2026-11-13'), ('/cur', 0, NULL)", []).unwrap();
        migrate(&conn).unwrap();
        let meta = all_meta(&conn).unwrap();
        assert_eq!((meta["/old"].status.as_deref(), meta["/old"].deadline.as_deref(), meta["/old"].deadline_source.as_deref()), (Some("done"), Some("2026-11-13"), None));
        assert_eq!(meta["/cur"].status, None);
    }

    #[test]
    fn command_history_is_recent_first_deduplicated_and_bounded() {
        let conn = open_in_memory().unwrap();
        for (i, c) in ["make", "make re", "make", "./a.out 1", "make fclean"].iter().enumerate() {
            remember_command(&conn, "/r", c, i as i64, 3).unwrap();
        }
        assert_eq!(recent_commands(&conn, "/r", 10).unwrap(), vec!["make fclean", "./a.out 1", "make"]);
        assert!(recent_commands(&conn, "/other", 10).unwrap().is_empty());
        forget_command(&conn, "/r", "make").unwrap();
        assert_eq!(recent_commands(&conn, "/r", 10).unwrap().len(), 2);
    }

    #[test]
    fn prompt_variants_are_kept_per_preset() {
        let conn = open_in_memory().unwrap();
        prompt_save(&conn, "readme.generate", "custom", "v1", 1).unwrap();
        prompt_save(&conn, "readme.generate", "custom", "v2", 2).unwrap();
        prompt_save(&conn, "readme.generate", "short", "s", 3).unwrap();
        let v = prompt_variants(&conn, "readme.generate").unwrap();
        assert_eq!(v.iter().map(|(p, b, _)| (p.as_str(), b.as_str())).collect::<Vec<_>>(), vec![("custom", "v2"), ("short", "s")]);
        prompt_delete(&conn, "readme.generate", "custom").unwrap();
        assert_eq!(prompt_variants(&conn, "readme.generate").unwrap().len(), 1);
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

// ───────────────────────────── run history ─────────────────────────────

/// One finished build, test run, clean-clone test or check.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub id: i64,
    pub kind: String,
    pub repo_path: Option<String>,
    pub started_at: i64,
    pub duration_ms: i64,
    pub status: String,
    pub title: String,
    pub summary: serde_json::Value,
    /// Only filled by `get_run`.
    pub log: Option<String>,
}

#[allow(clippy::too_many_arguments)]
pub fn insert_run(conn: &Connection, kind: &str, repo_path: Option<&str>, started_at: i64, duration_ms: i64, status: &str, title: &str, summary: &str, log: &str) -> Result<i64> {
    conn.execute(
        "INSERT INTO runs (kind, repo_path, started_at, duration_ms, status, title, summary, log) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![kind, repo_path, started_at, duration_ms, status, title, summary, log],
    )?;
    Ok(conn.last_insert_rowid())
}

fn run_row(r: &rusqlite::Row, with_log: bool) -> rusqlite::Result<Run> {
    let summary: String = r.get(7)?;
    Ok(Run {
        id: r.get(0)?,
        kind: r.get(1)?,
        repo_path: r.get(2)?,
        started_at: r.get(3)?,
        duration_ms: r.get(4)?,
        status: r.get(5)?,
        title: r.get(6)?,
        summary: serde_json::from_str(&summary).unwrap_or(serde_json::Value::Null),
        log: if with_log { Some(r.get(8)?) } else { None },
    })
}

/// Most recent first. `repo` and `kind` narrow the list when given.
pub fn list_runs(conn: &Connection, repo: Option<&str>, kind: Option<&str>, limit: u32) -> Result<Vec<Run>> {
    let mut st = conn.prepare(
        "SELECT id, kind, repo_path, started_at, duration_ms, status, title, summary FROM runs
         WHERE (?1 IS NULL OR repo_path = ?1) AND (?2 IS NULL OR kind = ?2) ORDER BY started_at DESC, id DESC LIMIT ?3",
    )?;
    let rows = st.query_map(params![repo, kind, limit], |r| run_row(r, false))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

pub fn get_run(conn: &Connection, id: i64) -> Result<Option<Run>> {
    Ok(conn
        .query_row("SELECT id, kind, repo_path, started_at, duration_ms, status, title, summary, log FROM runs WHERE id = ?1", [id], |r| run_row(r, true))
        .optional()?)
}

pub fn delete_run(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM runs WHERE id = ?1", [id])?;
    Ok(())
}
