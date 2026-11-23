//! What Tika remembers between conversations.
//!
//! A memory is one short fact with a scope (`global`, or `project:<key>`) and a kind. They are
//! searched with SQLite FTS5, so a conversation starts with a handful of relevant lines instead
//! of re-reading files. Rules:
//! - nothing that looks like a secret is ever stored (same detector as the AI package);
//! - before adding, near-duplicates of the same scope and kind are looked for: the caller is
//!   told to update the existing memory instead of piling up variants;
//! - `next_step` memories expire after 14 days unless refreshed; a project's memories are
//!   archived (not deleted) when the project is done;
//! - the user can list, edit, pin and delete every memory.

use crate::error::{AppError, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

pub const KINDS: &[(&str, &str)] = &[
    ("preference", "Préférence"),
    ("goal", "Objectif"),
    ("constraint", "Contrainte"),
    ("decision", "Décision technique"),
    ("difficulty", "Difficulté"),
    ("next_step", "Prochaine étape"),
    ("fact", "Fait"),
    ("test_report", "Rapport de tests"),
];

const MAX_CONTENT: usize = 600;
const NEXT_STEP_TTL: i64 = 14 * 86_400;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Memory {
    pub id: i64,
    pub scope: String,
    pub kind: String,
    pub content: String,
    pub source: String,
    pub pinned: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_used_at: Option<i64>,
    pub expires_at: Option<i64>,
    pub archived: bool,
}

const COLS: &str = "id, scope, kind, content, source, pinned, created_at, updated_at, last_used_at, expires_at, archived";

fn row(r: &rusqlite::Row) -> rusqlite::Result<Memory> {
    Ok(Memory {
        id: r.get(0)?,
        scope: r.get(1)?,
        kind: r.get(2)?,
        content: r.get(3)?,
        source: r.get(4)?,
        pinned: r.get::<_, i64>(5)? != 0,
        created_at: r.get(6)?,
        updated_at: r.get(7)?,
        last_used_at: r.get(8)?,
        expires_at: r.get(9)?,
        archived: r.get::<_, i64>(10)? != 0,
    })
}

pub fn project_scope(key: &str) -> String {
    format!("project:{key}")
}

fn check_scope(scope: &str) -> Result<()> {
    if scope == "global" || scope.strip_prefix("project:").is_some_and(|k| !k.trim().is_empty()) {
        Ok(())
    } else {
        Err(AppError::new("invalid_memory", "Portée inconnue : « global » ou « project:<clé> »."))
    }
}

fn check(kind: &str, content: &str) -> Result<String> {
    if !KINDS.iter().any(|(k, _)| *k == kind) {
        return Err(AppError::new("invalid_memory", format!("Type de souvenir inconnu : {kind}. Types : {}.", KINDS.iter().map(|(k, _)| *k).collect::<Vec<_>>().join(", "))));
    }
    let c = content.trim();
    if c.is_empty() {
        return Err(AppError::new("invalid_memory", "Un souvenir vide n'a pas de sens."));
    }
    if c.chars().count() > MAX_CONTENT {
        return Err(AppError::new("invalid_memory", format!("Un souvenir tient en {MAX_CONTENT} caractères au plus : résume-le.")));
    }
    if let Some(what) = crate::packager::secret_in(c).or_else(|| looks_like_credential(c)) {
        return Err(AppError::new("secret_refused", format!("Refusé : ce texte ressemble à un secret ({what}). TekBoard ne garde jamais de mots de passe, jetons ou clés.")));
    }
    Ok(c.to_string())
}

/// Plain-language credentials the token detector does not catch.
fn looks_like_credential(text: &str) -> Option<&'static str> {
    let l = text.to_lowercase();
    for w in ["password:", "password =", "mot de passe :", "mot de passe:", "mdp:", "mdp :", "passwd", "bearer ey", "token: ey", "authorization:"] {
        if l.contains(w) {
            return Some("identifiant");
        }
    }
    // A JWT pasted as is.
    if text.split_whitespace().any(|w| w.starts_with("eyJ") && w.matches('.').count() == 2 && w.len() > 40) {
        return Some("jeton JWT");
    }
    None
}

fn expiry(kind: &str, now: i64) -> Option<i64> {
    (kind == "next_step").then_some(now + NEXT_STEP_TTL)
}

