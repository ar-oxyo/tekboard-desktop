//! MY Epitech connector.
//!
//! The user signs in on the real site, in a window of its own (Microsoft sign-in and MFA
//! happen there, untouched). A small script in that window hands the site's own access token
//! to TekBoard, which keeps it in memory only: it is never written to disk by TekBoard.
//! The browser session itself lives in a folder dedicated to that window and can be erased.
//!
//! Syncing is manual, read-only (GET on a fixed list of routes of the user's own account),
//! slow on purpose, and stores the raw answers in a local cache with a history.

use crate::error::{AppError, Result};
use base64::Engine;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::time::Duration;

pub const ORIGIN: &str = "https://my.epitech.eu";
pub const API: &str = "https://my.epitech.eu/api";
pub const WINDOW: &str = "my-epitech";
pub const TITLE_PREFIX: &str = "TEKBOARD_TOKEN:";

/// Routes read at each sync, found in the site's public front-end code and limited to the
/// ones a student account may read (staff dashboards answer 403). All are GET and concern
/// the signed-in user only. `{from}` / `{to}` are replaced by a date window around today.
/// The calendar token route is left out on purpose: its answer is a credential.
pub const ROUTES: &[(&str, &str)] = &[
    ("/auth/verify", "Account"),
    ("/units/instances/projects?page=1&limit=50&status=ongoing&registeredOnly=true", "Ongoing projects"),
    ("/units/instances/projects?page=1&limit=50&registeredOnly=true", "All my projects"),
    ("/units/projects/registrations/invitations/me", "Project invitations"),
    ("/events?startDate={from}&endDate={to}", "Events (2 weeks back, 8 weeks ahead)"),
    ("/evaluations/validations/me", "Validations"),
    ("/evaluations/validations/credits/me", "Credits"),
    ("/evaluations/validations/graph/me", "Validation graph"),
    ("/students/exams", "Exams"),
    ("/students/logtime", "Log time"),
    ("/students/github-stats", "GitHub stats"),
    ("/peer-evaluations/assignments/me", "Peer evaluations to do"),
    ("/peer-evaluations/results/me", "Peer evaluation results"),
    ("/cursus/me/attendance-plan", "Attendance plan"),
    ("/notifications/feed", "Notifications"),
];

/// Per-project details read after the list of ongoing projects, for at most this many projects.
pub const MAX_PROJECT_DETAILS: usize = 12;

fn expand(route: &str, today: chrono::NaiveDate) -> String {
    let iso = |d: chrono::NaiveDate| format!("{}T00:00:00.000Z", d.format("%Y-%m-%d"));
    route.replace("{from}", &iso(today - chrono::Duration::days(14))).replace("{to}", &iso(today + chrono::Duration::days(56)))
}

/// Ids of the projects listed in an answer, whether it is a bare array or `{ data | items: [...] }`.
pub fn project_ids(body: &str) -> Vec<i64> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(body) else { return vec![] };
    let list = v.as_array().or_else(|| ["data", "items", "results", "projects"].iter().find_map(|k| v[k].as_array()));
    let mut ids: Vec<i64> = list.map(|l| l.iter().filter_map(|x| x["id"].as_i64().or_else(|| x["projectInstanceId"].as_i64())).collect()).unwrap_or_default();
    ids.dedup();
    ids.truncate(MAX_PROJECT_DETAILS);
    ids
}

