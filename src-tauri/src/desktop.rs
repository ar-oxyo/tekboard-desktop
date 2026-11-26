//! Integration with the desktop: one TekBoard at a time, the global capture shortcut, the
//! optional icon in the notification area.
//!
//! A global shortcut needs X11: under Wayland the compositor alone sees keys pressed in other
//! windows, so no application can grab one. There, the user binds a system shortcut to
//! `tekboard capture` instead: the single-instance plugin hands it to the running TekBoard,
//! which shows the capture window (or starts with that window only).

use crate::commands_brain::show_capture;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub const MAIN: &str = "main";
pub const DEFAULT_SHORTCUT: &str = "Ctrl+Alt+Space";

/// Arguments that open the capture window: `tekboard capture` or `tekboard --capture`.
pub fn wants_capture(argv: &[String]) -> bool {
    argv.get(1).map(String::as_str) == Some("capture") || argv.iter().any(|a| a == "--capture")
}

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Gives the hidden main window the saved design's ground, the interface size and the design's
/// icon before it is shown: a light design never opens on a black frame. "System" follows the
/// desktop's light/dark preference as GTK reports it.
pub fn prepare_main(app: &AppHandle, look: &crate::look::Look) {
    use crate::look::Mode;
    if let Some(w) = app.get_webview_window(MAIN) {
        let dark = match look.mode {
            Mode::Dark => true,
            Mode::Light => false,
            Mode::System => !matches!(w.theme(), Ok(tauri::Theme::Light)),
        };
        let (r, g, b) = crate::look::ground(&look.theme, dark);
        let _ = w.set_background_color(Some(tauri::window::Color(r, g, b, 255)));
        if (look.zoom - 1.0).abs() > 0.001 {
            let _ = w.set_zoom(look.zoom);
        }
    }
    if crate::settings::THEMES.contains(&look.theme.as_str()) {
        let _ = apply_theme_icon(app, &look.theme);
    }
}

/// Applies an interface size to every open window (the capture window follows the main one).
pub fn apply_zoom(app: &AppHandle, zoom: f64) -> tauri::Result<()> {
    for w in app.webview_windows().values() {
        w.set_zoom(zoom)?;
    }
    Ok(())
}

/// Decides what the first window is: the capture window alone, or the main window.
pub fn first_window(app: &AppHandle) {
    let argv: Vec<String> = std::env::args().collect();
    if wants_capture(&argv) {
        if show_capture(app).is_ok() {
            return;
        }
    }
    show_main(app);
}

/// A second `tekboard …` was started: it stops at once and this one acts on its arguments.
pub fn second_instance(app: &AppHandle, argv: Vec<String>) {
    if wants_capture(&argv) {
        if show_capture(app).is_ok() {
            return;
        }
    }
    show_main(app);
    crate::notify::emit("startup-args", crate::commands::parse_args(&argv));
}

/// The capture window was closed while the main window was never shown (`tekboard capture`
/// with nothing running): nothing else to keep TekBoard alive for, unless the tray icon is on.
pub fn capture_done(app: &AppHandle) {
    let main_visible = app.get_webview_window(MAIN).and_then(|w| w.is_visible().ok()).unwrap_or(true);
    if !main_visible && !stays_in_background() {
        app.exit(0);
    }
}

/// Whether something can bring TekBoard back once its window is gone: tray icon or shortcut.
fn stays_in_background() -> bool {
    tray_active() || SHORTCUT.lock().unwrap_or_else(|e| e.into_inner()).active
}

/// Closing the main window hides it when TekBoard stays in the background, and quits
/// otherwise. It is never destroyed: hidden windows (MY Epitech session, capture) would keep
/// the process alive with no window left for the next `tekboard` to show.
pub fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    let tauri::WindowEvent::CloseRequested { api, .. } = event else { return };
    if window.label() != MAIN {
        return;
    }
    api.prevent_close();
    if stays_in_background() {
        let _ = window.hide();
    } else {
        window.app_handle().exit(0);
    }
}

pub fn is_wayland() -> bool {
    std::env::var("XDG_SESSION_TYPE").map(|v| v.eq_ignore_ascii_case("wayland")).unwrap_or(false) || std::env::var_os("WAYLAND_DISPLAY").is_some()
}

// ───────────────────────────── global shortcut ─────────────────────────────

