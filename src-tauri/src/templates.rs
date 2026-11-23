//! Template library. A template is a folder: `template.toml` + `files/`.
//! Applying one only ever copies files and substitutes `{{VARIABLES}}`;
//! nothing contained in a template is executed.

use crate::error::{AppError, Result};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Component, Path, PathBuf};

pub type Vars = BTreeMap<String, String>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Manifest {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub builtin: bool,
    #[serde(default)]
    pub created: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub kind: String,
    pub builtin: bool,
    pub created: String,
    pub file_count: usize,
    /// Variables actually referenced by the files or their names.
    pub variables: Vec<String>,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateFile {
    pub rel: String,
    pub size: u64,
    pub text: bool,
}

const MAX_FILES: usize = 2000;
const MAX_BYTES: u64 = 50 * 1024 * 1024;
const PREVIEW_BYTES: usize = 200 * 1024;

fn valid_id(id: &str) -> Result<()> {
    let ok = !id.is_empty() && id.len() <= 80 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if ok { Ok(()) } else { Err(AppError::new("invalid_template", "Modèle inconnu")) }
}

fn template_dir(store: &Path, id: &str) -> Result<PathBuf> {
    valid_id(id)?;
    let dir = store.join(id);
    if !dir.join("template.toml").is_file() {
        return Err(AppError::new("invalid_template", "Modèle inconnu"));
    }
    Ok(dir)
}

/// A relative path that cannot escape its base: no root, no `..`, no empty parts.
pub fn safe_rel(rel: &str) -> Option<PathBuf> {
    if rel.is_empty() || rel.contains('\0') {
        return None;
    }
    let path = Path::new(rel);
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::Normal(part) => out.push(part),
            _ => return None,
        }
    }
    if out.as_os_str().is_empty() { None } else { Some(out) }
}

/// Replaces `{{NAME}}` for known variables. Anything else — including C
/// initialisers such as `{{800, 600}, 32}` — is left untouched.
pub fn render(text: &str, vars: &Vars) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(idx) = rest.find("{{") {
        out.push_str(&rest[..idx]);
        let after = &rest[idx + 2..];
        let ident_len = after.chars().take_while(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || *c == '_').count();
        let ident = &after[..ident_len];
        if ident_len > 0 && after[ident_len..].starts_with("}}") {
            if let Some(value) = vars.get(ident) {
                out.push_str(value);
                rest = &after[ident_len + 2..];
                continue;
            }
        }
        out.push('{');
        rest = &rest[idx + 1..];
    }
    out.push_str(rest);
    out
}

fn referenced_vars(text: &str, into: &mut BTreeSet<String>) {
    let mut rest = text;
    while let Some(idx) = rest.find("{{") {
        let after = &rest[idx + 2..];
        let len = after.chars().take_while(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || *c == '_').count();
        if len > 0 && after[len..].starts_with("}}") {
            into.insert(after[..len].to_string());
        }
        rest = &rest[idx + 1..];
    }
}

/// Regular files under `base`, relative, sorted. Symlinks are never followed.
fn walk(base: &Path) -> Result<Vec<String>> {
    fn rec(base: &Path, dir: &Path, out: &mut Vec<String>) -> Result<()> {
        let mut entries: Vec<_> = fs::read_dir(dir)?.collect::<std::io::Result<Vec<_>>>()?;
        entries.sort_by_key(|e| e.file_name());
        for entry in entries {
            let ft = entry.file_type()?;
            let path = entry.path();
            if ft.is_dir() {
                rec(base, &path, out)?;
            } else if ft.is_file() {
                if let Ok(rel) = path.strip_prefix(base) {
                    out.push(rel.to_string_lossy().into_owned());
                }
            }
        }
        Ok(())
    }
    let mut out = Vec::new();
    if base.is_dir() {
        rec(base, base, &mut out)?;
    }
    Ok(out)
}

fn read_manifest(dir: &Path) -> Result<Manifest> {
    let text = fs::read_to_string(dir.join("template.toml"))?;
    toml::from_str(&text).map_err(|e| AppError::new("invalid_template", format!("template.toml: {e}")))
}

