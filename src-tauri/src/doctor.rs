//! Environment checks. `check` is the quick read-only list (sidebar, Settings → Tools);
//! `diagnosis` is TekBoard Doctor (every dependency, with fixes and an anonymous report).

pub mod anonymize;
pub mod diagnosis;

use crate::git;
use crate::github::{self, GhStatus};
use crate::settings::which;
use serde::Serialize;
use std::process::{Command, Stdio};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tool {
    pub name: String,
    pub purpose: String,
    pub path: Option<String>,
    pub version: Option<String>,
    /// Needed for the core workflow (as opposed to nice to have).
    pub required: bool,
}

const TOOLS: &[(&str, &str, bool, &[&str])] = &[
    ("git", "Version control", true, &["--version"]),
    ("gh", "Lists your GitHub repositories", false, &["--version"]),
    ("ssh", "Clone and push over SSH", true, &["-V"]),
    ("make", "Builds projects", true, &["--version"]),
    ("epiclang", "Epitech C compiler", false, &["--version"]),
    ("gcc", "C compiler", false, &["--version"]),
    ("clang", "C compiler (LLVM)", false, &["--version"]),
    ("valgrind", "Memory checks", false, &["--version"]),
    ("gdb", "Debugger", false, &["--version"]),
    ("gcovr", "Coverage report for unit tests", false, &["--version"]),
];

fn version(bin: &std::path::Path, args: &[&str]) -> Option<String> {
    crate::toolenv::first_line(bin, args, std::time::Duration::from_secs(5)).ok().map(|l| l.chars().take(80).collect())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitIdentity {
    pub name: Option<String>,
    pub email: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvStatus {
    pub tools: Vec<Tool>,
    pub github: GhStatus,
    pub identity: GitIdentity,
    /// An ssh-agent socket is reachable from the app (keys can be used without a prompt).
    pub ssh_agent: bool,
}

pub fn check() -> EnvStatus {
    let tools = TOOLS
        .iter()
        .map(|(name, purpose, required, args)| {
            let path = which(name);
            Tool { name: name.to_string(), purpose: purpose.to_string(), version: path.as_ref().and_then(|p| version(p, args)), path: path.map(|p| p.to_string_lossy().into_owned()), required: *required }
        })
        .collect();
    EnvStatus {
        tools,
        github: github::status(),
        identity: GitIdentity { name: git::config_get(None, "user.name"), email: git::config_get(None, "user.email") },
        ssh_agent: std::env::var_os("SSH_AUTH_SOCK").map(|s| std::path::Path::new(&s).exists()).unwrap_or(false),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshCheck {
    pub ok: bool,
    pub message: String,
}

/// Asks github.com to greet us over SSH. Network call, only run on request.
pub fn test_github_ssh() -> SshCheck {
    let out = Command::new("ssh")
        .args(["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=6", "-o", "StrictHostKeyChecking=yes", "git@github.com"])
        .stdin(Stdio::null())
        .output();
    match out {
        Err(e) => SshCheck { ok: false, message: e.to_string() },
        Ok(out) => {
            let text = String::from_utf8_lossy(&out.stderr).trim().to_string();
            let ok = text.contains("successfully authenticated");
            let message = text.lines().last().unwrap_or("No answer from github.com").to_string();
            SshCheck { ok, message }
        }
    }
}
