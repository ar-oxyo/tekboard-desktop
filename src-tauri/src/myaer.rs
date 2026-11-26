//! The AER account: some students also hold a separate MY Epitech account for their AER work.
//! It is connected next to the student one, never instead of it: its own sign-in window and
//! browser folder, its own token in memory, its own cached answers (`my_cache_aer`) and sync
//! history (`my_aer_log`). Only what the AER side is used for is read: who the account is and
//! the sessions it is registered to (its timetable), which the planning can show beside the
//! student's. The student's data, deadlines and repositories never come from it.

use crate::error::Result;
use crate::myepitech::{Fetched, SyncReport, SyncRow};
use rusqlite::{params, Connection};
use serde_json::Value;

pub const WINDOW: &str = "my-epitech-aer";
pub const SESSION_DIR: &str = "my-session-aer";
pub const ROUTES: &[(&str, &str)] = &[("/auth/verify", "Account"), (crate::mydata::MY_EVENTS, "Sessions of the AER account")];

pub fn routes() -> Vec<&'static str> {
    ROUTES.iter().map(|(r, _)| *r).collect()
}

/// Stores an AER sync. A failed route keeps its previous good answer.
pub fn store(conn: &Connection, fetched: &[Fetched], now: i64) -> Result<SyncReport> {
    let mut ok = 0;
    let mut problems = Vec::new();
    for f in fetched {
        if (200..300).contains(&f.status) {
            ok += 1;
            conn.execute("INSERT INTO my_cache_aer (route, fetched_at, status, body) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(route) DO UPDATE SET fetched_at = excluded.fetched_at, status = excluded.status, body = excluded.body", params![f.route, now, f.status, f.body])?;
        } else {
            problems.push(format!("{} → {}", f.route, if f.status == 0 { "no answer".to_string() } else { f.status.to_string() }));
            conn.execute("INSERT INTO my_cache_aer (route, fetched_at, status, body) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(route) DO NOTHING", params![f.route, now, f.status, f.body])?;
        }
    }
    let unauthorized = fetched.first().is_some_and(|f| f.status == 401);
    let detail = problems.join("; ");
    conn.execute("INSERT INTO my_aer_log (at, ok, failed, detail) VALUES (?1, ?2, ?3, ?4)", params![now, ok as i64, problems.len() as i64, detail])?;
    Ok(SyncReport { ok, failed: problems.len(), unauthorized, detail, subjects_imported: 0, subjects_linked: 0, subjects_to_confirm: 0 })
}

pub fn last_sync(conn: &Connection) -> Option<i64> {
    conn.query_row("SELECT MAX(at) FROM my_aer_log", [], |r| r.get(0)).ok().flatten()
}

pub fn history(conn: &Connection, limit: u32) -> Result<Vec<SyncRow>> {
    let mut st = conn.prepare("SELECT at, ok, failed, detail FROM my_aer_log ORDER BY at DESC LIMIT ?1")?;
    let rows = st.query_map([limit], |r| Ok(SyncRow { at: r.get(0)?, ok: r.get(1)?, failed: r.get(2)?, detail: r.get(3)? }))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

/// The cached sessions of the AER account, when a sync read them.
pub fn events(conn: &Connection) -> Option<Value> {
    let body: String = conn.query_row("SELECT body FROM my_cache_aer WHERE route = ?1 AND status BETWEEN 200 AND 299", [crate::mydata::MY_EVENTS], |r| r.get(0)).ok()?;
    serde_json::from_str(&body).ok()
}

/// Forgets the AER account's answers and history (its session folder is removed by the caller).
pub fn clear(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM my_cache_aer", [])?;
    conn.execute("DELETE FROM my_aer_log", [])?;
    Ok(())
}

/// Which agendas the planning shows (Planning → filters), saved with the interface
/// preferences (`plan.sources`). Read here too, so Artix plans with the same ones.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Sources {
    pub student: bool,
    pub aer: bool,
}

pub fn sources(conn: &Connection) -> Sources {
    let prefs: Value = crate::db::get_setting(conn, "ui_prefs").ok().flatten().and_then(|v| serde_json::from_str(&v).ok()).unwrap_or_default();
    let s = &prefs["plan.sources"];
    Sources { student: s["student"].as_bool().unwrap_or(true), aer: s["aer"].as_bool().unwrap_or(true) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn the_aer_account_is_cached_apart_and_keeps_good_answers() {
        let conn = db::open_in_memory().unwrap();
        let good = [Fetched { route: "/auth/verify".into(), status: 200, body: "{}".into() }, Fetched { route: crate::mydata::MY_EVENTS.into(), status: 200, body: "[{\"id\":1}]".into() }];
        let r = store(&conn, &good, 10).unwrap();
        assert_eq!((r.ok, r.failed), (2, 0));
        let student: i64 = conn.query_row("SELECT COUNT(*) FROM my_cache", [], |r| r.get(0)).unwrap();
        assert_eq!(student, 0, "nothing lands in the student's cache");
        // A failed sync keeps what was read before.
        store(&conn, &[Fetched { route: "/auth/verify".into(), status: 200, body: "{}".into() }, Fetched { route: crate::mydata::MY_EVENTS.into(), status: 500, body: String::new() }], 20).unwrap();
        assert_eq!(events(&conn).unwrap()[0]["id"], 1);
        assert_eq!(last_sync(&conn), Some(20));
        clear(&conn).unwrap();
        assert!(events(&conn).is_none() && last_sync(&conn).is_none());
    }

    #[test]
    fn both_agendas_are_shown_until_one_is_switched_off() {
        let conn = db::open_in_memory().unwrap();
        assert_eq!(sources(&conn), Sources { student: true, aer: true });
        db::set_setting(&conn, "ui_prefs", r#"{"plan.sources":{"student":false,"aer":true}}"#).unwrap();
        assert_eq!(sources(&conn), Sources { student: false, aer: true });
    }
}