fn write_manifest(dir: &Path, manifest: &Manifest) -> Result<()> {
    let text = toml::to_string_pretty(manifest).map_err(|e| AppError::new("invalid_template", e.to_string()))?;
    fs::write(dir.join("template.toml"), text)?;
    Ok(())
}

fn summarize(store: &Path, id: &str) -> Result<TemplateSummary> {
    let dir = template_dir(store, id)?;
    let manifest = read_manifest(&dir)?;
    let files = walk(&dir.join("files"))?;
    let mut vars = BTreeSet::new();
    for rel in &files {
        referenced_vars(rel, &mut vars);
        if let Ok(text) = fs::read_to_string(dir.join("files").join(rel)) {
            referenced_vars(&text, &mut vars);
        }
    }
    Ok(TemplateSummary {
        id: id.to_string(),
        name: manifest.name,
        description: manifest.description,
        kind: manifest.kind,
        builtin: manifest.builtin,
        created: manifest.created,
        file_count: files.len(),
        variables: vars.into_iter().collect(),
        path: dir.to_string_lossy().into_owned(),
    })
}

pub fn list(store: &Path) -> Result<Vec<TemplateSummary>> {
    let mut out = Vec::new();
    if !store.is_dir() {
        return Ok(out);
    }
    for entry in fs::read_dir(store)? {
        let entry = entry?;
        let id = entry.file_name().to_string_lossy().into_owned();
        if entry.file_type()?.is_dir() {
            // A broken template is skipped rather than hiding all the others.
            if let Ok(summary) = summarize(store, &id) {
                out.push(summary);
            }
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

pub fn files(store: &Path, id: &str) -> Result<Vec<TemplateFile>> {
    let base = template_dir(store, id)?.join("files");
    walk(&base)?
        .into_iter()
        .map(|rel| {
            let path = base.join(&rel);
            let size = path.metadata()?.len();
            Ok(TemplateFile { text: is_text(&path), rel, size })
        })
        .collect()
}

fn is_text(path: &Path) -> bool {
    use std::io::Read;
    let mut buf = vec![0u8; 8192];
    let Ok(mut f) = fs::File::open(path) else { return false };
    let n = f.read(&mut buf).unwrap_or(0);
    !buf[..n].contains(&0)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePreview {
    /// `None` for binary files.
    pub text: Option<String>,
    pub size: u64,
    pub truncated: bool,
}

pub fn read_file(store: &Path, id: &str, rel: &str) -> Result<FilePreview> {
    let base = template_dir(store, id)?.join("files");
    let rel = safe_rel(rel).ok_or_else(|| AppError::new("invalid_path", "Chemin de fichier invalide"))?;
    let path = base.join(rel);
    let meta = fs::symlink_metadata(&path)?;
    if !meta.is_file() {
        return Err(AppError::new("invalid_path", "Ce n'est pas un fichier ordinaire"));
    }
    let bytes = fs::read(&path)?;
    let truncated = bytes.len() > PREVIEW_BYTES;
    let slice = &bytes[..bytes.len().min(PREVIEW_BYTES)];
    let text = if slice.contains(&0) { None } else { Some(String::from_utf8_lossy(slice).into_owned()) };
    Ok(FilePreview { text, size: meta.len(), truncated })
}

fn slug(name: &str) -> String {
    let mut s = String::new();
    for c in name.trim().chars() {
        if c.is_ascii_alphanumeric() {
            s.push(c.to_ascii_lowercase());
        } else if !s.ends_with('-') && !s.is_empty() {
            s.push('-');
        }
    }
    let s = s.trim_matches('-').to_string();
    if s.is_empty() { "template".to_string() } else { s.chars().take(60).collect() }
}

fn unique_id(store: &Path, name: &str) -> String {
    let base = slug(name);
    let mut id = base.clone();
    let mut n = 2;
    while store.join(&id).exists() {
        id = format!("{base}-{n}");
        n += 1;
    }
    id
}

fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub id: String,
    pub files: usize,
    /// Symlinks and special files that were left out.
    pub skipped: usize,
}

/// Copies a folder into the library. The source is only read.
pub fn import_dir(store: &Path, src: &Path, name: &str, description: &str) -> Result<ImportReport> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::new("invalid_name", "Le modèle a besoin d'un nom"));
    }
    if !src.is_dir() {
        return Err(AppError::new("invalid_source", format!("{} is not a directory", src.display())));
    }
    let mut list = Vec::new();
    let mut skipped = 0usize;
    let mut total = 0u64;
    collect_import(src, src, &mut list, &mut skipped, &mut total)?;
    if list.is_empty() {
        return Err(AppError::new("invalid_source", "Ce dossier ne contient aucun fichier à importer"));
    }
    fs::create_dir_all(store)?;
    let id = unique_id(store, name);
    let dir = store.join(&id);
    let result = (|| -> Result<()> {
        fs::create_dir_all(dir.join("files"))?;
        for rel in &list {
            let to = dir.join("files").join(rel);
            if let Some(parent) = to.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(src.join(rel), &to)?;
        }
        write_manifest(&dir, &Manifest { name: name.to_string(), description: description.trim().to_string(), kind: "custom".into(), builtin: false, created: today() })
    })();
    if let Err(e) = result {
        // Only the half-written copy inside the library is removed.
        let _ = fs::remove_dir_all(&dir);
        return Err(e);
    }
    Ok(ImportReport { id, files: list.len(), skipped })
}

