//! Opens the IDE, a terminal or the file manager on a project folder.
//! Commands come from the user's settings and are run without a shell.

use crate::error::{AppError, Result};
use std::path::Path;
use std::process::{Command, Stdio};

/// Splits a configured command line on whitespace and substitutes `{dir}`.
/// When the placeholder is absent the folder is appended as the last argument.
pub fn build_argv(template: &str, dir: &str) -> Result<Vec<String>> {
    let mut argv: Vec<String> = template.split_whitespace().map(str::to_string).collect();
    if argv.is_empty() {
        return Err(AppError::new("not_configured", "No command is configured for this action. Set one in Settings."));
    }
    let mut used = false;
    for arg in argv.iter_mut().skip(1) {
        if arg.contains("{dir}") {
            *arg = arg.replace("{dir}", dir);
            used = true;
        }
    }
    if !used {
        argv.push(dir.to_string());
    }
    Ok(argv)
}

pub fn launch(template: &str, dir: &Path) -> Result<()> {
    if !dir.is_dir() {
        return Err(AppError::new("invalid_target", format!("{} no longer exists", dir.display())));
    }
    let argv = build_argv(template, &dir.to_string_lossy())?;
    spawn_detached(&argv, dir)
}

pub fn spawn_detached(argv: &[String], cwd: &Path) -> Result<()> {
    let mut child = Command::new(&argv[0])
        .args(&argv[1..])
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::new("command_missing", format!("“{}” was not found. Check the command in Settings.", argv[0]))
            } else {
                AppError::Io(e)
            }
        })?;
    // Reap the child so it never lingers as a zombie.
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunReport {
    /// `None` when the process was killed (timeout or signal).
    pub code: Option<i32>,
    /// stdout and stderr, interleaved as the program wrote them.
    pub output: String,
    pub timed_out: bool,
    pub duration_ms: u64,
}

const OUTPUT_CAP: usize = 400 * 1024;

/// Runs a configured command to completion and returns what it printed.
/// No shell, no stdin; killed after `timeout`.
pub fn run_captured(template: &str, cwd: &Path, timeout: std::time::Duration) -> Result<RunReport> {
    let argv: Vec<String> = template.split_whitespace().map(str::to_string).collect();
    if argv.is_empty() {
        return Err(AppError::new("not_configured", "No build command is set for this project"));
    }
    run_argv_captured(&argv, cwd, timeout, &[])
}

/// Same, from an argument array, with extra environment variables.
pub fn run_argv_captured(argv: &[String], cwd: &Path, timeout: std::time::Duration, envs: &[(&str, &str)]) -> Result<RunReport> {
    use std::io::{Read, Seek, SeekFrom};
    if !cwd.is_dir() {
        return Err(AppError::new("invalid_target", format!("{} no longer exists", cwd.display())));
    }
    // One anonymous file shared by stdout and stderr keeps their relative order.
    let mut log = tempfile_in_tmp()?;
    let started = std::time::Instant::now();
    let mut child = Command::new(&argv[0])
        .args(&argv[1..])
        .envs(envs.iter().copied())
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log.try_clone()?))
        .stderr(Stdio::from(log.try_clone()?))
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::new("command_missing", format!("“{}” was not found", argv[0]))
            } else {
                AppError::Io(e)
            }
        })?;
    let mut timed_out = false;
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if started.elapsed() >= timeout {
            timed_out = true;
            let _ = child.kill();
            break child.wait()?;
        }
        std::thread::sleep(std::time::Duration::from_millis(40));
    };
    let len = log.seek(SeekFrom::End(0))? as usize;
    let skip = len.saturating_sub(OUTPUT_CAP);
    log.seek(SeekFrom::Start(skip as u64))?;
    let mut bytes = Vec::new();
    log.read_to_end(&mut bytes)?;
    let mut output = String::from_utf8_lossy(&bytes).into_owned();
    if skip > 0 {
        output = format!("… (first {skip} bytes omitted)\n{output}");
    }
    Ok(RunReport { code: if timed_out { None } else { status.code() }, output, timed_out, duration_ms: started.elapsed().as_millis() as u64 })
}

/// A file that is already unlinked: it disappears when closed.
fn tempfile_in_tmp() -> Result<std::fs::File> {
    let path = std::env::temp_dir().join(format!("tekboard-run-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)));
    let file = std::fs::OpenOptions::new().read(true).write(true).create_new(true).open(&path)?;
    let _ = std::fs::remove_file(&path);
    Ok(file)
}

pub fn reveal(dir: &Path) -> Result<()> {
    if !dir.exists() {
        return Err(AppError::new("invalid_target", format!("{} no longer exists", dir.display())));
    }
    let cwd = if dir.is_dir() { dir } else { dir.parent().unwrap_or(Path::new("/")) };
    spawn_detached(&["xdg-open".to_string(), dir.to_string_lossy().into_owned()], cwd)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn substitutes_placeholder() {
        assert_eq!(build_argv("ptyxis --new-window -d {dir}", "/a b/c").unwrap(), vec!["ptyxis", "--new-window", "-d", "/a b/c"]);
        assert_eq!(build_argv("gnome-terminal --working-directory={dir}", "/x").unwrap(), vec!["gnome-terminal", "--working-directory=/x"]);
    }

    #[test]
    fn appends_folder_when_no_placeholder() {
        assert_eq!(build_argv("code", "/x").unwrap(), vec!["code", "/x"]);
        assert_eq!(build_argv("  code   -n ", "/x").unwrap(), vec!["code", "-n", "/x"]);
    }

    #[test]
    fn a_path_is_always_one_argument() {
        let argv = build_argv("code {dir}", "/tmp/x; rm -rf ~").unwrap();
        assert_eq!(argv, vec!["code", "/tmp/x; rm -rf ~"]);
    }

    #[test]
    fn captured_run_reports_output_code_and_timeout() {
        let tmp = tempfile::tempdir().unwrap();
        let t = std::time::Duration::from_secs(10);
        std::fs::write(tmp.path().join("Makefile"), "all:\n\t@echo building\n\t@echo oops 1>&2\n\t@exit 3\n").unwrap();
        let r = run_captured("make", tmp.path(), t).unwrap();
        assert_eq!(r.code, Some(2));
        assert!(r.output.contains("building") && r.output.contains("oops"));
        assert!(!r.timed_out);
        let ok = run_captured("true", tmp.path(), t).unwrap();
        assert_eq!(ok.code, Some(0));
        let slow = run_captured("sleep 5", tmp.path(), std::time::Duration::from_millis(150)).unwrap();
        assert!(slow.timed_out && slow.code.is_none());
        assert_eq!(run_captured("", tmp.path(), t).unwrap_err().code(), "not_configured");
        assert_eq!(run_captured("tekboard-no-such-binary", tmp.path(), t).unwrap_err().code(), "command_missing");
    }

    #[test]
    fn empty_command_is_reported() {
        assert_eq!(build_argv("  ", "/x").unwrap_err().code(), "not_configured");
    }

    #[test]
    fn missing_binary_and_folder_are_reported() {
        let tmp = tempfile::tempdir().unwrap();
        assert_eq!(launch("tekboard-no-such-binary {dir}", tmp.path()).unwrap_err().code(), "command_missing");
        assert_eq!(launch("true", &tmp.path().join("gone")).unwrap_err().code(), "invalid_target");
        launch("true {dir}", tmp.path()).unwrap();
    }
}
