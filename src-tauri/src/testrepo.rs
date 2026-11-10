//! TestRepo: does this repository build for someone who just cloned it?
//!
//! Two sources, never mixed up: `snapshot` clones the local repository at a commit (what Git
//! holds here), `remote` clones the published repository (what anyone else gets). A failed
//! remote clone is reported as such; it is never replaced by a local copy.
//!
//! Two levels of isolation, named for what they are: `none` builds the clean clone with this
//! computer's tools and libraries; `docker` builds it in a container with no network.

use crate::error::{AppError, Result};
use crate::git;
use crate::jobs::{argv_of, Job};
use crate::testing;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const DEFAULT_IMAGE: &str = "epitechcontent/epitest-docker:latest";

pub const STEPS: &[(&str, &str)] = &[
    ("inspect", "Inspecting the local repository"),
    ("clone", "Cloning"),
    ("compare", "Comparing with your working folder"),
    ("build", "Building"),
    ("executable", "Looking for the executable"),
    ("tests", "Testing"),
];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Params {
    /// `snapshot` or `remote`.
    pub mode: String,
    /// Commit, branch or tag for a snapshot. Defaults to `HEAD`.
    pub rev: Option<String>,
    pub build: String,
    /// Test command to run after the build, if any.
    pub tests: Option<String>,
    /// `none` or `docker`.
    pub isolation: String,
    pub image: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalOnly {
    pub path: String,
    /// `untracked` (Git does not know it) or `ignored`.
    pub kind: &'static str,
    /// The Makefile or an `#include` mentions it: the build probably needs it.
    pub referenced: bool,
}

fn net_env() -> [(&'static str, &'static str); 2] {
    [("GIT_TERMINAL_PROMPT", "0"), ("GIT_SSH_COMMAND", "ssh -o BatchMode=yes -o ConnectTimeout=15")]
}

pub fn valid_image(image: &str) -> bool {
    !image.is_empty() && image.len() < 200 && !image.starts_with('-') && image.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '/' | ':' | '@'))
}

fn valid_rev(rev: &str) -> bool {
    !rev.is_empty() && !rev.starts_with('-') && rev.len() < 200 && rev.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '/' | '~' | '^' | '@'))
}

fn s(v: &[&str]) -> Vec<String> {
    v.iter().map(|x| x.to_string()).collect()
}

/// Files that exist in the working folder but that Git does not publish.
pub fn local_only(repo: &Path) -> Vec<LocalOnly> {
    let list = |extra: &[&str]| -> Vec<String> {
        let mut args = vec!["ls-files", "--others", "--exclude-standard", "-z"];
        args.extend_from_slice(extra);
        git::run(Some(repo), &args).map(|t| t.split('\0').filter(|p| !p.is_empty()).map(str::to_string).collect()).unwrap_or_default()
    };
    let untracked = list(&[]);
    let ignored = list(&["--ignored", "--directory"]);
    // What the build names: the Makefiles and the quoted includes of tracked sources.
    let tracked: Vec<String> = git::run(Some(repo), &["ls-files", "-z"]).map(|t| t.split('\0').filter(|p| !p.is_empty()).map(str::to_string).collect()).unwrap_or_default();
    let mut mentions = String::new();
    let mut includes: BTreeSet<String> = BTreeSet::new();
    for rel in tracked.iter().take(3000) {
        let base = rel.rsplit('/').next().unwrap_or(rel);
        let is_make = base == "Makefile" || base.ends_with(".mk") || base == "CMakeLists.txt";
        if !(is_make || base.ends_with(".c") || base.ends_with(".h")) {
            continue;
        }
        let Ok(meta) = repo.join(rel).metadata() else { continue };
        if meta.len() > 512 * 1024 {
            continue;
        }
        let Ok(bytes) = std::fs::read(repo.join(rel)) else { continue };
        let text = String::from_utf8_lossy(&bytes);
        if is_make {
            mentions.push_str(&text);
            mentions.push('\n');
        } else {
            for line in text.lines() {
                let t = line.trim_start();
                if let Some(rest) = t.strip_prefix("#include").or_else(|| t.strip_prefix("# include")) {
                    if let Some(name) = rest.trim().strip_prefix('"').and_then(|r| r.split('"').next()) {
                        includes.insert(name.rsplit('/').next().unwrap_or(name).to_string());
                    }
                }
            }
        }
    }
    let make_words: BTreeSet<&str> = mentions.split(|c: char| c.is_whitespace() || matches!(c, '(' | ')' | '=' | ':' | ',')).filter(|w| !w.is_empty()).collect();
    let referenced = |path: &str| {
        let clean = path.trim_end_matches('/');
        let base = clean.rsplit('/').next().unwrap_or(clean);
        // Build products are named by the Makefile too; they are not missing sources.
        let product = base.ends_with(".o") || base.ends_with(".a") || base.ends_with(".gcda") || base.ends_with(".gcno") || !base.contains('.');
        if product && !path.ends_with('/') {
            return false;
        }
        includes.contains(base) || make_words.contains(clean) || make_words.contains(base) || make_words.contains(format!("./{clean}").as_str())
    };
    let mut out: Vec<LocalOnly> = untracked.iter().map(|p| LocalOnly { referenced: referenced(p), path: p.clone(), kind: "untracked" }).collect();
    out.extend(ignored.iter().map(|p| LocalOnly { referenced: referenced(p), path: p.clone(), kind: "ignored" }));
    out.sort_by(|a, b| (!a.referenced, a.kind, &a.path).cmp(&(!b.referenced, b.kind, &b.path)));
    out
}

