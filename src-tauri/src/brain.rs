//! Brain Dump: ideas written in a few seconds, organised later.
//!
//! A capture is a row of `tasks` (see `planner`): `idea` while it waits in the inbox, then
//! `task` (it joins the planning), `note` (kept) or `snippet` (kept code). Converting one
//! never copies it. The full text lives in `notes`, `title` is its first line; pin, tags,
//! archive and the detected type are only written here, never by `planner::save_task`.
//!
//! Saving is local and instant: the type and tags are found by plain rules, never by a model.
//! Pasted images are files of the data folder (`captures/<id>.<ext>`), referenced in the text
//! as `capture:<id>`.

use crate::error::{AppError, Result};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const KINDS: &[&str] = &["idea", "note", "snippet", "task"];
pub const CTYPES: &[&str] = &["idea", "bug", "improvement", "question", "code", "command", "link", "task", "info", "image"];
const MAX_TEXT: usize = 20_000;
const MAX_IMAGE: usize = 10 * 1024 * 1024;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Capture {
    pub id: i64,
    pub title: String,
    /// The whole text for a capture, the details for a task.
    pub text: String,
    pub project: Option<String>,
    pub kind: String,
    pub ctype: String,
    pub tags: Vec<String>,
    pub pinned: bool,
    pub archived_at: Option<i64>,
    pub done_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: Option<i64>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Filter {
    /// `inbox`, `pinned`, `notes`, `snippets`, `archived`, `all` (tasks included).
    pub view: String,
    /// Words, `#tag`, `projet:x`, `type:x`, `date:aaaa-mm-jj`, `aujourd'hui`, `hier`, `semaine`.
    pub query: String,
    pub project: Option<String>,
    pub limit: Option<i64>,
}

fn invalid(what: &str) -> AppError {
    AppError::new("invalid_capture", what)
}

const COLS: &str = "id, title, notes, project, kind, ctype, tags, pinned, archived_at, done_at, created_at, updated_at";

fn row(r: &rusqlite::Row) -> rusqlite::Result<Capture> {
    let tags: String = r.get(6)?;
    Ok(Capture { id: r.get(0)?, title: r.get(1)?, text: r.get(2)?, project: r.get(3)?, kind: r.get(4)?, ctype: r.get(5)?, tags: tags.split_whitespace().map(str::to_string).collect(), pinned: r.get::<_, i64>(7)? != 0, archived_at: r.get(8)?, done_at: r.get(9)?, created_at: r.get(10)?, updated_at: r.get(11)? })
}

// ───────────────────────────── local rules ─────────────────────────────

/// First meaningful line, without Markdown markers, at most 120 characters.
pub fn title_of(text: &str) -> String {
    let mut in_code = false;
    let mut first_code = None;
    for line in text.lines() {
        let l = line.trim();
        if l.starts_with("```") {
            in_code = !in_code;
            continue;
        }
        if l.is_empty() {
            continue;
        }
        if in_code {
            first_code.get_or_insert(l);
            continue;
        }
        let l = l.trim_start_matches(['#', '>', '-', '*', ' ']).trim_start_matches("[ ]").trim_start_matches("[x]").trim();
        let l = l.strip_prefix("$ ").unwrap_or(l);
        if !l.is_empty() && !l.starts_with("![](capture:") {
            return cut(l, 120);
        }
    }
    match first_code {
        Some(c) => cut(c, 120),
        None if text.contains("capture:") => "Image".into(),
        None => "Capture".into(),
    }
}

fn cut(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        format!("{}…", s.chars().take(n - 1).collect::<String>().trim_end())
    }
}

const PREPROCESSOR: &[&str] = &["include", "define", "undef", "if", "ifdef", "ifndef", "elif", "else", "endif", "pragma", "error", "warning", "line"];

/// `#tags` written in the text (outside code), lowercase, without duplicates.
pub fn tags_of(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut in_code = false;
    for line in text.lines() {
        if line.trim_start().starts_with("```") {
            in_code = !in_code;
            continue;
        }
        if in_code {
            continue;
        }
        let chars: Vec<char> = line.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            let starts = chars[i] == '#' && (i == 0 || chars[i - 1].is_whitespace() || chars[i - 1] == '(');
            if starts && chars.get(i + 1).is_some_and(|c| c.is_alphabetic()) {
                let mut j = i + 1;
                while j < chars.len() && (chars[j].is_alphanumeric() || chars[j] == '-' || chars[j] == '_') {
                    j += 1;
                }
                let tag: String = chars[i + 1..j].iter().collect::<String>().to_lowercase();
                if tag.chars().count() <= 40 && !PREPROCESSOR.contains(&tag.as_str()) && !out.contains(&tag) {
                    out.push(tag);
                }
                i = j;
            } else {
                i += 1;
            }
        }
    }
    out.truncate(20);
    out
}

