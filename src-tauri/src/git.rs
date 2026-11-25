//! Thin wrapper around the git CLI. Arguments are always passed as an array:
//! nothing here goes through a shell.

use crate::error::{AppError, Result};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

fn base(dir: Option<&Path>) -> Command {
    let mut cmd = Command::new("git");
    if let Some(dir) = dir {
        cmd.arg("-C").arg(dir);
    }
    // Never block on a credential prompt: the app has no terminal to answer it.
    cmd.env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(Stdio::null());
    cmd
}

pub struct Output {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
}

pub fn run_raw(dir: Option<&Path>, args: &[&str]) -> Result<Output> {
    let out = base(dir).args(args).output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::new("git_missing", "git is not installed or not in PATH")
        } else {
            AppError::Io(e)
        }
    })?;
    Ok(Output {
        ok: out.status.success(),
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
    })
}

pub fn run(dir: Option<&Path>, args: &[&str]) -> Result<String> {
    let out = run_raw(dir, args)?;
    if out.ok {
        Ok(out.stdout)
    } else {
        Err(AppError::new("git_failed", clean_stderr(&out.stderr)))
    }
}

fn clean_stderr(stderr: &str) -> String {
    let msg = stderr.trim();
    if msg.is_empty() { "git command failed".to_string() } else { msg.to_string() }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoStatus {
    /// `None` when HEAD is detached.
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub staged: u32,
    pub unstaged: u32,
    pub untracked: u32,
    pub conflicted: u32,
    /// Repository without any commit yet.
    pub unborn: bool,
}

impl RepoStatus {
    pub fn dirty(&self) -> bool {
        self.staged + self.unstaged + self.untracked + self.conflicted > 0
    }
}

/// Parses `git status --porcelain=v2 --branch`.
pub fn parse_status(text: &str) -> RepoStatus {
    let mut st = RepoStatus::default();
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("# branch.oid ") {
            st.unborn = rest.trim() == "(initial)";
        } else if let Some(rest) = line.strip_prefix("# branch.head ") {
            let head = rest.trim();
            st.branch = if head == "(detached)" { None } else { Some(head.to_string()) };
        } else if let Some(rest) = line.strip_prefix("# branch.upstream ") {
            st.upstream = Some(rest.trim().to_string());
        } else if let Some(rest) = line.strip_prefix("# branch.ab ") {
            for tok in rest.split_whitespace() {
                if let Some(n) = tok.strip_prefix('+') {
                    st.ahead = n.parse().unwrap_or(0);
                } else if let Some(n) = tok.strip_prefix('-') {
                    st.behind = n.parse().unwrap_or(0);
                }
            }
        } else if line.starts_with("1 ") || line.starts_with("2 ") {
            let xy = line.as_bytes();
            if xy.len() >= 4 {
                if xy[2] != b'.' {
                    st.staged += 1;
                }
                if xy[3] != b'.' {
                    st.unstaged += 1;
                }
            }
        } else if line.starts_with("u ") {
            st.conflicted += 1;
        } else if line.starts_with("? ") {
            st.untracked += 1;
        }
    }
    st
}

pub fn status(repo: &Path) -> Result<RepoStatus> {
    let out = run(Some(repo), &["status", "--porcelain=v2", "--branch"])?;
    Ok(parse_status(&out))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub hash: String,
    pub subject: String,
    pub author: String,
    /// ISO 8601, committer date.
    pub date: String,
}

pub fn last_commit(repo: &Path) -> Option<Commit> {
    let out = run(Some(repo), &["log", "-1", "--format=%H%x1f%s%x1f%an%x1f%cI"]).ok()?;
    let mut it = out.trim_end().split('\u{1f}');
    Some(Commit {
        hash: it.next()?.to_string(),
        subject: it.next()?.to_string(),
        author: it.next()?.to_string(),
        date: it.next()?.to_string(),
    })
}

pub fn origin_url(repo: &Path) -> Option<String> {
    let out = run_raw(Some(repo), &["config", "--get", "remote.origin.url"]).ok()?;
    let url = out.stdout.trim();
    if out.ok && !url.is_empty() { Some(url.to_string()) } else { None }
}

