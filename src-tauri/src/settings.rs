//! User preferences and first-run detection. Nothing here is hard-coded to one
//! machine: defaults come from what is actually installed.

use crate::db;
use crate::error::{AppError, Result};
use crate::git;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Directories scanned for repositories.
    pub roots: Vec<String>,
    /// Where new projects are cloned by default. Must be inside a root.
    pub clone_dir: Option<String>,
    /// Command line, split on spaces, `{dir}` replaced by the project path. No shell involved.
    pub ide_cmd: String,
    pub terminal_cmd: String,
    pub default_template: Option<String>,
    /// Blur/transparency on overlays. Off = opaque surfaces.
    pub glass_effects: bool,
    /// Visual design, one of `THEMES`.
    pub theme: String,
    /// Tell the Cozy Fox companion about builds and pushes made from TekBoard.
    pub fox_signals: bool,
    pub onboarded: bool,
    /// Folders (inside the projects folders) that hold school work: one of the clues used to
    /// tell Epitech repositories from personal ones.
    pub epitech_dirs: Vec<String>,
    /// Claude Code executable picked by hand. Empty = found automatically.
    pub claude_path: Option<String>,
    /// Terminal that runs a program: `{dir}` is the project folder, the program and its
    /// arguments are appended. No shell involved.
    pub terminal_run_cmd: String,
    /// Minutes between two automatic MY Epitech syncs. 0 = only when asked.
    pub my_sync_minutes: u32,
    /// Reopen the stored MY Epitech session (in a hidden window) when TekBoard starts.
    pub my_auto_reconnect: bool,
    /// Interface language: `fr` or `en`.
    pub language: String,
    /// Only Epitech projects in lists, planning and Artix. Personal ones stay one switch away.
    pub epitech_only: bool,
    /// Step of the first-run assistant reached so far, so closing the app resumes it there.
    pub onboarding_step: String,
    /// Look for a new release now and then (at most once a day).
    pub update_check: bool,
    /// Global shortcut that opens the capture window (X11 only). Empty = none.
    pub capture_shortcut: String,
    /// Icon in the notification area (capture, inbox, restore point).
    pub tray_icon: bool,
}

pub const LANGUAGES: &[&str] = &["fr", "en"];

pub const SYNC_INTERVALS: &[u32] = &[0, 15, 30, 60, 180];

impl Default for Settings {
    fn default() -> Self {
        Settings { roots: vec![], clone_dir: None, ide_cmd: String::new(), terminal_cmd: String::new(), default_template: None, glass_effects: true, theme: THEMES[0].to_string(), fox_signals: true, onboarded: false, epitech_dirs: vec![], claude_path: None, terminal_run_cmd: String::new(), my_sync_minutes: 0, my_auto_reconnect: false, language: "fr".into(), epitech_only: true, onboarding_step: String::new(), update_check: true, capture_shortcut: crate::desktop::DEFAULT_SHORTCUT.into(), tray_icon: false }
    }
}

const KEY: &str = "app";

/// Designs the UI knows how to render. The first one is the default.
pub const THEMES: &[&str] = &["aurora", "flat", "neon", "cozy", "terminal"];

pub fn load(conn: &Connection) -> Result<Settings> {
    match db::get_setting(conn, KEY)? {
        Some(json) => {
            let mut s: Settings = serde_json::from_str(&json).unwrap_or_default();
            // Settings saved by an older version have no "run a program" terminal yet.
            if s.terminal_run_cmd.is_empty() {
                s.terminal_run_cmd = detect_terminal_run().unwrap_or_default();
            }
            Ok(s)
        }
        None => {
            let mut s = Settings::default();
            s.ide_cmd = detect_ide().unwrap_or_default();
            s.terminal_cmd = detect_terminal().unwrap_or_default();
            s.terminal_run_cmd = detect_terminal_run().unwrap_or_default();
            Ok(s)
        }
    }
}