fn clean_tag(t: &str) -> Option<String> {
    let t: String = t.trim().trim_start_matches('#').to_lowercase().chars().filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_').take(40).collect();
    (!t.is_empty()).then_some(t)
}

/// Lowercase, without accents (enough for French).
pub fn fold(s: &str) -> String {
    s.chars()
        .flat_map(|c| c.to_lowercase())
        .map(|c| match c {
            'à' | 'â' | 'ä' | 'á' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'î' | 'ï' | 'í' => 'i',
            'ô' | 'ö' | 'ó' => 'o',
            'ù' | 'û' | 'ü' | 'ú' => 'u',
            'ç' => 'c',
            'ÿ' => 'y',
            c => c,
        })
        .collect()
}

const COMMANDS: &[&str] = &["sudo", "git", "make", "gcc", "cc", "clang", "valgrind", "gdb", "cd", "ls", "rm", "cp", "mv", "mkdir", "chmod", "chown", "grep", "find", "sed", "awk", "cat", "tar", "curl", "wget", "ssh", "scp", "docker", "npm", "npx", "cargo", "pip", "python3", "apt", "dnf", "pacman", "systemctl", "journalctl", "kill", "ps", "top", "export", "echo", "tail", "head", "xargs", "man", "./"];

fn has_url(s: &str) -> bool {
    s.contains("http://") || s.contains("https://")
}

fn words(s: &str) -> Vec<String> {
    fold(s).split(|c: char| !c.is_alphanumeric() && c != '\'').filter(|w| !w.is_empty()).map(str::to_string).collect()
}

/// What a capture looks like, found by plain rules (no model). Always one of `CTYPES`.
pub fn detect(text: &str) -> &'static str {
    let t = text.trim();
    if t.is_empty() {
        return "idea";
    }
    let without_images: String = t.lines().filter(|l| !l.trim().starts_with("![](capture:")).collect::<Vec<_>>().join("\n");
    if without_images.trim().is_empty() && t.contains("capture:") {
        return "image";
    }
    let t = without_images.trim();
    if t.contains("```") {
        return "code";
    }
    let lines: Vec<&str> = t.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    let first = lines.first().copied().unwrap_or("");
    let head = first.trim_start_matches("$ ").split_whitespace().next().unwrap_or("");
    if first.starts_with("$ ") || (lines.len() <= 3 && (COMMANDS.contains(&head) || head.starts_with("./")) && !first.ends_with('?')) {
        return "command";
    }
    let symbols = t.chars().filter(|c| matches!(c, ';' | '{' | '}')).count();
    if lines.len() >= 2 && symbols * 12 >= t.chars().count().max(1) / 4 && symbols >= 3 {
        return "code";
    }
    if lines.len() == 1 && has_url(first) && first.split_whitespace().count() <= 3 {
        return "link";
    }
    let w = words(t);
    let starts = |list: &[&str]| w.first().is_some_and(|x| list.contains(&x.as_str()));
    let any = |list: &[&str]| w.iter().any(|x| list.contains(&x.as_str()));
    if any(&["bug", "bugs", "crash", "crashe", "segfault", "segv", "plante", "fuite", "leak", "leaks", "erreur", "error", "broken", "casse", "fix", "corriger"]) {
        return "bug";
    }
    if first.starts_with("- [ ]") || first.starts_with("[ ]") || starts(&["todo", "faire", "penser", "rendre", "envoyer", "appeler", "acheter", "finir", "terminer", "installer", "configurer", "reviser", "preparer", "lire", "ecrire", "tester", "relire"]) || fold(first).starts_with("ne pas oublier") || fold(first).starts_with("il faut") {
        return "task";
    }
    if starts(&["ameliorer", "ajouter", "optimiser", "refactor", "refactoriser", "simplifier", "accelerer", "nettoyer", "improve", "add"]) {
        return "improvement";
    }
    if first.ends_with('?') || lines.iter().any(|l| l.ends_with('?')) || starts(&["comment", "pourquoi", "quand", "combien", "est-ce", "quel", "quelle", "quels", "quelles", "how", "why", "what"]) {
        return "question";
    }
    if has_url(t) {
        return "link";
    }
    if starts(&["info", "note", "rappel", "retenir", "astuce", "tip"]) || fold(first).starts_with("a retenir") {
        return "info";
    }
    "idea"
}

