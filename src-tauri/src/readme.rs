//! README generator. The draft is assembled from facts read in the repository; where a fact
//! is missing, a visible placeholder is left for the author rather than an invented sentence.
//! Writing needs the hash of the README the user was shown, so nothing is replaced unseen.

use crate::error::{AppError, Result};
use crate::library::{sha, unified};
use crate::testing;
use crate::testrepo::makefile_name;
use crate::{epitech, git};
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub proposed: String,
    pub current: Option<String>,
    /// Hash of the current README, to pass back when writing.
    pub current_hash: Option<String>,
    pub diff: String,
    /// What the draft could not find and left as a placeholder.
    pub missing: Vec<String>,
}

fn current(repo: &Path) -> Option<String> {
    std::fs::read(repo.join("README.md")).ok().map(|b| String::from_utf8_lossy(&b).into_owned())
}

fn make_var(mk: &str, var: &str) -> Option<String> {
    mk.lines().find_map(|l| {
        let t = l.trim_start();
        let rest = t.strip_prefix(var)?.trim_start();
        let value = rest.strip_prefix(":=").or_else(|| rest.strip_prefix("?=")).or_else(|| rest.strip_prefix('='))?.trim();
        (!value.is_empty()).then(|| value.to_string())
    })
}

/// Libraries the Makefile links (`-lcsfml-graphics` → `csfml-graphics`), minus the project's own.
fn linked_libs(mk: &str, own: &[String]) -> Vec<String> {
    let mut out: Vec<String> = mk.split_whitespace().filter_map(|w| w.strip_prefix("-l")).filter(|l| !l.is_empty() && l.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '+' | '.'))).map(str::to_string).filter(|l| !own.contains(l)).collect();
    out.sort();
    out.dedup();
    out
}

fn tree(repo: &Path) -> String {
    let files: Vec<String> = git::run(Some(repo), &["ls-files", "-z"]).map(|t| t.split('\0').filter(|p| !p.is_empty()).map(str::to_string).collect()).unwrap_or_default();
    let mut dirs: std::collections::BTreeMap<String, usize> = Default::default();
    let mut root: Vec<String> = Vec::new();
    for f in &files {
        match f.split_once('/') {
            Some((d, rest)) => {
                let key = match rest.split_once('/') {
                    Some((sub, _)) if d == "lib" || d == "src" => format!("{d}/{sub}/"),
                    _ => format!("{d}/"),
                };
                *dirs.entry(key).or_default() += 1;
            }
            None => root.push(f.clone()),
        }
    }
    let mut out = String::new();
    for (d, n) in &dirs {
        out.push_str(&format!("{d:<24}{n} file{}\n", if *n == 1 { "" } else { "s" }));
    }
    for f in root.iter().take(20) {
        out.push_str(&format!("{f}\n"));
    }
    out
}

pub struct Facts<'a> {
    /// Name of the subject PDF linked to the project, if any.
    pub subject: Option<&'a str>,
    /// Add a section saying AI assistance was used for the tests.
    pub ai_disclosure: bool,
}

