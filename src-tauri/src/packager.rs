//! “Package for AI”: a zip of a project that is safe to hand to an assistant.
//! Secret-looking files never go in, whatever is asked; everything else is previewed first.
//! The archive is only written to disk: TekBoard never sends it anywhere.

use crate::error::{AppError, Result};
use crate::git;
use crate::testing;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};

const SKIP_DIRS: &[&str] = &[".git", "node_modules", "target", "dist", "build", ".venv", "venv", "env", "__pycache__", ".cache", ".idea", ".vscode", "coverage", ".pytest_cache", ".mypy_cache", ".gradle", ".next"];
const PRODUCT_EXT: &[&str] = &["o", "a", "so", "obj", "gcda", "gcno", "gcov", "pyc", "class", "exe", "dll", "dylib", "d"];
const JUNK_EXT: &[&str] = &["log", "tmp", "swp", "bak", "orig"];
const SOURCE_EXT: &[&str] = &["c", "h", "cpp", "hpp", "cc", "hh", "py", "js", "ts", "tsx", "jsx", "rs", "go", "java", "sh", "mk", "cmake", "md", "txt", "json", "toml", "yaml", "yml", "ini", "cfg", "html", "css", "sql", "asm", "s", "hs", "lua"];
const SOURCE_NAMES: &[&str] = &["Makefile", "CMakeLists.txt", "Dockerfile", ".gitignore", "LICENSE", "README"];
const MAX_FILE: u64 = 5 * 1024 * 1024;
const MAX_FILES: usize = 20_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub path: String,
    pub size: u64,
    pub included: bool,
    /// Why it is left out (empty when included).
    pub reason: String,
    /// Looks like a secret: can never be included.
    pub sensitive: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub mode: String,
    pub entries: Vec<Entry>,
    pub included: usize,
    pub included_size: u64,
    pub sensitive: usize,
    /// Folders skipped whole, with the reason.
    pub skipped_dirs: Vec<String>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Options {
    /// `source`, `full` or `context`.
    pub mode: String,
    /// Paths the user unticked.
    pub exclude: Vec<String>,
    /// Paths the user ticked although a default rule left them out (never applies to secrets).
    pub include: Vec<String>,
}

fn ext(name: &str) -> &str {
    name.rsplit_once('.').map(|(_, e)| e).unwrap_or("")
}

/// File names that usually hold credentials.
pub fn sensitive_name(name: &str) -> bool {
    let n = name.to_lowercase();
    n == ".env" || n.starts_with(".env.") || n == ".netrc" || n == ".npmrc" || n == ".pypirc" || n == ".htpasswd" || n.starts_with("id_rsa") || n.starts_with("id_ed25519") || n.starts_with("id_ecdsa") || n.starts_with("credentials") || n.starts_with("secrets.") || n == "secret" || matches!(ext(&n), "pem" | "key" | "p12" | "pfx" | "kdbx" | "keystore" | "jks")
}

fn run_of(text: &str, start: usize, ok: impl Fn(char) -> bool) -> usize {
    text[start..].chars().take_while(|c| ok(*c)).count()
}

/// Looks for well-known credential shapes. Returns what was recognised, never the value.
pub fn secret_in(text: &str) -> Option<&'static str> {
    if text.contains("PRIVATE KEY-----") {
        return Some("private key");
    }
    let alnum = |c: char| c.is_ascii_alphanumeric() || c == '_' || c == '-';
    for (prefix, min, what) in [("ghp_", 30, "GitHub token"), ("gho_", 30, "GitHub token"), ("github_pat_", 30, "GitHub token"), ("sk-ant-", 30, "Anthropic API key"), ("sk-proj-", 30, "OpenAI API key"), ("xoxb-", 20, "Slack token"), ("xoxp-", 20, "Slack token"), ("AKIA", 16, "AWS access key"), ("AIza", 30, "Google API key")] {
        let mut from = 0;
        while let Some(i) = text[from..].find(prefix) {
            let at = from + i + prefix.len();
            if run_of(text, at, alnum) >= min {
                return Some(what);
            }
            from = at;
        }
    }
    None
}

