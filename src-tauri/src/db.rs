//! Local SQLite store. Holds preferences and per-repository metadata only:
//! no token, password or cookie is ever written here.

use crate::error::{AppError, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

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
    // v6: planning. `project` is a repository path, or `my:<id>` for a MY Epitech project
    // that is not cloned. Instants are unix seconds. Nothing here comes from MY Epitech:
    // a sync never touches these tables.
    "CREATE TABLE plan_projects (
        key TEXT PRIMARY KEY,
        priority INTEGER NOT NULL DEFAULT 0,
        estimate_min INTEGER,
        color TEXT
     );
     CREATE TABLE tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        project TEXT,
        parent_id INTEGER,
        kind TEXT NOT NULL DEFAULT 'task',
        priority INTEGER NOT NULL DEFAULT 0,
        estimate_min INTEGER,
        due_day TEXT,
        done_at INTEGER,
        created_at INTEGER NOT NULL
     );
     CREATE TABLE plan_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        start_at INTEGER NOT NULL,
        end_at INTEGER NOT NULL,
        all_day INTEGER NOT NULL DEFAULT 0,
        project TEXT,
        task_id INTEGER,
        color TEXT,
        notes TEXT NOT NULL DEFAULT '',
        origin TEXT NOT NULL DEFAULT 'me',
        done INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
     );
     CREATE INDEX plan_events_start ON plan_events(start_at);
     CREATE TABLE work_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT,
        task_id INTEGER,
        title TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        seconds INTEGER NOT NULL
     );
     CREATE INDEX work_log_start ON work_log(started_at);",
    // v7: the assistant. Durable memory (searched with FTS5), subject digests, conversations
    // (temporary history), the journal of what it did, what it proposed, and suggestions.
    // Secrets are refused before anything is written here (`ai::memory`).
    "CREATE TABLE ai_memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'assistant',
        pinned INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_used_at INTEGER,
        expires_at INTEGER,
        archived INTEGER NOT NULL DEFAULT 0
     );
     CREATE INDEX ai_memories_scope ON ai_memories(scope, archived);
     CREATE VIRTUAL TABLE ai_memories_fts USING fts5(content, content='ai_memories', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
     CREATE TRIGGER ai_memories_ai AFTER INSERT ON ai_memories BEGIN
        INSERT INTO ai_memories_fts(rowid, content) VALUES (new.id, new.content);
     END;
     CREATE TRIGGER ai_memories_ad AFTER DELETE ON ai_memories BEGIN
        INSERT INTO ai_memories_fts(ai_memories_fts, rowid, content) VALUES ('delete', old.id, old.content);
     END;
     CREATE TRIGGER ai_memories_au AFTER UPDATE OF content ON ai_memories BEGIN
        INSERT INTO ai_memories_fts(ai_memories_fts, rowid, content) VALUES ('delete', old.id, old.content);
        INSERT INTO ai_memories_fts(rowid, content) VALUES (new.id, new.content);
     END;
     CREATE TABLE project_briefs (
        project TEXT PRIMARY KEY,
        subject_id INTEGER,
        subject_hash TEXT,
        brief TEXT NOT NULL,
        stale INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
     );
     CREATE TABLE ai_threads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        session_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
     );
     CREATE TABLE ai_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        meta TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL
     );
     CREATE INDEX ai_messages_thread ON ai_messages(thread_id, id);
     CREATE TABLE ai_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id INTEGER,
        tool TEXT NOT NULL,
        summary TEXT NOT NULL,
        args TEXT NOT NULL,
        result TEXT NOT NULL,
        undo TEXT,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
     );
     CREATE TABLE ai_proposals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id INTEGER,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        rationale TEXT NOT NULL DEFAULT '',
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        outcome TEXT,
        created_at INTEGER NOT NULL,
        decided_at INTEGER
     );
     CREATE TABLE ai_insights (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        actions TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'new',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        snooze_until INTEGER
     );",
    // v8: work sessions kept by the backend (never left running by accident), plan entries
    // that cannot be duplicated, and time logged per calendar entry (done once, never twice).
    "CREATE TABLE focus_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        project TEXT,
        task_id INTEGER,
        event_id INTEGER,
        started_at INTEGER NOT NULL,
        planned_min INTEGER NOT NULL,
        paused_at INTEGER,
        paused_total_s INTEGER NOT NULL DEFAULT 0,
        last_seen_at INTEGER NOT NULL,
        due_notified INTEGER NOT NULL DEFAULT 0,
        then_title TEXT,
        then_min INTEGER,
        ended_at INTEGER,
        end_reason TEXT,
        seconds INTEGER
     );
     CREATE INDEX focus_sessions_start ON focus_sessions(started_at);
     ALTER TABLE plan_events ADD COLUMN dedupe_key TEXT;
     CREATE UNIQUE INDEX plan_events_dedupe ON plan_events(dedupe_key) WHERE dedupe_key IS NOT NULL;
     ALTER TABLE work_log ADD COLUMN event_id INTEGER;",
    // v9: projects kept out of sight (copies, finished work) without touching their folder,
    // projects left out of the calendar, event categories, and where a subject's link comes
    // from (MY Epitech project id, automatic or chosen by hand), with the links refused.
    "ALTER TABLE repo_meta ADD COLUMN visibility TEXT;
     ALTER TABLE plan_projects ADD COLUMN calendar_hidden INTEGER NOT NULL DEFAULT 0;
     CREATE TABLE plan_categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
     );
     ALTER TABLE plan_events ADD COLUMN category TEXT;
     ALTER TABLE subjects ADD COLUMN my_project_id INTEGER;
     ALTER TABLE subjects ADD COLUMN link_source TEXT;
     ALTER TABLE subjects ADD COLUMN main INTEGER NOT NULL DEFAULT 0;
     CREATE TABLE subject_rejects (
        subject_id INTEGER NOT NULL,
        repo_path TEXT NOT NULL,
        PRIMARY KEY (subject_id, repo_path)
     );",
    // v-lab: Code Playground drafts (files and settings as JSON; closed tabs stay as history).
    "CREATE TABLE playground_drafts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        files TEXT NOT NULL,
        settings TEXT NOT NULL,
        open INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
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

