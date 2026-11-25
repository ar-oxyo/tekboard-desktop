//! Reading a subject once: the PDF text goes to Claude Code (no tool at all) with a JSON
//! schema, and the digest is kept (`project_briefs`) for every later use — Artix's answers,
//! the planning (an estimate when none was given), the moulinette. A new version of the
//! subject marks the digest out of date instead of silently keeping it.

use super::runner;
use crate::commands::AppState;
use crate::error::{AppError, Result};
use rusqlite::params;
use serde_json::{json, Value};
use std::time::Duration;

const SCHEMA: &str = r#"{"type":"object","properties":{"summary":{"type":"string","description":"Ce que demande le sujet, en 3 à 6 phrases"},"binary":{"type":"string","description":"Nom du binaire ou de la bibliothèque à rendre, vide si inconnu"},"deliverables":{"type":"array","items":{"type":"string"}},"build":{"type":"array","items":{"type":"string"},"description":"Règles de compilation et du Makefile imposées"},"allowedFunctions":{"type":"array","items":{"type":"string"}},"forbidden":{"type":"array","items":{"type":"string"}},"errorHandling":{"type":"string","description":"Codes de retour et messages d'erreur attendus"},"features":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"estimateMin":{"type":"integer"},"mandatory":{"type":"boolean"}},"required":["name","estimateMin","mandatory"]}},"testIdeas":{"type":"array","items":{"type":"string"}},"pitfalls":{"type":"array","items":{"type":"string"},"description":"Pièges classiques de ce sujet"},"estimateTotalMin":{"type":"integer","description":"Travail total réaliste pour un étudiant, en minutes"}},"required":["summary","binary","deliverables","build","allowedFunctions","forbidden","errorHandling","features","testIdeas","pitfalls","estimateTotalMin"]}"#;

const PROMPT: &str = "Voici le texte d'un sujet de projet d'Epitech. Extrais-en un résumé structuré, en français, fidèle au texte : ne devine pas ce qui n'y est pas (laisse vide). Décompose le travail en fonctionnalités avec une estimation réaliste pour un étudiant de première ou deuxième année, en minutes, tests et débogage compris. Réponds uniquement avec l'objet JSON demandé.\n\n--- SUJET ---\n";

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

/// Project key a subject belongs to: its repository, when linked.
pub fn analyze(state: &AppState, subject_id: i64) -> Result<u64> {
    super::provider::require(super::provider::Feature::Text)?;
    let s = crate::db::get_subject(&state.conn(), subject_id)?.ok_or_else(|| AppError::new("not_found", "Sujet introuvable"))?;
    let path = crate::subjects::file_path(&state.subjects(), &s);
    let text = crate::claude::pdf_text(&path, 60_000).ok_or_else(|| AppError::new("no_text", "Ce PDF ne contient pas de texte lisible (ou pdftotext est absent : sudo apt install poppler-utils)."))?;
    if let Some(id) = state.jobs.active("subject", Some(&s.hash)) {
        return Ok(id);
    }
    let db = state.db.clone();
    let model = super::chat::AiSettings::load(&state.conn()).chat_model;
    let dir = state.cache_dir.join("assistant");
    std::fs::create_dir_all(&dir)?;
    Ok(state.jobs.start(state.db.clone(), "subject", Some(s.hash.clone()), format!("Lecture du sujet · {}", s.name), &[("read", "Artix lit le sujet")], move |job| {
        job.start("read");
        let mut req = runner::Request::new(format!("{PROMPT}{text}\n--- FIN ---"), runner::Tools::None, Duration::from_secs(300));
        req.json_schema = Some(SCHEMA.into());
        req.model = Some(model).filter(|m| !m.is_empty());
        let (_o, answer) = runner::run(job, &dir, &req, &mut |_| {})?;
        let brief = match &answer {
            Ok(a) => a.structured.clone().ok_or_else(|| AppError::new("claude_failed", "La réponse n'était pas le résumé attendu.")),
            Err(e) => Err(AppError::new("claude_failed", e.to_string())),
        };
        runner::end_step(job, "read", &answer, |_| "Résumé gardé : le PDF ne sera plus relu".into());
        let brief = match brief {
            Ok(b) => b,
            Err(e) => {
                job.set("error", e.to_string());
                return Ok("failed");
            }
        };
        let key = s.repo_path.clone().unwrap_or_else(|| format!("subject:{}", s.id));
        let conn = db.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute(
            "INSERT INTO project_briefs (project, subject_id, subject_hash, brief, stale, updated_at) VALUES (?1, ?2, ?3, ?4, 0, ?5) ON CONFLICT(project) DO UPDATE SET subject_id = excluded.subject_id, subject_hash = excluded.subject_hash, brief = excluded.brief, stale = 0, updated_at = excluded.updated_at",
            params![key, s.id, s.hash, brief.to_string(), now()],
        )?;
        // An estimate for planning when the user has none yet.
        if let (Some(repo), Some(est)) = (&s.repo_path, brief["estimateTotalMin"].as_i64().filter(|m| *m > 0)) {
            let has: bool = conn.query_row("SELECT estimate_min IS NOT NULL FROM plan_projects WHERE key = ?1", [repo], |r| r.get(0)).unwrap_or(false);
            if !has {
                let _ = crate::planner::set_project(&conn, repo, None, Some(Some(est.min(2000 * 60))), None);
                job.set("estimateSet", est);
            }
        }
        if let Some(repo) = &s.repo_path {
            let summary = brief["summary"].as_str().unwrap_or_default();
            let _ = super::memory::add(&conn, &super::memory::project_scope(repo), "fact", &crate::ai::stream::clip(&format!("Sujet ({}) : {summary}", s.name), 590), "system", false, true, now());
        }
        drop(conn);
        job.set("brief", brief);
        crate::notify::changed(&["subjects", "plan", "memory", "insights"]);
        Ok("success")
    }))
}

/// The newest subject linked to a project, for "analyse the subject of X".
pub fn subject_of(state: &AppState, project: &str) -> Result<Option<i64>> {
    let linked: Vec<crate::db::Subject> = crate::db::list_subjects(&state.conn())?.into_iter().filter(|s| s.repo_path.as_deref() == Some(project)).collect();
    Ok(crate::commands_dev::pick_subject(&linked).map(|s| s.id))
}

pub fn brief_json(state: &AppState, project: &str) -> Option<Value> {
    state.conn().query_row("SELECT brief, stale FROM project_briefs WHERE project = ?1", [project], |r| Ok(json!({"brief": serde_json::from_str::<Value>(&r.get::<_, String>(0)?).unwrap_or(Value::Null), "stale": r.get::<_, i64>(1)? != 0}))).ok()
}