/// Settings that no longer read (edited by hand, damaged): each field that still reads is
/// kept, the others go back to their default, and the original text stays under `app.broken`.
/// Returns whether anything had to be repaired.
pub fn repair(conn: &Connection) -> Result<bool> {
    let Some(raw) = db::get_setting(conn, KEY)? else { return Ok(false) };
    if serde_json::from_str::<Settings>(&raw).is_ok() {
        return Ok(false);
    }
    db::set_setting(conn, "app.broken", &raw)?;
    match serde_json::from_str::<serde_json::Value>(&raw) {
        Ok(serde_json::Value::Object(map)) => {
            let kept: serde_json::Map<String, serde_json::Value> = map.into_iter().filter(|(k, v)| serde_json::from_value::<Settings>(serde_json::json!({ k.clone(): v.clone() })).is_ok()).collect();
            db::set_setting(conn, KEY, &serde_json::Value::Object(kept).to_string())?;
        }
        _ => {
            conn.execute("DELETE FROM settings WHERE key = ?1", [KEY])?;
        }
    }
    Ok(true)
}

/// Set up before the first-run assistant existed (projects folders chosen, no step recorded):
/// already configured, so the assistant is not shown on the first start of this version.
pub fn adopt_existing_setup(conn: &Connection) -> Result<bool> {
    let Some(raw) = db::get_setting(conn, KEY)? else { return Ok(false) };
    let Ok(mut s) = serde_json::from_str::<Settings>(&raw) else { return Ok(false) };
    if s.onboarded || s.roots.is_empty() || !s.onboarding_step.is_empty() {
        return Ok(false);
    }
    s.onboarded = true;
    s.onboarding_step = "done".into();
    db::set_setting(conn, KEY, &serde_json::to_string(&s)?)?;
    Ok(true)
}

pub fn save(conn: &Connection, settings: &Settings) -> Result<Settings> {
    let mut s = settings.clone();
    let mut roots = Vec::new();
    for root in &s.roots {
        let canon = std::fs::canonicalize(root).map_err(|_| AppError::new("invalid_root", format!("{root} is not an existing directory")))?;
        if !canon.is_dir() || canon == Path::new("/") {
            return Err(AppError::new("invalid_root", format!("{root} cannot be used as a projects folder")));
        }
        let canon = canon.to_string_lossy().into_owned();
        if !roots.contains(&canon) {
            roots.push(canon);
        }
    }
    s.roots = roots;
    if let Some(dir) = s.clone_dir.clone().filter(|d| !d.trim().is_empty()) {
        let canon = std::fs::canonicalize(&dir).map_err(|_| AppError::new("invalid_clone_dir", format!("{dir} is not an existing directory")))?;
        if !is_inside_any(&canon, &s.roots) {
            return Err(AppError::new("invalid_clone_dir", "Le dossier de clonage doit être dans un des dossiers de projets"));
        }
        s.clone_dir = Some(canon.to_string_lossy().into_owned());
    } else {
        s.clone_dir = None;
    }
    if !THEMES.contains(&s.theme.as_str()) {
        return Err(AppError::new("invalid_theme", format!("Apparence inconnue « {} »", s.theme)));
    }
    s.ide_cmd = s.ide_cmd.trim().to_string();
    s.terminal_cmd = s.terminal_cmd.trim().to_string();
    s.terminal_run_cmd = s.terminal_run_cmd.trim().to_string();
    let mut dirs = Vec::new();
    for dir in &s.epitech_dirs {
        let canon = std::fs::canonicalize(dir).map_err(|_| AppError::new("invalid_dir", format!("{dir} is not an existing directory")))?;
        if !canon.is_dir() || !is_inside_any(&canon, &s.roots) {
            return Err(AppError::new("invalid_dir", format!("{dir} must be a folder inside one of the projects folders")));
        }
        let canon = canon.to_string_lossy().into_owned();
        if !dirs.contains(&canon) {
            dirs.push(canon);
        }
    }
    s.epitech_dirs = dirs;
    s.claude_path = s.claude_path.map(|p| p.trim().to_string()).filter(|p| !p.is_empty());
    if let Some(p) = &s.claude_path {
        let path = Path::new(p);
        if !path.is_absolute() || !crate::toolenv::is_executable(path) {
            return Err(AppError::new("invalid_claude_path", format!("{p} is not an executable file. Pick the `claude` program itself, or leave the field empty to let TekBoard find it.")));
        }
    }
    if !LANGUAGES.contains(&s.language.as_str()) {
        return Err(AppError::new("invalid_language", format!("Langue inconnue « {} »", s.language)));
    }
    if !SYNC_INTERVALS.contains(&s.my_sync_minutes) {
        return Err(AppError::new("invalid_interval", "Intervalle de synchronisation inconnu"));
    }
    s.capture_shortcut = s.capture_shortcut.trim().to_string();
    if !s.capture_shortcut.is_empty() && (s.capture_shortcut.len() > 60 || s.capture_shortcut.parse::<tauri_plugin_global_shortcut::Shortcut>().is_err()) {
        return Err(AppError::new("invalid_shortcut", format!("Raccourci illisible « {} » (exemple : Ctrl+Alt+Space)", s.capture_shortcut)));
    }
    db::set_setting(conn, KEY, &serde_json::to_string(&s)?)?;
    Ok(s)
}