#[derive(Default)]
struct ShortcutState {
    active: bool,
    error: Option<String>,
}

static SHORTCUT: Mutex<ShortcutState> = Mutex::new(ShortcutState { active: false, error: None });

/// Registers the capture shortcut (empty = none). Under Wayland nothing is registered.
pub fn apply_shortcut(app: &AppHandle, accel: &str) {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState as KeyState};
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let mut st = SHORTCUT.lock().unwrap_or_else(|e| e.into_inner());
    *st = ShortcutState::default();
    let accel = accel.trim();
    if accel.is_empty() || is_wayland() {
        return;
    }
    let parsed: Shortcut = match accel.parse() {
        Ok(s) => s,
        Err(e) => {
            st.error = Some(format!("Raccourci illisible : {e}"));
            return;
        }
    };
    match gs.on_shortcut(parsed, |app, _s, ev| {
        if ev.state == KeyState::Pressed {
            let _ = show_capture(app);
        }
    }) {
        Ok(()) => st.active = true,
        Err(e) => st.error = Some(format!("Raccourci indisponible (déjà pris par une autre application ?) : {e}")),
    }
}

// ───────────────────────────── tray icon ─────────────────────────────

static TRAY: Mutex<bool> = Mutex::new(false);
const TRAY_ID: &str = "tekboard";

/// Design whose icon the window and the tray show (empty: the bundle's icon).
static ICON_THEME: Mutex<String> = Mutex::new(String::new());

/// The icon of a design: the same drawing (a T in a progress ring), in the design's ink.
/// Generated by `scripts/theme-icons.mjs`. Older designs keep the original violet.
pub fn theme_icon(theme: &str) -> &'static [u8] {
    match theme {
        "aurora" => include_bytes!("../icons/themes/aurora.png"),
        "sauge" => include_bytes!("../icons/themes/sauge.png"),
        "ardoise" => include_bytes!("../icons/themes/ardoise.png"),
        "prune" => include_bytes!("../icons/themes/prune.png"),
        "sumi" => include_bytes!("../icons/themes/sumi.png"),
        _ => include_bytes!("../icons/themes/legacy.png"),
    }
}

/// Shows the design's icon on every window (title bar, taskbar, dock where the desktop takes
/// it from the window) and on the tray. The launcher's icon (.desktop file) is installed with
/// the package and stays as it is: changing it at run time would mean rewriting system files.
/// Some Wayland desktops ignore a window icon set at run time; nothing is forced there.
pub fn apply_theme_icon(app: &AppHandle, theme: &str) -> tauri::Result<()> {
    let img = tauri::image::Image::from_bytes(theme_icon(theme))?;
    for w in app.webview_windows().values() {
        let _ = w.set_icon(img.clone());
    }
    if let Some(t) = app.tray_by_id(TRAY_ID) {
        let _ = t.set_icon(Some(img));
    }
    *ICON_THEME.lock().unwrap_or_else(|e| e.into_inner()) = theme.to_string();
    Ok(())
}

fn tray_active() -> bool {
    *TRAY.lock().unwrap_or_else(|e| e.into_inner())
}

/// The notification area needs the AppIndicator library, loaded when the icon is created:
/// without it, the icon is not offered (rather than failing at that moment).
pub fn tray_available() -> bool {
    const NAMES: &[&str] = &["libayatana-appindicator3.so.1", "libappindicator3.so.1"];
    const DIRS: &[&str] = &["/usr/lib", "/usr/lib64", "/usr/lib/x86_64-linux-gnu", "/usr/lib/aarch64-linux-gnu", "/lib/x86_64-linux-gnu", "/usr/local/lib"];
    let appdir = std::env::var("APPDIR").ok();
    DIRS.iter().map(|d| d.to_string()).chain(appdir.iter().flat_map(|a| [format!("{a}/usr/lib"), format!("{a}/usr/lib/x86_64-linux-gnu")])).any(|d| NAMES.iter().any(|n| std::path::Path::new(&d).join(n).exists()))
}

pub fn apply_tray(app: &AppHandle, on: bool, lang: &str) {
    let mut active = TRAY.lock().unwrap_or_else(|e| e.into_inner());
    if !on || !tray_available() {
        if *active {
            let _ = app.remove_tray_by_id(TRAY_ID);
            *active = false;
        }
        return;
    }
    if *active {
        return;
    }
    match build_tray(app, lang == "en") {
        Ok(()) => *active = true,
        Err(e) => eprintln!("TekBoard: tray icon not shown: {e}"),
    }
}

