//! Code Playground: small C experiments without a project. A draft is a handful of files
//! kept in the database; running it copies them to a throwaway folder, compiles and runs
//! them inside the sandbox (no network, read-only system, limited time, memory, processes
//! and written bytes), and reads the compiler, sanitizer and Valgrind output into findings.

use crate::ai::sandbox::{self, Limits};
use crate::cdiag::{self, Diagnostic, MemIssue};
use crate::error::{AppError, Result};
use crate::jobs::{Job, RunOpts};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Steps of a run: build, run (with its output), timed runs.
pub const STEPS: &[(&str, &str)] = &[("compile", "Compilation"), ("run", "Exécution"), ("bench", "Mesures")];
pub const MAX_FILES: usize = 40;
pub const MAX_FILE_BYTES: usize = 256 * 1024;
pub const MAX_TOTAL_BYTES: usize = 1024 * 1024;
const OUTPUT_KEEP: usize = 200 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DraftFile {
    /// Relative name: `main.c`, `lib/str/my_strlen.c`.
    pub name: String,
    pub content: String,
    /// Library the file was imported from (shown read-only by default).
    #[serde(default)]
    pub library: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct DraftSettings {
    /// `gcc`, `clang` or `epiclang`.
    pub compiler: String,
    pub flags: String,
    /// Arguments of the program, split like a shell would (no shell runs).
    pub args: String,
    pub stdin: String,
    pub asan: bool,
    pub ubsan: bool,
    pub valgrind: bool,
    pub timeout_s: u64,
    pub mem_mb: u64,
}

impl Default for DraftSettings {
    fn default() -> Self {
        DraftSettings { compiler: "gcc".into(), flags: "-Wall -Wextra".into(), args: String::new(), stdin: String::new(), asan: false, ubsan: false, valgrind: false, timeout_s: 10, mem_mb: 256 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub id: i64,
    pub title: String,
    pub files: Vec<DraftFile>,
    pub settings: DraftSettings,
    /// Shown as a tab (closed drafts stay in the history).
    pub open: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

pub const STARTER: &str = "#include <stdio.h>\n\nint main(int argc, char **argv)\n{\n    printf(\"Hello, TekBoard!\\n\");\n    for (int i = 1; i < argc; i++)\n        printf(\"argv[%d] = %s\\n\", i, argv[i]);\n    return 0;\n}\n";

fn row(r: &rusqlite::Row) -> rusqlite::Result<Draft> {
    let files: String = r.get(2)?;
    let settings: String = r.get(3)?;
    Ok(Draft {
        id: r.get(0)?,
        title: r.get(1)?,
        files: serde_json::from_str(&files).unwrap_or_default(),
        settings: serde_json::from_str(&settings).unwrap_or_default(),
        open: r.get::<_, i64>(4)? != 0,
        created_at: r.get(5)?,
        updated_at: r.get(6)?,
    })
}

const COLS: &str = "id, title, files, settings, open, created_at, updated_at";

pub fn list(conn: &Connection) -> Result<Vec<Draft>> {
    let mut st = conn.prepare(&format!("SELECT {COLS} FROM playground_drafts ORDER BY open DESC, updated_at DESC LIMIT 300"))?;
    let rows = st.query_map([], row)?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

pub fn get(conn: &Connection, id: i64) -> Result<Draft> {
    conn.query_row(&format!("SELECT {COLS} FROM playground_drafts WHERE id = ?1"), [id], row).optional()?.ok_or_else(|| AppError::new("not_found", "Ce brouillon n'existe plus"))
}

/// Checks names and sizes: what reaches the disk is a flat, bounded set of text files.
pub fn validate(files: &[DraftFile]) -> Result<()> {
    if files.is_empty() {
        return Err(AppError::new("invalid_draft", "Un brouillon a au moins un fichier"));
    }
    if files.len() > MAX_FILES {
        return Err(AppError::new("invalid_draft", format!("{MAX_FILES} fichiers au plus par brouillon")));
    }
    let mut total = 0;
    let mut seen = std::collections::BTreeSet::new();
    for f in files {
        crate::library::safe_rel(&f.name)?;
        let ok_name = f.name.split('/').all(|seg| !seg.is_empty() && !seg.starts_with('.') && seg.chars().all(|c| c.is_ascii_alphanumeric() || "_-.+".contains(c)));
        if !ok_name || f.name.len() > 120 {
            return Err(AppError::new("invalid_name", format!("« {} » : lettres, chiffres, _ - . et / seulement", f.name)));
        }
        if !seen.insert(f.name.to_lowercase()) {
            return Err(AppError::new("invalid_name", format!("Deux fichiers s'appellent « {} »", f.name)));
        }
        if f.content.len() > MAX_FILE_BYTES {
            return Err(AppError::new("too_big", format!("« {} » dépasse {} Ko", f.name, MAX_FILE_BYTES / 1024)));
        }
        total += f.content.len();
    }
    if total > MAX_TOTAL_BYTES {
        return Err(AppError::new("too_big", "Le brouillon dépasse 1 Mo"));
    }
    Ok(())
}

pub fn create(conn: &Connection, title: &str, files: Option<Vec<DraftFile>>, settings: Option<DraftSettings>, now: i64) -> Result<Draft> {
    let files = files.unwrap_or_else(|| vec![DraftFile { name: "main.c".into(), content: STARTER.into(), library: None }]);
    validate(&files)?;
    let settings = settings.unwrap_or_default();
    let title = clean_title(title);
    conn.execute(
        "INSERT INTO playground_drafts (title, files, settings, open, created_at, updated_at) VALUES (?1, ?2, ?3, 1, ?4, ?4)",
        params![title, serde_json::to_string(&files)?, serde_json::to_string(&settings)?, now],
    )?;
    get(conn, conn.last_insert_rowid())
}

fn clean_title(title: &str) -> String {
    let t: String = title.trim().chars().filter(|c| !c.is_control()).take(80).collect();
    if t.is_empty() { "Brouillon".into() } else { t }
}

pub fn save(conn: &Connection, id: i64, title: &str, files: &[DraftFile], settings: &DraftSettings, now: i64) -> Result<Draft> {
    validate(files)?;
    let n = conn.execute(
        "UPDATE playground_drafts SET title = ?2, files = ?3, settings = ?4, updated_at = ?5 WHERE id = ?1",
        params![id, clean_title(title), serde_json::to_string(files)?, serde_json::to_string(settings)?, now],
    )?;
    if n == 0 {
        return Err(AppError::new("not_found", "Ce brouillon n'existe plus"));
    }
    get(conn, id)
}

pub fn set_open(conn: &Connection, id: i64, open: bool) -> Result<()> {
    conn.execute("UPDATE playground_drafts SET open = ?2 WHERE id = ?1", params![id, open as i64])?;
    Ok(())
}

pub fn delete(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM playground_drafts WHERE id = ?1", [id])?;
    Ok(())
}

// ───────────────────────────── tools ─────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tool {
    pub name: String,
    pub path: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tools {
    pub compilers: Vec<Tool>,
    pub valgrind: Option<String>,
    /// Why programs cannot run (bubblewrap missing or broken), if so.
    pub sandbox: Option<String>,
    /// Memory and process ceilings come from a cgroup (otherwise `ulimit`, weaker).
    pub cgroup_limits: bool,
}

pub fn tools() -> Tools {
    let version = |p: &Path| crate::toolenv::first_line(p, &["--version"], Duration::from_secs(4)).ok();
    let compilers = ["gcc", "clang", "epiclang"]
        .iter()
        .map(|n| {
            let path = crate::toolenv::which(n);
            Tool { name: n.to_string(), version: path.as_deref().and_then(version), path: path.map(|p| p.to_string_lossy().into_owned()) }
        })
        .collect();
    Tools { compilers, valgrind: crate::toolenv::which("valgrind").map(|p| p.to_string_lossy().into_owned()), sandbox: sandbox::check().err(), cgroup_limits: sandbox::scope_available() }
}

// ───────────────────────────── running ─────────────────────────────

/// Writes the files of a draft under `dir` (which must be empty or missing).
pub fn materialize(files: &[DraftFile], dir: &Path) -> Result<()> {
    validate(files)?;
    std::fs::create_dir_all(dir)?;
    for f in files {
        let rel = crate::library::safe_rel(&f.name)?;
        let path = dir.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&path, &f.content)?;
    }
    Ok(())
}

/// The compiler command: every `.c` file, an include path for every folder that holds a header.
pub fn compile_argv(files: &[DraftFile], s: &DraftSettings, output: &str) -> Result<Vec<String>> {
    let mut argv = vec![s.compiler.clone()];
    argv.extend(flags_of(files, s)?);
    let sources: Vec<String> = files.iter().filter(|f| f.name.ends_with(".c")).map(|f| f.name.clone()).collect();
    if sources.is_empty() {
        return Err(AppError::new("invalid_draft", "Aucun fichier .c à compiler"));
    }
    argv.extend(sources);
    argv.extend(["-o".into(), output.into()]);
    if s.compiler != "epiclang" {
        argv.push("-lm".into());
    }
    Ok(argv)
}

/// Options given to every compilation and to the link: the user's, sanitizers, debug info,
/// plain diagnostics, an include path for every folder that holds a header.
pub fn flags_of(files: &[DraftFile], s: &DraftSettings) -> Result<Vec<String>> {
    if !["gcc", "clang", "epiclang"].contains(&s.compiler.as_str()) {
        return Err(AppError::new("invalid_compiler", "Compilateurs possibles : gcc, clang, epiclang"));
    }
    let mut argv: Vec<String> = Vec::new();
    if !s.flags.trim().is_empty() {
        argv.extend(crate::jobs::split_command(&s.flags)?);
    }
    if argv.iter().any(|a| a == "-o" || a.starts_with("-o") || a == "-c") {
        return Err(AppError::new("invalid_flags", "Le nom du programme est choisi par TekBoard : retire « -o » des options"));
    }
    let mut sanitize = Vec::new();
    if s.asan {
        sanitize.push("address");
    }
    if s.ubsan {
        sanitize.push("undefined");
    }
    if !sanitize.is_empty() {
        argv.push(format!("-fsanitize={}", sanitize.join(",")));
        argv.push("-fno-omit-frame-pointer".into());
    }
    if (s.asan || s.ubsan || s.valgrind) && !argv.iter().any(|a| a.starts_with("-g")) {
        argv.push("-g".into());
    }
    let color = if s.compiler == "gcc" { "-fdiagnostics-color=never" } else { "-fno-color-diagnostics" };
    argv.push(color.into());
    let mut dirs: Vec<String> = vec![".".into()];
    for f in files.iter().filter(|f| f.name.ends_with(".h")) {
        if let Some((d, _)) = f.name.rsplit_once('/') {
            let d = format!("./{d}");
            if !dirs.contains(&d) {
                dirs.push(d);
            }
        }
    }
    argv.extend(dirs.iter().map(|d| format!("-I{d}")));
    Ok(argv)
}

/// How the program was built.
#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BuildInfo {
    /// `full` (every file compiled), `incremental` (some objects reused), `make` (the draft's Makefile).
    pub mode: String,
    pub compile_ms: u64,
    pub link_ms: u64,
    pub make_ms: u64,
    pub compiled: usize,
    pub cached: usize,
}

/// Key of a compiled object: its source, every header, the compiler and the options.
pub fn object_key(f: &DraftFile, files: &[DraftFile], compiler: &str, flags: &[String]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(compiler.as_bytes());
    h.update(flags.join("\u{1}").as_bytes());
    h.update(f.name.as_bytes());
    h.update(f.content.as_bytes());
    for x in files.iter().filter(|x| x.name.ends_with(".h")) {
        h.update(x.name.as_bytes());
        h.update(x.content.as_bytes());
    }
    format!("{:x}", h.finalize()).chars().take(32).collect()
}

/// Keeps the object cache small: the oldest objects go first.
fn prune(objs: &Path, keep: usize) {
    let Ok(rd) = std::fs::read_dir(objs) else { return };
    let mut all: Vec<(std::time::SystemTime, PathBuf)> = rd.flatten().filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path()))).collect();
    if all.len() <= keep {
        return;
    }
    all.sort();
    for (_, p) in &all[..all.len() - keep] {
        let _ = std::fs::remove_file(p);
    }
}

