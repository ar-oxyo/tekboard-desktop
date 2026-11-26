//! TekBoard's moulinette: an independent evaluation of a C project, inspired by Epitech's
//! (it does not claim to reproduce its private tests).
//!
//! 1. **Analysis** (`analyze`, one AI call): Artix gets the subject and the project's function
//!    *signatures* — never their code — and writes a test plan whose expectations come from
//!    the subject (or from explicit conventions), with what the subject leaves unspecified.
//!    Unit tests become Criterion files, checked by `criterion::check_body`.
//! 2. **Run** (`run`, no AI): a throwaway copy is built in the sandbox, each functional case
//!    runs the program with limits, the Criterion files are compiled against the project's
//!    sources and run; every result says whether the program or the moulinette failed.
//!
//! It gives results, never solutions: no fix, no patch, no reference implementation.

pub mod criterion;

use crate::ai::runner::{self, Request, Tools};
use crate::ai::sandbox::{self, Limits};
use crate::error::{AppError, Result};
use crate::jobs::{Job, RunOpts};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const CATEGORIES: &[&str] = &["simple", "fonctionnel", "limites", "erreurs", "robustesse", "memoire", "performance", "regression"];

fn yes() -> bool {
    true
}

/// One case of the plan: a run of the program (`io`) or a Criterion unit test (`unit`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Case {
    pub id: String,
    pub category: String,
    pub kind: String,
    pub title: String,
    /// Where the expectation comes from (a part of the subject, a convention).
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub stdin: Option<String>,
    #[serde(default)]
    pub expect_stdout: Option<String>,
    #[serde(default)]
    pub expect_contains: Option<String>,
    #[serde(default)]
    pub expect_code: Option<i32>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub target: Option<String>,
    #[serde(default)]
    pub suite: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default = "yes")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Suite {
    /// What the program does and the format of its input and output, as understood.
    pub summary: String,
    pub cases: Vec<Case>,
    /// What the subject does not say: nothing is tested about it.
    pub unspecified: Vec<String>,
    /// Cases set aside, with the reason.
    pub rejected: Vec<String>,
    pub files: Vec<criterion::TestFile>,
    /// The plan was written with a subject (false: conventions only).
    pub with_subject: bool,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CaseResult {
    pub id: String,
    pub title: String,
    pub category: String,
    pub kind: String,
    /// `passed`, `failed`, `timeout`, `crashed`, `memory`, `skipped`, `build_error`, `mouli_error`.
    pub status: String,
    /// Who failed: `program` or `mouli` (the test itself could not run).
    pub origin: String,
    pub input: String,
    pub expected: Option<String>,
    pub got: Option<String>,
    pub stdout: String,
    pub stderr: String,
    pub code: Option<i32>,
    pub signal: Option<String>,
    pub ms: u64,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub results: Vec<CaseResult>,
    /// TekBoard score in percent (passed over the tests that ran), not an Epitech grade.
    pub score: Option<f64>,
    pub build: Option<String>,
    pub finished_at: i64,
}

// ───────────────────────────── storage ─────────────────────────────

pub fn load(conn: &Connection, repo: &str) -> Result<(Option<Suite>, Option<Report>)> {
    let row: Option<(String, Option<String>)> = conn.query_row("SELECT suite, report FROM mouli_suites WHERE repo = ?1", [repo], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
    Ok(match row {
        Some((s, r)) => (serde_json::from_str(&s).ok(), r.and_then(|r| serde_json::from_str(&r).ok())),
        None => (None, None),
    })
}

pub fn save_suite(conn: &Connection, repo: &str, suite: &Suite, now: i64) -> Result<()> {
    conn.execute("INSERT INTO mouli_suites (repo, suite, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(repo) DO UPDATE SET suite = ?2, updated_at = ?3", params![repo, serde_json::to_string(suite)?, now])?;
    Ok(())
}

fn save_report(conn: &Connection, repo: &str, report: &Report) -> Result<()> {
    conn.execute("UPDATE mouli_suites SET report = ?2 WHERE repo = ?1", params![repo, serde_json::to_string(report)?])?;
    Ok(())
}

/// Turns cases on or off (the plan is the student's to trim).
pub fn set_enabled(conn: &Connection, repo: &str, ids: &[String], enabled: bool, now: i64) -> Result<Suite> {
    let (Some(mut s), _) = load(conn, repo)? else { return Err(AppError::new("no_suite", "Aucun plan de tests pour ce projet : lance d'abord l'analyse.")) };
    for c in s.cases.iter_mut().filter(|c| ids.contains(&c.id)) {
        c.enabled = enabled;
    }
    save_suite(conn, repo, &s, now)?;
    Ok(s)
}

// ───────────────────────────── reading the project ─────────────────────────────

/// Source files of the project (not tests, bonus or hidden folders), relative paths.
fn sources(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_lowercase();
            let Ok(meta) = std::fs::symlink_metadata(&p) else { continue };
            if meta.is_dir() {
                if !name.starts_with('.') && !matches!(name.as_str(), "tests" | "test" | "unit_tests" | "bonus" | "node_modules") {
                    stack.push(p);
                }
            } else if meta.is_file() && (name.ends_with(".c") || name.ends_with(".h")) && meta.len() < 512 * 1024 && out.len() < 400 {
                out.push(p.strip_prefix(root).unwrap_or(&p).to_path_buf());
            }
        }
    }
    out.sort();
    out
}