/// Language of the first code block (`c` when none is written), for sharing and the playground.
pub fn code_lang(text: &str) -> Option<String> {
    let l = text.lines().map(str::trim).find(|l| l.starts_with("```"))?;
    let lang: String = l.trim_start_matches('`').trim().chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '+').collect();
    Some(if lang.is_empty() { "c".into() } else { lang.to_lowercase() })
}

/// Ids of the images a text references.
pub fn image_refs(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(i) = rest.find("capture:") {
        rest = &rest[i + 8..];
        let id: String = rest.chars().take_while(|c| c.is_ascii_hexdigit() || *c == '-').collect();
        if valid_image_id(&id) && !out.contains(&id) {
            out.push(id);
        }
    }
    out
}

fn valid_image_id(id: &str) -> bool {
    (8..=64).contains(&id.len()) && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

// ───────────────────────────── reading ─────────────────────────────

pub fn get(conn: &Connection, id: i64) -> Result<Capture> {
    conn.query_row(&format!("SELECT {COLS} FROM tasks WHERE id = ?1"), [id], row).map_err(|_| AppError::new("not_found", "Cette capture n'existe plus"))
}

/// One FTS5 query from free words: every word must appear (prefix match), quoted so that
/// nothing the user types is read as FTS syntax.
fn fts_query(words: &[String]) -> Option<String> {
    let q: Vec<String> = words.iter().map(|w| w.chars().filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-').collect::<String>()).filter(|w| !w.is_empty()).take(12).map(|w| format!("\"{}\"*", w.replace('"', ""))).collect();
    (!q.is_empty()).then(|| q.join(" "))
}

/// Day bounds (local time) for `date:` words.
fn day_range(word: &str, now: i64) -> Option<(i64, i64)> {
    use chrono::{Duration, Local, NaiveDate, TimeZone};
    let today = Local.timestamp_opt(now, 0).single()?.date_naive();
    let w = fold(word);
    let (from, days) = match w.as_str() {
        "aujourd'hui" | "aujourdhui" | "today" => (today, 1),
        "hier" | "yesterday" => (today - Duration::days(1), 1),
        "semaine" | "week" => (today - Duration::days(6), 7),
        "mois" | "month" => (today - Duration::days(29), 30),
        d => (NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()?, 1),
    };
    let start = Local.from_local_datetime(&from.and_hms_opt(0, 0, 0)?).earliest()?.timestamp();
    Some((start, start + days * 86_400))
}

/// The structured part of a search, as written in the box.
#[derive(Debug, Default, PartialEq)]
pub struct Query {
    pub words: Vec<String>,
    pub tags: Vec<String>,
    pub project: Option<String>,
    pub ctype: Option<String>,
    pub range: Option<(i64, i64)>,
}

pub fn parse_query(q: &str, now: i64) -> Query {
    let mut out = Query::default();
    for raw in q.split_whitespace() {
        let lower = raw.to_lowercase();
        if let Some(t) = raw.strip_prefix('#').and_then(clean_tag) {
            out.tags.push(t);
        } else if let Some(p) = lower.strip_prefix("projet:").or_else(|| lower.strip_prefix("project:")).filter(|p| !p.is_empty()) {
            out.project = Some(p.to_string());
        } else if let Some(t) = lower.strip_prefix("type:").filter(|t| !t.is_empty()) {
            out.ctype = Some(t.to_string());
        } else if let Some(r) = lower.strip_prefix("date:").and_then(|d| day_range(d, now)) {
            out.range = Some(r);
        } else if let Some(r) = ["aujourd'hui", "hier", "today", "yesterday"].contains(&lower.as_str()).then(|| day_range(&lower, now)).flatten() {
            out.range = Some(r);
        } else {
            out.words.push(raw.to_string());
        }
    }
    out
}

/// Captures for a view, newest first (pinned ones on top), optionally narrowed by a search.
/// `projet:x` matches the project's path or name loosely (the name is what the user sees).
pub fn list(conn: &Connection, f: &Filter, now: i64) -> Result<Vec<Capture>> {
    let q = parse_query(&f.query, now);
    let mut sql = format!("SELECT {} FROM tasks t", COLS.split(", ").map(|c| format!("t.{c}")).collect::<Vec<_>>().join(", "));
    let mut cond: Vec<String> = Vec::new();
    let mut args: Vec<rusqlite::types::Value> = Vec::new();
    let fts = fts_query(&q.words);
    if let Some(m) = &fts {
        sql.push_str(" JOIN tasks_fts ON tasks_fts.rowid = t.id");
        args.push(m.clone().into());
        cond.push(format!("tasks_fts MATCH ?{}", args.len()));
    }
    match f.view.as_str() {
        "pinned" => cond.push("t.pinned = 1 AND t.archived_at IS NULL AND t.kind IN ('idea', 'note', 'snippet')".into()),
        "notes" => cond.push("t.kind = 'note' AND t.archived_at IS NULL".into()),
        "snippets" => cond.push("t.kind = 'snippet' AND t.archived_at IS NULL".into()),
        "archived" => cond.push("t.archived_at IS NOT NULL".into()),
        "all" => {}
        "kept" => cond.push("t.kind IN ('idea', 'note', 'snippet') AND t.archived_at IS NULL".into()),
        _ => cond.push("t.kind = 'idea' AND t.archived_at IS NULL".into()),
    }
    if let Some(p) = f.project.as_deref().filter(|p| !p.is_empty()) {
        args.push(p.to_string().into());
        cond.push(format!("t.project = ?{}", args.len()));
    }
    if let Some(p) = &q.project {
        args.push(format!("%{}%", p.replace(['%', '_'], "")).into());
        cond.push(format!("LOWER(t.project) LIKE ?{}", args.len()));
    }
    if let Some(c) = &q.ctype {
        args.push(c.clone().into());
        cond.push(format!("(t.ctype = ?{n} OR t.kind = ?{n})", n = args.len()));
    }
    for t in &q.tags {
        args.push(format!("% {t} %").into());
        cond.push(format!("(' ' || t.tags || ' ') LIKE ?{}", args.len()));
    }
    if let Some((a, b)) = q.range {
        args.push(a.into());
        args.push(b.into());
        cond.push(format!("t.created_at >= ?{} AND t.created_at < ?{}", args.len() - 1, args.len()));
    }
    if !cond.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&cond.join(" AND "));
    }
    sql.push_str(if fts.is_some() { " ORDER BY t.pinned DESC, bm25(tasks_fts), t.created_at DESC" } else { " ORDER BY t.pinned DESC, t.created_at DESC, t.id DESC" });
    args.push(f.limit.unwrap_or(200).clamp(1, 500).into());
    sql.push_str(&format!(" LIMIT ?{}", args.len()));
    let mut st = conn.prepare(&sql)?;
    let rows = st.query_map(rusqlite::params_from_iter(args), row)?.collect::<std::result::Result<_, _>>()?;
    Ok(rows)
}

