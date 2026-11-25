//! API keys of AI providers (OpenRouter).
//!
//! They live in their own file, `secrets.json` in the data folder, readable by the user only
//! (0600, in a 0700 folder), and never in the settings: those are sent to the window as they
//! are. A key never goes back to the window (only whether there is one and its last
//! characters), never on a command line and never in a log.
//!
//! When no key is saved, `OPENROUTER_API_KEY` from the environment is used.

use crate::error::Result;
use serde_json::{Map, Value};
use std::io::Write;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

static DIR: OnceLock<PathBuf> = OnceLock::new();
static LOCK: Mutex<()> = Mutex::new(());

pub const OPENROUTER: &str = "openrouter";

pub fn init(data_dir: &Path) {
    let _ = DIR.set(data_dir.to_path_buf());
}

pub fn file() -> Option<PathBuf> {
    DIR.get().map(|d| d.join("secrets.json"))
}

fn read_all(path: &Path) -> Map<String, Value> {
    std::fs::read_to_string(path).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()).and_then(|v| v.as_object().cloned()).unwrap_or_default()
}

fn env_name(name: &str) -> Option<&'static str> {
    (name == OPENROUTER).then_some("OPENROUTER_API_KEY")
}

/// Where a key comes from.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Saved,
    Env,
}

pub fn get_with_source(name: &str) -> Option<(String, Source)> {
    let saved = file().map(|p| read_all(&p)).and_then(|m| m.get(name).and_then(Value::as_str).map(str::to_string)).filter(|k| !k.is_empty());
    saved.map(|k| (k, Source::Saved)).or_else(|| env_name(name).and_then(|e| std::env::var(e).ok()).map(|k| k.trim().to_string()).filter(|k| !k.is_empty()).map(|k| (k, Source::Env)))
}

pub fn get(name: &str) -> Option<String> {
    get_with_source(name).map(|(k, _)| k)
}

/// Saves (`Some`) or removes (`None`) a key. The file is replaced in one step.
pub fn set(name: &str, value: Option<&str>) -> Result<()> {
    let path = file().ok_or_else(|| crate::error::AppError::new("not_ready", "TekBoard démarre encore"))?;
    set_in(&path, name, value)
}

pub fn set_in(path: &Path, name: &str, value: Option<&str>) -> Result<()> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut all = read_all(path);
    match value.map(str::trim).filter(|v| !v.is_empty()) {
        Some(v) => all.insert(name.to_string(), Value::String(v.to_string())),
        None => all.remove(name),
    };
    let tmp = path.with_extension("json.tmp");
    {
        let mut f = std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(&tmp)?;
        f.write_all(Value::Object(all).to_string().as_bytes())?;
        f.sync_all()?;
    }
    std::fs::rename(&tmp, path)?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    Ok(())
}

/// `sk-or-…a1b2`: enough to recognise a key, not to use it.
pub fn hint(key: &str) -> String {
    let tail: String = key.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
    if key.chars().count() <= 8 {
        "••••".into()
    } else {
        format!("••••{tail}")
    }
}

/// Removes every saved key from `text` (error messages, logs, reports).
pub fn scrub(text: &str) -> String {
    let mut out = text.to_string();
    if let Some(k) = get(OPENROUTER).filter(|k| k.len() >= 8) {
        out = out.replace(&k, "<clé masquée>");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_are_saved_private_and_removable() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("secrets.json");
        set_in(&p, OPENROUTER, Some("  sk-or-v1-abcdef123456  ")).unwrap();
        let mode = std::fs::metadata(&p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        assert_eq!(read_all(&p)[OPENROUTER], "sk-or-v1-abcdef123456");
        set_in(&p, "other", Some("x")).unwrap();
        set_in(&p, OPENROUTER, None).unwrap();
        let all = read_all(&p);
        assert!(!all.contains_key(OPENROUTER) && all.contains_key("other"));
    }

    #[test]
    fn hints_show_only_the_end() {
        assert_eq!(hint("sk-or-v1-abcdef123456"), "••••3456");
        assert_eq!(hint("short"), "••••");
    }
}