/// URL of the remote to show in a browser: `origin`, else the first remote git lists.
pub fn any_remote_url(repo: &Path) -> Option<String> {
    origin_url(repo).or_else(|| {
        let names = run(Some(repo), &["remote"]).ok()?;
        let first = names.lines().map(str::trim).find(|n| !n.is_empty())?.to_string();
        let out = run_raw(Some(repo), &["config", "--get", &format!("remote.{first}.url")]).ok()?;
        let url = out.stdout.trim();
        (out.ok && !url.is_empty()).then(|| url.to_string())
    })
}

/// The real host behind an SSH alias (`Host gh-school` in `~/.ssh/config`), asked to ssh itself.
pub fn ssh_hostname(alias: &str) -> Option<String> {
    if alias.is_empty() || alias.starts_with('-') || !alias.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_')) {
        return None;
    }
    let out = crate::toolenv::command("ssh").args(["-G", alias]).stdin(Stdio::null()).output().ok()?;
    String::from_utf8_lossy(&out.stdout).lines().find_map(|l| l.strip_prefix("hostname ").map(|h| h.trim().to_string())).filter(|h| !h.is_empty())
}

/// The web page of a remote: `git@github.com:Org/repo.git`, `ssh://…` and `https://…` all
/// become `https://github.com/Org/repo`. `resolve` turns an SSH alias into its real host.
/// Returns `None` for a remote that is not on a web host (a local path, a bare name).
pub fn web_url(remote: &str, resolve: impl Fn(&str) -> Option<String>) -> Option<String> {
    let r = crate::epitech::parse_remote(remote)?;
    let host = if r.host.contains('.') { r.host.clone() } else { resolve(&r.host)? };
    let host = host.to_lowercase();
    let host_ok = host.contains('.') && !host.starts_with(['.', '-']) && host.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-'));
    let part_ok = |p: &str| !p.is_empty() && !p.starts_with(['.', '-']) && p.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'));
    // GitLab-style groups may be nested: every segment is checked.
    if !host_ok || !r.owner.split('/').all(part_ok) || !part_ok(&r.name) {
        return None;
    }
    Some(format!("https://{host}/{}/{}", r.owner, r.name))
}

pub fn config_get(repo: Option<&Path>, key: &str) -> Option<String> {
    let out = run_raw(repo, &["config", "--get", key]).ok()?;
    let v = out.stdout.trim();
    if out.ok && !v.is_empty() { Some(v.to_string()) } else { None }
}

/// Only transports we expect for a school or personal repository are accepted.
pub fn validate_clone_url(url: &str) -> Result<()> {
    let url = url.trim();
    let bad = |m: &str| Err(AppError::new("invalid_url", m.to_string()));
    if url.is_empty() {
        return bad("The repository URL is empty");
    }
    if url.starts_with('-') || url.contains(char::is_whitespace) || url.contains("::") {
        return bad("This does not look like a repository URL");
    }
    let known_scheme = ["ssh://", "https://", "file://"].iter().any(|p| url.starts_with(p));
    let scp_like = !url.contains("://") && url.split_once(':').is_some_and(|(l, r)| !l.contains('/') && !l.is_empty() && !r.is_empty());
    if !known_scheme && !scp_like {
        return bad("Use an SSH (git@host:owner/repo.git) or HTTPS URL");
    }
    Ok(())
}

pub fn clone(url: &str, dest: &Path) -> Result<()> {
    validate_clone_url(url)?;
    let dest_s = dest.to_string_lossy();
    let out = run_raw(None, &["clone", "--", url.trim(), &dest_s])?;
    if out.ok {
        return Ok(());
    }
    let err = clean_stderr(&out.stderr);
    let lower = err.to_lowercase();
    let code = if lower.contains("permission denied") || lower.contains("authentication failed") || lower.contains("host key verification failed") {
        "auth_failed"
    } else if lower.contains("could not resolve host") || lower.contains("network is unreachable") || lower.contains("connection timed out") || lower.contains("could not resolve hostname") {
        "offline"
    } else if lower.contains("repository not found") || lower.contains("does not appear to be a git repository") {
        "repo_not_found"
    } else {
        "clone_failed"
    };
    Err(AppError::new(code, err))
}