/// What the analysis may see of the code: prototypes and signatures, never bodies.
pub struct Shape {
    pub functions: BTreeSet<String>,
    pub signatures: Vec<String>,
    /// Headers (file names) and the folders that hold them.
    pub headers: Vec<String>,
    pub include_dirs: Vec<String>,
    /// Sources to link unit tests with (without the file that defines `main`).
    pub link: Vec<String>,
}

pub fn shape(root: &Path) -> Shape {
    let mut s = Shape { functions: BTreeSet::new(), signatures: Vec::new(), headers: Vec::new(), include_dirs: Vec::new(), link: Vec::new() };
    for rel in sources(root) {
        let Ok(text) = std::fs::read_to_string(root.join(&rel)) else { continue };
        let file = rel.to_string_lossy().into_owned();
        let parsed = crate::cparse::parse(&text, &file);
        if file.ends_with(".h") {
            s.headers.push(rel.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default());
            let dir = rel.parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
            if !s.include_dirs.contains(&dir) {
                s.include_dirs.push(dir);
            }
            for p in &parsed.prototypes {
                s.signatures.push(format!("{} // {file}", p.text.trim().trim_end_matches(';')));
            }
            continue;
        }
        let has_main = parsed.functions.iter().any(|f| f.name == "main");
        for f in parsed.exported().filter(|f| f.name != "main") {
            s.functions.insert(f.name.clone());
            s.signatures.push(format!("{} // {file}", f.signature));
        }
        if !has_main {
            s.link.push(file);
        }
    }
    s.signatures.sort();
    s.signatures.dedup();
    s.signatures.truncate(300);
    s
}

// ───────────────────────────── analysis ─────────────────────────────

pub fn plan_prompt(project: &str, summary: &Shape, subject: Option<&str>, makefile_rules: &[String]) -> String {
    let subject_block = match subject {
        Some(s) => format!("SUJET (référence de toutes les valeurs attendues) :\n<<<\n{}\n>>>", crate::ai::stream::clip(s, 30_000)),
        None => "PAS DE SUJET LIÉ. Ne teste que des conventions explicites et vérifiables (le programme ne plante pas, code 84 en cas d'erreur d'utilisation, selon la convention Epitech) et dis-le dans « unspecified ».".into(),
    };
    format!(
        "Tu prépares la moulinette TekBoard du projet C « {project} ». Tu ne vois PAS le code : seulement le sujet et les signatures. Les résultats attendus doivent venir du sujet ou d'une convention explicite, jamais d'une supposition sur l'implémentation.\n\n\
{subject_block}\n\n\
SIGNATURES DU PROJET :\n{}\n\nRÈGLES DU MAKEFILE : {}\n\n\
Construis un plan de tests réfléchi, de 10 à 40 cas, qualité avant quantité :\n\
- catégories : {} ;\n\
- `io` : lance le binaire (`args`, `stdin` facultatif) et compare `expectStdout` (exact, avec les retours à la ligne), ou `expectContains`, et/ou `expectCode` ; `timeoutMs` (2000 par défaut, plus serré en performance) ;\n\
- `unit` : un test Criterion. `target` = fonction testée (une des signatures), `suite`, `name` = `<fonction>_<comportement>_<attendu>` en snake_case, `body` = instructions C qui n'appellent QUE des fonctions du projet et l'API Criterion (cr_assert_eq, cr_assert_str_eq, cr_assert_null, cr_redirect_stdout…), aucune fonction de la bibliothèque C, des valeurs attendues littérales, jamais calculées par la fonction testée ;\n\
- pense aux cas vicieux QUE LE SUJET DEMANDE de gérer : chaînes vides, NULL, négatifs, extrêmes, débordements, données mal formées, arguments manquants, entrées très longues ; aucun test sur un comportement que le sujet ne précise pas : liste-le dans `unspecified` ;\n\
- `source` dit d'où vient l'attente (« sujet : section … », « convention Epitech : 84 »).\n\
Tu ne proposes JAMAIS de correction ni de solution.\n\n\
Réponds par un seul bloc ```json``` :\n\
{{\"summary\": \"ce que fait le programme, format des entrées et sorties\", \"cases\": [{{\"id\": \"io-1\", \"category\": \"fonctionnel\", \"kind\": \"io\", \"title\": \"…\", \"source\": \"…\", \"args\": [\"…\"], \"expectStdout\": \"…\\n\", \"expectCode\": 0}}, {{\"id\": \"unit-1\", \"category\": \"limites\", \"kind\": \"unit\", \"title\": \"…\", \"source\": \"…\", \"target\": \"my_strlen\", \"suite\": \"my_strlen\", \"name\": \"my_strlen_empty_string_returns_zero\", \"body\": \"cr_assert_eq(my_strlen(\\\"\\\"), 0);\"}}], \"unspecified\": [\"…\"]}}",
        if summary.signatures.is_empty() { "(aucune fonction trouvée)".into() } else { summary.signatures.join("\n") },
        if makefile_rules.is_empty() { "(aucune)".into() } else { makefile_rules.join(", ") },
        CATEGORIES.join(", ")
    )
}

