//! Where a received resource goes. Each kind has its destinations (a C function into the
//! libraries or the Playground, a template into the templates, a patch previewed then
//! applied to a project, tests into a project's `tests/` folder…). Nothing received is ever
//! run: a patch is checked with `git apply --check` and applied only on request, files land
//! without the execute bit, and nothing is overwritten.

use super::share::{self, Manifest};
use crate::commands::{now, AppState};
use crate::error::{AppError, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    pub transfer: share::Transfer,
    pub manifest: Manifest,
    /// `(path, size, text preview)`.
    pub files: Vec<(String, u64, Option<String>)>,
    /// Where it can go, in order of relevance: `playground`, `library`, `template`, `prompt`,
    /// `project`, `patch`, `arena`, `artix`, `downloads`, `config`.
    pub destinations: Vec<String>,
}

pub fn destinations(kind: &str) -> Vec<&'static str> {
    match kind {
        "cfunction" => vec!["library", "playground", "downloads"],
        "snippet" | "draft" => vec!["playground", "downloads"],
        "library" => vec!["library", "downloads"],
        "template" => vec!["template", "downloads"],
        "prompt" => vec!["prompt", "downloads"],
        "tests" => vec!["project", "downloads"],
        "arena" => vec!["arena", "downloads"],
        "log" | "error" => vec!["artix", "downloads"],
        "patch" => vec!["patch", "downloads"],
        "config" => vec!["config"],
        "note" => vec!["downloads", "artix"],
        "file" | "folder" => vec!["downloads", "playground"],
        _ => vec!["downloads"],
    }
}

pub fn open(svc: &super::Service, id: &str) -> Result<Opened> {
    let (t, m, files) = share::opened(svc, id)?;
    let list = files.iter().map(|(p, b)| (p.to_string_lossy().into_owned(), b.len() as u64, std::str::from_utf8(b).ok().map(|s| s.chars().take(4000).collect()))).collect();
    let destinations = destinations(&m.kind).into_iter().map(String::from).collect();
    Ok(Opened { transfer: t, manifest: m, files: list, destinations })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "to", rename_all = "camelCase")]
