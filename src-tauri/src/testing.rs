//! Unit tests: find what a repository offers to run, run it as a job, read the results.
//! Only what the repository itself declares is proposed; scripts are never started on their own.

use crate::error::Result;
use crate::jobs::{argv_of, Job};
use serde::Serialize;
use std::path::Path;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Suite {
    pub id: String,
    /// `make`, `ctest`, `script`.
    pub kind: &'static str,
    pub label: String,
    pub command: String,
    pub note: Option<String>,
    /// False for scripts: the user must read and pick them explicitly.
    pub trusted: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Detection {
    pub suites: Vec<Suite>,
    /// Frameworks seen in the sources (`Criterion`, `CTest`).
    pub frameworks: Vec<String>,
    pub test_files: usize,
    pub notes: Vec<String>,
}

/// Rule names declared in a Makefile (`name:` at the start of a line).
pub fn make_targets(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in text.lines() {
        if line.starts_with(['\t', ' ', '#', '.']) {
            continue;
        }
        let Some((head, rest)) = line.split_once(':') else { continue };
        if rest.starts_with('=') || head.contains('=') || head.contains('$') || head.contains('%') {
            continue;
        }
        out.extend(head.split_whitespace().map(str::to_string));
    }
    out.sort();
    out.dedup();
    out
}

fn read(path: &Path) -> Option<String> {
    let meta = path.metadata().ok()?;
    (meta.is_file() && meta.len() < 2 * 1024 * 1024).then(|| std::fs::read(path).ok()).flatten().map(|b| String::from_utf8_lossy(&b).into_owned())
}

/// `.c` files under `dir`, a few levels deep.
fn c_files(dir: &Path, depth: usize, out: &mut Vec<std::path::PathBuf>) {
    if depth > 4 || out.len() > 500 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let Ok(ft) = e.file_type() else { continue };
        let name = e.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || ft.is_symlink() {
            continue;
        }
        if ft.is_dir() {
            c_files(&e.path(), depth + 1, out);
        } else if name.ends_with(".c") {
            out.push(e.path());
        }
    }
}

pub fn criterion_installed() -> bool {
    ["/usr/include/criterion/criterion.h", "/usr/local/include/criterion/criterion.h"].iter().any(|p| Path::new(p).is_file())
}