pub fn add(repo: &Path, files: &[String]) -> Result<()> {
    if files.is_empty() {
        return Ok(());
    }
    let mut args: Vec<&str> = vec!["add", "--"];
    args.extend(files.iter().map(String::as_str));
    run(Some(repo), &args).map(|_| ())
}

pub fn commit(repo: &Path, message: &str) -> Result<()> {
    let message = message.trim();
    if message.is_empty() {
        return Err(AppError::new("empty_message", "Le message de commit est vide"));
    }
    run(Some(repo), &["commit", "-m", message]).map(|_| ())
}

pub fn unstage(repo: &Path, files: &[String]) -> Result<()> {
    if files.is_empty() {
        return Ok(());
    }
    // Before the first commit there is no HEAD to reset to.
    let unborn = status(repo)?.unborn;
    let mut args: Vec<&str> = if unborn { vec!["rm", "--cached", "-q", "--"] } else { vec!["reset", "-q", "--"] };
    args.extend(files.iter().map(String::as_str));
    run(Some(repo), &args).map(|_| ())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub path: String,
    /// Status letter in the index (`M`, `A`, `D`, `R`…), `None` when not staged.
    pub staged: Option<char>,
    /// Status letter in the working tree, `None` when unchanged there.
    pub unstaged: Option<char>,
    pub untracked: bool,
    pub conflicted: bool,
}

/// Parses `git status --porcelain=v1 -z`.
pub fn parse_changes(text: &str) -> Vec<Change> {
    let mut out = Vec::new();
    let mut parts = text.split('\0');
    while let Some(entry) = parts.next() {
        if entry.len() < 4 {
            continue;
        }
        let x = entry.as_bytes()[0] as char;
        let y = entry.as_bytes()[1] as char;
        let path = entry[3..].to_string();
        if x == 'R' || x == 'C' {
            // The original path follows as its own NUL-terminated field.
            parts.next();
        }
        let untracked = x == '?' && y == '?';
        let conflicted = x == 'U' || y == 'U' || (x == 'A' && y == 'A') || (x == 'D' && y == 'D');
        let letter = |c: char| if c == ' ' || c == '?' { None } else { Some(c) };
        out.push(Change { path, staged: if untracked || conflicted { None } else { letter(x) }, unstaged: if untracked { None } else { letter(y) }, untracked, conflicted });
    }
    out
}

pub fn changes(repo: &Path) -> Result<Vec<Change>> {
    Ok(parse_changes(&run(Some(repo), &["status", "--porcelain=v1", "-z", "--untracked-files=all"])?))
}

const DIFF_CAP: usize = 300 * 1024;

fn cap(mut text: String) -> String {
    if text.len() > DIFF_CAP {
        let mut end = DIFF_CAP;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        text.truncate(end);
        text.push_str("\n… (diff truncated)\n");
    }
    text
}

/// Diff of one file. `staged` compares the index with HEAD, otherwise the working tree with the index.
pub fn diff(repo: &Path, path: &str, staged: bool) -> Result<String> {
    let mut args = vec!["diff", "--no-color", "--no-ext-diff"];
    if staged {
        args.push("--cached");
    }
    args.extend(["--", path]);
    Ok(cap(run(Some(repo), &args)?))
}

/// Content of an untracked file, shown as an all-additions diff.
pub fn untracked_preview(repo: &Path, path: &str) -> Result<String> {
    let bytes = std::fs::read(repo.join(path))?;
    if bytes.iter().take(8192).any(|b| *b == 0) {
        return Ok(format!("Binary file ({} bytes)\n", bytes.len()));
    }
    let text = String::from_utf8_lossy(&bytes);
    Ok(cap(text.lines().map(|l| format!("+{l}\n")).collect()))
}