pub enum Target {
    Playground,
    Library { name: String },
    Template { name: String },
    Prompt { preset: String },
    /// Copies the files into a project, under `subdir` (`tests` for tests).
    Project { repo: String, subdir: String },
    /// `apply: false` only checks.
    Patch { repo: String, apply: bool },
    Arena,
    Downloads,
    Config,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Imported {
    pub detail: String,
    /// What the screen opens next: `{"page": "...", "id": ...}`.
    pub open: Value,
}

fn text_of(files: &[(PathBuf, Vec<u8>)]) -> Result<String> {
    let (_, b) = files.first().ok_or_else(|| AppError::new("empty", "Paquet vide"))?;
    String::from_utf8(b.clone()).map_err(|_| AppError::new("not_text", "Contenu non textuel"))
}

fn slug(s: &str) -> String {
    let v: String = s.chars().map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' }).collect();
    let v = v.trim_matches('-').chars().take(40).collect::<String>();
    if v.is_empty() { "partage".into() } else { v }
}

/// A folder name that does not exist yet under `parent`.
fn fresh(parent: &Path, name: &str) -> PathBuf {
    let base = parent.join(name);
    if !base.exists() {
        return base;
    }
    (2..1000).map(|i| parent.join(format!("{name}-{i}"))).find(|p| !p.exists()).unwrap_or_else(|| parent.join(format!("{name}-{}", now())))
}

pub fn import(state: &AppState, svc: &super::Service, downloads: &Path, id: &str, target: &Target) -> Result<Imported> {
    let (t, m, files) = share::opened(svc, id)?;
    let allowed = destinations(&m.kind);
    let name = match target {
        Target::Playground => "playground",
        Target::Library { .. } => "library",
        Target::Template { .. } => "template",
        Target::Prompt { .. } => "prompt",
        Target::Project { .. } => "project",
        Target::Patch { .. } => "patch",
        Target::Arena => "arena",
        Target::Downloads => "downloads",
        Target::Config => "config",
    };
    if !allowed.contains(&name) {
        return Err(AppError::new("invalid_target", "Cette destination ne convient pas à ce type de ressource"));
    }
    let done = |detail: String, open: Value| -> Result<Imported> {
        if !matches!(target, Target::Patch { apply: false, .. }) {
            share::mark_imported(svc, id, detail.clone());
        }
        Ok(Imported { detail, open })
    };
    match target {
        Target::Playground => {
            let mut dfiles: Vec<crate::playground::DraftFile> = files
                .iter()
                .filter(|(p, b)| p.extension().is_some_and(|e| e == "c" || e == "h") && b.len() <= crate::playground::MAX_FILE_BYTES)
                .filter_map(|(p, b)| String::from_utf8(b.clone()).ok().map(|c| crate::playground::DraftFile { name: p.to_string_lossy().into_owned(), content: c, library: None }))
                .take(crate::playground::MAX_FILES)
                .collect();
            if m.kind == "snippet" && dfiles.is_empty() {
                dfiles.push(crate::playground::DraftFile { name: "main.c".into(), content: text_of(&files)?, library: None });
            }
            if dfiles.is_empty() {
                return Err(AppError::new("no_c", "Aucun fichier .c ou .h à ouvrir dans le Playground"));
            }
            if !dfiles.iter().any(|f| f.content.contains("main(")) && m.kind == "cfunction" {
                dfiles.insert(0, crate::playground::DraftFile { name: "main.c".into(), content: "#include <stdio.h>\n\n// Fonctions reçues : à appeler ici pour les essayer.\n\nint main(void)\n{\n    return 0;\n}\n".into(), library: None });
            }
            let settings = serde_json::from_value(m.meta["settings"].clone()).ok();
            let d = crate::playground::create(&state.conn(), &format!("{} (de {})", m.title, t.peer_nick), Some(dfiles), settings, now())?;
            crate::notify::changed(&["playground"]);
            done(format!("Ouvert dans le Playground : {}", d.title), json!({"page": "playground", "id": d.id}))
        }
        Target::Library { name } => {
            let label = if name.trim().is_empty() { m.title.clone() } else { name.trim().to_string() };
            let staging = state.cache_dir.join("tekshare").join("staging").join(id);
            let _ = std::fs::remove_dir_all(&staging);
            share::extract(&files, &staging)?;
            let dest = fresh(&state.data_dir.join("libraries"), &slug(&label)).join(slug(&label));
            crate::library::copy_sources(&staging, &dest)?;
            let _ = std::fs::remove_dir_all(&staging);
            let lib = crate::library::add(&state.conn(), &label, &dest, now())?;
            crate::notify::changed(&["libraries"]);
            done(format!("Ajouté aux bibliothèques : {}", lib.name), json!({"page": "library", "id": lib.id}))
        }
        Target::Template { name } => {
            let label = if name.trim().is_empty() { m.title.clone() } else { name.trim().to_string() };
            let staging = state.cache_dir.join("tekshare").join("staging").join(id);
            let _ = std::fs::remove_dir_all(&staging);
            share::extract(&files, &staging)?;
            let r = crate::templates::import_dir(&state.templates(), &staging, &label, &format!("Reçu de {}", t.peer_nick));
            let _ = std::fs::remove_dir_all(&staging);
            r?;
            crate::notify::changed(&["templates"]);
            done(format!("Ajouté aux modèles : {label}"), json!({"page": "templates"}))
        }
        Target::Prompt { preset } => {
            let pid = m.meta["id"].as_str().ok_or_else(|| AppError::new("bad_bundle", "Prompt sans identifiant"))?;
            let preset = if preset.trim().is_empty() { format!("de {}", t.peer_nick) } else { preset.trim().to_string() };
            crate::prompts::save(&state.conn(), pid, &preset, &text_of(&files)?, now())?;
            crate::notify::changed(&["prompts"]);
            done(format!("Prompt « {preset} » ajouté"), json!({"page": "prompts"}))
        }
        Target::Project { repo, subdir } => {
            let dir = crate::commands::project_dir(state, repo)?;
            let sub = share::safe_rel(subdir.trim_matches('/')).ok_or_else(|| AppError::new("invalid_path", "Sous-dossier invalide"))?;
            // Files of the bundle sit under `tests/` already for a tests bundle: keep their tree once.
            let base = dir.join(&sub);
            let mut planned = Vec::new();
            for (p, b) in &files {
                let rel = p.strip_prefix(&sub).unwrap_or(p);
                let dest = base.join(rel);
                if dest.exists() {
                    return Err(AppError::new("conflict", format!("{} existe déjà dans le projet : rien n'a été copié.", dest.strip_prefix(&dir).unwrap_or(&dest).display())));
                }
                planned.push((dest, b));
            }
            for (dest, b) in &planned {
                if let Some(parent) = dest.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                std::fs::write(dest, b)?;
            }
            crate::notify::changed(&["repos"]);
            done(format!("{} fichier(s) copiés dans {}", planned.len(), base.display()), json!({"page": "sheet", "path": dir}))
        }
        Target::Patch { repo, apply } => {
            let dir = crate::commands::repo_dir(state, repo)?;
            let patch = state.cache_dir.join("tekshare").join(format!("{id}.patch"));
            std::fs::create_dir_all(patch.parent().unwrap_or(Path::new("/")))?;
            std::fs::write(&patch, text_of(&files)?)?;
            let p = patch.to_string_lossy().into_owned();
            let check = crate::git::run_raw(Some(&dir), &["apply", "--check", "--whitespace=nowarn", &p])?;
            if !check.ok {
                let _ = std::fs::remove_file(&patch);
                return Err(AppError::new("patch_conflict", format!("Le patch ne s'applique pas proprement à ce projet :\n{}", check.stderr.trim())));
            }
            if !apply {
                let _ = std::fs::remove_file(&patch);
                return Ok(Imported { detail: "Le patch s'applique proprement.".into(), open: Value::Null });
            }
            let out = crate::git::run_raw(Some(&dir), &["apply", "--whitespace=nowarn", &p])?;
            let _ = std::fs::remove_file(&patch);
            if !out.ok {
                return Err(AppError::new("patch_failed", out.stderr.trim().to_string()));
            }
            crate::notify::changed(&["repos"]);
            done("Patch appliqué (non commité : vérifie les changements dans Git).".into(), json!({"page": "git", "path": dir}))
        }
        Target::Arena => {
            let v: Value = serde_json::from_str(&text_of(&files)?).map_err(|_| AppError::new("bad_bundle", "Rapport illisible"))?;
            let mut summary = serde_json::Map::new();
            summary.insert("arena".into(), v["results"].clone());
            if !v["report"].is_null() {
                summary.insert("report".into(), v["report"].clone());
            }
            summary.insert("receivedFrom".into(), json!(t.peer_nick));
            let run = crate::db::insert_run(&state.conn(), "arena", None, v["startedAt"].as_i64().unwrap_or(now()), 0, v["status"].as_str().unwrap_or("success"), &format!("Arena · {} (de {})", m.title, t.peer_nick), &Value::Object(summary).to_string(), "")?;
            crate::notify::changed(&["runs"]);
            done("Ajouté à l'historique de l'Arena".into(), json!({"page": "arena", "runId": run}))
        }
        Target::Downloads => {
            let parent = downloads.join("TekShare").join(slug(&t.peer_nick));
            std::fs::create_dir_all(&parent)?;
            let dest = fresh(&parent, &slug(&m.title));
            share::extract(&files, &dest)?;
            done(format!("Enregistré dans {}", dest.display()), json!({"reveal": dest}))
        }
        Target::Config => {
            let v: Value = serde_json::from_str(&text_of(&files)?).map_err(|_| AppError::new("bad_bundle", "Réglages illisibles"))?;
            let mut s = state.settings()?;
            if let Some(th) = v["theme"].as_str().filter(|th| crate::settings::THEMES.contains(th)) {
                s.theme = th.to_string();
            }
            if let Some(g) = v["glassEffects"].as_bool() {
                s.glass_effects = g;
            }
            if let Some(e) = v["epitechOnly"].as_bool() {
                s.epitech_only = e;
            }
            crate::settings::save(&state.conn(), &s)?;
            crate::notify::changed(&["settings"]);
            done("Réglages d'apparence appliqués".into(), json!({"page": "settings"}))
        }
    }
}