/// Reads and checks the plan Artix wrote: unknown categories, missing expectations and unit
/// tests that break the rules are set aside with the reason.
pub fn read_plan(answer: &str, sh: &Shape, project: &str, year: i32, now: i64, with_subject: bool) -> Suite {
    let body = crate::claude::fenced(answer, "json");
    let v: Value = match (body.find('{'), body.rfind('}')) {
        (Some(s), Some(e)) => serde_json::from_str(&body[s..=e]).unwrap_or(Value::Null),
        _ => Value::Null,
    };
    let mut suite = Suite { summary: v["summary"].as_str().unwrap_or("").chars().take(1200).collect(), with_subject, created_at: now, ..Default::default() };
    if v.is_null() {
        suite.rejected.push("La réponse d'Artix ne contient pas de plan lisible.".into());
        return suite;
    }
    suite.unspecified = v["unspecified"].as_array().into_iter().flatten().filter_map(|x| x.as_str().map(|s| s.chars().take(300).collect())).take(30).collect();
    let mut ids = BTreeSet::new();
    let mut units = Vec::new();
    for raw in v["cases"].as_array().into_iter().flatten().take(60) {
        let Ok(mut c) = serde_json::from_value::<Case>(raw.clone()) else {
            suite.rejected.push("un cas illisible".into());
            continue;
        };
        c.enabled = true;
        if c.id.is_empty() || !ids.insert(c.id.clone()) {
            c.id = format!("case-{}", ids.len() + 1);
            ids.insert(c.id.clone());
        }
        if !CATEGORIES.contains(&c.category.as_str()) {
            c.category = "fonctionnel".into();
        }
        let why = match c.kind.as_str() {
            "io" if c.expect_stdout.is_none() && c.expect_contains.is_none() && c.expect_code.is_none() => Some("rien à comparer".to_string()),
            "io" if c.args.iter().any(|a| a.len() > 100_000) || c.stdin.as_ref().is_some_and(|s| s.len() > 1_000_000) => Some("entrée trop grande".into()),
            "io" => None,
            "unit" => {
                let t = criterion::UnitTest { suite: c.suite.clone().unwrap_or_default(), name: c.name.clone().unwrap_or_default(), target: c.target.clone().unwrap_or_default(), body: c.body.clone().unwrap_or_default() };
                let problems = criterion::check_body(&t, &sh.functions);
                if problems.is_empty() {
                    units.push(t);
                    None
                } else {
                    Some(problems.join(" ; "))
                }
            }
            _ => Some("type inconnu".into()),
        };
        match why {
            Some(w) => suite.rejected.push(format!("« {} » écarté : {w}", c.title)),
            None => suite.cases.push(c),
        }
    }
    let headers: Vec<String> = sh.headers.iter().take(4).cloned().collect();
    suite.files = criterion::assemble(project, year, &units, &headers);
    suite
}

/// Analysis job: signatures, subject, one AI call, checked plan saved for the project.
pub fn analyze_in_job(job: &Job, db: &std::sync::Mutex<Connection>, repo: &Path, subject: Option<String>) -> Result<&'static str> {
    job.start("read");
    let sh = shape(repo);
    let project = repo.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "project".into());
    let rules = std::fs::read_to_string(repo.join("Makefile")).map(|t| crate::testing::make_targets(&t)).unwrap_or_default();
    job.end("read", "success", Some(format!("{} fonction(s), {} en-tête(s){}", sh.functions.len(), sh.headers.len(), if subject.is_some() { ", sujet lié" } else { ", pas de sujet lié" })));
    job.start("plan");
    let req = Request::new(plan_prompt(&project, &sh, subject.as_deref(), &rules), Tools::None, Duration::from_secs(600));
    let empty = std::env::temp_dir();
    let (outcome, answer) = runner::run(job, &empty, &req, &mut |_| {})?;
    if outcome.cancelled {
        return Ok("cancelled");
    }
    let answer = answer?;
    job.end("plan", "success", None);
    job.start("check");
    let now = crate::commands::now();
    let year = chrono::Datelike::year(&chrono::Local::now());
    let suite = read_plan(&answer.text, &sh, &project, year, now, subject.is_some());
    save_suite(&db.lock().unwrap_or_else(|e| e.into_inner()), &repo.to_string_lossy(), &suite, now)?;
    job.set("suite", &suite);
    let status = if suite.cases.is_empty() { "failed" } else if suite.rejected.is_empty() { "success" } else { "warning" };
    job.end("check", status, Some(format!("{} cas retenus, {} écartés, {} fichier(s) Criterion", suite.cases.len(), suite.rejected.len(), suite.files.len())));
    Ok(status)
}

pub const ANALYZE_STEPS: &[(&str, &str)] = &[("read", "Lecture du projet et du sujet"), ("plan", "Plan de tests (Artix)"), ("check", "Contrôle des tests")];

// ───────────────────────────── run ─────────────────────────────

pub const RUN_STEPS: &[(&str, &str)] = &[("prepare", "Copie de travail"), ("build", "Compilation"), ("io", "Tests du programme"), ("unit", "Tests unitaires"), ("report", "Résultats")];

