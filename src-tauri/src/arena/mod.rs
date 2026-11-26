//! Algorithm Arena: measures how fast programs are, how their cost grows with the size of
//! the data, and where the time goes — on throwaway copies, never on the project itself.
//!
//! A benchmark has one or two variants (the working tree, a branch, a commit, a Playground
//! draft), scenarios (a data generator, sizes, a seed, the program's arguments) and options.
//! The job copies each variant, builds it, generates the inputs once (same data for every
//! variant), runs every size several times through a microsecond helper, then profiles with
//! Callgrind / Massif / Memcheck when Valgrind is there. Everything runs in the sandbox. A
//! tool that is missing makes its step "skipped": no value is ever made up.

pub mod ai;
pub mod fit;
pub mod heuristics;
pub mod measure;

use crate::ai::sandbox::{self, Limits};
use crate::error::{AppError, Result};
use crate::jobs::{Job, RunOpts};
use crate::playground::{DraftFile, DraftSettings};
use measure::{Callgrind, Heap, Sample, Stats};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Source {
    /// A project folder: its working tree, or a branch / commit read with `git archive`
    /// (the working tree and `.git` are not touched).
    #[serde(rename_all = "camelCase")]
    Project { path: String, rev: Option<String> },
    /// A Playground draft.
    #[serde(rename_all = "camelCase")]
    Draft { id: i64 },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Variant {
    pub label: String,
    pub source: Source,
    /// Build command run in the copy (`make` for a project, the Playground compiler for a
    /// draft when empty).
    #[serde(default)]
    pub build: String,
    /// The program to measure, relative to the copy (`./sort`). Empty: the draft's program.
    #[serde(default)]
    pub program: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Scenario {
    pub name: String,
    /// A file of the benchmark (`gen.py` or `gen.c`) called as `gen N SEED OUTPUT`.
    #[serde(default)]
    pub generator: Option<String>,
    pub sizes: Vec<u64>,
    #[serde(default = "default_seed")]
    pub seed: u64,
    /// Program arguments, without a shell; `{input}`, `{n}` and `{seed}` are replaced.
    #[serde(default)]
    pub args: String,
    /// Give the input on standard input instead of as a file name.
    #[serde(default)]
    pub stdin: bool,
}

fn default_seed() -> u64 {
    42
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Options {
    pub repeats: u32,
    pub warmup: bool,
    pub callgrind: bool,
    pub massif: bool,
    pub heap: bool,
    pub timeout_s: u64,
    pub mem_mb: u64,
}

impl Default for Options {
    fn default() -> Self {
        Options { repeats: 5, warmup: true, callgrind: true, massif: true, heap: true, timeout_s: 30, mem_mb: 1024 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BenchConfig {
    pub name: String,
    pub variants: Vec<Variant>,
    pub scenarios: Vec<Scenario>,
    /// Generators and helper files written in `bench/` (shown before anything runs).
    #[serde(default)]
    pub files: Vec<DraftFile>,
    #[serde(default)]
    pub options: Options,
    /// Artix's reading of the code when it prepared the benchmark (hypotheses, not
    /// measurements), kept with it so the results can show them.
    #[serde(default)]
    pub hypotheses: Vec<ai::AiHypothesis>,
}

pub fn validate(c: &BenchConfig) -> Result<()> {
    let bad = |m: &str| Err(AppError::new("invalid_bench", m.to_string()));
    if c.variants.is_empty() || c.variants.len() > 2 {
        return bad("Un benchmark compare une ou deux variantes");
    }
    if c.scenarios.is_empty() || c.scenarios.len() > 6 {
        return bad("Entre 1 et 6 scénarios");
    }
    for s in &c.scenarios {
        if s.sizes.is_empty() || s.sizes.len() > 12 {
            return bad("Entre 1 et 12 tailles par scénario");
        }
        if s.sizes.iter().any(|n| *n == 0 || *n > 1_000_000_000) {
            return bad("Les tailles vont de 1 à 1 000 000 000");
        }
        if let Some(g) = &s.generator {
            if !c.files.iter().any(|f| &f.name == g) {
                return Err(AppError::new("invalid_bench", format!("Le générateur « {g} » n'est pas dans les fichiers du benchmark")));
            }
            if !(g.ends_with(".py") || g.ends_with(".c")) {
                return bad("Un générateur est un fichier .py ou .c");
            }
        } else if s.args.contains("{input}") || s.stdin {
            return Err(AppError::new("invalid_bench", format!("« {} » utilise une entrée mais n'a pas de générateur", s.name)));
        }
        crate::jobs::split_command(&s.args)?;
    }
    if c.options.repeats == 0 || c.options.repeats > 30 {
        return bad("Entre 1 et 30 répétitions");
    }
    if !c.files.is_empty() {
        crate::playground::validate(&c.files)?;
    }
    for v in &c.variants {
        if !v.build.trim().is_empty() {
            crate::jobs::split_command(&v.build)?;
        }
        if !v.program.is_empty() {
            crate::library::safe_rel(v.program.trim_start_matches("./"))?;
        }
    }
    Ok(())
}

// ───────────────────────────── saved benchmarks ─────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub id: i64,
    pub config: BenchConfig,
    pub updated_at: i64,
}

pub fn list(conn: &Connection) -> Result<Vec<Saved>> {
    let mut st = conn.prepare("SELECT id, config, updated_at FROM arena_benchmarks ORDER BY updated_at DESC LIMIT 100")?;
    let rows = st.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?)))?;
    let mut out = Vec::new();
    for row in rows {
        let (id, config, updated_at) = row?;
        if let Ok(config) = serde_json::from_str(&config) {
            out.push(Saved { id, config, updated_at });
        }
    }
    Ok(out)
}

pub fn save(conn: &Connection, id: Option<i64>, config: &BenchConfig, now: i64) -> Result<Saved> {
    validate(config)?;
    let text = serde_json::to_string(config)?;
    let id = match id {
        Some(id) if conn.execute("UPDATE arena_benchmarks SET config = ?2, updated_at = ?3 WHERE id = ?1", params![id, text, now])? > 0 => id,
        _ => {
            conn.execute("INSERT INTO arena_benchmarks (config, created_at, updated_at) VALUES (?1, ?2, ?2)", params![text, now])?;
            conn.last_insert_rowid()
        }
    };
    Ok(Saved { id, config: config.clone(), updated_at: now })
}

pub fn delete(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM arena_benchmarks WHERE id = ?1", [id])?;
    Ok(())
}

pub fn get_saved(conn: &Connection, id: i64) -> Result<Option<BenchConfig>> {
    let text: Option<String> = conn.query_row("SELECT config FROM arena_benchmarks WHERE id = ?1", [id], |r| r.get(0)).optional()?;
    Ok(text.and_then(|t| serde_json::from_str(&t).ok()))
}

// ───────────────────────────── results ─────────────────────────────

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    pub n: u64,
    pub samples: Vec<Sample>,
    /// Milliseconds.
    pub wall: Option<Stats>,
    pub cpu: Option<Stats>,
    /// Peak resident memory (median of the runs), kilobytes.
    pub max_rss_kb: Option<u64>,
    /// Instructions executed (Callgrind), when profiled.
    pub ir: Option<u64>,
    pub failed: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Series {
    pub variant: usize,
    pub scenario: usize,
    pub points: Vec<Point>,
    pub fit_time: Option<fit::Fit>,
    pub fit_ir: Option<fit::Fit>,
    pub hot: Option<Callgrind>,
    /// Size the profile (hot functions, heap) was taken at.
    pub profiled_n: Option<u64>,
    pub heap_peak: Option<u64>,
    pub heap: Option<Heap>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputPreview {
    pub scenario: usize,
    pub n: u64,
    pub bytes: u64,
    pub head: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Results {
    pub config: Option<BenchConfig>,
    pub variants: Vec<String>,
    pub series: Vec<Series>,
    pub hypotheses: Vec<heuristics::Hypothesis>,
    pub inputs: Vec<InputPreview>,
    /// What could not be measured, and why.
    pub notes: Vec<String>,
    pub machine: Value,
    /// The profiling run in progress (tool, size, limit, start), so a long Valgrind run is
    /// visibly alive and its limit known.
    pub current: Option<Value>,
}

fn publish(job: &Job, r: &Results, event: Value) {
    job.set("arena", r);
    job.event(event);
}

fn sh_join(argv: &[String]) -> String {
    argv.iter().map(|a| sandbox::shell_quote(a)).collect::<Vec<_>>().join(" ")
}

/// Runs `argv` in the sandbox with `root` writable. `None` when the time limit stopped it.
fn exec(job: &Job, root: &Path, argv: &[String], stdin: Option<&Path>, limits: &Limits, log: bool) -> Result<crate::jobs::Outcome> {
    let wrapped = sandbox::wrap_argv(root, argv, &[], limits)?;
    if log {
        job.log(&format!("$ {}", sh_join(argv)));
    }
    job.run_opts(&RunOpts { argv: &wrapped, cwd: root, timeout: limits.wall, envs: &[], log_output: log, stdin, split_streams: true }, &mut |_| {})
}

fn tail(s: &str, n: usize) -> String {
    let lines: Vec<&str> = s.lines().collect();
    lines[lines.len().saturating_sub(n)..].join("\n")
}

fn machine() -> Value {
    let cpu = std::fs::read_to_string("/proc/cpuinfo").ok().and_then(|c| c.lines().find(|l| l.starts_with("model name")).and_then(|l| l.split(':').nth(1)).map(|s| s.trim().to_string()));
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1);
    let load = std::fs::read_to_string("/proc/loadavg").ok().and_then(|l| l.split_whitespace().next().map(str::to_string));
    json!({ "cpu": cpu, "cores": cores, "load": load })
}

/// Copies a variant's sources into `dest`.
pub fn prepare_variant(conn: &std::sync::Mutex<Connection>, v: &Variant, dest: &Path, roots: &[String]) -> Result<(Vec<String>, Option<DraftSettings>)> {
    match &v.source {
        Source::Draft { id } => {
            let draft = crate::playground::get(&conn.lock().unwrap_or_else(|e| e.into_inner()), *id)?;
            crate::playground::materialize(&draft.files, dest)?;
            Ok((draft.files.iter().filter(|f| f.name.ends_with(".c")).map(|f| f.name.clone()).collect(), Some(draft.settings)))
        }
        Source::Project { path, rev } => {
            let repo = std::fs::canonicalize(path).map_err(|_| AppError::new("invalid_target", format!("{path} n'existe plus")))?;
            if !crate::settings::is_inside_any(&repo, roots) {
                return Err(AppError::new("outside_roots", "Ce projet n'est dans aucun de tes dossiers de projets"));
            }
            match rev.as_deref().filter(|r| !r.trim().is_empty()) {
                None => {
                    crate::ai::workcopy::copy(&repo, dest)?;
                }
                Some(rev) => {
                    if rev.starts_with('-') || rev.contains("..") || rev.chars().any(char::is_whitespace) {
                        return Err(AppError::new("invalid_rev", "Révision invalide"));
                    }
                    let commit = crate::git::run(Some(&repo), &["rev-parse", "--verify", "--quiet", &format!("{rev}^{{commit}}")]).map_err(|_| AppError::new("invalid_rev", format!("« {rev} » n'est ni une branche ni un commit de ce dépôt")))?;
                    let commit = commit.trim().to_string();
                    std::fs::create_dir_all(dest)?;
                    let tar = dest.with_extension("tar");
                    crate::git::run(Some(&repo), &["archive", "--format=tar", "-o", &tar.to_string_lossy(), &commit]).map_err(|e| AppError::new("git_failed", format!("git archive : {e}")))?;
                    let ok = crate::toolenv::command("tar").args(["-xf", &tar.to_string_lossy(), "-C", &dest.to_string_lossy(), "--no-same-owner", "--no-same-permissions"]).stdin(std::process::Stdio::null()).status().is_ok_and(|s| s.success());
                    let _ = std::fs::remove_file(&tar);
                    if !ok {
                        return Err(AppError::new("tar_failed", "Extraction de la révision impossible"));
                    }
                }
            }
            Ok((Vec::new(), None))
        }
    }
}

/// C files of a folder (for the static analysis), relative names.
fn c_files(dir: &Path) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            let Ok(meta) = std::fs::symlink_metadata(&p) else { continue };
            if meta.is_dir() && !e.file_name().to_string_lossy().starts_with('.') {
                stack.push(p);
            } else if meta.is_file() && p.extension().is_some_and(|x| x == "c") && meta.len() < 512 * 1024 && out.len() < 300 {
                if let (Ok(text), Ok(rel)) = (std::fs::read_to_string(&p), p.strip_prefix(dir)) {
                    out.push((rel.to_string_lossy().into_owned(), text));
                }
            }
        }
    }
    out.sort();
    out
}

