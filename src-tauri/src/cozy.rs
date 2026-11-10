//! Cozy Fox: the pixel-art fox companion of the "Cozy Glass" GNOME setup.
//!
//! Only what that setup really exposes is used here:
//! - settings: the `companion` object of `$XDG_CONFIG_HOME/cozy-glass/widgets.json`
//!   (the extension reloads the file when it changes);
//! - one-shot commands: a `<command> <unique token>` line written to
//!   `$XDG_CACHE_HOME/cozy-glass/fox-cmd`, which the fox watches.
//! `widgets.json` is always backed up before being rewritten.

use crate::error::{AppError, Result};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

pub struct Paths {
    pub widgets: PathBuf,
    pub fox_cmd: PathBuf,
    pub backups: PathBuf,
}

impl Paths {
    pub fn from_env(backups: PathBuf) -> Option<Paths> {
        let home = std::env::var_os("HOME").map(PathBuf::from)?;
        let config = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).unwrap_or_else(|| home.join(".config"));
        let cache = std::env::var_os("XDG_CACHE_HOME").map(PathBuf::from).unwrap_or_else(|| home.join(".cache"));
        Some(Paths { widgets: config.join("cozy-glass/widgets.json"), fox_cmd: cache.join("cozy-glass/fox-cmd"), backups })
    }
}

/// Values as written in `widgets.json`. `None` = key absent, the fox uses its own default.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Companion {
    pub enabled: Option<bool>,
    pub outfits: Option<bool>,
    pub weather_outfits: Option<bool>,
    /// `auto` or `none`.
    pub season: Option<String>,
    pub scale: Option<f64>,
    pub speed: Option<f64>,
    /// Minutes between water reminders, 0 = off.
    pub water: Option<f64>,
    /// Average minutes between bird visits.
    pub bird_every: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// `widgets.json` exists: the Cozy Glass setup is present on this machine.
    pub installed: bool,
    pub widgets_path: String,
    pub companion: Companion,
    pub backups: Vec<String>,
}

fn read_root(path: &Path) -> Result<Map<String, Value>> {
    let text = fs::read_to_string(path)?;
    match serde_json::from_str::<Value>(&text)? {
        Value::Object(map) => Ok(map),
        _ => Err(AppError::new("cozy_invalid", "widgets.json is not a JSON object")),
    }
}

pub fn status(paths: &Paths) -> Status {
    let installed = paths.widgets.is_file();
    let companion = read_root(&paths.widgets).ok().and_then(|root| root.get("companion").cloned()).and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default();
    Status { installed, widgets_path: paths.widgets.to_string_lossy().into_owned(), companion, backups: list_backups(paths) }
}

fn check_range(name: &str, v: f64, min: f64, max: f64) -> Result<()> {
    if v.is_finite() && v >= min && v <= max { Ok(()) } else { Err(AppError::new("cozy_invalid", format!("{name} must be between {min} and {max}"))) }
}

fn number(v: f64) -> Value {
    // Keep whole numbers written as integers, like the original file.
    if v.fract() == 0.0 { Value::from(v as i64) } else { Value::from(v) }
}

/// Writes the fields present in `patch` into the `companion` object, leaving every other key alone.
pub fn update(paths: &Paths, patch: &Companion) -> Result<Status> {
    if !paths.widgets.is_file() {
        return Err(AppError::new("cozy_missing", "Cozy Glass is not installed on this machine (widgets.json not found)"));
    }
    if let Some(s) = &patch.season {
        if s != "auto" && s != "none" {
            return Err(AppError::new("cozy_invalid", "season must be “auto” or “none”"));
        }
    }
    if let Some(v) = patch.scale {
        check_range("scale", v, 1.0, 6.0)?;
    }
    if let Some(v) = patch.speed {
        check_range("speed", v, 0.25, 3.0)?;
    }
    if let Some(v) = patch.water {
        check_range("water", v, 0.0, 240.0)?;
    }
    if let Some(v) = patch.bird_every {
        check_range("birdEvery", v, 1.0, 120.0)?;
    }
    let mut root = read_root(&paths.widgets)?;
    let entry = root.entry("companion".to_string()).or_insert_with(|| Value::Object(Map::new()));
    let Value::Object(companion) = entry else { return Err(AppError::new("cozy_invalid", "“companion” is not an object in widgets.json")) };
    let mut set = |key: &str, value: Option<Value>| {
        if let Some(v) = value {
            companion.insert(key.to_string(), v);
        }
    };
    set("enabled", patch.enabled.map(Value::from));
    set("outfits", patch.outfits.map(Value::from));
    set("weatherOutfits", patch.weather_outfits.map(Value::from));
    set("season", patch.season.clone().map(Value::from));
    set("scale", patch.scale.map(number));
    set("speed", patch.speed.map(number));
    set("water", patch.water.map(number));
    set("birdEvery", patch.bird_every.map(number));

    backup(paths)?;
    write_atomic(&paths.widgets, &(serde_json::to_string_pretty(&Value::Object(root))? + "\n"))?;
    Ok(status(paths))
}

