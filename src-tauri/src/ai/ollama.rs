//! A local model through Ollama: no key, no account, nothing leaves the computer.
//!
//! TekBoard talks to the Ollama service over HTTP (`http://localhost:11434` by default): it
//! lists the installed models, suggests one that fits the machine and downloads it on request
//! (`/api/pull`, streamed as a job). Requests go through Ollama's OpenAI-compatible API.

use super::chat::AiSettings;
use super::openai::Endpoint;
use super::provider::Kind;
use crate::error::{AppError, Result};
use serde::Serialize;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader};
use std::time::Duration;

pub const DEFAULT_URL: &str = "http://localhost:11434";

/// `http(s)://host[:port]`, without a path or a trailing slash; anything else is refused.
pub fn clean_url(url: &str) -> Option<String> {
    let u = url.trim().trim_end_matches('/');
    let rest = u.strip_prefix("http://").or_else(|| u.strip_prefix("https://"))?;
    let ok = !rest.is_empty() && rest.len() <= 200 && rest.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':' | '[' | ']'));
    ok.then(|| u.to_string())
}

fn base_of(s: &AiSettings) -> String {
    clean_url(&s.ollama_url).unwrap_or_else(|| DEFAULT_URL.into())
}

pub fn configured(s: &AiSettings) -> Result<String> {
    let m = s.ollama_model.trim();
    if m.is_empty() {
        return Err(AppError::new("ai_unconfigured", "Aucun modèle local choisi : installe ou choisis un modèle dans Réglages → IA."));
    }
    Ok(m.to_string())
}

pub fn endpoint(s: &AiSettings) -> Result<Endpoint> {
    let model = configured(s)?;
    Ok(Endpoint { kind: Kind::Ollama, base: format!("{}/v1", base_of(s)), key: None, model, tools: true })
}

fn agent(timeout: Duration) -> ureq::Agent {
    ureq::Agent::config_builder().http_status_as_error(false).timeout_global(Some(timeout)).timeout_connect(Some(Duration::from_secs(3))).user_agent("TekBoard").build().into()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub name: String,
    pub size_gb: f64,
    pub parameters: Option<String>,
    pub family: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub url: String,
    /// The service answered.
    pub running: bool,
    /// The `ollama` program is installed on this computer (it may simply not be started).
    pub installed: bool,
    pub version: Option<String>,
    pub models: Vec<Installed>,
    pub hardware: Hardware,
    pub recommended: Recommendation,
    pub detail: Option<String>,
}

pub fn parse_tags(v: &Value) -> Vec<Installed> {
    v["models"]
        .as_array()
        .map(|a| a.as_slice())
        .unwrap_or_default()
        .iter()
        .filter_map(|m| {
            let name = m["name"].as_str().or(m["model"].as_str())?.to_string();
            Some(Installed { name, size_gb: (m["size"].as_f64().unwrap_or(0.0) / 1e9 * 10.0).round() / 10.0, parameters: m["details"]["parameter_size"].as_str().map(str::to_string), family: m["details"]["family"].as_str().map(str::to_string) })
        })
        .collect()
}

pub fn info(s: &AiSettings) -> Info {
    let url = base_of(s);
    let hardware = hardware();
    let recommended = recommend(&hardware);
    let installed = crate::toolenv::find("ollama").is_some();
    let a = agent(Duration::from_secs(5));
    let version = a.get(&format!("{url}/api/version")).call().ok().and_then(|mut r| r.body_mut().read_to_string().ok()).and_then(|b| serde_json::from_str::<Value>(&b).ok()).and_then(|v| v["version"].as_str().map(str::to_string));
    let Some(version) = version else {
        let detail = if installed { format!("Ollama est installé mais ne répond pas sur {url}. Lance-le : `ollama serve` (ou `systemctl start ollama`).") } else { "Ollama n'est pas installé. Installe-le avec la commande ci-dessous, ou relance ./install.sh et accepte l'IA locale.".to_string() };
        return Info { url, running: false, installed, version: None, models: vec![], hardware, recommended, detail: Some(detail) };
    };
    let models = a.get(&format!("{url}/api/tags")).call().ok().and_then(|mut r| r.body_mut().read_to_string().ok()).and_then(|b| serde_json::from_str::<Value>(&b).ok()).map(|v| parse_tags(&v)).unwrap_or_default();
    Info { url, running: true, installed: true, version: Some(version), models, hardware, recommended, detail: None }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Hardware {
    pub ram_gb: f64,
    pub gpu: Option<String>,
    pub vram_gb: Option<f64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Recommendation {
    pub model: String,
    pub download_gb: f64,
    pub why: String,
}

fn hardware() -> Hardware {
    let ram_kb = std::fs::read_to_string("/proc/meminfo").ok().and_then(|t| t.lines().find(|l| l.starts_with("MemTotal:")).and_then(|l| l.split_whitespace().nth(1)).and_then(|n| n.parse::<f64>().ok())).unwrap_or(0.0);
    let gpu = crate::toolenv::find("nvidia-smi").and_then(|f| {
        let out = std::process::Command::new(&f.path).args(["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"]).stdin(std::process::Stdio::null()).output().ok()?;
        let line = String::from_utf8_lossy(&out.stdout).lines().next()?.to_string();
        let mut parts = line.split(',').map(str::trim);
        let name = parts.next()?.to_string();
        let mib = parts.next()?.parse::<f64>().ok()?;
        Some((name, mib / 1024.0))
    });
    Hardware { ram_gb: (ram_kb / 1024.0 / 1024.0 * 10.0).round() / 10.0, gpu: gpu.as_ref().map(|g| g.0.clone()), vram_gb: gpu.map(|g| (g.1 * 10.0).round() / 10.0) }
}

/// A model that runs well on this machine. Qwen 2.5 is chosen for its French and its tool calls.
pub fn recommend(h: &Hardware) -> Recommendation {
    let vram = h.vram_gb.unwrap_or(0.0);
    if vram >= 10.0 && h.ram_gb >= 16.0 {
        Recommendation { model: "qwen2.5:14b".into(), download_gb: 9.0, why: format!("Ta carte graphique a {vram:.0} Go de mémoire : un modèle de 14 milliards de paramètres y tient et répond bien.") }
    } else if h.ram_gb >= 12.0 || vram >= 6.0 {
        Recommendation { model: "qwen2.5:7b".into(), download_gb: 4.7, why: format!("{:.0} Go de mémoire : un modèle de 7 milliards de paramètres, bon compromis entre qualité et vitesse.", h.ram_gb.max(vram)) }
    } else if h.ram_gb >= 6.0 {
        Recommendation { model: "qwen2.5:3b".into(), download_gb: 1.9, why: format!("{:.0} Go de mémoire : un modèle léger de 3 milliards de paramètres.", h.ram_gb) }
    } else {
        Recommendation { model: "qwen2.5:1.5b".into(), download_gb: 1.0, why: "Peu de mémoire : le plus léger des modèles utiles (réponses plus simples).".into() }
    }
}

/// Valid model name for `ollama pull` (`qwen2.5:7b`, `library/llama3.2:3b`, `hf.co/…`).
pub fn valid_model(name: &str) -> bool {
    let n = name.trim();
    !n.is_empty() && n.len() <= 120 && n.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':' | '/'))
}