pub fn log(repo: &Path, range: Option<&str>, limit: u32) -> Result<Vec<Commit>> {
    let n = format!("-{limit}");
    let mut args = vec!["log", n.as_str(), "--format=%H%x1f%s%x1f%an%x1f%cI"];
    if let Some(range) = range {
        args.push(range);
    }
    let out = run_raw(Some(repo), &args)?;
    if !out.ok {
        // No commit yet, or no upstream for the requested range.
        return Ok(vec![]);
    }
    Ok(out
        .stdout
        .lines()
        .filter_map(|line| {
            let mut it = line.split('\u{1f}');
            Some(Commit { hash: it.next()?.to_string(), subject: it.next()?.to_string(), author: it.next()?.to_string(), date: it.next()?.to_string() })
        })
        .collect())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    pub name: String,
    pub current: bool,
    pub upstream: Option<String>,
}

pub fn branches(repo: &Path) -> Result<Vec<Branch>> {
    let out = run(Some(repo), &["for-each-ref", "--format=%(HEAD)%1f%(refname:short)%1f%(upstream:short)", "refs/heads"])?;
    Ok(out
        .lines()
        .filter_map(|line| {
            let mut it = line.split('\u{1f}');
            let head = it.next()?;
            let name = it.next()?.to_string();
            let upstream = it.next().filter(|u| !u.is_empty()).map(str::to_string);
            Some(Branch { name, current: head == "*", upstream })
        })
        .collect())
}

pub fn validate_branch_name(repo: &Path, name: &str) -> Result<()> {
    let name = name.trim();
    let ok = !name.is_empty() && !name.starts_with('-') && run_raw(Some(repo), &["check-ref-format", "--branch", name]).map(|o| o.ok).unwrap_or(false);
    if ok { Ok(()) } else { Err(AppError::new("invalid_branch", format!("« {name} » n'est pas un nom de branche valide"))) }
}

pub fn create_branch(repo: &Path, name: &str) -> Result<()> {
    validate_branch_name(repo, name)?;
    run(Some(repo), &["switch", "-c", name.trim()]).map(|_| ())
}

/// Switches branch. Git itself refuses when local changes would be overwritten.
pub fn switch_branch(repo: &Path, name: &str) -> Result<()> {
    validate_branch_name(repo, name)?;
    run(Some(repo), &["switch", name.trim()]).map(|_| ())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sync {
    Fetch,
    /// Fast-forward only: never creates a merge commit, never rewrites anything.
    Pull,
    /// Plain push. Never forced.
    Push,
}

/// Network operation with a time limit. Returns git's own output.
pub fn sync(repo: &Path, op: Sync) -> Result<String> {
    let st = status(repo)?;
    let mut argv: Vec<String> = vec!["git".into()];
    match op {
        Sync::Fetch => argv.push("fetch".into()),
        Sync::Pull => argv.extend(["pull".into(), "--ff-only".into()]),
        Sync::Push => {
            argv.push("push".into());
            if st.upstream.is_none() {
                let branch = st.branch.clone().ok_or_else(|| AppError::new("detached", "HEAD est détachée : passe sur une branche avant d'envoyer"))?;
                argv.extend(["-u".into(), "origin".into(), branch]);
            }
        }
    }
    let mut envs: Vec<(&str, &str)> = vec![("GIT_TERMINAL_PROMPT", "0"), ("LC_ALL", "C")];
    // Fail fast instead of waiting for a passphrase nobody can type — unless the user set their own ssh command.
    if std::env::var_os("GIT_SSH_COMMAND").is_none() && config_get(Some(repo), "core.sshCommand").is_none() {
        envs.push(("GIT_SSH_COMMAND", "ssh -o BatchMode=yes"));
    }
    let report = crate::workspace::run_argv_captured(&argv, repo, std::time::Duration::from_secs(120), &envs)?;
    if report.timed_out {
        return Err(AppError::new("timeout", "Le dépôt distant n'a pas répondu en 2 minutes"));
    }
    if report.code != Some(0) {
        let lower = report.output.to_lowercase();
        let code = if lower.contains("permission denied") || lower.contains("authentication failed") {
            "auth_failed"
        } else if lower.contains("could not resolve host") || lower.contains("network is unreachable") {
            "offline"
        } else if lower.contains("non-fast-forward") || lower.contains("fetch first") || lower.contains("not possible to fast-forward") || lower.contains("diverging") {
            "diverged"
        } else {
            "git_failed"
        };
        return Err(AppError::new(code, clean_stderr(&report.output)));
    }
    Ok(report.output)
}

/// What a folder's `.git` is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RepoKind {
    /// A `.git` folder with a `HEAD`.
    Normal,
    /// A `.git` file pointing to the repository data elsewhere (`git worktree`).
    Linked,
    /// A submodule of the repository around it (its data is in `…/.git/modules/…`).
    Submodule,
}

