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
    if !["gcc", "clang", "epiclang"].contains(&s.compiler.as_str()) {
        return Err(AppError::new("invalid_compiler", "Compilateurs possibles : gcc, clang, epiclang"));
    }
    let mut argv = vec![s.compiler.clone()];
    if !s.flags.trim().is_empty() {
        argv.extend(crate::jobs::split_command(&s.flags)?);
    }
    if argv.iter().skip(1).any(|a| a == "-o" || a.starts_with("-o")) {
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

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CompileReport {
    pub ok: bool,
    pub command: String,
    pub output: String,
    pub diagnostics: Vec<Diagnostic>,
    pub duration_ms: u64,
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

/// Compiles and runs a draft in `root` (a fresh folder). Steps `compile`, `run`.
pub fn run_in_job(job: &Job, draft_id: i64, files: &[DraftFile], s: &DraftSettings, root: &Path) -> Result<&'static str> {
    let work = root.join("src");
    materialize(files, &work)?;
    let work_s = work.to_string_lossy().into_owned();
    job.set("draftId", draft_id);
    job.set("snapshot", serde_json::json!({ "files": files, "settings": s }));

    job.start("compile");
    let program = ".tekboard-prog";
    let argv = compile_argv(files, s, program)?;
    let shown = argv.join(" ");
    let compile_limits = Limits { wall: Duration::from_secs(60), cpu_seconds: 60, file_mb: 256, output_cap: OUTPUT_KEEP, mem_mb: Some(2048), tasks: Some(128), address_space_free: false };
    let wrapped = sandbox::wrap_argv(&work, &argv, &[], &compile_limits)?;
    job.log(&format!("$ {shown}"));
    let o = job.run_opts(&RunOpts { argv: &wrapped, cwd: &work, timeout: compile_limits.wall, envs: &[], log_output: false, stdin: None, split_streams: true }, &mut |l| job.log(l))?;
    let diagnostics = cdiag::compiler(&o.stderr, &work_s);
    let ok = o.code == Some(0) && work.join(program).exists();
    let (output, _) = keep(&o.stderr);
    let compile = CompileReport { ok, command: shown, output, diagnostics: diagnostics.clone(), duration_ms: o.duration_ms };
    job.set("compile", &compile);
    if o.cancelled {
        job.end("compile", "cancelled", None);
        return Ok("cancelled");
    }
    let warnings = diagnostics.iter().filter(|d| d.severity == "warning").count();
    if !ok {
        let errors = diagnostics.iter().filter(|d| d.severity == "error").count().max(1);
        job.end("compile", "failed", Some(format!("{errors} erreur(s)")));
        job.skip("run", "la compilation a échoué");
        return Ok("failed");
    }
    job.end("compile", if warnings > 0 { "warning" } else { "success" }, Some(if warnings > 0 { format!("{warnings} avertissement(s)") } else { "aucun avertissement".into() }));

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
    Ok(if status == "success" && warnings > 0 { "warning" } else { status })
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
        let id = jobs.start(db, "playground", None, "t".into(), &[("compile", "Compilation"), ("run", "Exécution")], move |job| run_in_job(job, 1, &files, &s, &root));
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
