//! GitHub access goes exclusively through the `gh` CLI. TekBoard never sees,
//! stores or logs a token: authentication stays in gh's own credential store.

use crate::error::{AppError, Result};
use serde::{Deserialize, Serialize};
use std::process::Stdio;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum GhStatus {
    /// `gh` is not installed.
    Missing,
    /// Installed, but `gh auth login` was never completed.
    LoggedOut,
    Ready { login: Option<String> },
    /// Installed and configured, but the check itself failed (offline…).
    Error { message: String },
}

fn gh(args: &[&str]) -> std::io::Result<std::process::Output> {
    crate::toolenv::command("gh").args(args).env("GH_PROMPT_DISABLED", "1").env("NO_COLOR", "1").stdin(Stdio::null()).output()
}

pub fn status() -> GhStatus {
    let out = match gh(&["auth", "status"]) {
        Ok(out) => out,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return GhStatus::Missing,
        Err(e) => return GhStatus::Error { message: e.to_string() },
    };
    let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    parse_status(out.status.success(), &text)
}

pub fn parse_status(success: bool, text: &str) -> GhStatus {
    if success {
        return GhStatus::Ready { login: parse_login(text) };
    }
    let lower = text.to_lowercase();
    if lower.contains("not logged in") || lower.contains("gh auth login") {
        GhStatus::LoggedOut
    } else {
        // Token lines are never echoed back: keep the first line only.
        GhStatus::Error { message: text.lines().find(|l| !l.trim().is_empty()).unwrap_or("gh auth status failed").trim().to_string() }
    }
}

fn parse_login(text: &str) -> Option<String> {
    for marker in [" account ", " as "] {
        if let Some(idx) = text.find(marker) {
            let rest = &text[idx + marker.len()..];
            let login: String = rest.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
            if !login.is_empty() {
                return Some(login);
            }
        }
    }
    None
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteRepo {
    pub name: String,
    #[serde(alias = "full_name")]
    pub full_name: String,
    pub owner: String,
    #[serde(alias = "ssh_url")]
    pub ssh_url: String,
    #[serde(alias = "created_at")]
    pub created_at: String,
    #[serde(alias = "pushed_at")]
    pub pushed_at: Option<String>,
    pub private: bool,
    pub archived: bool,
    pub fork: bool,
}

const JQ: &str = ".[] | {name, full_name, owner: .owner.login, ssh_url, created_at, pushed_at, private, archived, fork}";

/// Every repository the authenticated account can reach (owned, collaborator, organization member).
pub fn list_repos() -> Result<Vec<RemoteRepo>> {
    let out = gh(&["api", "--paginate", "user/repos?per_page=100&sort=created&direction=desc", "--jq", JQ]).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::new("gh_missing", "GitHub CLI (gh) n'est pas installé")
        } else {
            AppError::Io(e)
        }
    })?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let lower = err.to_lowercase();
        let code = if lower.contains("gh auth login") || lower.contains("401") {
            "gh_logged_out"
        } else if lower.contains("dial tcp") || lower.contains("could not resolve") || lower.contains("no such host") || lower.contains("timeout") {
            "offline"
        } else {
            "gh_failed"
        };
        return Err(AppError::new(code, err.lines().next().unwrap_or("gh api failed").trim().to_string()));
    }
    parse_repos(&String::from_utf8_lossy(&out.stdout))
}

/// Accepts a stream of JSON objects, compact or pretty-printed.
pub fn parse_repos(text: &str) -> Result<Vec<RemoteRepo>> {
    let mut repos = Vec::new();
    for item in serde_json::Deserializer::from_str(text).into_iter::<RemoteRepo>() {
        repos.push(item?);
    }
    Ok(repos)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_parsing() {
        let ok = "github.com\n  ✓ Logged in to github.com account octo-cat (keyring)\n  - Token: gho_****\n";
        assert_eq!(parse_status(true, ok), GhStatus::Ready { login: Some("octo-cat".into()) });
        assert_eq!(parse_status(true, "✓ Logged in to github.com as someone (oauth_token)"), GhStatus::Ready { login: Some("someone".into()) });
        assert_eq!(parse_status(false, "You are not logged into any GitHub hosts. To log in, run: gh auth login"), GhStatus::LoggedOut);
        assert!(matches!(parse_status(false, "error connecting to api.github.com"), GhStatus::Error { .. }));
    }

    #[test]
    fn parses_json_stream() {
        let text = r#"{"name":"a","full_name":"Org/a","owner":"Org","ssh_url":"git@github.com:Org/a.git","created_at":"2026-11-01T10:00:00Z","pushed_at":null,"private":true,"archived":false,"fork":false}
{"name":"b","full_name":"me/b","owner":"me","ssh_url":"git@github.com:me/b.git","created_at":"2025-01-01T00:00:00Z","pushed_at":"2025-02-01T00:00:00Z","private":false,"archived":true,"fork":true}"#;
        let repos = parse_repos(text).unwrap();
        assert_eq!(repos.len(), 2);
        assert_eq!(repos[0].full_name, "Org/a");
        assert_eq!(repos[0].pushed_at, None);
        assert!(repos[1].archived && repos[1].fork);
        assert!(parse_repos("").unwrap().is_empty());
        assert!(parse_repos("{not json").is_err());
    }
}
