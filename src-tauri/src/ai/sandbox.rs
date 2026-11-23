//! Commands an agent asks to run (compile, run the program, valgrind…) are executed here,
//! never by Claude Code itself, inside bubblewrap:
//!
//! - the whole system is read-only; the working copy is the only writable place;
//! - the home folder is replaced by an empty one, except the folders of the `PATH` that live
//!   in it (per-user compilers), read-only — keys, browser profiles and documents are invisible;
//! - no network (own network namespace), own PID and IPC namespaces, killed with TekBoard;
//! - the session bus, the Docker socket and the user runtime folder are hidden;
//! - CPU time and written file size are limited, and the wall-clock limit is enforced by
//!   killing the whole process group.
//!
//! When bubblewrap is missing or cannot start, nothing runs: there is no unsandboxed fallback.

use crate::error::{AppError, Result};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub wall: Duration,
    pub cpu_seconds: u64,
    pub file_mb: u64,
    /// Bytes of output given back (the end is kept: errors are usually there).
    pub output_cap: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Limits { wall: Duration::from_secs(60), cpu_seconds: 120, file_mb: 512, output_cap: 24 * 1024 }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Exec {
    pub code: Option<i32>,
    /// Killed by a signal (segfault = 11, abort = 6…).
    pub signal: Option<i32>,
    pub timed_out: bool,
    pub output: String,
    pub truncated: bool,
    pub duration_ms: u64,
}