/// Builds the draft in `work`: the draft's Makefile when it has one (timed), otherwise one
/// object per `.c` file, reused from `objs` when nothing it depends on changed, then the link.
/// Returns the report and the program's path relative to `work` (None when it failed).
pub fn build(job: &Job, files: &[DraftFile], s: &DraftSettings, work: &Path, objs: Option<&Path>) -> Result<(CompileReport, Option<String>)> {
    let work_s = work.to_string_lossy().into_owned();
    let limits = Limits { wall: Duration::from_secs(60), cpu_seconds: 60, file_mb: 256, output_cap: OUTPUT_KEEP, mem_mb: Some(2048), tasks: Some(128), address_space_free: false };
    let exec = |argv: &[String]| -> Result<crate::jobs::Outcome> {
        let wrapped = sandbox::wrap_argv(work, argv, &[], &limits)?;
        job.log(&format!("$ {}", argv.join(" ")));
        job.run_opts(&RunOpts { argv: &wrapped, cwd: work, timeout: limits.wall, envs: &[], log_output: false, stdin: None, split_streams: true }, &mut |l| job.log(l))
    };
    // The draft's own Makefile.
    if files.iter().any(|f| f.name == "Makefile") {
        let o = exec(&["make".into()])?;
        let program = crate::runner::detect(work).map(|(p, _)| p).filter(|p| work.join(p).is_file());
        let text = format!("{}{}", o.stdout, o.stderr);
        let diagnostics = cdiag::compiler(&text, &work_s);
        let ok = o.ok() && program.is_some();
        let (output, _) = keep(&text);
        let info = BuildInfo { mode: "make".into(), make_ms: o.duration_ms, ..Default::default() };
        return Ok((CompileReport { ok, command: "make".into(), output: if ok || !o.ok() { output } else { format!("{output}\nmake a réussi, mais le programme est introuvable : indique NAME dans le Makefile.") }, diagnostics, duration_ms: o.duration_ms, build: Some(info) }, if ok { program } else { None }));
    }
    let flags = flags_of(files, s)?;
    let sources: Vec<&DraftFile> = files.iter().filter(|f| f.name.ends_with(".c")).collect();
    if sources.is_empty() {
        return Err(AppError::new("invalid_draft", "Aucun fichier .c à compiler"));
    }
    std::fs::create_dir_all(work.join(".obj"))?;
    if let Some(o) = objs {
        std::fs::create_dir_all(o)?;
    }
    let mut info = BuildInfo::default();
    let (mut errors, mut objects, mut total) = (String::new(), Vec::new(), 0u64);
    let mut ok = true;
    for (i, f) in sources.iter().enumerate() {
        let obj = format!(".obj/{i}.o");
        let key = object_key(f, files, &s.compiler, &flags);
        let cached = objs.map(|o| o.join(format!("{key}.o")));
        if let Some(c) = cached.as_ref().filter(|c| c.is_file()) {
            std::fs::copy(c, work.join(&obj))?;
            info.cached += 1;
        } else {
            let mut argv = vec![s.compiler.clone()];
            argv.extend(flags.iter().cloned());
            argv.extend(["-c".into(), f.name.clone(), "-o".into(), obj.clone()]);
            let o = exec(&argv)?;
            total += o.duration_ms;
            info.compile_ms += o.duration_ms;
            info.compiled += 1;
            errors.push_str(&o.stderr);
            if o.cancelled {
                return Ok((CompileReport { ok: false, command: argv.join(" "), output: String::new(), diagnostics: vec![], duration_ms: total, build: Some(info) }, None));
            }
            if !o.ok() || !work.join(&obj).is_file() {
                ok = false;
                continue;
            }
            if let Some(c) = &cached {
                let _ = std::fs::copy(work.join(&obj), c);
            }
        }
        objects.push(obj);
    }
    let program = ".tekboard-prog".to_string();
    let mut link = vec![s.compiler.clone()];
    link.extend(flags.iter().filter(|f| !f.starts_with("-I")).cloned());
    link.extend(objects.iter().cloned());
    link.extend(["-o".into(), program.clone()]);
    if s.compiler != "epiclang" {
        link.push("-lm".into());
    }
    if ok {
        let o = exec(&link)?;
        total += o.duration_ms;
        info.link_ms = o.duration_ms;
        errors.push_str(&o.stderr);
        ok = o.ok() && work.join(&program).is_file();
    }
    info.mode = if info.cached > 0 { "incremental".into() } else { "full".into() };
    if let Some(o) = objs {
        prune(o, 400);
    }
    let diagnostics = cdiag::compiler(&errors, &work_s);
    let (output, _) = keep(&errors);
    let mut shown = vec![s.compiler.clone()];
    shown.extend(flags);
    shown.extend(sources.iter().map(|f| f.name.clone()));
    Ok((CompileReport { ok, command: shown.join(" "), output, diagnostics, duration_ms: total, build: Some(info) }, ok.then_some(program)))
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CompileReport {
    pub ok: bool,
    pub command: String,
    pub output: String,
    pub diagnostics: Vec<Diagnostic>,
    pub duration_ms: u64,
    /// Compilation, link and make times, objects reused.
    pub build: Option<BuildInfo>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RunReport {
    pub command: String,
    pub exit_code: Option<i32>,
    pub signal: Option<i32>,
    pub signal_name: Option<String>,
    pub timed_out: bool,
    pub stdout: String,
    pub stderr: String,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
    pub duration_ms: u64,
    pub memory: Vec<MemIssue>,
    pub valgrind: Option<crate::moulinette::Valgrind>,
}

fn keep(text: &str) -> (String, bool) {
    if text.len() <= OUTPUT_KEEP {
        return (text.to_string(), false);
    }
    let mut cut = OUTPUT_KEEP;
    while !text.is_char_boundary(cut) {
        cut -= 1;
    }
    (text[..cut].to_string(), true)
}

/// Limits of the program itself (the compiler gets its own, fixed ones).
pub fn run_limits(s: &DraftSettings) -> Limits {
    let secs = s.timeout_s.clamp(1, 120) * if s.valgrind { 4 } else { 1 };
    // CPU time a second above the wall clock: a single-threaded loop hits the clock first and
    // shows as "time limit"; only threads burning several cores get SIGXCPU.
    Limits { wall: Duration::from_secs(secs), cpu_seconds: secs + 1, file_mb: 64, output_cap: OUTPUT_KEEP, mem_mb: Some(s.mem_mb.clamp(16, 4096)), tasks: Some(64), address_space_free: s.asan || s.valgrind }
}

/// Compiles and runs a draft in `root` (a fresh folder). Steps `compile`, `run`, `bench`.
/// `objs` keeps compiled objects between runs (incremental builds).
pub fn run_in_job(job: &Job, draft_id: i64, files: &[DraftFile], s: &DraftSettings, root: &Path, objs: Option<&Path>) -> Result<&'static str> {
    let work = root.join("src");
    materialize(files, &work)?;
    let work_s = work.to_string_lossy().into_owned();
    job.set("draftId", draft_id);
    job.set("snapshot", serde_json::json!({ "files": files, "settings": s }));

    job.start("compile");
    let (compile, built) = build(job, files, s, &work, objs)?;
    job.set("compile", &compile);
    if job.cancelled() {
        job.end("compile", "cancelled", None);
        return Ok("cancelled");
    }
    let warnings = compile.diagnostics.iter().filter(|d| d.severity == "warning").count();
    let Some(program) = built else {
        let errors = compile.diagnostics.iter().filter(|d| d.severity == "error").count().max(1);
        job.end("compile", "failed", Some(format!("{errors} erreur(s)")));
        job.skip("run", "la compilation a échoué");
        job.skip("bench", "la compilation a échoué");
        return Ok("failed");
    };
    let b = compile.build.clone().unwrap_or_default();
    let how = match b.mode.as_str() {
        "make" => format!("make en {} ms", b.make_ms),
        "incremental" => format!("incrémentale ({} réutilisé(s), {} compilé(s))", b.cached, b.compiled),
        _ => "complète".into(),
    };
    job.end("compile", if warnings > 0 { "warning" } else { "success" }, Some(format!("{how}{}", if warnings > 0 { format!(" · {warnings} avertissement(s)") } else { String::new() })));
    let program = program.as_str();

    job.start("run");
    let mut inner: Vec<String> = Vec::new();
    if s.valgrind {
        inner.extend(["valgrind", "--leak-check=full", "--show-leak-kinds=definite,indirect", "--track-origins=yes", "--num-callers=20"].map(String::from));
    }
    let args = if s.args.trim().is_empty() { Vec::new() } else { crate::jobs::split_command(&s.args)? };
    inner.push(format!("./{program}"));
    inner.extend(args.iter().cloned());
    let shown_run = std::iter::once("./a.out".to_string()).chain(args.iter().map(|a| sandbox::shell_quote(a))).collect::<Vec<_>>().join(" ");
    let stdin_path = root.join("stdin.txt");
    std::fs::write(&stdin_path, &s.stdin)?;
    let limits = run_limits(s);
    let envs: Vec<(&str, &str)> = vec![
        ("ASAN_OPTIONS", "detect_leaks=1:abort_on_error=0:symbolize=1:color=never"),
        ("UBSAN_OPTIONS", "print_stacktrace=1:color=never"),
        ("LSAN_OPTIONS", "color=never"),
    ];
    let wrapped = sandbox::wrap_argv(&work, &inner, &envs, &limits)?;
    job.log(&format!("$ {}", if s.valgrind { format!("valgrind {shown_run}") } else { shown_run.clone() }));
    let o = job.run_opts(&RunOpts { argv: &wrapped, cwd: &work, timeout: limits.wall, envs: &[], log_output: true, stdin: Some(&stdin_path), split_streams: true }, &mut |_| {})?;
    let signal = sandbox::signal_of(o.code);
    let memory = cdiag::memory(&o.stderr, &work_s);
    let valgrind = s.valgrind.then(|| crate::moulinette::parse_valgrind(&o.stderr));
    let (stdout, stdout_truncated) = keep(&o.stdout);
    let (stderr, stderr_truncated) = keep(&o.stderr);
    let report = RunReport {
        command: shown_run,
        exit_code: o.code,
        signal,
        signal_name: signal.map(|s| sandbox::signal_name(s).to_string()),
        timed_out: o.timed_out,
        stdout,
        stderr,
        stdout_truncated,
        stderr_truncated,
        duration_ms: o.duration_ms,
        memory: memory.clone(),
        valgrind,
    };
    job.set("run", &report);
    if o.cancelled {
        job.end("run", "cancelled", None);
        return Ok("cancelled");
    }
    let (status, detail) = if o.timed_out {
        ("failed", format!("arrêté après {} s", limits.wall.as_secs()))
    } else if let Some(sig) = signal {
        ("failed", sandbox::signal_name(sig).to_string())
    } else if !memory.is_empty() {
        ("warning", format!("{} problème(s) mémoire, code {}", memory.len(), o.code.unwrap_or(-1)))
    } else {
        match o.code {
            Some(0) => ("success", "code de sortie 0".to_string()),
            Some(c) => ("warning", format!("code de sortie {c}")),
            None => ("failed", "arrêté".to_string()),
        }
    };
    job.end("run", status, Some(detail));

    // ── bench: repeated runs through the measuring helper, output discarded.
    job.start("bench");
    if o.timed_out || signal.is_some() || s.valgrind || s.asan || s.ubsan {
        job.skip("bench", if s.valgrind || s.asan || s.ubsan { "les outils mémoire faussent les temps" } else { "l'exécution n'est pas allée au bout" });
    } else {
        let helper = crate::bench::helper(job, &work)?;
        let n = crate::bench::repeat_count(o.duration_ms);
        let mut samples = Vec::new();
        // One warm-up run (caches, disk), not counted.
        for i in 0..=n {
            match crate::bench::sample(job, &work, &helper, &work.join(program), &args, Some(&stdin_path), &limits)? {
                Some(x) if i > 0 => samples.push(x),
                Some(_) => {}
                None => break,
            }
        }
        match crate::bench::timing(&samples) {
            Some(t) => {
                job.end("bench", "success", Some(format!("médiane {:.3} ms sur {} exécutions", t.wall.median, t.runs)));
                job.set("bench", &t);
            }
            None => job.skip("bench", "mesure impossible"),
        }
    }
    Ok(if status == "success" && warnings > 0 { "warning" } else { status })
}

// ───────────────────────────── comparing two versions ─────────────────────────────

pub const COMPARE_STEPS: &[(&str, &str)] = &[("build", "Compilation de A et B"), ("run", "Exécution de A et B"), ("bench", "Mesures alternées"), ("verdict", "Comparaison")];

/// One run of a version, with what it printed.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VersionRun {
    pub exit_code: Option<i32>,
    pub signal_name: Option<String>,
    pub timed_out: bool,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
}

