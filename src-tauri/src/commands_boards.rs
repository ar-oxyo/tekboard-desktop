//! Commands of the whiteboards.

use crate::boards::{self, Board, BoardMeta, Version};
use crate::commands::{now, AppState};
use crate::error::{AppError, Result};
use base64::Engine;
use serde_json::{Map, Value};
use std::path::PathBuf;
use std::time::Duration;
use tauri::State;

#[tauri::command(async)]
pub fn board_list(state: State<'_, AppState>, project: Option<String>, query: Option<String>) -> Result<Vec<BoardMeta>> {
    boards::list(&state.conn(), project.as_deref(), query.as_deref())
}

#[tauri::command(async)]
pub fn board_create(state: State<'_, AppState>, name: String, project: Option<String>) -> Result<BoardMeta> {
    boards::create(&state.conn(), &state.data_dir, &name, project.as_deref(), now())
}

#[tauri::command(async)]
pub fn board_get(state: State<'_, AppState>, id: String) -> Result<Board> {
    boards::get(&state.conn(), &state.data_dir, &id)
}

#[tauri::command(async)]
pub fn board_save(state: State<'_, AppState>, id: String, elements: Value, app_state: Value, files: Map<String, Value>, thumb: Option<String>) -> Result<BoardMeta> {
    boards::save(&state.conn(), &state.data_dir, &id, &elements, &app_state, &files, thumb.as_deref(), now())
}

#[tauri::command(async)]
pub fn board_rename(state: State<'_, AppState>, id: String, name: String) -> Result<()> {
    boards::rename(&state.conn(), &id, &name)
}

#[tauri::command(async)]
pub fn board_set_project(state: State<'_, AppState>, id: String, project: Option<String>) -> Result<()> {
    boards::set_project(&state.conn(), &id, project.as_deref())
}

#[tauri::command(async)]
pub fn board_set_position(state: State<'_, AppState>, id: String, position: i64) -> Result<()> {
    boards::set_position(&state.conn(), &id, position)
}

#[tauri::command(async)]
pub fn board_duplicate(state: State<'_, AppState>, id: String) -> Result<BoardMeta> {
    boards::duplicate(&state.conn(), &state.data_dir, &id, now())
}

#[tauri::command(async)]
pub fn board_delete(state: State<'_, AppState>, id: String) -> Result<()> {
    boards::delete(&state.conn(), &state.data_dir, &id)
}

#[tauri::command(async)]
pub fn board_versions(state: State<'_, AppState>, id: String) -> Result<Vec<Version>> {
    boards::versions(&state.conn(), &id)
}

#[tauri::command(async)]
pub fn board_restore(state: State<'_, AppState>, id: String, at: i64) -> Result<Board> {
    boards::restore(&state.conn(), &state.data_dir, &id, at, now())
}

const EXPORT_EXT: &[&str] = &["png", "svg", "pdf", "tekboard-board", "jpg"];

/// A path picked in the save dialog: absolute, in the home folder, with an export extension.
fn export_path(path: &str) -> Result<PathBuf> {
    let p = PathBuf::from(path);
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let ok_ext = EXPORT_EXT.contains(&ext.as_str()) || name.ends_with(".tekboard-board");
    let parent_ok = p.parent().and_then(|d| std::fs::canonicalize(d).ok()).is_some_and(|d| d.starts_with(&home));
    if !p.is_absolute() || !ok_ext || !parent_ok {
        return Err(AppError::new("invalid_path", "Choisis un fichier .png, .svg, .pdf ou .tekboard-board dans ton dossier personnel"));
    }
    Ok(p)
}

/// Writes an export picked with the save dialog. `base64` for images, `text` for SVG and boards.
#[tauri::command(async)]
pub fn board_write_file(path: String, base64: Option<String>, text: Option<String>) -> Result<()> {
    let p = export_path(&path)?;
    let bytes = match (base64, text) {
        (Some(b), _) => base64::engine::general_purpose::STANDARD.decode(b.split(',').next_back().unwrap_or("")).map_err(|_| AppError::new("bad_image", "Image illisible"))?,
        (None, Some(t)) => t.into_bytes(),
        _ => return Err(AppError::new("invalid", "Rien à écrire")),
    };
    if bytes.len() > 200 * 1024 * 1024 {
        return Err(AppError::new("too_big", "Export trop gros"));
    }
    std::fs::write(p, bytes)?;
    Ok(())
}

/// A PDF of the board: the window renders it as a JPEG, this wraps it in a page.
#[tauri::command(async)]
pub fn board_write_pdf(path: String, jpeg: String, width: u32, height: u32) -> Result<()> {
    let p = export_path(&path)?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(jpeg.split(',').next_back().unwrap_or("")).map_err(|_| AppError::new("bad_image", "Image illisible"))?;
    std::fs::write(p, boards::pdf_from_jpeg(&bytes, width, height)?)?;
    Ok(())
}

#[tauri::command(async)]
pub fn board_export_json(state: State<'_, AppState>, id: String) -> Result<String> {
    Ok(boards::export_json(&state.conn(), &state.data_dir, &id)?.1)
}