fn write_atomic(path: &Path, text: &str) -> Result<()> {
    let tmp = path.with_extension("json.tekboard-tmp");
    fs::write(&tmp, text)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

fn backup(paths: &Paths) -> Result<String> {
    fs::create_dir_all(&paths.backups)?;
    let name = format!("widgets-{}.json", chrono::Local::now().format("%Y%m%d-%H%M%S%.3f"));
    fs::copy(&paths.widgets, paths.backups.join(&name))?;
    Ok(name)
}

/// Newest first.
pub fn list_backups(paths: &Paths) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(&paths.backups)
        .map(|entries| entries.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.starts_with("widgets-") && n.ends_with(".json")).collect())
        .unwrap_or_default();
    names.sort();
    names.reverse();
    names
}

/// Puts a saved `widgets.json` back. The current file is itself backed up first.
pub fn restore(paths: &Paths, name: &str) -> Result<Status> {
    let valid = name.starts_with("widgets-") && name.ends_with(".json") && !name.contains('/') && !name.contains("..");
    let src = paths.backups.join(name);
    if !valid || !src.is_file() {
        return Err(AppError::new("not_found", "Unknown backup"));
    }
    let text = fs::read_to_string(&src)?;
    serde_json::from_str::<Value>(&text).map_err(|_| AppError::new("cozy_invalid", "This backup is not valid JSON"))?;
    if paths.widgets.is_file() {
        backup(paths)?;
    }
    write_atomic(&paths.widgets, &text)?;
    Ok(status(paths))
}

/// One-shot commands the fox understands (from the `cozy fox …` CLI and the fox's own command handler).
pub const COMMANDS: &[&str] = &[
    "pilot", "ball", "glass", "spin", "pounce", "zoomies", "laser", "bird", "mail", "water", "reload", "push", "push-fail", "build-ok", "build-fail",
    "wx-rain", "wx-snow", "wx-sun", "wx-cold", "wx-auto", "season-halloween", "season-christmas", "season-spring", "season-none", "season-auto",
];