fn substitute(args: &str, input: Option<&Path>, n: u64, seed: u64) -> Result<Vec<String>> {
    let words = if args.trim().is_empty() { Vec::new() } else { crate::jobs::split_command(args)? };
    Ok(words.into_iter().map(|w| w.replace("{input}", &input.map(|p| p.to_string_lossy().into_owned()).unwrap_or_default()).replace("{n}", &n.to_string()).replace("{seed}", &seed.to_string())).collect())
}

/// How much slower a program runs under Valgrind, for estimates (Callgrind: 20–100×).
const VALGRIND_SLOWDOWN: f64 = 60.0;

/// Estimated duration of one Valgrind run for a program measured at `wall_ms`.
fn profile_estimate(wall_ms: f64) -> Duration {
    Duration::from_secs_f64((wall_ms / 1000.0) * VALGRIND_SLOWDOWN + 1.5)
}

/// Time limit of one Valgrind run: three times the estimate, within [10 s, cap].
fn profile_limit(wall_ms: f64, cap: Duration) -> Duration {
    (profile_estimate(wall_ms) * 3).clamp(Duration::from_secs(10), cap.max(Duration::from_secs(10)))
}

/// Time given to the profiling of one series (variant × scenario): the whole step stays
/// under ten minutes, each series gets at least 30 s.
fn profile_budget(timeout_s: u64, series: usize) -> Duration {
    let total = (timeout_s * 10).clamp(120, 600);
    Duration::from_secs((total / series.max(1) as u64).max(30))
}

