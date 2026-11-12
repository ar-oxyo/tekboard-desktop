//! The instructions TekBoard gives to Claude Code, as editable templates.
//!
//! Each prompt has a default text shipped with the application and a list of variables
//! written `{{NAME}}`. The user may save variants ("presets") of a prompt and choose which
//! one is used; those live in the database, so they survive an update, while the defaults
//! stay in the code and improve with it.
//!
//! A prompt is only ever text: variables are replaced in one pass (a value is never read
//! again for more variables), the result is handed to Claude Code as a single argument,
//! and what Claude Code may do is decided elsewhere (`claude::build_argv`: fixed tools,
//! never a shell). Nothing written in a prompt or in a variable can run a command.

use crate::db;
use crate::error::{AppError, Result};
use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;

pub const MAX_BODY: usize = 20_000;
pub const MAX_PRESET_NAME: usize = 40;

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Var {
    pub name: &'static str,
    pub description: &'static str,
    /// Shown in the preview when no project is selected.
    pub sample: &'static str,
    /// The prompt cannot work without it: saving a variant that drops it is refused.
    pub required: bool,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Def {
    pub id: &'static str,
    pub title: &'static str,
    pub description: &'static str,
    /// What Claude Code may do when this prompt runs.
    pub access: &'static str,
    /// What TekBoard expects back; changing the prompt must keep it.
    pub expects: &'static str,
    pub default: &'static str,
    pub vars: &'static [Var],
}

const PROJECT: Var = Var { name: "PROJECT_NAME", description: "Name of the project", sample: "my_hunter", required: false };
const MODULE: Var = Var { name: "MODULE", description: "Module code, when the project has one", sample: "G-MUL-100", required: false };

pub const SUBJECT: &str = "moulinette.subject";
pub const TESTS: &str = "tests.generate";
pub const README: &str = "readme.generate";
pub const ANALYZE: &str = "repo.analyze";

pub const DEFS: &[Def] = &[
    Def {
        id: SUBJECT,
        title: "Subject requirements check",
        description: "Claude Moulinette, last step: compares the code with the linked subject.",
        access: "Read-only: project files, minus .git and secrets.",
        expects: "A JSON array in a ```json block: [{\"requirement\", \"status\": met|not_met|unclear, \"evidence\"}].",
        default: "You are checking a student project against its assignment, before a manual review. Work only from what you can read in this folder.\n\n\
1. From the assignment below, list the requirements that can be checked by reading the repository (expected files, binary name, required functions or behaviours, allowed/forbidden functions, build rules, error handling the text demands). Ignore anything about grading or deadlines. At most 25 items.\n\
2. For each one, read the relevant files and decide: \"met\", \"not_met\", or \"unclear\" when the code alone cannot tell (never guess: unclear is the right answer for behaviour you cannot verify by reading).\n\
3. Answer with ONLY a JSON array in a ```json block: [{\"requirement\": \"…\", \"status\": \"met|not_met|unclear\", \"evidence\": \"file and line, or why it is unclear\"}]. No other text.\n\n\
--- ASSIGNMENT ---\n{{SUBJECT}}\n--- END ---",
        vars: &[Var { name: "SUBJECT", description: "Text of the subject PDF linked to the project", sample: "<the text of the linked subject PDF>", required: true }, PROJECT, MODULE],
    },
    Def {
        id: TESTS,
        title: "Unit test generation",
        description: "“Generate Unit Tests with Claude”: writes tests in tests/ only.",
        access: "Reads the project; may create or edit files inside tests/ only.",
        expects: "Test files under tests/, then a short plain-text summary.",
        default: "Write unit tests for this C project.\n\n\
- Read the sources first (Glob/Grep/Read). Find the functions that have no test yet in tests/.\n\
- Write tests with {{FRAMEWORK}}, in new files under tests/ named test_<topic>.c. You may only create or edit files inside tests/: do not try to change anything else.\n\
- Follow the Epitech coding style: standard file header comment, 4-space indentation, snake_case names.\n\
- Test real behaviour you verified by reading the code, including edge cases (empty input, NULL when the function handles it, limits). Do not invent behaviour: if you are unsure what a function should return, do not test that case.\n\
- Do not test static functions or main().\n\
- {{TEST_RULE_NOTE}}\n\n\
End with a short plain-text summary: the files you wrote, the functions covered, and what you chose not to test and why.",
        vars: &[
            Var { name: "FRAMEWORK", description: "Test framework found in the project (Criterion by default)", sample: "Criterion (#include <criterion/criterion.h>)", required: false },
            Var { name: "TEST_RULE_NOTE", description: "What the Makefile says about tests (a rule exists, or none and it cannot be edited)", sample: "The Makefile has a test rule: keep to what it compiles (check which files it takes).", required: false },
            PROJECT,
            MODULE,
        ],
    },
    Def {
        id: README,
        title: "README generation",
        description: "“Generate README” with Claude: proposes a README you review before anything is written.",
        access: "Read-only: project files, minus .git and secrets.",
        expects: "The README inside one ```markdown block.",
        default: "Write the README.md of this project. Work only from what you can read in this folder.\n\n\
- Read the sources, the Makefile and the tests first. Describe what the program really does, how to build it, how to run it (real arguments, taken from the argument handling in the code), and how to run the tests.\n\
- Do not invent features, options, or example output you did not derive from the code. If something cannot be known from the files, leave an HTML comment `<!-- TODO: … -->` instead of guessing.\n\
- Keep it short and practical: no badges, no marketing, no licence section unless a LICENSE file exists.\n\
- {{DISCLOSURE}}\n\
- Below is a factual skeleton TekBoard extracted (binary name, rules, test command, structure). Keep its facts; replace its TODO comments where the code lets you.\n\n\
Answer with ONLY the README content inside one ```markdown block.\n\n--- SKELETON ---\n{{SKELETON}}\n--- END ---",
        vars: &[
            Var { name: "SKELETON", description: "Factual README skeleton TekBoard extracts from the project", sample: "# my_hunter\n\n## Build\n\n```sh\nmake\n```\n\n<!-- TODO: what the program does -->", required: true },
            Var { name: "DISCLOSURE", description: "Sentence about AI assistance, according to the option ticked in the README dialog", sample: "Do not mention AI assistance anywhere.", required: false },
            PROJECT,
            MODULE,
        ],
    },
    Def {
        id: ANALYZE,
        title: "Repository analysis",
        description: "“Analyse repository”: a read-only review of the project's structure and risks.",
        access: "Read-only: project files, minus .git and secrets.",
        expects: "A Markdown report inside one ```markdown block.",
        default: "Analyse this repository ({{PROJECT_NAME}}{{MODULE_NOTE}}) and report what its author should know before handing it in. Work only from what you can read in this folder; never guess.\n\n\
1. Overview: what the program does, how it is organised (folders, main modules, entry point), how it is built.\n\
2. Risks, most serious first: bugs you can point to (file and line), unchecked allocations or returns, memory or file-descriptor leaks, undefined behaviour, error paths that are missing.\n\
3. Build and delivery: Makefile rules (all, clean, fclean, re), files that should not be tracked, anything that would not compile from a clean clone.\n\
4. Tests: what is covered, what is not.\n\
5. Three to five concrete next steps, ordered.\n\n\
Quote file paths and line numbers for every finding. Say \"not verified\" for anything you could not confirm by reading. Do not grade the project.\n\n\
Answer with ONLY the report inside one ```markdown block.",
        vars: &[PROJECT, MODULE, Var { name: "MODULE_NOTE", description: "“, module G-XXX-000” when the project has a module, empty otherwise", sample: ", module G-MUL-100", required: false }],
    },
];

pub fn def(id: &str) -> Result<&'static Def> {
    DEFS.iter().find(|d| d.id == id).ok_or_else(|| AppError::new("unknown_prompt", "Unknown prompt"))
}

