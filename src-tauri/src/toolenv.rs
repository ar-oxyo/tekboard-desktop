//! Finds programs the way the user's terminal would.
//!
//! An application started from the desktop does not inherit what the shell adds to `PATH`
//! in its startup files (`~/.zshrc`, `~/.bashrc`): on this kind of session `~/.local/bin`,
//! version managers and per-user installs are simply absent. So a program is looked up in:
//! 1. the path the user picked in Settings, when there is one for that program;
//! 2. the `PATH` of this process;
//! 3. the usual per-user install folders;
//! 4. the `PATH` of the login shell, asked once.
//! Nothing is assumed about where a given tool lives, and the process environment is never
//! modified: child processes receive the completed `PATH` explicitly.

use serde::Serialize;
use std::collections::HashMap;
use std::ffi::OsString;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const SHELL_TIMEOUT: Duration = Duration::from_secs(4);
const START: &str = "__TEKBOARD_PATH_START__";
const END: &str = "__TEKBOARD_PATH_END__";

pub fn is_executable(p: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    p.metadata().map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0).unwrap_or(false)
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from).filter(|h| h.is_absolute())
}

fn process_dirs() -> Vec<PathBuf> {
    std::env::var_os("PATH").map(|p| std::env::split_paths(&p).filter(|d| d.is_absolute()).collect()).unwrap_or_default()
}

/// Per-user folders installers commonly use. Only the ones that exist are returned.
pub fn user_dirs(home: &Path) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = [".local/bin", "bin", ".claude/local", ".npm-global/bin", ".bun/bin", ".volta/bin", ".cargo/bin", ".yarn/bin", ".deno/bin", ".local/share/pnpm"].iter().map(|d| home.join(d)).collect();
    // Version managers keep one folder per installed version: newest first.
    for pattern in [".nvm/versions/node", ".local/share/fnm/node-versions", ".asdf/installs/nodejs"] {
        if let Ok(entries) = std::fs::read_dir(home.join(pattern)) {
            let mut versions: Vec<PathBuf> = entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
            versions.sort();
            versions.reverse();
            for v in versions {
                dirs.push(v.join("bin"));
                dirs.push(v.join("installation/bin"));
            }
        }
    }
    dirs.into_iter().filter(|d| d.is_dir()).collect()
}

/// Extracts the directories printed between the two markers by the login shell.
pub fn parse_shell_path(output: &str) -> Vec<PathBuf> {
    let Some(start) = output.rfind(START) else { return vec![] };
    let rest = &output[start + START.len()..];
    let Some(end) = rest.find(END) else { return vec![] };
    std::env::split_paths(&rest[..end]).filter(|d| d.is_absolute()).collect()
}

/// Asks the login shell, started as an interactive login shell, for its `PATH`.
/// Bounded in time; whatever the startup files print around the markers is ignored.
fn ask_shell(shell: &Path) -> Vec<PathBuf> {
    let script = format!("printf '%s%s%s' '{START}' \"$PATH\" '{END}'");
    let Ok(mut child) = Command::new(shell).args(["-l", "-i", "-c", &script]).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).process_group(0).spawn() else { return vec![] };
    let pid = child.id();
    let Some(mut out) = child.stdout.take() else { return vec![] };
    let reader = std::thread::spawn(move || {
        use std::io::Read;
        let mut text = String::new();
        let mut buf = Vec::new();
        let _ = out.read_to_end(&mut buf);
        text.push_str(&String::from_utf8_lossy(&buf));
        text
    });
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() < SHELL_TIMEOUT => std::thread::sleep(Duration::from_millis(25)),
            _ => {
                let _ = Command::new("kill").args(["-KILL", "--", &format!("-{pid}")]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status();
                let _ = child.kill();
                let _ = child.wait();
                break;
            }
        }
    }
    parse_shell_path(&reader.join().unwrap_or_default())
}

static SHELL_DIRS: OnceLock<Vec<PathBuf>> = OnceLock::new();

/// `PATH` of the user's login shell. Asked once per run; callers arriving meanwhile wait for it.
pub fn shell_dirs() -> &'static [PathBuf] {
    SHELL_DIRS.get_or_init(|| {
        // Tests and scripted runs can skip the probe.
        if std::env::var_os("TEKBOARD_NO_SHELL_PATH").is_some() {
            return vec![];
        }
        match std::env::var_os("SHELL").map(PathBuf::from).filter(|s| s.is_absolute() && is_executable(s)) {
            Some(shell) => ask_shell(&shell),
            None => vec![],
        }
    })
}

/// Reads the login shell's `PATH` in the background so the first lookup does not wait.
pub fn warm_up() {
    std::thread::spawn(|| {
        shell_dirs();
    });
}

static OVERRIDES: OnceLock<Mutex<HashMap<String, PathBuf>>> = OnceLock::new();