/// Builds and runs versions A and B under the same conditions (A's settings: compiler,
/// options, arguments, standard input, limits), checks they print the same thing, then times
/// them in alternation (A B A B…) so a change of machine load hits both alike.
pub fn compare_in_job(job: &Job, a: &Draft, b: &Draft, root: &Path, objs: Option<&Path>) -> Result<&'static str> {
    let s = DraftSettings { asan: false, ubsan: false, valgrind: false, ..a.settings.clone() };
    job.set("versions", serde_json::json!({"a": {"id": a.id, "title": a.title}, "b": {"id": b.id, "title": b.title}}));
    job.start("build");
    let mut built = Vec::new();
    for (tag, d) in [("a", a), ("b", b)] {
        let work = root.join(tag);
        materialize(&d.files, &work)?;
        let (report, program) = build(job, &d.files, &s, &work, objs)?;
        job.set(&format!("compile_{tag}"), &report);
        if job.cancelled() {
            return Ok("cancelled");
        }
        match program {
            Some(p) => built.push((work, p)),
            None => {
                job.end("build", "failed", Some(format!("la version {} ne compile pas", tag.to_uppercase())));
                return Ok("failed");
            }
        }
    }
    job.end("build", "success", None);

    job.start("run");
    let args = if s.args.trim().is_empty() { Vec::new() } else { crate::jobs::split_command(&s.args)? };
    let stdin_path = root.join("stdin.txt");
    std::fs::write(&stdin_path, &s.stdin)?;
    let limits = run_limits(&s);
    let mut runs = Vec::new();
    for (work, program) in &built {
        let mut argv = vec![format!("./{program}")];
        argv.extend(args.iter().cloned());
        let wrapped = sandbox::wrap_argv(work, &argv, &[], &limits)?;
        let o = job.run_opts(&RunOpts { argv: &wrapped, cwd: work, timeout: limits.wall, envs: &[], log_output: false, stdin: Some(&stdin_path), split_streams: true }, &mut |_| {})?;
        if o.cancelled {
            return Ok("cancelled");
        }
        let signal = sandbox::signal_of(o.code);
        runs.push(VersionRun { exit_code: o.code, signal_name: signal.map(|x| sandbox::signal_name(x).to_string()), timed_out: o.timed_out, stdout: keep(&o.stdout).0, stderr: keep(&o.stderr).0, duration_ms: o.duration_ms });
    }
    let same_output = runs[0].stdout == runs[1].stdout;
    let same_code = runs[0].exit_code == runs[1].exit_code;
    job.set("run_a", &runs[0]);
    job.set("run_b", &runs[1]);
    job.set("sameOutput", same_output);
    job.set("sameCode", same_code);
    let finished = runs.iter().all(|r| !r.timed_out && r.signal_name.is_none());
    job.end("run", if same_output && same_code { "success" } else { "warning" }, Some(if same_output && same_code { "mêmes sorties".into() } else { "les sorties diffèrent".to_string() }));

    job.start("bench");
    if !finished {
        job.skip("bench", "une version ne va pas au bout");
        job.skip("verdict", "pas de mesures");
        return Ok("warning");
    }
    let helpers: Vec<PathBuf> = built.iter().map(|(w, _)| crate::bench::helper(job, w)).collect::<Result<_>>()?;
    let n = crate::bench::repeat_count(runs[0].duration_ms.max(runs[1].duration_ms));
    let mut samples: [Vec<crate::arena::measure::Sample>; 2] = [Vec::new(), Vec::new()];
    for i in 0..=n {
        for v in 0..2 {
            let (work, program) = &built[v];
            match crate::bench::sample(job, work, &helpers[v], &work.join(program), &args, Some(&stdin_path), &limits)? {
                Some(x) if i > 0 => samples[v].push(x),
                Some(_) => {}
                None if job.cancelled() => return Ok("cancelled"),
                None => {}
            }
        }
    }
    let (Some(ta), Some(tb)) = (crate::bench::timing(&samples[0]), crate::bench::timing(&samples[1])) else {
        job.skip("bench", "mesure impossible");
        job.skip("verdict", "pas de mesures");
        return Ok("warning");
    };
    job.set("bench_a", &ta);
    job.set("bench_b", &tb);
    job.end("bench", "success", Some(format!("{} mesures par version", ta.runs.min(tb.runs))));
    job.start("verdict");
    let v = crate::bench::verdict(&ta, &tb);
    job.set("verdict", &v);
    job.end("verdict", "success", Some(v.why.clone()));
    Ok(if same_output && same_code { "success" } else { "warning" })
}