/// Memory ceiling under Valgrind: it adds its own overhead to the program's (measured) peak.
fn valgrind_mem_mb(rss_kb: u64, mem_mb: u64) -> u64 {
    (rss_kb / 1024 * 4 + 768).clamp(768, (mem_mb * 4).clamp(1024, 16384))
}

fn measure_limits(o: &Options) -> Limits {
    Limits { wall: Duration::from_secs(o.timeout_s.clamp(1, 600)), cpu_seconds: o.timeout_s.clamp(1, 600) + 1, file_mb: 2048, output_cap: 64 * 1024, mem_mb: Some(o.mem_mb.clamp(64, 16384)), tasks: Some(128), address_space_free: false }
}

/// The whole benchmark, as a job. Steps: prepare, build, generate, measure, profile, analyze.
pub fn run_in_job(job: &Job, db: &std::sync::Mutex<Connection>, config: &BenchConfig, root: &Path, roots: &[String]) -> Result<&'static str> {
    validate(config)?;
    let o = &config.options;
    let mut r = Results { config: Some(config.clone()), variants: config.variants.iter().map(|v| v.label.clone()).collect(), machine: machine(), ..Default::default() };
    for (vi, _) in config.variants.iter().enumerate() {
        for (si, _) in config.scenarios.iter().enumerate() {
            r.series.push(Series { variant: vi, scenario: si, ..Default::default() });
        }
    }
    let series_of = |r: &mut Results, v: usize, s: usize| -> usize { r.series.iter().position(|x| x.variant == v && x.scenario == s).unwrap_or(0) };
    let tb = root.join(".tb");
    let bench = root.join("bench");
    let data = root.join("data");
    std::fs::create_dir_all(&tb)?;
    std::fs::create_dir_all(&data)?;

    // ── prepare
    job.start("prepare");
    let mut dirs: Vec<PathBuf> = Vec::new();
    let mut drafts: Vec<Option<(Vec<String>, DraftSettings)>> = Vec::new();
    for (i, v) in config.variants.iter().enumerate() {
        let dest = root.join(format!("v{i}"));
        let (sources, settings) = prepare_variant(db, v, &dest, roots)?;
        job.log(&format!("{} : copie prête dans {}", v.label, dest.display()));
        dirs.push(dest);
        drafts.push(settings.map(|s| (sources, s)));
    }
    if !config.files.is_empty() {
        crate::playground::materialize(&config.files, &bench)?;
        for f in &config.files {
            job.event(json!({"kind": "arena", "type": "file", "name": format!("bench/{}", f.name), "bytes": f.content.len()}));
        }
    }
    std::fs::write(tb.join("measure.c"), measure::HELPER)?;
    let mut read: Vec<(String, heuristics::Hypothesis)> = Vec::new();
    for (i, d) in dirs.iter().enumerate() {
        // Functions imported from TekBoard's libraries into a draft are library code too.
        let imported: Vec<String> = match &config.variants[i].source {
            Source::Draft { id } => crate::playground::get(&db.lock().unwrap_or_else(|e| e.into_inner()), *id).map(|d| d.files.into_iter().filter(|f| f.library.is_some()).map(|f| f.name).collect()).unwrap_or_default(),
            Source::Project { .. } => Vec::new(),
        };
        let label = if config.variants.len() > 1 { config.variants[i].label.clone() } else { String::new() };
        for (rel, text) in c_files(d) {
            for mut h in heuristics::analyze(&text, &rel) {
                if imported.contains(&rel) {
                    h.scope = "library".into();
                }
                read.push((label.clone(), h));
            }
        }
    }
    for a in &config.hypotheses {
        let scope = if heuristics::is_library(&a.file) { "library" } else { "project" };
        read.push((String::new(), heuristics::Hypothesis { file: a.file.clone(), function: a.function.clone(), line: a.line.unwrap_or(0) as usize, kind: "artix".into(), weight: "medium".into(), message: a.message.clone(), provenance: "artix".into(), scope: scope.into(), seen_in: Vec::new(), count: 1 }));
    }
    r.hypotheses = heuristics::dedupe(read);
    publish(job, &r, json!({"kind": "arena", "type": "phase", "phase": "prepare"}));
    job.end("prepare", "success", Some(format!("{} variante(s), {} hypothèse(s) de lecture", dirs.len(), r.hypotheses.len())));

    // ── build
    job.start("build");
    let build_limits = Limits { wall: Duration::from_secs(300), cpu_seconds: 600, file_mb: 1024, output_cap: 64 * 1024, mem_mb: Some(4096), tasks: Some(256), address_space_free: false };
    let cc = if crate::toolenv::which("gcc").is_some() { "gcc" } else { "cc" };
    let helper = tb.join("measure");
    let out = exec(job, root, &[cc.into(), "-O2".into(), "-o".into(), helper.to_string_lossy().into_owned(), tb.join("measure.c").to_string_lossy().into_owned()], None, &build_limits, true)?;
    if !out.ok() {
        job.end("build", "failed", Some("l'outil de mesure ne compile pas".into()));
        return Err(AppError::new("build_failed", format!("Compilation de l'outil de mesure impossible :\n{}", tail(&out.output, 20))));
    }
    let mut programs: Vec<PathBuf> = Vec::new();
    for (i, v) in config.variants.iter().enumerate() {
        let d = &dirs[i];
        let (argv, program) = match (&drafts[i], v.build.trim().is_empty()) {
            (Some((_, settings)), true) => {
                let files = crate::playground::get(&db.lock().unwrap_or_else(|e| e.into_inner()), match v.source { Source::Draft { id } => id, _ => 0 })?.files;
                let s = DraftSettings { asan: false, ubsan: false, valgrind: false, flags: format!("{} -O2 -g", settings.flags.split_whitespace().filter(|f| !f.starts_with("-O") && !f.starts_with("-fsanitize")).collect::<Vec<_>>().join(" ")), ..settings.clone() };
                (crate::playground::compile_argv(&files, &s, ".tekboard-prog")?, ".tekboard-prog".to_string())
            }
            _ => (crate::jobs::split_command(if v.build.trim().is_empty() { "make" } else { &v.build })?, v.program.trim().trim_start_matches("./").to_string()),
        };
        let mut full = vec!["env".to_string(), "-C".into(), d.to_string_lossy().into_owned()];
        full.extend(argv);
        let out = exec(job, root, &full, None, &build_limits, true)?;
        if out.cancelled {
            return Ok("cancelled");
        }
        if !out.ok() {
            job.end("build", "failed", Some(format!("{} ne compile pas", v.label)));
            return Err(AppError::new("build_failed", format!("{} ne compile pas :\n{}", v.label, tail(&out.output, 30))));
        }
        let program = if program.is_empty() { crate::runner::detect(d).map(|(p, _)| p).unwrap_or_default() } else { program };
        let path = d.join(&program);
        if program.is_empty() || !path.is_file() {
            job.end("build", "failed", Some(format!("programme de {} introuvable", v.label)));
            return Err(AppError::new("no_program", format!("{} : programme introuvable après la compilation{}. Indique son chemin dans la variante.", v.label, if program.is_empty() { String::new() } else { format!(" ({program})") })));
        }
        programs.push(path);
    }
    job.end("build", "success", Some(format!("{} programme(s)", programs.len())));

    // ── generate (the same data for every variant)
    job.start("generate");
    let gen_limits = Limits { wall: Duration::from_secs(120), cpu_seconds: 240, file_mb: 4096, output_cap: 64 * 1024, mem_mb: Some(4096), tasks: Some(64), address_space_free: false };
    let mut inputs: Vec<Vec<Option<PathBuf>>> = Vec::new();
    let mut generated = 0;
    for (si, s) in config.scenarios.iter().enumerate() {
        let mut per = Vec::new();
        let Some(gen) = &s.generator else {
            inputs.push(vec![None; s.sizes.len()]);
            continue;
        };
        let gen_path = bench.join(gen);
        let mut base: Vec<String> = if gen.ends_with(".py") {
            if crate::toolenv::which("python3").is_none() {
                job.end("generate", "failed", Some("python3 manquant".into()));
                return Err(AppError::new("command_missing", "python3 est nécessaire pour ce générateur (voir Doctor)"));
            }
            vec!["python3".into(), gen_path.to_string_lossy().into_owned()]
        } else {
            let bin = tb.join(format!("gen{si}"));
            let out = exec(job, root, &[cc.into(), "-O2".into(), "-o".into(), bin.to_string_lossy().into_owned(), gen_path.to_string_lossy().into_owned(), "-lm".into()], None, &build_limits, true)?;
            if !out.ok() {
                job.end("generate", "failed", Some(format!("{gen} ne compile pas")));
                return Err(AppError::new("build_failed", format!("Le générateur {gen} ne compile pas :\n{}", tail(&out.output, 20))));
            }
            vec![bin.to_string_lossy().into_owned()]
        };
        for &n in &s.sizes {
            let file = data.join(format!("s{si}-n{n}.txt"));
            let mut argv = base.clone();
            argv.extend([n.to_string(), s.seed.to_string(), file.to_string_lossy().into_owned()]);
            let out = exec(job, root, &argv, None, &gen_limits, false)?;
            if out.cancelled {
                return Ok("cancelled");
            }
            if !out.ok() || !file.is_file() {
                job.log(&format!("Générateur {gen} {n} : échec\n{}", tail(&out.output, 10)));
                per.push(None);
                continue;
            }
            let bytes = std::fs::metadata(&file).map(|m| m.len()).unwrap_or(0);
            let head = std::fs::read(&file).map(|b| String::from_utf8_lossy(&b[..b.len().min(400)]).into_owned()).unwrap_or_default();
            r.inputs.push(InputPreview { scenario: si, n, bytes, head });
            publish(job, &r, json!({"kind": "arena", "type": "input", "scenario": si, "n": n, "bytes": bytes}));
            generated += 1;
            per.push(Some(file));
        }
        base.clear();
        inputs.push(per);
    }
    if config.scenarios.iter().all(|s| s.generator.is_none()) {
        job.skip("generate", "aucun générateur : les tailles sont passées en argument");
    } else {
        job.end("generate", "success", Some(format!("{generated} fichier(s) de données")));
    }

    // ── measure
    job.start("measure");
    let limits = measure_limits(o);
    let mut measured = 0;
    for (vi, prog) in programs.iter().enumerate() {
        for (si, s) in config.scenarios.iter().enumerate() {
            let k = series_of(&mut r, vi, si);
            let mut stop: Option<String> = None;
            for (ni, &n) in s.sizes.iter().enumerate() {
                let input = inputs[si][ni].as_deref();
                let mut point = Point { n, ..Default::default() };
                if let Some(why) = &stop {
                    point.failed = Some(why.clone());
                    r.series[k].points.push(point);
                    continue;
                }
                if s.generator.is_some() && input.is_none() {
                    point.failed = Some("données non générées".into());
                    r.series[k].points.push(point);
                    continue;
                }
                let args = substitute(&s.args, input, n, s.seed)?;
                let out_file = tb.join(format!("m-{vi}-{si}-{n}.txt"));
                let stdin_arg = if s.stdin { input.map(|p| p.to_string_lossy().into_owned()).unwrap_or("-".into()) } else { "-".into() };
                let mut argv = vec![helper.to_string_lossy().into_owned(), out_file.to_string_lossy().into_owned(), dirs[vi].to_string_lossy().into_owned(), stdin_arg, prog.to_string_lossy().into_owned()];
                argv.extend(args);
                let runs = o.repeats as usize + usize::from(o.warmup);
                for run in 0..runs {
                    let _ = std::fs::remove_file(&out_file);
                    let out = exec(job, root, &argv, None, &limits, false)?;
                    if out.cancelled {
                        publish(job, &r, json!({"kind": "arena", "type": "cancelled"}));
                        return Ok("cancelled");
                    }
                    if out.timed_out {
                        point.failed = Some(format!("plus de {} s", limits.wall.as_secs()));
                        stop = Some(format!("taille précédente déjà au-delà de {} s", limits.wall.as_secs()));
                        break;
                    }
                    let Some(sample) = std::fs::read_to_string(&out_file).ok().and_then(|t| measure::parse_sample(&t)) else {
                        point.failed = Some(format!("mesure impossible : {}", tail(&out.output, 3)));
                        break;
                    };
                    if sample.signal != 0 || sample.exit != 0 {
                        point.failed = Some(if sample.signal != 0 { format!("tué par {}", sandbox::signal_name(sample.signal)) } else { format!("code de sortie {}", sample.exit) });
                        if sample.signal == 9 {
                            stop = Some("limite mémoire atteinte à une taille plus petite".into());
                        }
                        break;
                    }
                    if run == 0 && o.warmup {
                        continue;
                    }
                    point.samples.push(sample);
                }
                if point.failed.is_none() && !point.samples.is_empty() {
                    let wall: Vec<f64> = point.samples.iter().map(|s| s.wall_us as f64 / 1000.0).collect();
                    let cpu: Vec<f64> = point.samples.iter().map(|s| (s.user_us + s.sys_us) as f64 / 1000.0).collect();
                    let rss: Vec<f64> = point.samples.iter().map(|s| s.max_rss_kb as f64).collect();
                    point.wall = Some(measure::stats(&wall));
                    point.cpu = Some(measure::stats(&cpu));
                    point.max_rss_kb = Some(measure::median(&rss) as u64);
                    measured += 1;
                }
                job.log(&format!("{} · {} · n={n} : {}", config.variants[vi].label, s.name, match (&point.failed, &point.wall) {
                    (Some(f), _) => format!("échec ({f})"),
                    (None, Some(w)) => format!("{:.3} ms (médiane de {}, écart {:.3})", w.median, point.samples.len(), w.mad),
                    _ => "—".into(),
                }));
                r.series[k].points.push(point);
                publish(job, &r, json!({"kind": "arena", "type": "point", "variant": vi, "scenario": si, "n": n}));
            }
        }
    }
    job.end("measure", if measured > 0 { "success" } else { "failed" }, Some(format!("{measured} point(s) mesuré(s)")));
    if measured == 0 {
        return Ok("failed");
    }

    // ── profile
    job.start("profile");
    let valgrind = crate::toolenv::which("valgrind").is_some();
    if !valgrind {
        r.notes.push("Valgrind n'est pas installé : pas d'instructions par fonction, de pic de tas ni de nombre d'allocations (voir Doctor).".into());
        job.skip("profile", "Valgrind absent");
    } else if !(o.callgrind || o.massif || o.heap) {
        job.skip("profile", "désactivé dans les options");
    } else {
        let annotate = crate::toolenv::which("callgrind_annotate").is_some();
        // Valgrind slows a program down 20 to 100 times. Profiling every size with a long
        // limit each made this step last hours and look frozen: each series now gets a share
        // of one budget, sizes go up only while the estimate fits, and the screen shows what
        // runs and for how long.
        let budget = profile_budget(o.timeout_s, programs.len() * config.scenarios.len());
        let cap = Duration::from_secs((o.timeout_s * 30).clamp(30, 300));
        let annotate_limits = Limits { wall: Duration::from_secs(90), cpu_seconds: 120, file_mb: 256, output_cap: 64 * 1024, mem_mb: Some(1024), tasks: Some(16), address_space_free: false };
        for (vi, prog) in programs.iter().enumerate() {
            for (si, s) in config.scenarios.iter().enumerate() {
                let k = series_of(&mut r, vi, si);
                let ok_sizes: Vec<(usize, u64, f64, u64)> = r.series[k].points.iter().enumerate().filter(|(_, p)| p.failed.is_none()).filter_map(|(i, p)| p.wall.as_ref().map(|w| (i, p.n, w.median, p.max_rss_kb.unwrap_or(0)))).collect();
                let mut largest: Option<(usize, u64)> = None;
                let series_start = std::time::Instant::now();
                let left = |budget: Duration| budget.saturating_sub(series_start.elapsed());
                // Program output is not needed here (only Valgrind's, on stderr): it goes to
                // /dev/null instead of a file read back while the program runs.
                let run_tool = |r: &mut Results, tool: &str, tool_args: Vec<String>, ni: usize, n: u64, wall_ms: f64, rss_kb: u64| -> Result<crate::jobs::Outcome> {
                    let input = inputs[si][ni].as_deref();
                    let limit = profile_limit(wall_ms, cap);
                    let mut argv = vec!["sh".to_string(), "-c".into(), "exec \"$@\" >/dev/null".into(), "sh".into(), "env".into(), "-C".into(), dirs[vi].to_string_lossy().into_owned(), "valgrind".into()];
                    argv.extend(tool_args);
                    argv.push(prog.to_string_lossy().into_owned());
                    argv.extend(substitute(&s.args, input, n, s.seed)?);
                    let limits = Limits { wall: limit, cpu_seconds: limit.as_secs() + 1, file_mb: 2048, output_cap: 64 * 1024, mem_mb: Some(valgrind_mem_mb(rss_kb, o.mem_mb)), tasks: Some(128), address_space_free: true };
                    r.current = Some(json!({"tool": tool, "variant": vi, "scenario": si, "n": n, "limitS": limit.as_secs(), "startedAt": crate::commands::now()}));
                    publish(job, r, json!({"kind": "arena", "type": "profiling", "tool": tool, "variant": vi, "scenario": si, "n": n}));
                    job.log(&format!("{tool} · {} · {} · n={n} (limite {} s)", config.variants[vi].label, s.name, limit.as_secs()));
                    let out = exec(job, root, &argv, if s.stdin { input } else { None }, &limits, false);
                    r.current = None;
                    out
                };
                if o.callgrind {
                    for &(ni, n, wall_ms, rss_kb) in &ok_sizes {
                        if profile_estimate(wall_ms) > left(budget) {
                            r.notes.push(format!("Callgrind s'est arrêté avant n={n} pour {} ({}) : la taille suivante dépasserait le temps prévu pour le profilage. Le détail par fonction vient de la plus grande taille profilée.", config.variants[vi].label, s.name));
                            break;
                        }
                        let out_file = tb.join(format!("cg-{vi}-{si}-{n}.out"));
                        let out = run_tool(&mut r, "Callgrind", vec!["--tool=callgrind".into(), format!("--callgrind-out-file={}", out_file.display())], ni, n, wall_ms, rss_kb)?;
                        if out.cancelled {
                            publish(job, &r, json!({"kind": "arena", "type": "cancelled"}));
                            return Ok("cancelled");
                        }
                        if out.timed_out || !out_file.is_file() {
                            r.notes.push(format!("Callgrind arrêté à n={n} pour {} ({}) : {}.", config.variants[vi].label, s.name, if out.timed_out { "limite de temps atteinte" } else { "pas de profil écrit (mémoire ?)" }));
                            break;
                        }
                        // callgrind_annotate is a Perl script, slow on big profiles: it runs in
                        // the sandbox like the rest, with a limit, and stops on cancel.
                        let text = if annotate {
                            let a = exec(job, root, &["callgrind_annotate".into(), "--inclusive=no".into(), "--auto=no".into(), out_file.to_string_lossy().into_owned()], None, &annotate_limits, false)?;
                            if a.cancelled {
                                return Ok("cancelled");
                            }
                            a.stdout
                        } else {
                            String::new()
                        };
                        let cg = measure::parse_callgrind(&text, &dirs[vi].to_string_lossy());
                        let ir = cg.total_ir.or_else(|| std::fs::read_to_string(&out_file).ok().and_then(|t| t.lines().find_map(|l| l.strip_prefix("totals:").or_else(|| l.strip_prefix("summary:")).and_then(|v| v.trim().split_whitespace().next()?.parse().ok()))));
                        r.series[k].points[ni].ir = ir;
                        r.series[k].hot = Some(cg);
                        r.series[k].profiled_n = Some(n);
                        largest = Some((ni, n));
                        publish(job, &r, json!({"kind": "arena", "type": "profile", "tool": "callgrind", "variant": vi, "scenario": si, "n": n}));
                    }
                }
                // Heap tools: at the largest size profiled, or the largest whose estimate fits.
                let at = largest
                    .and_then(|(ni, _)| ok_sizes.iter().find(|x| x.0 == ni).copied())
                    .or_else(|| ok_sizes.iter().rev().find(|x| profile_estimate(x.2) * 2 <= left(budget)).copied())
                    .or_else(|| ok_sizes.first().copied());
                let Some((ni, n, wall_ms, rss_kb)) = at else { continue };
                if o.massif {
                    let out_file = tb.join(format!("ms-{vi}-{si}.out"));
                    let out = run_tool(&mut r, "Massif", vec!["--tool=massif".into(), format!("--massif-out-file={}", out_file.display())], ni, n, wall_ms, rss_kb)?;
                    if out.cancelled {
                        publish(job, &r, json!({"kind": "arena", "type": "cancelled"}));
                        return Ok("cancelled");
                    }
                    r.series[k].heap_peak = std::fs::read_to_string(&out_file).ok().and_then(|t| measure::parse_massif_peak(&t));
                }
                if o.heap {
                    let out = run_tool(&mut r, "Memcheck", vec!["--leak-check=no".into()], ni, n, wall_ms, rss_kb)?;
                    if out.cancelled {
                        publish(job, &r, json!({"kind": "arena", "type": "cancelled"}));
                        return Ok("cancelled");
                    }
                    r.series[k].heap = measure::parse_heap_usage(&out.stderr);
                }
                r.series[k].profiled_n.get_or_insert(n);
                publish(job, &r, json!({"kind": "arena", "type": "profile", "tool": "memory", "variant": vi, "scenario": si, "n": n}));
            }
        }
        if o.callgrind && !annotate {
            r.notes.push("callgrind_annotate est absent : instructions totales seulement, sans le détail par fonction.".into());
        }
        job.end("profile", "success", None);
    }

    // ── analyze
    job.start("analyze");
    for s in r.series.iter_mut() {
        let time: Vec<(f64, f64)> = s.points.iter().filter_map(|p| p.wall.as_ref().map(|w| (p.n as f64, w.median))).collect();
        let ir: Vec<(f64, f64)> = s.points.iter().filter_map(|p| p.ir.map(|i| (p.n as f64, i as f64))).collect();
        s.fit_time = (!time.is_empty()).then(|| fit::fit(&time));
        s.fit_ir = (!ir.is_empty()).then(|| fit::fit(&ir));
    }
    if r.series.iter().any(|s| s.points.iter().any(|p| p.wall.as_ref().is_some_and(|w| w.median < 1.0))) {
        r.notes.push("Certaines mesures sont sous la milliseconde : le bruit du système y pèse lourd. Les instructions comptées par Callgrind sont alors plus fiables pour la complexité.".into());
    }
    if r.series.iter().any(|s| s.points.iter().any(|p| p.wall.as_ref().is_some_and(|w| !w.outliers.is_empty()))) {
        r.notes.push("Des exécutions atypiques ont été repérées (plus de 3 écarts robustes de la médiane) : elles sont signalées et la médiane les ignore.".into());
    }
    publish(job, &r, json!({"kind": "arena", "type": "done"}));
    job.end("analyze", "success", None);
    Ok(if r.series.iter().any(|s| s.points.iter().any(|p| p.failed.is_some())) { "warning" } else { "success" })
}

