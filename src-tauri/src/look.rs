//! How the main window looks before its page paints: the design's ground colour and the
//! interface size, read from the saved settings and interface preferences. The page does the
//! same on its side (`public/boot.js`), so no frame shows the wrong colours or size.

use rusqlite::Connection;

/// Interface sizes offered in Settings → Appearance, as webview zoom factors. The zoom is the
/// webview's own (text, hit areas and menu positions scale together), on top of the screen's
/// scale factor, which the desktop already applies.
pub const ZOOMS: &[f64] = &[0.8, 0.9, 1.0, 1.1, 1.25, 1.5];

/// The size if it is one of `ZOOMS`.
pub fn clean_zoom(zoom: f64) -> Option<f64> {
    ZOOMS.iter().copied().find(|z| (z - zoom).abs() < 0.001)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Light,
    Dark,
    System,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Look {
    pub theme: String,
    pub mode: Mode,
    pub zoom: f64,
}

/// The saved design, mode and size; defaults for a new user (Riso, dark, 100 %).
pub fn load(conn: &Connection) -> Look {
    let theme = crate::settings::load(conn).map(|s| s.theme).unwrap_or_else(|_| "aurora".to_string());
    let prefs: serde_json::Value = crate::db::get_setting(conn, "ui_prefs").ok().flatten().and_then(|v| serde_json::from_str(&v).ok()).unwrap_or_default();
    let mode = match prefs.get("colorMode").and_then(|v| v.as_str()) {
        Some("light") => Mode::Light,
        Some("system") => Mode::System,
        _ => Mode::Dark,
    };
    let zoom = prefs.get("uiScale").and_then(|v| v.as_f64()).and_then(clean_zoom).unwrap_or(1.0);
    Look { theme, mode, zoom }
}

/// Riso and its ambiances have a light version; the older designs are dark only.
pub fn has_light(theme: &str) -> bool {
    matches!(theme, "aurora" | "sauge" | "ardoise" | "prune" | "sumi")
}

/// The design's ground (`--color-bg` in `styles/index.css`), as RGB.
pub fn ground(theme: &str, dark: bool) -> (u8, u8, u8) {
    let dark = dark || !has_light(theme);
    match (theme, dark) {
        ("sauge", true) => (0x14, 0x18, 0x15),
        ("sauge", false) => (0xee, 0xf1, 0xe8),
        ("ardoise", true) => (0x13, 0x17, 0x1c),
        ("ardoise", false) => (0xee, 0xf2, 0xf6),
        ("prune", true) => (0x1a, 0x14, 0x18),
        ("prune", false) => (0xf6, 0xee, 0xf0),
        ("sumi", true) => (0x11, 0x11, 0x11),
        ("sumi", false) => (0xf7, 0xf5, 0xef),
        ("flat", _) => (0x0c, 0x0d, 0x11),
        ("neon", _) => (0x07, 0x05, 0x0f),
        ("cozy", _) => (0x14, 0x14, 0x1f),
        ("terminal", _) => (0x04, 0x07, 0x04),
        (_, false) => (0xf3, 0xef, 0xe6),
        (_, true) => (0x18, 0x17, 0x15),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_offered_sizes_are_accepted() {
        assert_eq!(clean_zoom(1.25), Some(1.25));
        assert_eq!(clean_zoom(1.2500001), Some(1.25));
        assert_eq!(clean_zoom(3.0), None);
        assert_eq!(clean_zoom(f64::NAN), None);
    }

    #[test]
    fn a_dark_only_design_keeps_its_dark_ground_in_light_mode() {
        assert_eq!(ground("neon", false), (0x07, 0x05, 0x0f));
        assert_eq!(ground("aurora", false), (0xf3, 0xef, 0xe6));
        assert_eq!(ground("unknown", true), (0x18, 0x17, 0x15));
    }

    #[test]
    fn the_look_comes_from_the_saved_preferences_with_safe_defaults() {
        let conn = crate::db::open_in_memory().unwrap();
        let fresh = load(&conn);
        assert_eq!((fresh.mode, fresh.zoom), (Mode::Dark, 1.0));
        crate::db::set_setting(&conn, "ui_prefs", r#"{"colorMode":"light","uiScale":1.1}"#).unwrap();
        let saved = load(&conn);
        assert_eq!((saved.mode, saved.zoom), (Mode::Light, 1.1));
        crate::db::set_setting(&conn, "ui_prefs", r#"{"uiScale":7}"#).unwrap();
        assert_eq!(load(&conn).zoom, 1.0);
    }
}
