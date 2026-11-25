//! Brain Dump commands: quick captures, the inbox, and the floating capture window.

use crate::ai::{provider, runner};
use crate::brain::{self, Capture, Filter};
use crate::commands::{now, AppState};
use crate::error::{AppError, Result};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

/// Every window shows captures (the floating one writes, the main one lists): the change is
/// announced to all of them.
fn changed<T>(r: Result<T>) -> Result<T> {
    if r.is_ok() {
        crate::notify::changed(&["brain", "plan"]);
    }
    r
}

fn images(state: &AppState) -> std::path::PathBuf {
    state.data_dir.join("captures")
}

#[tauri::command(async)]
pub fn brain_save(state: State<'_, AppState>, text: String, project: Option<String>) -> Result<Capture> {
    changed(brain::save(&state.conn(), &text, project.as_deref(), now()))
}

#[tauri::command(async)]
pub fn brain_edit(state: State<'_, AppState>, id: i64, text: String) -> Result<Capture> {
    changed(brain::edit(&state.conn(), id, &text, now()))
}

#[tauri::command(async)]
pub fn brain_list(state: State<'_, AppState>, filter: Filter) -> Result<Vec<Capture>> {
    brain::list(&state.conn(), &filter, now())
}

#[tauri::command(async)]
pub fn brain_count(state: State<'_, AppState>) -> Result<i64> {
    brain::inbox_count(&state.conn())
}

#[tauri::command(async)]
pub fn brain_similar(state: State<'_, AppState>, id: i64) -> Result<Vec<Capture>> {
    brain::similar(&state.conn(), id)
}

#[tauri::command(async)]
pub fn brain_convert(state: State<'_, AppState>, id: i64, kind: String) -> Result<Capture> {
    changed(brain::convert(&state.conn(), id, &kind, now()))
}

#[tauri::command(async)]
pub fn brain_set_project(state: State<'_, AppState>, id: i64, project: Option<String>) -> Result<Capture> {
    changed(brain::set_project(&state.conn(), id, project.as_deref(), now()))
}

#[tauri::command(async)]
pub fn brain_pin(state: State<'_, AppState>, id: i64, pinned: bool) -> Result<Capture> {
    changed(brain::set_pinned(&state.conn(), id, pinned, now()))
}

#[tauri::command(async)]
pub fn brain_archive(state: State<'_, AppState>, id: i64, archived: bool) -> Result<Capture> {
    changed(brain::set_archived(&state.conn(), id, archived, now()))
}

#[tauri::command(async)]
pub fn brain_tags(state: State<'_, AppState>, id: i64, tags: Vec<String>) -> Result<Capture> {
    changed(brain::set_tags(&state.conn(), id, &tags, now()))
}

#[tauri::command(async)]
pub fn brain_delete(state: State<'_, AppState>, id: i64) -> Result<Capture> {
    changed(brain::delete(&state.conn(), id))
}

#[tauri::command(async)]
pub fn brain_restore(state: State<'_, AppState>, capture: Capture) -> Result<Capture> {
    changed(brain::restore(&state.conn(), &capture))
}

/// A pasted or dropped image, as base64.
#[tauri::command(async)]
pub fn brain_attach(state: State<'_, AppState>, mime: String, data: String) -> Result<String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(data.trim()).map_err(|_| AppError::new("invalid_capture", "Image illisible"))?;
    brain::attach(&images(&state), &mime, &bytes)
}

#[tauri::command(async)]
pub fn brain_image(state: State<'_, AppState>, id: String) -> Result<String> {
    brain::image_data(&images(&state), &id)
}

/// Removes images no capture uses any more (once at start, in the background).
pub fn sweep(state: &AppState) {
    let _ = brain::sweep_images(&state.conn(), &images(state));
}

const SUGGEST_SCHEMA: &str = r#"{"type":"object","properties":{"title":{"type":"string"},"ctype":{"type":"string","enum":["idea","bug","improvement","question","code","command","link","task","info"]},"project":{"type":"string"},"tags":{"type":"array","items":{"type":"string"}},"rewrite":{"type":"string"},"asTask":{"type":"boolean"},"similarId":{"type":"integer"}},"required":["title","ctype","tags","asTask"]}"#;