fn is_elf(path: &Path) -> bool {
    use std::io::Read;
    let mut m = [0u8; 4];
    std::fs::File::open(path).and_then(|mut f| f.read_exact(&mut m)).is_ok() && m == [0x7f, b'E', b'L', b'F']
}

fn is_source(name: &str) -> bool {
    SOURCE_EXT.contains(&ext(name).to_lowercase().as_str()) || SOURCE_NAMES.iter().any(|s| name == *s || name.starts_with(&format!("{s}.")))
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<(String, u64)>, skipped: &mut Vec<String>) {
    if out.len() >= MAX_FILES {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        let Ok(ft) = e.file_type() else { continue };
        let name = e.file_name().to_string_lossy().into_owned();
        let rel = e.path().strip_prefix(root).map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
        if ft.is_symlink() {
            continue;
        }
        if ft.is_dir() {
            if SKIP_DIRS.contains(&name.as_str()) {
                skipped.push(format!("{rel}/"));
            } else {
                walk(root, &e.path(), out, skipped);
            }
        } else if ft.is_file() {
            out.push((rel, e.metadata().map(|m| m.len()).unwrap_or(0)));
        }
    }
}

pub fn preview(repo: &Path, opts: &Options) -> Result<Preview> {
    if !matches!(opts.mode.as_str(), "source" | "full" | "context") {
        return Err(AppError::new("invalid_mode", "Unknown export mode"));
    }
    let source_only = opts.mode != "full";
    let (mut files, mut skipped_dirs) = (Vec::new(), Vec::new());
    walk(repo, repo, &mut files, &mut skipped_dirs);
    let truncated = files.len() >= MAX_FILES;
    let mut entries = Vec::with_capacity(files.len());
    for (path, size) in files {
        let name = path.rsplit('/').next().unwrap_or(&path).to_string();
        let abs = repo.join(&path);
        let e = ext(&name).to_lowercase();
        let mut sensitive = sensitive_name(&name);
        let mut reason = String::new();
        if sensitive {
            reason = "looks like a secret (file name)".into();
        } else if size > MAX_FILE {
            reason = "larger than 5 MB".into();
        } else if PRODUCT_EXT.contains(&e.as_str()) || name.starts_with("vgcore.") || is_elf(&abs) {
            reason = "build product".into();
        } else if JUNK_EXT.contains(&e.as_str()) || name.ends_with('~') {
            reason = "log or temporary file".into();
        } else if source_only && !is_source(&name) {
            reason = "not source code (included by the Full project mode)".into();
        }
        // Text that will go out is scanned for credentials, whatever its name.
        if reason.is_empty() && size <= 1024 * 1024 {
            if let Some(what) = std::fs::read(&abs).ok().and_then(|b| secret_in(&String::from_utf8_lossy(&b))) {
                sensitive = true;
                reason = format!("contains what looks like a {what}");
            }
        }
        if !sensitive {
            if opts.exclude.contains(&path) {
                reason = "left out by you".into();
            } else if opts.include.contains(&path) && size <= MAX_FILE * 4 {
                reason.clear();
            }
        }
        entries.push(Entry { included: reason.is_empty(), path, size, reason, sensitive });
    }
    Ok(Preview { mode: opts.mode.clone(), included: entries.iter().filter(|e| e.included).count(), included_size: entries.iter().filter(|e| e.included).map(|e| e.size).sum(), sensitive: entries.iter().filter(|e| e.sensitive).count(), entries, skipped_dirs, truncated })
}

/// Indented tree of the given paths.
pub fn file_tree(paths: &[String]) -> String {
    let mut out = String::new();
    let mut prev: Vec<&str> = Vec::new();
    for p in paths {
        let parts: Vec<&str> = p.split('/').collect();
        let common = prev.iter().zip(&parts).take_while(|(a, b)| a == b).count().min(parts.len() - 1);
        for (depth, part) in parts.iter().enumerate().skip(common) {
            out.push_str(&"  ".repeat(depth));
            out.push_str(part);
            if depth + 1 < parts.len() {
                out.push('/');
            }
            out.push('\n');
        }
        prev = parts;
    }
    out
}