/// `NAME = prog` in a Makefile.
pub fn makefile_name(text: &str) -> Option<String> {
    text.lines().find_map(|l| {
        let t = l.trim_start();
        let rest = t.strip_prefix("NAME")?.trim_start();
        let value = rest.strip_prefix(":=").or_else(|| rest.strip_prefix("?=")).or_else(|| rest.strip_prefix('='))?.trim();
        let name = value.split_whitespace().next()?;
        (!name.contains('$')).then(|| name.to_string())
    })
}

fn is_elf(path: &Path) -> bool {
    use std::io::Read;
    let mut magic = [0u8; 4];
    std::fs::File::open(path).and_then(|mut f| f.read_exact(&mut magic)).is_ok() && magic == [0x7f, b'E', b'L', b'F']
}

/// Executables in the top folder of `dir` (ELF files with the execute bit).
fn executables(dir: &Path) -> Vec<String> {
    let mut out: Vec<String> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.metadata().map(|m| m.is_file() && m.mode() & 0o111 != 0).unwrap_or(false) && is_elf(&e.path()))
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    out.sort();
    out
}

pub fn count_warnings(output: &str) -> usize {
    output.lines().filter(|l| l.contains(": warning:") || l.contains(" warning: ")).count()
}

fn docker_wrap(job: &Job, dir: &Path, image: &str, command: &[String]) -> Vec<String> {
    let meta = dir.metadata().ok();
    let user = format!("{}:{}", meta.as_ref().map(|m| m.uid()).unwrap_or(1000), meta.as_ref().map(|m| m.gid()).unwrap_or(1000));
    let name = format!("tekboard-testrepo-{}-{}", std::process::id(), job.id());
    job.kill_with(Some(s(&["docker", "kill", &name])));
    let mut argv = s(&["docker", "run", "--rm", "--name", &name, "--network", "none", "--memory", "2g", "--cpus", "2", "--pids-limit", "512", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "-u", &user, "-e", "HOME=/tmp", "-v"]);
    argv.push(format!("{}:/work", dir.display()));
    argv.extend(s(&["-w", "/work", image]));
    argv.extend(command.iter().cloned());
    argv
}