/// Asks Artix, only when the user clicks, how to file a capture. Nothing is applied: the
/// answer is a set of suggestions the inbox shows (job value `suggestion`).
#[tauri::command(async)]
pub fn brain_artix(state: State<'_, AppState>, id: i64, projects: Vec<(String, String)>) -> Result<u64> {
    provider::require(provider::Feature::Text)?;
    let c = brain::get(&state.conn(), id)?;
    let key = format!("capture:{id}");
    if let Some(job) = state.jobs.active("brain", Some(&key)) {
        return Ok(job);
    }
    let similar = brain::similar(&state.conn(), id)?;
    let model = crate::ai::chat::AiSettings::load(&state.conn()).chat_model;
    let dir = state.cache_dir.join("assistant");
    std::fs::create_dir_all(&dir)?;
    let projects: Vec<String> = projects.into_iter().take(80).map(|(k, n)| format!("- {n} (clé : {k})")).collect();
    let older: Vec<String> = similar.iter().map(|s| format!("- id {} : {}", s.id, s.title)).collect();
    let prompt = format!(
        "Tu aides à ranger une note prise à la volée dans TekBoard. Propose : un titre court, une catégorie, le projet concerné si c'est évident (clé exacte de la liste, sinon vide), 0 à 4 tags courts en minuscules, une reformulation claire si utile (sinon vide), asTask=true si c'est une chose à faire, et similarId si elle rejoint une ancienne idée de la liste. Réponds uniquement avec l'objet JSON demandé.\n\nProjets :\n{}\n\nAnciennes idées proches :\n{}\n\n--- NOTE ---\n{}\n--- FIN ---",
        if projects.is_empty() { "(aucun)".into() } else { projects.join("\n") },
        if older.is_empty() { "(aucune)".into() } else { older.join("\n") },
        crate::ai::stream::clip(&c.text, 4000)
    );
    Ok(state.jobs.start(state.db.clone(), "brain", Some(key), format!("Artix range une capture · {}", c.title), &[("read", "Artix lit la capture")], move |job| {
        job.start("read");
        let mut req = runner::Request::new(prompt, runner::Tools::None, Duration::from_secs(120));
        req.json_schema = Some(SUGGEST_SCHEMA.into());
        req.model = Some(model).filter(|m| !m.is_empty());
        let (_o, answer) = runner::run(job, &dir, &req, &mut |_| {})?;
        runner::end_step(job, "read", &answer, |_| "Suggestions prêtes".into());
        match answer.ok().and_then(|a| a.structured) {
            Some(s) => {
                job.set("suggestion", s);
                Ok("done")
            }
            None => {
                job.set("error", "La réponse n'était pas celle attendue.");
                Ok("failed")
            }
        }
    }))
}

// ───────────────────────────── capture window ─────────────────────────────

pub const CAPTURE_WINDOW: &str = "capture";

/// Shows the floating capture window, created on first use. It is hidden when done (so that
/// the next opening is instant) and destroyed after a while without use.
pub fn show_capture(app: &AppHandle) -> Result<()> {
    if let Some(w) = app.get_webview_window(CAPTURE_WINDOW) {
        let _ = app.emit_to(CAPTURE_WINDOW, "capture-shown", ());
        let _ = w.center();
        w.show().map_err(|e| AppError::new("window", e.to_string()))?;
        let _ = w.set_focus();
        touch_capture();
        return Ok(());
    }
    let w = tauri::WebviewWindowBuilder::new(app, CAPTURE_WINDOW, tauri::WebviewUrl::App("index.html?window=capture".into()))
        .title("TekBoard · Capture rapide")
        .inner_size(600.0, 260.0)
        .min_inner_size(420.0, 180.0)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(true)
        .center()
        .focused(true)
        .background_color(tauri::window::Color(20, 20, 21, 255))
        .build()
        .map_err(|e| AppError::new("window", e.to_string()))?;
    let _ = w.set_focus();
    touch_capture();
    reaper(app.clone());
    Ok(())
}

static LAST_USE: std::sync::Mutex<Option<std::time::Instant>> = std::sync::Mutex::new(None);
static REAPER: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
const KEEP_HIDDEN: Duration = Duration::from_secs(10 * 60);

fn touch_capture() {
    *LAST_USE.lock().unwrap_or_else(|e| e.into_inner()) = Some(std::time::Instant::now());
}

/// Closes the hidden capture window after ten minutes without use (frees its web view).
fn reaper(app: AppHandle) {
    if REAPER.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(60));
        let Some(w) = app.get_webview_window(CAPTURE_WINDOW) else {
            REAPER.store(false, std::sync::atomic::Ordering::SeqCst);
            return;
        };
        let idle = LAST_USE.lock().unwrap_or_else(|e| e.into_inner()).map(|t| t.elapsed() > KEEP_HIDDEN).unwrap_or(true);
        if idle && !w.is_visible().unwrap_or(true) {
            let _ = w.destroy();
            REAPER.store(false, std::sync::atomic::Ordering::SeqCst);
            return;
        }
    });
}

#[tauri::command]
pub fn capture_open(app: AppHandle) -> Result<()> {
    show_capture(&app)
}

/// Hides the capture window; with `then`, brings the main window up on a page (`inbox`…).
#[tauri::command]
pub fn capture_close(app: AppHandle, then: Option<String>) -> Result<()> {
    if let Some(w) = app.get_webview_window(CAPTURE_WINDOW) {
        let _ = w.hide();
    }
    touch_capture();
    match then {
        Some(target) => {
            crate::show_main(&app);
            crate::notify::emit("open-target", target);
        }
        None => crate::desktop::capture_done(&app),
    }
    Ok(())
}

/// Opens a link written in a capture, in the default browser. Only `http(s)` links that the
/// capture itself contains are opened (the page cannot open any address it likes).
#[tauri::command(async)]
pub fn brain_open_link(state: State<'_, AppState>, id: i64, url: String) -> Result<()> {
    let c = brain::get(&state.conn(), id)?;
    let ok = (url.starts_with("https://") || url.starts_with("http://")) && url.len() <= 2000 && !url.chars().any(|ch| ch.is_whitespace() || ch.is_control()) && c.text.contains(&url);
    if !ok {
        return Err(AppError::new("url_refused", "Ce lien n'est pas dans la capture."));
    }
    crate::workspace::spawn_detached(&["xdg-open".to_string(), url], &std::env::temp_dir()).map_err(|e| AppError::new("no_browser", format!("Le navigateur par défaut n'a pas pu démarrer : {e}")))
}
