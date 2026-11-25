//! Contacts (devices paired once, then recognised by their fingerprint) and Connect's own
//! settings. Kept in TekBoard's database; nothing is published anywhere.

use super::proto::Profile;
use crate::error::Result;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    /// Off by default: nothing listens and nothing is advertised until the user turns it on.
    pub enabled: bool,
    pub profile: Profile,
    /// Kept from one start to the next so invitation codes stay valid. 0 = pick one.
    pub port: u16,
    /// Interface name or address to listen on; empty = the default one.
    pub interface: String,
    /// TekSpace (the virtual campus) shown in the menu.
    pub space: bool,
}

impl Default for Config {
    fn default() -> Self {
        let user = std::env::var("USER").unwrap_or_default();
        Config { enabled: false, profile: Profile { nick: super::proto::clean_nick(&user), avatar: String::new(), status: "available".into() }, port: 0, interface: String::new(), space: false }
    }
}

const KEY: &str = "connect";

pub fn load(conn: &Connection) -> Config {
    crate::db::get_setting(conn, KEY).ok().flatten().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

pub fn save(conn: &Connection, c: &Config) -> Result<()> {
    let c = Config { profile: c.profile.cleaned(), ..c.clone() };
    crate::db::set_setting(conn, KEY, &serde_json::to_string(&c)?)
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Contact {
    pub fp: String,
    pub nick: String,
    pub avatar: String,
    pub trusted: bool,
    pub blocked: bool,
    pub first_seen: i64,
    pub last_seen: i64,
    pub last_addr: Option<String>,
}

fn row(r: &rusqlite::Row) -> rusqlite::Result<Contact> {
    Ok(Contact { fp: r.get(0)?, nick: r.get(1)?, avatar: r.get(2)?, trusted: r.get::<_, i64>(3)? != 0, blocked: r.get::<_, i64>(4)? != 0, first_seen: r.get(5)?, last_seen: r.get(6)?, last_addr: r.get(7)? })
}

const COLS: &str = "fp, nick, avatar, trusted, blocked, first_seen, last_seen, last_addr";

pub fn contacts(conn: &Connection) -> Result<Vec<Contact>> {
    let mut st = conn.prepare(&format!("SELECT {COLS} FROM connect_contacts ORDER BY trusted DESC, last_seen DESC LIMIT 500"))?;
    let rows = st.query_map([], row)?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

pub fn get(conn: &Connection, fp: &str) -> Result<Option<Contact>> {
    Ok(conn.query_row(&format!("SELECT {COLS} FROM connect_contacts WHERE fp = ?1"), [fp], row).optional()?)
}

/// Records a device seen over an authenticated connection (name and address refreshed).
pub fn seen(conn: &Connection, fp: &str, p: &Profile, addr: &str, now: i64) -> Result<()> {
    conn.execute(
        "INSERT INTO connect_contacts (fp, nick, avatar, trusted, blocked, first_seen, last_seen, last_addr) VALUES (?1, ?2, ?3, 0, 0, ?4, ?4, ?5)
         ON CONFLICT(fp) DO UPDATE SET nick = ?2, avatar = ?3, last_seen = ?4, last_addr = ?5",
        params![fp, p.nick, p.avatar, now, addr],
    )?;
    Ok(())
}

pub fn set_trusted(conn: &Connection, fp: &str, trusted: bool) -> Result<()> {
    conn.execute("UPDATE connect_contacts SET trusted = ?2, blocked = CASE WHEN ?2 = 1 THEN 0 ELSE blocked END WHERE fp = ?1", params![fp, trusted as i64])?;
    Ok(())
}

pub fn set_blocked(conn: &Connection, fp: &str, blocked: bool, now: i64) -> Result<()> {
    conn.execute(
        "INSERT INTO connect_contacts (fp, nick, avatar, trusted, blocked, first_seen, last_seen) VALUES (?1, '', '', 0, ?2, ?3, ?3)
         ON CONFLICT(fp) DO UPDATE SET blocked = ?2, trusted = CASE WHEN ?2 = 1 THEN 0 ELSE trusted END",
        params![fp, blocked as i64, now],
    )?;
    Ok(())
}

pub fn forget(conn: &Connection, fp: &str) -> Result<()> {
    conn.execute("DELETE FROM connect_contacts WHERE fp = ?1 AND blocked = 0", [fp])?;
    conn.execute("UPDATE connect_contacts SET trusted = 0 WHERE fp = ?1", [fp])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contacts_are_trusted_blocked_and_forgotten() {
        let conn = crate::db::open_in_memory().unwrap();
        let fp = "a".repeat(64);
        let p = Profile { nick: "Léa".into(), avatar: String::new(), status: "coding".into() };
        seen(&conn, &fp, &p, "10.0.0.2:4000", 5).unwrap();
        assert!(!get(&conn, &fp).unwrap().unwrap().trusted);
        set_trusted(&conn, &fp, true).unwrap();
        assert!(get(&conn, &fp).unwrap().unwrap().trusted);
        set_blocked(&conn, &fp, true, 6).unwrap();
        let c = get(&conn, &fp).unwrap().unwrap();
        assert!(c.blocked && !c.trusted);
        forget(&conn, &fp).unwrap();
        assert!(get(&conn, &fp).unwrap().unwrap().blocked, "forgetting keeps a block");
        set_blocked(&conn, &fp, false, 7).unwrap();
        forget(&conn, &fp).unwrap();
        assert!(get(&conn, &fp).unwrap().is_none());
        let mut c = load(&conn);
        assert!(!c.enabled, "off by default");
        c.profile.nick = "  Bob  ".into();
        save(&conn, &c).unwrap();
        assert_eq!(load(&conn).profile.nick, "Bob");
    }
}
