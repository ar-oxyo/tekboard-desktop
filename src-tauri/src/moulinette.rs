//! “Claude Moulinette”: a personal pre-check before a hand-in. It is NOT Epitech's Moulinette
//! and gives no grade. Each line of the report says how it was obtained: measured by a tool
//! (`auto`), judged by Claude from the subject (`ai`), or not checked at all (`none`).

use crate::checker;
use crate::claude;
use crate::error::Result;
use crate::git;
use crate::jobs::{argv_of, Job};
use crate::testing;
use crate::testrepo::{count_warnings, makefile_name};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const STEPS: &[(&str, &str)] = &[
    ("build", "Compilation"),
    ("structure", "Repository structure"),
    ("style", "Coding style (Banana)"),
    ("tests", "Unit tests"),
    ("memory", "Memory checks"),
    ("subject", "Subject requirements"),
];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Params {
    pub build: String,
    pub tests: Option<String>,
    /// Program and arguments to run under Valgrind, e.g. `./my_ls -l`.
    pub memory_run: Option<String>,
    /// Ask Claude Code to compare the project with its subject.
    pub subject_ai: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    pub id: &'static str,
    pub label: &'static str,
    /// `pass`, `warning`, `fail`, `partial`, `not_run`.
    pub result: &'static str,
    /// `auto`, `ai`, `none`.
    pub evidence: &'static str,
    pub detail: String,
    pub items: Vec<Item>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub label: String,
    /// `pass`, `fail`, `warning`, `unclear`.
    pub status: String,
    #[serde(default)]
    pub detail: String,
}

fn item(label: &str, ok: bool, detail: impl Into<String>) -> Item {
    Item { label: label.to_string(), status: if ok { "pass".into() } else { "fail".into() }, detail: detail.into() }
}

fn step_status(result: &str) -> &'static str {
    match result {
        "pass" => "success",
        "fail" => "failed",
        "not_run" => "skipped",
        _ => "warning",
    }
}