/// Schema version this build writes (`PRAGMA user_version` once migrated).
pub fn schema_version() -> usize {
    MIGRATIONS.len()
}

/// What happened to the database when the app started.
#[derive(Debug, Clone, PartialEq)]
pub enum Opened {
    Fine,
    /// The file could not be read as a database: it was set aside under this name and a new one started.
    Recovered(PathBuf),
}

/// Opens the app's database at start. A database made by a newer Tekboard is left as it is
/// (error `db_newer`); an unreadable one is renamed `tekboard.db.corrupt-<date>`, never deleted,
/// and a fresh one is started.
pub fn open_at_start(path: &Path) -> Result<(Connection, Opened)> {
    match open_checked(path) {
        Ok(conn) => Ok((conn, Opened::Fine)),
        Err(e) if e.code() == "db_newer" => Err(e),
        Err(e) if e.code() == "db_corrupt" => {
            let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
            let aside = path.with_file_name(format!("{}.corrupt-{stamp}", path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()));
            std::fs::rename(path, &aside)?;
            for suffix in ["-wal", "-shm"] {
                let side = PathBuf::from(format!("{}{suffix}", path.display()));
                if side.exists() {
                    let _ = std::fs::rename(&side, PathBuf::from(format!("{}{suffix}", aside.display())));
                }
            }
            Ok((open(path)?, Opened::Recovered(aside)))
        }
        Err(e) => Err(e),
    }
}

fn open_checked(path: &Path) -> Result<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let corrupt = |_: rusqlite::Error| AppError::new("db_corrupt", "Base de données illisible");
    let conn = Connection::open(path).map_err(corrupt)?;
    let check: String = conn.query_row("PRAGMA quick_check", [], |r| r.get(0)).map_err(corrupt)?;
    if check != "ok" {
        return Err(AppError::new("db_corrupt", "Base de données abîmée"));
    }
    let version = conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0)).map_err(corrupt)? as usize;
    if version > MIGRATIONS.len() {
        return Err(AppError::new("db_newer", "Ces données ont été écrites par une version plus récente de Tekboard. Installe la dernière version (github.com/ar-oxyo/tekboard-desktop/releases) : tes données sont intactes."));
    }
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
    /// `hidden` (a copy, a zombie: out of every list and of the matching with MY Epitech) or
    /// `archived` (kept, out of the everyday lists). `None` = shown. The folder is never touched.
    pub visibility: Option<String>,
}

pub const VISIBILITIES: &[&str] = &["hidden", "archived"];

pub const STATUSES: &[&str] = &["todo", "in_progress", "done"];

