//! Launching the program a project builds, in a terminal of its own.
//!
//! The binary is the one the user set for the project, else the one the Makefile names,
//! else the executable found at the root of the repository. It is started through the
//! terminal command from Settings, as an argument array: the program path and its
//! arguments are never pasted into a shell command line.

use crate::error::{AppError, Result};
use crate::jobs::split_command;
use crate::templates::safe_rel;
use crate::testrepo::makefile_name;
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BinaryInfo {
    /// Path relative to the project, as set by the user.
    pub configured: Option<String>,
    /// What TekBoard found on its own, and where (`Makefile`, `executable at the root`).
    pub detected: Option<String>,
    pub detected_from: Option<String>,
    /// The one that would be launched.
    pub effective: Option<String>,
    /// That file is there and executable right now.
    pub exists: bool,
    pub args: Option<String>,
    /// A terminal command is configured.
    pub terminal: bool,
}

fn is_elf(path: &Path) -> bool {
    use std::io::Read;
    let mut magic = [0u8; 4];
    std::fs::File::open(path).and_then(|mut f| f.read_exact(&mut magic)).is_ok() && magic == [0x7f, b'E', b'L', b'F']
}

/// The binary a project produces, when it can be told without guessing.
pub fn detect(repo: &Path) -> Option<(String, &'static str)> {
    if let Some(name) = std::fs::read_to_string(repo.join("Makefile")).ok().as_deref().and_then(makefile_name) {
        // A name built from other variables cannot be read without running make.
        if !name.contains('$') && safe_rel(&name).is_some() {
            return Some((name, "Makefile"));
        }
    }
    // Compiled programs at the root; when several, the one built last.
    let mut found: Vec<(std::time::SystemTime, String)> = std::fs::read_dir(repo)
        .ok()?
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            let name = e.file_name().to_string_lossy().into_owned();
            let meta = path.metadata().ok()?;
            (meta.is_file() && !name.starts_with('.') && !name.contains(".so") && crate::toolenv::is_executable(&path) && is_elf(&path)).then(|| (meta.modified().unwrap_or(std::time::UNIX_EPOCH), name))
        })
        .collect();
    found.sort();
    found.pop().map(|(_, name)| (name, "executable at the root"))
}

pub fn info(repo: &Path, configured: Option<&str>, args: Option<&str>, terminal_cmd: &str) -> BinaryInfo {
    let detected = detect(repo);
    let effective = configured.map(str::to_string).or_else(|| detected.as_ref().map(|(n, _)| n.clone()));
    let exists = effective.as_deref().and_then(safe_rel).is_some_and(|rel| crate::toolenv::is_executable(&repo.join(rel)));
    BinaryInfo { configured: configured.map(str::to_string), detected_from: detected.as_ref().map(|(_, from)| from.to_string()), detected: detected.map(|(n, _)| n), effective, exists, args: args.map(str::to_string), terminal: !terminal_cmd.trim().is_empty() }
}

/// Runs the program, then says how it ended and waits for Enter so the window can be read.
/// `$0` is a label; the program and its arguments arrive as `"$@"` and are run as they are.
const HOLD: &str = r#""$@"; code=$?; printf '\n[%s exited with code %s] Press Enter to close this window. ' "$1" "$code"; read -r _"#;

/// The argument array that opens a terminal on `repo` running `bin` with `args`.
pub fn launch_argv(terminal_cmd: &str, repo: &Path, bin: &str, args: Option<&str>) -> Result<Vec<String>> {
    let mut argv: Vec<String> = terminal_cmd.split_whitespace().map(|a| a.replace("{dir}", &repo.to_string_lossy())).collect();
    if argv.is_empty() {
        return Err(AppError::new("not_configured", "No terminal is configured to run programs. Set one in Settings → Workspace."));
    }
    let rel = safe_rel(bin).ok_or_else(|| AppError::new("invalid_path", "The binary must be a path inside the project folder"))?;
    let program = repo.join(&rel);
    // The link, if any, must still point inside the project.
    let canon = std::fs::canonicalize(&program).map_err(|_| AppError::new("binary_missing", format!("{bin} does not exist yet. Build the project first, or set the binary in the project sheet.")))?;
    let root = std::fs::canonicalize(repo)?;
    if !canon.starts_with(&root) {
        return Err(AppError::new("invalid_path", "The binary must be inside the project folder"));
    }
    if !crate::toolenv::is_executable(&canon) {
        return Err(AppError::new("binary_missing", format!("{bin} is not an executable file.")));
    }
    let extra = match args.map(str::trim).filter(|a| !a.is_empty()) {
        // Split with the program in front so the same quoting rules apply; then drop it.
        Some(a) => split_command(&format!("x {a}"))?.split_off(1),
        None => vec![],
    };
    argv.extend(["sh".to_string(), "-c".to_string(), HOLD.to_string(), "tekboard-run".to_string(), format!("./{}", rel.display())]);
    argv.extend(extra);
    Ok(argv)
}