/// Words worth matching in FTS (quotes stripped: the query is built, never passed through).
fn fts_query(text: &str) -> Option<String> {
    let words: Vec<String> = text
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.chars().count() >= 3)
        .take(12)
        .map(|w| format!("\"{}\"", w.to_lowercase()))
        .collect();
    (!words.is_empty()).then(|| words.join(" OR "))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum Added {
    Saved { memory: Memory },
    /// Something very close exists: update it instead (`update`), or confirm with `force`.
    Similar { similar: Vec<Memory> },
}

pub fn add(conn: &Connection, scope: &str, kind: &str, content: &str, source: &str, pinned: bool, force: bool, now: i64) -> Result<Added> {
    check_scope(scope)?;
    let content = check(kind, content)?;
    if !force {
        let similar: Vec<Memory> = search(conn, &content, Some(scope), 5, now)?.into_iter().filter(|m| m.kind == kind && overlap(&m.content, &content) >= 0.6).collect();
        if !similar.is_empty() {
            return Ok(Added::Similar { similar });
        }
    }
    conn.execute(
        "INSERT INTO ai_memories (scope, kind, content, source, pinned, created_at, updated_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7)",
        params![scope, kind, content, source, pinned as i64, now, expiry(kind, now)],
    )?;
    let id = conn.last_insert_rowid();
    Ok(Added::Saved { memory: get(conn, id)?.ok_or_else(|| AppError::new("not_found", "Souvenir introuvable"))? })
}

/// Share of the words of the shorter text found in the other.
fn overlap(a: &str, b: &str) -> f64 {
    let words = |s: &str| s.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| w.len() >= 3).map(str::to_string).collect::<std::collections::HashSet<_>>();
    let (wa, wb) = (words(a), words(b));
    let (small, big) = if wa.len() <= wb.len() { (&wa, &wb) } else { (&wb, &wa) };
    if small.is_empty() {
        return 0.0;
    }
    small.iter().filter(|w| big.contains(*w)).count() as f64 / small.len() as f64
}