/// Checks that need no judgement: what the Makefile declares and what Git tracks.
pub fn structure(repo: &Path, built: bool) -> Vec<Item> {
    let mut items = Vec::new();
    let mk = std::fs::read_to_string(repo.join("Makefile")).ok();
    items.push(item("Makefile at the root", mk.is_some(), ""));
    if let Some(text) = &mk {
        let targets = testing::make_targets(text);
        let missing: Vec<&str> = ["all", "clean", "fclean", "re"].into_iter().filter(|t| !targets.iter().any(|x| x == t)).collect();
        items.push(item("Rules all, clean, fclean, re", missing.is_empty(), if missing.is_empty() { String::new() } else { format!("missing: {}", missing.join(", ")) }));
        match makefile_name(text) {
            Some(name) if built => items.push(item("Binary named by the Makefile is produced", repo.join(&name).is_file(), name)),
            Some(name) => items.push(Item { label: "Binary named by the Makefile".into(), status: "unclear".into(), detail: format!("{name} (not checked: the build failed)") }),
            None => items.push(Item { label: "NAME in the Makefile".into(), status: "unclear".into(), detail: "no plain NAME = … line".into() }),
        }
    }
    let tracked: Vec<String> = git::run(Some(repo), &["ls-files", "-z"]).map(|t| t.split('\0').filter(|p| !p.is_empty()).map(str::to_string).collect()).unwrap_or_default();
    let products: Vec<&String> = tracked.iter().filter(|p| [".o", ".a", ".so", ".gcda", ".gcno", ".gcov"].iter().any(|e| p.ends_with(e)) || p.rsplit('/').next().is_some_and(|b| b.starts_with("vgcore."))).collect();
    items.push(item("No build product tracked by Git", products.is_empty(), products.iter().take(5).map(|s| s.as_str()).collect::<Vec<_>>().join(", ")));
    let has_c = tracked.iter().any(|p| p.ends_with(".c"));
    if has_c {
        let headers = tracked.iter().filter(|p| p.ends_with(".h")).count();
        items.push(Item { label: "Header files".into(), status: if headers > 0 { "pass".into() } else { "warning".into() }, detail: format!("{headers} tracked") });
    }
    items.push(Item { label: ".gitignore".into(), status: if repo.join(".gitignore").is_file() { "pass".into() } else { "warning".into() }, detail: String::new() });
    items
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Valgrind {
    pub errors: Option<u32>,
    pub definitely_lost: Option<u64>,
    pub indirectly_lost: Option<u64>,
    pub still_reachable: Option<u64>,
}

fn bytes_after(line: &str, key: &str) -> Option<u64> {
    let rest = &line[line.find(key)? + key.len()..];
    rest.trim_start().split(' ').next()?.replace(',', "").parse().ok()
}

pub fn parse_valgrind(output: &str) -> Valgrind {
    let mut v = Valgrind::default();
    for l in output.lines() {
        if l.contains("ERROR SUMMARY:") {
            v.errors = bytes_after(l, "ERROR SUMMARY:").map(|n| n as u32);
        } else if l.contains("definitely lost:") {
            v.definitely_lost = bytes_after(l, "definitely lost:");
        } else if l.contains("indirectly lost:") {
            v.indirectly_lost = bytes_after(l, "indirectly lost:");
        } else if l.contains("still reachable:") {
            v.still_reachable = bytes_after(l, "still reachable:");
        } else if l.contains("All heap blocks were freed") {
            v.definitely_lost.get_or_insert(0);
            v.indirectly_lost.get_or_insert(0);
        }
    }
    v
}

/// Items of the checklist Claude returns, read leniently.
pub fn parse_checklist(answer: &str) -> Vec<Item> {
    let body = claude::fenced(answer, "json");
    let start = body.find('[');
    let end = body.rfind(']');
    let (Some(s), Some(e)) = (start, end) else { return vec![] };
    #[derive(Deserialize)]
    struct Raw {
        requirement: Option<String>,
        label: Option<String>,
        status: Option<String>,
        evidence: Option<String>,
        detail: Option<String>,
    }
    let raws: Vec<Raw> = serde_json::from_str(&body[s..=e]).unwrap_or_default();
    raws.into_iter()
        .filter_map(|r| {
            let label = r.requirement.or(r.label)?;
            let status = match r.status.as_deref().map(str::to_lowercase).as_deref() {
                Some("met") | Some("pass") | Some("yes") => "pass",
                Some("not_met") | Some("fail") | Some("no") | Some("missing") => "fail",
                _ => "unclear",
            };
            Some(Item { label, status: status.to_string(), detail: r.evidence.or(r.detail).unwrap_or_default() })
        })
        .collect()
}

pub fn subject_prompt(subject: &str) -> String {
    format!(
        "You are checking a student project against its assignment, before a manual review. Work only from what you can read in this folder.\n\n\
         1. From the assignment below, list the requirements that can be checked by reading the repository (expected files, binary name, required functions or behaviours, allowed/forbidden functions, build rules, error handling the text demands). Ignore anything about grading or deadlines. At most 25 items.\n\
         2. For each one, read the relevant files and decide: \"met\", \"not_met\", or \"unclear\" when the code alone cannot tell (never guess: unclear is the right answer for behaviour you cannot verify by reading).\n\
         3. Answer with ONLY a JSON array in a ```json block: [{{\"requirement\": \"…\", \"status\": \"met|not_met|unclear\", \"evidence\": \"file and line, or why it is unclear\"}}]. No other text.\n\n\
         --- ASSIGNMENT ---\n{subject}\n--- END ---"
    )
}

pub fn overall(sections: &[Section]) -> &'static str {
    let by = |id: &str| sections.iter().find(|s| s.id == id).map(|s| s.result).unwrap_or("not_run");
    if by("build") == "fail" {
        return "Does not build: fix this first";
    }
    if sections.iter().any(|s| s.result == "fail") {
        return "Problems to fix before a manual review";
    }
    if sections.iter().any(|s| matches!(s.result, "warning" | "partial")) {
        return "Ready for manual review, with points to check";
    }
    "Ready for manual review"
}