pub fn detect(repo: &Path) -> Detection {
    let mut d = Detection::default();
    let mut tests = Vec::new();
    for dir in ["tests", "test", "unit_tests"] {
        c_files(&repo.join(dir), 0, &mut tests);
    }
    d.test_files = tests.len();
    let uses_criterion = tests.iter().filter_map(|p| read(p)).any(|t| t.contains("<criterion/"));
    if uses_criterion {
        d.frameworks.push("Criterion".into());
        if !criterion_installed() {
            d.notes.push("These tests use Criterion, which is not installed on this computer: they will not link here.".into());
        }
    }
    if let Some(mk) = read(&repo.join("Makefile")) {
        for t in make_targets(&mk) {
            if matches!(t.as_str(), "tests_run" | "test" | "tests" | "check" | "unit_tests") {
                d.suites.push(Suite { id: format!("make:{t}"), kind: "make", label: format!("make {t}"), command: format!("make {t}"), note: None, trusted: true });
            }
        }
        // The Epitech convention first.
        d.suites.sort_by_key(|s| s.command != "make tests_run");
    }
    if read(&repo.join("CMakeLists.txt")).is_some_and(|t| t.contains("enable_testing") || t.contains("add_test(")) {
        d.frameworks.push("CTest".into());
        if repo.join("build").is_dir() {
            d.suites.push(Suite { id: "ctest".into(), kind: "ctest", label: "ctest (build/)".into(), command: "ctest --test-dir build --output-on-failure".into(), note: None, trusted: true });
        } else {
            d.notes.push("CMake tests are declared, but there is no build/ folder yet: configure and build the project first.".into());
        }
    }
    let mut scripts: Vec<String> = Vec::new();
    for (dir, prefix) in [(repo.to_path_buf(), ""), (repo.join("tests"), "tests/")] {
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for e in entries.flatten() {
                let name = e.file_name().to_string_lossy().into_owned();
                let is_file = e.file_type().map(|t| t.is_file()).unwrap_or(false);
                if is_file && name.ends_with(".sh") && (prefix == "tests/" || name.contains("test")) && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.')) {
                    scripts.push(format!("{prefix}{name}"));
                }
            }
        }
    }
    scripts.sort();
    for s in scripts {
        d.suites.push(Suite { id: format!("script:{s}"), kind: "script", label: s.clone(), command: format!("sh {s}"), note: Some("A script from the repository. It runs with your rights: read it before starting it.".into()), trusted: false });
    }
    if d.suites.is_empty() && d.notes.is_empty() {
        d.notes.push(if d.test_files > 0 { "Test files exist, but the Makefile has no tests_run (or test, check) rule to run them.".into() } else { "No test was found: no tests/ folder and no test rule in the Makefile.".into() });
    }
    d
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Failure {
    pub name: String,
    pub location: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct TestSummary {
    /// `criterion`, `ctest`, or `unknown` when no summary was recognised.
    pub framework: &'static str,
    pub total: Option<u32>,
    pub passed: Option<u32>,
    pub failed: Option<u32>,
    pub crashed: Option<u32>,
    pub failures: Vec<Failure>,
    /// Line coverage reported by gcovr, in percent.
    pub coverage: Option<f32>,
}

fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            for n in chars.by_ref() {
                if n.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn number_after(line: &str, key: &str) -> Option<u32> {
    let rest = &line[line.find(key)? + key.len()..];
    rest.trim_start().split(|c: char| !c.is_ascii_digit()).next()?.parse().ok()
}

/// Reads what the test program printed. Counts come from the framework's own summary line.
pub fn parse_output(raw: &str) -> TestSummary {
    let text = strip_ansi(raw);
    let mut s = TestSummary { framework: "unknown", ..Default::default() };
    let mut pending: Option<(String, String)> = None;
    let lines: Vec<&str> = text.lines().collect();
    for (i, line) in lines.iter().enumerate() {
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("[----] ") {
            // `file.c:12: Assertion Failed` then the message on the following `[----]` lines.
            let mut parts = rest.splitn(3, ':');
            if let (Some(file), Some(n), Some(msg)) = (parts.next(), parts.next(), parts.next()) {
                if n.trim().parse::<u32>().is_ok() && pending.is_none() {
                    let extra = lines.get(i + 1).and_then(|l| l.trim().strip_prefix("[----]")).map(str::trim).filter(|m| !m.is_empty() && !m.contains(": "));
                    let msg = msg.trim();
                    pending = Some((format!("{}:{}", file.trim(), n.trim()), match extra { Some(e) => format!("{msg} — {e}"), None => msg.to_string() }));
                }
            }
        } else if let Some(rest) = t.strip_prefix("[FAIL] ") {
            let name = rest.split(": ").next().unwrap_or(rest).trim().to_string();
            let (location, message) = match pending.take() {
                Some((l, m)) => (Some(l), Some(m)),
                None => (None, rest.contains("CRASH").then(|| "crashed".to_string())),
            };
            s.failures.push(Failure { name, location, message });
        } else if t.contains("Synthesis:") && t.contains("Tested:") {
            s.framework = "criterion";
            s.total = number_after(t, "Tested:");
            s.passed = number_after(t, "Passing:");
            s.failed = number_after(t, "Failing:");
            s.crashed = number_after(t, "Crashing:");
        } else if t.contains("tests passed,") && t.contains("tests failed out of") {
            s.framework = "ctest";
            s.failed = number_after(t, "tests passed,");
            s.total = number_after(t, "out of");
            s.passed = s.total.zip(s.failed).map(|(a, b)| a.saturating_sub(b));
        } else if s.framework != "criterion" && (t.ends_with("(Failed)") || t.ends_with("(Timeout)") || t.ends_with("(SEGFAULT)")) && t.contains(" - ") {
            let name = t.split(" - ").nth(1).unwrap_or(t);
            let (name, why) = name.rsplit_once(" (").unwrap_or((name, ""));
            s.failures.push(Failure { name: name.trim().to_string(), location: None, message: Some(why.trim_end_matches(')').to_lowercase()) });
        } else if t.starts_with("TOTAL") && t.ends_with('%') {
            s.coverage = t.rsplit(' ').next().and_then(|p| p.trim_end_matches('%').parse().ok());
        } else if let Some(rest) = t.strip_prefix("lines:") {
            s.coverage = rest.trim().split('%').next().and_then(|p| p.trim().parse().ok()).or(s.coverage);
        }
    }
    s
}

/// One-line result, e.g. `39/42 passed, 3 failed`.
pub fn headline(s: &TestSummary, code: Option<i32>) -> String {
    match (s.total, s.passed) {
        (Some(total), Some(passed)) => {
            let bad = s.failed.unwrap_or(0) + s.crashed.unwrap_or(0);
            if bad == 0 { format!("{passed}/{total} passed") } else { format!("{passed}/{total} passed, {bad} failed") }
        }
        _ => match code {
            Some(0) => "exit 0 (no test summary recognised)".into(),
            Some(c) => format!("exit {c}"),
            None => "stopped".into(),
        },
    }
}

/// Runs a test command inside a job (steps `run` and `results`) and returns the job status.
pub fn run_in_job(job: &Job, dir: &Path, command: &str, timeout: Duration) -> Result<(&'static str, TestSummary)> {
    job.start("run");
    job.set("command", command);
    let argv = argv_of(command)?;
    let o = job.run(&argv, dir, timeout, &[])?;
    if o.cancelled {
        return Ok(("cancelled", TestSummary::default()));
    }
    let detail = if o.timed_out { "time limit reached".to_string() } else { format!("exit {}", o.code.map(|c| c.to_string()).unwrap_or_else(|| "?".into())) };
    job.end("run", if o.ok() { "success" } else { "failed" }, Some(detail));
    job.start("results");
    let summary = parse_output(&o.output);
    let bad = summary.failed.unwrap_or(0) + summary.crashed.unwrap_or(0) > 0 || !summary.failures.is_empty();
    let status = if !o.ok() || bad { "failed" } else { "success" };
    job.end("results", if summary.framework == "unknown" && o.ok() { "warning" } else { status }, Some(headline(&summary, o.code)));
    job.set("tests", &summary);
    job.set("exitCode", o.code);
    job.set("timedOut", o.timed_out);
    Ok((status, summary))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn makefile_rules_are_listed_without_variables_or_patterns() {
        let mk = "NAME = prog\nCC := gcc\nall: $(NAME)\n\n$(NAME): $(OBJ)\n\tgcc -o x\n%.o: %.c\n\tcc\ntests_run: lib\n\t./unit\nclean fclean:\n.PHONY: all\n";
        assert_eq!(make_targets(mk), vec!["all", "clean", "fclean", "tests_run"]);
    }

    #[test]
    fn detects_make_rule_criterion_and_scripts() {
        let tmp = tempfile::tempdir().unwrap();
        let r = tmp.path();
        fs::create_dir_all(r.join("tests")).unwrap();
        fs::write(r.join("Makefile"), "all:\n\ncheck:\n\ntests_run:\n\t./unit_tests\n").unwrap();
        fs::write(r.join("tests/test_x.c"), "#include <criterion/criterion.h>\nTest(a, b) {}\n").unwrap();
        fs::write(r.join("tests/functional.sh"), "#!/bin/sh\n").unwrap();
        fs::write(r.join("deploy.sh"), "#!/bin/sh\n").unwrap();
        let d = detect(r);
        assert_eq!(d.suites.iter().map(|s| s.command.as_str()).collect::<Vec<_>>(), vec!["make tests_run", "make check", "sh tests/functional.sh"]);
        assert!(d.suites[0].trusted && !d.suites[2].trusted);
        assert_eq!(d.frameworks, vec!["Criterion"]);
        assert_eq!(d.test_files, 1);
    }

    #[test]
    fn says_so_when_there_is_nothing_to_run() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("Makefile"), "all:\n\techo\n").unwrap();
        let d = detect(tmp.path());
        assert!(d.suites.is_empty());
        assert!(d.notes[0].contains("No test was found"));
    }

    #[test]
    fn reads_a_criterion_report() {
        let out = "[----] tests/test_str.c:12: Assertion Failed\n[----]   \n[----]   The expression (my_strlen(\"abc\")) == (4) is false.\n[----]   \n[FAIL] my_strlen::basic: (0.00s)\n[----] tests/test_str.c:30: Unexpected signal caught below this line!\n[FAIL] my_strdup::null: CRASH!\n\u{1b}[0;34m[====]\u{1b}[0m Synthesis: Tested: 42 | Passing: 39 | Failing: 3 | Crashing: 1 \nlines: 85.7% (120 out of 140)\n";
        let s = parse_output(out);
        assert_eq!((s.framework, s.total, s.passed, s.failed, s.crashed), ("criterion", Some(42), Some(39), Some(3), Some(1)));
        assert_eq!(s.failures.len(), 2);
        assert_eq!(s.failures[0], Failure { name: "my_strlen::basic".into(), location: Some("tests/test_str.c:12".into()), message: Some("Assertion Failed".into()) });
        assert_eq!(s.failures[1].name, "my_strdup::null");
        assert_eq!(s.coverage, Some(85.7));
        assert_eq!(headline(&s, Some(1)), "39/42 passed, 4 failed");
    }

    #[test]
    fn reads_ctest_and_gcovr_and_unknown_output() {
        let s = parse_output("\t  3 - parser_edge (Failed)\n80% tests passed, 1 tests failed out of 5\nTOTAL                                        120     100    83%\n");
        assert_eq!((s.framework, s.total, s.passed, s.failed), ("ctest", Some(5), Some(4), Some(1)));
        assert_eq!(s.failures[0].name, "parser_edge");
        assert_eq!(s.coverage, Some(83.0));
        let u = parse_output("all good\n");
        assert_eq!(u.framework, "unknown");
        assert_eq!(headline(&u, Some(0)), "exit 0 (no test summary recognised)");
        assert_eq!(headline(&parse_output("[====] Synthesis: Tested: 18 | Passing: 18 | Failing: 0 | Crashing: 0"), Some(0)), "18/18 passed");
    }
}