fn languages(paths: &[String]) -> Vec<(String, usize)> {
    let mut m: BTreeMap<&str, usize> = BTreeMap::new();
    for p in paths {
        let lang = match ext(p).to_lowercase().as_str() {
            "c" | "h" => "C",
            "cpp" | "hpp" | "cc" | "hh" => "C++",
            "py" => "Python",
            "rs" => "Rust",
            "js" | "jsx" => "JavaScript",
            "ts" | "tsx" => "TypeScript",
            "sh" => "Shell",
            "go" => "Go",
            "java" => "Java",
            "hs" => "Haskell",
            "asm" | "s" => "Assembly",
            _ => continue,
        };
        *m.entry(lang).or_default() += 1;
    }
    let mut v: Vec<(String, usize)> = m.into_iter().map(|(k, n)| (k.to_string(), n)).collect();
    v.sort_by(|a, b| b.1.cmp(&a.1));
    v
}

/// Facts about the project, for an assistant that has never seen it. Nothing personal goes in.
pub fn project_context(repo: &Path, name: &str, paths: &[String], last_runs: &[(String, String, String)]) -> String {
    let mut md = format!("# {name} — project context\n\nGenerated by TekBoard from the repository itself. Every line below was read from the files or measured; nothing is assumed.\n\n");
    let langs = languages(paths);
    md.push_str("## Languages\n\n");
    if langs.is_empty() {
        md.push_str("No recognised source file.\n");
    }
    for (l, n) in &langs {
        md.push_str(&format!("- {l}: {n} file(s)\n"));
    }
    md.push_str("\n## Structure\n\n");
    let mut tops: BTreeMap<&str, usize> = BTreeMap::new();
    for p in paths {
        *tops.entry(p.split_once('/').map(|(d, _)| d).unwrap_or("(root)")).or_default() += 1;
    }
    for (d, n) in &tops {
        md.push_str(&format!("- `{d}`: {n} file(s)\n"));
    }
    md.push_str("\nThe complete list is in FILE_TREE.txt.\n\n## Build\n\n");
    match std::fs::read_to_string(repo.join("Makefile")) {
        Ok(mk) => {
            let targets = testing::make_targets(&mk);
            md.push_str(&format!("Makefile rules: {}.\n", if targets.is_empty() { "none recognised".to_string() } else { targets.iter().map(|t| format!("`{t}`")).collect::<Vec<_>>().join(", ") }));
            if let Some(n) = crate::testrepo::makefile_name(&mk) {
                md.push_str(&format!("Binary: `{n}`.\n"));
            }
            for var in ["CC", "CFLAGS", "LDFLAGS", "LDLIBS"] {
                if let Some(line) = mk.lines().find(|l| l.trim_start().starts_with(var) && l[var.len()..].trim_start().starts_with(['=', ':', '+', '?'])) {
                    md.push_str(&format!("- `{}`\n", line.split_whitespace().collect::<Vec<_>>().join(" ")));
                }
            }
        }
        Err(_) if repo.join("CMakeLists.txt").is_file() => md.push_str("CMake project (CMakeLists.txt at the root).\n"),
        Err(_) => md.push_str("No Makefile at the root.\n"),
    }
    md.push_str("\n## Tests\n\n");
    let d = testing::detect(repo);
    if d.suites.is_empty() {
        md.push_str("No test command was found.\n");
    }
    for s in &d.suites {
        md.push_str(&format!("- `{}`\n", s.command));
    }
    if !d.frameworks.is_empty() {
        md.push_str(&format!("\nFramework: {}. Test files: {}.\n", d.frameworks.join(", "), d.test_files));
    }
    md.push_str("\n## Known state\n\n");
    if let Ok(st) = git::status(repo) {
        md.push_str(&format!("- Git branch: `{}`; {} modified and {} untracked file(s) at export time.\n", st.branch.as_deref().unwrap_or("detached"), st.staged + st.unstaged, st.untracked));
    }
    if last_runs.is_empty() {
        md.push_str("- No build or test was run from TekBoard yet.\n");
    }
    for (kind, status, title) in last_runs {
        md.push_str(&format!("- Last {kind}: {status} ({title}).\n"));
    }
    md
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Package {
    pub path: String,
    pub dir: String,
    pub files: usize,
    pub size: u64,
}

/// Writes the archive into `out_dir`. `last_runs`: (kind, status, title) of recent runs, for the context pack.
pub fn create(repo: &Path, opts: &Options, out_dir: &Path, last_runs: &[(String, String, String)]) -> Result<Package> {
    let p = preview(repo, opts)?;
    let chosen: Vec<&Entry> = p.entries.iter().filter(|e| e.included && !e.sensitive).collect();
    if chosen.is_empty() {
        return Err(AppError::new("empty_package", "No file is selected"));
    }
    let name: String = repo.file_name().map(|n| n.to_string_lossy().chars().map(|c| if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') { c } else { '_' }).collect()).unwrap_or_else(|| "project".into());
    std::fs::create_dir_all(out_dir)?;
    let suffix = match opts.mode.as_str() {
        "context" => "ai-pack",
        "full" => "full",
        _ => "source",
    };
    let path: PathBuf = out_dir.join(format!("{name}-{suffix}-{}.zip", chrono::Local::now().format("%Y%m%d-%H%M%S")));
    let file = std::fs::OpenOptions::new().write(true).create_new(true).open(&path)?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let zerr = |e: zip::result::ZipError| AppError::new("zip_failed", e.to_string());
    let context = opts.mode == "context";
    let prefix = if context { format!("{name}/source/") } else { format!("{name}/") };
    for e in &chosen {
        // Re-read from disk now; a file that vanished since the preview is simply absent.
        let Ok(bytes) = std::fs::read(repo.join(&e.path)) else { continue };
        zip.start_file(format!("{prefix}{}", e.path), options).map_err(zerr)?;
        zip.write_all(&bytes)?;
    }
    if context {
        let paths: Vec<String> = chosen.iter().map(|e| e.path.clone()).collect();
        let mut extra = |n: &str, body: String| -> Result<()> {
            zip.start_file(format!("{name}/{n}"), options).map_err(zerr)?;
            zip.write_all(body.as_bytes())?;
            Ok(())
        };
        extra("PROJECT_CONTEXT.md", project_context(repo, &name, &paths, last_runs))?;
        extra("FILE_TREE.txt", file_tree(&paths))?;
        let manifest = serde_json::json!({
            "project": name,
            "generatedAt": chrono::Utc::now().to_rfc3339(),
            "mode": opts.mode,
            "files": chosen.iter().map(|e| serde_json::json!({ "path": e.path, "size": e.size })).collect::<Vec<_>>(),
            "excluded": p.entries.iter().filter(|e| !e.included).map(|e| serde_json::json!({ "path": e.path, "reason": e.reason })).collect::<Vec<_>>(),
            "skippedFolders": p.skipped_dirs,
        });
        extra("manifest.json", serde_json::to_string_pretty(&manifest)?)?;
        if let Ok(readme) = std::fs::read(repo.join("README.md")) {
            zip.start_file(format!("{name}/README.md"), options).map_err(zerr)?;
            zip.write_all(&readme)?;
        }
    }
    zip.finish().map_err(zerr)?;
    let size = path.metadata().map(|m| m.len()).unwrap_or(0);
    Ok(Package { path: path.to_string_lossy().into_owned(), dir: out_dir.to_string_lossy().into_owned(), files: chosen.len(), size })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn project(root: &Path) {
        for d in ["src", "node_modules/x", ".git", "assets"] {
            fs::create_dir_all(root.join(d)).unwrap();
        }
        fs::write(root.join("Makefile"), "NAME = prog\nCC = epiclang\nall:\ntests_run:\n").unwrap();
        fs::write(root.join("src/main.c"), "int main(void)\n{\n    return 0;\n}\n").unwrap();
        fs::write(root.join("src/main.o"), "obj").unwrap();
        fs::write(root.join(".env"), "TOKEN=abc").unwrap();
        fs::write(root.join("src/config.h"), format!("#define KEY \"ghp_{}\"\n", "a".repeat(36))).unwrap();
        fs::write(root.join("assets/sprite.png"), [0x89, b'P', b'N', b'G']).unwrap();
        fs::write(root.join("node_modules/x/i.js"), "x").unwrap();
        fs::write(root.join(".git/config"), "x").unwrap();
        fs::write(root.join("debug.log"), "x").unwrap();
        fs::write(root.join("prog"), [0x7f, b'E', b'L', b'F', 0, 0]).unwrap();
    }

    fn opts(mode: &str) -> Options {
        Options { mode: mode.into(), ..Default::default() }
    }

    fn names(root: &Path, o: &Options) -> Vec<String> {
        preview(root, o).unwrap().entries.into_iter().filter(|e| e.included).map(|e| e.path).collect()
    }

    #[test]
    fn default_exclusions_and_modes() {
        let tmp = tempfile::tempdir().unwrap();
        project(tmp.path());
        assert_eq!(names(tmp.path(), &opts("source")), vec!["Makefile", "src/main.c"]);
        assert_eq!(names(tmp.path(), &opts("full")), vec!["Makefile", "assets/sprite.png", "src/main.c"]);
        let p = preview(tmp.path(), &opts("full")).unwrap();
        assert_eq!(p.skipped_dirs, vec![".git/", "node_modules/"]);
        assert_eq!(p.sensitive, 2);
        let reason = |path: &str| p.entries.iter().find(|e| e.path == path).unwrap().reason.clone();
        assert_eq!(reason("src/main.o"), "build product");
        assert_eq!(reason("prog"), "build product");
        assert!(reason("src/config.h").contains("GitHub token"));
        assert!(reason(".env").contains("secret"));
    }

    #[test]
    fn user_choices_apply_but_secrets_never_go_in() {
        let tmp = tempfile::tempdir().unwrap();
        project(tmp.path());
        let o = Options { mode: "source".into(), exclude: vec!["Makefile".into()], include: vec!["assets/sprite.png".into(), ".env".into(), "src/config.h".into()] };
        assert_eq!(names(tmp.path(), &o), vec!["assets/sprite.png", "src/main.c"]);
    }

    #[test]
    fn context_pack_has_the_documents_and_no_secret() {
        use std::io::Read;
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("my_proj");
        fs::create_dir_all(&root).unwrap();
        project(&root);
        let out = tmp.path().join("out");
        let pkg = create(&root, &opts("context"), &out, &[("build".into(), "success".into(), "make".into())]).unwrap();
        assert_eq!(pkg.files, 2);
        let mut zip = zip::ZipArchive::new(fs::File::open(&pkg.path).unwrap()).unwrap();
        let mut list: Vec<String> = zip.file_names().map(|n| n.unwrap().to_string()).collect();
        list.sort();
        assert_eq!(list, vec!["my_proj/FILE_TREE.txt", "my_proj/PROJECT_CONTEXT.md", "my_proj/manifest.json", "my_proj/source/Makefile", "my_proj/source/src/main.c"]);
        let mut ctx = String::new();
        zip.by_name("my_proj/PROJECT_CONTEXT.md").unwrap().read_to_string(&mut ctx).unwrap();
        assert!(ctx.contains("- C: 1 file(s)") && ctx.contains("`tests_run`") && ctx.contains("Binary: `prog`") && ctx.contains("`CC = epiclang`") && ctx.contains("Last build: success"));
        let mut all = String::new();
        for i in 0..zip.len() {
            let _ = zip.by_index(i).unwrap().read_to_string(&mut all);
        }
        assert!(!all.contains("ghp_") && !all.contains("TOKEN=abc"));
        assert!(all.contains("\"reason\": \"looks like a secret (file name)\""));
    }

    #[test]
    fn secret_shapes_and_tree() {
        assert_eq!(secret_in("-----BEGIN OPENSSH PRIVATE KEY-----"), Some("private key"));
        assert_eq!(secret_in("x = AKIAIOSFODNN7EXAMPLE"), Some("AWS access key"));
        assert_eq!(secret_in("ghp_short and sk-ant-nope"), None);
        assert!(sensitive_name("id_rsa.pub") && sensitive_name(".env.local") && sensitive_name("server.pem") && !sensitive_name("environment.c"));
        assert_eq!(file_tree(&["Makefile".into(), "src/a.c".into(), "src/lib/b.c".into()]), "Makefile\nsrc/\n  a.c\n  lib/\n    b.c\n");
    }
}