/// The whole test, as a job body. `env_root` is TekBoard's folder of test environments.
pub fn run(job: &Job, repo: &Path, params: &Params, env_root: &Path) -> Result<&'static str> {
    let remote = match params.mode.as_str() {
        "remote" => true,
        "snapshot" => false,
        _ => return Err(AppError::new("invalid_mode", "Unknown TestRepo source")),
    };
    let docker = match params.isolation.as_str() {
        "docker" => true,
        "none" => false,
        _ => return Err(AppError::new("invalid_mode", "Unknown isolation level")),
    };
    let build_argv = argv_of(&params.build)?;
    let tests_argv = match params.tests.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
        Some(t) => Some(argv_of(t)?),
        None => None,
    };
    let image = params.image.clone().filter(|i| !i.trim().is_empty()).unwrap_or_else(|| DEFAULT_IMAGE.to_string());
    if docker && !valid_image(&image) {
        return Err(AppError::new("invalid_image", "This container image name is not valid"));
    }
    let mut warn = false;

    // ── 1. what the working folder looks like
    job.start("inspect");
    let status = git::status(repo)?;
    let local_head = git::run(Some(repo), &["rev-parse", "HEAD"]).map(|t| t.trim().to_string()).map_err(|_| AppError::new("no_commit", "This repository has no commit yet: there is nothing to clone."))?;
    let origin = git::origin_url(repo);
    let dirty = status.staged + status.unstaged;
    job.set("mode", &params.mode);
    job.set("branch", &status.branch);
    job.set("localHead", &local_head);
    job.set("dirty", serde_json::json!({ "modified": dirty, "untracked": status.untracked, "ahead": status.ahead, "behind": status.behind }));
    job.set("isolation", serde_json::json!({ "mode": params.isolation, "image": if docker { Some(&image) } else { None } }));
    job.log(&format!("Branch {} · {} modified, {} untracked · {} commit(s) not pushed", status.branch.as_deref().unwrap_or("(detached)"), dirty, status.untracked, status.ahead));
    let locals = local_only(repo);
    let risky: Vec<&LocalOnly> = locals.iter().filter(|l| l.referenced).collect();
    job.set("localOnly", &locals.iter().take(200).collect::<Vec<_>>());
    let mut notes = Vec::new();
    if dirty > 0 {
        notes.push(format!("{dirty} modified file(s) are not committed: the clone will not have these changes"));
    }
    if !risky.is_empty() {
        notes.push(format!("{} file(s) your build mentions exist only here ({})", risky.len(), risky.iter().take(3).map(|l| l.path.as_str()).collect::<Vec<_>>().join(", ")));
    }
    if remote && status.ahead > 0 {
        notes.push(format!("{} commit(s) are not pushed", status.ahead));
    }
    warn |= !notes.is_empty();
    job.end("inspect", if notes.is_empty() { "success" } else { "warning" }, Some(if notes.is_empty() { "clean: everything is committed".to_string() } else { notes.join("; ") }));

    // ── 2. clone
    job.start("clone");
    let name: String = repo.file_name().map(|n| n.to_string_lossy().chars().map(|c| if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') { c } else { '_' }).collect()).unwrap_or_else(|| "repo".into());
    std::fs::create_dir_all(env_root)?;
    let env_dir: PathBuf = env_root.join(format!("{name}-{}", chrono::Local::now().format("%Y%m%d-%H%M%S")));
    if env_dir.exists() {
        return Err(AppError::new("already_exists", "A test environment with this name already exists; try again in a second."));
    }
    let dest = env_dir.to_string_lossy().into_owned();
    job.set("envDir", &dest);
    let clone = if remote {
        let Some(url) = origin.clone() else {
            job.end("clone", "failed", Some("this repository has no remote named origin".to_string()));
            return Ok("failed");
        };
        git::validate_clone_url(&url)?;
        job.set("source", &url);
        let branch = status.upstream.as_deref().and_then(|u| u.strip_prefix("origin/")).map(str::to_string);
        let mut argv = s(&["git", "clone", "--quiet"]);
        if let Some(b) = &branch {
            argv.extend(s(&["--branch", b, "--single-branch"]));
        } else {
            job.log("The current branch tracks no remote branch: cloning the remote's default branch.");
        }
        argv.extend([url, dest.clone()]);
        job.run(&argv, env_root, Duration::from_secs(180), &net_env())?
    } else {
        let rev = params.rev.clone().filter(|r| !r.trim().is_empty()).unwrap_or_else(|| "HEAD".into());
        if !valid_rev(&rev) {
            return Err(AppError::new("invalid_rev", "This commit or branch name is not valid"));
        }
        let sha = git::run(Some(repo), &["rev-parse", "--verify", &format!("{rev}^{{commit}}")]).map(|t| t.trim().to_string()).map_err(|_| AppError::new("invalid_rev", format!("“{rev}” is not a commit of this repository")))?;
        job.set("source", format!("local repository at {rev}"));
        let o = job.run(&s(&["git", "clone", "--quiet", "--no-hardlinks", &repo.to_string_lossy(), &dest]), env_root, Duration::from_secs(120), &net_env())?;
        if o.ok() {
            job.run(&s(&["git", "-c", "advice.detachedHead=false", "checkout", "--quiet", "--detach", &sha]), &env_dir, Duration::from_secs(60), &[])?
        } else {
            o
        }
    };
    if clone.cancelled {
        return Ok("cancelled");
    }
    if !clone.ok() {
        let why = if clone.timed_out { "the clone took too long".to_string() } else { clone.output.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("git clone failed").trim().to_string() };
        job.end("clone", "failed", Some(why));
        job.set("verdict", if remote { "The published repository could not be cloned. Nothing was substituted for it." } else { "The local snapshot could not be cloned." });
        return Ok("failed");
    }
    let clone_head = git::run(Some(&env_dir), &["rev-parse", "HEAD"]).map(|t| t.trim().to_string()).unwrap_or_default();
    job.set("commit", &clone_head);
    job.end("clone", "success", Some(format!("commit {}", &clone_head[..clone_head.len().min(7)])));

    // ── 3. clone vs working folder
    job.start("compare");
    let mut diffs = Vec::new();
    if clone_head != local_head {
        let count = |range: String| git::run(Some(repo), &["rev-list", "--count", &range]).ok().and_then(|t| t.trim().parse::<u32>().ok());
        match (count(format!("{clone_head}..{local_head}")), count(format!("{local_head}..{clone_head}"))) {
            (Some(a), _) if a > 0 => diffs.push(format!("your HEAD is {a} commit(s) ahead of what was cloned")),
            (_, Some(b)) if b > 0 => diffs.push(format!("the clone is {b} commit(s) ahead of your HEAD")),
            _ => diffs.push("the clone is at a commit your repository does not have".to_string()),
        }
    }
    let changed = git::run(Some(repo), &["diff", "--name-only", &clone_head, "--"]).map(|t| t.lines().filter(|l| !l.is_empty()).count()).unwrap_or(0);
    if changed > 0 {
        diffs.push(format!("{changed} tracked file(s) differ from your working folder"));
    }
    job.set("differences", &diffs);
    warn |= !diffs.is_empty();
    job.end("compare", if diffs.is_empty() { "success" } else { "warning" }, Some(if diffs.is_empty() { "the clone matches your committed work".to_string() } else { diffs.join("; ") }));

    // ── 4. build
    job.start("build");
    job.set("buildCommand", &params.build);
    if docker {
        let check = job.run(&s(&["docker", "image", "inspect", "--format", "{{.Id}}", &image]), &env_dir, Duration::from_secs(20), &[]);
        if !check.as_ref().map(|o| o.ok()).unwrap_or(false) {
            let why = match check {
                Err(e) if e.code() == "command_missing" => "Docker is not installed".to_string(),
                _ => format!("the image {image} is not on this computer. Download it yourself with: docker pull {image}"),
            };
            job.end("build", "failed", Some(why));
            job.set("verdict", "The isolated build could not start. Nothing was built outside the container instead.");
            return Ok("failed");
        }
        job.log("Isolated build: container with no network, no access to your home folder, 2 CPUs, 2 GB, 512 processes. Only the clone folder is shared with it.");
    } else {
        job.log("Clean clone built with this computer's compiler and libraries (not an isolated environment).");
    }
    let argv = if docker { docker_wrap(job, &env_dir, &image, &build_argv) } else { build_argv.clone() };
    let build = job.run(&argv, &env_dir, Duration::from_secs(600), &[])?;
    job.kill_with(None);
    if build.cancelled {
        return Ok("cancelled");
    }
    let warnings = count_warnings(&build.output);
    job.set("build", serde_json::json!({ "code": build.code, "warnings": warnings, "durationMs": build.duration_ms, "timedOut": build.timed_out }));
    if !build.ok() {
        job.end("build", "failed", Some(if build.timed_out { "time limit reached".to_string() } else { format!("exit {}", build.code.unwrap_or(-1)) }));
        job.set("verdict", "The clean clone does not build.");
        return Ok("failed");
    }
    warn |= warnings > 0;
    job.end("build", if warnings > 0 { "warning" } else { "success" }, Some(if warnings > 0 { format!("{warnings} warning(s)") } else { "no warning".to_string() }));

    // ── 5. executable
    job.start("executable");
    let expected = std::fs::read_to_string(env_dir.join("Makefile")).ok().and_then(|t| makefile_name(&t));
    let found = executables(&env_dir);
    job.set("executable", serde_json::json!({ "expected": expected, "found": found }));
    match &expected {
        Some(n) if env_dir.join(n).is_file() => job.end("executable", "success", Some(format!("{n} was produced"))),
        Some(n) => {
            warn = true;
            job.end("executable", "warning", Some(format!("the Makefile names {n}, which was not produced")));
        }
        None if !found.is_empty() => job.end("executable", "success", Some(found.join(", "))),
        None => job.end("executable", "skipped", Some("no NAME in the Makefile and no executable at the root".to_string())),
    }

    // ── 6. tests
    let mut tests_failed = false;
    match tests_argv {
        None => job.skip("tests", "not requested"),
        Some(cmd) => {
            job.start("tests");
            let argv = if docker { docker_wrap(job, &env_dir, &image, &cmd) } else { cmd };
            let o = job.run(&argv, &env_dir, Duration::from_secs(600), &[])?;
            job.kill_with(None);
            if o.cancelled {
                return Ok("cancelled");
            }
            let summary = testing::parse_output(&o.output);
            tests_failed = !o.ok() || summary.failed.unwrap_or(0) + summary.crashed.unwrap_or(0) > 0;
            job.set("tests", &summary);
            job.end("tests", if tests_failed { "failed" } else { "success" }, Some(testing::headline(&summary, o.code)));
        }
    }

    let status = if tests_failed { "failed" } else if warn { "warning" } else { "success" };
    job.set("verdict", match (status, remote) {
        ("failed", _) => "The clean clone builds, but its tests fail.",
        ("warning", true) => "The published repository builds, with points to check.",
        ("warning", false) => "The local snapshot builds, with points to check.",
        (_, true) => "Clean clone successfully built: this is what anyone cloning the repository gets.",
        (_, false) => "The local snapshot builds. This does not show it was pushed: use Remote clone for that.",
    });
    Ok(status)
}

// ───────────────────────────── kept environments ─────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestEnv {
    pub name: String,
    pub path: String,
    pub created_at: i64,
    pub size: u64,
}