fn exec(job: &Job, root: &Path, argv: &[String], stdin: Option<&Path>, limits: &Limits) -> Result<crate::jobs::Outcome> {
    let wrapped = sandbox::wrap_argv(root, argv, &[], limits)?;
    job.run_opts(&RunOpts { argv: &wrapped, cwd: root, timeout: limits.wall + Duration::from_secs(2), envs: &[], log_output: false, stdin, split_streams: true }, &mut |_| {})
}

const SHOWN: usize = 4000;

fn clip(s: &str) -> String {
    if s.len() <= SHOWN {
        return s.to_string();
    }
    let mut cut = SHOWN;
    while !s.is_char_boundary(cut) {
        cut -= 1;
    }
    format!("{}\n… ({} octets de plus)", &s[..cut], s.len() - cut)
}

/// Exit code and signal: the sandbox's shell reports a signal as 128 + n.
fn code_and_signal(o: &crate::jobs::Outcome) -> (Option<i32>, Option<String>) {
    match o.code {
        Some(c) if c > 128 && c < 160 => (None, Some(sandbox::signal_name(c - 128).to_string())),
        c => (c, None),
    }
}

/// Compares a functional case's run with what the plan expects.
pub fn judge_io(c: &Case, o: &crate::jobs::Outcome, memcheck: bool) -> CaseResult {
    let (code, signal) = code_and_signal(o);
    let mut r = CaseResult {
        id: c.id.clone(),
        title: c.title.clone(),
        category: c.category.clone(),
        kind: c.kind.clone(),
        origin: "program".into(),
        input: format!("{}{}", if c.args.is_empty() { "(sans argument)".to_string() } else { c.args.iter().map(|a| sandbox::shell_quote(a)).collect::<Vec<_>>().join(" ") }, c.stdin.as_ref().map(|s| format!(" < « {} »", clip(s))).unwrap_or_default()),
        stdout: clip(&o.stdout),
        stderr: clip(&o.stderr),
        code,
        signal: signal.clone(),
        ms: o.duration_ms,
        ..Default::default()
    };
    let mut wrong: Vec<(String, String, String)> = Vec::new();
    if o.timed_out {
        r.status = "timeout".into();
        r.detail = Some(format!("arrêté après {} ms", c.timeout_ms.unwrap_or(2000)));
        return r;
    }
    if memcheck && o.code == Some(99) {
        r.status = "memory".into();
        r.detail = Some("Valgrind signale une erreur mémoire (voir la sortie d'erreur)".into());
        return r;
    }
    if let Some(sig) = signal {
        r.status = "crashed".into();
        r.detail = Some(format!("tué par {sig}"));
        return r;
    }
    if let Some(e) = c.expect_code {
        if code != Some(e) {
            wrong.push(("code de retour".into(), e.to_string(), code.map(|c| c.to_string()).unwrap_or_else(|| "—".into())));
        }
    }
    if let Some(e) = &c.expect_stdout {
        if &o.stdout != e {
            wrong.push(("sortie standard".into(), e.clone(), o.stdout.clone()));
        }
    }
    if let Some(e) = &c.expect_contains {
        if !o.stdout.contains(e.as_str()) {
            wrong.push(("sortie contenant".into(), e.clone(), o.stdout.clone()));
        }
    }
    if wrong.is_empty() {
        r.status = "passed".into();
    } else {
        r.status = "failed".into();
        r.detail = Some(wrong.iter().map(|w| w.0.clone()).collect::<Vec<_>>().join(", "));
        r.expected = Some(clip(&wrong.iter().map(|w| w.1.clone()).collect::<Vec<_>>().join("\n— \n")));
        r.got = Some(clip(&wrong.iter().map(|w| w.2.clone()).collect::<Vec<_>>().join("\n— \n")));
    }
    r
}

/// Criterion's JSON report: `suite::name` → (status, messages).
pub fn parse_criterion_json(text: &str) -> Vec<(String, String, Vec<String>)> {
    let v: Value = serde_json::from_str(text).unwrap_or(Value::Null);
    let mut out = Vec::new();
    for s in v["test_suites"].as_array().into_iter().flatten() {
        let suite = s["name"].as_str().unwrap_or("");
        for t in s["tests"].as_array().into_iter().flatten() {
            let msgs = t["messages"].as_array().into_iter().flatten().filter_map(|m| m.as_str().map(String::from)).collect();
            out.push((format!("{suite}::{}", t["name"].as_str().unwrap_or("")), t["status"].as_str().unwrap_or("").to_string(), msgs));
        }
    }
    out
}

pub fn score(results: &[CaseResult]) -> Option<f64> {
    let counted: Vec<&CaseResult> = results.iter().filter(|r| r.status != "skipped" && r.origin != "mouli").collect();
    (!counted.is_empty()).then(|| (counted.iter().filter(|r| r.status == "passed").count() as f64 * 1000.0 / counted.len() as f64).round() / 10.0)
}