/// Number of captures waiting in the inbox (the small badge).
pub fn inbox_count(conn: &Connection) -> Result<i64> {
    Ok(conn.query_row("SELECT COUNT(*) FROM tasks WHERE kind = 'idea' AND archived_at IS NULL AND done_at IS NULL", [], |r| r.get(0))?)
}

/// Older captures that share words with this one (local search, no model).
pub fn similar(conn: &Connection, id: i64) -> Result<Vec<Capture>> {
    let c = get(conn, id)?;
    let stop = ["dans", "pour", "avec", "sans", "elle", "nous", "vous", "mais", "donc", "quand", "faut", "faire", "penser", "the", "and", "with", "this", "that", "avant", "apres", "plus", "tout", "tous", "cette", "comme"];
    let mut seen = Vec::new();
    for w in words(&c.text) {
        if w.chars().count() >= 4 && !stop.contains(&w.as_str()) && !seen.contains(&w) {
            seen.push(w);
        }
    }
    if seen.is_empty() {
        return Ok(Vec::new());
    }
    let q = seen.iter().take(10).map(|w| format!("\"{}\"", w.replace('"', ""))).collect::<Vec<_>>().join(" OR ");
    let mut st = conn.prepare(&format!("SELECT {} FROM tasks t JOIN tasks_fts ON tasks_fts.rowid = t.id WHERE tasks_fts MATCH ?1 AND t.id != ?2 AND t.kind IN ('idea', 'note', 'snippet', 'task') AND t.done_at IS NULL ORDER BY bm25(tasks_fts) LIMIT 8", COLS.split(", ").map(|c| format!("t.{c}")).collect::<Vec<_>>().join(", ")))?;
    let rows: Vec<Capture> = st.query_map(params![q, id], row)?.collect::<std::result::Result<_, _>>()?;
    // At least two shared words, so that one common word is not enough.
    Ok(rows.into_iter().filter(|o| {
        let ow = words(&o.text);
        seen.iter().filter(|w| ow.contains(w)).count() >= 2.min(seen.len())
    }).take(3).collect())
}