/// The menu is built by the backend, in the interface language (French or English).
fn build_tray(app: &AppHandle, en: bool) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    let item = |id: &str, fr: &str, english: &str| MenuItem::with_id(app, id, if en { english } else { fr }, true, None::<&str>);
    let menu = Menu::with_items(app, &[&item("capture", "Capture rapide", "Quick capture")?, &item("inbox", "Inbox", "Inbox")?, &item("checkpoint", "Point de sauvegarde", "Restore point")?, &PredefinedMenuItem::separator(app)?, &item("open", "Ouvrir TekBoard", "Open TekBoard")?, &item("quit", "Quitter", "Quit")?])?;
    let mut b = tauri::tray::TrayIconBuilder::with_id(TRAY_ID).menu(&menu).tooltip("TekBoard").show_menu_on_left_click(true).on_menu_event(|app, ev| match ev.id().as_ref() {
        "capture" => {
            let _ = show_capture(app);
        }
        "inbox" => {
            show_main(app);
            crate::notify::emit("open-target", "inbox");
        }
        "checkpoint" => {
            show_main(app);
            crate::notify::emit("open-target", "checkpoint");
        }
        "open" => show_main(app),
        "quit" => app.exit(0),
        _ => {}
    });
    let theme = ICON_THEME.lock().unwrap_or_else(|e| e.into_inner()).clone();
    match (theme.is_empty(), tauri::image::Image::from_bytes(theme_icon(&theme))) {
        (false, Ok(img)) => b = b.icon(img),
        _ => {
            if let Some(icon) = app.default_window_icon() {
                b = b.icon(icon.clone());
            }
        }
    }
    b.build(app)?;
    Ok(())
}

// ───────────────────────────── status ─────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub wayland: bool,
    pub desktop: String,
    pub shortcut_active: bool,
    pub shortcut_error: Option<String>,
    pub tray_available: bool,
    pub tray_active: bool,
    /// What to bind in the system's keyboard settings.
    pub capture_command: String,
}

pub fn status() -> Status {
    let st = SHORTCUT.lock().unwrap_or_else(|e| e.into_inner());
    let exe = std::env::var("APPIMAGE").ok().or_else(|| std::env::current_exe().ok().map(|p| p.display().to_string())).unwrap_or_else(|| "tekboard".into());
    let exe = if exe.contains(' ') { format!("\"{exe}\"") } else { exe };
    Status { wayland: is_wayland(), desktop: std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default(), shortcut_active: st.active, shortcut_error: st.error.clone(), tray_available: tray_available(), tray_active: tray_active(), capture_command: format!("{exe} capture") }
}

/// Applies the saved choices (at start, and after the settings change).
pub fn apply(app: &AppHandle, s: &crate::settings::Settings) {
    apply_shortcut(app, &s.capture_shortcut);
    apply_tray(app, s.tray_icon, &s.language);
}

#[tauri::command]
pub fn desktop_status() -> Status {
    status()
}

#[tauri::command]
pub fn desktop_apply(app: AppHandle, state: tauri::State<'_, crate::commands::AppState>) -> crate::error::Result<Status> {
    let s = crate::settings::load(&state.conn())?;
    apply(&app, &s);
    Ok(status())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_design_has_an_icon_that_decodes() {
        for theme in crate::settings::THEMES {
            let img = tauri::image::Image::from_bytes(theme_icon(theme)).unwrap();
            assert_eq!((img.width(), img.height()), (128, 128), "{theme}");
        }
        assert_ne!(theme_icon("aurora"), theme_icon("sumi"));
        assert_eq!(theme_icon("neon"), theme_icon("unknown"));
    }

    #[test]
    fn capture_arguments() {
        let v = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(wants_capture(&v(&["tekboard", "capture"])));
        assert!(wants_capture(&v(&["/opt/TekBoard.AppImage", "--capture"])));
        assert!(!wants_capture(&v(&["tekboard", "--page", "capture"])));
        assert!(!wants_capture(&v(&["tekboard"])));
        assert!(DEFAULT_SHORTCUT.parse::<tauri_plugin_global_shortcut::Shortcut>().is_ok());
    }
}