pub const STEPS: &[(&str, &str)] = &[("prepare", "Préparation"), ("build", "Compilation"), ("generate", "Données"), ("measure", "Mesures"), ("profile", "Profilage"), ("analyze", "Analyse")];

#[cfg(test)]
mod tests {
    use super::*;

    fn draft_bench(conn: &std::sync::Mutex<Connection>, code: &str) -> BenchConfig {
        let d = crate::playground::create(&conn.lock().unwrap(), "algo", Some(vec![DraftFile { name: "main.c".into(), content: code.into(), library: None }]), None, 1).unwrap();
        BenchConfig {
            name: "test".into(),
            variants: vec![Variant { label: "A".into(), source: Source::Draft { id: d.id }, build: String::new(), program: String::new() }],
            scenarios: vec![Scenario { name: "aléatoire".into(), generator: Some("gen.py".into()), sizes: vec![200, 400, 800, 1600], seed: 7, args: "{input}".into(), stdin: false }],
            files: vec![DraftFile { name: "gen.py".into(), content: "import random, sys\nn, seed, out = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]\nrandom.seed(seed)\nopen(out, 'w').write(f'{n}\\n' + ' '.join(str(random.randint(0, 10**6)) for _ in range(n)))\n".into(), library: None }],
            options: Options { repeats: 3, callgrind: true, massif: true, heap: true, ..Default::default() },
            hypotheses: Vec::new(),
        }
    }