// ───────────────────────────── writing ─────────────────────────────

fn clean_text(text: &str) -> Result<String> {
    let t = text.trim_end();
    if t.trim().is_empty() {
        return Err(invalid("La capture est vide"));
    }
    Ok(t.chars().take(MAX_TEXT).collect())
}

fn clean_project(p: Option<&str>) -> Option<String> {
    p.map(str::trim).filter(|p| !p.is_empty() && p.len() <= 600).map(str::to_string)
}

/// Saves a new capture in the inbox. Nothing is asked: the type and tags are found locally.
pub fn save(conn: &Connection, text: &str, project: Option<&str>, now: i64) -> Result<Capture> {
    let text = clean_text(text)?;
    let tags = tags_of(&text).join(" ");
    conn.execute("INSERT INTO tasks (title, notes, project, kind, ctype, tags, created_at, updated_at) VALUES (?1, ?2, ?3, 'idea', ?4, ?5, ?6, ?6)", params![title_of(&text), text, clean_project(project), detect(&text), tags, now])?;
    get(conn, conn.last_insert_rowid())
}

/// Rewrites the text of a capture (the type, title and written tags follow; tags added by hand stay).
pub fn edit(conn: &Connection, id: i64, text: &str, now: i64) -> Result<Capture> {
    let old = get(conn, id)?;
    let text = clean_text(text)?;
    let old_written = tags_of(&old.text);
    let mut tags: Vec<String> = old.tags.into_iter().filter(|t| !old_written.contains(t)).collect();
    for t in tags_of(&text) {
        if !tags.contains(&t) {
            tags.push(t);
        }
    }
    conn.execute("UPDATE tasks SET title = ?2, notes = ?3, ctype = ?4, tags = ?5, updated_at = ?6 WHERE id = ?1", params![id, title_of(&text), text, detect(&text), tags.join(" "), now])?;
    get(conn, id)
}

/// Changes what a capture is. To a task: the first line becomes its title and the rest its
/// details, so that it reads like any other task. The row stays the same.
pub fn convert(conn: &Connection, id: i64, kind: &str, now: i64) -> Result<Capture> {
    if !KINDS.contains(&kind) {
        return Err(invalid("Type de capture inconnu"));
    }
    let c = get(conn, id)?;
    if kind == "task" && c.kind != "task" {
        let mut lines = c.text.lines();
        let first = lines.next().unwrap_or("").trim();
        let details = if title_of(first) == c.title { lines.collect::<Vec<_>>().join("\n").trim().to_string() } else { c.text.clone() };
        conn.execute("UPDATE tasks SET kind = 'task', notes = ?2, archived_at = NULL, updated_at = ?3 WHERE id = ?1", params![id, details.chars().take(8000).collect::<String>(), now])?;
    } else {
        conn.execute("UPDATE tasks SET kind = ?2, updated_at = ?3 WHERE id = ?1", params![id, kind, now])?;
    }
    get(conn, id)
}

pub fn set_project(conn: &Connection, id: i64, project: Option<&str>, now: i64) -> Result<Capture> {
    conn.execute("UPDATE tasks SET project = ?2, updated_at = ?3 WHERE id = ?1", params![id, clean_project(project), now])?;
    get(conn, id)
}

pub fn set_pinned(conn: &Connection, id: i64, pinned: bool, now: i64) -> Result<Capture> {
    conn.execute("UPDATE tasks SET pinned = ?2, updated_at = ?3 WHERE id = ?1", params![id, pinned as i64, now])?;
    get(conn, id)
}