pub fn run(job: &Job, repo: &Path, params: &Params, subject_pdf: Option<PathBuf>) -> Result<&'static str> {
    let mut sections: Vec<Section> = Vec::new();
    let mut push = |job: &Job, s: Section| {
        job.end(s.id, step_status(s.result), Some(s.detail.clone()));
        sections.push(s);
        job.set("sections", &sections);
    };

    // ── compilation
    job.start("build");
    let build = job.run(&argv_of(&params.build)?, repo, Duration::from_secs(600), &[])?;
    if build.cancelled {
        return Ok("cancelled");
    }
    let warnings = count_warnings(&build.output);
    let built = build.ok();
    push(job, Section {
        id: "build",
        label: "Compilation",
        result: if !built { "fail" } else if warnings > 0 { "warning" } else { "pass" },
        evidence: "auto",
        detail: if build.timed_out { format!("`{}` did not finish in 10 minutes", params.build) } else if !built { format!("`{}` exited with {}", params.build, build.code.unwrap_or(-1)) } else if warnings > 0 { format!("`{}` succeeded with {warnings} warning(s)", params.build) } else { format!("`{}` succeeded, no warning", params.build) },
        items: vec![],
    });

    // ── structure
    job.start("structure");
    let items = structure(repo, built);
    let fails = items.iter().filter(|i| i.status == "fail").count();
    let soft = items.iter().filter(|i| i.status == "warning" || i.status == "unclear").count();
    push(job, Section { id: "structure", label: "Repository structure", result: if fails > 0 { "fail" } else if soft > 0 { "warning" } else { "pass" }, evidence: "auto", detail: format!("{} of {} checks passed", items.iter().filter(|i| i.status == "pass").count(), items.len()), items });

    // ── style: the installed Banana tools, through the same code as the Banana button
    job.start("style");
    {
        let info = checker::detect();
        if info.repo_checker.is_none() && !(info.epiclang.is_some() && info.plugin) {
            push(job, Section { id: "style", label: "Coding style (Banana)", result: "not_run", evidence: "none", detail: "Banana is not installed on this computer".into(), items: vec![] });
        } else {
            let mut found = Vec::new();
            if let Some(tool) = &info.repo_checker {
                let o = job.run(&[tool.clone(), ".".into()], repo, Duration::from_secs(120), &[])?;
                if o.cancelled {
                    return Ok("cancelled");
                }
                found.extend(checker::drop_ignored(repo, checker::parse_findings(&o.output)).0);
            }
            let major = found.iter().filter(|f| f.severity == "Major").count();
            let items: Vec<Item> = found.iter().take(40).map(|f| Item { label: format!("{} {}", f.rule, f.message), status: if f.severity == "Major" { "fail".into() } else { "warning".into() }, detail: f.file.clone() }).collect();
            push(job, Section {
                id: "style",
                label: "Coding style (Banana)",
                result: if major > 0 { "fail" } else if !found.is_empty() { "warning" } else { "pass" },
                evidence: "auto",
                detail: if found.is_empty() { "Delivery files: no infraction (C-O1, C-O4). Run Banana from the Testing screen for the line-by-line rules.".into() } else { format!("Delivery files: {} infraction(s), {major} major (build products ignored by Git are not counted).", found.len()) },
                items,
            });
        }
    }

    // ── tests
    job.start("tests");
    match params.tests.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
        None => push(job, Section { id: "tests", label: "Unit tests", result: "not_run", evidence: "none", detail: "No test command for this project".into(), items: vec![] }),
        Some(cmd) => {
            let o = job.run(&argv_of(cmd)?, repo, Duration::from_secs(600), &[])?;
            if o.cancelled {
                return Ok("cancelled");
            }
            let s = testing::parse_output(&o.output);
            let bad = !o.ok() || s.failed.unwrap_or(0) + s.crashed.unwrap_or(0) > 0;
            job.set("tests", &s);
            let items = s.failures.iter().take(30).map(|f| Item { label: f.name.clone(), status: "fail".into(), detail: [f.location.clone().unwrap_or_default(), f.message.clone().unwrap_or_default()].join(" ").trim().to_string() }).collect();
            push(job, Section { id: "tests", label: "Unit tests", result: if bad { "fail" } else if s.framework == "unknown" { "warning" } else { "pass" }, evidence: "auto", detail: format!("`{cmd}`: {}", testing::headline(&s, o.code)), items });
        }
    }

    // ── memory
    job.start("memory");
    match params.memory_run.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
        None => push(job, Section { id: "memory", label: "Memory checks", result: "not_run", evidence: "none", detail: "No run command given: Valgrind needs a program and its arguments".into(), items: vec![] }),
        Some(_) if !built => push(job, Section { id: "memory", label: "Memory checks", result: "not_run", evidence: "none", detail: "Skipped: the build failed".into(), items: vec![] }),
        Some(cmd) => {
            let mut argv: Vec<String> = ["valgrind", "--leak-check=full", "--errors-for-leak-kinds=definite,indirect", "--error-exitcode=97"].iter().map(|s| s.to_string()).collect();
            argv.extend(argv_of(cmd)?);
            match job.run(&argv, repo, Duration::from_secs(90), &[]) {
                Err(e) if e.code() == "command_missing" => push(job, Section { id: "memory", label: "Memory checks", result: "not_run", evidence: "none", detail: "Valgrind is not installed".into(), items: vec![] }),
                Err(e) => return Err(e),
                Ok(o) if o.cancelled => return Ok("cancelled"),
                Ok(o) => {
                    let v = parse_valgrind(&o.output);
                    job.set("valgrind", &v);
                    let lost = v.definitely_lost.unwrap_or(0) + v.indirectly_lost.unwrap_or(0);
                    let errors = v.errors.unwrap_or(0);
                    let result = if o.timed_out { "warning" } else if errors > 0 || lost > 0 { "warning" } else if v.errors.is_some() { "pass" } else { "warning" };
                    let detail = if o.timed_out { "the program was still running after 90 s (does it wait for input?)".to_string() } else if v.errors.is_none() { "Valgrind printed no summary".to_string() } else { format!("`{cmd}`: {errors} error(s), {lost} byte(s) lost. One run with these arguments only: other inputs are not covered.") };
                    push(job, Section { id: "memory", label: "Memory checks", result, evidence: "auto", detail, items: vec![] });
                }
            }
        }
    }

    // ── subject
    job.start("subject");
    let subject_text = subject_pdf.as_deref().and_then(|p| claude::pdf_text(p, 30_000));
    if !params.subject_ai {
        push(job, Section { id: "subject", label: "Subject requirements", result: "not_run", evidence: "none", detail: "Not verified (the AI review was not requested)".into(), items: vec![] });
    } else if subject_pdf.is_none() {
        push(job, Section { id: "subject", label: "Subject requirements", result: "not_run", evidence: "none", detail: "Not verified: no subject is linked to this project".into(), items: vec![] });
    } else if subject_text.is_none() {
        push(job, Section { id: "subject", label: "Subject requirements", result: "not_run", evidence: "none", detail: "Not verified: no text could be read from the subject PDF".into(), items: vec![] });
    } else {
        let (o, answer) = claude::run(job, repo, &subject_prompt(&subject_text.unwrap_or_default()), &[], Duration::from_secs(900))?;
        if o.cancelled {
            return Ok("cancelled");
        }
        match answer {
            Err(e) => push(job, Section { id: "subject", label: "Subject requirements", result: "not_run", evidence: "none", detail: format!("Not verified: {e}"), items: vec![] }),
            Ok(a) => {
                let items = parse_checklist(&a.text);
                let (met, bad, unclear) = (items.iter().filter(|i| i.status == "pass").count(), items.iter().filter(|i| i.status == "fail").count(), items.iter().filter(|i| i.status == "unclear").count());
                let result = if items.is_empty() { "not_run" } else if bad > 0 || unclear > 0 { "partial" } else { "pass" };
                let detail = if items.is_empty() { "Claude's answer could not be read as a checklist (see the log)".to_string() } else { format!("Claude's reading of the code: {met} met, {bad} not met, {unclear} unclear. An AI opinion, not a test.") };
                push(job, Section { id: "subject", label: "Subject requirements", result, evidence: if items.is_empty() { "none" } else { "ai" }, detail, items });
            }
        }
    }

    let verdict = overall(&sections);
    job.set("overall", verdict);
    Ok(if sections.iter().any(|s| s.result == "fail") { "failed" } else if sections.iter().any(|s| matches!(s.result, "warning" | "partial")) { "warning" } else { "success" })
}