pub fn draft(repo: &Path, facts: &Facts) -> Draft {
    let dir_name = repo.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "project".into());
    let parsed = epitech::parse_repo_name(&dir_name);
    let mk = std::fs::read_to_string(repo.join("Makefile")).ok();
    let binary = mk.as_deref().and_then(makefile_name);
    let title = binary.clone().or_else(|| parsed.as_ref().map(|p| p.project.clone())).unwrap_or(dir_name);
    let mut missing = Vec::new();
    let mut md = format!("# {title}\n\n");
    md.push_str("<!-- TODO: one or two sentences on what this project does. -->\n\n");
    missing.push("a description of the project (left as a comment to fill in)".to_string());
    if let Some(p) = &parsed {
        md.push_str(&format!("Epitech project — module `{}`.", p.module));
        if let Some(s) = facts.subject {
            md.push_str(&format!(" Subject: `{s}`."));
        }
        md.push_str("\n\n");
    }

    let targets = mk.as_deref().map(testing::make_targets).unwrap_or_default();
    let has = |t: &str| targets.iter().any(|x| x == t);
    let own_libs: Vec<String> = std::fs::read_dir(repo.join("lib")).into_iter().flatten().flatten().filter(|e| e.path().is_dir()).map(|e| e.file_name().to_string_lossy().into_owned()).collect();

    md.push_str("## Requirements\n\n");
    match &mk {
        Some(text) => {
            let cc = make_var(text, "CC").unwrap_or_else(|| "cc".into());
            md.push_str(&format!("- `{cc}` and `make`\n"));
            for l in linked_libs(text, &own_libs) {
                md.push_str(&format!("- `lib{l}`\n"));
            }
        }
        None => {
            md.push_str("<!-- TODO: compiler and libraries needed. -->\n");
            missing.push("requirements (no Makefile was found)".into());
        }
    }

    md.push_str("\n## Build\n\n");
    if mk.is_some() {
        md.push_str("```sh\nmake\n```\n\n");
        let mut rules = Vec::new();
        for (t, what) in [("clean", "removes object files"), ("fclean", "removes object files and the binary"), ("re", "rebuilds from scratch")] {
            if has(t) {
                rules.push(format!("- `make {t}` {what}"));
            }
        }
        if !rules.is_empty() {
            md.push_str(&rules.join("\n"));
            md.push_str("\n\n");
        }
    } else {
        md.push_str("<!-- TODO: how to build. -->\n\n");
        missing.push("build instructions".into());
    }

    md.push_str("## Usage\n\n");
    match &binary {
        Some(b) => md.push_str(&format!("```sh\n./{b}\n```\n\n<!-- TODO: arguments and an example of output. -->\n\n")),
        None => md.push_str("<!-- TODO: how to run the program. -->\n\n"),
    }
    missing.push("usage details: arguments, example output".into());

    let detection = testing::detect(repo);
    if let Some(suite) = detection.suites.iter().find(|s| s.trusted) {
        md.push_str("## Tests\n\n");
        if detection.frameworks.iter().any(|f| f == "Criterion") {
            md.push_str("Unit tests are implemented using Criterion.\n\n");
        }
        md.push_str(&format!("Run tests:\n\n```sh\n{}\n```\n\n", suite.command));
        if facts.ai_disclosure {
            md.push_str("Part of the unit tests was written with the help of an AI assistant (Claude Code) and reviewed by the author.\n\n");
        }
    }

    let t = tree(repo);
    if !t.is_empty() {
        md.push_str(&format!("## Project structure\n\n```text\n{t}```\n"));
    }
    with_current(repo, md, missing)
}

/// Pairs a proposed text with the README currently on disk.
pub fn with_current(repo: &Path, proposed: String, missing: Vec<String>) -> Draft {
    let cur = current(repo);
    let diff = unified(cur.as_deref().unwrap_or(""), &proposed, "README.md");
    Draft { current_hash: cur.as_ref().map(|c| sha(c.as_bytes())), diff, current: cur, proposed, missing }
}

pub fn diff_against_current(repo: &Path, text: &str) -> String {
    unified(current(repo).as_deref().unwrap_or(""), text, "README.md")
}

/// Writes README.md. `expected_hash` must be the hash of what is on disk now (`None` = no README yet).
pub fn write(repo: &Path, content: &str, expected_hash: Option<&str>, backups: &Path) -> Result<Option<String>> {
    let path = repo.join("README.md");
    if path.symlink_metadata().map(|m| m.file_type().is_symlink()).unwrap_or(false) {
        return Err(AppError::new("outside_target", "README.md is a symbolic link"));
    }
    let cur = current(repo);
    if cur.as_ref().map(|c| sha(c.as_bytes())).as_deref() != expected_hash {
        return Err(AppError::new("conflict", "README.md changed since the preview. Generate it again to compare with the new version."));
    }
    let mut saved = None;
    if let Some(c) = cur {
        let dir = backups.join("readme").join(&sha(repo.to_string_lossy().as_bytes())[..12]);
        std::fs::create_dir_all(&dir)?;
        let to = dir.join(format!("README-{}.md", chrono::Local::now().format("%Y%m%d-%H%M%S%.3f")));
        std::fs::write(&to, c)?;
        saved = Some(to.to_string_lossy().into_owned());
    }
    std::fs::write(path, content)?;
    Ok(saved)
}