fn overrides() -> std::sync::MutexGuard<'static, HashMap<String, PathBuf>> {
    OVERRIDES.get_or_init(Default::default).lock().unwrap_or_else(|e| e.into_inner())
}

/// Path chosen by the user for `name` (from Settings). `None` clears it.
pub fn set_override(name: &str, path: Option<&str>) {
    let mut map = overrides();
    match path.map(str::trim).filter(|p| !p.is_empty()) {
        Some(p) => map.insert(name.to_string(), PathBuf::from(p)),
        None => map.remove(name),
    };
}

pub fn override_for(name: &str) -> Option<PathBuf> {
    overrides().get(name).cloned()
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub path: PathBuf,
    /// `settings`, `path`, `user`, `shell`.
    pub source: &'static str,
}

/// Where each source would look, in order. Kept separate so the search itself can be tested.
pub fn sources() -> Vec<(&'static str, Vec<PathBuf>)> {
    vec![("path", process_dirs()), ("user", home().map(|h| user_dirs(&h)).unwrap_or_default()), ("shell", shell_dirs().to_vec())]
}

pub fn find_in(name: &str, sources: &[(&'static str, Vec<PathBuf>)]) -> Option<Found> {
    // A name with a slash is a path, not something to search for.
    if name.is_empty() || name.contains('/') {
        return None;
    }
    sources.iter().find_map(|(source, dirs)| dirs.iter().map(|d| d.join(name)).find(|p| is_executable(p)).map(|path| Found { path, source }))
}

/// The program `name`, wherever the user's terminal would find it.
pub fn find(name: &str) -> Option<Found> {
    if let Some(path) = override_for(name) {
        if is_executable(&path) {
            return Some(Found { path, source: "settings" });
        }
    }
    // The login shell is only asked when the quicker places do not have the program.
    let quick = [("path", process_dirs()), ("user", home().map(|h| user_dirs(&h)).unwrap_or_default())];
    find_in(name, &quick).or_else(|| find_in(name, &[("shell", shell_dirs().to_vec())]))
}

pub fn which(name: &str) -> Option<PathBuf> {
    find(name).map(|f| f.path)
}

/// `PATH` for child processes: this process's own, then the user folders and the login
/// shell's entries that are missing from it. The system order is never changed.
pub fn child_path() -> OsString {
    let mut dirs = process_dirs();
    for d in home().map(|h| user_dirs(&h)).unwrap_or_default().into_iter().chain(shell_dirs().iter().cloned()) {
        if !dirs.contains(&d) {
            dirs.push(d);
        }
    }
    std::env::join_paths(dirs).unwrap_or_else(|_| std::env::var_os("PATH").unwrap_or_default())
}

/// A command for `program` (a name or a path), resolved like `find` and given the completed `PATH`.
pub fn command(program: &str) -> Command {
    let resolved = if program.contains('/') { PathBuf::from(program) } else { which(program).unwrap_or_else(|| PathBuf::from(program)) };
    let mut cmd = Command::new(resolved);
    cmd.env("PATH", child_path());
    scrub_env(&mut cmd);
    cmd
}

/// Variables a child must not inherit. When TekBoard itself was started from a Claude Code
/// session (a terminal inside it, `npm run app:dev` from its shell), these would make the
/// `claude` started by TekBoard believe it is nested in that session.
const SCRUBBED: &[&str] = &["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SSE_PORT", "CLAUDE_CODE_SESSION_ID", "CLAUDE_AGENT_SDK_VERSION", "CLAUDE_CODE_SIMPLE", "CLAUDE_CODE_SAFE_MODE"];

pub fn scrub_env(cmd: &mut Command) {
    for k in SCRUBBED {
        cmd.env_remove(k);
    }
}

/// First line a program prints for `args`, within `timeout`. `Err` says why there is none.
pub fn first_line(path: &Path, args: &[&str], timeout: Duration) -> Result<String, String> {
    let mut child = Command::new(path).args(args).env("PATH", child_path()).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break s,
            Ok(None) if started.elapsed() < timeout => std::thread::sleep(Duration::from_millis(20)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("no answer after {} s", timeout.as_secs()));
            }
            Err(e) => return Err(e.to_string()),
        }
    };
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    let text = if out.stdout.is_empty() { &out.stderr } else { &out.stdout };
    let line = String::from_utf8_lossy(text).lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or_default().chars().take(120).collect::<String>();
    if !status.success() {
        return Err(if line.is_empty() { format!("exited with {}", status.code().map(|c| c.to_string()).unwrap_or_else(|| "a signal".into())) } else { line });
    }
    if line.is_empty() { Err("printed nothing".into()) } else { Ok(line) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn exe(dir: &Path, name: &str, script: &str) -> PathBuf {
        std::fs::create_dir_all(dir).unwrap();
        let p = dir.join(name);
        std::fs::write(&p, script).unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
        p
    }

    #[test]
    fn a_program_missing_from_the_desktop_path_is_found_in_a_user_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        // What a graphical session gives: system folders only.
        let desktop = vec![home.join("usr/bin")];
        std::fs::create_dir_all(&desktop[0]).unwrap();
        let tool = exe(&home.join(".local/bin"), "claude", "#!/bin/sh\necho 9.9.9\n");
        let sources = vec![("path", desktop.clone()), ("user", user_dirs(home)), ("shell", vec![])];
        assert_eq!(find_in("claude", &[("path", desktop)]), None, "the bug: the desktop PATH alone does not have it");
        assert_eq!(find_in("claude", &sources), Some(Found { path: tool, source: "user" }));
    }

    #[test]
    fn sources_are_tried_in_order_and_only_executables_count() {
        let tmp = tempfile::tempdir().unwrap();
        let (a, b, c) = (tmp.path().join("a"), tmp.path().join("b"), tmp.path().join("c"));
        std::fs::create_dir_all(&a).unwrap();
        std::fs::write(a.join("tool"), "not executable").unwrap();
        let in_b = exe(&b, "tool", "#!/bin/sh\n");
        exe(&c, "tool", "#!/bin/sh\n");
        std::fs::create_dir_all(b.join("dir-tool")).unwrap();
        let sources = vec![("path", vec![a.clone()]), ("user", vec![b.clone()]), ("shell", vec![c.clone()])];
        assert_eq!(find_in("tool", &sources), Some(Found { path: in_b, source: "user" }), "a non-executable file is skipped, the first real one wins");
        assert_eq!(find_in("dir-tool", &sources), None, "a directory is not a program");
        assert_eq!(find_in("../b/tool", &sources), None, "a path is not searched");
        assert_eq!(find_in("", &sources), None);
        assert_eq!(find_in("absent", &sources), None);
    }

    #[test]
    fn version_managers_are_looked_up_newest_first() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        exe(&home.join(".nvm/versions/node/v20.1.0/bin"), "claude", "#!/bin/sh\n");
        let newest = exe(&home.join(".nvm/versions/node/v24.21.0/bin"), "claude", "#!/bin/sh\n");
        let dirs = user_dirs(home);
        assert!(dirs.iter().all(|d| d.is_dir()), "only existing folders");
        assert_eq!(find_in("claude", &[("user", dirs)]).unwrap().path, newest);
    }

    #[test]
    fn the_login_shell_path_is_read_between_markers_whatever_else_is_printed() {
        let out = format!("motd line\n\u{1b}[0mprompt noise{START}/home/u/.local/bin:/usr/bin:relative/dir:{END}trailing");
        assert_eq!(parse_shell_path(&out), vec![PathBuf::from("/home/u/.local/bin"), PathBuf::from("/usr/bin")]);
        assert!(parse_shell_path("no markers at all").is_empty());
        assert!(parse_shell_path(&format!("{START}/usr/bin")).is_empty(), "a cut answer is not trusted");
    }

    #[test]
    fn a_real_shell_is_asked_and_a_hanging_one_is_given_up_on() {
        let tmp = tempfile::tempdir().unwrap();
        let sh = exe(tmp.path(), "fake-shell", &format!("#!/bin/sh\nprintf 'banner\\n{START}/opt/tools/bin:/usr/bin{END}'\n"));
        assert_eq!(ask_shell(&sh), vec![PathBuf::from("/opt/tools/bin"), PathBuf::from("/usr/bin")]);
        let stuck = exe(tmp.path(), "stuck-shell", "#!/bin/sh\nsleep 60\n");
        let started = Instant::now();
        assert!(ask_shell(&stuck).is_empty());
        assert!(started.elapsed() < SHELL_TIMEOUT + Duration::from_secs(3), "bounded");
        assert!(ask_shell(Path::new("/nonexistent/shell")).is_empty());
    }

    #[test]
    fn first_line_reports_version_failure_and_silence() {
        let tmp = tempfile::tempdir().unwrap();
        let t = Duration::from_secs(5);
        let ok = exe(tmp.path(), "ok", "#!/bin/sh\necho\necho '2.1.322 (Claude Code)'\necho more\n");
        assert_eq!(first_line(&ok, &["--version"], t).unwrap(), "2.1.322 (Claude Code)");
        let bad = exe(tmp.path(), "bad", "#!/bin/sh\necho 'node: not found' 1>&2\nexit 127\n");
        assert_eq!(first_line(&bad, &["--version"], t).unwrap_err(), "node: not found");
        let mute = exe(tmp.path(), "mute", "#!/bin/sh\nexit 0\n");
        assert_eq!(first_line(&mute, &[], t).unwrap_err(), "printed nothing");
        let slow = exe(tmp.path(), "slow", "#!/bin/sh\nsleep 30\n");
        assert!(first_line(&slow, &[], Duration::from_millis(200)).unwrap_err().contains("no answer"));
        assert!(first_line(&tmp.path().join("gone"), &[], t).is_err());
    }
}