// ───────────────────────────── test generation ─────────────────────────────

pub const GEN_STEPS: &[(&str, &str)] = &[("context", "Looking at the project"), ("claude", "Claude Code writes tests"), ("changes", "Files changed"), ("run", "Running the tests")];

pub fn tests_prompt(detection: &testing::Detection, has_rule: bool) -> String {
    let framework = if detection.frameworks.iter().any(|f| f == "Criterion") || detection.test_files == 0 { "Criterion (#include <criterion/criterion.h>)" } else { "the framework the existing tests already use" };
    format!(
        "Write unit tests for this C project.\n\n\
         - Read the sources first (Glob/Grep/Read). Find the functions that have no test yet in tests/.\n\
         - Write tests with {framework}, in new files under tests/ named test_<topic>.c. You may only create or edit files inside tests/: do not try to change anything else.\n\
         - Follow the Epitech coding style: standard file header comment, 4-space indentation, snake_case names.\n\
         - Test real behaviour you verified by reading the code, including edge cases (empty input, NULL when the function handles it, limits). Do not invent behaviour: if you are unsure what a function should return, do not test that case.\n\
         - Do not test static functions or main().\n\
         - {rule}\n\n\
         End with a short plain-text summary: the files you wrote, the functions covered, and what you chose not to test and why.",
        rule = if has_rule { "The Makefile has a test rule: keep to what it compiles (check which files it takes)." } else { "The Makefile has no tests_run rule and you cannot edit it: say so in your summary, with the exact rule the student should add." }
    )
}

