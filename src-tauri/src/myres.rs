//! Documents MY Epitech attaches to a project ("related resources"): the subject PDF, the
//! bootstrap, assets. The listing is read with the rest of the sync; a file is fetched in
//! two steps, as the site itself does: ask for a short-lived download link, then download
//! from it. Only PDFs go to the subjects library, and only after their content was checked.

use crate::error::{AppError, Result};
use serde::Serialize;
use serde_json::Value;
use std::io::{Read, Write};
use std::path::Path;
use std::time::Duration;

pub const MAX_DOWNLOAD: u64 = 60 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Resource {
    pub project_id: i64,
    pub folder: String,
    pub name: String,
    pub mime: Option<String>,
    pub size: Option<i64>,
    /// The folder is the project's own (the subject), as opposed to a session's (a bootstrap).
    pub main: bool,
}

pub fn listing_route(project_id: i64) -> String {
    format!("/units/instances/projects/{project_id}/related-resources/files")
}

/// Percent-encodes one path segment: everything but unreserved characters.
fn encode(segment: &str) -> String {
    let mut out = String::new();
    for b in segment.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// Route that answers with the download link of one file. `None` for a name that could not be a single path segment.
pub fn link_route(r: &Resource) -> Option<String> {
    let ok = |s: &str| !s.is_empty() && s != "." && s != ".." && !s.contains('/') && !s.contains('\\') && !s.chars().any(|c| c.is_control());
    (ok(&r.folder) && ok(&r.name)).then(|| format!("{}/{}/{}", listing_route(r.project_id), encode(&r.folder), encode(&r.name)))
}

/// Files of a listing: top-level folders, each with its files.
pub fn parse_listing(project_id: i64, body: &Value) -> Vec<Resource> {
    let mut out = Vec::new();
    for folder in body.as_array().into_iter().flatten().filter(|f| f["kind"] == "folder") {
        let Some(folder_name) = folder["name"].as_str() else { continue };
        let main = folder["labelKey"] == "project";
        for f in folder["childrens"].as_array().into_iter().flatten().filter(|f| f["kind"] == "file") {
            let Some(name) = f["name"].as_str().filter(|n| !n.is_empty()) else { continue };
            out.push(Resource { project_id, folder: folder_name.to_string(), name: name.to_string(), mime: f["blob"]["mimeType"].as_str().map(str::to_string), size: f["blob"]["size"].as_i64(), main });
        }
    }
    out
}

pub fn is_pdf(r: &Resource) -> bool {
    r.name.to_lowercase().ends_with(".pdf") && r.mime.as_deref().is_none_or(|m| m == "application/pdf")
}

/// The link the site answers with: the bare address, or JSON carrying it. Only `https` is accepted.
pub fn link_from_body(body: &str) -> Option<String> {
    let text = body.trim();
    let candidate = match serde_json::from_str::<Value>(text) {
        Ok(Value::String(s)) => s,
        Ok(v) => ["url", "presignedUrl", "downloadUrl", "link"].iter().find_map(|k| v[k].as_str().map(str::to_string))?,
        Err(_) => text.to_string(),
    };
    let ok = candidate.starts_with("https://") && candidate.len() < 4096 && !candidate.chars().any(|c| c.is_whitespace() || c.is_control());
    ok.then_some(candidate)
}

/// Downloads `url` (no credentials are sent: the link carries its own authorisation) into `dest`.
pub fn download(url: &str, dest: &Path) -> Result<u64> {
    let agent: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).timeout_global(Some(Duration::from_secs(60))).user_agent("TekBoard (personal desktop client, read-only)").max_redirects(2).build().into();
    let mut resp = agent.get(url).call().map_err(|e| AppError::new("download_failed", format!("The document could not be downloaded: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::new("download_failed", format!("The document could not be downloaded (HTTP {})", resp.status().as_u16())));
    }
    let mut reader = resp.body_mut().with_config().limit(MAX_DOWNLOAD + 1).reader();
    let mut file = std::fs::File::create(dest)?;
    let mut total = 0u64;
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = reader.read(&mut buf).map_err(|e| AppError::new("download_failed", format!("The download was interrupted: {e}")))?;
        if n == 0 {
            break;
        }
        total += n as u64;
        if total > MAX_DOWNLOAD {
            drop(file);
            let _ = std::fs::remove_file(dest);
            return Err(AppError::new("download_failed", "The document is larger than 60 MB"));
        }
        file.write_all(&buf[..n])?;
    }
    Ok(total)
}

/// The file starts like a PDF. A download that turned out to be an error page is not imported.
pub fn looks_like_pdf(path: &Path) -> bool {
    let mut magic = [0u8; 5];
    std::fs::File::open(path).and_then(|mut f| f.read_exact(&mut magic)).is_ok() && &magic == b"%PDF-"
}

#[cfg(test)]
mod tests {
    use super::*;

    fn listing() -> Value {
        serde_json::json!([
            {"id": 1, "kind": "folder", "name": "Project", "labelKey": "project", "childrens": [
                {"id": 10, "kind": "file", "name": "G-MUL-100_my_hunter.pdf", "blob": {"mimeType": "application/pdf", "size": 521276}, "childrens": []},
                {"id": 11, "kind": "file", "name": "sheet.png", "blob": {"mimeType": "image/png", "size": 100}}
            ]},
            {"id": 2, "kind": "folder", "name": "Bootstrap - MyHunter", "childrens": [
                {"id": 12, "kind": "file", "name": "Bootstrap my hunter.pdf", "blob": {"mimeType": "application/pdf"}},
                {"id": 13, "kind": "folder", "name": "nested", "childrens": []},
                {"id": 14, "kind": "file", "name": ""}
            ]},
            {"id": 3, "kind": "file", "name": "stray.pdf"}
        ])
    }

    #[test]
    fn a_listing_gives_the_files_of_each_folder_and_marks_the_projects_own() {
        let files = parse_listing(4255, &listing());
        assert_eq!(files.iter().map(|f| (f.folder.as_str(), f.name.as_str(), f.main)).collect::<Vec<_>>(), vec![("Project", "G-MUL-100_my_hunter.pdf", true), ("Project", "sheet.png", true), ("Bootstrap - MyHunter", "Bootstrap my hunter.pdf", false)]);
        assert_eq!(files.iter().filter(|f| is_pdf(f)).count(), 2);
        assert_eq!(files[0].size, Some(521276));
        assert!(parse_listing(1, &serde_json::json!({"message": "Forbidden"})).is_empty());
        assert!(parse_listing(1, &serde_json::json!([])).is_empty());
    }

    #[test]
    fn link_routes_are_encoded_and_cannot_leave_the_project() {
        let files = parse_listing(4255, &listing());
        assert_eq!(link_route(&files[0]).unwrap(), "/units/instances/projects/4255/related-resources/files/Project/G-MUL-100_my_hunter.pdf");
        assert_eq!(link_route(&files[2]).unwrap(), "/units/instances/projects/4255/related-resources/files/Bootstrap%20-%20MyHunter/Bootstrap%20my%20hunter.pdf");
        for (folder, name) in [("..", "x.pdf"), ("a/b", "x.pdf"), ("Project", "../../students/me"), ("Project", "a\nb.pdf"), ("", "x.pdf")] {
            let r = Resource { project_id: 1, folder: folder.into(), name: name.into(), mime: None, size: None, main: true };
            assert_eq!(link_route(&r), None, "{folder} / {name}");
        }
        let odd = Resource { project_id: 1, folder: "Sujets été".into(), name: "a?b#c.pdf".into(), mime: None, size: None, main: true };
        assert_eq!(link_route(&odd).unwrap(), "/units/instances/projects/1/related-resources/files/Sujets%20%C3%A9t%C3%A9/a%3Fb%23c.pdf");
    }

    #[test]
    fn only_a_plain_https_link_is_followed() {
        let url = "https://bucket.s3.eu-west-3.amazonaws.com/files/x.pdf?X-Amz-Signature=abc";
        assert_eq!(link_from_body(&format!("  {url}\n")).as_deref(), Some(url));
        assert_eq!(link_from_body(&format!("\"{url}\"")).as_deref(), Some(url));
        assert_eq!(link_from_body(&format!("{{\"url\":\"{url}\"}}")).as_deref(), Some(url));
        for bad in ["http://plain.example/x.pdf", "file:///etc/passwd", "", "{\"message\":\"Forbidden\"}", "https://a.example/x y", "javascript:alert(1)"] {
            assert_eq!(link_from_body(bad), None, "{bad}");
        }
    }

    #[test]
    fn a_download_must_really_be_a_pdf() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("ok.pdf"), b"%PDF-1.7\n...").unwrap();
        std::fs::write(tmp.path().join("error.pdf"), b"<?xml version=\"1.0\"?><Error><Code>AccessDenied</Code></Error>").unwrap();
        std::fs::write(tmp.path().join("tiny.pdf"), b"%P").unwrap();
        assert!(looks_like_pdf(&tmp.path().join("ok.pdf")));
        assert!(!looks_like_pdf(&tmp.path().join("error.pdf")));
        assert!(!looks_like_pdf(&tmp.path().join("tiny.pdf")));
        assert!(!looks_like_pdf(&tmp.path().join("missing.pdf")));
    }
}