/// Imports a `.tekboard-board` (or `.excalidraw`) file chosen with the open dialog.
#[tauri::command(async)]
pub fn board_import(state: State<'_, AppState>, path: String, project: Option<String>) -> Result<BoardMeta> {
    let meta = std::fs::metadata(&path).map_err(|_| AppError::new("not_found", "Fichier introuvable"))?;
    if !meta.is_file() || meta.len() > boards::MAX_SCENE as u64 {
        return Err(AppError::new("too_big", "Fichier trop gros ou illisible"));
    }
    boards::import_json(&state.conn(), &state.data_dir, &std::fs::read_to_string(&path)?, project.as_deref(), now())
}

/// Copies the board into a project, on request: `docs/boards/<name>.tekboard-board` (never overwritten).
#[tauri::command(async)]
pub fn board_export_to_project(state: State<'_, AppState>, id: String, repo: String) -> Result<String> {
    let dir = crate::commands::project_dir(&state, &repo)?;
    let (name, json) = boards::export_json(&state.conn(), &state.data_dir, &id)?;
    let slug: String = name.chars().map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' }).collect::<String>().trim_matches('-').chars().take(50).collect();
    let slug = if slug.is_empty() { "tableau".to_string() } else { slug };
    let target = dir.join("docs").join("boards");
    std::fs::create_dir_all(&target)?;
    let mut path = target.join(format!("{slug}.tekboard-board"));
    let mut i = 2;
    while path.exists() {
        path = target.join(format!("{slug}-{i}.tekboard-board"));
        i += 1;
    }
    std::fs::write(&path, json)?;
    crate::notify::changed(&["repos"]);
    Ok(path.to_string_lossy().into_owned())
}

pub fn ai_prompt(kind: &str, request: &str, context: &str) -> Result<String> {
    let request: String = request.chars().take(4000).collect();
    let context: String = context.chars().take(20_000).collect();
    Ok(match kind {
        "diagram" => format!(
            "Tu dessines un schéma pour un tableau blanc d'étudiant en informatique (C, Unix). Demande :\n{request}\n\nContenu actuel du tableau (pour le contexte, peut être vide) :\n{context}\n\n\
Réponds UNIQUEMENT avec un bloc ```mermaid``` valide : `flowchart TD` (algorithme, organigramme, architecture, structures de données reliées), `sequenceDiagram` (échanges client-serveur) ou `classDiagram` (structures, UML). \
Libellés courts en français, au plus 25 nœuds. Pour une structure de données (liste chaînée, arbre, pile…), fais un flowchart dont chaque nœud est un maillon et chaque flèche un pointeur."
        ),
        "annotate" => format!(
            "Voici le texte d'un tableau blanc d'étudiant en informatique :\n{context}\n\nAjoute au plus 6 annotations pédagogiques courtes (une ou deux phrases) qui expliquent ou corrigent ce qui est dessiné. {request}\n\
Réponds UNIQUEMENT avec un bloc ```json``` : [{{\"anchor\": \"texte exact d'un élément du tableau\", \"note\": \"annotation\"}}]. N'invente pas d'élément : `anchor` doit reprendre un texte présent."
        ),
        _ => return Err(AppError::new("invalid", "Demande inconnue")),
    })
}

/// Artix on a board: a diagram (Mermaid) or annotations (JSON). The window shows the result
/// as a preview to accept or cancel; nothing is added by itself.
#[tauri::command(async)]
pub fn board_ai(state: State<'_, AppState>, kind: String, request: String, context: String) -> Result<u64> {
    crate::ai::provider::require(crate::ai::provider::Feature::Text)?;
    let prompt = ai_prompt(&kind, &request, &context)?;
    let root = state.cache_dir.join(format!("board-ai-{}", chrono::Utc::now().timestamp_micros()));
    Ok(state.jobs.start(state.db.clone(), "board_ai", None, "Tableau · Artix".into(), &[("answer", "Réponse d'Artix")], move |job| {
        job.start("answer");
        let _ = std::fs::create_dir_all(&root);
        let r = crate::claude::run_chat(job, &root, &prompt, Duration::from_secs(240));
        let _ = std::fs::remove_dir_all(&root);
        let (outcome, answer) = r?;
        if outcome.cancelled {
            return Ok("cancelled");
        }
        let answer = answer?;
        job.set("kind", &kind);
        job.set("answer", answer.text.trim());
        job.end("answer", "success", None);
        Ok("success")
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exports_only_land_where_they_should() {
        let home = std::env::var("HOME").unwrap();
        assert!(export_path(&format!("{home}/schema.png")).is_ok());
        assert!(export_path(&format!("{home}/tableau.tekboard-board")).is_ok());
        for bad in ["/etc/x.png".to_string(), format!("{home}/x.sh"), "relative.png".to_string(), format!("{home}/no/such/dir/x.png")] {
            assert!(export_path(&bad).is_err(), "{bad}");
        }
        assert!(ai_prompt("diagram", "une liste chaînée", "").unwrap().contains("```mermaid```"));
        assert!(ai_prompt("rm", "", "").is_err());
    }
}