pub fn set_archived(conn: &Connection, id: i64, archived: bool, now: i64) -> Result<Capture> {
    conn.execute("UPDATE tasks SET archived_at = ?2, pinned = CASE WHEN ?2 IS NULL THEN pinned ELSE 0 END, updated_at = ?3 WHERE id = ?1", params![id, archived.then_some(now), now])?;
    get(conn, id)
}

pub fn set_tags(conn: &Connection, id: i64, tags: &[String], now: i64) -> Result<Capture> {
    let mut out: Vec<String> = Vec::new();
    for t in tags.iter().filter_map(|t| clean_tag(t)) {
        if !out.contains(&t) {
            out.push(t);
        }
    }
    out.truncate(20);
    conn.execute("UPDATE tasks SET tags = ?2, updated_at = ?3 WHERE id = ?1", params![id, out.join(" "), now])?;
    get(conn, id)
}

/// Deletes a capture. Returns it, so that the UI can undo: its images stay until
/// `sweep_images` finds them unused (at the next start).
pub fn delete(conn: &Connection, id: i64) -> Result<Capture> {
    let c = get(conn, id)?;
    crate::planner::delete_task(conn, id)?;
    Ok(c)
}

/// Puts back a deleted capture as it was (undo).
pub fn restore(conn: &Connection, c: &Capture) -> Result<Capture> {
    let kind = if KINDS.contains(&c.kind.as_str()) { c.kind.as_str() } else { "idea" };
    let ctype = if CTYPES.contains(&c.ctype.as_str()) { c.ctype.as_str() } else { "idea" };
    conn.execute("INSERT INTO tasks (title, notes, project, kind, ctype, tags, pinned, archived_at, done_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)", params![cut(&c.title, 200), clean_text(&c.text)?, clean_project(c.project.as_deref()), kind, ctype, c.tags.join(" "), c.pinned as i64, c.archived_at, c.done_at, c.created_at, c.updated_at])?;
    get(conn, conn.last_insert_rowid())
}

// ───────────────────────────── images ─────────────────────────────

fn image_used(conn: &Connection, id: &str) -> Result<bool> {
    Ok(conn.query_row("SELECT EXISTS(SELECT 1 FROM tasks WHERE notes LIKE ?1)", [format!("%capture:{id}%")], |r| r.get::<_, i64>(0))? != 0)
}

fn ext_of(mime: &str) -> Option<&'static str> {
    match mime {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        _ => None,
    }
}

fn find_image(dir: &Path, id: &str) -> Option<(std::path::PathBuf, &'static str)> {
    if !valid_image_id(id) {
        return None;
    }
    ["png", "jpg", "gif", "webp"].into_iter().map(|e| (dir.join(format!("{id}.{e}")), e)).find(|(p, _)| p.is_file())
}

/// Stores a pasted or dropped image (written atomically). Returns its id.
pub fn attach(dir: &Path, mime: &str, bytes: &[u8]) -> Result<String> {
    let ext = ext_of(mime).ok_or_else(|| invalid("Seules les images PNG, JPEG, GIF et WebP sont acceptées"))?;
    if bytes.is_empty() || bytes.len() > MAX_IMAGE {
        return Err(invalid("Image trop lourde (10 Mo au plus)"));
    }
    let magic_ok = match ext {
        "png" => bytes.starts_with(b"\x89PNG"),
        "jpg" => bytes.starts_with(&[0xFF, 0xD8]),
        "gif" => bytes.starts_with(b"GIF8"),
        _ => bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
    };
    if !magic_ok {
        return Err(invalid("Ce fichier n'est pas une image valide"));
    }
    std::fs::create_dir_all(dir)?;
    use sha2::Digest;
    let id: String = format!("{:x}", sha2::Sha256::digest(bytes)).chars().take(32).collect();
    let path = dir.join(format!("{id}.{ext}"));
    if !path.exists() {
        let tmp = dir.join(format!(".{id}.tmp"));
        {
            use std::io::Write;
            let mut f = std::fs::File::create(&tmp)?;
            f.write_all(bytes)?;
            f.sync_all()?;
        }
        std::fs::rename(&tmp, &path)?;
    }
    Ok(id)
}

/// The image as a `data:` URL (the page may show nothing else).
pub fn image_data(dir: &Path, id: &str) -> Result<String> {
    use base64::Engine;
    let (p, ext) = find_image(dir, id).ok_or_else(|| AppError::new("not_found", "Image introuvable"))?;
    let mime = match ext {
        "jpg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        _ => "image/webp",
    };
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(std::fs::read(p)?)))
}