    #[test]
    fn profiling_stays_within_a_budget() {
        // A 2 s program would take about two minutes under Callgrind: well beyond a 30 s share.
        assert!(profile_estimate(2000.0) > profile_budget(30, 8));
        assert!(profile_estimate(5.0) < Duration::from_secs(3));
        let cap = Duration::from_secs(300);
        assert_eq!(profile_limit(1.0, cap), Duration::from_secs(10));
        assert_eq!(profile_limit(60_000.0, cap), cap);
        assert!(profile_budget(30, 1) <= Duration::from_secs(600));
        assert!(profile_budget(600, 50) >= Duration::from_secs(30));
        assert_eq!(valgrind_mem_mb(0, 1024), 768);
        assert_eq!(valgrind_mem_mb(1024 * 1024, 1024), 4096);
    }

    const BUBBLE: &str = "#include <stdio.h>\n#include <stdlib.h>\nstatic void bubble(int *t, int n) { for (int i = 0; i < n; i++) for (int j = 0; j + 1 < n - i; j++) if (t[j] > t[j + 1]) { int x = t[j]; t[j] = t[j + 1]; t[j + 1] = x; } }\nint main(int ac, char **av) { FILE *f = ac > 1 ? fopen(av[1], \"r\") : NULL; int n; if (!f || fscanf(f, \"%d\", &n) != 1) return 84; int *t = malloc(sizeof(int) * n); for (int i = 0; i < n; i++) if (fscanf(f, \"%d\", &t[i]) != 1) return 84; bubble(t, n); printf(\"%d\\n\", t[0]); free(t); fclose(f); return 0; }\n";