fn porcelain(repo: &Path) -> Vec<String> {
    git::run(Some(repo), &["status", "--porcelain", "--untracked-files=all"]).map(|t| t.lines().map(str::to_string).collect()).unwrap_or_default()
}

pub fn generate_tests(job: &Job, repo: &Path) -> Result<&'static str> {
    job.start("context");
    let detection = testing::detect(repo);
    let test_cmd = detection.suites.iter().find(|s| s.trusted).map(|s| s.command.clone());
    let before = porcelain(repo);
    job.end("context", "success", Some(format!("{} test file(s) already there; {}", detection.test_files, test_cmd.as_deref().map(|c| format!("`{c}` runs them")).unwrap_or_else(|| "no test rule in the Makefile".into()))));

    job.start("claude");
    let (o, answer) = claude::run(job, repo, &tests_prompt(&detection, test_cmd.is_some()), &["tests"], Duration::from_secs(1200))?;
    if o.cancelled {
        return Ok("cancelled");
    }
    let answer = match answer {
        Ok(a) => a,
        Err(e) => {
            job.end("claude", "failed", Some(e.to_string()));
            return Ok("failed");
        }
    };
    job.set("report", &answer.text);
    job.set("costUsd", answer.cost_usd);
    job.end("claude", "success", Some(format!("{} turn(s)", answer.turns.unwrap_or(0))));

    job.start("changes");
    let after = porcelain(repo);
    let changed: Vec<String> = after.iter().filter(|l| !before.contains(l)).map(|l| l[3.min(l.len())..].to_string()).collect();
    let outside: Vec<&String> = changed.iter().filter(|p| !p.starts_with("tests/")).collect();
    job.set("changed", &changed);
    if !outside.is_empty() {
        job.end("changes", "warning", Some(format!("files outside tests/ changed during the run: {}", outside.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", "))));
    } else if changed.is_empty() {
        job.end("changes", "warning", Some("no file was written".to_string()));
        job.skip("run", "nothing to run");
        return Ok("warning");
    } else {
        job.end("changes", "success", Some(format!("{} file(s) in tests/ — review them in Git before committing", changed.len())));
    }

    match test_cmd {
        None => {
            job.skip("run", "no test rule in the Makefile");
            Ok("warning")
        }
        Some(cmd) => {
            job.start("run");
            let o = job.run(&argv_of(&cmd)?, repo, Duration::from_secs(600), &[])?;
            if o.cancelled {
                return Ok("cancelled");
            }
            let s = testing::parse_output(&o.output);
            let bad = !o.ok() || s.failed.unwrap_or(0) + s.crashed.unwrap_or(0) > 0;
            job.set("tests", &s);
            job.end("run", if bad { "failed" } else { "success" }, Some(testing::headline(&s, o.code)));
            Ok(if bad { "warning" } else { "success" })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn git_in(dir: &Path, args: &[&str]) {
        assert!(std::process::Command::new("git").args(["-c", "user.name=t", "-c", "user.email=t@t"]).args(args).current_dir(dir).output().unwrap().status.success());
    }

    #[test]
    fn structure_checks_are_factual() {
        let tmp = tempfile::tempdir().unwrap();
        let r = tmp.path();
        fs::write(r.join("Makefile"), "NAME = prog\nall:\nclean:\nre:\n").unwrap();
        fs::write(r.join("main.c"), "int main(void)\n{\n    return 0;\n}\n").unwrap();
        fs::write(r.join("main.o"), "x").unwrap();
        git_in(r, &["init", "-q"]);
        git_in(r, &["add", "."]);
        let items = structure(r, true);
        let get = |label: &str| items.iter().find(|i| i.label.starts_with(label)).unwrap();
        assert_eq!(get("Makefile at the root").status, "pass");
        assert_eq!((get("Rules all").status.as_str(), get("Rules all").detail.as_str()), ("fail", "missing: fclean"));
        assert_eq!(get("Binary named").status, "fail");
        assert_eq!((get("No build product").status.as_str(), get("No build product").detail.as_str()), ("fail", "main.o"));
        assert_eq!(get("Header files").status, "warning");
        assert_eq!(structure(r, false).iter().find(|i| i.label.starts_with("Binary named")).unwrap().status, "unclear");
    }

    #[test]
    fn valgrind_summaries() {
        let v = parse_valgrind("==1== HEAP SUMMARY:\n==1==    definitely lost: 1,024 bytes in 2 blocks\n==1==    indirectly lost: 0 bytes in 0 blocks\n==1==      still reachable: 72 bytes in 1 blocks\n==1== ERROR SUMMARY: 3 errors from 2 contexts (suppressed: 0 from 0)\n");
        assert_eq!(v, Valgrind { errors: Some(3), definitely_lost: Some(1024), indirectly_lost: Some(0), still_reachable: Some(72) });
        let clean = parse_valgrind("==1== All heap blocks were freed -- no leaks are possible\n==1== ERROR SUMMARY: 0 errors from 0 contexts\n");
        assert_eq!((clean.errors, clean.definitely_lost), (Some(0), Some(0)));
        assert_eq!(parse_valgrind("no valgrind here").errors, None);
    }

    #[test]
    fn checklist_from_claude_is_read_leniently() {
        let items = parse_checklist("Sure.\n```json\n[{\"requirement\": \"Binary is my_ls\", \"status\": \"met\", \"evidence\": \"Makefile:12\"}, {\"requirement\": \"-R works\", \"status\": \"unclear\", \"evidence\": \"needs running\"}, {\"requirement\": \"No printf\", \"status\": \"NOT_MET\"}, {\"status\": \"met\"}]\n```");
        assert_eq!(items.iter().map(|i| i.status.as_str()).collect::<Vec<_>>(), vec!["pass", "unclear", "fail"]);
        assert_eq!(items[0].detail, "Makefile:12");
        assert!(parse_checklist("I could not do it").is_empty());
    }

    #[test]
    fn overall_wording_never_grades() {
        let sec = |id: &'static str, result: &'static str| Section { id, label: id, result, evidence: "auto", detail: String::new(), items: vec![] };
        assert_eq!(overall(&[sec("build", "fail"), sec("tests", "pass")]), "Does not build: fix this first");
        assert_eq!(overall(&[sec("build", "pass"), sec("tests", "fail")]), "Problems to fix before a manual review");
        assert_eq!(overall(&[sec("build", "pass"), sec("subject", "partial")]), "Ready for manual review, with points to check");
        assert_eq!(overall(&[sec("build", "pass"), sec("memory", "not_run")]), "Ready for manual review");
    }
}