pub fn send(paths: &Paths, command: &str) -> Result<()> {
    if !COMMANDS.contains(&command) {
        return Err(AppError::new("cozy_invalid", format!("“{command}” is not a known fox command")));
    }
    if !paths.widgets.is_file() {
        return Err(AppError::new("cozy_missing", "Cozy Glass is not installed on this machine"));
    }
    if let Some(dir) = paths.fox_cmd.parent() {
        fs::create_dir_all(dir)?;
    }
    let token = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    fs::write(&paths.fox_cmd, format!("{command} {token}\n"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
  "lang": "fr",
  "zeta": { "keep": [1, 2] },
  "companion": {
    "enabled": true,
    "scale": 3,
    "speed": 1,
    "outfits": false,
    "season": "auto"
  },
  "alpha": true
}
"#;

    fn setup(with_file: bool) -> (tempfile::TempDir, Paths) {
        let tmp = tempfile::tempdir().unwrap();
        let paths = Paths { widgets: tmp.path().join("config/cozy-glass/widgets.json"), fox_cmd: tmp.path().join("cache/cozy-glass/fox-cmd"), backups: tmp.path().join("backups") };
        if with_file {
            fs::create_dir_all(paths.widgets.parent().unwrap()).unwrap();
            fs::write(&paths.widgets, SAMPLE).unwrap();
        }
        (tmp, paths)
    }

    #[test]
    fn reads_what_is_written_and_nothing_more() {
        let (_t, paths) = setup(true);
        let s = status(&paths);
        assert!(s.installed);
        assert_eq!(s.companion.enabled, Some(true));
        assert_eq!(s.companion.scale, Some(3.0));
        assert_eq!(s.companion.weather_outfits, None, "absent keys are not invented");
        assert_eq!(s.companion.water, None);
    }

    #[test]
    fn update_changes_only_the_given_keys_and_backs_up() {
        let (_t, paths) = setup(true);
        let s = update(&paths, &Companion { enabled: Some(false), water: Some(45.0), speed: Some(1.5), ..Default::default() }).unwrap();
        assert_eq!(s.companion.enabled, Some(false));
        assert_eq!(s.companion.outfits, Some(false));
        assert_eq!(s.backups.len(), 1);
        assert_eq!(fs::read_to_string(paths.backups.join(&s.backups[0])).unwrap(), SAMPLE);

        let text = fs::read_to_string(&paths.widgets).unwrap();
        let root: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(root["zeta"]["keep"], serde_json::json!([1, 2]));
        assert_eq!(root["companion"]["scale"], serde_json::json!(3));
        assert_eq!(root["companion"]["water"], serde_json::json!(45));
        assert_eq!(root["companion"]["speed"], serde_json::json!(1.5));
        let keys: Vec<&String> = root.as_object().unwrap().keys().collect();
        assert_eq!(keys, ["lang", "zeta", "companion", "alpha"], "key order is preserved");
    }

    #[test]
    fn invalid_values_change_nothing() {
        let (_t, paths) = setup(true);
        for bad in [Companion { scale: Some(40.0), ..Default::default() }, Companion { season: Some("summer".into()), ..Default::default() }, Companion { water: Some(-1.0), ..Default::default() }, Companion { speed: Some(f64::NAN), ..Default::default() }] {
            assert_eq!(update(&paths, &bad).unwrap_err().code(), "cozy_invalid");
        }
        assert_eq!(fs::read_to_string(&paths.widgets).unwrap(), SAMPLE);
        assert!(list_backups(&paths).is_empty());
    }

    #[test]
    fn restore_puts_the_previous_file_back() {
        let (_t, paths) = setup(true);
        let s = update(&paths, &Companion { enabled: Some(false), ..Default::default() }).unwrap();
        let first = s.backups[0].clone();
        std::thread::sleep(std::time::Duration::from_millis(5));
        let s = restore(&paths, &first).unwrap();
        assert_eq!(fs::read_to_string(&paths.widgets).unwrap(), SAMPLE);
        assert_eq!(s.backups.len(), 2, "the replaced file was saved too");
        assert_eq!(restore(&paths, "../etc/passwd").unwrap_err().code(), "not_found");
        assert_eq!(restore(&paths, "widgets-nope.json").unwrap_err().code(), "not_found");
    }

    #[test]
    fn commands_are_whitelisted() {
        let (_t, paths) = setup(true);
        send(&paths, "zoomies").unwrap();
        let line = fs::read_to_string(&paths.fox_cmd).unwrap();
        assert!(line.starts_with("zoomies ") && line.ends_with('\n'));
        assert_eq!(send(&paths, "rm -rf").unwrap_err().code(), "cozy_invalid");
        assert_eq!(send(&paths, "zoomies\nball").unwrap_err().code(), "cozy_invalid");
    }

    #[test]
    fn absent_setup_is_reported_not_created() {
        let (_t, paths) = setup(false);
        assert!(!status(&paths).installed);
        assert_eq!(update(&paths, &Companion { enabled: Some(true), ..Default::default() }).unwrap_err().code(), "cozy_missing");
        assert_eq!(send(&paths, "ball").unwrap_err().code(), "cozy_missing");
        assert!(!paths.widgets.exists() && !paths.fox_cmd.exists());
    }
}
