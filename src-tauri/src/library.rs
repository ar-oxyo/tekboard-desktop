//! Library manager: reusable C libraries (any folder, any layout), a function catalog built
//! with a real parser, and selective install / update / removal inside a project.
//!
//! Nothing is written into the project to track installs: the record lives in TekBoard's
//! database, so a repository never gains a file the school's checks could object to.

use crate::cparse::{self, CFile};
use crate::error::{AppError, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Component, Path, PathBuf};

// ───────────────────────────── small shared helpers ─────────────────────────────

/// A relative path with no `..`, no root, no empty part.
pub fn safe_rel(rel: &str) -> Result<PathBuf> {
    let p = Path::new(rel);
    if rel.is_empty() || rel.contains('\0') || !p.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err(AppError::new("invalid_path", format!("“{rel}” is not a valid relative path")));
    }
    Ok(p.to_path_buf())
}

pub fn sha(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

pub fn unified(old: &str, new: &str, label: &str) -> String {
    similar::TextDiff::from_lines(old, new).unified_diff().context_radius(3).header(&format!("a/{label}"), &format!("b/{label}")).to_string()
}

/// `dest` must stay inside `root` once symlinks are resolved.
pub fn ensure_inside(root: &Path, dest: &Path) -> Result<()> {
    let mut probe = dest.to_path_buf();
    while !probe.exists() {
        if !probe.pop() {
            break;
        }
    }
    let canon = std::fs::canonicalize(&probe)?;
    let root = std::fs::canonicalize(root)?;
    if !canon.starts_with(&root) {
        return Err(AppError::new("outside_target", format!("{} leaves the project folder", dest.display())));
    }
    if dest.symlink_metadata().map(|m| m.file_type().is_symlink()).unwrap_or(false) {
        return Err(AppError::new("outside_target", format!("{} is a symbolic link", dest.display())));
    }
    Ok(())
}

fn read_text(path: &Path) -> Result<String> {
    Ok(String::from_utf8_lossy(&std::fs::read(path)?).into_owned())
}

fn parent_of(rel: &str) -> &str {
    rel.rsplit_once('/').map(|(d, _)| d).unwrap_or("")
}

fn base_of(rel: &str) -> &str {
    rel.rsplit('/').next().unwrap_or(rel)
}

const MAX_FILE: u64 = 1024 * 1024;
const MAX_FILES: usize = 4000;

/// `.c`, `.h` and Makefiles under `root`, as `/`-separated relative paths. Symlinks are not followed.
fn walk(root: &Path) -> Vec<String> {
    fn rec(root: &Path, dir: &Path, depth: usize, out: &mut Vec<String>) {
        if depth > 8 || out.len() >= MAX_FILES {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        let mut entries: Vec<_> = entries.flatten().collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let name = e.file_name().to_string_lossy().into_owned();
            let Ok(ft) = e.file_type() else { continue };
            if name.starts_with('.') || ft.is_symlink() {
                continue;
            }
            let path = e.path();
            if ft.is_dir() {
                rec(root, &path, depth + 1, out);
            } else if ft.is_file() && (name.ends_with(".c") || name.ends_with(".h") || name == "Makefile") && e.metadata().map(|m| m.len() <= MAX_FILE).unwrap_or(false) {
                if let Ok(rel) = path.strip_prefix(root) {
                    out.push(rel.to_string_lossy().replace('\\', "/"));
                }
            }
        }
    }
    let mut out = Vec::new();
    rec(root, root, 0, &mut out);
    out
}

// ───────────────────────────── registered libraries ─────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Library {
    pub id: i64,
    pub name: String,
    pub path: String,
    pub created_at: i64,
}