/// Whether `dir` is the top of a real repository: an empty or half-made `.git` is not.
pub fn repo_kind(dir: &Path) -> Option<RepoKind> {
    let dot = dir.join(".git");
    let meta = std::fs::metadata(&dot).ok()?;
    if meta.is_dir() {
        return dot.join("HEAD").is_file().then_some(RepoKind::Normal);
    }
    let text = std::fs::read_to_string(&dot).ok()?;
    let target = text.lines().find_map(|l| l.strip_prefix("gitdir:"))?.trim();
    let target_path = if Path::new(target).is_absolute() { PathBuf::from(target) } else { dir.join(target) };
    if !target_path.join("HEAD").is_file() {
        return None;
    }
    let t = target.replace('\\', "/");
    Some(if t.contains(".git/modules/") { RepoKind::Submodule } else { RepoKind::Linked })
}

pub fn is_repo(dir: &Path) -> bool {
    repo_kind(dir).is_some()
}

/// Folders of the submodules declared by the repository in `dir` (from `.gitmodules`).
pub fn submodule_paths(dir: &Path) -> Vec<PathBuf> {
    std::fs::read_to_string(dir.join(".gitmodules"))
        .map(|t| t.lines().filter_map(|l| l.trim().strip_prefix("path")).filter_map(|r| r.trim_start().strip_prefix('=')).map(|p| dir.join(p.trim())).collect())
        .unwrap_or_default()
}