// ───────────────────────────── libraries and export ─────────────────────────────

/// Files of a library (with everything they need) as draft files under `lib/`.
pub fn library_files(library: &crate::library::Library, catalog: &crate::library::Catalog, selection: &[String]) -> Result<Vec<DraftFile>> {
    let mut rels: Vec<String> = selection.to_vec();
    rels.extend(crate::library::closure(catalog, selection, &Default::default()).into_iter().map(|r| r.rel));
    // Headers the selected files include, when the library has them.
    let known: std::collections::BTreeSet<&str> = catalog.files.iter().map(|f| f.rel.as_str()).collect();
    let mut extra = Vec::new();
    for f in catalog.files.iter().filter(|f| rels.contains(&f.rel)) {
        for h in &f.headers {
            if let Some(found) = known.iter().find(|k| k.ends_with(h.as_str()) && (k.len() == h.len() || k.as_bytes()[k.len() - h.len() - 1] == b'/')) {
                extra.push(found.to_string());
            }
        }
    }
    rels.extend(extra);
    rels.sort();
    rels.dedup();
    let mut out = Vec::new();
    for rel in rels {
        let content = crate::library::read_source(library, &rel)?;
        out.push(DraftFile { name: format!("lib/{rel}"), content, library: Some(library.name.clone()) });
    }
    Ok(out)
}