/// Removes images used by no capture any more (a deleted capture, a draft never saved),
/// once they are a day old.
pub fn sweep_images(conn: &Connection, dir: &Path) -> Result<usize> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Ok(0) };
    let mut n = 0;
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let old = e.metadata().and_then(|m| m.modified()).map(|t| t.elapsed().map(|d| d.as_secs() > 86_400).unwrap_or(false)).unwrap_or(false);
        if !old {
            continue;
        }
        if name.starts_with('.') && name.ends_with(".tmp") {
            let _ = std::fs::remove_file(e.path());
            continue;
        }
        let id = name.split('.').next().unwrap_or("");
        if valid_image_id(id) && !image_used(conn, id)? {
            let _ = std::fs::remove_file(e.path());
            n += 1;
        }
    }
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    const NOW: i64 = 1_794_480_000;

    #[test]
    fn rules_find_the_type_without_a_model() {
        for (text, want) in [
            ("Penser à libérer les maillons dans organized avant de quitter le programme", "task"),
            ("- [ ] rendre le rapport", "task"),
            ("segfault quand la liste est vide", "bug"),
            ("Pourquoi malloc renvoie NULL ici", "question"),
            ("Est-ce que fork copie les fd ?", "question"),
            ("$ valgrind --leak-check=full ./a.out", "command"),
            ("git rebase -i HEAD~3", "command"),
            ("https://man7.org/linux/man-pages/man2/fork.2.html", "link"),
            ("```c\nint main(void) { return 0; }\n```", "code"),
            ("int x = 0;\nwhile (x < 3) { x++; }\nreturn x;", "code"),
            ("Améliorer le tri des projets par échéance", "improvement"),
            ("À retenir : le prof accepte les rendus jusqu'à minuit", "info"),
            ("![](capture:0123456789abcdef)", "image"),
            ("Un jeu de cartes en terminal avec ncurses", "idea"),
        ] {
            assert_eq!(detect(text), want, "{text}");
        }
    }

    #[test]
    fn titles_and_tags_come_from_the_text() {
        assert_eq!(title_of("\n# Mon idée\nsuite"), "Mon idée");
        assert_eq!(title_of("```c\n#include <stdio.h>\n```"), "#include <stdio.h>");
        assert_eq!(title_of("$ make re"), "make re");
        assert_eq!(title_of(&"a".repeat(300)).chars().count(), 120);
        assert_eq!(tags_of("Lire #Rust et #rust (#sys-prog)\n```\n#include <x.h>\n#tag_in_code\n```\n#define X"), vec!["rust", "sys-prog"]);
        assert!(tags_of("issue#3 et # titre").is_empty());
        assert_eq!(code_lang("bla\n```Python\nx\n```").as_deref(), Some("python"));
        assert_eq!(code_lang("```\nx\n```").as_deref(), Some("c"));
        assert_eq!(image_refs("![](capture:abcdef0123) et ![](capture:abcdef0123) ![](capture:zz)"), vec!["abcdef0123"]);
    }

    #[test]
    fn captures_stay_out_of_the_planning_and_convert_in_place() {
        let conn = db::open_in_memory().unwrap();
        let idea = save(&conn, "Penser à libérer les maillons\nsinon valgrind râle #organized", None, NOW).unwrap();
        assert_eq!((idea.kind.as_str(), idea.ctype.as_str(), idea.title.as_str()), ("idea", "task", "Penser à libérer les maillons"));
        assert_eq!(idea.tags, vec!["organized"]);
        let note = convert(&conn, save(&conn, "Le prof accepte le C99", None, NOW).unwrap().id, "note", NOW).unwrap();
        let snip = convert(&conn, save(&conn, "```c\nint x;\n```", None, NOW).unwrap().id, "snippet", NOW).unwrap();
        let archived = set_archived(&conn, save(&conn, "vieille idée", None, NOW).unwrap().id, true, NOW).unwrap();
        let ids: Vec<i64> = crate::planner::state(&conn, NOW).unwrap().tasks.iter().map(|t| t.id).collect();
        assert_eq!(ids, vec![idea.id], "notes, snippets and archived captures never reach the planning");
        assert_eq!(inbox_count(&conn).unwrap(), 1);

        // Pin and tags survive an edit made from the planning (which rewrites the whole row).
        set_pinned(&conn, idea.id, true, NOW).unwrap();
        set_tags(&conn, idea.id, &["#Organized".into(), "c".into(), "c".into()], NOW).unwrap();
        let t = crate::planner::get_task(&conn, idea.id).unwrap();
        crate::planner::save_task(&conn, &crate::planner::Task { priority: 2, ..t }, NOW + 1).unwrap();
        let after = get(&conn, idea.id).unwrap();
        assert!(after.pinned);
        assert_eq!(after.tags, vec!["organized", "c"]);

        let task = convert(&conn, idea.id, "task", NOW).unwrap();
        assert_eq!((task.id, task.kind.as_str(), task.title.as_str(), task.text.as_str()), (idea.id, "task", "Penser à libérer les maillons", "sinon valgrind râle #organized"));
        assert_eq!(list(&conn, &Filter::default(), NOW).unwrap().len(), 0, "the inbox is empty now");
        assert_eq!(list(&conn, &Filter { view: "notes".into(), ..Default::default() }, NOW).unwrap(), vec![note]);
        assert_eq!(list(&conn, &Filter { view: "snippets".into(), ..Default::default() }, NOW).unwrap(), vec![snip]);
        assert_eq!(list(&conn, &Filter { view: "archived".into(), ..Default::default() }, NOW).unwrap().len(), 1);
        assert!(convert(&conn, archived.id, "epic", NOW).is_err());
        assert!(save(&conn, "   \n ", None, NOW).is_err());
    }

    #[test]
    fn search_reads_words_tags_projects_types_and_dates() {
        let conn = db::open_in_memory().unwrap();
        let a = save(&conn, "Libérer la mémoire des maillons #leak", Some("/home/me/organized"), NOW).unwrap();
        let b = save(&conn, "Pourquoi fork duplique-t-il les descripteurs ?", None, NOW - 3 * 86_400).unwrap();
        let find = |q: &str| list(&conn, &Filter { view: "all".into(), query: q.into(), ..Default::default() }, NOW).unwrap().iter().map(|c| c.id).collect::<Vec<_>>();
        assert_eq!(find("liberer"), vec![a.id], "accents do not matter");
        assert_eq!(find("mail"), vec![a.id], "prefixes match");
        assert_eq!(find("#leak"), vec![a.id]);
        assert_eq!(find("projet:organized"), vec![a.id]);
        assert_eq!(find("type:question"), vec![b.id]);
        assert_eq!(find("aujourd'hui"), vec![a.id]);
        assert_eq!(find("\" OR * NEAR("), Vec::<i64>::new(), "FTS syntax typed by the user is harmless");
        let c = save(&conn, "Libérer enfin les maillons, la mémoire fuit", None, NOW).unwrap();
        assert_eq!(similar(&conn, c.id).unwrap().iter().map(|x| x.id).collect::<Vec<_>>(), vec![a.id]);
        // An edit keeps the search index right.
        edit(&conn, a.id, "Autre chose #misc", NOW).unwrap();
        assert!(find("maillons").iter().all(|id| *id != a.id));
        assert_eq!(get(&conn, a.id).unwrap().tags, vec!["misc"]);
    }

    #[test]
    fn images_are_checked_stored_and_removed_with_their_capture() {
        let conn = db::open_in_memory().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let png = b"\x89PNG\r\n\x1a\nrest";
        assert!(attach(dir.path(), "image/png", b"not a png").is_err());
        assert!(attach(dir.path(), "text/html", png).is_err());
        let id = attach(dir.path(), "image/png", png).unwrap();
        assert!(image_data(dir.path(), &id).unwrap().starts_with("data:image/png;base64,"));
        assert!(image_data(dir.path(), "../../etc/passwd").is_err());
        let a = save(&conn, &format!("schéma\n![](capture:{id})"), None, NOW).unwrap();
        let gone = delete(&conn, a.id).unwrap();
        assert!(find_image(dir.path(), &id).is_some(), "kept until the sweep, so that undo works");
        assert_eq!(sweep_images(&conn, dir.path()).unwrap(), 0, "too recent to be swept");
        let back = restore(&conn, &gone).unwrap();
        assert_eq!((back.text, back.created_at), (gone.text, gone.created_at));
        assert!(image_used(&conn, &id).unwrap());
    }
}