pub fn get(conn: &Connection, id: i64) -> Result<Option<Memory>> {
    Ok(conn.query_row(&format!("SELECT {COLS} FROM ai_memories WHERE id = ?1"), [id], row).optional()?)
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Patch {
    pub content: Option<String>,
    pub kind: Option<String>,
    pub pinned: Option<bool>,
    pub archived: Option<bool>,
}

pub fn update(conn: &Connection, id: i64, p: &Patch, now: i64) -> Result<Memory> {
    let m = get(conn, id)?.ok_or_else(|| AppError::new("not_found", format!("Aucun souvenir n°{id}.")))?;
    let kind = p.kind.clone().unwrap_or(m.kind.clone());
    let content = match &p.content {
        Some(c) => check(&kind, c)?,
        None => check(&kind, &m.content)?,
    };
    let refreshed = p.content.is_some() || p.kind.is_some();
    conn.execute(
        "UPDATE ai_memories SET content = ?2, kind = ?3, pinned = ?4, archived = ?5, updated_at = ?6, expires_at = CASE WHEN ?7 THEN ?8 ELSE expires_at END WHERE id = ?1",
        params![id, content, kind, p.pinned.unwrap_or(m.pinned) as i64, p.archived.unwrap_or(m.archived) as i64, now, refreshed, expiry(&kind, now)],
    )?;
    get(conn, id)?.ok_or_else(|| AppError::new("not_found", "Souvenir introuvable"))
}

pub fn delete(conn: &Connection, id: i64) -> Result<Option<Memory>> {
    let m = get(conn, id)?;
    conn.execute("DELETE FROM ai_memories WHERE id = ?1", [id])?;
    Ok(m)
}

/// Restores a deleted memory with its id (undo).
pub fn restore(conn: &Connection, m: &Memory) -> Result<()> {
    conn.execute(
        &format!("INSERT OR REPLACE INTO ai_memories ({COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)"),
        params![m.id, m.scope, m.kind, m.content, m.source, m.pinned as i64, m.created_at, m.updated_at, m.last_used_at, m.expires_at, m.archived as i64],
    )?;
    Ok(())
}

fn live(now: i64) -> String {
    format!("archived = 0 AND (expires_at IS NULL OR expires_at > {now})")
}

/// Most relevant memories for `query`, in `scope` (and always the global ones when a project
/// scope is given). Marks them as used.
pub fn search(conn: &Connection, query: &str, scope: Option<&str>, limit: u32, now: i64) -> Result<Vec<Memory>> {
    let scopes: Vec<String> = match scope {
        Some(s) if s != "global" => vec![s.to_string(), "global".into()],
        Some(s) => vec![s.to_string()],
        None => vec![],
    };
    let scope_sql = if scopes.is_empty() { "1".to_string() } else { format!("m.scope IN ({})", scopes.iter().map(|s| format!("'{}'", s.replace('\'', "''"))).collect::<Vec<_>>().join(",")) };
    let found: Vec<Memory> = match fts_query(query) {
        Some(q) => {
            let mut st = conn.prepare(&format!(
                "SELECT {} FROM ai_memories_fts f JOIN ai_memories m ON m.id = f.rowid WHERE ai_memories_fts MATCH ?1 AND {scope_sql} AND {} ORDER BY m.pinned DESC, bm25(ai_memories_fts) LIMIT ?2",
                COLS.split(", ").map(|c| format!("m.{c}")).collect::<Vec<_>>().join(", "),
                live(now).replace("archived", "m.archived").replace("expires_at", "m.expires_at")
            ))?;
            let rows = st.query_map(params![q, limit], row)?;
            rows.collect::<std::result::Result<_, _>>()?
        }
        None => list(conn, scope, false, now)?.into_iter().take(limit as usize).collect(),
    };
    for m in &found {
        conn.execute("UPDATE ai_memories SET last_used_at = ?2 WHERE id = ?1", params![m.id, now])?;
    }
    Ok(found)
}

/// Every memory of a scope (all scopes when `None`), pinned first then the most recent.
pub fn list(conn: &Connection, scope: Option<&str>, with_archived: bool, now: i64) -> Result<Vec<Memory>> {
    let filter = if with_archived { "1".to_string() } else { live(now) };
    let mut st = conn.prepare(&format!("SELECT {COLS} FROM ai_memories WHERE (?1 IS NULL OR scope = ?1) AND {filter} ORDER BY pinned DESC, updated_at DESC LIMIT 500"))?;
    let rows = st.query_map(params![scope], row)?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

/// The few lines given at the start of every turn: pinned memories and global preferences
/// first, then what was used recently. Bounded in characters (≈ tokens × 4).
pub fn context_lines(conn: &Connection, project: Option<&str>, budget_chars: usize, now: i64) -> Result<Vec<String>> {
    let mut picked: Vec<Memory> = Vec::new();
    let mut st = conn.prepare(&format!(
        "SELECT {COLS} FROM ai_memories WHERE {} AND (scope = 'global' OR scope = ?1) ORDER BY pinned DESC, (kind IN ('preference','goal','constraint')) DESC, (scope = ?1) DESC, COALESCE(last_used_at, updated_at) DESC LIMIT 40",
        live(now)
    ))?;
    let scope = project.map(project_scope).unwrap_or_default();
    for m in st.query_map([&scope], row)? {
        picked.push(m?);
    }
    let mut out = Vec::new();
    let mut used = 0;
    for m in picked {
        let label = KINDS.iter().find(|(k, _)| *k == m.kind).map(|(_, l)| *l).unwrap_or("Fait");
        let where_ = if m.scope == "global" { String::new() } else { format!(" [{}]", short_key(&m.scope["project:".len()..])) };
        let line = format!("#{} {label}{where_} : {}", m.id, m.content);
        if used + line.len() > budget_chars {
            break;
        }
        used += line.len();
        out.push(line);
    }
    Ok(out)
}

fn short_key(key: &str) -> String {
    key.rsplit('/').next().unwrap_or(key).to_string()
}

/// A project is done: its memories stay for reference but leave the context.
pub fn archive_project(conn: &Connection, key: &str) -> Result<usize> {
    Ok(conn.execute("UPDATE ai_memories SET archived = 1 WHERE scope = ?1 AND archived = 0", [project_scope(key)])?)
}

/// Forgets expired temporary memories for good (they were already out of the context).
pub fn purge_expired(conn: &Connection, now: i64) -> Result<usize> {
    Ok(conn.execute("DELETE FROM ai_memories WHERE expires_at IS NOT NULL AND expires_at <= ?1 - 30 * 86400 AND pinned = 0", [now])?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn saved(a: Added) -> Memory {
        match a {
            Added::Saved { memory } => memory,
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn search_finds_by_words_and_scope() {
        let c = crate::db::open_in_memory().unwrap();
        saved(add(&c, "global", "preference", "Je préfère travailler le matin, pas après 22 h", "user", false, false, 100).unwrap());
        saved(add(&c, "project:/p/my_rpg", "decision", "Rendu avec CSFML, sprites dans assets/", "assistant", false, false, 100).unwrap());
        saved(add(&c, "project:/p/other", "decision", "Utiliser une liste chaînée pour les sprites", "assistant", false, false, 100).unwrap());
        let r = search(&c, "sprites rendu", Some("project:/p/my_rpg"), 5, 200).unwrap();
        assert_eq!(r.len(), 1, "other projects stay out: {r:?}");
        assert!(r[0].content.contains("CSFML"));
        assert_eq!(get(&c, r[0].id).unwrap().unwrap().last_used_at, Some(200));
        // Accents do not matter.
        assert_eq!(search(&c, "prefere matin", None, 5, 200).unwrap().len(), 1);
    }

    #[test]
    fn near_duplicates_are_reported_instead_of_piled_up() {
        let c = crate::db::open_in_memory().unwrap();
        saved(add(&c, "global", "preference", "Pas de travail le dimanche", "user", false, false, 1).unwrap());
        match add(&c, "global", "preference", "Pas de travail le dimanche matin", "assistant", false, false, 2).unwrap() {
            Added::Similar { similar } => assert_eq!(similar.len(), 1),
            other => panic!("{other:?}"),
        }
        saved(add(&c, "global", "preference", "Pas de travail le dimanche matin", "assistant", false, true, 2).unwrap());
    }

    #[test]
    fn secrets_are_refused() {
        let c = crate::db::open_in_memory().unwrap();
        for bad in ["mon token ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "Mot de passe : hunter2", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"] {
            assert_eq!(add(&c, "global", "fact", bad, "assistant", false, true, 1).unwrap_err().code(), "secret_refused", "{bad}");
        }
        assert!(add(&c, "nowhere", "fact", "x", "user", false, true, 1).is_err());
        assert!(add(&c, "global", "mood", "x", "user", false, true, 1).is_err());
    }

    #[test]
    fn next_steps_expire_and_done_projects_leave_the_context() {
        let c = crate::db::open_in_memory().unwrap();
        let m = saved(add(&c, "project:/p/a", "next_step", "Écrire les tests du parseur", "assistant", false, false, 0).unwrap());
        assert_eq!(m.expires_at, Some(NEXT_STEP_TTL));
        assert_eq!(context_lines(&c, Some("/p/a"), 2000, 10).unwrap().len(), 1);
        assert!(context_lines(&c, Some("/p/a"), 2000, NEXT_STEP_TTL + 1).unwrap().is_empty(), "expired");
        // Refreshing the content pushes the expiry.
        let m = update(&c, m.id, &Patch { content: Some("Écrire les tests du parseur et du lexer".into()), ..Default::default() }, 100).unwrap();
        assert_eq!(m.expires_at, Some(100 + NEXT_STEP_TTL));
        saved(add(&c, "project:/p/a", "decision", "Parseur récursif descendant", "assistant", false, false, 100).unwrap());
        assert_eq!(archive_project(&c, "/p/a").unwrap(), 2);
        assert!(context_lines(&c, Some("/p/a"), 2000, 200).unwrap().is_empty());
        assert_eq!(list(&c, None, true, 200).unwrap().len(), 2, "archived, not deleted");
    }

    #[test]
    fn context_is_bounded_and_pinned_first() {
        let c = crate::db::open_in_memory().unwrap();
        for i in 0..30 {
            saved(add(&c, "global", "fact", &format!("Fait numéro {i} sans rapport avec la suite {i}"), "assistant", false, true, i).unwrap());
        }
        let pinned = saved(add(&c, "global", "goal", "Valider le module C cette année", "user", true, false, 0).unwrap());
        let lines = context_lines(&c, None, 300, 100).unwrap();
        assert!(lines[0].starts_with(&format!("#{} Objectif", pinned.id)), "{lines:?}");
        assert!(lines.iter().map(|l| l.len()).sum::<usize>() <= 300);
        let d = delete(&c, pinned.id).unwrap().unwrap();
        assert!(get(&c, pinned.id).unwrap().is_none());
        restore(&c, &d).unwrap();
        assert_eq!(search(&c, "module année", None, 3, 100).unwrap()[0].id, pinned.id, "restored and searchable again");
    }
}