pub fn list(conn: &Connection) -> Result<Vec<Library>> {
    let mut st = conn.prepare("SELECT id, name, path, created_at FROM libraries ORDER BY name COLLATE NOCASE")?;
    let rows = st.query_map([], |r| Ok(Library { id: r.get(0)?, name: r.get(1)?, path: r.get(2)?, created_at: r.get(3)? }))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

pub fn get(conn: &Connection, id: i64) -> Result<Library> {
    conn.query_row("SELECT id, name, path, created_at FROM libraries WHERE id = ?1", [id], |r| Ok(Library { id: r.get(0)?, name: r.get(1)?, path: r.get(2)?, created_at: r.get(3)? }))
        .optional()?
        .ok_or_else(|| AppError::new("unknown_library", "This library is no longer registered"))
}

pub fn add(conn: &Connection, name: &str, path: &Path, now: i64) -> Result<Library> {
    let name = name.trim();
    if name.is_empty() || name.len() > 60 {
        return Err(AppError::new("invalid_name", "Give the library a name (60 characters at most)"));
    }
    let canon = std::fs::canonicalize(path).map_err(|_| AppError::new("invalid_target", format!("{} does not exist", path.display())))?;
    if !canon.is_dir() {
        return Err(AppError::new("invalid_target", "A library is a folder"));
    }
    let path_s = canon.to_string_lossy().into_owned();
    let exists: Option<i64> = conn.query_row("SELECT id FROM libraries WHERE name = ?1 OR path = ?2", params![name, path_s], |r| r.get(0)).optional()?;
    if exists.is_some() {
        return Err(AppError::new("already_exists", "A library with this name or this folder is already registered"));
    }
    conn.execute("INSERT INTO libraries (name, path, created_at) VALUES (?1, ?2, ?3)", params![name, path_s, now])?;
    get(conn, conn.last_insert_rowid())
}

/// Forgets the library. Its files and the projects that use it are left alone.
pub fn unregister(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM libraries WHERE id = ?1", [id])?;
    conn.execute("DELETE FROM lib_meta WHERE library_id = ?1", [id])?;
    conn.execute("DELETE FROM lib_presets WHERE library_id = ?1", [id])?;
    conn.execute("DELETE FROM lib_installs WHERE library_id = ?1", [id])?;
    Ok(())
}

/// Copies the sources of a folder (`.c`, `.h`, Makefile) into `dest`, which must not exist.
pub fn copy_sources(src: &Path, dest: &Path) -> Result<usize> {
    if dest.exists() {
        return Err(AppError::new("already_exists", format!("{} already exists", dest.display())));
    }
    let files = walk(src);
    if files.is_empty() {
        return Err(AppError::new("empty_library", "No .c or .h file was found in this folder"));
    }
    for rel in &files {
        let to = dest.join(rel);
        if let Some(p) = to.parent() {
            std::fs::create_dir_all(p)?;
        }
        std::fs::copy(src.join(rel), to)?;
    }
    Ok(files.len())
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Meta {
    pub description: Option<String>,
    pub tags: Vec<String>,
    /// Files this one needs, declared by hand.
    pub deps: Vec<String>,
}

pub fn all_meta(conn: &Connection, library_id: i64) -> Result<HashMap<String, Meta>> {
    let mut st = conn.prepare("SELECT rel, data FROM lib_meta WHERE library_id = ?1")?;
    let rows = st.query_map([library_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    let mut out = HashMap::new();
    for row in rows {
        let (rel, data) = row?;
        out.insert(rel, serde_json::from_str(&data).unwrap_or_default());
    }
    Ok(out)
}

pub fn set_meta(conn: &Connection, library_id: i64, rel: &str, meta: &Meta) -> Result<()> {
    safe_rel(rel)?;
    for d in &meta.deps {
        safe_rel(d)?;
    }
    if *meta == Meta::default() {
        conn.execute("DELETE FROM lib_meta WHERE library_id = ?1 AND rel = ?2", params![library_id, rel])?;
    } else {
        conn.execute(
            "INSERT INTO lib_meta (library_id, rel, data) VALUES (?1, ?2, ?3) ON CONFLICT(library_id, rel) DO UPDATE SET data = excluded.data",
            params![library_id, rel, serde_json::to_string(meta)?],
        )?;
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub id: i64,
    pub name: String,
    pub files: Vec<String>,
}

pub fn presets(conn: &Connection, library_id: i64) -> Result<Vec<Preset>> {
    let mut st = conn.prepare("SELECT id, name, files FROM lib_presets WHERE library_id = ?1 ORDER BY name COLLATE NOCASE")?;
    let rows = st.query_map([library_id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))?;
    let mut out = Vec::new();
    for row in rows {
        let (id, name, files) = row?;
        out.push(Preset { id, name, files: serde_json::from_str(&files).unwrap_or_default() });
    }
    Ok(out)
}

pub fn save_preset(conn: &Connection, library_id: i64, name: &str, files: &[String]) -> Result<()> {
    let name = name.trim();
    if name.is_empty() || files.is_empty() {
        return Err(AppError::new("invalid_name", "A preset needs a name and at least one file"));
    }
    conn.execute(
        "INSERT INTO lib_presets (library_id, name, files) VALUES (?1, ?2, ?3) ON CONFLICT(library_id, name) DO UPDATE SET files = excluded.files",
        params![library_id, name, serde_json::to_string(files)?],
    )?;
    Ok(())
}

pub fn delete_preset(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM lib_presets WHERE id = ?1", [id])?;
    Ok(())
}

// ───────────────────────────── catalog ─────────────────────────────

struct Scanned {
    text: String,
    hash: String,
    parsed: CFile,
}

struct Scan {
    files: BTreeMap<String, Scanned>,
    makefile: Option<String>,
}

fn scan(root: &Path) -> Result<Scan> {
    if !root.is_dir() {
        return Err(AppError::new("library_missing", format!("The library folder {} is gone", root.display())));
    }
    let mut files = BTreeMap::new();
    let mut makefile = None;
    for rel in walk(root) {
        let text = read_text(&root.join(&rel))?;
        if rel == "Makefile" {
            makefile = Some(text);
        } else if rel.ends_with(".c") || rel.ends_with(".h") {
            let parsed = cparse::parse(&text, &rel);
            files.insert(rel, Scanned { hash: sha(text.as_bytes()), parsed, text });
        }
    }
    Ok(Scan { files, makefile })
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Dep {
    pub rel: String,
    /// Function names that create the link (empty for a declared dependency).
    pub via: Vec<String>,
    /// `detected` (the parser saw the use and one file defines it), `ambiguous` (several files
    /// define it: the closest one is assumed), `declared` (added by hand).
    pub kind: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogFunction {
    pub name: String,
    pub signature: String,
    pub line: usize,
    pub doc: Option<String>,
    /// Library header that declares it, if any.
    pub header: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogFile {
    pub rel: String,
    /// Folder inside the library, `""` at its root.
    pub category: String,
    pub is_header: bool,
    pub functions: Vec<CatalogFunction>,
    pub static_functions: Vec<String>,
    pub headers: Vec<String>,
    pub deps: Vec<Dep>,
    pub description: Option<String>,
    pub tags: Vec<String>,
    /// Tags guessed from names; shown apart from the ones typed by hand.
    pub auto_tags: Vec<String>,
    pub declared_deps: Vec<String>,
    pub lines: usize,
    pub hash: String,
    pub parse_errors: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Duplicate {
    pub name: String,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub library: Library,
    pub files: Vec<CatalogFile>,
    pub has_makefile: bool,
    pub duplicates: Vec<Duplicate>,
    /// Groups of files that need each other.
    pub cycles: Vec<Vec<String>>,
}

fn auto_tags(rel: &str, names: &[&str]) -> Vec<String> {
    const RULES: &[(&str, &[&str])] = &[
        ("string", &["str", "char", "concat", "upper", "lower", "capital"]),
        ("memory", &["mem", "alloc", "free"]),
        ("linked list", &["list", "node"]),
        ("output", &["put", "print", "show", "emit"]),
        ("conversion", &["toa", "getnbr", "atoi", "to_"]),
        ("sort", &["sort", "swap", "rev"]),
        ("parsing", &["word_array", "split", "parse", "params"]),
        ("math", &["abs", "pow", "sqrt", "prime", "isneg"]),
    ];
    let mut hay: Vec<String> = names.iter().map(|n| n.to_lowercase()).collect();
    hay.push(base_of(rel).to_lowercase());
    let mut tags: Vec<String> = RULES.iter().filter(|(_, keys)| keys.iter().any(|k| hay.iter().any(|h| h.contains(k)))).map(|(t, _)| t.to_string()).collect();
    tags.dedup();
    tags
}

/// Finds the library header an `#include "x.h"` in `from` points at.
fn resolve_include(files: &BTreeMap<String, Scanned>, from: &str, include: &str) -> Option<String> {
    let dir = parent_of(from);
    let direct = if dir.is_empty() { include.to_string() } else { format!("{dir}/{include}") };
    let direct = normalize_rel(&direct);
    if files.contains_key(&direct) {
        return Some(direct);
    }
    let base = base_of(include);
    files.keys().find(|k| k.ends_with(".h") && base_of(k) == base).cloned()
}

fn normalize_rel(rel: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for p in rel.split('/') {
        match p {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    parts.join("/")
}

fn build_catalog(library: &Library, scan: &Scan, meta: &HashMap<String, Meta>) -> Catalog {
    let mut definers: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    let mut declared_in: HashMap<&str, &str> = HashMap::new();
    for (rel, f) in &scan.files {
        if rel.ends_with(".c") {
            for func in f.parsed.exported() {
                definers.entry(func.name.as_str()).or_default().push(rel.as_str());
            }
        } else {
            for p in &f.parsed.prototypes {
                declared_in.entry(p.name.as_str()).or_insert(rel.as_str());
            }
        }
    }

    let mut files = Vec::new();
    for (rel, f) in &scan.files {
        let is_header = rel.ends_with(".h");
        let m = meta.get(rel).cloned().unwrap_or_default();
        let local: BTreeSet<&str> = f.parsed.functions.iter().map(|x| x.name.as_str()).collect();
        let mut by_file: BTreeMap<String, (BTreeSet<String>, bool)> = BTreeMap::new();
        for func in &f.parsed.functions {
            for r in &func.refs {
                if local.contains(r.as_str()) {
                    continue;
                }
                let Some(cands) = definers.get(r.as_str()) else { continue };
                let same_dir: Vec<&&str> = cands.iter().filter(|c| parent_of(c) == parent_of(rel)).collect();
                let (target, ambiguous) = match (cands.len(), same_dir.len()) {
                    (1, _) => (cands[0], false),
                    (_, 1) => (*same_dir[0], true),
                    _ => (cands[0], true),
                };
                if target == rel {
                    continue;
                }
                let e = by_file.entry(target.to_string()).or_default();
                e.0.insert(r.clone());
                e.1 |= ambiguous;
            }
        }
        let mut deps: Vec<Dep> = by_file.into_iter().map(|(rel, (via, amb))| Dep { rel, via: via.into_iter().collect(), kind: if amb { "ambiguous" } else { "detected" } }).collect();
        for d in &m.deps {
            if scan.files.contains_key(d) && d != rel && !deps.iter().any(|x| &x.rel == d) {
                deps.push(Dep { rel: d.clone(), via: vec![], kind: "declared" });
            }
        }
        let mut headers: Vec<String> = f.parsed.local_includes.iter().filter_map(|i| resolve_include(&scan.files, rel, i)).filter(|h| h != rel).collect();
        headers.sort();
        headers.dedup();
        let names: Vec<&str> = f.parsed.exported().map(|x| x.name.as_str()).collect();
        files.push(CatalogFile {
            category: parent_of(rel).to_string(),
            is_header,
            functions: if is_header {
                vec![]
            } else {
                f.parsed.exported().map(|x| CatalogFunction { name: x.name.clone(), signature: x.signature.clone(), line: x.line, doc: x.doc.clone(), header: declared_in.get(x.name.as_str()).map(|h| h.to_string()) }).collect()
            },
            static_functions: f.parsed.functions.iter().filter(|x| x.is_static).map(|x| x.name.clone()).collect(),
            headers,
            deps,
            description: m.description.clone().filter(|d| !d.trim().is_empty()).or_else(|| f.parsed.description.clone()),
            auto_tags: if is_header { vec![] } else { auto_tags(rel, &names) },
            tags: m.tags.clone(),
            declared_deps: m.deps.clone(),
            lines: f.text.lines().count(),
            hash: f.hash.clone(),
            parse_errors: f.parsed.has_errors,
            rel: rel.clone(),
        });
    }

    let duplicates = definers.iter().filter(|(_, v)| v.len() > 1).map(|(n, v)| Duplicate { name: n.to_string(), files: v.iter().map(|s| s.to_string()).collect() }).collect();
    let cycles = find_cycles(&files);
    Catalog { library: library.clone(), files, has_makefile: scan.makefile.is_some(), duplicates, cycles }
}

pub fn catalog(library: &Library, meta: &HashMap<String, Meta>) -> Result<Catalog> {
    Ok(build_catalog(library, &scan(Path::new(&library.path))?, meta))
}

/// Strongly connected groups of more than one file (Tarjan).
fn find_cycles(files: &[CatalogFile]) -> Vec<Vec<String>> {
    let index_of: HashMap<&str, usize> = files.iter().enumerate().map(|(i, f)| (f.rel.as_str(), i)).collect();
    let edges: Vec<Vec<usize>> = files.iter().map(|f| f.deps.iter().filter_map(|d| index_of.get(d.rel.as_str()).copied()).collect()).collect();
    struct T<'a> {
        edges: &'a [Vec<usize>],
        index: Vec<Option<usize>>,
        low: Vec<usize>,
        on: Vec<bool>,
        stack: Vec<usize>,
        next: usize,
        out: Vec<Vec<usize>>,
    }
    fn go(t: &mut T, v: usize) {
        t.index[v] = Some(t.next);
        t.low[v] = t.next;
        t.next += 1;
        t.stack.push(v);
        t.on[v] = true;
        for i in 0..t.edges[v].len() {
            let w = t.edges[v][i];
            match t.index[w] {
                None => {
                    go(t, w);
                    t.low[v] = t.low[v].min(t.low[w]);
                }
                Some(iw) if t.on[w] => t.low[v] = t.low[v].min(iw),
                _ => {}
            }
        }
        if Some(t.low[v]) == t.index[v] {
            let mut comp = Vec::new();
            while let Some(w) = t.stack.pop() {
                t.on[w] = false;
                comp.push(w);
                if w == v {
                    break;
                }
            }
            if comp.len() > 1 {
                t.out.push(comp);
            }
        }
    }
    let n = files.len();
    let mut t = T { edges: &edges, index: vec![None; n], low: vec![0; n], on: vec![false; n], stack: vec![], next: 0, out: vec![] };
    for v in 0..n {
        if t.index[v].is_none() {
            go(&mut t, v);
        }
    }
    t.out.into_iter().map(|c| {
        let mut names: Vec<String> = c.into_iter().map(|i| files[i].rel.clone()).collect();
        names.sort();
        names
    }).collect()
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Required {
    pub rel: String,
    /// The file that pulls it in.
    pub needed_by: String,
    pub via: Vec<String>,
    pub kind: &'static str,
}

/// Everything `selection` needs, transitively, minus `exclude`. Selected files are not repeated.
pub fn closure(catalog: &Catalog, selection: &[String], exclude: &BTreeSet<String>) -> Vec<Required> {
    let by_rel: HashMap<&str, &CatalogFile> = catalog.files.iter().map(|f| (f.rel.as_str(), f)).collect();
    let mut seen: BTreeSet<String> = selection.iter().cloned().collect();
    let mut queue: Vec<String> = selection.to_vec();
    let mut out = Vec::new();
    while let Some(rel) = queue.pop() {
        let Some(file) = by_rel.get(rel.as_str()) else { continue };
        for d in &file.deps {
            if exclude.contains(&d.rel) || !seen.insert(d.rel.clone()) {
                continue;
            }
            out.push(Required { rel: d.rel.clone(), needed_by: rel.clone(), via: d.via.clone(), kind: d.kind });
            queue.push(d.rel.clone());
        }
    }
    out.sort_by(|a, b| a.rel.cmp(&b.rel));
    out
}

pub fn read_source(library: &Library, rel: &str) -> Result<String> {
    let rel = safe_rel(rel)?;
    let root = Path::new(&library.path);
    let path = root.join(rel);
    ensure_inside(root, &path)?;
    read_text(&path)
}

// ───────────────────────────── header and Makefile editing ─────────────────────────────

/// Drops the prototypes `keep` rejects, leaving everything else (types, includes, guards) as written.
pub fn filter_header(text: &str, keep: &dyn Fn(&str) -> bool) -> String {
    let parsed = cparse::parse(text, "header.h");
    let mut out = String::with_capacity(text.len());
    let mut at = 0;
    for p in &parsed.prototypes {
        if keep(&p.name) {
            continue;
        }
        let line_start = text[..p.start].rfind('\n').map(|i| i + 1).unwrap_or(0);
        let line_end = text[p.end..].find('\n').map(|i| p.end + i + 1).unwrap_or(text.len());
        if line_start < at {
            continue;
        }
        out.push_str(&text[at..line_start]);
        at = line_end;
    }
    out.push_str(&text[at..]);
    // Removing whole groups leaves runs of blank lines: keep one.
    let mut cleaned = String::with_capacity(out.len());
    let mut blanks = 0;
    for line in out.split_inclusive('\n') {
        if line.trim().is_empty() {
            blanks += 1;
            if blanks > 1 {
                continue;
            }
        } else {
            blanks = 0;
        }
        cleaned.push_str(line);
    }
    cleaned
}

/// Adds prototype lines just before the closing `#endif` (or at the end when there is none).
pub fn insert_prototypes(text: &str, protos: &[String]) -> String {
    if protos.is_empty() {
        return text.to_string();
    }
    let block: String = protos.iter().map(|p| format!("{p}\n")).collect();
    let lines: Vec<&str> = text.split_inclusive('\n').collect();
    match lines.iter().rposition(|l| l.trim_start().starts_with("#endif")) {
        Some(i) => {
            let mut head: String = lines[..i].concat();
            let trimmed = head.trim_end_matches('\n').len();
            head.truncate(trimmed);
            format!("{head}\n{block}\n{}", lines[i..].concat())
        }
        None => {
            let sep = if text.ends_with('\n') || text.is_empty() { "" } else { "\n" };
            format!("{text}{sep}{block}")
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum MakeEdit {
    /// The Makefile already compiles these files.
    Unchanged,
    Edited(String),
    /// The structure is not one TekBoard edits: here is what to do by hand.
    Manual(String),
}

struct SrcBlock {
    start: usize,
    end: usize,
}

fn src_block(lines: &[&str]) -> Option<SrcBlock> {
    for (i, line) in lines.iter().enumerate() {
        let t = line.trim_start();
        let name: String = t.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '_').collect();
        if !(name.starts_with("SRC") || name.starts_with("SOURCES")) {
            continue;
        }
        let rest = t[name.len()..].trim_start();
        if !(rest.starts_with('=') || rest.starts_with(":=") || rest.starts_with("+=") || rest.starts_with("?=")) {
            continue;
        }
        let mut end = i;
        while lines[end].trim_end().ends_with('\\') && end + 1 < lines.len() {
            end += 1;
        }
        if lines[i..=end].iter().any(|l| l.contains(".c")) {
            return Some(SrcBlock { start: i, end });
        }
    }
    None
}

fn seg_match(pattern: &str, value: &str) -> bool {
    match pattern.split_once('*') {
        None => pattern == value,
        Some((pre, post)) => value.len() >= pre.len() + post.len() && value.starts_with(pre) && value.ends_with(post) && !post.contains('*'),
    }
}

fn glob_covers(pattern: &str, rel: &str) -> bool {
    let p: Vec<&str> = pattern.trim_start_matches("./").split('/').collect();
    let r: Vec<&str> = rel.split('/').collect();
    p.len() == r.len() && p.iter().zip(&r).all(|(a, b)| seg_match(a, b))
}

fn block_patterns(block: &str) -> (Vec<String>, Vec<String>, bool) {
    let mut wild = Vec::new();
    let mut rest = block;
    while let Some(i) = rest.find("$(wildcard") {
        let after = &rest[i + "$(wildcard".len()..];
        let end = after.find(')').unwrap_or(after.len());
        wild.extend(after[..end].split_whitespace().map(str::to_string));
        rest = &after[end..];
    }
    let explicit = block.split_whitespace().filter(|t| t.ends_with(".c") && !t.contains('$') && !t.contains('*') && !t.contains(')')).map(|t| t.trim_start_matches("./").to_string()).collect();
    (wild, explicit, block.contains("$(shell find"))
}

/// Makes sure the Makefile's source list compiles `add` and no longer names `remove`, changing as little as possible.
pub fn makefile_update(text: &str, add: &[String], remove: &[String]) -> MakeEdit {
    let mut lines: Vec<String> = text.lines().map(str::to_string).collect();
    let view: Vec<&str> = lines.iter().map(String::as_str).collect();
    let Some(block) = src_block(&view) else {
        return if add.is_empty() { MakeEdit::Unchanged } else { MakeEdit::Manual(format!("No source list (SRC = …) was recognised in this Makefile. Add by hand: {}", add.join(", "))) };
    };
    let joined = view[block.start..=block.end].join("\n");
    let (wild, explicit, finds_all) = block_patterns(&joined);
    let covered = |rel: &str| finds_all || wild.iter().any(|w| glob_covers(w, rel)) || explicit.iter().any(|e| e == rel);
    let missing: Vec<&String> = add.iter().filter(|r| !covered(r)).collect();
    let mut manual = Vec::new();
    let mut changed = false;
    let mut end = block.end;

    for rel in remove {
        if !explicit.iter().any(|e| e == rel) {
            continue;
        }
        let hit = (block.start..=end).find(|&i| lines[i].trim().trim_end_matches('\\').trim().trim_start_matches("./") == rel && i > block.start);
        match hit {
            Some(i) => {
                let was_last = i == end;
                lines.remove(i);
                end -= 1;
                if was_last {
                    let prev = lines[end].trim_end().trim_end_matches('\\').trim_end().to_string();
                    lines[end] = prev;
                }
                changed = true;
            }
            None => manual.push(format!("remove {rel} from the source list")),
        }
    }

    let mut entries: Vec<String> = Vec::new();
    if !missing.is_empty() {
        if !wild.is_empty() {
            for rel in &missing {
                let dir = parent_of(rel);
                let e = if dir.is_empty() { "$(wildcard *.c)".to_string() } else { format!("$(wildcard {dir}/*.c)") };
                if !entries.contains(&e) {
                    entries.push(e);
                }
            }
        } else if !explicit.is_empty() {
            entries = missing.iter().map(|r| r.to_string()).collect();
        } else {
            manual.push(format!("add {} to the source list", missing.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", ")));
        }
    }
    if !entries.is_empty() {
        let indent: String = if end > block.start { lines[end].chars().take_while(|c| c.is_whitespace()).collect() } else { "\t".to_string() };
        let indent = if indent.is_empty() { "\t".to_string() } else { indent };
        lines[end] = format!("{} \\", lines[end].trim_end());
        let n = entries.len();
        for (k, e) in entries.into_iter().enumerate() {
            let tail = if k + 1 < n { " \\" } else { "" };
            lines.insert(end + 1 + k, format!("{indent}{e}{tail}"));
        }
        changed = true;
    }

    if !manual.is_empty() && !changed {
        return MakeEdit::Manual(format!("The source list of this Makefile has a shape TekBoard does not edit. By hand: {}.", manual.join("; ")));
    }
    if !changed {
        return MakeEdit::Unchanged;
    }
    let mut out = lines.join("\n");
    if text.ends_with('\n') {
        out.push('\n');
    }
    MakeEdit::Edited(out)
}

/// A plain library Makefile, used only when the source library has none: static (`.a`, copied
/// next to the project's Makefile) or dynamic (`.so`, position-independent code).
fn generated_makefile(name: &str, dirs: &BTreeSet<String>, headers: &[String], shared: bool) -> String {
    let mut wild = vec!["$(wildcard *.c)".to_string()];
    wild.extend(dirs.iter().filter(|d| !d.is_empty()).map(|d| format!("$(wildcard {d}/*.c)")));
    let _ = headers;
    if shared {
        return format!(
            "##\n## EPITECH PROJECT, {year}\n## lib{name}\n## File description:\n## Makefile\n##\n\nCC\t=\tepiclang\n\nCFLAGS\t=\t-Wall -Wextra -fPIC -I.\n\nSRC\t=\t{src}\n\nOBJ\t=\t$(SRC:.c=.o)\n\nNAME\t=\tlib{name}.so\n\nall:\t$(NAME)\n\n$(NAME):\t$(OBJ)\n\t$(CC) -shared -o $(NAME) $(OBJ)\n\tcp $(NAME) ../\n\nclean:\n\trm -f $(OBJ)\n\nfclean:\tclean\n\trm -f $(NAME) ../$(NAME)\n\nre:\tfclean all\n\n.PHONY:\tall clean fclean re\n",
            year = chrono::Local::now().format("%Y"),
            src = wild.join(" \\\n\t\t"),
        );
    }
    format!(
        "##\n## EPITECH PROJECT, {year}\n## lib{name}\n## File description:\n## Makefile\n##\n\nCC\t=\tepiclang\n\nCFLAGS\t=\t-Wall -Wextra -I.\n\nSRC\t=\t{src}\n\nOBJ\t=\t$(SRC:.c=.o)\n\nNAME\t=\tlib{name}.a\n\nall:\t$(NAME)\n\n$(NAME):\t$(OBJ)\n\tar rc $(NAME) $(OBJ)\n\tcp $(NAME) ../\n\nclean:\n\trm -f $(OBJ)\n\nfclean:\tclean\n\trm -f $(NAME) ../$(NAME)\n\nre:\tfclean all\n\n.PHONY:\tall clean fclean re\n",
        year = chrono::Local::now().format("%Y"),
        src = wild.join(" \\\n\t\t"),
    )
}

// ───────────────────────────── a library inside a project ─────────────────────────────

#[derive(Debug, Clone)]
pub struct Record {
    pub src_rel: String,
    pub installed_hash: String,
    pub source_hash: String,
}

pub fn records(conn: &Connection, repo: &str, library_id: i64) -> Result<HashMap<String, Record>> {
    let mut st = conn.prepare("SELECT dest_rel, src_rel, installed_hash, source_hash FROM lib_installs WHERE repo_path = ?1 AND library_id = ?2")?;
    let rows = st.query_map(params![repo, library_id], |r| Ok((r.get::<_, String>(0)?, Record { src_rel: r.get(1)?, installed_hash: r.get(2)?, source_hash: r.get(3)? })))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

fn put_record(conn: &Connection, repo: &str, library_id: i64, dest_rel: &str, src_rel: &str, installed_hash: &str, source_hash: &str, now: i64) -> Result<()> {
    conn.execute(
        "INSERT INTO lib_installs (repo_path, dest_rel, library_id, src_rel, installed_hash, source_hash, installed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(repo_path, dest_rel) DO UPDATE SET library_id = excluded.library_id, src_rel = excluded.src_rel, installed_hash = excluded.installed_hash, source_hash = excluded.source_hash, installed_at = excluded.installed_at",
        params![repo, dest_rel, library_id, src_rel, installed_hash, source_hash, now],
    )?;
    Ok(())
}

fn drop_record(conn: &Connection, repo: &str, dest_rel: &str) -> Result<()> {
    conn.execute("DELETE FROM lib_installs WHERE repo_path = ?1 AND dest_rel = ?2", params![repo, dest_rel])?;
    Ok(())
}

/// Where a library goes in a project when nothing was chosen: `lib/<folder name>`.
pub fn default_lib_dir(library: &Library) -> String {
    let base = Path::new(&library.path).file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "my".into());
    let clean: String = base.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.')).collect();
    format!("lib/{}", if clean.is_empty() || clean.starts_with('.') { "my".into() } else { clean })
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileState {
    pub rel: String,
    /// Sources: `absent`, `installed` (same as the library), `update` (library changed since install),
    /// `modified` (edited in the project), `modified_update` (both), `differs` (present, not installed by
    /// TekBoard, different from the library). Headers: `absent`, `managed`, `custom`.
    pub state: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStatus {
    pub lib_dir: String,
    pub exists: bool,
    pub has_makefile: bool,
    pub files: Vec<FileState>,
    /// Files in the project's library folder that the source library does not have.
    pub extra: Vec<String>,
}

fn state_of(local: Option<&str>, source_hash: &str, record: Option<&Record>, is_header: bool) -> &'static str {
    let Some(local) = local else { return "absent" };
    if is_header {
        return if record.is_some_and(|r| r.installed_hash == local) || local == source_hash { "managed" } else { "custom" };
    }
    match record {
        Some(r) => match (local == r.installed_hash, source_hash == r.source_hash) {
            (true, true) => "installed",
            (true, false) => "update",
            (false, true) => "modified",
            (false, false) if local == source_hash => "installed",
            (false, false) => "modified_update",
        },
        None if local == source_hash => "installed",
        None => "differs",
    }
}

fn local_hash(path: &Path) -> Option<String> {
    std::fs::read(path).ok().map(|b| sha(&b))
}

pub fn project_status(conn: &Connection, repo: &Path, library: &Library, lib_dir: &str) -> Result<ProjectStatus> {
    safe_rel(lib_dir)?;
    let scan = scan(Path::new(&library.path))?;
    let recs = records(conn, &repo.to_string_lossy(), library.id)?;
    let dir = repo.join(lib_dir);
    let mut files = Vec::new();
    for (rel, f) in &scan.files {
        let dest = format!("{lib_dir}/{rel}");
        let local = local_hash(&repo.join(&dest));
        files.push(FileState { rel: rel.clone(), state: state_of(local.as_deref(), &f.hash, recs.get(&dest), rel.ends_with(".h")) });
    }
    let extra = if dir.is_dir() { walk(&dir).into_iter().filter(|r| r != "Makefile" && !scan.files.contains_key(r)).collect() } else { vec![] };
    Ok(ProjectStatus { lib_dir: lib_dir.to_string(), exists: dir.is_dir(), has_makefile: dir.join("Makefile").is_file(), files, extra })
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PlanRequest {
    pub lib_dir: String,
    /// Source files to have in the project.
    pub add: Vec<String>,
    /// Files to take out of the project.
    pub remove: Vec<String>,
    /// Files whose project copy may be replaced by the library's version.
    pub replace: Vec<String>,
    /// Dependencies the user chose to leave out.
    pub exclude: Vec<String>,
    /// Create the library skeleton (Makefile, headers) even with no function.
    pub init: bool,
    /// A dynamic library (`lib<name>.so`, built with -fPIC -shared) instead of a static one,
    /// when TekBoard writes the library's Makefile.
    #[serde(default)]
    pub shared: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanAction {
    /// Path relative to the project.
    pub path: String,
    /// Path inside the library (empty for the Makefile).
    pub rel: String,
    /// `create`, `overwrite`, `edit`, `delete`, `keep`.
    pub op: &'static str,
    /// `source`, `header`, `makefile`.
    pub what: &'static str,
    pub reason: String,
    pub diff: Option<String>,
    /// Would destroy something written in the project: needs an explicit yes.
    pub risky: bool,
    #[serde(skip)]
    content: Option<String>,
    #[serde(skip)]
    source_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub lib_dir: String,
    pub actions: Vec<PlanAction>,
    pub required: Vec<Required>,
    pub warnings: Vec<String>,
}

pub fn plan(conn: &Connection, repo: &Path, library: &Library, meta: &HashMap<String, Meta>, req: &PlanRequest) -> Result<Plan> {
    safe_rel(&req.lib_dir)?;
    for r in req.add.iter().chain(&req.remove).chain(&req.replace).chain(&req.exclude) {
        safe_rel(r)?;
    }
    let lib_dir = req.lib_dir.trim_end_matches('/').to_string();
    let scan = scan(Path::new(&library.path))?;
    let cat = build_catalog(library, &scan, meta);
    let recs = records(conn, &repo.to_string_lossy(), library.id)?;
    let exclude: BTreeSet<String> = req.exclude.iter().cloned().collect();
    let replace: BTreeSet<&String> = req.replace.iter().collect();
    let mut warnings = Vec::new();
    let mut actions: Vec<PlanAction> = Vec::new();

    let is_source = |rel: &str| scan.files.contains_key(rel) && rel.ends_with(".c");
    for r in req.add.iter().chain(&req.replace) {
        if !is_source(r) {
            return Err(AppError::new("unknown_file", format!("{r} is not a source file of this library")));
        }
    }
    let required = closure(&cat, &req.add, &exclude);
    let mut wanted: BTreeSet<String> = req.add.iter().cloned().collect();
    wanted.extend(required.iter().filter(|r| r.rel.ends_with(".c")).map(|r| r.rel.clone()));
    wanted.extend(req.replace.iter().cloned());
    for r in &req.remove {
        wanted.remove(r);
    }

    let dest_of = |rel: &str| format!("{lib_dir}/{rel}");
    let mut created: BTreeSet<String> = BTreeSet::new();
    for rel in &wanted {
        let f = &scan.files[rel];
        let path = dest_of(rel);
        let abs = repo.join(&path);
        ensure_inside(repo, &abs)?;
        let local_text = if abs.is_file() { Some(read_text(&abs)?) } else { None };
        let base = PlanAction { path: path.clone(), rel: rel.clone(), op: "create", what: "source", reason: String::new(), diff: None, risky: false, content: Some(f.text.clone()), source_hash: Some(f.hash.clone()) };
        match local_text {
            None => {
                created.insert(rel.clone());
                actions.push(PlanAction { reason: "new file".into(), ..base });
            }
            Some(local) => {
                let st = state_of(Some(&sha(local.as_bytes())), &f.hash, recs.get(&path), false);
                match st {
                    "installed" => actions.push(PlanAction { op: "keep", reason: "already there, identical".into(), content: None, ..base }),
                    "update" if replace.contains(rel) => actions.push(PlanAction { op: "overwrite", reason: "library version is newer; your copy was never edited".into(), diff: Some(unified(&local, &f.text, &path)), ..base }),
                    _ if replace.contains(rel) => actions.push(PlanAction { op: "overwrite", reason: "replaces a version edited in this project".into(), diff: Some(unified(&local, &f.text, &path)), risky: true, ..base }),
                    "update" => actions.push(PlanAction { op: "keep", reason: "a newer library version exists; kept as is".into(), content: None, ..base }),
                    _ => actions.push(PlanAction { op: "keep", reason: "your version differs from the library; kept".into(), content: None, ..base }),
                }
            }
        }
    }

    let by_rel: HashMap<&str, &CatalogFile> = cat.files.iter().map(|f| (f.rel.as_str(), f)).collect();
    // Source files the project will hold once the plan is applied.
    let mut present: BTreeSet<String> = scan.files.keys().filter(|r| r.ends_with(".c") && repo.join(dest_of(r)).is_file()).cloned().collect();
    present.extend(created.iter().cloned());
    let mut removed: Vec<String> = Vec::new();
    for rel in &req.remove {
        let path = dest_of(rel);
        let abs = repo.join(&path);
        if !abs.is_file() {
            continue;
        }
        ensure_inside(repo, &abs)?;
        present.remove(rel);
        let local = read_text(&abs)?;
        let edited = match scan.files.get(rel) {
            Some(f) => !matches!(state_of(Some(&sha(local.as_bytes())), &f.hash, recs.get(&path), rel.ends_with(".h")), "installed" | "update" | "managed"),
            None => true,
        };
        removed.push(rel.clone());
        actions.push(PlanAction { path, rel: rel.clone(), op: "delete", what: if rel.ends_with(".h") { "header" } else { "source" }, reason: if edited { "this copy was edited in the project; a backup is kept".into() } else { "identical to the library; a backup is kept".into() }, diff: None, risky: edited, content: None, source_hash: None });
    }
    for rel in &removed {
        let users: Vec<String> = present.iter().filter(|p| by_rel.get(p.as_str()).is_some_and(|f| f.deps.iter().any(|d| &d.rel == rel))).cloned().collect();
        if !users.is_empty() {
            warnings.push(format!("{rel} is still used by {}: the library will not link without it.", users.join(", ")));
        }
    }

    // ── Makefile
    let mk_path = format!("{lib_dir}/Makefile");
    let mk_abs = repo.join(&mk_path);
    let project_mk = if mk_abs.is_file() { Some(read_text(&mk_abs)?) } else { None };
    let touching = !created.is_empty() || !removed.is_empty() || req.init;
    let lib_name = base_of(&lib_dir).to_string();
    let mut final_mk = project_mk.clone();
    if touching {
        match &project_mk {
            None => {
                let dirs: BTreeSet<String> = present.iter().map(|r| parent_of(r).to_string()).collect();
                let text = scan.makefile.clone().unwrap_or_else(|| generated_makefile(&lib_name, &dirs, &[], req.shared));
                let text = match makefile_update(&text, &present.iter().cloned().collect::<Vec<_>>(), &[]) {
                    MakeEdit::Edited(t) => t,
                    MakeEdit::Unchanged => text,
                    MakeEdit::Manual(note) => {
                        warnings.push(note);
                        text
                    }
                };
                final_mk = Some(text.clone());
                actions.push(PlanAction { path: mk_path.clone(), rel: String::new(), op: "create", what: "makefile", reason: if scan.makefile.is_some() { "copied from the library".into() } else { "the library has no Makefile: a plain one is generated".into() }, diff: None, risky: false, content: Some(text), source_hash: None });
            }
            Some(current) => match makefile_update(current, &created.iter().cloned().collect::<Vec<_>>(), &removed) {
                MakeEdit::Unchanged => {}
                MakeEdit::Edited(text) => {
                    final_mk = Some(text.clone());
                    actions.push(PlanAction { path: mk_path.clone(), rel: String::new(), op: "edit", what: "makefile", reason: "source list updated".into(), diff: Some(unified(current, &text, &mk_path)), risky: false, content: Some(text), source_hash: None });
                }
                MakeEdit::Manual(note) => warnings.push(note),
            },
        }
    }

    // ── headers
    let mut needed: BTreeSet<String> = BTreeSet::new();
    let mut queue: Vec<String> = present.iter().filter(|r| created.contains(*r) || req.init).flat_map(|r| by_rel.get(r.as_str()).map(|f| f.headers.clone()).unwrap_or_default()).collect();
    if touching {
        // A header the Makefile copies or names must exist for `make` to pass.
        let mk = final_mk.as_deref().unwrap_or("");
        queue.extend(scan.files.keys().filter(|r| r.ends_with(".h") && mk.split(|c: char| c.is_whitespace() || c == '/').any(|tok| tok == base_of(r))).cloned());
        // Headers already in the project stay in sync with what is installed.
        queue.extend(scan.files.keys().filter(|r| r.ends_with(".h") && repo.join(dest_of(r)).is_file()).cloned());
    }
    while let Some(h) = queue.pop() {
        if needed.insert(h.clone()) {
            queue.extend(by_rel.get(h.as_str()).map(|f| f.headers.clone()).unwrap_or_default());
        }
    }
    let defined: BTreeSet<&str> = scan.files.iter().filter(|(r, _)| r.ends_with(".c")).flat_map(|(_, f)| f.parsed.exported().map(|x| x.name.as_str())).collect();
    let available: BTreeSet<&str> = present.iter().filter_map(|r| scan.files.get(r)).flat_map(|f| f.parsed.exported().map(|x| x.name.as_str())).collect();
    for h in &needed {
        if removed.contains(h) {
            continue;
        }
        let src = &scan.files[h];
        let path = dest_of(h);
        let abs = repo.join(&path);
        ensure_inside(repo, &abs)?;
        // Keep what the project can link, and anything the library does not define itself.
        let filtered = filter_header(&src.text, &|name| available.contains(name) || !defined.contains(name));
        let base = PlanAction { path: path.clone(), rel: h.clone(), op: "create", what: "header", reason: String::new(), diff: None, risky: false, content: None, source_hash: Some(src.hash.clone()) };
        if !abs.is_file() {
            actions.push(PlanAction { reason: "types and the prototypes of installed functions".into(), content: Some(filtered), ..base });
            continue;
        }
        let local = read_text(&abs)?;
        if local == filtered {
            continue;
        }
        let managed = recs.get(&path).is_some_and(|r| r.installed_hash == sha(local.as_bytes()));
        if managed {
            actions.push(PlanAction { op: "overwrite", reason: "regenerated for the installed functions (you never edited it)".into(), diff: Some(unified(&local, &filtered, &path)), content: Some(filtered), ..base });
            continue;
        }
        let have: BTreeSet<String> = cparse::parse(&local, h).prototypes.into_iter().map(|p| p.name).collect();
        let local_parsed = cparse::parse(&local, h);
        let missing: Vec<&cparse::Prototype> = src.parsed.prototypes.iter().filter(|p| available.contains(p.name.as_str()) && !have.contains(&p.name)).collect();
        if missing.is_empty() {
            continue;
        }
        let unknown: BTreeSet<&str> = missing.iter().flat_map(|p| p.types.iter().map(String::as_str)).filter(|t| src.parsed.types.iter().any(|x| x == t) && !local_parsed.types.iter().any(|x| x == t)).collect();
        if !unknown.is_empty() {
            warnings.push(format!("{path}: the added prototypes use types your header does not define ({}). Copy them from the library header.", unknown.into_iter().collect::<Vec<_>>().join(", ")));
        }
        let edited = insert_prototypes(&local, &missing.iter().map(|p| p.text.clone()).collect::<Vec<_>>());
        actions.push(PlanAction { op: "edit", reason: format!("adds {} prototype(s) to your header, nothing else is touched", missing.len()), diff: Some(unified(&local, &edited, &path)), content: Some(edited), ..base });
    }

    // ── does the project use this library at all?
    if touching {
        let root_mk = repo.join("Makefile");
        if root_mk.is_file() {
            let text = read_text(&root_mk)?;
            if !text.contains(&lib_dir) && !text.contains(&format!("-l{lib_name}")) {
                warnings.push(if req.shared {
                    format!("Le Makefile du projet ne mentionne ni {lib_dir} ni -l{lib_name}. Pour la bibliothèque dynamique, ajoute avant l'édition de liens : make -C {lib_dir}, puis -L. -l{lib_name} -Wl,-rpath,'$$ORIGIN' (le .so est copié à côté de ton Makefile).")
                } else {
                    format!("Le Makefile du projet ne mentionne ni {lib_dir} ni -l{lib_name} : ajoute make -C {lib_dir} puis -L. -l{lib_name} pour compiler et lier la bibliothèque.")
                });
            }
        }
    }
    for c in &cat.cycles {
        if c.iter().any(|r| wanted.contains(r)) {
            warnings.push(format!("These files need each other and are installed together: {}.", c.join(", ")));
        }
    }
    for r in required.iter().filter(|r| r.kind == "ambiguous") {
        warnings.push(format!("{} is defined in several files of the library; {} was assumed for {}.", r.via.join(", "), r.rel, r.needed_by));
    }
    actions.sort_by(|a, b| (a.what != "source", &a.path).cmp(&(b.what != "source", &b.path)));
    Ok(Plan { lib_dir, actions, required, warnings })
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ApplyReport {
    pub written: Vec<String>,
    pub deleted: Vec<String>,
    /// Risky actions that were not confirmed.
    pub skipped: Vec<String>,
    pub backup_dir: Option<String>,
}

fn repo_key(repo: &Path) -> String {
    sha(repo.to_string_lossy().as_bytes())[..12].to_string()
}

/// Carries out a plan. A risky action runs only when its path is listed in `confirmed`.
pub fn apply(conn: &Connection, repo: &Path, library: &Library, plan: &Plan, confirmed: &[String], backups: &Path, now: i64) -> Result<ApplyReport> {
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S%.3f").to_string();
    let backup_root = backups.join("library").join(repo_key(repo)).join(&stamp);
    let repo_s = repo.to_string_lossy().into_owned();
    let mut report = ApplyReport::default();
    for a in &plan.actions {
        let abs = repo.join(&a.path);
        if a.op == "keep" {
            // An identical copy that TekBoard did not install is adopted, so later updates are noticed.
            if let (Some(src_hash), Some(local)) = (&a.source_hash, local_hash(&abs)) {
                if &local == src_hash {
                    put_record(conn, &repo_s, library.id, &a.path, &a.rel, &local, src_hash, now)?;
                }
            }
            continue;
        }
        if a.risky && !confirmed.contains(&a.path) {
            report.skipped.push(a.path.clone());
            continue;
        }
        ensure_inside(repo, &abs)?;
        if abs.is_file() {
            let to = backup_root.join(&a.path);
            if let Some(p) = to.parent() {
                std::fs::create_dir_all(p)?;
            }
            std::fs::copy(&abs, &to)?;
            report.backup_dir = Some(backup_root.to_string_lossy().into_owned());
        }
        if a.op == "delete" {
            std::fs::remove_file(&abs)?;
            drop_record(conn, &repo_s, &a.path)?;
            report.deleted.push(a.path.clone());
            continue;
        }
        let Some(content) = &a.content else { continue };
        if a.op == "create" && abs.exists() {
            return Err(AppError::new("conflict", format!("{} appeared since the preview; nothing more was written", a.path)));
        }
        if let Some(p) = abs.parent() {
            std::fs::create_dir_all(p)?;
        }
        std::fs::write(&abs, content)?;
        if a.what != "makefile" && a.op != "edit" {
            put_record(conn, &repo_s, library.id, &a.path, &a.rel, &sha(content.as_bytes()), a.source_hash.as_deref().unwrap_or(""), now)?;
        }
        report.written.push(a.path.clone());
    }
    Ok(report)
}

/// Difference between the project's copy and the library's version (`-` project, `+` library).
pub fn diff_with_source(repo: &Path, library: &Library, lib_dir: &str, rel: &str) -> Result<String> {
    safe_rel(lib_dir)?;
    let source = read_source(library, rel)?;
    let path = format!("{lib_dir}/{rel}");
    let abs = repo.join(&path);
    ensure_inside(repo, &abs)?;
    Ok(unified(&read_text(&abs)?, &source, &path))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    /// Folder name: `20261110-142233.123`.
    pub stamp: String,
    pub size: u64,
}

pub fn backups_of(repo: &Path, backups: &Path, path: &str) -> Result<Vec<Backup>> {
    let rel = safe_rel(path)?;
    let root = backups.join("library").join(repo_key(repo));
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&root) {
        for e in entries.flatten() {
            let file = e.path().join(&rel);
            if let Ok(m) = file.metadata() {
                if m.is_file() {
                    out.push(Backup { stamp: e.file_name().to_string_lossy().into_owned(), size: m.len() });
                }
            }
        }
    }
    out.sort_by(|a, b| b.stamp.cmp(&a.stamp));
    Ok(out)
}

/// Puts a saved version back. The current file is saved first.
pub fn restore_backup(repo: &Path, backups: &Path, path: &str, stamp: &str) -> Result<()> {
    let rel = safe_rel(path)?;
    safe_rel(stamp)?;
    let root = backups.join("library").join(repo_key(repo));
    let from = root.join(stamp).join(&rel);
    if !from.is_file() {
        return Err(AppError::new("unknown_backup", "This saved version no longer exists"));
    }
    let abs = repo.join(&rel);
    ensure_inside(repo, &abs)?;
    if abs.is_file() {
        let keep = root.join(chrono::Local::now().format("%Y%m%d-%H%M%S%.3f").to_string()).join(&rel);
        if let Some(p) = keep.parent() {
            std::fs::create_dir_all(p)?;
        }
        std::fs::copy(&abs, keep)?;
    }
    if let Some(p) = abs.parent() {
        std::fs::create_dir_all(p)?;
    }
    std::fs::copy(from, abs)?;
    Ok(())
}

// ───────────────────────────── adding files to a library (drop zone) ─────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCandidate {
    /// Absolute path of the file to import.
    pub source: String,
    pub name: String,
    pub is_header: bool,
    pub functions: Vec<String>,
    pub static_functions: Vec<String>,
    pub suggested_dir: String,
    /// Why this folder was suggested, in plain words.
    pub suggestion_reason: String,
    /// Functions the library already defines, and where.
    pub already_defined: Vec<Duplicate>,
    /// Exported functions no library header declares.
    pub undeclared: Vec<String>,
    pub parse_errors: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportAnalysis {
    pub candidates: Vec<ImportCandidate>,
    pub dirs: Vec<String>,
    pub headers: Vec<String>,
    /// Files in the library, to tell a new file from a replacement.
    pub existing: Vec<String>,
    pub ignored: Vec<String>,
}

fn tokens(name: &str) -> Vec<&str> {
    name.split('_').filter(|t| !t.is_empty()).collect()
}

/// Folder whose functions look most like these names (shared leading words, e.g. `my_str…`).
fn suggest_dir(scan: &Scan, names: &[String], is_header: bool) -> (String, String) {
    if is_header {
        let dir = scan.files.keys().find(|k| k.ends_with(".h")).map(|k| parent_of(k).to_string()).unwrap_or_default();
        return (dir, "next to the library's other headers".into());
    }
    let mut score: BTreeMap<String, usize> = BTreeMap::new();
    let mut count: BTreeMap<String, usize> = BTreeMap::new();
    for (rel, f) in scan.files.iter().filter(|(r, _)| r.ends_with(".c")) {
        let dir = parent_of(rel).to_string();
        *count.entry(dir.clone()).or_default() += 1;
        for func in f.parsed.exported() {
            for n in names {
                let (a, b) = (tokens(n), tokens(&func.name));
                let common = a.iter().zip(&b).take_while(|(x, y)| x == y).count();
                // "my_" alone says nothing; a second shared word does.
                let shared_stem = a.len() > 1 && b.len() > 1 && a[1].len() >= 3 && b[1].len() >= 3 && a[1][..3] == b[1][..3];
                if common >= 2 || (common == 1 && shared_stem) {
                    *score.entry(dir.clone()).or_default() += common.max(1);
                }
            }
        }
    }
    if let Some((dir, _)) = score.iter().max_by_key(|(_, s)| **s) {
        return (dir.clone(), "its functions have similar names".into());
    }
    match count.iter().max_by_key(|(_, c)| **c) {
        Some((dir, _)) => (dir.clone(), "the folder with the most files (no similar name found)".into()),
        None => (String::new(), "the library is empty".into()),
    }
}

/// Expands folders and archives into the `.c`/`.h` files they hold.
fn expand_inputs(paths: &[String], scratch: &Path, ignored: &mut Vec<String>) -> Result<Vec<PathBuf>> {
    let mut out = Vec::new();
    for (n, raw) in paths.iter().enumerate() {
        let p = PathBuf::from(raw);
        let Ok(meta) = p.symlink_metadata() else {
            ignored.push(format!("{raw}: not found"));
            continue;
        };
        if meta.file_type().is_symlink() {
            ignored.push(format!("{raw}: symbolic link"));
            continue;
        }
        let lower = raw.to_lowercase();
        if meta.is_dir() {
            out.extend(walk(&p).into_iter().filter(|r| r != "Makefile" && base_of(r) != "Makefile").map(|r| p.join(r)));
        } else if lower.ends_with(".zip") || lower.ends_with(".tar") || lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
            let dest = scratch.join(format!("archive-{n}"));
            std::fs::create_dir_all(&dest)?;
            if lower.ends_with(".zip") {
                unzip_sources(&p, &dest)?;
            } else {
                let status = std::process::Command::new("tar").args(["--no-same-owner", "--no-same-permissions", "-xf"]).arg(&p).arg("-C").arg(&dest).stdin(std::process::Stdio::null()).output()?;
                if !status.status.success() {
                    ignored.push(format!("{raw}: {}", String::from_utf8_lossy(&status.stderr).lines().next().unwrap_or("could not be read")));
                    continue;
                }
            }
            let found: Vec<PathBuf> = walk(&dest).into_iter().filter(|r| base_of(r) != "Makefile").map(|r| dest.join(r)).collect();
            if found.is_empty() {
                ignored.push(format!("{raw}: no .c or .h file inside"));
            }
            out.extend(found);
        } else if (lower.ends_with(".c") || lower.ends_with(".h")) && meta.len() <= MAX_FILE {
            out.push(p);
        } else {
            ignored.push(format!("{raw}: not a .c/.h file, a folder or an archive"));
        }
    }
    Ok(out)
}

/// Extracts only `.c`/`.h` entries, refusing any path that would leave `dest`.
fn unzip_sources(archive: &Path, dest: &Path) -> Result<()> {
    use std::io::Read;
    let file = std::fs::File::open(archive)?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| AppError::new("bad_archive", format!("This archive could not be read: {e}")))?;
    for i in 0..zip.len().min(MAX_FILES) {
        let mut entry = zip.by_index(i).map_err(|e| AppError::new("bad_archive", e.to_string()))?;
        let Some(rel) = entry.enclosed_name() else { continue };
        let name = rel.to_string_lossy().to_lowercase();
        if entry.is_dir() || !(name.ends_with(".c") || name.ends_with(".h")) || entry.size() > MAX_FILE {
            continue;
        }
        let to = dest.join(&rel);
        if let Some(p) = to.parent() {
            std::fs::create_dir_all(p)?;
        }
        let mut bytes = Vec::new();
        entry.by_ref().take(MAX_FILE).read_to_end(&mut bytes)?;
        std::fs::write(to, bytes)?;
    }
    Ok(())
}

pub fn analyze_import(library: &Library, paths: &[String], scratch: &Path) -> Result<ImportAnalysis> {
    let scan = scan(Path::new(&library.path))?;
    let mut ignored = Vec::new();
    let inputs = expand_inputs(paths, scratch, &mut ignored)?;
    let mut definers: BTreeMap<&str, Vec<String>> = BTreeMap::new();
    let mut declared: BTreeSet<&str> = BTreeSet::new();
    for (rel, f) in &scan.files {
        if rel.ends_with(".c") {
            for func in f.parsed.exported() {
                definers.entry(func.name.as_str()).or_default().push(rel.clone());
            }
        } else {
            declared.extend(f.parsed.prototypes.iter().map(|p| p.name.as_str()));
        }
    }
    let incoming_protos: BTreeSet<String> = inputs.iter().filter(|p| p.extension().is_some_and(|e| e == "h")).filter_map(|p| read_text(p).ok()).flat_map(|t| cparse::parse(&t, "x.h").prototypes.into_iter().map(|p| p.name)).collect();
    let mut candidates = Vec::new();
    for path in inputs.into_iter().take(400) {
        let name = path.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        let text = read_text(&path)?;
        let parsed = cparse::parse(&text, &name);
        let is_header = name.ends_with(".h");
        let functions: Vec<String> = parsed.exported().map(|f| f.name.clone()).collect();
        let (suggested_dir, suggestion_reason) = suggest_dir(&scan, &functions, is_header);
        let target = if suggested_dir.is_empty() { name.clone() } else { format!("{suggested_dir}/{name}") };
        let already_defined = functions.iter().filter_map(|f| definers.get(f.as_str()).map(|v| Duplicate { name: f.clone(), files: v.iter().filter(|r| **r != target).cloned().collect() })).filter(|d| !d.files.is_empty()).collect();
        let undeclared = if is_header { vec![] } else { functions.iter().filter(|f| !declared.contains(f.as_str()) && !incoming_protos.contains(*f)).cloned().collect() };
        candidates.push(ImportCandidate { source: path.to_string_lossy().into_owned(), name, is_header, static_functions: parsed.functions.iter().filter(|f| f.is_static).map(|f| f.name.clone()).collect(), functions, suggested_dir, suggestion_reason, already_defined, undeclared, parse_errors: parsed.has_errors });
    }
    let mut dirs: BTreeSet<String> = scan.files.keys().map(|k| parent_of(k).to_string()).collect();
    dirs.insert(String::new());
    Ok(ImportAnalysis { candidates, dirs: dirs.into_iter().collect(), headers: scan.files.keys().filter(|k| k.ends_with(".h")).cloned().collect(), existing: scan.files.keys().cloned().collect(), ignored })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportItem {
    pub source: String,
    /// Folder inside the library, `""` for its root. May be new.
    pub dir: String,
    /// Replace a file of the same name (the old one is saved first).
    pub overwrite: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub imported: Vec<String>,
    /// Already in the library with the same content.
    pub unchanged: Vec<String>,
    /// A different file of that name exists and `overwrite` was off.
    pub conflicts: Vec<String>,
    pub prototypes_added: Vec<String>,
    pub header: Option<String>,
}

/// Copies files into the library. With `header`, the prototypes of new exported functions are added to it.
pub fn import_files(library: &Library, items: &[ImportItem], header: Option<&str>, backups: &Path) -> Result<ImportReport> {
    let root = PathBuf::from(&library.path);
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S%.3f").to_string();
    let backup_root = backups.join("library-source").join(library.id.to_string()).join(stamp);
    let mut report = ImportReport::default();
    let mut new_signatures: Vec<(String, String)> = Vec::new();
    for item in items {
        let src = PathBuf::from(&item.source);
        let meta = src.symlink_metadata().map_err(|_| AppError::new("invalid_target", format!("{} is gone", item.source)))?;
        let name = src.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        if !meta.is_file() || meta.len() > MAX_FILE || !(name.ends_with(".c") || name.ends_with(".h")) {
            return Err(AppError::new("invalid_target", format!("{name} is not a .c or .h file")));
        }
        let rel = if item.dir.trim_matches('/').is_empty() { name.clone() } else { format!("{}/{name}", item.dir.trim_matches('/')) };
        safe_rel(&rel)?;
        let dest = root.join(&rel);
        ensure_inside(&root, &dest)?;
        let bytes = std::fs::read(&src)?;
        if dest.is_file() {
            if std::fs::read(&dest)? == bytes {
                report.unchanged.push(rel);
                continue;
            }
            if !item.overwrite {
                report.conflicts.push(rel);
                continue;
            }
            let keep = backup_root.join(&rel);
            if let Some(p) = keep.parent() {
                std::fs::create_dir_all(p)?;
            }
            std::fs::copy(&dest, keep)?;
        }
        if let Some(p) = dest.parent() {
            std::fs::create_dir_all(p)?;
        }
        std::fs::write(&dest, &bytes)?;
        if name.ends_with(".c") {
            let parsed = cparse::parse(&String::from_utf8_lossy(&bytes), &name);
            new_signatures.extend(parsed.exported().map(|f| (f.name.clone(), format!("{};", f.signature))));
        }
        report.imported.push(rel);
    }
    if let Some(h) = header {
        let rel = safe_rel(h)?;
        let path = root.join(rel);
        ensure_inside(&root, &path)?;
        if !path.is_file() || !h.ends_with(".h") {
            return Err(AppError::new("invalid_target", format!("{h} is not a header of this library")));
        }
        // Re-scan: a header imported in the same batch may already declare them.
        let declared: BTreeSet<String> = scan(&root)?.files.iter().filter(|(r, _)| r.ends_with(".h")).flat_map(|(_, f)| f.parsed.prototypes.iter().map(|p| p.name.clone())).collect();
        let missing: Vec<(String, String)> = new_signatures.into_iter().filter(|(n, _)| !declared.contains(n)).collect();
        if !missing.is_empty() {
            let text = read_text(&path)?;
            let keep = backup_root.join(h);
            if let Some(p) = keep.parent() {
                std::fs::create_dir_all(p)?;
            }
            std::fs::copy(&path, keep)?;
            std::fs::write(&path, insert_prototypes(&text, &missing.iter().map(|(_, s)| s.clone()).collect::<Vec<_>>()))?;
            report.prototypes_added = missing.into_iter().map(|(n, _)| n).collect();
            report.header = Some(h.to_string());
        }
    }
    Ok(report)
}

/// Folders on this machine that look like a C library worth registering.
pub fn suggestions(home: &Path, templates: &Path, registered: &[Library]) -> Vec<String> {
    let mut roots = vec![home.join(".config/tekinit/blueprint/lib")];
    if let Ok(entries) = std::fs::read_dir(templates) {
        roots.extend(entries.flatten().map(|e| e.path().join("files/lib")));
        roots.extend(std::fs::read_dir(templates).into_iter().flatten().flatten().map(|e| e.path().join("lib")));
    }
    let mut out = Vec::new();
    for root in roots {
        let Ok(entries) = std::fs::read_dir(&root) else { continue };
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() && walk(&p).iter().any(|f| f.ends_with(".c")) {
                let s = p.to_string_lossy().into_owned();
                if !registered.iter().any(|l| l.path == s) && !out.contains(&s) {
                    out.push(s);
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use std::fs;

    const MY_H: &str = "#ifndef MY_H\n    #define MY_H\n    #include \"my_list.h\"\n    #include <stddef.h>\n\ntypedef struct {\n    void *data;\n} buffer_t;\n\nint my_strlen(char const *str);\nchar *my_strdup(char const *src);\nchar **my_str_to_word_array(char const *str);\n\nint my_getnbr(char const *str);\nvoid *my_memcpy(void *dest, const void *src, size_t n);\nint external_thing(void);\n\n#endif\n";
    const LIST_H: &str = "#ifndef MY_LIST_H\n    #define MY_LIST_H\n\ntypedef struct linked_list {\n    void *data;\n} linked_list_t;\n\nint my_list_size(linked_list_t const *begin);\n\n#endif\n";
    const MAKEFILE: &str = "CC\t=\tgcc\n\nSRC\t=\t$(wildcard utils/*.c) \\\n\t$(wildcard mem/*.c)\n\nOBJ\t=\t$(SRC:.c=.o)\n\nNAME\t=\tlibmy.a\n\nall:\t$(OBJ)\n\tar rc $(NAME) $(OBJ)\n\tcp my.h ../../include/\n\tcp my_list.h ../../include/\n";

    fn c(name: &str, body: &str) -> String {
        format!("#include \"my.h\"\n\n{name}\n{{\n{body}\n}}\n")
    }

    /// A small library shaped like the real one: folders, one header including another, a duplicate.
    fn make_library(dir: &Path) {
        for d in ["utils", "mem", "alt"] {
            fs::create_dir_all(dir.join(d)).unwrap();
        }
        fs::write(dir.join("my.h"), MY_H).unwrap();
        fs::write(dir.join("my_list.h"), LIST_H).unwrap();
        fs::write(dir.join("Makefile"), MAKEFILE).unwrap();
        fs::write(dir.join("utils/my_strlen.c"), c("int my_strlen(char const *str)", "    return 0;")).unwrap();
        fs::write(dir.join("utils/my_strdup.c"), c("char *my_strdup(char const *src)", "    char *d = malloc(my_strlen(src) + 1);\n    return my_memcpy(d, src, 1);")).unwrap();
        fs::write(dir.join("utils/my_str_to_word_array.c"), c("char **my_str_to_word_array(char const *str)", "    return (char **)my_strdup(str);")).unwrap();
        fs::write(dir.join("utils/my_getnbr.c"), c("int my_getnbr(char const *str)", "    return 0;")).unwrap();
        fs::write(dir.join("utils/my_list_size.c"), "#include \"my_list.h\"\n\nint my_list_size(linked_list_t const *begin)\n{\n    return 0;\n}\n").unwrap();
        fs::write(dir.join("mem/my_memcpy.c"), c("void *my_memcpy(void *dest, const void *src, size_t n)", "    return dest;")).unwrap();
        fs::write(dir.join("alt/my_memcpy.c"), c("void *my_memcpy(void *dest, const void *src, size_t n)", "    return 0;")).unwrap();
    }

    struct Fx {
        _tmp: tempfile::TempDir,
        conn: Connection,
        lib: Library,
        repo: PathBuf,
        backups: PathBuf,
    }

    fn fx() -> Fx {
        let tmp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(tmp.path()).unwrap();
        let lib_dir = root.join("MyLib");
        make_library(&lib_dir);
        let repo = root.join("project");
        fs::create_dir_all(&repo).unwrap();
        let conn = db::open_in_memory().unwrap();
        let lib = add(&conn, "MyLib", &lib_dir, 1).unwrap();
        Fx { conn, lib, repo, backups: root.join("backups"), _tmp: tmp }
    }

    fn req(add: &[&str]) -> PlanRequest {
        PlanRequest { lib_dir: "lib/my".into(), add: add.iter().map(|s| s.to_string()).collect(), ..Default::default() }
    }

    fn run(f: &Fx, r: &PlanRequest, confirmed: &[&str]) -> (Plan, ApplyReport) {
        let p = plan(&f.conn, &f.repo, &f.lib, &HashMap::new(), r).unwrap();
        let c: Vec<String> = confirmed.iter().map(|s| s.to_string()).collect();
        let rep = apply(&f.conn, &f.repo, &f.lib, &p, &c, &f.backups, 2).unwrap();
        (p, rep)
    }

    fn state(f: &Fx, rel: &str) -> &'static str {
        project_status(&f.conn, &f.repo, &f.lib, "lib/my").unwrap().files.into_iter().find(|x| x.rel == rel).unwrap().state
    }

    #[test]
    fn catalog_lists_functions_dependencies_and_duplicates() {
        let f = fx();
        let cat = catalog(&f.lib, &HashMap::new()).unwrap();
        let dup = cat.files.iter().find(|x| x.rel == "utils/my_strdup.c").unwrap();
        assert_eq!(dup.functions[0].signature, "char *my_strdup(char const *src)");
        assert_eq!(dup.functions[0].header.as_deref(), Some("my.h"));
        assert_eq!(dup.headers, vec!["my.h"]);
        let strlen = dup.deps.iter().find(|d| d.rel == "utils/my_strlen.c").unwrap();
        assert_eq!((strlen.kind, strlen.via.clone()), ("detected", vec!["my_strlen".to_string()]));
        // my_memcpy lives in two folders, none next to the caller: the link is marked as a guess.
        assert!(dup.deps.iter().any(|d| d.via == vec!["my_memcpy".to_string()] && d.kind == "ambiguous"));
        assert_eq!(cat.duplicates.len(), 1);
        assert_eq!(cat.duplicates[0].name, "my_memcpy");
        assert!(dup.auto_tags.contains(&"string".to_string()));
        assert!(cat.cycles.is_empty());
    }

    #[test]
    fn closure_follows_dependencies_transitively_and_honours_exclusions() {
        let f = fx();
        let cat = catalog(&f.lib, &HashMap::new()).unwrap();
        let all = closure(&cat, &["utils/my_str_to_word_array.c".into()], &BTreeSet::new());
        let rels: Vec<&str> = all.iter().map(|r| r.rel.as_str()).collect();
        assert!(rels.contains(&"utils/my_strdup.c") && rels.contains(&"utils/my_strlen.c"));
        assert_eq!(all.iter().find(|r| r.rel == "utils/my_strlen.c").unwrap().needed_by, "utils/my_strdup.c");
        let without = closure(&cat, &["utils/my_str_to_word_array.c".into()], &["utils/my_strdup.c".to_string()].into());
        assert!(without.is_empty());
    }

    #[test]
    fn declared_dependencies_and_cycles_are_reported() {
        let f = fx();
        let mut meta = HashMap::new();
        meta.insert("utils/my_strlen.c".to_string(), Meta { deps: vec!["utils/my_strdup.c".into()], ..Default::default() });
        let cat = catalog(&f.lib, &meta).unwrap();
        let strlen = cat.files.iter().find(|x| x.rel == "utils/my_strlen.c").unwrap();
        assert_eq!(strlen.deps[0].kind, "declared");
        assert_eq!(cat.cycles, vec![vec!["utils/my_strdup.c".to_string(), "utils/my_strlen.c".to_string()]]);
    }

    #[test]
    fn generated_makefiles_static_or_dynamic() {
        let dirs: BTreeSet<String> = ["".to_string(), "utils".to_string()].into_iter().collect();
        let a = generated_makefile("my", &dirs, &[], false);
        assert!(a.contains("libmy.a") && a.contains("ar rc") && !a.contains("-shared"));
        let so = generated_makefile("my", &dirs, &[], true);
        assert!(so.contains("NAME\t=\tlibmy.so") && so.contains("-fPIC") && so.contains("$(CC) -shared -o $(NAME) $(OBJ)") && so.contains("$(wildcard utils/*.c)"));
        assert!(!so.contains("ar rc"));
    }

    #[test]
    fn empty_library_then_one_function_copies_only_what_is_needed() {
        let f = fx();
        let (p, _) = run(&f, &PlanRequest { lib_dir: "lib/my".into(), init: true, ..Default::default() }, &[]);
        assert!(p.actions.iter().all(|a| a.what != "source"));
        let header = fs::read_to_string(f.repo.join("lib/my/my.h")).unwrap();
        assert!(header.contains("buffer_t") && header.contains("external_thing"), "types and foreign prototypes stay");
        assert!(!header.contains("my_strlen"), "no prototype without its function");
        assert!(f.repo.join("lib/my/my_list.h").is_file(), "the Makefile copies it, so it must exist");
        assert_eq!(fs::read_to_string(f.repo.join("lib/my/Makefile")).unwrap(), MAKEFILE);

        let (p, rep) = run(&f, &req(&["utils/my_strlen.c"]), &[]);
        assert!(rep.written.contains(&"lib/my/utils/my_strlen.c".to_string()));
        assert!(p.actions.iter().all(|a| a.what != "makefile"), "utils/*.c is already a wildcard");
        let header = fs::read_to_string(f.repo.join("lib/my/my.h")).unwrap();
        assert!(header.contains("int my_strlen(char const *str);") && !header.contains("my_strdup"));
        assert!(!f.repo.join("lib/my/utils/my_strdup.c").exists());
        assert_eq!(state(&f, "utils/my_strlen.c"), "installed");
        assert_eq!(state(&f, "my.h"), "managed");
    }

    #[test]
    fn dependencies_come_along_and_local_edits_survive_later_installs() {
        let f = fx();
        run(&f, &req(&["utils/my_strlen.c"]), &[]);
        let mine = f.repo.join("lib/my/utils/my_strlen.c");
        fs::write(&mine, "/* my own version */\n").unwrap();
        assert_eq!(state(&f, "utils/my_strlen.c"), "modified");

        let (p, _) = run(&f, &req(&["utils/my_str_to_word_array.c"]), &[]);
        assert!(p.required.iter().any(|r| r.rel == "utils/my_strdup.c"));
        assert!(f.repo.join("lib/my/utils/my_strdup.c").is_file());
        let kept = p.actions.iter().find(|a| a.rel == "utils/my_strlen.c").unwrap();
        assert_eq!(kept.op, "keep");
        assert_eq!(fs::read_to_string(&mine).unwrap(), "/* my own version */\n");
    }

    #[test]
    fn replacing_an_edited_file_needs_confirmation_and_keeps_a_backup() {
        let f = fx();
        run(&f, &req(&["utils/my_strlen.c"]), &[]);
        let mine = f.repo.join("lib/my/utils/my_strlen.c");
        fs::write(&mine, "edited\n").unwrap();
        let r = PlanRequest { lib_dir: "lib/my".into(), replace: vec!["utils/my_strlen.c".into()], ..Default::default() };

        let (p, rep) = run(&f, &r, &[]);
        let a = p.actions.iter().find(|a| a.rel == "utils/my_strlen.c").unwrap();
        assert!(a.risky && a.diff.as_deref().unwrap().contains("-edited"));
        assert_eq!(rep.skipped, vec!["lib/my/utils/my_strlen.c"]);
        assert_eq!(fs::read_to_string(&mine).unwrap(), "edited\n");

        let (_, rep) = run(&f, &r, &["lib/my/utils/my_strlen.c"]);
        assert!(rep.skipped.is_empty());
        assert_eq!(state(&f, "utils/my_strlen.c"), "installed");
        let saved = backups_of(&f.repo, &f.backups, "lib/my/utils/my_strlen.c").unwrap();
        assert_eq!(saved.len(), 1);
        restore_backup(&f.repo, &f.backups, "lib/my/utils/my_strlen.c", &saved[0].stamp).unwrap();
        assert_eq!(fs::read_to_string(&mine).unwrap(), "edited\n");
    }

    #[test]
    fn library_update_is_detected_and_applied_without_fuss_when_untouched() {
        let f = fx();
        run(&f, &req(&["utils/my_getnbr.c"]), &[]);
        fs::write(Path::new(&f.lib.path).join("utils/my_getnbr.c"), c("int my_getnbr(char const *str)", "    return 42;")).unwrap();
        assert_eq!(state(&f, "utils/my_getnbr.c"), "update");
        let r = PlanRequest { lib_dir: "lib/my".into(), replace: vec!["utils/my_getnbr.c".into()], ..Default::default() };
        let (p, rep) = run(&f, &r, &[]);
        assert!(!p.actions.iter().find(|a| a.rel == "utils/my_getnbr.c").unwrap().risky);
        assert_eq!(rep.written, vec!["lib/my/utils/my_getnbr.c"]);
        assert!(fs::read_to_string(f.repo.join("lib/my/utils/my_getnbr.c")).unwrap().contains("42"));
        assert_eq!(state(&f, "utils/my_getnbr.c"), "installed");
    }

    #[test]
    fn removal_warns_about_dependents_and_updates_the_header() {
        let f = fx();
        run(&f, &req(&["utils/my_str_to_word_array.c"]), &[]);
        let r = PlanRequest { lib_dir: "lib/my".into(), remove: vec!["utils/my_strlen.c".into()], ..Default::default() };
        let (p, rep) = run(&f, &r, &[]);
        assert!(p.warnings.iter().any(|w| w.contains("utils/my_strdup.c")), "{:?}", p.warnings);
        assert_eq!(rep.deleted, vec!["lib/my/utils/my_strlen.c"]);
        assert!(!fs::read_to_string(f.repo.join("lib/my/my.h")).unwrap().contains("my_strlen"));
        assert_eq!(backups_of(&f.repo, &f.backups, "lib/my/utils/my_strlen.c").unwrap().len(), 1);
    }

    #[test]
    fn a_hand_written_header_only_gains_prototypes() {
        let f = fx();
        fs::create_dir_all(f.repo.join("lib/my")).unwrap();
        let custom = "#ifndef MY_H\n    #define MY_H\n\nint mine(void);\n\n#endif\n";
        fs::write(f.repo.join("lib/my/my.h"), custom).unwrap();
        let (p, _) = run(&f, &req(&["utils/my_getnbr.c"]), &[]);
        let a = p.actions.iter().find(|a| a.rel == "my.h").unwrap();
        assert_eq!(a.op, "edit");
        let text = fs::read_to_string(f.repo.join("lib/my/my.h")).unwrap();
        assert_eq!(text, "#ifndef MY_H\n    #define MY_H\n\nint mine(void);\nint my_getnbr(char const *str);\n\n#endif\n");
        assert_eq!(state(&f, "my.h"), "custom");
    }

    #[test]
    fn a_full_copy_made_outside_tekboard_is_recognised() {
        let f = fx();
        copy_sources(Path::new(&f.lib.path), &f.repo.join("lib/my")).unwrap();
        assert_eq!(state(&f, "utils/my_strdup.c"), "installed");
        fs::write(f.repo.join("lib/my/utils/my_strdup.c"), "changed\n").unwrap();
        assert_eq!(state(&f, "utils/my_strdup.c"), "differs");
        let (p, rep) = run(&f, &req(&["utils/my_strlen.c"]), &[]);
        assert!(rep.written.is_empty() && rep.deleted.is_empty(), "{:?}", p.actions.iter().map(|a| (&a.path, a.op)).collect::<Vec<_>>());
    }

    #[test]
    fn makefile_gets_a_wildcard_for_a_new_folder() {
        let f = fx();
        let (p, _) = run(&f, &PlanRequest { lib_dir: "lib/my".into(), init: true, ..Default::default() }, &[]);
        assert!(p.warnings.is_empty(), "{:?}", p.warnings);
        fs::create_dir_all(Path::new(&f.lib.path).join("lists")).unwrap();
        fs::write(Path::new(&f.lib.path).join("lists/my_rev.c"), c("void my_rev(void)", "    return;")).unwrap();
        let (p, _) = run(&f, &req(&["lists/my_rev.c"]), &[]);
        let mk = p.actions.iter().find(|a| a.what == "makefile").unwrap();
        assert_eq!(mk.op, "edit");
        let text = fs::read_to_string(f.repo.join("lib/my/Makefile")).unwrap();
        assert!(text.contains("\t$(wildcard mem/*.c) \\\n\t$(wildcard lists/*.c)\n"), "{text}");
    }

    #[test]
    fn makefile_explicit_list_and_unknown_shapes() {
        let explicit = "SRC = a.c \\\n      b.c\n\nall:\n";
        assert_eq!(makefile_update(explicit, &["dir/c.c".into()], &[]), MakeEdit::Edited("SRC = a.c \\\n      b.c \\\n      dir/c.c\n\nall:\n".into()));
        assert_eq!(makefile_update(explicit, &["a.c".into()], &[]), MakeEdit::Unchanged);
        assert_eq!(makefile_update(explicit, &[], &["b.c".into()]), MakeEdit::Edited("SRC = a.c\n\nall:\n".into()));
        assert_eq!(makefile_update("SRC = $(shell find . -name '*.c')\n", &["x/y.c".into()], &[]), MakeEdit::Unchanged);
        assert!(matches!(makefile_update("all:\n\tgcc main.c\n", &["x.c".into()], &[]), MakeEdit::Manual(_)));
        assert!(glob_covers("utils/*.c", "utils/a.c") && !glob_covers("utils/*.c", "utils/sub/a.c") && glob_covers("*/*.c", "x/a.c"));
    }

    #[test]
    fn paths_that_leave_the_project_are_refused() {
        let f = fx();
        assert!(plan(&f.conn, &f.repo, &f.lib, &HashMap::new(), &PlanRequest { lib_dir: "../evil".into(), ..Default::default() }).is_err());
        assert!(plan(&f.conn, &f.repo, &f.lib, &HashMap::new(), &req(&["../../etc/passwd"])).is_err());
        let outside = f.repo.parent().unwrap().join("outside");
        fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, f.repo.join("lib")).unwrap();
        assert!(plan(&f.conn, &f.repo, &f.lib, &HashMap::new(), &req(&["utils/my_strlen.c"])).is_err());
    }

    #[test]
    fn dropped_file_is_analysed_imported_and_shows_up_in_the_catalog() {
        let f = fx();
        let drop = f.repo.parent().unwrap().join("drop");
        fs::create_dir_all(&drop).unwrap();
        let file = drop.join("my_str_isnum.c");
        fs::write(&file, "static int digit(char c)\n{\n    return c >= '0' && c <= '9';\n}\n\nint my_str_isnum(char const *str)\n{\n    return digit(str[0]);\n}\n").unwrap();
        let a = analyze_import(&f.lib, &[file.to_string_lossy().into_owned(), "/nope.c".into(), drop.join("x.txt").to_string_lossy().into_owned()], &drop).unwrap();
        assert_eq!(a.candidates.len(), 1);
        let cand = &a.candidates[0];
        assert_eq!(cand.functions, vec!["my_str_isnum"]);
        assert_eq!(cand.static_functions, vec!["digit"]);
        assert_eq!(cand.suggested_dir, "utils");
        assert_eq!(cand.undeclared, vec!["my_str_isnum"]);
        assert_eq!(a.ignored.len(), 2);

        let item = ImportItem { source: cand.source.clone(), dir: "utils".into(), overwrite: false };
        let rep = import_files(&f.lib, &[item.clone()], Some("my.h"), &f.backups).unwrap();
        assert_eq!(rep.imported, vec!["utils/my_str_isnum.c"]);
        assert_eq!(rep.prototypes_added, vec!["my_str_isnum"]);
        let cat = catalog(&f.lib, &HashMap::new()).unwrap();
        let entry = cat.files.iter().find(|x| x.rel == "utils/my_str_isnum.c").unwrap();
        assert_eq!(entry.functions[0].header.as_deref(), Some("my.h"));

        // Same content again: nothing to do. Different content: refused unless overwrite is on.
        assert_eq!(import_files(&f.lib, &[item.clone()], None, &f.backups).unwrap().unchanged.len(), 1);
        fs::write(&file, "int my_str_isnum(char const *str)\n{\n    return 1;\n}\n").unwrap();
        assert_eq!(import_files(&f.lib, &[item.clone()], None, &f.backups).unwrap().conflicts.len(), 1);
        let rep = import_files(&f.lib, &[ImportItem { overwrite: true, ..item }], None, &f.backups).unwrap();
        assert_eq!(rep.imported.len(), 1);
    }

    #[test]
    fn zip_archives_are_read_without_escaping_the_scratch_folder() {
        use std::io::Write;
        let f = fx();
        let scratch = f.repo.parent().unwrap().join("scratch");
        fs::create_dir_all(&scratch).unwrap();
        let zip_path = scratch.join("pack.zip");
        let mut w = zip::ZipWriter::new(fs::File::create(&zip_path).unwrap());
        let opts = zip::write::SimpleFileOptions::default();
        w.start_file("mod/my_abs.c", opts).unwrap();
        w.write_all(b"int my_abs(int n)\n{\n    return n < 0 ? -n : n;\n}\n").unwrap();
        w.start_file("../escape.c", opts).unwrap();
        w.write_all(b"int escape(void)\n{\n    return 0;\n}\n").unwrap();
        w.start_file("notes.txt", opts).unwrap();
        w.write_all(b"hello").unwrap();
        w.finish().unwrap();
        let a = analyze_import(&f.lib, &[zip_path.to_string_lossy().into_owned()], &scratch).unwrap();
        assert_eq!(a.candidates.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), vec!["my_abs.c"]);
        assert!(!scratch.join("escape.c").exists());
    }

    #[test]
    fn metadata_and_presets_round_trip() {
        let f = fx();
        set_meta(&f.conn, f.lib.id, "utils/my_strlen.c", &Meta { description: Some("Length of a string".into()), tags: vec!["basics".into()], deps: vec![] }).unwrap();
        let cat = catalog(&f.lib, &all_meta(&f.conn, f.lib.id).unwrap()).unwrap();
        let e = cat.files.iter().find(|x| x.rel == "utils/my_strlen.c").unwrap();
        assert_eq!((e.description.as_deref(), e.tags.clone()), (Some("Length of a string"), vec!["basics".to_string()]));
        save_preset(&f.conn, f.lib.id, "Strings", &["utils/my_strlen.c".into()]).unwrap();
        save_preset(&f.conn, f.lib.id, "Strings", &["utils/my_strlen.c".into(), "utils/my_strdup.c".into()]).unwrap();
        let p = presets(&f.conn, f.lib.id).unwrap();
        assert_eq!((p.len(), p[0].files.len()), (1, 2));
        assert!(set_meta(&f.conn, f.lib.id, "../x", &Meta::default()).is_err());
    }

    #[test]
    fn header_filter_keeps_layout() {
        let out = filter_header(MY_H, &|n| n == "my_getnbr" || n == "external_thing");
        assert_eq!(out, "#ifndef MY_H\n    #define MY_H\n    #include \"my_list.h\"\n    #include <stddef.h>\n\ntypedef struct {\n    void *data;\n} buffer_t;\n\nint my_getnbr(char const *str);\nint external_thing(void);\n\n#endif\n");
    }

    /// Run by hand against a real library: `TEKBOARD_REAL_LIB=… cargo test real_library -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn real_library_smoke() {
        let Ok(path) = std::env::var("TEKBOARD_REAL_LIB") else { return };
        let tmp = tempfile::tempdir().unwrap();
        let repo = fs::canonicalize(tmp.path()).unwrap().join("project");
        fs::create_dir_all(&repo).unwrap();
        let conn = db::open_in_memory().unwrap();
        let lib = add(&conn, "Real", Path::new(&path), 1).unwrap();
        let cat = catalog(&lib, &HashMap::new()).unwrap();
        let funcs: usize = cat.files.iter().map(|f| f.functions.len()).sum();
        println!("files {} functions {} parse-errors {:?}", cat.files.len(), funcs, cat.files.iter().filter(|f| f.parse_errors).map(|f| &f.rel).collect::<Vec<_>>());
        println!("duplicates {:?}", cat.duplicates.iter().map(|d| (&d.name, &d.files)).collect::<Vec<_>>());
        println!("cycles {:?}", cat.cycles);
        let wanted: Vec<String> = std::env::var("TEKBOARD_PICK").unwrap_or_default().split(',').filter(|s| !s.is_empty()).map(str::to_string).collect();
        let f = Fx { _tmp: tmp, conn, lib, repo: repo.clone(), backups: repo.parent().unwrap().join("backups") };
        let (p, _) = run(&f, &PlanRequest { lib_dir: "lib/my".into(), init: true, ..Default::default() }, &[]);
        println!("init: {:?} warnings {:?}", p.actions.iter().map(|a| (&a.path, a.op)).collect::<Vec<_>>(), p.warnings);
        let make = |label: &str| {
            let o = std::process::Command::new("make").arg("-C").arg(repo.join("lib/my")).output().unwrap();
            println!("make after {label}: {} {}", o.status, String::from_utf8_lossy(&o.stderr).lines().take(6).collect::<Vec<_>>().join(" | "));
        };
        make("init");
        let (p, rep) = run(&f, &PlanRequest { lib_dir: "lib/my".into(), add: wanted, ..Default::default() }, &[]);
        println!("required {:?}", p.required.iter().map(|r| (&r.rel, &r.via, r.kind)).collect::<Vec<_>>());
        println!("written {:?} warnings {:?}", rep.written, p.warnings);
        make("install");
        println!("{}", fs::read_to_string(repo.join("lib/my/my.h")).unwrap());
    }
}
