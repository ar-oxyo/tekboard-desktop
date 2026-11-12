//! Long operations (clean-clone test, unit tests, checks): they run on their own thread,
//! expose their steps and log while running, can be cancelled, and end up in the `runs` history.
//! Commands are argument arrays started without a shell, in their own process group.

use crate::db;
use crate::error::{AppError, Result};
use rusqlite::Connection;
use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const LOG_CAP: usize = 600 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub id: String,
    pub label: String,
    /// `pending`, `running`, `success`, `warning`, `failed`, `skipped`, `cancelled`.
    pub status: String,
    pub detail: Option<String>,
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobView {
    pub id: u64,
    pub kind: String,
    pub repo: Option<String>,
    pub title: String,
    /// `running`, `success`, `warning`, `failed`, `cancelled`.
    pub status: String,
    pub steps: Vec<Step>,
    pub log: String,
    pub started_at: i64,
    pub duration_ms: u64,
    pub summary: Map<String, Value>,
    /// Row in the history once the job is over.
    pub run_id: Option<i64>,
}

pub struct Job {
    view: Mutex<JobView>,
    cancel: AtomicBool,
    pgid: AtomicI32,
    /// Extra command to stop what the child started elsewhere (a container).
    on_kill: Mutex<Option<Vec<String>>>,
    started: Instant,
    step_started: Mutex<HashMap<String, Instant>>,
}

#[derive(Debug, Clone)]
pub struct Outcome {
    pub code: Option<i32>,
    pub output: String,
    pub timed_out: bool,
    pub cancelled: bool,
    pub duration_ms: u64,
}

impl Outcome {
    pub fn ok(&self) -> bool {
        self.code == Some(0)
    }
}

impl Job {
    fn lock(&self) -> std::sync::MutexGuard<'_, JobView> {
        self.view.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn id(&self) -> u64 {
        self.lock().id
    }

