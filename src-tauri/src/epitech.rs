//! Parsing of repository names and remote URLs. Pure functions, no I/O.

use serde::Serialize;

/// `G-CPE-110-LYN-1-1-settingup-27` → module `G-CPE-110`, city `LYN`, project `settingup`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpitechName {
    /// e.g. `G-CPE-110`
    pub module: String,
    /// e.g. `CPE`
    pub unit: String,
    /// e.g. `LYN`
    pub city: String,
    /// e.g. `settingup`
    pub project: String,
}

pub fn parse_repo_name(name: &str) -> Option<EpitechName> {
    let parts: Vec<&str> = name.split('-').collect();
    // <cycle>-<UNIT>-<code>-<CITY>-<n>-<n>-<project...>-<group>
    if parts.len() < 8 {
        return None;
    }
    let (cycle, unit, code, city) = (parts[0], parts[1], parts[2], parts[3]);
    let is_upper = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_uppercase());
    let is_num = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit());
    if cycle.len() != 1 || !is_upper(cycle) || !is_upper(unit) || unit.len() != 3 {
        return None;
    }
    if !is_num(code) || code.len() != 3 || !is_upper(city) || city.len() != 3 {
        return None;
    }
    if !is_num(parts[4]) || !is_num(parts[5]) || !is_num(parts[parts.len() - 1]) {
        return None;
    }
    let project = parts[6..parts.len() - 1].join("-");
    if project.is_empty() {
        return None;
    }
    Some(EpitechName {
        module: format!("{cycle}-{unit}-{code}"),
        unit: unit.to_string(),
        city: city.to_string(),
        project,
    })
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteRef {
    pub host: String,
    pub owner: String,
    pub name: String,
}

impl RemoteRef {
    /// Case-insensitive identity used to match a local clone with a remote repository.
    pub fn key(&self) -> String {
        format!("{}/{}", self.owner, self.name).to_lowercase()
    }
}

/// Understands `git@host:owner/name.git`, `ssh://git@host/owner/name`, `https://host/owner/name.git`.
pub fn parse_remote(url: &str) -> Option<RemoteRef> {
    let url = url.trim();
    let (host, path) = if let Some(rest) = url.strip_prefix("ssh://").or_else(|| url.strip_prefix("https://")).or_else(|| url.strip_prefix("http://")).or_else(|| url.strip_prefix("git://")) {
        let rest = rest.rsplit_once('@').map(|(_, r)| r).unwrap_or(rest);
        let (host, path) = rest.split_once('/')?;
        (host.split(':').next()?.to_string(), path.to_string())
    } else if let Some((left, path)) = url.split_once(':') {
        if left.contains('/') {
            return None;
        }
        let host = left.rsplit_once('@').map(|(_, h)| h).unwrap_or(left);
        (host.to_string(), path.to_string())
    } else {
        return None;
    };
    let path = path.trim_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    let (owner, name) = path.rsplit_once('/')?;
    if host.is_empty() || owner.is_empty() || name.is_empty() {
        return None;
    }
    Some(RemoteRef { host, owner: owner.to_string(), name: name.to_string() })
}

/// Directory name `git clone` would create for this URL.
pub fn repo_dir_name(url: &str) -> Option<String> {
    let trimmed = url.trim().trim_end_matches('/');
    let last = trimmed.rsplit(|c| c == '/' || c == ':').next()?;
    let name = last.strip_suffix(".git").unwrap_or(last);
    if name.is_empty() || name == "." || name == ".." || name.starts_with('-') {
        return None;
    }
    Some(name.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_standard_epitech_name() {
        let n = parse_repo_name("G-CPE-110-LYN-1-1-settingup-27").unwrap();
        assert_eq!(n.module, "G-CPE-110");
        assert_eq!(n.unit, "CPE");
        assert_eq!(n.city, "LYN");
        assert_eq!(n.project, "settingup");
    }

    #[test]
    fn keeps_hyphens_inside_project_name() {
        let n = parse_repo_name("B-PSU-200-PAR-2-1-my-top-3").unwrap();
        assert_eq!(n.project, "my-top");
        assert_eq!(n.module, "B-PSU-200");
    }

    #[test]
    fn rejects_non_epitech_names() {
        for name in ["tekcraft", "G-CPE-110-LYN-1-1-27", "my-cool-app-with-many-dashes-in-it-1", "G-CPE-11O-LYN-1-1-x-2", ""] {
            assert!(parse_repo_name(name).is_none(), "{name}");
        }
    }

    #[test]
    fn parses_remote_forms() {
        let expected = RemoteRef { host: "github.com".into(), owner: "Org".into(), name: "repo".into() };
        assert_eq!(parse_remote("git@github.com:Org/repo.git").unwrap(), expected);
        assert_eq!(parse_remote("https://github.com/Org/repo.git").unwrap(), expected);
        assert_eq!(parse_remote("https://github.com/Org/repo").unwrap(), expected);
        assert_eq!(parse_remote("ssh://git@github.com/Org/repo.git").unwrap(), expected);
        assert_eq!(parse_remote("ssh://git@github.com:22/Org/repo.git").unwrap(), expected);
        assert_eq!(parse_remote("github-alias:Org/repo.git").unwrap().host, "github-alias");
        assert!(parse_remote("/local/path").is_none());
        assert!(parse_remote("nonsense").is_none());
    }

    #[test]
    fn remote_key_ignores_case() {
        let a = parse_remote("git@github.com:Org/Repo.git").unwrap();
        let b = parse_remote("https://github.com/org/repo").unwrap();
        assert_eq!(a.key(), b.key());
    }

    #[test]
    fn dir_name_from_url() {
        assert_eq!(repo_dir_name("git@github.com:Org/repo.git").unwrap(), "repo");
        assert_eq!(repo_dir_name("https://github.com/Org/repo/").unwrap(), "repo");
        assert_eq!(repo_dir_name("file:///tmp/x/origin.git").unwrap(), "origin");
        assert!(repo_dir_name("git@github.com:Org/..").is_none());
        assert!(repo_dir_name("git@github.com:Org/-x").is_none());
    }
}