/// Why the sandbox cannot be used, or `Ok` when a probe command ran inside it.
pub fn check() -> std::result::Result<(), String> {
    let Some(bwrap) = crate::toolenv::which("bwrap") else {
        return Err("bubblewrap (bwrap) n'est pas installé : `sudo apt install bubblewrap`.".into());
    };
    let dir = std::env::temp_dir().join(format!("tekboard-probe-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);
    let argv = bwrap_argv(&bwrap, &dir, "true", &Limits::default());
    let out = Command::new(&argv[0]).args(&argv[1..]).stdin(Stdio::null()).output();
    let _ = std::fs::remove_dir_all(&dir);
    match out {
        Ok(o) if o.status.success() => Ok(()),
        Ok(o) => Err(format!("bubblewrap ne démarre pas : {}", String::from_utf8_lossy(&o.stderr).trim())),
        Err(e) => Err(format!("bubblewrap ne démarre pas : {e}")),
    }
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

/// Folders of the child `PATH` that are inside the home folder (and what they link to).
fn home_tool_dirs(home: &Path) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    for d in std::env::split_paths(&crate::toolenv::child_path()) {
        for p in [d.clone(), std::fs::canonicalize(&d).unwrap_or(d)] {
            if p.starts_with(home) && p.is_dir() && !out.contains(&p) {
                out.push(p);
            }
        }
    }
    // Wrappers in those folders (ccache…) may live elsewhere under home: follow the links once.
    let mut extra = Vec::new();
    for d in &out {
        if let Ok(rd) = std::fs::read_dir(d) {
            for e in rd.flatten().take(200) {
                if let Ok(t) = std::fs::canonicalize(e.path()) {
                    if let Some(parent) = t.parent() {
                        if parent.starts_with(home) && !out.contains(&parent.to_path_buf()) && !extra.contains(&parent.to_path_buf()) {
                            extra.push(parent.to_path_buf());
                        }
                    }
                }
            }
        }
    }
    out.extend(extra);
    out
}

pub fn bwrap_argv(bwrap: &Path, work: &Path, command: &str, l: &Limits) -> Vec<String> {
    let s = |p: &Path| p.to_string_lossy().into_owned();
    let mut a: Vec<String> = vec![s(bwrap), "--ro-bind".into(), "/".into(), "/".into(), "--dev".into(), "/dev".into(), "--proc".into(), "/proc".into(), "--tmpfs".into(), "/tmp".into()];
    if let Some(h) = home() {
        a.extend(["--tmpfs".into(), s(&h)]);
        for d in home_tool_dirs(&h) {
            a.extend(["--ro-bind".into(), s(&d), s(&d)]);
        }
    }
    // Sockets that would let a program act outside: user session, Docker, system bus.
    // (`/var/run` is usually a link to `/run`: mount on the real path, once.)
    let uid = unsafe_uid();
    let mut seen: Vec<PathBuf> = Vec::new();
    for p in [format!("/run/user/{uid}"), "/run/dbus".into(), "/var/run/dbus".into()] {
        if let Ok(real) = std::fs::canonicalize(&p) {
            if real.is_dir() && !seen.contains(&real) {
                a.extend(["--tmpfs".into(), s(&real)]);
                seen.push(real);
            }
        }
    }
    for p in ["/run/docker.sock", "/var/run/docker.sock", "/run/podman/podman.sock"] {
        if let Ok(real) = std::fs::canonicalize(p) {
            if !seen.contains(&real) {
                a.extend(["--ro-bind".into(), "/dev/null".into(), s(&real)]);
                seen.push(real);
            }
        }
    }
    let w = s(work);
    a.extend(["--bind".into(), w.clone(), w.clone()]);
    a.extend(["--unshare-net".into(), "--unshare-pid".into(), "--unshare-ipc".into(), "--unshare-uts".into(), "--die-with-parent".into(), "--new-session".into()]);
    a.extend(["--setenv".into(), "HOME".into(), format!("{w}/.mouli/home"), "--setenv".into(), "TMPDIR".into(), "/tmp".into(), "--setenv".into(), "CCACHE_DISABLE".into(), "1".into(), "--setenv".into(), "PATH".into(), crate::toolenv::child_path().to_string_lossy().into_owned()]);
    a.extend(["--chdir".into(), w]);
    a.extend(["/bin/bash".into(), "-c".into(), format!("ulimit -t {} -f {} 2>/dev/null; mkdir -p \"$HOME\"; {command}", l.cpu_seconds, l.file_mb * 1024)]);
    a
}

fn unsafe_uid() -> u32 {
    // The uid of this process, read from /proc to avoid a libc dependency.
    std::fs::read_to_string("/proc/self/status").ok().and_then(|s| s.lines().find(|l| l.starts_with("Uid:")).and_then(|l| l.split_whitespace().nth(1)?.parse().ok())).unwrap_or(1000)
}

/// Runs `command` (shell syntax allowed: it only reaches bash inside the sandbox) in `work`.
pub fn exec(work: &Path, command: &str, l: &Limits) -> Result<Exec> {
    use std::io::{Read, Seek, SeekFrom};
    let bwrap = crate::toolenv::which("bwrap").ok_or_else(|| AppError::new("sandbox_missing", "bubblewrap (bwrap) n'est pas installé : `sudo apt install bubblewrap`."))?;
    let argv = bwrap_argv(&bwrap, work, command, l);
    // One file per command: several commands may run at the same time.
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = SEQ.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let path = std::env::temp_dir().join(format!("tekboard-exec-{}-{n}", std::process::id()));
    let mut file = std::fs::OpenOptions::new().read(true).write(true).create_new(true).open(&path)?;
    let _ = std::fs::remove_file(&path);
    let started = Instant::now();
    let mut child = Command::new(&argv[0]).args(&argv[1..]).stdin(Stdio::null()).stdout(Stdio::from(file.try_clone()?)).stderr(Stdio::from(file.try_clone()?)).process_group(0).spawn()?;
    let mut timed_out = false;
    let status = loop {
        if let Some(st) = child.try_wait()? {
            break st;
        }
        if started.elapsed() >= l.wall {
            timed_out = true;
            let _ = Command::new("kill").args(["-KILL", "--", &format!("-{}", child.id())]).status();
            let _ = child.kill();
            break child.wait()?;
        }
        std::thread::sleep(Duration::from_millis(40));
    };
    let mut buf = Vec::new();
    file.seek(SeekFrom::Start(0))?;
    file.read_to_end(&mut buf)?;
    let truncated = buf.len() > l.output_cap;
    let tail = if truncated { &buf[buf.len() - l.output_cap..] } else { &buf[..] };
    let mut output = String::from_utf8_lossy(tail).into_owned();
    if truncated {
        output = format!("… ({} octets coupés au début)\n{output}", buf.len() - l.output_cap);
    }
    use std::os::unix::process::ExitStatusExt;
    Ok(Exec { code: if timed_out { None } else { status.code() }, signal: status.signal(), timed_out, output, truncated, duration_ms: started.elapsed().as_millis() as u64 })
}

/// A readable summary for the agent and the log.
pub fn describe(e: &Exec) -> String {
    let state = if e.timed_out {
        "arrêtée : limite de temps".to_string()
    } else if let Some(sig) = e.signal {
        format!("tuée par le signal {sig}{}", match sig {
            11 => " (SIGSEGV, segfault)",
            6 => " (SIGABRT)",
            8 => " (SIGFPE)",
            9 => " (SIGKILL)",
            24 => " (SIGXCPU, temps CPU dépassé)",
            25 => " (SIGXFSZ, fichier trop gros)",
            _ => "",
        })
    } else {
        format!("code de sortie {}", e.code.unwrap_or(-1))
    };
    format!("[{state} · {} ms]\n{}", e.duration_ms, e.output)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Skipped only when bubblewrap is not installed; installed but broken is a failure.
    fn ready() -> bool {
        if crate::toolenv::which("bwrap").is_none() {
            eprintln!("sandbox tests skipped: bwrap not installed");
            return false;
        }
        check().unwrap();
        true
    }

    #[test]
    fn writes_stay_in_the_working_copy_and_there_is_no_network() {
        if !ready() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let home = home().unwrap();
        let probe = home.join(".tekboard-sandbox-probe");
        // The home folder inside is a throwaway tmpfs: writing there leaves no trace outside.
        let cmd = format!("echo hi > inside.txt; touch {}; touch /usr/tekboard-probe 2>/dev/null; echo sys=$?", probe.display());
        let e = exec(dir.path(), &cmd, &Limits::default()).unwrap();
        assert!(dir.path().join("inside.txt").exists(), "{}", e.output);
        assert!(!probe.exists(), "the real home must stay untouched: {}", e.output);
        assert!(e.output.contains("sys=1"), "the system is read-only: {}", e.output);
        let net = exec(dir.path(), "exec 3<>/dev/tcp/1.1.1.1/80 && echo connected || echo blocked", &Limits::default()).unwrap();
        assert!(net.output.contains("blocked"), "{}", net.output);
    }

    #[test]
    fn home_secrets_are_invisible_and_time_is_limited() {
        if !ready() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let e = exec(dir.path(), "ls -A ~/../$(whoami)/.ssh 2>&1 | head -1; ls /run/user/ 2>&1 | wc -l", &Limits::default()).unwrap();
        assert!(!e.output.contains("id_"), "{}", e.output);
        let slow = exec(dir.path(), "sleep 5", &Limits { wall: Duration::from_millis(400), ..Limits::default() }).unwrap();
        assert!(slow.timed_out && slow.code.is_none());
        let seg = exec(dir.path(), "kill -SEGV $$", &Limits::default()).unwrap();
        assert!(describe(&seg).contains("SIGSEGV") || seg.code == Some(139), "{seg:?}");
    }
}