fn collect_import(base: &Path, dir: &Path, out: &mut Vec<PathBuf>, skipped: &mut usize, total: &mut u64) -> Result<()> {
    let mut entries: Vec<_> = fs::read_dir(dir)?.collect::<std::io::Result<Vec<_>>>()?;
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let ft = entry.file_type()?;
        let path = entry.path();
        if ft.is_dir() {
            if entry.file_name() == ".git" {
                continue;
            }
            collect_import(base, &path, out, skipped, total)?;
        } else if ft.is_file() {
            *total += entry.metadata()?.len();
            if out.len() >= MAX_FILES || *total > MAX_BYTES {
                return Err(AppError::new("template_too_large", format!("Un modèle est limité à {MAX_FILES} fichiers et {} Mo", MAX_BYTES / 1024 / 1024)));
            }
            out.push(path.strip_prefix(base).map_err(|_| AppError::new("invalid_source", "Chemin inattendu"))?.to_path_buf());
        } else {
            *skipped += 1;
        }
    }
    Ok(())
}

pub fn duplicate(store: &Path, id: &str, name: &str) -> Result<String> {
    let src = template_dir(store, id)?;
    let mut manifest = read_manifest(&src)?;
    let report = import_dir(store, &src.join("files"), name, &manifest.description)?;
    manifest.name = name.trim().to_string();
    manifest.builtin = false;
    manifest.created = today();
    write_manifest(&store.join(&report.id), &manifest)?;
    Ok(report.id)
}