pub fn launch(terminal_cmd: &str, repo: &Path, bin: &str, args: Option<&str>) -> Result<PathBuf> {
    let argv = launch_argv(terminal_cmd, repo, bin, args)?;
    crate::workspace::spawn_detached(&argv, repo)?;
    Ok(repo.join(bin))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn program(dir: &Path, name: &str, elf: bool) -> PathBuf {
        let p = dir.join(name);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, if elf { b"\x7fELF\x02\x01\x01\0rest".to_vec() } else { b"#!/bin/sh\necho hi\n".to_vec() }).unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
        p
    }

    #[test]
    fn the_binary_comes_from_the_makefile_then_from_what_was_built() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path();
        assert_eq!(detect(repo), None);
        program(repo, "run.sh", false);
        std::fs::write(repo.join("notes.txt"), "x").unwrap();
        assert_eq!(detect(repo), None, "a script or a text file is not the project's program");
        program(repo, "old_tool", true);
        std::thread::sleep(std::time::Duration::from_millis(20));
        program(repo, "my_hunter", true);
        assert_eq!(detect(repo), Some(("my_hunter".into(), "executable at the root")), "the one built last");
        std::fs::write(repo.join("Makefile"), "NAME\t=\tmy_sudo\nall:\n").unwrap();
        assert_eq!(detect(repo), Some(("my_sudo".into(), "Makefile")));
        std::fs::write(repo.join("Makefile"), "NAME = $(PREFIX)_app\nall:\n").unwrap();
        assert_eq!(detect(repo).unwrap().1, "executable at the root", "a computed name is not guessed");
    }

    #[test]
    fn info_says_what_would_run_and_whether_it_is_there() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path();
        std::fs::write(repo.join("Makefile"), "NAME = my_ls\n").unwrap();
        let i = info(repo, None, None, "term {dir} --");
        assert_eq!((i.effective.as_deref(), i.exists, i.terminal, i.detected_from.as_deref()), (Some("my_ls"), false, true, Some("Makefile")));
        program(repo, "build/app", true);
        let i = info(repo, Some("build/app"), Some("-l /tmp"), "");
        assert_eq!((i.effective.as_deref(), i.exists, i.terminal, i.detected.as_deref()), (Some("build/app"), true, false, Some("my_ls")));
    }

    #[test]
    fn arguments_stay_arguments_whatever_they_contain() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path().join("pro ject");
        program(&repo, "app", true);
        let argv = launch_argv("term --dir={dir} --", &repo, "app", Some(r#"-n 3 "two words" 'x; rm -rf ~'"#)).unwrap();
        assert_eq!(argv[..2], ["term".to_string(), format!("--dir={}", repo.display())], "the folder is one argument even with a space");
        assert_eq!(argv[2..8], ["--", "sh", "-c", HOLD, "tekboard-run", "./app"]);
        assert_eq!(argv[8..], ["-n", "3", "two words", "x; rm -rf ~"]);
        assert!(!HOLD.contains("app") && !HOLD.contains("rm"), "the script is fixed: nothing from the project is pasted into it");
        assert_eq!(launch_argv("term --", &repo, "app", Some("a | b")).unwrap_err().code(), "invalid_command");
    }

    #[test]
    fn only_an_existing_program_inside_the_project_is_launched() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path().join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        let outside = program(tmp.path(), "outside", true);
        assert_eq!(launch_argv("term --", &repo, "app", None).unwrap_err().code(), "binary_missing");
        assert_eq!(launch_argv("term --", &repo, "../outside", None).unwrap_err().code(), "invalid_path");
        assert_eq!(launch_argv("term --", &repo, "/bin/sh", None).unwrap_err().code(), "invalid_path");
        std::os::unix::fs::symlink(&outside, repo.join("link")).unwrap();
        assert_eq!(launch_argv("term --", &repo, "link", None).unwrap_err().code(), "invalid_path", "a link leaving the project is refused");
        std::fs::write(repo.join("data"), "x").unwrap();
        assert_eq!(launch_argv("term --", &repo, "data", None).unwrap_err().code(), "binary_missing");
        program(&repo, "app", true);
        assert_eq!(launch_argv("  ", &repo, "app", None).unwrap_err().code(), "not_configured");
        assert!(launch_argv("term --", &repo, "app", None).is_ok());
    }

    #[test]
    fn the_hold_script_runs_the_program_and_reports_its_exit_code() {
        let tmp = tempfile::tempdir().unwrap();
        let out = std::process::Command::new("sh").args(["-c", HOLD, "tekboard-run", "sh", "-c", "echo \"got:$1\"; exit 3", "label", "a b; echo injected"]).current_dir(tmp.path()).stdin(std::process::Stdio::null()).output().unwrap();
        let text = String::from_utf8_lossy(&out.stdout);
        assert!(text.contains("got:a b; echo injected"), "{text}");
        assert!(!text.contains("\ninjected"), "the argument was not executed: {text}");
        assert!(text.contains("[sh exited with code 3]"), "{text}");
    }
}
