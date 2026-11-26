//! Projet HUB commands (see `hub`): projects, their items and kept files, the repository's
//! activity, the summary export, and the copies shared through Connect.

use crate::commands::{now, AppState};
use crate::error::{AppError, Result};
use crate::hub::{self, Facts, Item, Project};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::State;

fn changed() {
    crate::notify::changed(&["hub"]);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubRow {
    pub project: Project,
    pub facts: Facts,
}

#[tauri::command(async)]
pub fn hub_list(state: State<'_, AppState>) -> Result<Vec<HubRow>> {
    let conn = state.conn();
    let t = now();
    hub::list(&conn)?.into_iter().map(|p| Ok(HubRow { facts: hub::facts(&conn, p.id, t)?, project: p })).collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubDetail {
    pub project: Project,
    pub items: Vec<Item>,
    pub facts: Facts,
}

#[tauri::command(async)]
pub fn hub_get(state: State<'_, AppState>, id: i64) -> Result<HubDetail> {
    let conn = state.conn();
    Ok(HubDetail { project: hub::get(&conn, id)?, items: hub::items(&conn, id)?, facts: hub::facts(&conn, id, now())? })
}

/// A local repository must be inside the project folders (the same rule as everywhere else).
fn checked_repo(state: &AppState, path: Option<&str>) -> Result<Option<String>> {
    match path.map(str::trim).filter(|p| !p.is_empty()) {
        None => Ok(None),
        Some(p) => Ok(Some(crate::commands::repo_dir(state, p)?.to_string_lossy().into_owned())),
    }
}

#[tauri::command(async)]
pub fn hub_save(state: State<'_, AppState>, project: Project) -> Result<Project> {
    let repo_path = checked_repo(&state, project.repo_path.as_deref())?;
    let saved = hub::save(&state.conn(), &Project { repo_path, ..project }, now())?;
    changed();
    Ok(saved)
}

#[tauri::command(async)]
pub fn hub_delete(state: State<'_, AppState>, id: i64) -> Result<()> {
    hub::delete(&state.conn(), id)?;
    let _ = std::fs::remove_dir_all(files_dir(&state, id));
    changed();
    Ok(())
}

#[tauri::command(async)]
pub fn hub_item_save(state: State<'_, AppState>, item: Item) -> Result<Item> {
    // Files are added with `hub_file_add`; an update never moves one.
    let path = if item.id == 0 { None } else { hub::get_item(&state.conn(), item.id)?.path };
    if item.id == 0 && item.kind == "file" {
        return Err(AppError::new("invalid_hub", "Ajoute un fichier avec « Ajouter un fichier »"));
    }
    let saved = hub::save_item(&state.conn(), &Item { path, ..item }, now())?;
    changed();
    Ok(saved)
}

/// Removes an item; returns it so the window can offer "Annuler" (files excepted: a removed file is gone).
#[tauri::command(async)]
pub fn hub_item_delete(state: State<'_, AppState>, id: i64) -> Result<Item> {
    let it = hub::delete_item(&state.conn(), id, now())?;
    if let (Some(name), "file") = (it.path.as_deref(), it.kind.as_str()) {
        let _ = std::fs::remove_file(files_dir(&state, it.project_id).join(name));
    }
    changed();
    Ok(it)
}

// ───────────────────────────── kept files ─────────────────────────────

const FILE_EXT: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "pdf", "pptx", "odp", "key", "md", "txt", "docx", "odt", "zip"];
const IMAGE_EXT: &[&str] = &["png", "jpg", "jpeg", "webp", "gif"];
const MAX_FILE: u64 = 50 * 1024 * 1024;

fn files_dir(state: &AppState, project: i64) -> PathBuf {
    state.data_dir.join("hub").join(project.to_string())
}

fn ext_of(p: &Path) -> String {
    p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase()
}

/// Copies a file picked in the open dialog (screenshot, slides, document) into the project's
/// own folder. The original is not touched.
#[tauri::command(async)]
pub fn hub_file_add(state: State<'_, AppState>, project_id: i64, path: String) -> Result<Item> {
    let project = hub::get(&state.conn(), project_id)?;
    if project.role == "viewer" {
        return Err(AppError::new("forbidden", "Ce projet t'est partagé en lecture seule"));
    }
    let src = PathBuf::from(&path);
    let meta = std::fs::symlink_metadata(&src).map_err(|_| AppError::new("not_found", "Fichier introuvable"))?;
    let ext = ext_of(&src);
    if !src.is_absolute() || !meta.is_file() || !FILE_EXT.contains(&ext.as_str()) {
        return Err(AppError::new("invalid_hub", "Choisis une image, un PDF, une présentation, un document ou une archive"));
    }
    if meta.len() > MAX_FILE {
        return Err(AppError::new("too_big", "Fichier de plus de 50 Mo : garde plutôt un lien"));
    }
    let dir = files_dir(&state, project_id);
    std::fs::create_dir_all(&dir)?;
    let stem: String = src.file_stem().and_then(|s| s.to_str()).unwrap_or("fichier").chars().map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' }).take(60).collect();
    let mut name = format!("{stem}.{ext}");
    let mut i = 2;
    while dir.join(&name).exists() {
        name = format!("{stem}-{i}.{ext}");
        i += 1;
    }
    std::fs::copy(&src, dir.join(&name))?;
    let title = src.file_name().and_then(|n| n.to_str()).unwrap_or(&name).to_string();
    let conn = state.conn();
    let t = now();
    conn.execute("INSERT INTO hub_items (project_id, kind, title, body, path, done, created_at) VALUES (?1, 'file', ?2, '', ?3, 0, ?4)", rusqlite::params![project_id, title, name, t])?;
    let it = hub::get_item(&conn, conn.last_insert_rowid())?;
    conn.execute("UPDATE hub_projects SET updated_at = ?1 WHERE id = ?2", rusqlite::params![t, project_id])?;
    changed();
    Ok(it)
}

fn kept_file(state: &AppState, item: i64) -> Result<(Item, PathBuf)> {
    let it = hub::get_item(&state.conn(), item)?;
    let name = it.path.clone().filter(|n| !n.contains('/') && !n.contains("..")).ok_or_else(|| AppError::new("not_found", "Pas de fichier"))?;
    let path = files_dir(state, it.project_id).join(name);
    if !path.is_file() {
        return Err(AppError::new("not_found", "Le fichier n'est plus là"));
    }
    Ok((it, path))
}

#[tauri::command(async)]
pub fn hub_file_open(state: State<'_, AppState>, item: i64) -> Result<()> {
    let (_, path) = kept_file(&state, item)?;
    crate::workspace::spawn_detached(&["xdg-open".to_string(), path.to_string_lossy().into_owned()], &std::env::temp_dir())
}

/// An image kept with the project, as a `data:` URL for its preview (the window shows no file path).
#[tauri::command(async)]
pub fn hub_file_preview(state: State<'_, AppState>, item: i64) -> Result<Option<String>> {
    use base64::Engine;
    let (_, path) = kept_file(&state, item)?;
    let ext = ext_of(&path);
    if !IMAGE_EXT.contains(&ext.as_str()) || std::fs::metadata(&path)?.len() > 6 * 1024 * 1024 {
        return Ok(None);
    }
    let mime = if ext == "jpg" { "jpeg".to_string() } else { ext };
    Ok(Some(format!("data:image/{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(std::fs::read(&path)?))))
}

/// Opens a project's web link (a resource or its remote repository) in the browser.
#[tauri::command(async)]
pub fn hub_open_link(state: State<'_, AppState>, project_id: i64, item: Option<i64>) -> Result<()> {
    let url = match item {
        Some(id) => hub::get_item(&state.conn(), id)?.url,
        None => hub::get(&state.conn(), project_id)?.repo_url,
    };
    let url = url.filter(|u| u.starts_with("https://") || u.starts_with("http://")).ok_or_else(|| AppError::new("not_found", "Pas d'adresse web"))?;
    crate::workspace::spawn_detached(&["xdg-open".to_string(), url], &std::env::temp_dir())
}

// ───────────────────────────── repository ─────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoView {
    pub path: String,
    pub branch: Option<String>,
    pub dirty: bool,
    pub ahead: u32,
    pub behind: u32,
    pub commits: Vec<crate::git::Commit>,
    /// Commits of the last seven days.
    pub week: usize,
    pub remote: Option<String>,
}

/// What the linked local repository says: branch, state, latest commits. `None` without one.
#[tauri::command(async)]
pub fn hub_repo(state: State<'_, AppState>, id: i64) -> Result<Option<RepoView>> {
    let p = hub::get(&state.conn(), id)?;
    let Some(path) = p.repo_path else { return Ok(None) };
    let dir = crate::commands::repo_dir(&state, &path)?;
    let status = crate::git::status(&dir)?;
    let commits = crate::git::log(&dir, None, 40).unwrap_or_default();
    let since = chrono::Utc::now() - chrono::Duration::days(7);
    let week = commits.iter().filter(|c| chrono::DateTime::parse_from_rfc3339(&c.date).is_ok_and(|d| d >= since)).count();
    Ok(Some(RepoView { path: dir.to_string_lossy().into_owned(), dirty: status.dirty(), branch: status.branch.clone(), ahead: status.ahead, behind: status.behind, week, commits: commits.into_iter().take(8).collect(), remote: crate::git::any_remote_url(&dir) }))
}

// ───────────────────────────── export ─────────────────────────────

/// Writes the summary the window built from the recorded data, to a `.md` file picked with
/// the save dialog in the home folder.
#[tauri::command(async)]
pub fn hub_export(path: String, markdown: String) -> Result<String> {
    let p = PathBuf::from(&path);
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    let parent_ok = p.parent().and_then(|d| std::fs::canonicalize(d).ok()).is_some_and(|d| d.starts_with(&home));
    if !p.is_absolute() || ext_of(&p) != "md" || !parent_ok || markdown.len() > 2 * 1024 * 1024 {
        return Err(AppError::new("invalid_path", "Choisis un fichier .md dans ton dossier personnel"));
    }
    std::fs::write(&p, markdown)?;
    Ok(p.to_string_lossy().into_owned())
}

// ───────────────────────────── sharing (through Connect) ─────────────────────────────

/// The shareable state of one of my projects, for its members (no local path, no fingerprint).
#[tauri::command(async)]
pub fn hub_snapshot(state: State<'_, AppState>, id: i64) -> Result<serde_json::Value> {
    let p = hub::get(&state.conn(), id)?;
    if p.role != "owner" {
        return Err(AppError::new("forbidden", "Seul le propriétaire partage le projet"));
    }
    hub::snapshot(&state.conn(), id)
}

/// The role of a paired device in one of my projects (`None`: not a member). The owner's
/// device checks it before answering or applying anything a member sends.
#[tauri::command(async)]
pub fn hub_member_role(state: State<'_, AppState>, id: i64, fp: String) -> Result<Option<String>> {
    hub::member_role(&state.conn(), id, &fp)
}

/// Keeps the copy of a project its owner shared with this device.
#[tauri::command(async)]
pub fn hub_import(state: State<'_, AppState>, owner: String, owner_nick: String, remote_id: i64, role: String, snapshot: serde_json::Value) -> Result<Project> {
    // Only from a paired device: the window passes on what Connect delivered.
    if owner.len() != 64 || !owner.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(AppError::new("invalid_hub", "Appareil inconnu"));
    }
    let p = hub::import_shared(&state.conn(), &owner, &owner_nick, remote_id, &role, &snapshot, now())?;
    changed();
    Ok(p)
}