/// Runs the saved plan (or only `only`) on a throwaway copy of `repo`.
pub fn run_in_job(job: &Job, db: &std::sync::Mutex<Connection>, repo: &Path, cache: &Path, only: Option<Vec<String>>) -> Result<&'static str> {
    let key = repo.to_string_lossy().into_owned();
    let (suite, previous) = load(&db.lock().unwrap_or_else(|e| e.into_inner()), &key)?;
    let Some(suite) = suite else { return Err(AppError::new("no_suite", "Aucun plan de tests : lance d'abord l'analyse.")) };
    let wanted = |c: &Case| c.enabled && only.as_ref().is_none_or(|o| o.contains(&c.id));
    let mut report = Report { finished_at: 0, ..Default::default() };
    // A partial rerun keeps the other results of the last run.
    if let (Some(o), Some(prev)) = (&only, previous) {
        report.results = prev.results.into_iter().filter(|r| !o.contains(&r.id)).collect();
    }
    let publish = |r: &Report| job.set("report", r);

    job.start("prepare");
    if let Err(why) = sandbox::check() {
        job.end("prepare", "failed", Some(why.clone()));
        return Err(AppError::new("no_sandbox", format!("Bac à sable indisponible : {why}. Rien n'a été exécuté.")));
    }
    let base = cache.join("mouli").join(format!("run-{}", crate::commands::now()));
    let work = base.join("work");
    let n = crate::ai::workcopy::copy(repo, &work)?;
    job.end("prepare", "success", Some(format!("{n} fichiers copiés")));
    let cleanup = || {
        let _ = std::fs::remove_dir_all(&base);
    };

    job.start("build");
    let build_limits = Limits { wall: Duration::from_secs(300), cpu_seconds: 600, file_mb: 1024, output_cap: 64 * 1024, mem_mb: Some(4096), tasks: Some(256), address_space_free: false };
    let out = exec(job, &work, &["make".into(), "-C".into(), work.to_string_lossy().into_owned()], None, &build_limits)?;
    if out.cancelled {
        cleanup();
        return Ok("cancelled");
    }
    let program = crate::runner::detect(&work).map(|(p, _)| p).filter(|p| work.join(p).is_file());
    let io_cases: Vec<&Case> = suite.cases.iter().filter(|c| c.kind == "io" && wanted(c)).collect();
    if !out.ok() || (program.is_none() && !io_cases.is_empty()) {
        let why = if out.ok() { "binaire introuvable après make (NAME du Makefile ?)".to_string() } else { format!("make échoue :\n{}", clip(&out.output)) };
        job.end("build", "failed", Some(why.lines().next().unwrap_or("").to_string()));
        report.build = Some(why.clone());
        for c in &io_cases {
            report.results.push(CaseResult { id: c.id.clone(), title: c.title.clone(), category: c.category.clone(), kind: c.kind.clone(), status: "build_error".into(), origin: "program".into(), detail: Some("le projet ne compile pas".into()), ..Default::default() });
        }
    } else {
        job.end("build", "success", None);
    }

    // ── functional cases
    job.start("io");
    let memcheck = crate::toolenv::which("valgrind").is_some();
    if let (Some(prog), true) = (&program, report.build.is_none()) {
        for (i, c) in io_cases.iter().enumerate() {
            let stdin = match &c.stdin {
                Some(s) => {
                    let p = base.join(format!("stdin-{i}.txt"));
                    std::fs::write(&p, s)?;
                    Some(p)
                }
                None => None,
            };
            let ms = c.timeout_ms.unwrap_or(2000).clamp(100, 30_000);
            let mem = c.category == "memoire" && memcheck;
            let wall = Duration::from_millis(if mem { ms * 20 } else { ms });
            let limits = Limits { wall, cpu_seconds: wall.as_secs() + 2, file_mb: 64, output_cap: 64 * 1024, mem_mb: Some(if mem { 2048 } else { 512 }), tasks: Some(64), address_space_free: mem };
            let mut argv: Vec<String> = if mem { vec!["valgrind".into(), "-q".into(), "--error-exitcode=99".into(), "--leak-check=full".into(), "--errors-for-leak-kinds=definite".into()] } else { Vec::new() };
            argv.push(work.join(prog).to_string_lossy().into_owned());
            argv.extend(c.args.iter().cloned());
            let o = exec(job, &work, &argv, stdin.as_deref(), &limits)?;
            if o.cancelled {
                cleanup();
                return Ok("cancelled");
            }
            let r = judge_io(c, &o, mem);
            job.log(&format!("{} · {} : {}", c.id, c.title, r.status));
            report.results.retain(|x| x.id != r.id);
            report.results.push(r);
            publish(&report);
        }
        job.end("io", "success", Some(format!("{} cas", io_cases.len())));
    } else if io_cases.is_empty() {
        job.skip("io", "aucun cas de ce type");
    } else {
        job.skip("io", "le programme ne compile pas");
    }

    // ── unit tests (Criterion)
    job.start("unit");
    let unit_cases: Vec<&Case> = suite.cases.iter().filter(|c| c.kind == "unit" && wanted(c)).collect();
    let mark = |report: &mut Report, status: &str, origin: &str, detail: &str| {
        for c in &unit_cases {
            report.results.retain(|x| x.id != c.id);
            report.results.push(CaseResult { id: c.id.clone(), title: c.title.clone(), category: c.category.clone(), kind: "unit".into(), status: status.into(), origin: origin.into(), input: format!("Test({}, {})", c.suite.clone().unwrap_or_default(), c.name.clone().unwrap_or_default()), detail: Some(detail.to_string()), ..Default::default() });
        }
    };
    if unit_cases.is_empty() || suite.files.is_empty() {
        job.skip("unit", "aucun test unitaire");
    } else if !crate::testing::criterion_installed() {
        mark(&mut report, "skipped", "mouli", "Criterion n'est pas installé (voir Doctor)");
        job.skip("unit", "Criterion absent");
    } else {
        let sh = shape(&work);
        let tests_dir = work.join(".mouli");
        std::fs::create_dir_all(&tests_dir)?;
        let mut argv: Vec<String> = vec!["gcc".into(), "-o".into(), tests_dir.join("unit").to_string_lossy().into_owned()];
        for d in &sh.include_dirs {
            argv.push(format!("-I{}", work.join(d).display()));
        }
        argv.extend(sh.link.iter().map(|f| work.join(f).to_string_lossy().into_owned()));
        for f in &suite.files {
            let p = tests_dir.join(&f.name);
            std::fs::write(&p, &f.content)?;
            argv.push(p.to_string_lossy().into_owned());
        }
        argv.extend(["-lcriterion".into(), "-lm".into()]);
        let o = exec(job, &work, &argv, None, &build_limits)?;
        if o.cancelled {
            cleanup();
            return Ok("cancelled");
        }
        if !o.ok() {
            // An error in a generated file is the moulinette's; elsewhere, the project's.
            let ours = o.output.lines().filter(|l| l.contains("error")).all(|l| l.contains(".mouli/"));
            mark(&mut report, if ours { "mouli_error" } else { "build_error" }, if ours { "mouli" } else { "program" }, &clip(&o.output));
            job.end("unit", "failed", Some(if ours { "un test généré ne compile pas" } else { "les sources ne se lient pas avec les tests" }.into()));
        } else {
            let json_path = tests_dir.join("report.json");
            let limits = Limits { wall: Duration::from_secs(120), cpu_seconds: 180, file_mb: 64, output_cap: 64 * 1024, mem_mb: Some(1024), tasks: Some(128), address_space_free: false };
            let run = exec(job, &work, &[tests_dir.join("unit").to_string_lossy().into_owned(), format!("--json={}", json_path.display()), "--jobs=1".into()], None, &limits)?;
            if run.cancelled {
                cleanup();
                return Ok("cancelled");
            }
            let parsed = parse_criterion_json(&std::fs::read_to_string(&json_path).unwrap_or_default());
            for c in &unit_cases {
                let key = format!("{}::{}", c.suite.clone().unwrap_or_default(), c.name.clone().unwrap_or_default());
                let found = parsed.iter().find(|(k, _, _)| *k == key);
                let (status, detail) = match found {
                    Some((_, s, _)) if s == "PASSED" => ("passed", None),
                    Some((_, s, m)) if s == "SKIPPED" => ("skipped", Some(m.join("\n"))),
                    Some((_, s, m)) if s == "ERRORED" || m.iter().any(|x| x.contains("crash")) => ("crashed", Some(m.join("\n"))),
                    Some((_, _, m)) => ("failed", Some(m.join("\n"))),
                    None if run.timed_out => ("timeout", Some("la suite de tests a dépassé 120 s".into())),
                    None => ("mouli_error", Some("résultat absent du rapport de Criterion".into())),
                };
                report.results.retain(|x| x.id != c.id);
                report.results.push(CaseResult { id: c.id.clone(), title: c.title.clone(), category: c.category.clone(), kind: "unit".into(), status: status.into(), origin: if status == "mouli_error" { "mouli".into() } else { "program".into() }, input: format!("Test({}, {})", c.suite.clone().unwrap_or_default(), c.name.clone().unwrap_or_default()), expected: c.body.clone(), stdout: clip(&run.stdout), stderr: clip(&run.stderr), detail, ms: run.duration_ms, ..Default::default() });
            }
            job.end("unit", "success", Some(format!("{} test(s)", unit_cases.len())));
        }
    }
    publish(&report);

    job.start("report");
    let order = |id: &str| suite.cases.iter().position(|c| c.id == id).unwrap_or(usize::MAX);
    report.results.sort_by_key(|r| order(&r.id));
    report.score = score(&report.results);
    report.finished_at = crate::commands::now();
    save_report(&db.lock().unwrap_or_else(|e| e.into_inner()), &key, &report)?;
    publish(&report);
    let failed = report.results.iter().filter(|r| r.status != "passed" && r.status != "skipped").count();
    job.end("report", "success", Some(match report.score { Some(s) => format!("score TekBoard {s} % · {failed} échec(s)"), None => "rien n'a pu être testé".into() }));
    cleanup();
    Ok(if failed == 0 && report.build.is_none() { "success" } else { "warning" })
}

