//! Credit simulations: scenarios the student builds on top of their real MY Epitech results.
//! The barème (teaching units, modules, credits, minimums) and the choices of a scenario are
//! computed in the window (`src/lib/credits.ts`); this module only keeps them. Nothing here
//! is an official figure: official results always come from MY Epitech, unchanged.

use crate::error::{AppError, Result};
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::Value;

/// Largest scenario kept (a barème of a few dozen modules is a few kilobytes).
const MAX_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scenario {
    pub id: i64,
    pub name: String,
    pub data: Value,
    pub updated_at: i64,
}

pub fn list(conn: &Connection) -> Result<Vec<Scenario>> {
    let mut st = conn.prepare("SELECT id, name, data, updated_at FROM credit_scenarios ORDER BY updated_at DESC LIMIT 50")?;
    let rows = st.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, i64>(3)?)))?;
    let mut out = Vec::new();
    for row in rows {
        let (id, name, data, updated_at) = row?;
        // A row that no longer reads is skipped, not shown half-broken.
        if let Ok(data) = serde_json::from_str(&data) {
            out.push(Scenario { id, name, data, updated_at });
        }
    }
    Ok(out)
}

/// Creates (`id: None`) or replaces a scenario. The data must be a JSON object.
pub fn save(conn: &Connection, id: Option<i64>, name: &str, data: &Value, now: i64) -> Result<Scenario> {
    let name: String = name.trim().chars().filter(|c| !c.is_control()).take(60).collect();
    if name.is_empty() {
        return Err(AppError::new("invalid_name", "Donne un nom à ce scénario."));
    }
    if !data.is_object() {
        return Err(AppError::new("invalid_scenario", "Scénario illisible."));
    }
    let text = data.to_string();
    if text.len() > MAX_BYTES {
        return Err(AppError::new("invalid_scenario", "Scénario trop volumineux."));
    }
    let id = match id {
        Some(id) if conn.execute("UPDATE credit_scenarios SET name = ?2, data = ?3, updated_at = ?4 WHERE id = ?1", params![id, name, text, now])? > 0 => id,
        _ => {
            conn.execute("INSERT INTO credit_scenarios (name, data, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)", params![name, text, now])?;
            conn.last_insert_rowid()
        }
    };
    Ok(Scenario { id, name, data: data.clone(), updated_at: now })
}

pub fn delete(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM credit_scenarios WHERE id = ?1", [id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn scenarios_are_kept_replaced_and_removed() {
        let conn = crate::db::open_in_memory().unwrap();
        let a = save(&conn, None, "  Prudent  ", &json!({"objective": 60}), 1).unwrap();
        assert_eq!(a.name, "Prudent");
        let b = save(&conn, Some(a.id), "Ambitieux", &json!({"objective": 66}), 2).unwrap();
        assert_eq!(a.id, b.id);
        let all = list(&conn).unwrap();
        assert_eq!((all.len(), all[0].data["objective"].as_i64()), (1, Some(66)));
        assert!(save(&conn, None, " ", &json!({}), 3).is_err());
        assert!(save(&conn, None, "x", &json!([1]), 3).is_err());
        assert!(save(&conn, None, "x", &json!({"big": "a".repeat(MAX_BYTES)}), 3).is_err());
        delete(&conn, a.id).unwrap();
        assert!(list(&conn).unwrap().is_empty());
    }
}