fn dir_size(dir: &Path, budget: &mut usize) -> u64 {
    let mut total = 0;
    let Ok(entries) = std::fs::read_dir(dir) else { return 0 };
    for e in entries.flatten() {
        if *budget == 0 {
            break;
        }
        *budget -= 1;
        let Ok(meta) = e.path().symlink_metadata() else { continue };
        total += if meta.is_dir() { dir_size(&e.path(), budget) } else { meta.len() };
    }
    total
}

pub fn list_envs(env_root: &Path) -> Vec<TestEnv> {
    let mut out: Vec<TestEnv> = std::fs::read_dir(env_root)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .map(|e| {
            let mut budget = 20_000;
            TestEnv {
                name: e.file_name().to_string_lossy().into_owned(),
                path: e.path().to_string_lossy().into_owned(),
                created_at: e.metadata().ok().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs() as i64).unwrap_or(0),
                size: dir_size(&e.path(), &mut budget),
            }
        })
        .collect();
    out.sort_by(|a, b| b.name.cmp(&a.name));
    out
}

/// Resolves a test environment by name; anything outside `env_root` is refused.
pub fn env_path(env_root: &Path, name: &str) -> Result<PathBuf> {
    if name.is_empty() || name.contains('/') || name.contains('\0') || name == "." || name == ".." {
        return Err(AppError::new("invalid_path", "Not a test environment"));
    }
    let path = env_root.join(name);
    let meta = path.symlink_metadata().map_err(|_| AppError::new("invalid_target", "This test environment no longer exists"))?;
    if !meta.is_dir() || std::fs::canonicalize(&path)?.parent() != std::fs::canonicalize(env_root).ok().as_deref() {
        return Err(AppError::new("invalid_path", "Not a test environment"));
    }
    Ok(path)
}