// ───────────────────────────── export ─────────────────────────────

/// Writes the generated Criterion files into the project's `tests/` folder. An existing file
/// is never replaced: it is reported and left as it is.
pub fn export(repo: &Path, files: &[criterion::TestFile], names: &[String]) -> Result<Value> {
    let dir = repo.join("tests");
    std::fs::create_dir_all(&dir)?;
    let (mut written, mut kept) = (Vec::new(), Vec::new());
    for f in files.iter().filter(|f| names.contains(&f.name)) {
        if !f.name.starts_with("test_") || !f.name.ends_with(".c") || f.name.contains('/') || f.name.contains("..") {
            continue;
        }
        let path = dir.join(&f.name);
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                use std::io::Write;
                file.write_all(f.content.as_bytes())?;
                written.push(format!("tests/{}", f.name));
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => kept.push(format!("tests/{}", f.name)),
            Err(e) => return Err(e.into()),
        }
    }
    Ok(json!({"written": written, "kept": kept}))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn outcome(code: Option<i32>, stdout: &str) -> crate::jobs::Outcome {
        crate::jobs::Outcome { code, output: stdout.into(), stdout: stdout.into(), stderr: String::new(), timed_out: false, cancelled: false, duration_ms: 12 }
    }

    fn io(expect_stdout: Option<&str>, expect_code: Option<i32>) -> Case {
        Case { id: "io-1".into(), category: "fonctionnel".into(), kind: "io".into(), title: "t".into(), args: vec!["a b".into()], expect_stdout: expect_stdout.map(String::from), expect_code, enabled: true, ..Default::default() }
    }

    #[test]
    fn functional_results_say_what_was_expected_and_what_came_out() {
        assert_eq!(judge_io(&io(Some("3\n"), Some(0)), &outcome(Some(0), "3\n"), false).status, "passed");
        let r = judge_io(&io(Some("3\n"), Some(0)), &outcome(Some(0), "4\n"), false);
        assert_eq!((r.status.as_str(), r.expected.as_deref(), r.got.as_deref()), ("failed", Some("3\n"), Some("4\n")));
        assert_eq!(r.input, "'a b'");
        assert_eq!(judge_io(&io(None, Some(84)), &outcome(Some(0), ""), false).detail.as_deref(), Some("code de retour"));
        let crash = judge_io(&io(Some("x"), None), &outcome(Some(139), ""), false);
        assert_eq!((crash.status.as_str(), crash.signal.as_deref()), ("crashed", Some("SIGSEGV (segfault)")));
        assert_eq!(judge_io(&io(Some("x"), None), &outcome(Some(99), ""), true).status, "memory");
        let mut slow = outcome(None, "");
        slow.timed_out = true;
        assert_eq!(judge_io(&io(Some("x"), None), &slow, false).status, "timeout");
    }

    #[test]
    fn the_plan_is_checked_and_files_are_built() {
        let sh = Shape { functions: ["my_strlen"].iter().map(|s| s.to_string()).collect(), signatures: vec![], headers: vec!["my.h".into()], include_dirs: vec!["include".into()], link: vec![] };
        let answer = r#"```json
{"summary": "Compte", "unspecified": ["NULL"], "cases": [
 {"id": "io-1", "category": "fonctionnel", "kind": "io", "title": "ok", "args": ["x"], "expectCode": 0},
 {"id": "io-2", "category": "fonctionnel", "kind": "io", "title": "sans attente", "args": []},
 {"id": "u-1", "category": "limites", "kind": "unit", "title": "vide", "target": "my_strlen", "suite": "my_strlen", "name": "my_strlen_empty_returns_zero", "body": "cr_assert_eq(my_strlen(\"\"), 0);"},
 {"id": "u-2", "category": "inventée", "kind": "unit", "title": "libc", "target": "my_strlen", "suite": "my_strlen", "name": "my_strlen_x_y", "body": "cr_assert_eq(my_strlen(\"a\"), strlen(\"a\"));"}
]}
```"#;
        let s = read_plan(answer, &sh, "G-CPE-100-LYN-1-1-x", 2026, 1, true);
        assert_eq!(s.cases.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), ["io-1", "u-1"]);
        assert_eq!(s.rejected.len(), 2, "{:?}", s.rejected);
        assert_eq!(s.files.len(), 1);
        assert!(s.files[0].content.contains("** G-CPE-100-LYN-1-1-x"));
        assert_eq!(s.unspecified, ["NULL"]);
        assert!(read_plan("pas de json", &sh, "p", 2026, 1, false).cases.is_empty());
    }

    #[test]
    fn criterion_reports_and_the_score_are_read() {
        let json = r#"{"id": "Criterion v2.4.2", "test_suites": [{"name": "my_strlen", "tests": [{"name": "a", "status": "PASSED", "messages": []}, {"name": "b", "status": "FAILED", "messages": ["test.c:4: Assertion Failed"]}]}]}"#;
        let p = parse_criterion_json(json);
        assert_eq!(p[1], ("my_strlen::b".into(), "FAILED".into(), vec!["test.c:4: Assertion Failed".into()]));
        let r = |s: &str, o: &str| CaseResult { status: s.into(), origin: o.into(), ..Default::default() };
        // The moulinette's own failures and skipped tests do not count against the program.
        assert_eq!(score(&[r("passed", "program"), r("failed", "program"), r("mouli_error", "mouli"), r("skipped", "program")]), Some(50.0));
        assert_eq!(score(&[]), None);
    }

    #[test]
    fn export_never_replaces_a_file() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("tests")).unwrap();
        std::fs::write(dir.path().join("tests/test_a.c"), "mine").unwrap();
        let files = vec![criterion::TestFile { name: "test_a.c".into(), content: "new".into(), tests: vec![] }, criterion::TestFile { name: "test_b.c".into(), content: "b".into(), tests: vec![] }];
        let out = export(dir.path(), &files, &["test_a.c".into(), "test_b.c".into()]).unwrap();
        assert_eq!(out["written"], json!(["tests/test_b.c"]));
        assert_eq!(out["kept"], json!(["tests/test_a.c"]));
        assert_eq!(std::fs::read_to_string(dir.path().join("tests/test_a.c")).unwrap(), "mine");
    }

    #[test]
    fn a_real_project_is_built_and_judged_in_the_sandbox() {
        if crate::toolenv::which("gcc").is_none() || crate::toolenv::which("make").is_none() || sandbox::check().is_err() {
            return;
        }
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path().join("proj");
        std::fs::create_dir_all(repo.join("include")).unwrap();
        std::fs::write(repo.join("Makefile"), "NAME = count\nall:\n\tgcc -Iinclude -o $(NAME) main.c count.c\n").unwrap();
        std::fs::write(repo.join("include/my.h"), "int count(char const *s);\n").unwrap();
        // A bug on purpose: an empty string counts as 1.
        std::fs::write(repo.join("count.c"), "#include \"my.h\"\nint count(char const *s)\n{\n    int n = 0;\n    if (!*s)\n        return 1;\n    while (s[n])\n        n++;\n    return n;\n}\n").unwrap();
        std::fs::write(repo.join("main.c"), "#include <stdio.h>\n#include \"my.h\"\nint main(int ac, char **av)\n{\n    if (ac != 2)\n        return 84;\n    printf(\"%d\\n\", count(av[1]));\n    return 0;\n}\n").unwrap();
        let db = std::sync::Arc::new(std::sync::Mutex::new(crate::db::open_in_memory().unwrap()));
        let sh = shape(&repo);
        assert!(sh.functions.contains("count") && sh.link == ["count.c"]);
        let cases = vec![
            Case { id: "io-1".into(), category: "fonctionnel".into(), kind: "io".into(), title: "hello".into(), args: vec!["hello".into()], expect_stdout: Some("5\n".into()), expect_code: Some(0), enabled: true, ..Default::default() },
            Case { id: "io-2".into(), category: "erreurs".into(), kind: "io".into(), title: "sans argument".into(), expect_code: Some(84), enabled: true, ..Default::default() },
            Case { id: "io-3".into(), category: "limites".into(), kind: "io".into(), title: "vide".into(), args: vec!["".into()], expect_stdout: Some("0\n".into()), enabled: true, ..Default::default() },
        ];
        let mut cases = cases;
        let with_criterion = crate::testing::criterion_installed();
        let mut files = Vec::new();
        if with_criterion {
            let u = |id: &str, name: &str, body: &str| Case { id: id.into(), category: "limites".into(), kind: "unit".into(), title: name.into(), target: Some("count".into()), suite: Some("count".into()), name: Some(name.into()), body: Some(body.into()), enabled: true, ..Default::default() };
            cases.push(u("u-1", "count_abc_returns_three", "cr_assert_eq(count(\"abc\"), 3);"));
            cases.push(u("u-2", "count_empty_returns_zero", "cr_assert_eq(count(\"\"), 0);"));
            let tests: Vec<criterion::UnitTest> = cases.iter().filter(|c| c.kind == "unit").map(|c| criterion::UnitTest { suite: "count".into(), name: c.name.clone().unwrap(), target: "count".into(), body: c.body.clone().unwrap() }).collect();
            files = criterion::assemble("proj", 2026, &tests, &["my.h".into()]);
        }
        let suite = Suite { cases, files, created_at: 1, ..Default::default() };
        save_suite(&db.lock().unwrap(), &repo.to_string_lossy(), &suite, 1).unwrap();
        let jobs = crate::jobs::Jobs::default();
        let cache = tmp.path().join("cache");
        let (db2, repo2) = (db.clone(), repo.clone());
        let id = jobs.start(db.clone(), "mouli", None, "t".into(), RUN_STEPS, move |job| run_in_job(job, &db2, &repo2, &cache, None));
        let v = loop {
            let v = jobs.get(id).unwrap();
            if v.status != "running" && v.run_id.is_some() {
                break v;
            }
            std::thread::sleep(Duration::from_millis(100));
        };
        let report: Report = v.summary.get("report").cloned().and_then(|r| serde_json::from_value(r).ok()).unwrap_or_default();
        assert!(v.summary.contains_key("report"), "{} {}\n{}", v.status, v.summary.get("error").map(|e| e.to_string()).unwrap_or_default(), v.log);
        let st: Vec<(&str, &str)> = report.results.iter().map(|r| (r.id.as_str(), r.status.as_str())).collect();
        if with_criterion {
            assert_eq!(st, [("io-1", "passed"), ("io-2", "passed"), ("io-3", "failed"), ("u-1", "passed"), ("u-2", "failed")], "{}\n{:?}", v.log, report.results.iter().map(|r| &r.detail).collect::<Vec<_>>());
            assert_eq!(report.score, Some(60.0));
        } else {
            assert_eq!(st, [("io-1", "passed"), ("io-2", "passed"), ("io-3", "failed")], "{}", v.log);
            assert_eq!(report.score, Some(66.7));
        }
        assert_eq!(report.results[2].got.as_deref(), Some("1\n"));
        // The project itself is untouched.
        assert!(!repo.join("count").exists());
    }
}
