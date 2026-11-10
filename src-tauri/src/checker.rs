//! Banana, Epitech's coding-style checker, as installed on this computer:
//! `banana-check-repo` (delivery files, C-O1/C-O4) and the Banana plugin that `epiclang`
//! loads (every other rule, reported as compiler warnings). Nothing is downloaded.

use crate::error::Result;
use crate::git;
use crate::jobs::Job;
use crate::settings;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::time::Duration;

pub const STEPS: &[(&str, &str)] = &[("files", "Delivery files (C-O1, C-O4)"), ("style", "Coding style (epiclang + Banana)")];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckerInfo {
    pub repo_checker: Option<String>,
    pub version: Option<String>,
    pub epiclang: Option<String>,
    /// The Banana plugin epiclang loads is present.
    pub plugin: bool,
}

pub fn detect() -> CheckerInfo {
    let repo_checker = settings::which("banana-check-repo").map(|p| p.to_string_lossy().into_owned());
    let version = std::process::Command::new("dpkg-query").args(["-W", "-f=${Version}", "banana-coding-style-checker"]).stdin(std::process::Stdio::null()).output().ok().filter(|o| o.status.success()).map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).filter(|v| !v.is_empty());
    CheckerInfo {
        repo_checker,
        version,
        epiclang: settings::which("epiclang").map(|p| p.to_string_lossy().into_owned()),
        plugin: Path::new("/usr/lib/epiclang/plugins/epitech-plugin-banana.so").is_file(),
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub file: String,
    pub line: Option<u32>,
    pub column: Option<u32>,
    /// `Major`, `Minor` or `Info`, as Banana prints it.
    pub severity: String,
    pub rule: String,
    pub message: String,
}

/// Parses both shapes: `path: [Banana] [Major] text (C-O1)` and
/// `path:12:3: warning: [Banana] [Minor] text (C-L3)`.
pub fn parse_findings(output: &str) -> Vec<Finding> {
    let mut out = Vec::new();
    for line in output.lines() {
        let Some(at) = line.find("[Banana] [") else { continue };
        let rest = &line[at + "[Banana] [".len()..];
        let Some((severity, tail)) = rest.split_once("] ") else { continue };
        let tail = tail.trim();
        let (message, rule) = match tail.rfind(" (") {
            Some(i) if tail.ends_with(')') => (tail[..i].trim().to_string(), tail[i + 2..tail.len() - 1].to_string()),
            _ => (tail.to_string(), String::new()),
        };
        let head = line[..at].trim().trim_end_matches("warning:").trim().trim_end_matches("error:").trim().trim_end_matches(':');
        let mut parts: Vec<&str> = head.rsplitn(3, ':').collect();
        parts.reverse();
        let (file, l, c) = match parts.as_slice() {
            [f, l, c] if l.parse::<u32>().is_ok() && c.parse::<u32>().is_ok() => (f.to_string(), l.parse().ok(), c.parse().ok()),
            _ => (head.to_string(), None, None),
        };
        out.push(Finding { file: file.trim_start_matches("./").to_string(), line: l, column: c, severity: severity.to_string(), rule, message });
    }
    out
}

/// Files a compiler error stopped before the end: their report is incomplete.
fn interrupted(output: &str) -> Vec<String> {
    let mut out: Vec<String> = output.lines().filter(|l| l.contains(": fatal error:") || l.contains(": error:")).filter_map(|l| l.split(':').next()).map(|f| f.trim_start_matches("./").to_string()).collect();
    out.sort();
    out.dedup();
    out
}

/// Drops findings about files Git ignores (build products left by `make`): they are not
/// part of what gets delivered. Returns how many were dropped.
pub fn drop_ignored(repo: &Path, findings: Vec<Finding>) -> (Vec<Finding>, usize) {
    let ignored: BTreeSet<String> = git::run(Some(repo), &["ls-files", "--others", "--ignored", "--exclude-standard", "-z"]).map(|t| t.split('\0').filter(|p| !p.is_empty()).map(str::to_string).collect()).unwrap_or_default();
    let before = findings.len();
    let kept: Vec<Finding> = findings.into_iter().filter(|f| !ignored.contains(&f.file)).collect();
    let dropped = before - kept.len();
    (kept, dropped)
}

fn tracked_c_files(repo: &Path) -> Vec<String> {
    git::run(Some(repo), &["ls-files", "-z", "--", "*.c", "*.h"])
        .map(|t| t.split('\0').filter(|p| !p.is_empty()).map(str::to_string).collect::<Vec<_>>())
        .unwrap_or_default()
        .into_iter()
        // Same exclusions as banana-check-repo.
        .filter(|p| !p.starts_with("tests/") && !p.starts_with("bonus/") && repo.join(p).is_file())
        .collect()
}