/// Runs in the MY Epitech window only. Looks for the site's access token in its own
/// localStorage and passes it through the document title, which TekBoard listens to.
pub const INIT_SCRIPT: &str = r#"
(() => {
  if (location.origin !== 'https://my.epitech.eu' || window.top !== window) return;
  let last = null;
  const jwt = (v) => typeof v === 'string' && /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(v);
  const find = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 3) return null;
    for (const k of Object.keys(o)) {
      if (/^(access_?token|accessToken|token)$/i.test(k) && jwt(o[k])) return o[k];
    }
    for (const k of Object.keys(o)) {
      const r = find(o[k], depth + 1);
      if (r) return r;
    }
    return null;
  };
  const scan = () => {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || key.startsWith('msal.')) continue;
        let value;
        try { value = JSON.parse(localStorage.getItem(key)); } catch { continue; }
        const token = find(value, 0);
        if (token) return token;
      }
    } catch {}
    return null;
  };
  setInterval(() => {
    const token = scan();
    if (token && token !== last) {
      last = token;
      const title = document.title;
      document.title = 'TEKBOARD_TOKEN:' + token;
      setTimeout(() => { document.title = title; }, 50);
    } else if (!token && last) {
      last = null;
      const title = document.title;
      document.title = 'TEKBOARD_TOKEN:';
      setTimeout(() => { document.title = title; }, 50);
    }
  }, 1500);
})();
"#;

#[derive(Debug, Clone, Default)]
pub struct Session {
    pub token: Option<String>,
    pub received_at: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TokenInfo {
    /// Expiry (Unix seconds) read from the token, when it has one.
    pub expires_at: Option<i64>,
    /// Who the token is for, when the token says so.
    pub account: Option<String>,
}

/// Reads the public part of a JWT. Nothing is verified: it is only used for display.
pub fn token_info(token: &str) -> Option<TokenInfo> {
    let payload = token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    let v: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    let account = ["login", "email", "preferred_username", "upn", "sub"].iter().find_map(|k| v[k].as_str()).map(str::to_string);
    Some(TokenInfo { expires_at: v["exp"].as_i64(), account })
}

/// A title set by the page script: `Some(Some(token))`, `Some(None)` when signed out, `None` for ordinary titles.
pub fn token_from_title(title: &str) -> Option<Option<String>> {
    let rest = title.strip_prefix(TITLE_PREFIX)?;
    let ok = rest.len() < 8192 && rest.split('.').count() == 3 && rest.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '='));
    Some(ok.then(|| rest.to_string()))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub route: String,
    pub label: String,
    pub fetched_at: i64,
    /// HTTP status, or 0 when the request itself failed.
    pub status: i64,
    pub size: usize,
    pub body: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRow {
    pub at: i64,
    pub ok: i64,
    pub failed: i64,
    pub detail: String,
}

pub fn entries(conn: &Connection) -> Result<Vec<Entry>> {
    let mut st = conn.prepare("SELECT route, fetched_at, status, body FROM my_cache")?;
    let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, r.get::<_, String>(3)?)))?;
    let mut all = Vec::new();
    for row in rows {
        let (route, fetched_at, status, body) = row?;
        let label = ROUTES.iter().find(|(r, _)| *r == route).map(|(_, l)| l.to_string()).unwrap_or_else(|| if route.ends_with("/my-activities") { "Project activities".into() } else if route.ends_with("/test-results") { "Project test results".into() } else { "No longer synced".into() });
        all.push(Entry { size: body.len(), body: serde_json::from_str(&body).unwrap_or(serde_json::Value::String(body)), route, label, fetched_at, status });
    }
    all.sort_by_key(|e| ROUTES.iter().position(|(r, _)| *r == e.route).unwrap_or(usize::MAX));
    Ok(all)
}