pub fn delete(store: &Path, id: &str) -> Result<()> {
    let dir = template_dir(store, id)?;
    fs::remove_dir_all(dir)?;
    Ok(())
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    /// The file does not exist in the project yet.
    Add,
    /// Already there with the same content: nothing to do.
    Identical,
    /// A different file exists. Only replaced when explicitly requested.
    Conflict,
    /// Something that is not a regular file is in the way. Never replaced.
    Blocked,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanEntry {
    /// Path inside the template.
    pub source: String,
    /// Path inside the project, variables substituted.
    pub dest: String,
    pub action: Action,
    pub size: u64,
}

struct Prepared {
    entry: PlanEntry,
    content: Vec<u8>,
    mode: u32,
}

fn prepare(store: &Path, id: &str, target: &Path, vars: &Vars) -> Result<Vec<Prepared>> {
    use std::os::unix::fs::PermissionsExt;
    let base = template_dir(store, id)?.join("files");
    if !target.is_dir() {
        return Err(AppError::new("invalid_target", format!("{} is not an existing directory", target.display())));
    }
    let mut out = Vec::new();
    let mut seen = BTreeSet::new();
    for source in walk(&base)? {
        let dest_s = render(&source, vars);
        let dest = safe_rel(&dest_s).ok_or_else(|| AppError::new("template_incompatible", format!("« {source} » donne un chemin dangereux (« {dest_s} »). Vérifie les valeurs des variables.")))?;
        if dest.components().next().is_some_and(|c| c.as_os_str() == ".git") {
            return Err(AppError::new("template_incompatible", "Un modèle ne peut pas écrire dans .git"));
        }
        let dest_s = dest.to_string_lossy().into_owned();
        if !seen.insert(dest_s.clone()) {
            return Err(AppError::new("template_incompatible", format!("Deux fichiers du modèle donnent « {dest_s} »")));
        }
        let src_path = base.join(&source);
        let mode = src_path.metadata()?.permissions().mode();
        let raw = fs::read(&src_path)?;
        let content = match String::from_utf8(raw) {
            Ok(text) => render(&text, vars).into_bytes(),
            Err(e) => e.into_bytes(),
        };
        let existing = target.join(&dest);
        let action = match fs::symlink_metadata(&existing) {
            Err(_) => {
                // A file sitting where a parent folder is needed blocks the entry.
                let blocked = dest.ancestors().skip(1).filter(|a| !a.as_os_str().is_empty()).any(|a| fs::symlink_metadata(target.join(a)).map(|m| !m.is_dir()).unwrap_or(false));
                if blocked { Action::Blocked } else { Action::Add }
            }
            Ok(meta) if meta.is_file() => {
                if fs::read(&existing).map(|cur| cur == content).unwrap_or(false) { Action::Identical } else { Action::Conflict }
            }
            Ok(_) => Action::Blocked,
        };
        out.push(Prepared { entry: PlanEntry { source, dest: dest_s, action, size: content.len() as u64 }, content, mode });
    }
    Ok(out)
}

/// Dry run: what applying the template would do. Writes nothing.
pub fn plan(store: &Path, id: &str, target: &Path, vars: &Vars) -> Result<Vec<PlanEntry>> {
    Ok(prepare(store, id, target, vars)?.into_iter().map(|p| p.entry).collect())
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ApplyReport {
    pub written: Vec<String>,
    pub overwritten: Vec<String>,
    pub skipped: Vec<String>,
    /// Where replaced files were saved first, when any was replaced.
    pub backup_dir: Option<String>,
}

/// Writes the `selected` entries. Existing files are replaced only when also
/// listed in `overwrite`, and the previous version is copied to `backup_root` first.
pub fn apply(store: &Path, id: &str, target: &Path, vars: &Vars, selected: &[String], overwrite: &[String], backup_root: &Path) -> Result<ApplyReport> {
    use std::os::unix::fs::PermissionsExt;
    let prepared = prepare(store, id, target, vars)?;
    let target_canon = fs::canonicalize(target)?;
    let mut report = ApplyReport::default();
    let backup_dir = backup_root.join(chrono::Local::now().format("%Y%m%d-%H%M%S%.3f").to_string());

    for p in prepared {
        let dest = &p.entry.dest;
        if !selected.contains(dest) {
            continue;
        }
        let replace = match p.entry.action {
            Action::Add => false,
            Action::Conflict if overwrite.contains(dest) => true,
            Action::Identical | Action::Conflict | Action::Blocked => {
                report.skipped.push(dest.clone());
                continue;
            }
        };
        let path = target.join(dest);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
            // A symlinked folder must not lead the write outside the project.
            if !fs::canonicalize(parent)?.starts_with(&target_canon) {
                return Err(AppError::new("template_incompatible", format!("« {dest} » serait écrit hors du projet")));
            }
        }
        if replace {
            let saved = backup_dir.join(dest);
            if let Some(parent) = saved.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&path, &saved)?;
            fs::write(&path, &p.content)?;
            report.overwritten.push(dest.clone());
        } else {
            use std::io::Write;
            // create_new: if the file appeared since the plan, fail instead of clobbering it.
            let mut f = fs::OpenOptions::new().write(true).create_new(true).open(&path).map_err(|e| {
                if e.kind() == std::io::ErrorKind::AlreadyExists {
                    AppError::new("target_changed", format!("« {dest} » est apparu dans le projet pendant l'application. Il n'a pas été touché."))
                } else {
                    AppError::Io(e)
                }
            })?;
            f.write_all(&p.content)?;
        }
        if p.mode & 0o111 != 0 {
            let mut perms = fs::metadata(&path)?.permissions();
            perms.set_mode(perms.mode() | 0o111);
            fs::set_permissions(&path, perms)?;
        }
        report.written.push(dest.clone());
    }
    if !report.overwritten.is_empty() {
        report.backup_dir = Some(backup_dir.to_string_lossy().into_owned());
    }
    Ok(report)
}

