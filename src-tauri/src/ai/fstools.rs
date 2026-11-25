//! Reading a project for models that are not Claude Code (OpenRouter, Ollama).
//!
//! The same three tools Claude Code gets (`Read`, `Glob`, `Grep`, with the same arguments, so
//! the activity feed reads the same), run by TekBoard itself:
//! - confined to the project folder (paths are resolved, links included, and must stay in it);
//! - the files of `runner::DENY_READ` (secrets, `.git`) are refused, as they are for Claude;
//! - read-only, with capped output.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const MAX_READ_LINES: usize = 1500;
const MAX_READ_BYTES: usize = 120 * 1024;
const MAX_FILE: u64 = 2 * 1024 * 1024;
const MAX_LIST: usize = 400;
const MAX_MATCHES: usize = 150;
const SKIP: &[&str] = &[".git", "node_modules", "target", "__pycache__", ".venv", "venv", ".cache", "dist", ".next"];

/// `*`, `?` within a path segment; `**` for any number of segments.
pub fn glob_match(pattern: &str, path: &str) -> bool {
    let p: Vec<&str> = pattern.split('/').filter(|s| !s.is_empty() && *s != ".").collect();
    let s: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    segs(&p, &s)
}

fn segs(p: &[&str], s: &[&str]) -> bool {
    match p.first() {
        None => s.is_empty(),
        Some(&"**") => (0..=s.len()).any(|i| segs(&p[1..], &s[i..])),
        Some(first) => !s.is_empty() && seg(first.as_bytes(), s[0].as_bytes()) && segs(&p[1..], &s[1..]),
    }
}

fn seg(p: &[u8], s: &[u8]) -> bool {
    match p.first() {
        None => s.is_empty(),
        Some(b'*') => (0..=s.len()).any(|i| seg(&p[1..], &s[i..])),
        Some(b'?') => !s.is_empty() && seg(&p[1..], &s[1..]),
        Some(c) => s.first() == Some(c) && seg(&p[1..], &s[1..]),
    }
}

/// A pattern without `/` matches a file name at any depth (`*.c`), like in `.gitignore`.
fn matches_user_glob(pattern: &str, rel: &str) -> bool {
    if pattern.contains('/') {
        glob_match(pattern, rel)
    } else {
        rel.rsplit('/').next().is_some_and(|name| seg(pattern.as_bytes(), name.as_bytes()))
    }
}

/// Whether a path (relative to the project) is one the model may never read.
pub fn denied(rel: &str) -> bool {
    super::runner::DENY_READ.iter().filter_map(|r| r.strip_prefix("Read(").and_then(|r| r.strip_suffix(')'))).any(|p| {
        let p = p.trim_start_matches("./");
        glob_match(p, rel) || (p.ends_with("/**") && glob_match(&p[..p.len() - 3], rel))
    })
}

pub struct Fs {
    root: PathBuf,
}