pub fn history(conn: &Connection, limit: u32) -> Result<Vec<SyncRow>> {
    let mut st = conn.prepare("SELECT at, ok, failed, detail FROM my_sync_log ORDER BY at DESC LIMIT ?1")?;
    let rows = st.query_map([limit], |r| Ok(SyncRow { at: r.get(0)?, ok: r.get(1)?, failed: r.get(2)?, detail: r.get(3)? }))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

pub fn clear_cache(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM my_cache", [])?;
    Ok(())
}

pub struct Fetched {
    pub route: String,
    pub status: i64,
    pub body: String,
}

const MAX_BODY: u64 = 2 * 1024 * 1024;

/// One GET. Never follows the call with another on failure: errors are recorded as they are.
fn get(agent: &ureq::Agent, token: &str, route: &str) -> (i64, String) {
    match agent.get(&format!("{API}{route}")).header("Authorization", &format!("Bearer {token}")).header("Accept", "application/json").call() {
        Ok(mut resp) => {
            let status = resp.status().as_u16() as i64;
            let body = resp.body_mut().with_config().limit(MAX_BODY).read_to_string().unwrap_or_else(|e| format!("{{\"error\":\"answer not read: {e}\"}}"));
            (status, body)
        }
        Err(e) => (0, serde_json::json!({ "error": e.to_string() }).to_string()),
    }
}

/// Reads every route once, half a second apart, then the details of each ongoing project.
/// Stops at once when the session is refused.
pub fn fetch_all(token: &str) -> Vec<Fetched> {
    let config = ureq::Agent::config_builder().http_status_as_error(false).timeout_global(Some(Duration::from_secs(20))).user_agent("TekBoard (personal desktop client, read-only)").max_redirects(0).build();
    let agent: ureq::Agent = config.into();
    let today = chrono::Local::now().date_naive();
    let pause = || std::thread::sleep(Duration::from_millis(500));
    let mut out = Vec::new();
    let mut ids = Vec::new();
    for (i, (route, _)) in ROUTES.iter().enumerate() {
        if i > 0 {
            pause();
        }
        let (status, body) = get(&agent, token, &expand(route, today));
        if i == 1 && status == 200 {
            ids = project_ids(&body);
        }
        out.push(Fetched { route: route.to_string(), status, body });
        if status == 401 && i == 0 {
            return out;
        }
    }
    for id in ids {
        for tail in ["my-activities", "test-results"] {
            pause();
            let route = format!("/units/instances/projects/{id}/{tail}");
            let (status, body) = get(&agent, token, &route);
            out.push(Fetched { route, status, body });
        }
    }
    out
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub ok: usize,
    pub failed: usize,
    /// The site refused the session: sign in again in the MY Epitech window.
    pub unauthorized: bool,
    pub detail: String,
}

/// Stores what was fetched. A failed route keeps its previous good answer in the cache.
pub fn store(conn: &Connection, fetched: &[Fetched], now: i64) -> Result<SyncReport> {
    let mut ok = 0;
    let mut problems = Vec::new();
    for f in fetched {
        if (200..300).contains(&f.status) {
            ok += 1;
            if f.route == ROUTES[1].0 {
                // Details of projects that are no longer ongoing leave the cache.
                conn.execute("DELETE FROM my_cache WHERE route LIKE '/units/instances/projects/%/%'", [])?;
            }
            conn.execute("INSERT INTO my_cache (route, fetched_at, status, body) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(route) DO UPDATE SET fetched_at = excluded.fetched_at, status = excluded.status, body = excluded.body", params![f.route, now, f.status, f.body])?;
        } else {
            problems.push(format!("{} → {}", f.route, if f.status == 0 { "no answer".to_string() } else { f.status.to_string() }));
            // Keep the error only when nothing better is cached for that route.
            conn.execute("INSERT INTO my_cache (route, fetched_at, status, body) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(route) DO NOTHING", params![f.route, now, f.status, f.body])?;
        }
    }
    let unauthorized = fetched.first().is_some_and(|f| f.status == 401);
    if !unauthorized {
        // Answers of routes this version no longer reads are dropped.
        let known: Vec<String> = ROUTES.iter().map(|(r, _)| format!("'{}'", r.replace('\'', "''"))).collect();
        conn.execute(&format!("DELETE FROM my_cache WHERE route NOT IN ({}) AND route NOT LIKE '/units/instances/projects/%/%'", known.join(",")), [])?;
    }
    let skipped = ROUTES.len().saturating_sub(fetched.len());
    let mut detail = problems.join("; ");
    if skipped > 0 {
        detail = format!("session refused, {skipped} route(s) not tried. {detail}");
    }
    conn.execute("INSERT INTO my_sync_log (at, ok, failed, detail) VALUES (?1, ?2, ?3, ?4)", params![now, ok as i64, problems.len() as i64, detail])?;
    Ok(SyncReport { ok, failed: problems.len(), unauthorized, detail })
}

pub fn not_connected() -> AppError {
    AppError::new("my_not_connected", "Not connected to MY Epitech: open the sign-in window first.")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn jwt(payload: &str) -> String {
        let enc = |s: &str| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(s);
        format!("{}.{}.sig", enc("{\"alg\":\"none\"}"), enc(payload))
    }

    #[test]
    fn token_is_only_accepted_from_a_well_formed_title() {
        let t = jwt("{\"exp\":1900000000,\"login\":\"someone@epitech.eu\"}");
        assert_eq!(token_from_title(&format!("TEKBOARD_TOKEN:{t}")), Some(Some(t.clone())));
        assert_eq!(token_from_title("TEKBOARD_TOKEN:"), Some(None));
        assert_eq!(token_from_title("TEKBOARD_TOKEN:not a token"), Some(None));
        assert_eq!(token_from_title("MY Epitech — Dashboard"), None);
        assert_eq!(token_info(&t), Some(TokenInfo { expires_at: Some(1900000000), account: Some("someone@epitech.eu".into()) }));
        assert_eq!(token_info("garbage"), None);
    }

    #[test]
    fn the_calendar_credential_route_is_never_synced_and_all_routes_are_plain_paths() {
        assert!(ROUTES.iter().all(|(r, _)| r.starts_with('/') && !r.contains("token") && !r.contains("..") && !r.contains("students/{")));
        let day = chrono::NaiveDate::from_ymd_opt(2026, 11, 10).unwrap();
        assert_eq!(expand("/events?startDate={from}&endDate={to}", day), "/events?startDate=2026-10-27T00:00:00.000Z&endDate=2027-01-05T00:00:00.000Z");
        assert_eq!(project_ids("[{\"id\":4138},{\"id\":7},{\"name\":\"x\"}]"), vec![4138, 7]);
        assert_eq!(project_ids("{\"data\":[{\"id\":3}],\"total\":1}"), vec![3]);
        assert!(project_ids("{\"message\":\"no\"}").is_empty());
    }

    #[test]
    fn good_answers_are_cached_and_errors_do_not_erase_them() {
        let conn = db::open_in_memory().unwrap();
        let first = [Fetched { route: "/auth/verify".into(), status: 200, body: "{\"login\":\"x\"}".into() }, Fetched { route: "/students/exams".into(), status: 200, body: "[1,2]".into() }];
        let r = store(&conn, &first, 100).unwrap();
        assert_eq!((r.ok, r.failed, r.unauthorized), (2, 0, false));
        let second = [Fetched { route: "/auth/verify".into(), status: 200, body: "{\"login\":\"y\"}".into() }, Fetched { route: "/students/exams".into(), status: 500, body: "{}".into() }, Fetched { route: "/students/logtime".into(), status: 404, body: "{\"message\":\"Cannot GET\"}".into() }];
        let r = store(&conn, &second, 200).unwrap();
        assert_eq!((r.ok, r.failed), (1, 2));
        let all = entries(&conn).unwrap();
        let get = |route: &str| all.iter().find(|e| e.route == route).unwrap();
        assert_eq!(get("/auth/verify").body["login"], "y");
        assert_eq!((get("/students/exams").status, get("/students/exams").fetched_at), (200, 100));
        assert_eq!(get("/students/logtime").status, 404);
        let h = history(&conn, 10).unwrap();
        assert_eq!(h.len(), 2);
        assert!(h[0].detail.contains("/students/exams → 500"));
    }

    #[test]
    fn a_refused_session_is_reported() {
        let conn = db::open_in_memory().unwrap();
        let r = store(&conn, &[Fetched { route: "/auth/verify".into(), status: 401, body: "{}".into() }], 1).unwrap();
        assert!(r.unauthorized && r.detail.contains("not tried"));
    }
}