/// Uppercase C identifier, for include guards.
pub fn c_ident_upper(name: &str) -> String {
    let s: String = name.chars().map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_uppercase() } else { '_' }).collect();
    if s.chars().next().is_some_and(|c| c.is_ascii_digit()) { format!("_{s}") } else { s }
}

struct Builtin {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    kind: &'static str,
    files: &'static [(&'static str, &'static str)],
}

const BUILTINS: &[Builtin] = &[
    Builtin {
        id: "c-minimal",
        name: "C minimal",
        description: "Makefile (epiclang, explicit sources), src/, include/ and a .gitignore. Nothing the subject might forbid.",
        kind: "c",
        files: &[
            ("Makefile", include_str!("../builtin/c-minimal/Makefile")),
            (".gitignore", include_str!("../builtin/c-minimal/gitignore")),
            ("src/main.c", include_str!("../builtin/c-minimal/main.c")),
            ("include/{{PROJECT_NAME}}.h", include_str!("../builtin/c-minimal/header.h")),
        ],
    },
    Builtin {
        id: "csfml",
        name: "CSFML",
        description: "Graphical project: Makefile linked against CSFML, assets/ folder and a minimal window loop written for CSFML 3.0. Check the version required by your subject.",
        kind: "csfml",
        files: &[
            ("Makefile", include_str!("../builtin/csfml/Makefile")),
            (".gitignore", include_str!("../builtin/c-minimal/gitignore")),
            ("src/main.c", include_str!("../builtin/csfml/main.c")),
            ("include/{{PROJECT_NAME}}.h", include_str!("../builtin/c-minimal/header.h")),
            ("assets/.gitkeep", ""),
        ],
    },
];

const BUILTIN_MARKER: &str = ".builtins-v1";