impl Fs {
    pub fn new(dir: &Path) -> Fs {
        Fs { root: std::fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf()) }
    }

    /// The file inside the project, or why not.
    fn resolve(&self, p: &str) -> Result<(PathBuf, String), String> {
        let p = p.trim();
        let joined = if Path::new(p).is_absolute() { PathBuf::from(p) } else { self.root.join(p) };
        let real = std::fs::canonicalize(&joined).map_err(|_| format!("Introuvable : {p}"))?;
        let rel = real.strip_prefix(&self.root).map_err(|_| format!("Refusé : {p} est en dehors du projet."))?.to_string_lossy().replace('\\', "/");
        if denied(&rel) {
            return Err(format!("Refusé : {rel} peut contenir un secret (ou fait partie de .git)."));
        }
        Ok((real, rel))
    }

    fn walk(&self, from: &Path, out: &mut Vec<(PathBuf, String)>, limit: usize) {
        let mut stack = vec![from.to_path_buf()];
        while let Some(dir) = stack.pop() {
            let Ok(rd) = std::fs::read_dir(&dir) else { continue };
            let mut entries: Vec<_> = rd.flatten().collect();
            entries.sort_by_key(|e| e.file_name());
            for e in entries {
                let name = e.file_name().to_string_lossy().into_owned();
                let Ok(ft) = e.file_type() else { continue };
                let path = e.path();
                let rel = path.strip_prefix(&self.root).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default();
                if ft.is_dir() {
                    if !SKIP.contains(&name.as_str()) {
                        stack.push(path);
                    }
                } else if ft.is_file() && !denied(&rel) {
                    out.push((path, rel));
                    if out.len() >= limit {
                        return;
                    }
                }
            }
        }
    }

    fn read(&self, a: &Value) -> Result<String, String> {
        let p = a["file_path"].as_str().or(a["path"].as_str()).ok_or("Paramètre manquant : file_path")?;
        let (real, rel) = self.resolve(p)?;
        if real.is_dir() {
            return Err(format!("{rel} est un dossier : utilise Glob pour lister ses fichiers."));
        }
        if std::fs::metadata(&real).map(|m| m.len()).unwrap_or(0) > MAX_FILE {
            return Err(format!("{rel} est trop gros pour être lu en entier : cherche dedans avec Grep."));
        }
        let bytes = std::fs::read(&real).map_err(|e| format!("Illisible : {rel} ({e})"))?;
        if bytes.iter().take(8000).any(|b| *b == 0) {
            return Err(format!("{rel} est un fichier binaire."));
        }
        let text = String::from_utf8_lossy(&bytes);
        let offset = a["offset"].as_u64().unwrap_or(1).max(1) as usize;
        let limit = a["limit"].as_u64().map(|l| l as usize).unwrap_or(MAX_READ_LINES).min(MAX_READ_LINES);
        let mut out = String::new();
        let mut shown = 0;
        for (i, line) in text.lines().enumerate().skip(offset - 1).take(limit) {
            out.push_str(&format!("{:>5}\t{line}\n", i + 1));
            shown += 1;
            if out.len() > MAX_READ_BYTES {
                out.push_str("[… coupé : utilise offset pour lire la suite]\n");
                break;
            }
        }
        let total = text.lines().count();
        if offset - 1 + shown < total && !out.ends_with("suite]\n") {
            out.push_str(&format!("[… {total} lignes en tout : utilise offset pour lire la suite]\n"));
        }
        Ok(if out.is_empty() { "(fichier vide)".into() } else { out })
    }

    fn glob(&self, a: &Value) -> Result<String, String> {
        let pattern = a["pattern"].as_str().unwrap_or("**").trim();
        let base = match a["path"].as_str().filter(|p| !p.trim().is_empty()) {
            Some(p) => self.resolve(p)?.0,
            None => self.root.clone(),
        };
        let mut files = Vec::new();
        self.walk(&base, &mut files, 20_000);
        let hits: Vec<&String> = files.iter().map(|(_, r)| r).filter(|r| matches_user_glob(pattern, r)).collect();
        if hits.is_empty() {
            return Ok(format!("Aucun fichier ne correspond à {pattern}"));
        }
        let mut out: String = hits.iter().take(MAX_LIST).map(|r| format!("{r}\n")).collect();
        if hits.len() > MAX_LIST {
            out.push_str(&format!("[… {} fichiers en tout]\n", hits.len()));
        }
        Ok(out)
    }

    fn grep(&self, a: &Value) -> Result<String, String> {
        let needle = a["pattern"].as_str().map(str::trim).filter(|p| !p.is_empty()).ok_or("Paramètre manquant : pattern")?;
        let filter = a["glob"].as_str().map(str::trim).filter(|g| !g.is_empty());
        let base = match a["path"].as_str().filter(|p| !p.trim().is_empty()) {
            Some(p) => self.resolve(p)?.0,
            None => self.root.clone(),
        };
        let lower = needle.to_lowercase();
        let mut files = Vec::new();
        if base.is_file() {
            let rel = base.strip_prefix(&self.root).map(|r| r.to_string_lossy().into_owned()).unwrap_or_default();
            files.push((base.clone(), rel));
        } else {
            self.walk(&base, &mut files, 20_000);
        }
        let mut out = String::new();
        let mut n = 0;
        for (path, rel) in files {
            if filter.is_some_and(|g| !matches_user_glob(g, &rel)) || std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0) > MAX_FILE {
                continue;
            }
            let Ok(bytes) = std::fs::read(&path) else { continue };
            if bytes.iter().take(8000).any(|b| *b == 0) {
                continue;
            }
            for (i, line) in String::from_utf8_lossy(&bytes).lines().enumerate() {
                if line.to_lowercase().contains(&lower) {
                    out.push_str(&format!("{rel}:{}: {}\n", i + 1, super::stream::clip(line, 240)));
                    n += 1;
                    if n >= MAX_MATCHES {
                        out.push_str("[… d'autres résultats : précise la recherche]\n");
                        return Ok(out);
                    }
                }
            }
        }
        Ok(if out.is_empty() { format!("Aucun résultat pour « {needle} »") } else { out })
    }

    /// Runs one tool. `Err` is a refusal or a failure, given back to the model as such.
    pub fn call(&self, name: &str, args: &Value) -> Option<Result<String, String>> {
        Some(match name {
            "Read" => self.read(args),
            "Glob" => self.glob(args),
            "Grep" => self.grep(args),
            _ => return None,
        })
    }
}