pub fn all_meta(conn: &Connection) -> Result<HashMap<String, RepoMeta>> {
    let mut stmt = conn.prepare("SELECT path, favorite, archived, last_opened_at, deadline, deadline_at, deadline_source, status, kind_override, my_project_id, run_bin, run_args, visibility FROM repo_meta")?;
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
                visibility: r.get(12)?,
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

pub fn set_visibility(conn: &Connection, path: &str, visibility: Option<&str>) -> Result<()> {
    conn.execute("INSERT INTO repo_meta (path, visibility) VALUES (?1, ?2) ON CONFLICT(path) DO UPDATE SET visibility = excluded.visibility", params![path, visibility])?;
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
    /// MY Epitech project the document was downloaded from.
    pub my_project_id: Option<i64>,
    /// `manual` (chosen by the user: never changed automatically), `auto`, or `None`.
    pub link_source: Option<String>,
    /// The project's own subject, as opposed to a bootstrap or an annex.
    pub main: bool,
}

fn subject_from_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Subject> {
    Ok(Subject { id: r.get(0)?, name: r.get(1)?, file: r.get(2)?, hash: r.get(3)?, size: r.get(4)?, repo_path: r.get(5)?, added_at: r.get(6)?, my_project_id: r.get(7)?, link_source: r.get(8)?, main: r.get::<_, i64>(9)? != 0 })
}

const SUBJECT_COLS: &str = "id, name, file, hash, size, repo_path, added_at, my_project_id, link_source, main";

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

/// A link the user made or undid by hand: automatic matching leaves it alone from now on.
/// Unlinking also remembers the refused repository so it is not suggested again.
pub fn link_subject_by_hand(conn: &Connection, id: i64, repo_path: Option<&str>) -> Result<()> {
    if repo_path.is_none() {
        if let Some(old) = get_subject(conn, id)?.and_then(|s| s.repo_path) {
            conn.execute("INSERT OR IGNORE INTO subject_rejects (subject_id, repo_path) VALUES (?1, ?2)", params![id, old])?;
        }
    } else {
        conn.execute("DELETE FROM subject_rejects WHERE subject_id = ?1 AND repo_path = ?2", params![id, repo_path])?;
    }
    conn.execute("UPDATE subjects SET repo_path = ?2, link_source = 'manual' WHERE id = ?1", params![id, repo_path])?;
    Ok(())
}

pub fn reject_subject_link(conn: &Connection, id: i64, repo_path: &str) -> Result<()> {
    conn.execute("INSERT OR IGNORE INTO subject_rejects (subject_id, repo_path) VALUES (?1, ?2)", params![id, repo_path])?;
    Ok(())
}

pub fn subject_rejects(conn: &Connection) -> Result<Vec<(i64, String)>> {
    let mut st = conn.prepare("SELECT subject_id, repo_path FROM subject_rejects")?;
    let rows = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

/// Where a subject came from on MY Epitech (set at import).
pub fn set_subject_origin(conn: &Connection, id: i64, my_project_id: Option<i64>, main: bool) -> Result<()> {
    conn.execute("UPDATE subjects SET my_project_id = COALESCE(?2, my_project_id), main = MAX(main, ?3) WHERE id = ?1", params![id, my_project_id, main as i64])?;
    Ok(())
}

/// An automatic link: never over a link chosen by hand.
pub fn link_subject_auto(conn: &Connection, id: i64, repo_path: &str) -> Result<bool> {
    let n = conn.execute("UPDATE subjects SET repo_path = ?2, link_source = 'auto' WHERE id = ?1 AND (link_source IS NULL OR link_source = 'auto') AND repo_path IS NOT ?2", params![id, repo_path])?;
    Ok(n > 0)
}

pub fn delete_subject(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM subject_rejects WHERE subject_id = ?1", [id])?;
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
    #[test]
    fn an_unreadable_database_is_set_aside_and_a_newer_one_left_alone() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("tekboard.db");
        std::fs::write(&path, "this is not sqlite, just some text that is long enough to have a header").unwrap();
        let (conn, opened) = open_at_start(&path).unwrap();
        let Opened::Recovered(aside) = opened else { panic!("not recovered") };
        assert!(aside.is_file() && std::fs::read_to_string(&aside).unwrap().starts_with("this is not sqlite"));
        assert_eq!(conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0)).unwrap() as usize, schema_version());
        drop(conn);
        let newer = tmp.path().join("newer.db");
        let c = Connection::open(&newer).unwrap();
        c.pragma_update(None, "user_version", (schema_version() + 5) as i64).unwrap();
        drop(c);
        assert_eq!(open_at_start(&newer).unwrap_err().code(), "db_newer");
        let c = Connection::open(&newer).unwrap();
        assert_eq!(c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0)).unwrap() as usize, schema_version() + 5);
        assert!(matches!(open_at_start(&path).unwrap().1, Opened::Fine));
    }

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

/// Completes the row written when the job started.
pub fn finish_run(conn: &Connection, id: i64, duration_ms: i64, status: &str, summary: &str, log: &str) -> Result<()> {
    conn.execute("UPDATE runs SET duration_ms = ?2, status = ?3, summary = ?4, log = ?5 WHERE id = ?1", params![id, duration_ms, status, summary, log])?;
    Ok(())
}

/// Runs still marked `running` when the app starts were cut short (crash, app closed).
pub fn mark_interrupted(conn: &Connection) -> Result<usize> {
    Ok(conn.execute("UPDATE runs SET status = 'interrupted' WHERE status = 'running'", [])?)
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