pub fn ai_prompt(draft: &str, disclosure: bool) -> String {
    format!(
        "Write the README.md of this project. Work only from what you can read in this folder.\n\n\
         - Read the sources, the Makefile and the tests first. Describe what the program really does, how to build it, how to run it (real arguments, taken from the argument handling in the code), and how to run the tests.\n\
         - Do not invent features, options, or example output you did not derive from the code. If something cannot be known from the files, leave an HTML comment `<!-- TODO: … -->` instead of guessing.\n\
         - Keep it short and practical: no badges, no marketing, no licence section unless a LICENSE file exists.\n\
         - {disclosure}\n\
         - Below is a factual skeleton TekBoard extracted (binary name, rules, test command, structure). Keep its facts; replace its TODO comments where the code lets you.\n\n\
         Answer with ONLY the README content inside one ```markdown block.\n\n--- SKELETON ---\n{draft}\n--- END ---",
        disclosure = if disclosure { "Include one sentence, in the Tests section, saying part of the tests was written with an AI assistant and reviewed by the author." } else { "Do not mention AI assistance anywhere." }
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn repo(root: &Path) -> std::path::PathBuf {
        let r = root.join("G-PSU-100-LYN-1-1-myls-1");
        fs::create_dir_all(r.join("tests")).unwrap();
        fs::create_dir_all(r.join("lib/my")).unwrap();
        fs::write(r.join("Makefile"), "CC = epiclang\nNAME = my_ls\nLDLIBS = -lmy -lcsfml-graphics\nall:\nclean:\nfclean:\nre:\ntests_run:\n").unwrap();
        fs::write(r.join("main.c"), "int main(void)\n{\n    return 0;\n}\n").unwrap();
        fs::write(r.join("lib/my/a.c"), "").unwrap();
        fs::write(r.join("tests/t.c"), "#include <criterion/criterion.h>\n").unwrap();
        let g = |args: &[&str]| assert!(std::process::Command::new("git").args(args).current_dir(&r).output().unwrap().status.success());
        g(&["init", "-q"]);
        g(&["add", "."]);
        r
    }

    #[test]
    fn draft_states_facts_and_marks_what_it_does_not_know() {
        let tmp = tempfile::tempdir().unwrap();
        let r = repo(tmp.path());
        let d = draft(&r, &Facts { subject: Some("G-PSU-100_my_ls.pdf"), ai_disclosure: false });
        let p = &d.proposed;
        assert!(p.starts_with("# my_ls\n"));
        assert!(p.contains("module `G-PSU-100`") && p.contains("Subject: `G-PSU-100_my_ls.pdf`"));
        assert!(p.contains("- `epiclang` and `make`") && p.contains("- `libcsfml-graphics`") && !p.contains("`libmy`"));
        assert!(p.contains("- `make fclean` removes object files and the binary"));
        assert!(p.contains("```sh\n./my_ls\n```"));
        assert!(p.contains("Unit tests are implemented using Criterion.") && p.contains("```sh\nmake tests_run\n```"));
        assert!(p.contains("lib/my/") && p.contains("tests/"));
        assert!(p.contains("<!-- TODO: one or two sentences") && !p.contains("AI assistant"));
        assert!(d.current.is_none() && d.missing.len() >= 2);
        assert!(draft(&r, &Facts { subject: None, ai_disclosure: true }).proposed.contains("AI assistant (Claude Code)"));
    }

    #[test]
    fn an_existing_readme_is_never_replaced_unseen() {
        let tmp = tempfile::tempdir().unwrap();
        let r = repo(tmp.path());
        let backups = tmp.path().join("backups");
        assert_eq!(write(&r, "# first\n", None, &backups).unwrap(), None);
        // Wrong or missing hash: refused, file untouched.
        assert!(write(&r, "# second\n", None, &backups).is_err());
        assert!(write(&r, "# second\n", Some("deadbeef"), &backups).is_err());
        assert_eq!(fs::read_to_string(r.join("README.md")).unwrap(), "# first\n");
        let d = draft(&r, &Facts { subject: None, ai_disclosure: false });
        assert!(d.diff.contains("-# first") && d.diff.contains("+# my_ls"));
        let saved = write(&r, "# second\n", d.current_hash.as_deref(), &backups).unwrap().unwrap();
        assert_eq!(fs::read_to_string(saved).unwrap(), "# first\n");
        assert_eq!(fs::read_to_string(r.join("README.md")).unwrap(), "# second\n");
    }
}