/// What exporting a draft as a project writes: its files, a Makefile and a `.gitignore`.
pub fn export_plan(draft: &Draft, name: &str) -> Result<Vec<DraftFile>> {
    if name.is_empty() || name.len() > 60 || !name.chars().all(|c| c.is_ascii_alphanumeric() || "_-".contains(c)) {
        return Err(AppError::new("invalid_name", "Nom du projet : lettres, chiffres, _ et - seulement"));
    }
    let mut files = draft.files.clone();
    let sources: Vec<&str> = draft.files.iter().filter(|f| f.name.ends_with(".c")).map(|f| f.name.as_str()).collect();
    let mut incs: Vec<String> = vec!["-I.".into()];
    for f in draft.files.iter().filter(|f| f.name.ends_with(".h")) {
        if let Some((d, _)) = f.name.rsplit_once('/') {
            let i = format!("-I{d}");
            if !incs.contains(&i) {
                incs.push(i);
            }
        }
    }
    let flags = draft.settings.flags.trim();
    let cc = if draft.settings.compiler == "epiclang" { "epiclang" } else { draft.settings.compiler.as_str() };
    let src = sources.iter().map(|s| format!("\t{s}")).collect::<Vec<_>>().join(" \\\n");
    let makefile = format!(
        "##\n## Generated by TekBoard from a Playground draft\n##\n\nCC\t=\t{cc}\n\nSRC\t=\t\\\n{src}\n\nOBJ\t=\t$(SRC:.c=.o)\n\nCFLAGS\t+=\t{flags} {incs}\n\nNAME\t=\t{name}\n\nall:\t$(NAME)\n\n$(NAME):\t$(OBJ)\n\t$(CC) -o $(NAME) $(OBJ) $(CFLAGS)\n\nclean:\n\t$(RM) $(OBJ)\n\nfclean:\tclean\n\t$(RM) $(NAME)\n\nre:\tfclean all\n\n.PHONY:\tall clean fclean re\n",
        incs = incs.join(" ")
    );
    if files.iter().any(|f| f.name == "Makefile" || f.name == ".gitignore") {
        return Err(AppError::new("conflict", "Le brouillon contient déjà un Makefile"));
    }
    files.push(DraftFile { name: "Makefile".into(), content: makefile, library: None });
    files.push(DraftFile { name: ".gitignore".into(), content: format!("{name}\n*.o\nvgcore.*\n"), library: None });
    Ok(files)
}