/// Installs the bundled templates once. A built-in the user deleted stays deleted.
pub fn ensure_builtins(store: &Path) -> Result<()> {
    fs::create_dir_all(store)?;
    if store.join(BUILTIN_MARKER).exists() {
        return Ok(());
    }
    for b in BUILTINS {
        let dir = store.join(b.id);
        if dir.exists() {
            continue;
        }
        for (rel, content) in b.files {
            let path = dir.join("files").join(rel);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(path, content)?;
        }
        write_manifest(&dir, &Manifest { name: b.name.into(), description: b.description.into(), kind: b.kind.into(), builtin: true, created: today() })?;
    }
    fs::write(store.join(BUILTIN_MARKER), "")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vars() -> Vars {
        [("PROJECT_NAME", "my_ls"), ("YEAR", "2026"), ("BINARY_NAME", "my_ls"), ("PROJECT_NAME_UPPER", "MY_LS")].iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    fn setup() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let store = tmp.path().join("templates");
        let target = tmp.path().join("project");
        fs::create_dir_all(&target).unwrap();
        ensure_builtins(&store).unwrap();
        (tmp, store, target)
    }

    #[test]
    fn render_substitutes_only_known_variables() {
        let v = vars();
        assert_eq!(render("NAME = {{BINARY_NAME}}", &v), "NAME = my_ls");
        assert_eq!(render("{{UNKNOWN}} {{ YEAR }} {{year}}", &v), "{{UNKNOWN}} {{ YEAR }} {{year}}");
        assert_eq!(render("sfVideoMode m = {{800, 600}, 32}; \"{{PROJECT_NAME}}\"", &v), "sfVideoMode m = {{800, 600}, 32}; \"my_ls\"");
        assert_eq!(render("{{{YEAR}}}", &v), "{2026}");
        assert_eq!(render("{{", &v), "{{");
        assert_eq!(render("é{{YEAR}}é", &v), "é2026é");
    }

    #[test]
    fn safe_rel_rejects_escapes() {
        assert!(safe_rel("src/main.c").is_some());
        for bad in ["", "/etc/passwd", "../x", "a/../../x", "a/./b/..", "."] {
            assert!(safe_rel(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn builtins_install_once_and_stay_deleted() {
        let (_tmp, store, _target) = setup();
        let ids: Vec<String> = list(&store).unwrap().into_iter().map(|t| t.id).collect();
        assert_eq!(ids, vec!["c-minimal", "csfml"]);
        delete(&store, "csfml").unwrap();
        ensure_builtins(&store).unwrap();
        assert_eq!(list(&store).unwrap().len(), 1);
        let summary = &list(&store).unwrap()[0];
        assert!(summary.builtin);
        assert!(summary.variables.contains(&"PROJECT_NAME".to_string()));
    }

    #[test]
    fn plan_then_apply_on_empty_project() {
        let (tmp, store, target) = setup();
        let p = plan(&store, "c-minimal", &target, &vars()).unwrap();
        assert!(p.iter().all(|e| e.action == Action::Add));
        assert!(p.iter().any(|e| e.dest == "include/my_ls.h"));
        assert!(fs::read_dir(&target).unwrap().next().is_none(), "plan must not write");

        let all: Vec<String> = p.iter().map(|e| e.dest.clone()).collect();
        let report = apply(&store, "c-minimal", &target, &vars(), &all, &[], &tmp.path().join("backups")).unwrap();
        assert_eq!(report.written.len(), all.len());
        assert!(report.backup_dir.is_none());
        let makefile = fs::read_to_string(target.join("Makefile")).unwrap();
        assert!(makefile.contains("my_ls") && !makefile.contains("{{"));
        assert!(fs::read_to_string(target.join("include/my_ls.h")).unwrap().contains("MY_LS_H_"));

        let again = plan(&store, "c-minimal", &target, &vars()).unwrap();
        assert!(again.iter().all(|e| e.action == Action::Identical));
    }

    #[test]
    fn existing_files_are_kept_unless_overwrite_is_explicit() {
        let (tmp, store, target) = setup();
        fs::write(target.join("Makefile"), "mine\n").unwrap();
        let p = plan(&store, "c-minimal", &target, &vars()).unwrap();
        assert_eq!(p.iter().find(|e| e.dest == "Makefile").unwrap().action, Action::Conflict);
        let all: Vec<String> = p.iter().map(|e| e.dest.clone()).collect();
        let backups = tmp.path().join("backups");

        let report = apply(&store, "c-minimal", &target, &vars(), &all, &[], &backups).unwrap();
        assert_eq!(report.skipped, vec!["Makefile"]);
        assert_eq!(fs::read_to_string(target.join("Makefile")).unwrap(), "mine\n");

        let report = apply(&store, "c-minimal", &target, &vars(), &all, &["Makefile".into()], &backups).unwrap();
        assert_eq!(report.overwritten, vec!["Makefile"]);
        let saved = PathBuf::from(report.backup_dir.unwrap()).join("Makefile");
        assert_eq!(fs::read_to_string(saved).unwrap(), "mine\n");
        assert!(fs::read_to_string(target.join("Makefile")).unwrap().contains("my_ls"));
    }

    #[test]
    fn partial_selection_only_writes_selected() {
        let (tmp, store, target) = setup();
        let report = apply(&store, "c-minimal", &target, &vars(), &[".gitignore".into()], &[], &tmp.path().join("b")).unwrap();
        assert_eq!(report.written, vec![".gitignore"]);
        assert!(!target.join("Makefile").exists());
    }

    #[test]
    fn unsafe_variable_values_make_the_template_incompatible() {
        let (_tmp, store, target) = setup();
        let mut v = vars();
        v.insert("PROJECT_NAME".into(), "../../evil".into());
        assert_eq!(plan(&store, "c-minimal", &target, &v).unwrap_err().code(), "template_incompatible");
        assert!(fs::read_dir(&target).unwrap().next().is_none());
    }

    #[test]
    fn blocked_when_a_file_sits_where_a_folder_is_needed() {
        let (tmp, store, target) = setup();
        fs::write(target.join("src"), "i am a file").unwrap();
        let p = plan(&store, "c-minimal", &target, &vars()).unwrap();
        assert_eq!(p.iter().find(|e| e.dest == "src/main.c").unwrap().action, Action::Blocked);
        let all: Vec<String> = p.iter().map(|e| e.dest.clone()).collect();
        let report = apply(&store, "c-minimal", &target, &vars(), &all, &all, &tmp.path().join("b")).unwrap();
        assert!(report.skipped.contains(&"src/main.c".to_string()));
        assert_eq!(fs::read_to_string(target.join("src")).unwrap(), "i am a file");
    }

    #[test]
    fn symlinked_folder_cannot_redirect_writes_outside() {
        let (tmp, store, target) = setup();
        let outside = tmp.path().join("outside");
        fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, target.join("src")).unwrap();
        let p = plan(&store, "c-minimal", &target, &vars()).unwrap();
        assert_eq!(p.iter().find(|e| e.dest == "src/main.c").unwrap().action, Action::Blocked);
        let sel = vec!["src/main.c".to_string()];
        let report = apply(&store, "c-minimal", &target, &vars(), &sel, &sel, &tmp.path().join("b")).unwrap();
        assert_eq!(report.skipped, sel);
        assert!(report.written.is_empty());
        assert!(fs::read_dir(&outside).unwrap().next().is_none());
    }

    #[test]
    fn import_copies_without_git_and_symlinks() {
        let (tmp, store, _target) = setup();
        let src = tmp.path().join("blueprint");
        fs::create_dir_all(src.join(".git")).unwrap();
        fs::create_dir_all(src.join("lib/my")).unwrap();
        fs::write(src.join(".git/config"), "secret").unwrap();
        fs::write(src.join("Makefile"), "all:\n").unwrap();
        fs::write(src.join("lib/my/my.h"), "").unwrap();
        std::os::unix::fs::symlink("/etc/hostname", src.join("link")).unwrap();
        let report = import_dir(&store, &src, "My Blueprint!", "from tekinit").unwrap();
        assert_eq!(report.id, "my-blueprint");
        assert_eq!((report.files, report.skipped), (2, 1));
        let rels: Vec<String> = files(&store, &report.id).unwrap().into_iter().map(|f| f.rel).collect();
        assert_eq!(rels, vec!["Makefile", "lib/my/my.h"]);
        assert!(src.join("Makefile").exists(), "source untouched");
        let second = import_dir(&store, &src, "My Blueprint!", "").unwrap();
        assert_eq!(second.id, "my-blueprint-2");
        assert_eq!(import_dir(&store, &tmp.path().join("nope"), "x", "").unwrap_err().code(), "invalid_source");
        assert_eq!(import_dir(&store, &src, "  ", "").unwrap_err().code(), "invalid_name");
    }

    #[test]
    fn duplicate_and_preview() {
        let (_tmp, store, _target) = setup();
        let id = duplicate(&store, "c-minimal", "Mine").unwrap();
        let t = list(&store).unwrap().into_iter().find(|t| t.id == id).unwrap();
        assert!(!t.builtin);
        assert_eq!(t.file_count, 4);
        let preview = read_file(&store, &id, "Makefile").unwrap();
        assert!(preview.text.unwrap().contains("{{BINARY_NAME}}"));
        assert_eq!(read_file(&store, &id, "../template.toml").unwrap_err().code(), "invalid_path");
        assert_eq!(read_file(&store, "../x", "Makefile").unwrap_err().code(), "invalid_template");
    }

    #[test]
    fn c_identifiers() {
        assert_eq!(c_ident_upper("my-top"), "MY_TOP");
        assert_eq!(c_ident_upper("101pong"), "_101PONG");
    }
}