/// Downloads `model` as part of `job`, with the progress in its summary (`progress` 0–1).
pub fn pull(job: &crate::jobs::Job, url: &str, model: &str) -> Result<()> {
    let resp = agent(Duration::from_secs(6 * 3600)).post(&format!("{url}/api/pull")).header("Content-Type", "application/json").send(json!({"model": model, "stream": true}).to_string().as_str());
    let resp = resp.map_err(|e| AppError::new("ai_failed", format!("Ollama ne répond pas sur {url} ({e}). Lance Ollama puis réessaie.")))?;
    let status = resp.status().as_u16();
    let mut body = resp.into_body();
    if status != 200 {
        let t = body.with_config().limit(64 * 1024).read_to_string().unwrap_or_default();
        return Err(AppError::new("ai_failed", format!("Ollama refuse le téléchargement ({status}) : {}", super::stream::clip(&t, 300))));
    }
    let mut last_status = String::new();
    for line in BufReader::new(body.into_reader()).lines() {
        if job.cancelled() {
            return Err(AppError::new("cancelled", "Annulé"));
        }
        let line = line.map_err(|e| AppError::new("ai_failed", format!("Téléchargement interrompu : {e}")))?;
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        if let Some(e) = v["error"].as_str() {
            return Err(AppError::new("ai_failed", format!("Ollama : {e}")));
        }
        let st = v["status"].as_str().unwrap_or_default().to_string();
        if let (Some(total), Some(done)) = (v["total"].as_f64().filter(|t| *t > 0.0), v["completed"].as_f64()) {
            job.set("progress", (done / total).clamp(0.0, 1.0));
            job.set("progressText", format!("{:.1} / {:.1} Go", done / 1e9, total / 1e9));
        }
        if st != last_status && !st.is_empty() {
            job.log(&st);
            last_status = st;
        }
        if last_status == "success" {
            job.set("progress", 1.0);
            return Ok(());
        }
    }
    if last_status == "success" {
        Ok(())
    } else {
        Err(AppError::new("ai_failed", "Le téléchargement s'est arrêté avant la fin."))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_and_model_names_are_checked() {
        assert_eq!(clean_url("http://localhost:11434/").as_deref(), Some("http://localhost:11434"));
        assert_eq!(clean_url("https://gpu.local:8080").as_deref(), Some("https://gpu.local:8080"));
        assert!(clean_url("localhost:11434").is_none() && clean_url("http://x/path").is_none() && clean_url("http://a b").is_none());
        assert!(valid_model("qwen2.5:7b") && valid_model("hf.co/org/model:Q4"));
        assert!(!valid_model("x; rm -rf /") && !valid_model(""));
    }

    #[test]
    fn the_recommendation_fits_the_machine() {
        let h = |ram, vram: Option<f64>| Hardware { ram_gb: ram, gpu: vram.map(|_| "GPU".into()), vram_gb: vram };
        assert_eq!(recommend(&h(4.0, None)).model, "qwen2.5:1.5b");
        assert_eq!(recommend(&h(8.0, None)).model, "qwen2.5:3b");
        assert_eq!(recommend(&h(16.0, None)).model, "qwen2.5:7b");
        assert_eq!(recommend(&h(32.0, Some(12.0))).model, "qwen2.5:14b");
    }

    #[test]
    fn installed_models_are_listed() {
        let v = serde_json::json!({"models": [{"name": "qwen2.5:1.5b", "size": 986061892, "details": {"parameter_size": "1.5B", "family": "qwen2"}}]});
        let m = parse_tags(&v);
        assert_eq!(m[0].name, "qwen2.5:1.5b");
        assert_eq!(m[0].size_gb, 1.0);
        assert_eq!(m[0].parameters.as_deref(), Some("1.5B"));
    }
}