    pub fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::SeqCst)
    }

    pub fn log(&self, text: &str) {
        let mut v = self.lock();
        v.log.push_str(text);
        if !text.ends_with('\n') {
            v.log.push('\n');
        }
        if v.log.len() > LOG_CAP {
            let cut = v.log.len() - LOG_CAP * 3 / 4;
            let cut = (cut..v.log.len()).find(|i| v.log.is_char_boundary(*i)).unwrap_or(0);
            v.log = format!("… (beginning of the log dropped)\n{}", &v.log[cut..]);
        }
    }

    pub fn start(&self, id: &str) {
        self.step_started.lock().unwrap_or_else(|e| e.into_inner()).insert(id.to_string(), Instant::now());
        let mut v = self.lock();
        if let Some(s) = v.steps.iter_mut().find(|s| s.id == id) {
            s.status = "running".into();
            let label = s.label.clone();
            drop(v);
            self.log(&format!("\n── {label}"));
        }
    }

    pub fn end(&self, id: &str, status: &str, detail: impl Into<Option<String>>) {
        let took = self.step_started.lock().unwrap_or_else(|e| e.into_inner()).get(id).map(|t| t.elapsed().as_millis() as u64);
        let mut v = self.lock();
        if let Some(s) = v.steps.iter_mut().find(|s| s.id == id) {
            s.status = status.to_string();
            s.detail = detail.into();
            s.duration_ms = took;
        }
    }

    pub fn skip(&self, id: &str, why: &str) {
        self.end(id, "skipped", Some(why.to_string()));
    }

    pub fn set(&self, key: &str, value: impl Serialize) {
        if let Ok(v) = serde_json::to_value(value) {
            self.lock().summary.insert(key.to_string(), v);
        }
    }

    pub fn kill_with(&self, argv: Option<Vec<String>>) {
        *self.on_kill.lock().unwrap_or_else(|e| e.into_inner()) = argv;
    }

    /// Runs a command to its end, streaming what it prints into the job log.
    /// Stops it (whole process group) on cancel or after `timeout`.
    pub fn run(&self, argv: &[String], cwd: &Path, timeout: Duration, envs: &[(&str, &str)]) -> Result<Outcome> {
        use std::io::{Read, Seek, SeekFrom};
        if argv.is_empty() {
            return Err(AppError::new("not_configured", "No command to run"));
        }
        if self.cancelled() {
            return Ok(Outcome { code: None, output: String::new(), timed_out: false, cancelled: true, duration_ms: 0 });
        }
        self.log(&format!("$ {}", argv.join(" ")));
        let path = std::env::temp_dir().join(format!("tekboard-job-{}-{}", std::process::id(), self.started.elapsed().as_nanos()));
        let mut file = std::fs::OpenOptions::new().read(true).write(true).create_new(true).open(&path)?;
        let _ = std::fs::remove_file(&path);
        let started = Instant::now();
        let mut child = crate::toolenv::command(&argv[0])
            .args(&argv[1..])
            .envs(envs.iter().copied())
            .current_dir(cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::from(file.try_clone()?))
            .stderr(Stdio::from(file.try_clone()?))
            .process_group(0)
            .spawn()
            .map_err(|e| if e.kind() == std::io::ErrorKind::NotFound { AppError::new("command_missing", format!("“{}” was not found", argv[0])) } else { AppError::Io(e) })?;
        self.pgid.store(child.id() as i32, Ordering::SeqCst);
        let mut output = String::new();
        let mut pos = 0u64;
        let mut pump = |file: &mut std::fs::File, output: &mut String| {
            let mut buf = Vec::new();
            if file.seek(SeekFrom::Start(pos)).is_ok() && file.read_to_end(&mut buf).is_ok() && !buf.is_empty() {
                pos += buf.len() as u64;
                let text = String::from_utf8_lossy(&buf).into_owned();
                if output.len() < LOG_CAP {
                    output.push_str(&text);
                }
                let mut v = self.lock();
                v.log.push_str(&text);
            }
        };
        let (mut timed_out, mut cancelled) = (false, false);
        let status = loop {
            pump(&mut file, &mut output);
            if let Some(status) = child.try_wait()? {
                break status;
            }
            let stop_cancel = self.cancelled();
            if stop_cancel || started.elapsed() >= timeout {
                cancelled = stop_cancel;
                timed_out = !stop_cancel;
                self.kill_group(child.id());
                let _ = child.kill();
                break child.wait()?;
            }
            std::thread::sleep(Duration::from_millis(80));
        };
        pump(&mut file, &mut output);
        // `cancel()` may have killed the group before this loop noticed the flag.
        cancelled = cancelled || (!timed_out && self.cancelled());
        self.pgid.store(0, Ordering::SeqCst);
        if !self.lock().log.ends_with('\n') {
            self.log("");
        }
        if timed_out {
            self.log(&format!("(stopped after {} s: time limit)", timeout.as_secs()));
        }
        Ok(Outcome { code: if timed_out || cancelled { None } else { status.code() }, output, timed_out, cancelled, duration_ms: started.elapsed().as_millis() as u64 })
    }

    fn kill_group(&self, pid: u32) {
        let _ = Command::new("kill").args(["-KILL", "--", &format!("-{pid}")]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status();
        if let Some(argv) = self.on_kill.lock().unwrap_or_else(|e| e.into_inner()).clone() {
            let _ = Command::new(&argv[0]).args(&argv[1..]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status();
        }
    }
}

#[derive(Default)]
pub struct Jobs {
    jobs: Mutex<HashMap<u64, Arc<Job>>>,
    next: AtomicU64,
}

impl Jobs {
    fn map(&self) -> std::sync::MutexGuard<'_, HashMap<u64, Arc<Job>>> {
        self.jobs.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// A job of this kind already running on this repository, if any: a second click joins it.
    pub fn active(&self, kind: &str, repo: Option<&str>) -> Option<u64> {
        self.map().values().find_map(|j| {
            let v = j.lock();
            (v.status == "running" && v.kind == kind && v.repo.as_deref() == repo).then_some(v.id)
        })
    }

    pub fn get(&self, id: u64) -> Option<JobView> {
        let job = self.map().get(&id).cloned()?;
        let mut view = job.lock().clone();
        if view.status == "running" {
            view.duration_ms = job.started.elapsed().as_millis() as u64;
        }
        Some(view)
    }

    pub fn cancel(&self, id: u64) {
        if let Some(job) = self.map().get(&id).cloned() {
            job.cancel.store(true, Ordering::SeqCst);
            let pid = job.pgid.load(Ordering::SeqCst);
            if pid > 0 {
                job.kill_group(pid as u32);
            }
        }
    }

    /// Starts `work` on a thread. It returns the final status (`success`, `warning`, `failed`).
    pub fn start<F>(&self, db: Arc<Mutex<Connection>>, kind: &str, repo: Option<String>, title: String, steps: &[(&str, &str)], work: F) -> u64
    where
        F: FnOnce(&Job) -> Result<&'static str> + Send + 'static,
    {
        let id = self.next.fetch_add(1, Ordering::SeqCst) + 1;
        let view = JobView {
            id,
            kind: kind.to_string(),
            repo,
            title,
            status: "running".into(),
            steps: steps.iter().map(|(id, label)| Step { id: id.to_string(), label: label.to_string(), status: "pending".into(), detail: None, duration_ms: None }).collect(),
            log: String::new(),
            started_at: chrono::Utc::now().timestamp(),
            duration_ms: 0,
            summary: Map::new(),
            run_id: None,
        };
        let job = Arc::new(Job { view: Mutex::new(view), cancel: AtomicBool::new(false), pgid: AtomicI32::new(0), on_kill: Mutex::new(None), started: Instant::now(), step_started: Mutex::new(HashMap::new()) });
        {
            // Keep the table small: forget finished jobs beyond the most recent ones.
            let mut map = self.map();
            if map.len() > 40 {
                let mut done: Vec<u64> = map.iter().filter(|(_, j)| j.lock().status != "running").map(|(k, _)| *k).collect();
                done.sort();
                for k in done.into_iter().take(20) {
                    map.remove(&k);
                }
            }
            map.insert(id, job.clone());
        }
        std::thread::spawn(move || {
            let result = work(&job);
            let cancelled = job.cancelled();
            let status = match (&result, cancelled) {
                (_, true) => "cancelled",
                (Ok(s), _) => s,
                (Err(_), _) => "failed",
            };
            if let Err(e) = &result {
                job.log(&format!("\nError: {e}"));
            }
            let snapshot = {
                let mut v = job.lock();
                for s in v.steps.iter_mut() {
                    match s.status.as_str() {
                        "running" => s.status = if cancelled { "cancelled".into() } else { "failed".into() },
                        "pending" => s.status = "skipped".into(),
                        _ => {}
                    }
                }
                v.status = status.to_string();
                v.duration_ms = job.started.elapsed().as_millis() as u64;
                let steps = serde_json::to_value(&v.steps).unwrap_or(Value::Null);
                v.summary.insert("steps".into(), steps);
                v.clone()
            };
            let conn = db.lock().unwrap_or_else(|e| e.into_inner());
            let saved = db::insert_run(&conn, &snapshot.kind, snapshot.repo.as_deref(), snapshot.started_at, snapshot.duration_ms as i64, &snapshot.status, &snapshot.title, &Value::Object(snapshot.summary.clone()).to_string(), &snapshot.log);
            drop(conn);
            if let Ok(run_id) = saved {
                job.lock().run_id = Some(run_id);
            }
        });
        id
    }
}

/// Splits a configured command line into arguments. No shell is involved, so quotes,
/// pipes and `&&` are refused instead of being silently passed as literal words.
pub fn argv_of(command: &str) -> Result<Vec<String>> {
    if command.chars().any(|c| matches!(c, '|' | '&' | ';' | '<' | '>' | '`' | '$' | '"' | '\'' | '\\' | '\n')) {
        return Err(AppError::new("invalid_command", "Commands run without a shell: no quotes, pipes, redirections or variables. Put complex commands in a Makefile rule."));
    }
    let argv: Vec<String> = command.split_whitespace().map(str::to_string).collect();
    if argv.is_empty() {
        return Err(AppError::new("not_configured", "No command is set"));
    }
    Ok(argv)
}

/// Splits a command typed by the user into a program and its arguments, the way a shell
/// would read quotes, but without any shell: `"…"` and `'…'` group words, `\` escapes the
/// next character outside single quotes. Operators that only a shell understands
/// (pipes, `&&`, redirections, `$VAR`, backticks) are refused when they are not quoted,
/// instead of being handed to the program as literal words.
pub fn split_command(command: &str) -> Result<Vec<String>> {
    let refuse = |c: char| AppError::new("invalid_command", format!("“{c}” needs a shell, and commands here run without one. Quote it to pass it as text, or put the pipeline in a Makefile rule or a script."));
    let mut words: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut in_word = false;
    let mut quote: Option<char> = None;
    let mut chars = command.chars();
    while let Some(c) = chars.next() {
        match quote {
            Some('\'') => {
                if c == '\'' { quote = None } else { cur.push(c) }
            }
            Some(_) => match c {
                '"' => quote = None,
                '\\' => match chars.next() {
                    Some(n @ ('"' | '\\')) => cur.push(n),
                    Some(n) => {
                        cur.push('\\');
                        cur.push(n);
                    }
                    None => return Err(AppError::new("invalid_command", "The command ends with a lone backslash")),
                },
                '$' | '`' => return Err(refuse(c)),
                _ => cur.push(c),
            },
            None => match c {
                '\'' | '"' => {
                    quote = Some(c);
                    in_word = true;
                }
                '\\' => match chars.next() {
                    Some(n) => {
                        cur.push(n);
                        in_word = true;
                    }
                    None => return Err(AppError::new("invalid_command", "The command ends with a lone backslash")),
                },
                '|' | '&' | ';' | '<' | '>' | '`' | '$' | '\n' | '\r' | '\0' => return Err(refuse(if c.is_control() { '⏎' } else { c })),
                c if c.is_whitespace() => {
                    if in_word {
                        words.push(std::mem::take(&mut cur));
                        in_word = false;
                    }
                }
                _ => {
                    cur.push(c);
                    in_word = true;
                }
            },
        }
    }
    if quote.is_some() {
        return Err(AppError::new("invalid_command", "A quote is not closed"));
    }
    if in_word {
        words.push(cur);
    }
    if words.is_empty() {
        return Err(AppError::new("not_configured", "No command to run"));
    }
    if words[0].is_empty() {
        return Err(AppError::new("invalid_command", "The program name is empty"));
    }
    Ok(words)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typed_commands_are_split_like_a_shell_would_without_running_one() {
        let ok = |c: &str| split_command(c).unwrap();
        assert_eq!(ok("make  re"), vec!["make", "re"]);
        assert_eq!(ok("./my_hunter -h"), vec!["./my_hunter", "-h"]);
        assert_eq!(ok(r#"./a.out "two words" 'it is $HOME; rm -rf' plain"#), vec!["./a.out", "two words", "it is $HOME; rm -rf", "plain"]);
        assert_eq!(ok(r#"echo a\ b "say \"hi\"" ''"#), vec!["echo", "a b", "say \"hi\"", ""]);
        assert_eq!(ok(r#"grep -n "a|b" 'x>y'"#), vec!["grep", "-n", "a|b", "x>y"], "operators are plain text once quoted");
        assert_eq!(ok("make CFLAGS=-g3"), vec!["make", "CFLAGS=-g3"]);
        for bad in ["make && rm -rf x", "echo $HOME", "a | b", "ls > out", "cat < in", "echo `id`", "make; ls", "sleep 1 &", "echo \"$(id)\"", "a\nb", "say 'unclosed", "tail \\"] {
            assert_eq!(split_command(bad).unwrap_err().code(), "invalid_command", "{bad}");
        }
        assert_eq!(split_command("   ").unwrap_err().code(), "not_configured");
        assert_eq!(split_command("'' arg").unwrap_err().code(), "invalid_command");
    }

    fn wait(jobs: &Jobs, id: u64) -> JobView {
        for _ in 0..400 {
            let v = jobs.get(id).unwrap();
            if v.status != "running" && v.run_id.is_some() {
                return v;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        panic!("job did not finish");
    }

    fn db() -> Arc<Mutex<Connection>> {
        Arc::new(Mutex::new(db::open_in_memory().unwrap()))
    }

    fn sh(script: &str) -> Vec<String> {
        vec!["sh".into(), "-c".into(), script.into()]
    }

    #[test]
    fn runs_steps_streams_output_and_lands_in_history() {
        let (jobs, conn) = (Jobs::default(), db());
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_path_buf();
        let id = jobs.start(conn.clone(), "tests", Some("/r".into()), "demo".into(), &[("a", "First"), ("b", "Second"), ("c", "Never")], move |job| {
            job.start("a");
            let o = job.run(&sh("echo out; echo err 1>&2; exit 3"), &dir, Duration::from_secs(10), &[])?;
            assert_eq!(o.code, Some(3));
            assert!(o.output.contains("out") && o.output.contains("err"));
            job.end("a", "warning", Some("exit 3".to_string()));
            job.start("b");
            job.end("b", "success", None);
            job.set("answer", 42);
            Ok("warning")
        });
        let v = wait(&jobs, id);
        assert_eq!(v.status, "warning");
        assert_eq!(v.steps.iter().map(|s| s.status.as_str()).collect::<Vec<_>>(), vec!["warning", "success", "skipped"]);
        assert!(v.log.contains("$ sh -c") && v.log.contains("── First"));
        let run = db::get_run(&conn.lock().unwrap(), v.run_id.unwrap()).unwrap().unwrap();
        assert_eq!((run.kind.as_str(), run.status.as_str(), run.repo_path.as_deref()), ("tests", "warning", Some("/r")));
        assert_eq!(run.summary["answer"], 42);
        assert!(run.log.unwrap().contains("out"));
    }

    #[test]
    fn cancel_kills_the_whole_process_group() {
        let (jobs, conn) = (Jobs::default(), db());
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_path_buf();
        let marker = dir.join("survivor");
        let script = format!("(sleep 2; touch {}) & sleep 30", marker.display());
        let id = jobs.start(conn, "testrepo", None, "slow".into(), &[("a", "Sleep")], move |job| {
            job.start("a");
            let o = job.run(&sh(&script), &dir, Duration::from_secs(60), &[])?;
            assert!(o.cancelled);
            Ok("success")
        });
        std::thread::sleep(Duration::from_millis(300));
        assert_eq!(jobs.active("testrepo", None), Some(id));
        jobs.cancel(id);
        let v = wait(&jobs, id);
        assert_eq!(v.status, "cancelled");
        assert_eq!(v.steps[0].status, "cancelled");
        assert!(v.duration_ms < 5000);
        std::thread::sleep(Duration::from_millis(2300));
        assert!(!marker.exists(), "the background child was killed too");
        assert_eq!(jobs.active("testrepo", None), None);
    }

    #[test]
    fn timeout_and_missing_command() {
        let (jobs, conn) = (Jobs::default(), db());
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().to_path_buf();
        let id = jobs.start(conn, "tests", None, "t".into(), &[("a", "A")], move |job| {
            job.start("a");
            let o = job.run(&sh("sleep 20"), &dir, Duration::from_millis(300), &[])?;
            assert!(o.timed_out && o.code.is_none());
            job.run(&["definitely-not-a-command-xyz".to_string()], &dir, Duration::from_secs(1), &[])?;
            Ok("success")
        });
        let v = wait(&jobs, id);
        assert_eq!(v.status, "failed");
        assert!(v.log.contains("time limit") && v.log.contains("was not found"));
    }

    #[test]
    fn command_lines_refuse_shell_syntax() {
        assert_eq!(argv_of("make  re").unwrap(), vec!["make", "re"]);
        for bad in ["make && rm -rf x", "echo $HOME", "a | b", "sh -c 'x'", ""] {
            assert!(argv_of(bad).is_err(), "{bad}");
        }
    }
}