/// Names written `{{NAME}}` in a template, in order of first appearance.
pub fn variables_in(template: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut rest = template;
    while let Some(start) = rest.find("{{") {
        let after = &rest[start + 2..];
        match after.find("}}") {
            Some(end) => {
                let name = &after[..end];
                if !name.is_empty() && name.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_') {
                    if !out.iter().any(|n| n == name) {
                        out.push(name.to_string());
                    }
                    rest = &after[end + 2..];
                } else {
                    rest = after;
                }
            }
            None => break,
        }
    }
    out
}

/// Replaces `{{NAME}}` by its value, in a single pass over the template: the text of a
/// value is copied as it is and never scanned for more variables. Unknown names are left
/// untouched (they are refused when a variant is saved).
pub fn render(template: &str, values: &HashMap<String, String>) -> String {
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        match after.find("}}").map(|end| (&after[..end], end)) {
            Some((name, end)) if values.contains_key(name) => {
                out.push_str(&values[name]);
                rest = &after[end + 2..];
            }
            _ => {
                out.push_str("{{");
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Checks a variant before it is saved. Returns warnings that do not prevent saving.
pub fn validate(def: &Def, body: &str) -> Result<Vec<String>> {
    if body.trim().is_empty() {
        return Err(AppError::new("invalid_prompt", "The prompt is empty"));
    }
    if body.len() > MAX_BODY {
        return Err(AppError::new("invalid_prompt", format!("The prompt is too long ({} characters, {MAX_BODY} at most)", body.len())));
    }
    if body.contains('\0') {
        return Err(AppError::new("invalid_prompt", "The prompt contains a character that cannot be passed to a program"));
    }
    let used = variables_in(body);
    let unknown: Vec<&String> = used.iter().filter(|n| !def.vars.iter().any(|v| v.name == n.as_str())).collect();
    if !unknown.is_empty() {
        return Err(AppError::new("invalid_prompt", format!("Unknown variable{}: {}. Available here: {}.", if unknown.len() > 1 { "s" } else { "" }, unknown.iter().map(|n| format!("{{{{{n}}}}}")).collect::<Vec<_>>().join(", "), def.vars.iter().map(|v| format!("{{{{{}}}}}", v.name)).collect::<Vec<_>>().join(", "))));
    }
    let missing: Vec<&str> = def.vars.iter().filter(|v| v.required && !used.iter().any(|n| n == v.name)).map(|v| v.name).collect();
    if !missing.is_empty() {
        return Err(AppError::new("invalid_prompt", format!("This prompt cannot work without {}.", missing.iter().map(|n| format!("{{{{{n}}}}}")).collect::<Vec<_>>().join(", "))));
    }
    let mut warnings = Vec::new();
    if def.id == SUBJECT && !body.contains("json") {
        warnings.push("The answer is read as a JSON checklist: without that instruction the result will show as unreadable.".to_string());
    }
    if (def.id == README || def.id == ANALYZE) && !body.contains("markdown") {
        warnings.push("TekBoard takes the text of the first ```markdown block; without that instruction the whole answer is used.".to_string());
    }
    if def.id == TESTS && !body.contains("tests/") {
        warnings.push("Claude Code may only write inside tests/, whatever the prompt says: tell it so, or it will waste turns trying elsewhere.".to_string());
    }
    Ok(warnings)
}

fn active_key(id: &str) -> String {
    format!("prompt_active|{id}")
}

/// Name of the variant in use, or `None` for the default.
pub fn active_preset(conn: &Connection, id: &str) -> Result<Option<String>> {
    Ok(db::get_setting(conn, &active_key(id))?.filter(|p| !p.is_empty()))
}

pub fn set_active(conn: &Connection, id: &str, preset: Option<&str>) -> Result<()> {
    def(id)?;
    if let Some(p) = preset {
        if !db::prompt_variants(conn, id)?.iter().any(|(name, _, _)| name == p) {
            return Err(AppError::new("unknown_preset", "This preset no longer exists"));
        }
    }
    db::set_setting(conn, &active_key(id), preset.unwrap_or(""))
}

/// The template to use right now: the active variant when it exists and is still valid, else the default.
pub fn template(conn: &Connection, id: &str) -> Result<String> {
    let d = def(id)?;
    if let Some(name) = active_preset(conn, id)? {
        if let Some((_, body, _)) = db::prompt_variants(conn, id)?.into_iter().find(|(n, _, _)| *n == name) {
            // A variant saved by an older version may use a variable that no longer exists.
            if validate(d, &body).is_ok() {
                return Ok(body);
            }
        }
    }
    Ok(d.default.to_string())
}

pub fn save(conn: &Connection, id: &str, preset: &str, body: &str, now: i64) -> Result<Vec<String>> {
    let d = def(id)?;
    let name = preset.trim();
    if name.is_empty() || name.chars().count() > MAX_PRESET_NAME || name.chars().any(|c| c.is_control()) {
        return Err(AppError::new("invalid_preset", format!("A preset needs a name of at most {MAX_PRESET_NAME} characters")));
    }
    let warnings = validate(d, body)?;
    db::prompt_save(conn, id, name, body, now)?;
    Ok(warnings)
}

pub fn delete(conn: &Connection, id: &str, preset: &str) -> Result<()> {
    def(id)?;
    db::prompt_delete(conn, id, preset)?;
    if active_preset(conn, id)?.as_deref() == Some(preset) {
        db::set_setting(conn, &active_key(id), "")?;
    }
    Ok(())
}

/// Values every prompt may use, taken from the repository itself.
pub fn common_values(repo: &Path) -> HashMap<String, String> {
    let folder = repo.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let remote_name = crate::git::origin_url(repo).as_deref().and_then(crate::epitech::parse_remote).map(|r| r.name);
    let ep = remote_name.as_deref().and_then(crate::epitech::parse_repo_name).or_else(|| crate::epitech::parse_repo_name(&folder));
    let mut v = HashMap::new();
    v.insert("PROJECT_NAME".to_string(), ep.as_ref().map(|e| e.project.clone()).unwrap_or(folder));
    v.insert("MODULE_NOTE".to_string(), ep.as_ref().map(|e| format!(", module {}", e.module)).unwrap_or_default());
    v.insert("MODULE".to_string(), ep.map(|e| e.module).unwrap_or_default());
    v
}

/// Sample values, for a preview without a project.
pub fn sample_values(def: &Def) -> HashMap<String, String> {
    def.vars.iter().map(|v| (v.name.to_string(), v.sample.to_string())).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn values(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn every_default_is_valid_and_uses_only_its_own_variables() {
        for d in DEFS {
            let warnings = validate(d, d.default).unwrap_or_else(|e| panic!("{}: {e}", d.id));
            assert!(warnings.is_empty(), "{}: {warnings:?}", d.id);
            let rendered = render(d.default, &sample_values(d));
            assert!(!rendered.contains("{{"), "{}: a variable was left unresolved", d.id);
        }
        assert_eq!(DEFS.iter().map(|d| d.id).collect::<std::collections::HashSet<_>>().len(), DEFS.len());
    }

    #[test]
    fn variables_are_replaced_once_and_values_are_never_expanded() {
        let v = values(&[("A", "{{B}} and $(rm -rf ~) `id`"), ("B", "secret")]);
        assert_eq!(render("x {{A}} y {{B}} {{A}}", &v), "x {{B}} and $(rm -rf ~) `id` y secret {{B}} and $(rm -rf ~) `id`");
        assert_eq!(render("{{UNKNOWN}} {{ A }} {{A", &v), "{{UNKNOWN}} {{ A }} {{A", "anything that is not a known variable stays as typed");
        assert_eq!(render("{{{{A}}}}", &values(&[("A", "v")])), "{{v}}");
        assert_eq!(render("no variable", &v), "no variable");
        assert_eq!(render("é{{B}}ü", &v), "ésecretü");
    }

    #[test]
    fn variable_names_are_listed_once_in_order() {
        assert_eq!(variables_in("{{B}} {{A}} {{B}} {{not a var}} {{lower}} {{A_2}} {{"), vec!["B", "A", "A_2"]);
        assert!(variables_in("plain {text}").is_empty());
    }

    #[test]
    fn a_variant_must_keep_required_variables_and_cannot_invent_any() {
        let d = def(SUBJECT).unwrap();
        assert_eq!(validate(d, "Check it. json").unwrap_err().code(), "invalid_prompt", "{{SUBJECT}} is required");
        let e = validate(d, "{{SUBJECT}} {{HOME}} {{SHELL_CMD}}").unwrap_err();
        assert!(e.to_string().contains("{{HOME}}") && e.to_string().contains("{{SUBJECT}}"), "{e}");
        assert_eq!(validate(d, "  ").unwrap_err().code(), "invalid_prompt");
        assert_eq!(validate(d, &"x".repeat(MAX_BODY + 1)).unwrap_err().code(), "invalid_prompt");
        assert_eq!(validate(d, "a\0b {{SUBJECT}}").unwrap_err().code(), "invalid_prompt");
        assert!(validate(d, "Answer in a ```json block.\n{{SUBJECT}} for {{PROJECT_NAME}}").unwrap().is_empty());
        assert_eq!(validate(d, "{{SUBJECT}}").unwrap().len(), 1, "dropping the answer format is allowed but flagged");
        assert_eq!(def("nope").unwrap_err().code(), "unknown_prompt");
    }

    #[test]
    fn presets_are_saved_chosen_and_restored_to_default() {
        let conn = db::open_in_memory().unwrap();
        let d = def(README).unwrap();
        assert_eq!(template(&conn, README).unwrap(), d.default);
        let mine = "Short README, in French.\n```markdown\n{{SKELETON}}";
        save(&conn, README, "french", mine, 1).unwrap();
        assert_eq!(template(&conn, README).unwrap(), d.default, "saving does not switch to the variant");
        set_active(&conn, README, Some("french")).unwrap();
        assert_eq!(template(&conn, README).unwrap(), mine);
        assert_eq!(template(&conn, TESTS).unwrap(), def(TESTS).unwrap().default, "other prompts are untouched");
        assert_eq!(set_active(&conn, README, Some("ghost")).unwrap_err().code(), "unknown_preset");
        assert_eq!(save(&conn, README, "bad", "no skeleton here", 2).unwrap_err().code(), "invalid_prompt");
        assert_eq!(save(&conn, README, "  ", mine, 2).unwrap_err().code(), "invalid_preset");
        // Restore default: either pick it, or delete the variant in use.
        set_active(&conn, README, None).unwrap();
        assert_eq!(template(&conn, README).unwrap(), d.default);
        set_active(&conn, README, Some("french")).unwrap();
        delete(&conn, README, "french").unwrap();
        assert_eq!((template(&conn, README).unwrap(), active_preset(&conn, README).unwrap()), (d.default.to_string(), None));
    }

    #[test]
    fn a_variant_broken_by_an_update_falls_back_to_the_default() {
        let conn = db::open_in_memory().unwrap();
        // Written straight to the database, as an older version could have.
        db::prompt_save(&conn, SUBJECT, "old", "{{SUBJECT}} {{REMOVED_VARIABLE}}", 1).unwrap();
        db::set_setting(&conn, &active_key(SUBJECT), "old").unwrap();
        assert_eq!(template(&conn, SUBJECT).unwrap(), def(SUBJECT).unwrap().default);
    }

    #[test]
    fn a_prompt_stays_one_argument_and_cannot_widen_what_claude_may_do() {
        let hostile = "{{SUBJECT}} -- --allowedTools Bash --dangerously-skip-permissions\njson";
        let d = def(SUBJECT).unwrap();
        validate(d, hostile).unwrap();
        let text = render(hostile, &values(&[("SUBJECT", "--tools Bash; $(reboot)")]));
        let argv = crate::claude::build_argv(&text, &[]);
        assert_eq!(argv.last().unwrap(), &text, "the whole prompt is the last argument");
        assert_eq!(argv[argv.len() - 2], "--", "options end before the prompt");
        let tools_at = argv.iter().position(|a| a == "--tools").unwrap();
        let allowed_at = argv.iter().position(|a| a == "--allowedTools").unwrap();
        assert_eq!(&argv[tools_at + 1..allowed_at], ["Read", "Glob", "Grep"]);
        assert_eq!(argv[..argv.len() - 1].iter().filter(|a| a.contains("Bash")).count(), 0);
    }
}