/// Writes the plan into `parent/name` (refused if it exists). Returns the new folder.
pub fn export(draft: &Draft, parent: &Path, name: &str, git_init: bool) -> Result<PathBuf> {
    let plan = export_plan(draft, name)?;
    let dest = parent.join(name);
    if dest.exists() {
        return Err(AppError::new("exists", format!("{} existe déjà", dest.display())));
    }
    std::fs::create_dir_all(&dest)?;
    for f in &plan {
        // `.gitignore` is the only dotted name allowed, and it is ours.
        let rel = crate::library::safe_rel(&f.name)?;
        let path = dest.join(rel);
        if let Some(p) = path.parent() {
            std::fs::create_dir_all(p)?;
        }
        std::fs::write(path, &f.content)?;
    }
    if git_init {
        let ok = crate::toolenv::command("git").args(["init", "-q"]).current_dir(&dest).stdin(std::process::Stdio::null()).status().is_ok_and(|s| s.success());
        if !ok {
            return Err(AppError::new("git_failed", "Le projet est créé, mais « git init » a échoué"));
        }
    }
    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f(name: &str, content: &str) -> DraftFile {
        DraftFile { name: name.into(), content: content.into(), library: None }
    }

    #[test]
    fn drafts_are_saved_listed_and_closed() {
        let conn = crate::db::open_in_memory().unwrap();
        let d = create(&conn, "  essai  ", None, None, 10).unwrap();
        assert_eq!(d.title, "essai");
        assert_eq!(d.files[0].name, "main.c");
        let s = DraftSettings { asan: true, ..Default::default() };
        let d2 = save(&conn, d.id, "essai 2", &[f("main.c", "int main(void){return 0;}"), f("util.h", "")], &s, 20).unwrap();
        assert_eq!(d2.files.len(), 2);
        assert!(d2.settings.asan);
        set_open(&conn, d.id, false).unwrap();
        assert!(!get(&conn, d.id).unwrap().open);
        assert_eq!(list(&conn).unwrap().len(), 1);
        delete(&conn, d.id).unwrap();
        assert!(get(&conn, d.id).is_err());
    }

    #[test]
    fn names_and_sizes_are_checked() {
        for bad in ["../x.c", "/etc/passwd", ".hidden.c", "a b.c", "x/../y.c", ""] {
            assert!(validate(&[f(bad, "")]).is_err(), "{bad}");
        }
        assert!(validate(&[f("main.c", ""), f("MAIN.c", "")]).is_err());
        assert!(validate(&[f("main.c", &"x".repeat(MAX_FILE_BYTES + 1))]).is_err());
        assert!(validate(&[f("lib/str/my_strlen.c", ""), f("main.c", "")]).is_ok());
    }

    #[test]
    fn the_compile_command_is_built_without_a_shell() {
        let files = [f("main.c", ""), f("lib/inc/my.h", ""), f("lib/my_putstr.c", "")];
        let s = DraftSettings { asan: true, ubsan: true, ..Default::default() };
        let a = compile_argv(&files, &s, "prog").unwrap();
        assert_eq!(a[0], "gcc");
        assert!(a.contains(&"-fsanitize=address,undefined".to_string()) && a.contains(&"-g".to_string()));
        assert!(a.contains(&"-I./lib/inc".to_string()) && a.contains(&"lib/my_putstr.c".to_string()));
        assert!(compile_argv(&files, &DraftSettings { flags: "-o /tmp/x".into(), ..Default::default() }, "p").is_err());
        assert!(compile_argv(&files, &DraftSettings { compiler: "sh".into(), ..Default::default() }, "p").is_err());
        assert!(compile_argv(&files, &DraftSettings { flags: "-O2; rm -rf ~".into(), ..Default::default() }, "p").is_err());
        assert!(compile_argv(&[f("a.h", "")], &DraftSettings::default(), "p").is_err());
    }

    #[test]
    fn export_writes_a_makefile_and_refuses_existing_folders() {
        let conn = crate::db::open_in_memory().unwrap();
        let d = create(&conn, "x", Some(vec![f("main.c", STARTER), f("inc/my.h", "#pragma once\n")]), None, 1).unwrap();
        let tmp = tempfile::tempdir().unwrap();
        assert!(export(&d, tmp.path(), "../evil", false).is_err());
        let dest = export(&d, tmp.path(), "hello", false).unwrap();
        let mk = std::fs::read_to_string(dest.join("Makefile")).unwrap();
        assert!(mk.contains("NAME\t=\thello") && mk.contains("main.c") && mk.contains("-Iinc"), "{mk}");
        assert!(dest.join("inc/my.h").exists());
        assert!(export(&d, tmp.path(), "hello", false).is_err());
        if crate::toolenv::which("make").is_some() && crate::toolenv::which("gcc").is_some() {
            let st = std::process::Command::new("make").current_dir(&dest).output().unwrap();
            assert!(st.status.success(), "{}", String::from_utf8_lossy(&st.stderr));
            assert!(dest.join("hello").exists());
        }
    }

    fn ready() -> bool {
        crate::toolenv::which("gcc").is_some() && sandbox::check().is_ok()
    }

    fn run(files: Vec<DraftFile>, s: DraftSettings) -> crate::jobs::JobView {
        let jobs = crate::jobs::Jobs::default();
        let db = std::sync::Arc::new(std::sync::Mutex::new(crate::db::open_in_memory().unwrap()));
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_path_buf();
        let id = jobs.start(db, "playground", None, "t".into(), STEPS, move |job| run_in_job(job, 1, &files, &s, &root, None));
        loop {
            let v = jobs.get(id).unwrap();
            if v.status != "running" && v.run_id.is_some() {
                drop(tmp);
                return v;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    fn run_cached(files: Vec<DraftFile>, s: DraftSettings, objs: PathBuf) -> crate::jobs::JobView {
        let jobs = crate::jobs::Jobs::default();
        let db = std::sync::Arc::new(std::sync::Mutex::new(crate::db::open_in_memory().unwrap()));
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_path_buf();
        let id = jobs.start(db, "playground", None, "t".into(), STEPS, move |job| run_in_job(job, 1, &files, &s, &root, Some(&objs)));
        loop {
            let v = jobs.get(id).unwrap();
            if v.status != "running" && v.run_id.is_some() {
                drop(tmp);
                return v;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    #[test]
    fn two_versions_are_compared_under_the_same_conditions() {
        if !ready() {
            return;
        }
        let conn = crate::db::open_in_memory().unwrap();
        let prog = |loops: u64, out: &str| vec![DraftFile { name: "main.c".into(), content: format!("#include <stdio.h>\nint main(void)\n{{\n    volatile unsigned long s = 0;\n    for (unsigned long i = 0; i < {loops}UL; i++)\n        s += i;\n    printf(\"{out}\\n\");\n    return 0;\n}}\n"), library: None }];
        let a = create(&conn, "lent", Some(prog(40_000_000, "ok")), None, 1).unwrap();
        let b = create(&conn, "rapide", Some(prog(400_000, "ok")), None, 1).unwrap();
        let c = create(&conn, "autre", Some(prog(400_000, "ko")), None, 1).unwrap();
        let go = |x: Draft, y: Draft| {
            let jobs = crate::jobs::Jobs::default();
            let db = std::sync::Arc::new(std::sync::Mutex::new(crate::db::open_in_memory().unwrap()));
            let tmp = tempfile::tempdir().unwrap();
            let root = tmp.path().to_path_buf();
            let id = jobs.start(db, "playground_compare", None, "t".into(), COMPARE_STEPS, move |job| compare_in_job(job, &x, &y, &root, None));
            loop {
                let v = jobs.get(id).unwrap();
                if v.status != "running" && v.run_id.is_some() {
                    drop(tmp);
                    return v;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        };
        let v = go(a.clone(), b);
        assert_eq!(v.summary["sameOutput"], true, "{}", v.log);
        assert_eq!(v.summary["verdict"]["faster"], "b", "{} {} {} {}", v.summary["verdict"], v.summary["bench_a"], v.summary["bench_b"], v.summary["run_a"]);
        assert_eq!(v.summary["verdict"]["significant"], true);
        let w = go(a, c);
        assert_eq!(w.summary["sameOutput"], false);
        assert_eq!(w.status, "warning");
    }

    #[test]
    fn a_second_build_reuses_objects_and_runs_are_timed() {
        if !ready() {
            return;
        }
        let objs = tempfile::tempdir().unwrap();
        let f = |n: &str, c: &str| DraftFile { name: n.into(), content: c.into(), library: None };
        let files = vec![f("main.c", "int twice(int x);\nint main(void)\n{\n    return twice(0);\n}\n"), f("twice.c", "int twice(int x)\n{\n    return x * 2;\n}\n")];
        let first = run_cached(files.clone(), DraftSettings::default(), objs.path().to_path_buf());
        let b = &first.summary["compile"]["build"];
        assert_eq!((b["mode"].as_str(), b["compiled"].as_u64()), (Some("full"), Some(2)), "{}", first.log);
        // Only main.c changes: twice.o comes from the cache.
        let mut changed = files.clone();
        changed[0].content.push_str("/* edit */\n");
        let second = run_cached(changed, DraftSettings::default(), objs.path().to_path_buf());
        let b = &second.summary["compile"]["build"];
        assert_eq!((b["mode"].as_str(), b["cached"].as_u64(), b["compiled"].as_u64()), (Some("incremental"), Some(1), Some(1)), "{}", second.log);
        // A fast program is timed several times through the helper.
        let bench = &second.summary["bench"];
        // Repeated (how many depends on the machine load: each run relaunches the sandbox).
        assert!(bench["runs"].as_u64().unwrap() >= 3, "{bench}");
        assert!(bench["wall"]["median"].as_f64().unwrap() >= 0.0);
        assert!(bench["maxRssKb"].as_u64().unwrap() > 0);
    }

    #[test]
    fn a_program_compiles_reads_stdin_and_gets_its_arguments() {
        if !ready() {
            return;
        }
        let src = "#include <stdio.h>\nint main(int ac, char **av) { char b[64]; if (fgets(b, 64, stdin)) printf(\"in=%s\", b); printf(\"arg=%s\\n\", ac > 1 ? av[1] : \"-\"); fprintf(stderr, \"to stderr\\n\"); return 2; }\n";
        let v = run(vec![f("main.c", src)], DraftSettings { args: "\"deux mots\"".into(), stdin: "salut\n".into(), ..Default::default() });
        let r = &v.summary["run"];
        assert_eq!(r["stdout"], "in=salut\narg=deux mots\n", "{}", v.log);
        assert_eq!(r["stderr"], "to stderr\n");
        assert_eq!(r["exitCode"], 2);
        assert_eq!(v.status, "warning");
    }

    #[test]
    fn compile_errors_are_structured() {
        if !ready() {
            return;
        }
        let v = run(vec![f("main.c", "int main(void)\n{\n    int x\n    return 0;\n}\n")], DraftSettings::default());
        assert_eq!(v.status, "failed");
        let d = v.summary["compile"]["diagnostics"].as_array().unwrap();
        assert!(d.iter().any(|x| x["file"] == "main.c" && x["severity"] == "error" && x["line"] == 4), "{d:?}");
        assert_eq!(v.steps[1].status, "skipped");
    }

    #[test]
    fn crashes_loops_and_sanitizers() {
        if !ready() {
            return;
        }
        let seg = run(vec![f("main.c", "int main(void) { int *p = 0; return *p; }\n")], DraftSettings { flags: "-O0".into(), ..Default::default() });
        assert_eq!(seg.summary["run"]["signal"], 11, "{}", seg.log);
        let lp = run(vec![f("main.c", "int main(void) { for (;;) ; }\n")], DraftSettings { timeout_s: 1, ..Default::default() });
        // Stopped either way: by the clock, or by the CPU limit on a loaded machine.
        assert!(lp.summary["run"]["timedOut"] == true || lp.summary["run"]["signal"] == 24, "{}", lp.summary["run"]);
        let asan = run(vec![f("main.c", "#include <stdlib.h>\nint main(void) { int *t = malloc(4 * sizeof(int)); t[4] = 1; free(t); return 0; }\n")], DraftSettings { asan: true, ..Default::default() });
        let mem = asan.summary["run"]["memory"].as_array().unwrap();
        assert!(mem.iter().any(|m| m["kind"] == "heap-buffer-overflow" && m["at"]["line"] == 2), "{mem:?}\n{}", asan.log);
    }

    #[test]
    fn leaks_are_found_by_leak_sanitizer_and_valgrind() {
        if !ready() {
            return;
        }
        let src = "#include <stdlib.h>\nint main(void)\n{\n    char *p = malloc(32);\n    p[0] = 1;\n    return 0;\n}\n";
        let lsan = run(vec![f("main.c", src)], DraftSettings { asan: true, ..Default::default() });
        let mem = lsan.summary["run"]["memory"].as_array().unwrap();
        assert!(mem.iter().any(|m| m["tool"] == "lsan" && m["bytes"] == 32 && m["at"]["line"] == 4), "{mem:?}\n{}", lsan.log);
        if crate::toolenv::which("valgrind").is_none() {
            return;
        }
        let vg = run(vec![f("main.c", src)], DraftSettings { valgrind: true, ..Default::default() });
        assert_eq!(vg.summary["run"]["valgrind"]["definitelyLost"], 32, "{}", vg.log);
        let mem = vg.summary["run"]["memory"].as_array().unwrap();
        assert!(mem.iter().any(|m| m["tool"] == "valgrind" && m["at"]["line"] == 4), "{mem:?}");
    }
}