/// The first commit of the current branch: the same in every copy of a repository.
pub fn root_commit(repo: &Path) -> Option<String> {
    let out = run(Some(repo), &["rev-list", "--max-parents=0", "HEAD"]).ok()?;
    out.lines().last().map(|l| l.trim().to_string()).filter(|h| !h.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_remote_form_gives_the_same_web_page() {
        let none = |_: &str| None;
        let page = Some("https://github.com/EpitechPGE1-2026/G-CPE-110-LYN-1-1-settingup-27".to_string());
        for remote in [
            "git@github.com:EpitechPGE1-2026/G-CPE-110-LYN-1-1-settingup-27.git",
            "https://github.com/EpitechPGE1-2026/G-CPE-110-LYN-1-1-settingup-27.git",
            "https://github.com/EpitechPGE1-2026/G-CPE-110-LYN-1-1-settingup-27",
            "ssh://git@github.com/EpitechPGE1-2026/G-CPE-110-LYN-1-1-settingup-27.git",
            "ssh://git@github.com:22/EpitechPGE1-2026/G-CPE-110-LYN-1-1-settingup-27.git",
            "https://user:secret@github.com/EpitechPGE1-2026/G-CPE-110-LYN-1-1-settingup-27.git",
            "  git@GitHub.com:EpitechPGE1-2026/G-CPE-110-LYN-1-1-settingup-27.git\n",
        ] {
            assert_eq!(web_url(remote, none), page, "{remote}");
        }
        assert_eq!(web_url("git@gitlab.com:group/sub/repo.git", none).as_deref(), Some("https://gitlab.com/group/sub/repo"));
    }

    #[test]
    fn ssh_aliases_are_resolved_and_non_web_remotes_are_refused() {
        let alias = |h: &str| (h == "gh-school").then(|| "github.com".to_string());
        assert_eq!(web_url("gh-school:Org/repo.git", alias).as_deref(), Some("https://github.com/Org/repo"));
        assert_eq!(web_url("unknown-alias:Org/repo.git", alias), None, "an alias ssh does not know is not turned into a guess");
        for bad in ["/home/me/bare.git", "../other", "file:///tmp/x/origin.git", "nonsense", "", "git@github.com:Org/re po.git", "git@github.com:-x/repo.git", "https://github.com/Org/repo?x=<script>"] {
            assert_eq!(web_url(bad, alias), None, "{bad}");
        }
        // Credentials embedded in an HTTPS remote never reach the browser.
        assert!(!web_url("https://user:secret@github.com/Org/repo.git", alias).unwrap().contains("secret"));
    }

    #[test]
    fn the_first_remote_is_used_when_there_is_no_origin() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path();
        run(Some(repo), &["init", "-q", "-b", "main"]).unwrap();
        assert_eq!(any_remote_url(repo), None, "no remote at all");
        run(Some(repo), &["remote", "add", "upstream", "git@github.com:Org/up.git"]).unwrap();
        assert_eq!(any_remote_url(repo).as_deref(), Some("git@github.com:Org/up.git"));
        run(Some(repo), &["remote", "add", "origin", "https://github.com/Me/fork.git"]).unwrap();
        assert_eq!(any_remote_url(repo).as_deref(), Some("https://github.com/Me/fork.git"), "origin wins");
    }

    #[test]
    fn parses_clean_tracking_branch() {
        let st = parse_status("# branch.oid 1234\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -3\n");
        assert_eq!(st.branch.as_deref(), Some("main"));
        assert_eq!(st.upstream.as_deref(), Some("origin/main"));
        assert_eq!((st.ahead, st.behind), (2, 3));
        assert!(!st.dirty());
        assert!(!st.unborn);
    }

    #[test]
    fn counts_changes_by_kind() {
        let text = "# branch.oid abc\n# branch.head dev\n\
1 M. N... 100644 100644 100644 a b staged.c\n\
1 .M N... 100644 100644 100644 a b unstaged.c\n\
1 MM N... 100644 100644 100644 a b both.c\n\
2 R. N... 100644 100644 100644 a b R100 new.c\told.c\n\
u UU N... 100644 100644 100644 100644 a b c conflict.c\n\
? untracked.c\n";
        let st = parse_status(text);
        assert_eq!(st.staged, 3);
        assert_eq!(st.unstaged, 2);
        assert_eq!(st.untracked, 1);
        assert_eq!(st.conflicted, 1);
        assert!(st.dirty());
        assert_eq!(st.upstream, None);
    }

    #[test]
    fn detached_and_unborn() {
        let st = parse_status("# branch.oid (initial)\n# branch.head (detached)\n");
        assert!(st.unborn);
        assert_eq!(st.branch, None);
    }

    #[test]
    fn parses_change_list() {
        let text = "M  staged.c\0 M work.c\0MM both.c\0?? new file.c\0R  renamed.c\0old.c\0UU fight.c\0A  added.c\0";
        let c = parse_changes(text);
        assert_eq!(c.len(), 7);
        assert_eq!((c[0].staged, c[0].unstaged), (Some('M'), None));
        assert_eq!((c[1].staged, c[1].unstaged), (None, Some('M')));
        assert_eq!((c[2].staged, c[2].unstaged), (Some('M'), Some('M')));
        assert!(c[3].untracked && c[3].path == "new file.c");
        assert_eq!(c[4].path, "renamed.c");
        assert!(c[5].conflicted && c[5].staged.is_none());
        assert_eq!(c[6].path, "added.c");
    }

    fn fixture() -> (tempfile::TempDir, std::path::PathBuf, std::path::PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let origin = tmp.path().join("origin.git");
        let work = tmp.path().join("work");
        run(None, &["init", "-q", "--bare", "-b", "main", &origin.to_string_lossy()]).unwrap();
        run(None, &["clone", "-q", &origin.to_string_lossy(), &work.to_string_lossy()]).unwrap();
        for (k, v) in [("user.name", "T"), ("user.email", "t@example.com")] {
            run(Some(&work), &["config", k, v]).unwrap();
        }
        (tmp, origin, work)
    }

    #[test]
    fn stage_unstage_diff_branch_and_sync() {
        let (tmp, origin, work) = fixture();
        std::fs::write(work.join("a.c"), "one\n").unwrap();
        assert!(untracked_preview(&work, "a.c").unwrap().contains("+one"));
        add(&work, &["a.c".into()]).unwrap();
        unstage(&work, &["a.c".into()]).unwrap();
        assert!(changes(&work).unwrap()[0].untracked, "unstage works before the first commit");
        add(&work, &["a.c".into()]).unwrap();
        commit(&work, "first").unwrap();

        // First push sets the upstream.
        sync(&work, Sync::Push).unwrap();
        let st = status(&work).unwrap();
        assert_eq!(st.upstream.as_deref(), Some("origin/main"));
        assert_eq!(st.ahead, 0);

        std::fs::write(work.join("a.c"), "one\ntwo\n").unwrap();
        assert!(diff(&work, "a.c", false).unwrap().contains("+two"));
        add(&work, &["a.c".into()]).unwrap();
        assert!(diff(&work, "a.c", true).unwrap().contains("+two"));
        unstage(&work, &["a.c".into()]).unwrap();
        assert_eq!(changes(&work).unwrap()[0].unstaged, Some('M'));
        add(&work, &["a.c".into()]).unwrap();
        commit(&work, "second").unwrap();
        assert_eq!(log(&work, Some("@{u}..HEAD"), 10).unwrap().len(), 1);
        assert_eq!(log(&work, None, 10).unwrap()[0].subject, "second");

        create_branch(&work, "feature/x").unwrap();
        let names: Vec<_> = branches(&work).unwrap();
        assert!(names.iter().any(|b| b.name == "feature/x" && b.current && b.upstream.is_none()));
        switch_branch(&work, "main").unwrap();
        assert!(create_branch(&work, "-bad").is_err());
        assert!(create_branch(&work, "has space").is_err());
        assert_eq!(switch_branch(&work, "nope").unwrap_err().code(), "git_failed");

        // A second clone pushes first: our push is refused, never forced; pull --ff-only refuses to merge.
        let other = tmp.path().join("other");
        run(None, &["clone", "-q", &origin.to_string_lossy(), &other.to_string_lossy()]).unwrap();
        for (k, v) in [("user.name", "O"), ("user.email", "o@example.com")] {
            run(Some(&other), &["config", k, v]).unwrap();
        }
        std::fs::write(other.join("b.c"), "x\n").unwrap();
        add(&other, &["b.c".into()]).unwrap();
        commit(&other, "theirs").unwrap();
        sync(&other, Sync::Push).unwrap();

        assert_eq!(sync(&work, Sync::Push).unwrap_err().code(), "diverged");
        sync(&work, Sync::Fetch).unwrap();
        let st = status(&work).unwrap();
        assert_eq!((st.ahead, st.behind), (1, 1));
        assert_eq!(sync(&work, Sync::Pull).unwrap_err().code(), "diverged");
        assert_eq!(last_commit(&work).unwrap().subject, "second", "nothing was rewritten");

        // The other side can fast-forward once we are out of the way.
        sync(&other, Sync::Pull).unwrap();
    }

    #[test]
    fn clone_url_validation() {
        for ok in ["git@github.com:Org/repo.git", "https://github.com/Org/repo", "ssh://git@github.com/Org/repo.git", "file:///tmp/origin.git", "alias:Org/repo"] {
            assert!(validate_clone_url(ok).is_ok(), "{ok}");
        }
        for bad in ["", "--upload-pack=touch /tmp/x", "ext::sh -c id", "ext::sh", "/local/path", "ftp://host/repo", "git@host:a b"] {
            assert!(validate_clone_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn real_repo_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = tmp.path();
        run(Some(repo), &["init", "-q", "-b", "main"]).unwrap();
        run(Some(repo), &["config", "user.name", "Test"]).unwrap();
        run(Some(repo), &["config", "user.email", "test@example.com"]).unwrap();
        assert!(status(repo).unwrap().unborn);
        assert!(last_commit(repo).is_none());
        std::fs::write(repo.join("a.c"), "int main(void){return 0;}\n").unwrap();
        assert_eq!(status(repo).unwrap().untracked, 1);
        add(repo, &["a.c".to_string()]).unwrap();
        assert_eq!(status(repo).unwrap().staged, 1);
        commit(repo, "first").unwrap();
        let st = status(repo).unwrap();
        assert!(!st.dirty() && !st.unborn);
        assert_eq!(last_commit(repo).unwrap().subject, "first");
        assert!(origin_url(repo).is_none());
        assert!(commit(repo, "  ").is_err());
    }
}