pub fn run(job: &Job, repo: &Path) -> Result<&'static str> {
    let info = detect();
    job.set("tool", &info);
    let mut findings: BTreeSet<Finding> = BTreeSet::new();
    let mut commands = Vec::new();
    let mut partial = false;

    job.start("files");
    match &info.repo_checker {
        None => {
            partial = true;
            job.skip("files", "banana-check-repo is not installed");
        }
        Some(tool) => {
            commands.push(format!("{tool} ."));
            let o = job.run(&[tool.clone(), ".".into()], repo, Duration::from_secs(120), &[])?;
            if o.cancelled {
                return Ok("cancelled");
            }
            let (found, ignored) = drop_ignored(repo, parse_findings(&o.output));
            let n = found.len();
            findings.extend(found);
            job.set("ignoredByGit", ignored);
            let extra = if ignored > 0 { format!(" ({ignored} build product(s) ignored by Git are not counted: they are not delivered)") } else { String::new() };
            match o.code {
                Some(0) => job.end("files", "success", Some("no infraction".to_string())),
                Some(1) if n == 0 => job.end("files", "success", Some(format!("no infraction in delivered files{extra}"))),
                Some(1) => job.end("files", "warning", Some(format!("{n} infraction(s){extra}"))),
                _ => {
                    partial = true;
                    job.end("files", "failed", Some("the checker did not finish".to_string()));
                }
            }
        }
    }

    job.start("style");
    let mut incomplete: Vec<String> = Vec::new();
    let files = tracked_c_files(repo);
    if info.epiclang.is_none() || !info.plugin {
        partial = true;
        job.skip("style", if info.epiclang.is_none() { "epiclang is not installed" } else { "epiclang's Banana plugin was not found" });
    } else if files.is_empty() {
        job.skip("style", "no tracked .c or .h file outside tests/ and bonus/");
    } else {
        let mut dirs: BTreeSet<String> = files.iter().filter(|f| f.ends_with(".h")).map(|f| f.rsplit_once('/').map(|(d, _)| d.to_string()).unwrap_or_else(|| ".".into())).collect();
        dirs.extend([".".to_string(), "include".to_string()]);
        let mut base = vec!["epiclang".to_string(), "-fsyntax-only".into(), "-fno-color-diagnostics".into(), "-fno-caret-diagnostics".into()];
        base.extend(dirs.iter().take(40).map(|d| format!("-I{d}")));
        commands.push(format!("{} <{} files>", base.join(" "), files.len()));
        for chunk in files.chunks(40) {
            let mut argv = base.clone();
            argv.extend(chunk.iter().cloned());
            let o = job.run(&argv, repo, Duration::from_secs(180), &[])?;
            if o.cancelled {
                return Ok("cancelled");
            }
            findings.extend(parse_findings(&o.output));
            incomplete.extend(interrupted(&o.output));
            partial |= o.timed_out;
        }
        let n = findings.iter().filter(|f| f.line.is_some()).count();
        let detail = match (n, incomplete.len()) {
            (0, 0) => format!("{} files, no infraction", files.len()),
            (n, 0) => format!("{} files, {n} infraction(s)", files.len()),
            (n, k) => format!("{} files, {n} infraction(s); {k} file(s) stopped by a compile error, so only partly checked", files.len()),
        };
        job.end("style", if n == 0 && incomplete.is_empty() { "success" } else { "warning" }, Some(detail));
    }

    let mut by_severity: BTreeMap<String, usize> = BTreeMap::new();
    let mut by_rule: BTreeMap<String, usize> = BTreeMap::new();
    for f in &findings {
        *by_severity.entry(f.severity.clone()).or_default() += 1;
        *by_rule.entry(f.rule.clone()).or_default() += 1;
    }
    let major = by_severity.get("Major").copied().unwrap_or(0);
    job.set("total", findings.len());
    job.set("bySeverity", &by_severity);
    job.set("byRule", &by_rule);
    job.set("incomplete", &incomplete);
    job.set("commands", &commands);
    job.set("filesChecked", files.len());
    job.set("findings", findings.iter().take(600).collect::<Vec<_>>());
    Ok(if major > 0 { "failed" } else if !findings.is_empty() || !incomplete.is_empty() || partial { "warning" } else { "success" })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_both_output_shapes() {
        let out = "Checking delivery files in .\n./Bad.c: [Banana] [Minor] invalid file name (C-O4)\n./a.out: [Banana] [Major] unwanted binary file (C-O1)\nsrc/x.c:12:4: warning: [Banana] [Minor] multiple spaces used for spacing (C-L3)\nsrc/x.c:1:1: warning: [Banana] [Minor] level 0 preprocessor directive indentation (should be 1) (C-G3)\n7 warnings generated.\n";
        let f = parse_findings(out);
        assert_eq!(f.len(), 4);
        assert_eq!(f[0], Finding { file: "Bad.c".into(), line: None, column: None, severity: "Minor".into(), rule: "C-O4".into(), message: "invalid file name".into() });
        assert_eq!((f[1].severity.as_str(), f[1].rule.as_str()), ("Major", "C-O1"));
        assert_eq!((f[2].file.as_str(), f[2].line, f[2].column, f[2].rule.as_str()), ("src/x.c", Some(12), Some(4), "C-L3"));
        assert_eq!((f[3].message.as_str(), f[3].rule.as_str()), ("level 0 preprocessor directive indentation (should be 1)", "C-G3"));
    }

    #[test]
    fn spots_files_cut_short_by_a_compile_error() {
        assert_eq!(interrupted("y.c:1:10: fatal error: 'missing.h' file not found\ny.c:1:1: warning: [Banana] [Minor] x (C-G1)\n"), vec!["y.c"]);
    }
}