/// OpenAI `tools` entries of the three tools.
pub fn specs() -> Vec<Value> {
    let f = |name: &str, desc: &str, props: Value, req: &[&str]| json!({"type": "function", "function": {"name": name, "description": desc, "parameters": {"type": "object", "properties": props, "required": req}}});
    vec![
        f("Read", "Lit un fichier texte du projet, avec les numéros de ligne. Les secrets (.env, clés) et .git sont refusés.", json!({"file_path": {"type": "string", "description": "Chemin relatif au projet (ex. src/main.c)"}, "offset": {"type": "integer", "description": "Première ligne (1 par défaut)"}, "limit": {"type": "integer", "description": "Nombre de lignes (1500 au plus)"}}), &["file_path"]),
        f("Glob", "Liste les fichiers du projet qui correspondent à un motif : *.c (n'importe où), src/**/*.h, ** (tout).", json!({"pattern": {"type": "string", "description": "Motif"}, "path": {"type": "string", "description": "Sous-dossier où chercher"}}), &["pattern"]),
        f("Grep", "Cherche un texte (sans tenir compte de la casse) dans les fichiers du projet ; renvoie fichier:ligne: contenu.", json!({"pattern": {"type": "string", "description": "Texte à chercher"}, "glob": {"type": "string", "description": "Limiter aux fichiers de ce motif (ex. *.c)"}, "path": {"type": "string", "description": "Sous-dossier ou fichier"}}), &["pattern"]),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn globs() {
        assert!(glob_match("**/*.c", "src/a/main.c") && glob_match("**/*.c", "main.c"));
        assert!(glob_match("src/*.h", "src/my.h") && !glob_match("src/*.h", "src/x/my.h"));
        assert!(glob_match(".env.*", ".env.local") && !glob_match(".env.*", ".env"));
        assert!(glob_match("**/id_rsa*", "keys/id_rsa.pub"));
        assert!(matches_user_glob("*.c", "deep/dir/file.c") && !matches_user_glob("*.c", "file.h"));
    }

    #[test]
    fn secrets_and_git_are_refused() {
        for p in [".env", "sub/.env", ".env.prod", "certs/server.pem", "a/b.key", ".git/config", ".git", "home/credentials.json", ".netrc"] {
            assert!(denied(p), "{p}");
        }
        for p in ["src/main.c", "Makefile", "README.md", "envelope.c"] {
            assert!(!denied(p), "{p}");
        }
    }

    #[test]
    fn tools_stay_in_the_project() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().join("proj");
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/x")).unwrap();
        std::fs::write(root.join("src/main.c"), "int main(void)\n{\n    return my_putstr(\"hi\");\n}\n").unwrap();
        std::fs::write(root.join(".env"), "TOKEN=secret").unwrap();
        std::fs::write(root.join("node_modules/x/a.c"), "my_putstr").unwrap();
        std::fs::write(d.path().join("outside.txt"), "no").unwrap();
        std::os::unix::fs::symlink(d.path().join("outside.txt"), root.join("link.txt")).unwrap();
        let fs = Fs::new(&root);

        let r = fs.call("Read", &json!({"file_path": "src/main.c"})).unwrap().unwrap();
        assert!(r.contains("    3\t    return my_putstr"), "{r}");
        assert!(fs.call("Read", &json!({"file_path": root.join("src/main.c").to_string_lossy()})).unwrap().is_ok(), "absolute paths inside the project work");
        assert!(fs.call("Read", &json!({"file_path": ".env"})).unwrap().unwrap_err().contains("secret"));
        assert!(fs.call("Read", &json!({"file_path": "../outside.txt"})).unwrap().unwrap_err().contains("en dehors"));
        assert!(fs.call("Read", &json!({"file_path": "link.txt"})).unwrap().unwrap_err().contains("en dehors"), "links out of the project are refused");

        let g = fs.call("Glob", &json!({"pattern": "*.c"})).unwrap().unwrap();
        assert_eq!(g, "src/main.c\n", "node_modules is skipped");
        let all = fs.call("Glob", &json!({"pattern": "**"})).unwrap().unwrap();
        assert!(!all.contains(".env"), "{all}");

        let s = fs.call("Grep", &json!({"pattern": "MY_PUTSTR"})).unwrap().unwrap();
        assert_eq!(s.trim(), "src/main.c:3: return my_putstr(\"hi\");");
        assert!(fs.call("Grep", &json!({"pattern": "TOKEN"})).unwrap().unwrap().starts_with("Aucun"), "secrets are not searched");
        assert!(fs.call("Bash", &json!({})).is_none());
    }
}
