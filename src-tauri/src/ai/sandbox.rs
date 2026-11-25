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
    /// Memory ceiling (RAM, no swap). Enforced by a cgroup when the user systemd session can
    /// create one, otherwise by `ulimit -v` unless `address_space_free` (ASan, Valgrind).
    pub mem_mb: Option<u64>,
    /// Processes and threads at once (fork bombs).
    pub tasks: Option<u64>,
    /// The program reserves a huge address space it never uses (ASan shadow memory,
    /// Valgrind): `ulimit -v` would make it fail, only the cgroup ceiling applies.
    pub address_space_free: bool,
}

impl Default for Limits {
    fn default() -> Self {
        Limits { wall: Duration::from_secs(60), cpu_seconds: 120, file_mb: 512, output_cap: 24 * 1024, mem_mb: None, tasks: None, address_space_free: false }
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
    // One folder per probe: two checks at the same time must not remove each other's.
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let dir = std::env::temp_dir().join(format!("tekboard-probe-{}-{}", std::process::id(), SEQ.fetch_add(1, std::sync::atomic::Ordering::SeqCst)));
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

/// Quotes a word for bash: what is inside stays literal.
pub fn shell_quote(word: &str) -> String {
    if !word.is_empty() && word.chars().all(|c| c.is_ascii_alphanumeric() || "-_./=:,+@%".contains(c)) {
        return word.to_string();
    }
    format!("'{}'", word.replace('\'', "'\\''"))
}

/// Whether `systemd-run --user --scope` can put a command in its own cgroup with a memory
/// ceiling (checked once).
pub fn scope_available() -> bool {
    static OK: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *OK.get_or_init(|| {
        let Some(run) = crate::toolenv::which("systemd-run") else { return false };
        Command::new(run).args(["--user", "--scope", "-q", "-p", "MemoryMax=64M", "-p", "TasksMax=16", "true"]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok_and(|s| s.success())
    })
}

/// The argv that runs `inner` (a program and its arguments, never parsed by a shell) in the
/// sandbox with a clean environment (`envs` only, plus PATH, HOME, TMPDIR), for a job to
/// stream and cancel. Memory and process limits go to a cgroup when possible.
pub fn wrap_argv(work: &Path, inner: &[String], envs: &[(&str, &str)], l: &Limits) -> Result<Vec<String>> {
    let bwrap = crate::toolenv::which("bwrap").ok_or_else(|| AppError::new("sandbox_missing", "bubblewrap (bwrap) n'est pas installé : `sudo apt install bubblewrap`."))?;
    if inner.is_empty() {
        return Err(AppError::new("not_configured", "Aucune commande à lancer"));
    }
    let scope = (l.mem_mb.is_some() || l.tasks.is_some()) && scope_available();
    let mut prefix = String::new();
    if !scope {
        if let Some(mb) = l.mem_mb.filter(|_| !l.address_space_free) {
            prefix.push_str(&format!("ulimit -v {} 2>/dev/null; ", mb * 1024));
        }
        if let Some(n) = l.tasks {
            // Counted for the whole user: leave room for what already runs.
            prefix.push_str(&format!("ulimit -u $(( $(ps -u $(id -u) --no-headers 2>/dev/null | wc -l) + {n} )) 2>/dev/null; "));
        }
    }
    let program = inner.iter().map(|w| shell_quote(w)).collect::<Vec<_>>().join(" ");
    let mut a = bwrap_argv(&bwrap, work, &format!("{prefix}{program}"), l);
    // Clean environment: nothing of TekBoard's (keys, tokens, session) reaches the program.
    let at = a.iter().position(|x| x == "--setenv").unwrap_or(a.len());
    let mut env_args: Vec<String> = vec!["--clearenv".into()];
    for (k, v) in envs.iter().copied().chain([("LANG", "C.UTF-8"), ("TERM", "dumb")]) {
        env_args.extend(["--setenv".into(), k.to_string(), v.to_string()]);
    }
    a.splice(at..at, env_args);
    if scope {
        let run = crate::toolenv::which("systemd-run").map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|| "systemd-run".into());
        let mut s = vec![run, "--user".into(), "--scope".into(), "-q".into(), "--collect".into()];
        if let Some(mb) = l.mem_mb {
            s.extend(["-p".into(), format!("MemoryMax={mb}M"), "-p".into(), "MemorySwapMax=0".into()]);
        }
        if let Some(n) = l.tasks {
            s.extend(["-p".into(), format!("TasksMax={n}")]);
        }
        s.push("--".into());
        s.extend(a);
        return Ok(s);
    }
    Ok(a)
}

/// The signal that ended a sandboxed program, read from the exit code bash gives (128 + n).
pub fn signal_of(code: Option<i32>) -> Option<i32> {
    code.filter(|c| (129..=159).contains(c)).map(|c| c - 128)
}

/// A readable name for a signal.
pub fn signal_name(sig: i32) -> &'static str {
    match sig {
        11 => "SIGSEGV (segfault)",
        6 => "SIGABRT (abort)",
        8 => "SIGFPE (erreur arithmétique)",
        9 => "SIGKILL (tué, souvent la limite mémoire)",
        7 => "SIGBUS",
        4 => "SIGILL",
        5 => "SIGTRAP",
        13 => "SIGPIPE",
        15 => "SIGTERM",
        24 => "SIGXCPU (temps CPU dépassé)",
        25 => "SIGXFSZ (fichier ou sortie trop gros)",
        _ => "signal",
    }
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

    /// Skipped when bubblewrap is not installed, or on a CI runner that forbids the namespaces
    /// it needs (GitHub's Ubuntu images); installed but broken on a real machine is a failure.
    fn ready() -> bool {
        if crate::toolenv::which("bwrap").is_none() {
            eprintln!("sandbox tests skipped: bwrap not installed");
            return false;
        }
        match check() {
            Ok(_) => true,
            Err(e) if std::env::var_os("CI").is_some() => {
                eprintln!("sandbox tests skipped on CI: {e}");
                false
            }
            Err(e) => panic!("{e}"),
        }
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

    #[test]
    fn words_are_quoted_for_bash() {
        assert_eq!(shell_quote("./a.out"), "./a.out");
        assert_eq!(shell_quote("a b"), "'a b'");
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
        assert_eq!(shell_quote(""), "''");
        assert_eq!(shell_quote("$(rm -rf ~)"), "'$(rm -rf ~)'");
        assert_eq!(signal_of(Some(139)), Some(11));
        assert_eq!(signal_of(Some(1)), None);
    }

    fn run_wrapped(dir: &Path, inner: &[&str], l: &Limits) -> std::process::Output {
        let inner: Vec<String> = inner.iter().map(|s| s.to_string()).collect();
        let argv = wrap_argv(dir, &inner, &[("ONLY", "this")], l).unwrap();
        Command::new(&argv[0]).args(&argv[1..]).env("TEKBOARD_SECRET_PROBE", "leak").stdin(Stdio::null()).output().unwrap()
    }

    #[test]
    fn wrapped_programs_get_a_clean_environment_and_literal_arguments() {
        if !ready() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let out = run_wrapped(dir.path(), &["sh", "-c", "env; echo \"arg=$0\"", "$(touch pwned)"], &Limits::default());
        let text = String::from_utf8_lossy(&out.stdout);
        assert!(text.contains("ONLY=this") && !text.contains("TEKBOARD_SECRET_PROBE"), "{text}");
        assert!(text.contains("arg=$(touch pwned)") && !dir.path().join("pwned").exists(), "{text}");
    }

    #[test]
    fn memory_and_processes_are_limited() {
        if !ready() || crate::toolenv::which("python3").is_none() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let l = Limits { mem_mb: Some(64), tasks: Some(32), ..Limits::default() };
        let big = run_wrapped(dir.path(), &["python3", "-c", "x = bytearray(300 * 1024 * 1024); print('allocated')"], &l);
        assert!(!String::from_utf8_lossy(&big.stdout).contains("allocated"), "300 MB must not fit in 64 MB");
        let small = run_wrapped(dir.path(), &["python3", "-c", "x = bytearray(8 * 1024 * 1024); print('allocated')"], &l);
        assert!(String::from_utf8_lossy(&small.stdout).contains("allocated"), "{}", String::from_utf8_lossy(&small.stderr));
        let forks = run_wrapped(dir.path(), &["sh", "-c", "for i in $(seq 200); do sleep 2 & done 2>/dev/null; wait; echo done"], &Limits { wall: Duration::from_secs(10), ..l });
        let _ = forks; // must come back (no hang, no runaway): reaching this line is the check
    }
}