pub fn delete_env(env_root: &Path, name: &str) -> Result<()> {
    let path = env_path(env_root, name)?;
    std::fs::remove_dir_all(path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::jobs::{JobView, Jobs};
    use std::fs;
    use std::sync::{Arc, Mutex};

    fn git_in(dir: &Path, args: &[&str]) {
        let ok = std::process::Command::new("git").args(["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", "-c", "protocol.file.allow=always"]).args(args).current_dir(dir).output().unwrap();
        assert!(ok.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&ok.stderr));
    }

    /// A tiny C project that builds with `make` (cc), with a bare "remote" next to it.
    fn project(root: &Path) -> PathBuf {
        let repo = root.join("my_project");
        fs::create_dir_all(&repo).unwrap();
        fs::write(repo.join("Makefile"), "NAME = prog\n\nall: $(NAME)\n\n$(NAME): main.c\n\tcc -Wall -o $(NAME) main.c\n\ntests_run:\n\t@echo '[====] Synthesis: Tested: 2 | Passing: 2 | Failing: 0 | Crashing: 0'\n").unwrap();
        fs::write(repo.join("main.c"), "#include \"util.h\"\n\nint main(void)\n{\n    return VALUE;\n}\n").unwrap();
        fs::write(repo.join("util.h"), "#define VALUE 0\n").unwrap();
        fs::write(repo.join(".gitignore"), "prog\n*.o\nsecret.h\n").unwrap();
        git_in(&repo, &["init", "-q"]);
        git_in(&repo, &["add", "."]);
        git_in(&repo, &["commit", "-qm", "init"]);
        let bare = root.join("remote.git");
        git_in(root, &["clone", "-q", "--bare", "my_project", "remote.git"]);
        git_in(&repo, &["remote", "add", "origin", &format!("file://{}", bare.display())]);
        git_in(&repo, &["fetch", "-q", "origin"]);
        git_in(&repo, &["branch", "-q", "--set-upstream-to=origin/main"]);
        repo
    }

    fn go(repo: &Path, root: &Path, params: Params) -> JobView {
        let jobs = Jobs::default();
        let conn = Arc::new(Mutex::new(db::open_in_memory().unwrap()));
        let (r, envs) = (repo.to_path_buf(), root.join("envs"));
        let id = jobs.start(conn, "testrepo", None, "t".into(), STEPS, move |job| run(job, &r, &params, &envs));
        for _ in 0..1200 {
            let v = jobs.get(id).unwrap();
            if v.status != "running" && v.run_id.is_some() {
                return v;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        panic!("timeout");
    }

    fn params(mode: &str) -> Params {
        Params { mode: mode.into(), rev: None, build: "make".into(), tests: None, isolation: "none".into(), image: None }
    }

    fn step<'a>(v: &'a JobView, id: &str) -> &'a crate::jobs::Step {
        v.steps.iter().find(|s| s.id == id).unwrap()
    }

    #[test]
    fn remote_clone_builds_and_reports() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = project(tmp.path());
        // file:// transport is refused by default for safety in recent git; allow it for this test only.
        std::env::set_var("GIT_ALLOW_PROTOCOL", "file");
        let v = go(&repo, tmp.path(), Params { tests: Some("make tests_run".into()), ..params("remote") });
        assert_eq!(v.status, "success", "{}", v.log);
        assert_eq!(v.summary["executable"]["expected"], "prog");
        assert_eq!(v.summary["tests"]["passed"], 2);
        assert_eq!(v.summary["build"]["warnings"], 0);
        let env = PathBuf::from(v.summary["envDir"].as_str().unwrap());
        assert!(env.join("prog").is_file() && env.starts_with(tmp.path().join("envs")));
        assert!(!repo.join("prog").exists(), "the working folder was not built");
        assert!(v.summary["verdict"].as_str().unwrap().contains("anyone cloning"));
    }

    #[test]
    fn a_file_that_only_exists_locally_breaks_the_clean_clone() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = project(tmp.path());
        // Works on this machine: the header is there, but ignored by git.
        fs::write(repo.join("secret.h"), "#define VALUE 0\n").unwrap();
        fs::write(repo.join("main.c"), "#include \"secret.h\"\n\nint main(void)\n{\n    return VALUE;\n}\n").unwrap();
        git_in(&repo, &["commit", "-qam", "use secret"]);
        let v = go(&repo, tmp.path(), params("snapshot"));
        assert_eq!(v.status, "failed", "{}", v.log);
        assert_eq!(step(&v, "build").status, "failed");
        assert!(step(&v, "inspect").detail.as_deref().unwrap().contains("secret.h"));
        let locals = v.summary["localOnly"].as_array().unwrap();
        assert!(locals.iter().any(|l| l["path"] == "secret.h" && l["kind"] == "ignored" && l["referenced"] == true));
        assert!(v.log.contains("secret.h"));
    }

    #[test]
    fn unpushed_commits_and_local_edits_are_called_out() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = project(tmp.path());
        std::env::set_var("GIT_ALLOW_PROTOCOL", "file");
        fs::write(repo.join("util.h"), "#define VALUE 0\n/* local */\n").unwrap();
        git_in(&repo, &["commit", "-qam", "not pushed"]);
        fs::write(repo.join("main.c"), "int main(void)\n{\n    return 0;\n}\n").unwrap();
        let v = go(&repo, tmp.path(), params("remote"));
        assert_eq!(v.status, "warning", "{}", v.log);
        assert!(step(&v, "inspect").detail.as_deref().unwrap().contains("1 commit(s) are not pushed"));
        assert!(step(&v, "compare").detail.as_deref().unwrap().contains("1 commit(s) ahead"));
        assert_ne!(v.summary["commit"], v.summary["localHead"]);
    }

    #[test]
    fn unreachable_remote_fails_without_falling_back() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = project(tmp.path());
        git_in(&repo, &["remote", "set-url", "origin", &format!("file://{}/gone.git", tmp.path().display())]);
        let v = go(&repo, tmp.path(), params("remote"));
        assert_eq!(v.status, "failed");
        assert_eq!(step(&v, "clone").status, "failed");
        assert_eq!(step(&v, "build").status, "skipped");
        assert!(v.summary["verdict"].as_str().unwrap().contains("Nothing was substituted"));
    }

    #[test]
    fn snapshot_of_an_older_commit_and_environment_cleanup() {
        let tmp = tempfile::tempdir().unwrap();
        let repo = project(tmp.path());
        fs::write(repo.join("main.c"), "broken\n").unwrap();
        git_in(&repo, &["commit", "-qam", "break"]);
        let v = go(&repo, tmp.path(), Params { rev: Some("HEAD~1".into()), ..params("snapshot") });
        assert_eq!(step(&v, "build").status, "success", "{}", v.log);
        let root = tmp.path().join("envs");
        let envs = list_envs(&root);
        assert_eq!(envs.len(), 1);
        assert!(envs[0].size > 0);
        assert!(delete_env(&root, "../my_project").is_err());
        assert!(delete_env(&root, "nope").is_err());
        delete_env(&root, &envs[0].name).unwrap();
        assert!(list_envs(&root).is_empty() && repo.is_dir());
    }

    #[test]
    fn inputs_are_validated() {
        assert!(valid_image("epitechcontent/epitest-docker:latest") && !valid_image("--privileged") && !valid_image("a b"));
        assert!(valid_rev("HEAD~2") && valid_rev("feature/x") && !valid_rev("--upload-pack=x") && !valid_rev("a b"));
        assert_eq!(makefile_name("CC = gcc\nNAME\t=\tmy_ls\n"), Some("my_ls".into()));
        assert_eq!(makefile_name("NAME = $(BIN)\n"), None);
        assert_eq!(count_warnings("a.c:1:2: warning: unused\nok\nb.c:3:1: warning: x\n"), 2);
    }
}
