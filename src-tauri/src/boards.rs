//! Whiteboards: kept in TekBoard's data folder (never in a repository unless exported on
//! purpose), one JSON scene per board plus its images, an index for search (names and the
//! text written on the board), thumbnails, and a history of versions.
//!
//! Scenes come from Excalidraw in the window, from files the user imports, from TekShare or
//! from a collaborator: every one is checked (size, element count, element shapes, image
//! types) before it is stored.

use crate::error::{AppError, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

pub const MAX_SCENE: usize = 25 * 1024 * 1024;
pub const MAX_ELEMENTS: usize = 20_000;
pub const MAX_FILE: usize = 4 * 1024 * 1024;
const VERSION_EVERY: i64 = 5 * 60;
const VERSIONS_KEPT: i64 = 30;
pub const FORMAT: &str = "tekboard-board";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardMeta {
    pub id: String,
    pub name: String,
    pub project: Option<String>,
    pub thumb: Option<String>,
    pub position: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub elements: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Board {
    pub meta: BoardMeta,
    pub elements: Value,
    pub app_state: Value,
    /// `fileId → {mimeType, dataURL, id, created}` as Excalidraw keeps them.
    pub files: Map<String, Value>,
}

fn dir(data: &Path) -> PathBuf {
    data.join("boards")
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 80 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn scene_path(data: &Path, id: &str) -> Result<PathBuf> {
    if !valid_id(id) {
        return Err(AppError::new("invalid", "Identifiant de tableau invalide"));
    }
    Ok(dir(data).join(format!("{id}.json")))
}

fn files_dir(data: &Path, id: &str) -> Result<PathBuf> {
    if !valid_id(id) {
        return Err(AppError::new("invalid", "Identifiant de tableau invalide"));
    }
    Ok(dir(data).join(id).join("files"))
}

const ELEMENT_TYPES: &[&str] = &["rectangle", "diamond", "ellipse", "arrow", "line", "freedraw", "text", "image", "frame", "magicframe", "embeddable", "iframe", "selection"];
const IMAGE_TYPES: &[&str] = &["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"];

/// Checks the elements of a scene: an array of objects with an id and a known type.
pub fn check_elements(elements: &Value) -> Result<usize> {
    let arr = elements.as_array().ok_or_else(|| AppError::new("bad_board", "Tableau illisible : pas de liste d'éléments"))?;
    if arr.len() > MAX_ELEMENTS {
        return Err(AppError::new("bad_board", format!("Trop d'éléments ({} au plus)", MAX_ELEMENTS)));
    }
    for e in arr {
        let ok = e.get("id").and_then(Value::as_str).is_some_and(|s| !s.is_empty() && s.len() <= 100) && e.get("type").and_then(Value::as_str).is_some_and(|t| ELEMENT_TYPES.contains(&t));
        if !ok {
            return Err(AppError::new("bad_board", "Tableau illisible : élément inconnu"));
        }
        // Embedded web pages would load anything from anywhere: refused.
        if matches!(e["type"].as_str(), Some("embeddable" | "iframe")) {
            return Err(AppError::new("bad_board", "Les pages web intégrées ne sont pas acceptées dans un tableau TekBoard"));
        }
    }
    Ok(arr.len())
}

/// Checks one image: an allowed type, a data URL of that type, within size.
pub fn check_file(id: &str, f: &Value) -> Result<()> {
    let mime = f["mimeType"].as_str().unwrap_or("");
    let url = f["dataURL"].as_str().unwrap_or("");
    if !valid_id(id) || !IMAGE_TYPES.contains(&mime) || !url.starts_with(&format!("data:{mime};base64,")) || url.len() > MAX_FILE * 4 / 3 + 64 {
        return Err(AppError::new("bad_board", "Image refusée (type ou taille)"));
    }
    Ok(())
}

/// The text written on the board (for search, Artix and previews).
pub fn text_of(elements: &Value) -> String {
    let mut out = String::new();
    for e in elements.as_array().into_iter().flatten() {
        if e["isDeleted"] == true {
            continue;
        }
        if let Some(t) = e["text"].as_str().or_else(|| e["customData"]["code"].as_str()) {
            if !t.trim().is_empty() {
                out.push_str(t.trim());
                out.push('\n');
            }
        }
        if out.len() > 200_000 {
            break;
        }
    }
    out
}

/// Only what a board needs from Excalidraw's app state (no user preferences, no ids).
pub fn clean_app_state(a: &Value) -> Value {
    let mut out = Map::new();
    for k in ["viewBackgroundColor", "gridSize", "gridStep", "gridModeEnabled", "objectsSnapModeEnabled", "scrollX", "scrollY"] {
        if let Some(v) = a.get(k) {
            if v.is_number() || v.is_string() || v.is_boolean() || v.is_null() {
                out.insert(k.into(), v.clone());
            }
        }
    }
    if let Some(z) = a["zoom"]["value"].as_f64() {
        out.insert("zoom".into(), json!({"value": z.clamp(0.1, 30.0)}));
    }
    Value::Object(out)
}

fn row(r: &rusqlite::Row) -> rusqlite::Result<BoardMeta> {
    Ok(BoardMeta { id: r.get(0)?, name: r.get(1)?, project: r.get(2)?, thumb: r.get(3)?, position: r.get(4)?, created_at: r.get(5)?, updated_at: r.get(6)?, elements: r.get(7)? })
}

const COLS: &str = "id, name, project, thumb, position, created_at, updated_at, elements";

/// Boards, most recent first; `project` narrows to one project, `query` searches names and text.
pub fn list(conn: &Connection, project: Option<&str>, query: Option<&str>) -> Result<Vec<BoardMeta>> {
    let q = query.map(str::trim).filter(|q| !q.is_empty()).map(|q| format!("%{}%", q.replace(['%', '_'], "")));
    let mut st = conn.prepare(&format!("SELECT {COLS} FROM boards WHERE (?1 IS NULL OR project = ?1) AND (?2 IS NULL OR name LIKE ?2 OR text LIKE ?2) ORDER BY position DESC, updated_at DESC LIMIT 500"))?;
    let rows = st.query_map(params![project, q], row)?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

pub fn meta(conn: &Connection, id: &str) -> Result<BoardMeta> {
    conn.query_row(&format!("SELECT {COLS} FROM boards WHERE id = ?1"), [id], row).optional()?.ok_or_else(|| AppError::new("not_found", "Ce tableau n'existe plus"))
}

fn new_id() -> String {
    let mut b = [0u8; 9];
    if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
        use std::io::Read;
        let _ = f.read_exact(&mut b);
    }
    format!("b{}", b.iter().map(|x| format!("{x:02x}")).collect::<String>())
}

fn clean_name(name: &str) -> String {
    let n: String = name.chars().filter(|c| !c.is_control()).collect::<String>().trim().chars().take(80).collect();
    if n.is_empty() { "Tableau".into() } else { n }
}

pub fn create(conn: &Connection, data: &Path, name: &str, project: Option<&str>, now: i64) -> Result<BoardMeta> {
    let id = new_id();
    std::fs::create_dir_all(dir(data))?;
    std::fs::write(scene_path(data, &id)?, json!({"elements": [], "appState": {}}).to_string())?;
    conn.execute("INSERT INTO boards (id, name, project, thumb, position, text, elements, created_at, updated_at) VALUES (?1, ?2, ?3, NULL, 0, '', 0, ?4, ?4)", params![id, clean_name(name), project, now])?;
    meta(conn, &id)
}

pub fn get(conn: &Connection, data: &Path, id: &str) -> Result<Board> {
    let m = meta(conn, id)?;
    let scene: Value = serde_json::from_str(&std::fs::read_to_string(scene_path(data, id)?).unwrap_or_default()).unwrap_or(json!({}));
    let mut files = Map::new();
    if let Ok(rd) = std::fs::read_dir(files_dir(data, id)?) {
        for e in rd.flatten() {
            if let Ok(v) = std::fs::read_to_string(e.path()).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()).ok_or(()) {
                if let Some(fid) = v["id"].as_str() {
                    files.insert(fid.to_string(), v);
                }
            }
        }
    }
    Ok(Board { meta: m, elements: scene.get("elements").cloned().unwrap_or(json!([])), app_state: scene.get("appState").cloned().unwrap_or(json!({})), files })
}

/// Stores new images (already-known ids are kept as they are).
pub fn add_files(data: &Path, id: &str, files: &Map<String, Value>) -> Result<usize> {
    let d = files_dir(data, id)?;
    std::fs::create_dir_all(&d)?;
    let mut n = 0;
    for (fid, f) in files {
        check_file(fid, f)?;
        let path = d.join(format!("{fid}.json"));
        if path.exists() {
            continue;
        }
        let v = json!({"id": fid, "mimeType": f["mimeType"], "dataURL": f["dataURL"], "created": f["created"].as_i64().unwrap_or(0)});
        std::fs::write(path, v.to_string())?;
        n += 1;
    }
    Ok(n)
}

/// Saves the scene (autosave), the search text and the thumbnail; keeps a version now and then.
pub fn save(conn: &Connection, data: &Path, id: &str, elements: &Value, app_state: &Value, files: &Map<String, Value>, thumb: Option<&str>, now: i64) -> Result<BoardMeta> {
    let prev = meta(conn, id)?;
    let count = check_elements(elements)?;
    add_files(data, id, files)?;
    let scene = json!({"elements": elements, "appState": clean_app_state(app_state)}).to_string();
    if scene.len() > MAX_SCENE {
        return Err(AppError::new("too_big", "Tableau trop gros"));
    }
    let path = scene_path(data, id)?;
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, &scene)?;
    std::fs::rename(&tmp, &path)?;
    let thumb = thumb.filter(|t| t.starts_with("data:image/png;base64,") && t.len() < 400_000);
    conn.execute("UPDATE boards SET text = ?2, elements = ?3, updated_at = ?4, thumb = COALESCE(?5, thumb) WHERE id = ?1", params![id, text_of(elements), count as i64, now, thumb])?;
    let last: Option<i64> = conn.query_row("SELECT MAX(at) FROM board_versions WHERE board_id = ?1", [id], |r| r.get(0)).optional()?.flatten();
    if count > 0 && last.is_none_or(|l| now - l >= VERSION_EVERY) && (prev.elements > 0 || last.is_none()) {
        conn.execute("INSERT INTO board_versions (board_id, at, elements, scene) VALUES (?1, ?2, ?3, ?4)", params![id, now, count as i64, scene])?;
        conn.execute("DELETE FROM board_versions WHERE board_id = ?1 AND at NOT IN (SELECT at FROM board_versions WHERE board_id = ?1 ORDER BY at DESC LIMIT ?2)", params![id, VERSIONS_KEPT])?;
    }
    meta(conn, id)
}

pub fn rename(conn: &Connection, id: &str, name: &str) -> Result<()> {
    conn.execute("UPDATE boards SET name = ?2 WHERE id = ?1", params![id, clean_name(name)])?;
    Ok(())
}

pub fn set_project(conn: &Connection, id: &str, project: Option<&str>) -> Result<()> {
    conn.execute("UPDATE boards SET project = ?2 WHERE id = ?1", params![id, project])?;
    Ok(())
}

/// Pinned boards come first in lists (a larger position is higher).
pub fn set_position(conn: &Connection, id: &str, position: i64) -> Result<()> {
    conn.execute("UPDATE boards SET position = ?2 WHERE id = ?1", params![id, position.clamp(-1_000_000, 1_000_000)])?;
    Ok(())
}

pub fn duplicate(conn: &Connection, data: &Path, id: &str, now: i64) -> Result<BoardMeta> {
    let b = get(conn, data, id)?;
    let copy = create(conn, data, &format!("{} (copie)", b.meta.name), b.meta.project.as_deref(), now)?;
    add_files(data, &copy.id, &b.files)?;
    save(conn, data, &copy.id, &b.elements, &b.app_state, &Map::new(), b.meta.thumb.as_deref(), now)
}

pub fn delete(conn: &Connection, data: &Path, id: &str) -> Result<()> {
    meta(conn, id)?;
    conn.execute("DELETE FROM board_versions WHERE board_id = ?1", [id])?;
    conn.execute("DELETE FROM boards WHERE id = ?1", [id])?;
    let _ = std::fs::remove_file(scene_path(data, id)?);
    let _ = std::fs::remove_dir_all(dir(data).join(id));
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Version {
    pub at: i64,
    pub elements: i64,
}

pub fn versions(conn: &Connection, id: &str) -> Result<Vec<Version>> {
    let mut st = conn.prepare("SELECT at, elements FROM board_versions WHERE board_id = ?1 ORDER BY at DESC")?;
    let rows = st.query_map([id], |r| Ok(Version { at: r.get(0)?, elements: r.get(1)? }))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

/// Puts a past version back (the current one is kept as a version first).
pub fn restore(conn: &Connection, data: &Path, id: &str, at: i64, now: i64) -> Result<Board> {
    let scene: String = conn.query_row("SELECT scene FROM board_versions WHERE board_id = ?1 AND at = ?2", params![id, at], |r| r.get(0)).optional()?.ok_or_else(|| AppError::new("not_found", "Cette version n'existe plus"))?;
    let cur = std::fs::read_to_string(scene_path(data, id)?).unwrap_or_default();
    let count = serde_json::from_str::<Value>(&cur).ok().and_then(|v| v["elements"].as_array().map(|a| a.len() as i64)).unwrap_or(0);
    if count > 0 {
        conn.execute("INSERT OR REPLACE INTO board_versions (board_id, at, elements, scene) VALUES (?1, ?2, ?3, ?4)", params![id, now, count, cur])?;
    }
    let v: Value = serde_json::from_str(&scene)?;
    save(conn, data, id, &v["elements"], &v["appState"], &Map::new(), None, now + 1)?;
    get(conn, data, id)
}

/// The `.tekboard-board` format: a versioned JSON file, importable and editable again.
pub fn export_json(conn: &Connection, data: &Path, id: &str) -> Result<(String, String)> {
    let b = get(conn, data, id)?;
    let v = json!({"type": FORMAT, "version": 1, "name": b.meta.name, "elements": b.elements, "appState": clean_app_state(&b.app_state), "files": b.files});
    Ok((b.meta.name, serde_json::to_string(&v)?))
}

/// Reads a `.tekboard-board` (or Excalidraw `.excalidraw`) file and makes a board of it.
pub fn import_json(conn: &Connection, data: &Path, text: &str, project: Option<&str>, now: i64) -> Result<BoardMeta> {
    if text.len() > MAX_SCENE {
        return Err(AppError::new("too_big", "Fichier trop gros"));
    }
    let v: Value = serde_json::from_str(text).map_err(|_| AppError::new("bad_board", "Ce fichier n'est pas un tableau lisible"))?;
    let kind = v["type"].as_str().unwrap_or("");
    if kind != FORMAT && kind != "excalidraw" {
        return Err(AppError::new("bad_board", "Ce fichier n'est pas un tableau TekBoard (.tekboard-board) ni Excalidraw"));
    }
    if kind == FORMAT && v["version"].as_u64().unwrap_or(0) > 1 {
        return Err(AppError::new("bad_board", "Ce tableau vient d'une version plus récente de TekBoard : mets TekBoard à jour"));
    }
    check_elements(&v["elements"])?;
    let files = v["files"].as_object().cloned().unwrap_or_default();
    for (fid, f) in &files {
        check_file(fid, f)?;
    }
    let name = v["name"].as_str().unwrap_or("Tableau importé");
    let b = create(conn, data, name, project, now)?;
    add_files(data, &b.id, &files)?;
    save(conn, data, &b.id, &v["elements"], &v["appState"], &Map::new(), None, now)
}

/// A one-page PDF holding a JPEG image (`width`×`height` pixels), written without any library.
pub fn pdf_from_jpeg(jpeg: &[u8], width: u32, height: u32) -> Result<Vec<u8>> {
    if jpeg.len() < 4 || jpeg[0] != 0xFF || jpeg[1] != 0xD8 || width == 0 || height == 0 {
        return Err(AppError::new("bad_image", "Image JPEG invalide"));
    }
    // Page size in points (1/72 in), image drawn at 96 dpi.
    let (pw, ph) = (width as f64 * 0.75, height as f64 * 0.75);
    let content = format!("q {pw:.2} 0 0 {ph:.2} 0 0 cm /Im0 Do Q");
    let mut out: Vec<u8> = Vec::new();
    let mut offsets = Vec::new();
    out.extend_from_slice(b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
    let mut obj = |out: &mut Vec<u8>, body: &[u8]| {
        offsets.push(out.len());
        out.extend_from_slice(format!("{} 0 obj\n", offsets.len()).as_bytes());
        out.extend_from_slice(body);
        out.extend_from_slice(b"\nendobj\n");
    };
    obj(&mut out, b"<< /Type /Catalog /Pages 2 0 R >>");
    obj(&mut out, b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
    obj(&mut out, format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {pw:.2} {ph:.2}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>").as_bytes());
    let mut img = format!("<< /Type /XObject /Subtype /Image /Width {width} /Height {height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length {} >>\nstream\n", jpeg.len()).into_bytes();
    img.extend_from_slice(jpeg);
    img.extend_from_slice(b"\nendstream");
    obj(&mut out, &img);
    obj(&mut out, format!("<< /Length {} >>\nstream\n{content}\nendstream", content.len()).as_bytes());
    let xref = out.len();
    out.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", offsets.len() + 1).as_bytes());
    for o in &offsets {
        out.extend_from_slice(format!("{o:010} 00000 n \n").as_bytes());
    }
    out.extend_from_slice(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", offsets.len() + 1).as_bytes());
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn el(id: &str, ty: &str, text: Option<&str>) -> Value {
        let mut v = json!({"id": id, "type": ty, "x": 0, "y": 0, "version": 1});
        if let Some(t) = text {
            v["text"] = json!(t);
        }
        v
    }

    #[test]
    fn boards_are_saved_searched_versioned_and_restored() {
        let conn = crate::db::open_in_memory().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let d = tmp.path();
        let b = create(&conn, d, "  Architecture  ", Some("/p/minishell"), 10).unwrap();
        assert_eq!(b.name, "Architecture");
        let els = json!([el("a", "rectangle", None), el("t", "text", Some("liste chaînée"))]);
        let png = format!("data:image/png;base64,{}", "A".repeat(100));
        let mut files = Map::new();
        files.insert("img1".into(), json!({"mimeType": "image/png", "dataURL": png, "id": "img1"}));
        save(&conn, d, &b.id, &els, &json!({"viewBackgroundColor": "#fff", "selectedElementIds": {"a": true}}), &files, Some("data:image/png;base64,xx"), 20).unwrap();
        let got = get(&conn, d, &b.id).unwrap();
        assert_eq!(got.elements.as_array().unwrap().len(), 2);
        assert!(got.app_state.get("selectedElementIds").is_none(), "only what a board needs is kept");
        assert!(got.files.contains_key("img1"));
        assert_eq!(list(&conn, None, Some("chaînée")).unwrap().len(), 1);
        assert_eq!(list(&conn, Some("/p/other"), None).unwrap().len(), 0);
        assert_eq!(versions(&conn, &b.id).unwrap().len(), 1);
        // A later edit, more than 5 minutes after: a second version.
        save(&conn, d, &b.id, &json!([el("a", "rectangle", None)]), &json!({}), &Map::new(), None, 20 + VERSION_EVERY + 1).unwrap();
        assert_eq!(versions(&conn, &b.id).unwrap().len(), 2);
        let restored = restore(&conn, d, &b.id, 20, 1000).unwrap();
        assert_eq!(restored.elements.as_array().unwrap().len(), 2);
        let dup = duplicate(&conn, d, &b.id, 2000).unwrap();
        assert!(dup.name.contains("copie"));
        assert!(get(&conn, d, &dup.id).unwrap().files.contains_key("img1"));
        delete(&conn, d, &b.id).unwrap();
        assert!(get(&conn, d, &b.id).is_err());
    }

    #[test]
    fn imports_are_checked() {
        let conn = crate::db::open_in_memory().unwrap();
        let tmp = tempfile::tempdir().unwrap();
        let d = tmp.path();
        let b = create(&conn, d, "x", None, 1).unwrap();
        save(&conn, d, &b.id, &json!([el("t", "text", Some("bonjour"))]), &json!({}), &Map::new(), None, 2).unwrap();
        let (_, text) = export_json(&conn, d, &b.id).unwrap();
        let again = import_json(&conn, d, &text, None, 3).unwrap();
        assert_eq!(again.elements, 1);
        for bad in [
            r#"{"type":"other","elements":[]}"#.to_string(),
            r#"{"type":"tekboard-board","version":9,"elements":[]}"#.to_string(),
            r#"{"type":"tekboard-board","version":1,"elements":[{"id":"x","type":"script"}]}"#.to_string(),
            r#"{"type":"excalidraw","elements":[{"id":"x","type":"embeddable"}]}"#.to_string(),
            r#"{"type":"tekboard-board","version":1,"elements":[],"files":{"f":{"mimeType":"text/html","dataURL":"data:text/html;base64,PHNjcmlwdD4="}}}"#.to_string(),
            "not json".to_string(),
        ] {
            assert!(import_json(&conn, d, &bad, None, 4).is_err(), "{bad}");
        }
        assert!(scene_path(d, "../etc").is_err());
    }

    #[test]
    fn pdf_wraps_a_jpeg() {
        let jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 0xFF, 0xD9];
        let pdf = pdf_from_jpeg(&jpeg, 800, 600).unwrap();
        let text = String::from_utf8_lossy(&pdf);
        assert!(text.starts_with("%PDF-1.4") && text.contains("/DCTDecode") && text.contains("/MediaBox [0 0 600.00 450.00]") && text.trim_end().ends_with("%%EOF"));
        // The cross-reference table must sit at the byte offset `startxref` announces.
        let xref = pdf.windows(5).position(|w| w == b"xref\n").unwrap();
        assert!(text.contains(&format!("startxref\n{xref}")));
        assert!(pdf_from_jpeg(b"PNG", 1, 1).is_err());
    }
}