    #[test]
    fn configs_are_checked() {
        let conn = std::sync::Mutex::new(crate::db::open_in_memory().unwrap());
        let ok = draft_bench(&conn, BUBBLE);
        assert!(validate(&ok).is_ok());
        let mut c = ok.clone();
        c.scenarios[0].generator = Some("missing.py".into());
        assert!(validate(&c).is_err());
        let mut c = ok.clone();
        c.scenarios[0].args = "{input} | rm -rf ~".into();
        assert!(validate(&c).is_err());
        let mut c = ok.clone();
        c.scenarios[0].sizes = vec![];
        assert!(validate(&c).is_err());
        let mut c = ok;
        c.variants[0].program = "../../bin/sh".into();
        assert!(validate(&c).is_err());
        let config = draft_bench(&conn, BUBBLE);
        let saved = save(&conn.lock().unwrap(), None, &config, 5).unwrap();
        assert_eq!(list(&conn.lock().unwrap()).unwrap().len(), 1);
        assert!(get_saved(&conn.lock().unwrap(), saved.id).unwrap().is_some());
    }

    #[test]
    fn a_branch_or_commit_is_copied_without_touching_the_repository() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path().join("proj");
        std::fs::create_dir_all(&repo).unwrap();
        let git = |args: &[&str]| assert!(std::process::Command::new("git").args(["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main"]).args(args).current_dir(&repo).output().unwrap().status.success(), "{args:?}");
        git(&["init", "-q"]);
        std::fs::write(repo.join("a.c"), "v1\n").unwrap();
        git(&["add", "."]);
        git(&["commit", "-qm", "one"]);
        std::fs::write(repo.join("a.c"), "v2\n").unwrap();
        git(&["commit", "-qam", "two"]);
        std::fs::write(repo.join("a.c"), "work in progress\n").unwrap();
        let roots = vec![std::fs::canonicalize(tmp.path()).unwrap().to_string_lossy().into_owned()];
        let conn = std::sync::Mutex::new(crate::db::open_in_memory().unwrap());
        let v = |rev: Option<&str>| Variant { label: "x".into(), source: Source::Project { path: repo.to_string_lossy().into_owned(), rev: rev.map(String::from) }, build: String::new(), program: String::new() };
        let dest = tmp.path().join("copy-old");
        prepare_variant(&conn, &v(Some("HEAD~1")), &dest, &roots).unwrap();
        assert_eq!(std::fs::read_to_string(dest.join("a.c")).unwrap(), "v1\n");
        let dest = tmp.path().join("copy-work");
        prepare_variant(&conn, &v(None), &dest, &roots).unwrap();
        assert_eq!(std::fs::read_to_string(dest.join("a.c")).unwrap(), "work in progress\n");
        assert_eq!(std::fs::read_to_string(repo.join("a.c")).unwrap(), "work in progress\n", "the working tree is untouched");
        assert!(prepare_variant(&conn, &v(Some("--output=/tmp/x")), &tmp.path().join("bad"), &roots).is_err());
        assert!(prepare_variant(&conn, &v(Some("no-such-branch")), &tmp.path().join("bad2"), &roots).is_err());
        assert!(prepare_variant(&conn, &v(None), &tmp.path().join("bad3"), &["/elsewhere".into()]).is_err());
    }

    #[test]
    fn a_quadratic_sort_is_measured_and_recognised() {
        if crate::toolenv::which("gcc").is_none() || crate::toolenv::which("python3").is_none() || sandbox::check().is_err() {
            return;
        }
        let db = std::sync::Arc::new(std::sync::Mutex::new(crate::db::open_in_memory().unwrap()));
        let config = draft_bench(&db, BUBBLE);
        let jobs = crate::jobs::Jobs::default();
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("bench");
        let db2 = db.clone();
        let id = jobs.start(db.clone(), "arena", None, "t".into(), STEPS, move |job| run_in_job(job, &db2, &config, &root, &[]));
        let v = loop {
            let v = jobs.get(id).unwrap();
            if v.status != "running" && v.run_id.is_some() {
                break v;
            }
            std::thread::sleep(Duration::from_millis(100));
        };
        assert!(v.status == "success" || v.status == "warning", "{}\n{:?}", v.log, v.summary.get("error"));
        let a = &v.summary["arena"];
        let points = a["series"][0]["points"].as_array().unwrap();
        assert_eq!(points.len(), 4);
        assert!(points.iter().all(|p| p["failed"].is_null() && p["wall"]["median"].as_f64().unwrap() > 0.0), "{points:?}");
        assert_eq!(a["inputs"].as_array().unwrap().len(), 4);
        assert!(a["hypotheses"].as_array().unwrap().iter().any(|h| h["kind"] == "nested-loops"));
        if crate::toolenv::which("valgrind").is_some() {
            // Instruction counts are exact: the quadratic law shows even on tiny sizes.
            assert!(points.iter().all(|p| p["ir"].as_u64().is_some()), "{points:?}");
            assert_eq!(a["series"][0]["fitIr"]["model"], "O(n²)", "{}", a["series"][0]["fitIr"]);
            let hot = a["series"][0]["hot"]["functions"].as_array().unwrap();
            assert!(hot.iter().any(|f| f["own"] == true), "{hot:?}");
            assert!(a["series"][0]["heap"]["allocs"].as_u64().unwrap() >= 1);
        }
    }
}