pub fn is_inside_any(path: &Path, roots: &[String]) -> bool {
    roots.iter().any(|r| path.starts_with(r))
}

/// Looks a program up without running it: this process's `PATH`, then where the user's
/// terminal would find it (see `toolenv`).
pub fn which(name: &str) -> Option<PathBuf> {
    crate::toolenv::which(name)
}

pub fn detect_ide() -> Option<String> {
    ["code", "codium", "zed", "subl"].iter().find(|c| which(c).is_some()).map(|c| format!("{c} {{dir}}"))
}

pub fn detect_terminal() -> Option<String> {
    const CANDIDATES: &[(&str, &str)] = &[
        ("ptyxis", "ptyxis --new-window -d {dir}"),
        ("gnome-terminal", "gnome-terminal --working-directory={dir}"),
        ("kgx", "kgx --working-directory={dir}"),
        ("konsole", "konsole --workdir {dir}"),
        ("kitty", "kitty -d {dir}"),
        ("alacritty", "alacritty --working-directory {dir}"),
        ("foot", "foot -D {dir}"),
    ];
    CANDIDATES.iter().find(|(bin, _)| which(bin).is_some()).map(|(_, cmd)| cmd.to_string())
}

/// How to open a terminal that runs one program. The program and its arguments are appended as they are.
pub fn detect_terminal_run() -> Option<String> {
    const CANDIDATES: &[(&str, &str)] = &[
        ("ptyxis", "ptyxis --new-window -d {dir} --"),
        ("gnome-terminal", "gnome-terminal --working-directory={dir} --"),
        ("kgx", "kgx --working-directory={dir} --"),
        ("konsole", "konsole --workdir {dir} -e"),
        ("kitty", "kitty -d {dir}"),
        ("alacritty", "alacritty --working-directory {dir} -e"),
        ("foot", "foot -D {dir}"),
        ("xterm", "xterm -e"),
    ];
    CANDIDATES.iter().find(|(bin, _)| which(bin).is_some()).map(|(_, cmd)| cmd.to_string())
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RootSuggestion {
    pub path: String,
    pub repo_count: usize,
    pub recommended: bool,
}

/// Folders never searched for repositories (dependencies, build output, caches), unless the
/// folder is itself a repository. Hidden folders are skipped too.
const SKIP_DIRS: &[&str] = &["node_modules", "target", "snap", "vendor", "dist", "build", "__pycache__", "venv", "site-packages", "bower_components", "Pods", "DerivedData", "cmake-build-debug", "cmake-build-release"];

/// Levels searched below a repository for other, independent repositories (an `Epitech/`
/// folder that is itself versioned and holds the projects). Kept small: a project's own
/// sources are not worth walking.
const INSIDE_REPO_LEVELS: usize = 2;

/// Finds folders under `home` that contain at least two repositories.
pub fn suggest_roots(home: &Path) -> Vec<RootSuggestion> {
    let mut repos = Vec::new();
    find_repos(home, 0, 4, &mut repos);
    let mut counts: BTreeMap<PathBuf, usize> = BTreeMap::new();
    for repo in &repos {
        let mut cur = repo.parent();
        while let Some(dir) = cur {
            if dir == home || !dir.starts_with(home) {
                break;
            }
            *counts.entry(dir.to_path_buf()).or_default() += 1;
            cur = dir.parent();
        }
    }
    let mut out: Vec<(PathBuf, usize)> = counts.into_iter().filter(|(_, n)| *n >= 2).collect();
    out.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    let mut recommended: Vec<PathBuf> = Vec::new();
    // Shallowest first so that a parent wins over its children.
    let mut by_depth = out.clone();
    by_depth.sort_by_key(|(p, _)| p.components().count());
    for (path, _) in &by_depth {
        let generic = path.parent() == Some(home);
        if !generic && !recommended.iter().any(|r| path.starts_with(r)) {
            recommended.push(path.clone());
        }
    }
    out.into_iter()
        .take(12)
        .map(|(p, n)| RootSuggestion { recommended: recommended.contains(&p), path: p.to_string_lossy().into_owned(), repo_count: n })
        .collect()
}

/// Repositories under `dir`, at most `max_depth` levels down, in a stable order.
/// - Real repositories only (`git::repo_kind`); submodules are part of their parent.
/// - A repository can hold other independent repositories: they are found too (two levels in).
/// - Links to folders are followed, each real folder is visited once (no loops, no duplicates).
pub(crate) fn find_repos(dir: &Path, depth: usize, max_depth: usize, out: &mut Vec<PathBuf>) {
    let mut seen = std::collections::HashSet::new();
    walk_repos(dir, depth, max_depth, None, &mut seen, out);
}

fn walk_repos(dir: &Path, depth: usize, max_depth: usize, inside: Option<usize>, seen: &mut std::collections::HashSet<PathBuf>, out: &mut Vec<PathBuf>) {
    let Ok(real) = std::fs::canonicalize(dir) else { return };
    if !seen.insert(real) {
        return;
    }
    let kind = git::repo_kind(dir);
    let mut inside = inside;
    let mut submodules = Vec::new();
    match kind {
        Some(git::RepoKind::Submodule) => return,
        Some(_) => {
            out.push(dir.to_path_buf());
            inside = Some(0);
            submodules = git::submodule_paths(dir);
        }
        None => {}
    }
    if depth >= max_depth || inside.is_some_and(|n| n >= INSIDE_REPO_LEVELS) {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut children: Vec<PathBuf> = entries
        .flatten()
        .filter(|e| {
            let name = e.file_name();
            let name = name.to_string_lossy();
            // `metadata` follows links: a link to a folder is a folder.
            !name.starts_with('.') && std::fs::metadata(e.path()).map(|m| m.is_dir()).unwrap_or(false) && (!SKIP_DIRS.contains(&name.as_ref()) || git::is_repo(&e.path()))
        })
        .map(|e| e.path())
        .filter(|p| !submodules.contains(p))
        .collect();
    children.sort();
    for child in children {
        walk_repos(&child, depth + 1, max_depth, inside.map(|n| n + 1), seen, out);
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_setup_made_before_the_assistant_is_kept() {
        let conn = db::open_in_memory().unwrap();
        db::set_setting(&conn, "app", r#"{"roots":["/home/me/delivery"],"onboarded":false}"#).unwrap();
        assert!(adopt_existing_setup(&conn).unwrap());
        assert!(load(&conn).unwrap().onboarded);
        // A fresh install, or the assistant relaunched on purpose, is left alone.
        db::set_setting(&conn, "app", r#"{"roots":["/home/me/delivery"],"onboarded":false,"onboardingStep":"welcome"}"#).unwrap();
        assert!(!adopt_existing_setup(&conn).unwrap());
        db::set_setting(&conn, "app", r#"{"roots":[],"onboarded":false}"#).unwrap();
        assert!(!adopt_existing_setup(&conn).unwrap());
    }

    #[test]
    fn damaged_settings_keep_what_still_reads() {
        let conn = db::open_in_memory().unwrap();
        db::set_setting(&conn, "app", r#"{"roots":["/home/me/delivery"],"theme":42,"onboarded":true}"#).unwrap();
        assert!(repair(&conn).unwrap());
        let s = load(&conn).unwrap();
        assert_eq!((s.roots, s.theme.as_str(), s.onboarded), (vec!["/home/me/delivery".to_string()], "aurora", true));
        assert!(db::get_setting(&conn, "app.broken").unwrap().unwrap().contains("42"));
        assert!(!repair(&conn).unwrap());
        db::set_setting(&conn, "app", "{not json").unwrap();
        assert!(repair(&conn).unwrap());
        assert!(!load(&conn).unwrap().onboarded);
    }

    use super::*;
    use std::fs;

    /// The smallest folder git recognises as a repository.
    fn mkrepo(p: &Path) {
        fs::create_dir_all(p.join(".git")).unwrap();
        fs::write(p.join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
    }

    #[test]
    fn suggests_common_parent_and_not_generic_folders() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        mkrepo(&home.join("Documents/Git/Tek/a"));
        mkrepo(&home.join("Documents/Git/Tek/b"));
        mkrepo(&home.join("Documents/Git/Perso/c"));
        mkrepo(&home.join("Documents/other"));
        mkrepo(&home.join("lonely"));
        mkrepo(&home.join(".hidden/x/y"));
        mkrepo(&home.join("Documents/Git/Tek/node_modules/dep"));
        let s = suggest_roots(home);
        let get = |suffix: &str| s.iter().find(|r| r.path.ends_with(suffix)).cloned();
        assert_eq!(get("Documents").unwrap().repo_count, 4);
        assert!(!get("Documents").unwrap().recommended, "direct child of home is too generic");
        let git = get("Documents/Git").unwrap();
        assert_eq!(git.repo_count, 3);
        assert!(git.recommended);
        assert!(!get("Git/Tek").unwrap().recommended, "covered by its parent");
        assert!(get("Git/Perso").is_none(), "a single repo is not a projects folder");
        assert!(s.iter().all(|r| !r.path.contains(".hidden")));
    }

    #[test]
    fn save_normalises_and_validates() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("projects");
        fs::create_dir_all(root.join("tek")).unwrap();
        let conn = db::open_in_memory().unwrap();
        let root_s = root.to_string_lossy().into_owned();
        let mut s = Settings { roots: vec![root_s.clone(), format!("{root_s}/")], clone_dir: Some(format!("{root_s}/tek")), terminal_run_cmd: "xterm -e".into(), ..Default::default() };
        let saved = save(&conn, &s).unwrap();
        assert_eq!(saved.roots.len(), 1);
        assert_eq!(load(&conn).unwrap(), saved);

        s.clone_dir = Some(tmp.path().to_string_lossy().into_owned());
        assert_eq!(save(&conn, &s).unwrap_err().code(), "invalid_clone_dir");
        s.clone_dir = None;
        s.roots = vec!["/".into()];
        assert_eq!(save(&conn, &s).unwrap_err().code(), "invalid_root");
        s.roots = vec![root.join("missing").to_string_lossy().into_owned()];
        assert_eq!(save(&conn, &s).unwrap_err().code(), "invalid_root");
        s.roots = vec![root_s];
        s.theme = "neon".into();
        assert_eq!(save(&conn, &s).unwrap().theme, "neon");
        s.theme = "<script>".into();
        assert_eq!(save(&conn, &s).unwrap_err().code(), "invalid_theme");
        // New in 0.3: school folders must be inside a projects folder, the Claude path must be a program.
        s.theme = "neon".into();
        s.epitech_dirs = vec![format!("{}/tek", root.display()), format!("{}/tek/", root.display())];
        s.my_sync_minutes = 30;
        let saved = save(&conn, &s).unwrap();
        assert_eq!((saved.epitech_dirs.len(), saved.my_sync_minutes), (1, 30));
        s.epitech_dirs = vec![tmp.path().to_string_lossy().into_owned()];
        assert_eq!(save(&conn, &s).unwrap_err().code(), "invalid_dir");
        s.epitech_dirs = vec![];
        s.claude_path = Some(root.join("tek").to_string_lossy().into_owned());
        assert_eq!(save(&conn, &s).unwrap_err().code(), "invalid_claude_path", "a folder is not a program");
        s.claude_path = Some("  ".into());
        assert_eq!(save(&conn, &s).unwrap().claude_path, None);
        s.claude_path = None;
        s.my_sync_minutes = 7;
        assert_eq!(save(&conn, &s).unwrap_err().code(), "invalid_interval");
        s.my_sync_minutes = 0;
        // Settings written by an older version have no theme: the default applies.
        db::set_setting(&conn, "app", r#"{"roots":[],"ideCmd":"code"}"#).unwrap();
        assert_eq!(load(&conn).unwrap().theme, "aurora");
    }
}
