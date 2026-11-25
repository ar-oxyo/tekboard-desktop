//! OpenRouter: one API key, many models, some of them free.
//!
//! TekBoard never spends money without being told to: a model is used only when it is free
//! (its prompt and completion prices are both 0), unless the user explicitly allowed paid
//! models in Settings. This is checked again before every request against the list of models
//! (kept 6 hours), so a model that stops being free is refused instead of billed. No fallback
//! model is ever sent.

use super::chat::AiSettings;
use super::openai::Endpoint;
use super::provider::Kind;
use crate::error::{AppError, Result};
use serde::Serialize;
use serde_json::Value;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const BASE: &str = "https://openrouter.ai/api/v1";
const FRESH: Duration = Duration::from_secs(6 * 3600);

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    pub id: String,
    pub name: String,
    pub free: bool,
    pub context: u64,
    /// Can call tools (needed by the conversation with Artix).
    pub tools: bool,
    /// Dollars per million tokens (prompt, completion), for paid models.
    pub price_in: f64,
    pub price_out: f64,
    /// Among the free models TekBoard suggests first.
    pub recommended: bool,
    /// When OpenRouter added it (seconds), to prefer recent models.
    #[serde(skip)]
    pub created: i64,
}

/// Families known to write good French and code and to call tools reliably, best first.
/// Only an ordering hint: any free model can be chosen.
const PREFERRED: &[&str] = &["qwen/qwen3-coder", "deepseek/", "moonshotai/kimi", "z-ai/glm", "openai/gpt-oss", "qwen/", "meta-llama/llama-3.3-70b", "nvidia/nemotron", "mistralai/", "google/gemma"];

fn family_rank(id: &str) -> usize {
    PREFERRED.iter().position(|p| id.starts_with(p)).unwrap_or(PREFERRED.len())
}

static MODELS: Mutex<Option<(Vec<Model>, Instant)>> = Mutex::new(None);

fn price(v: &Value) -> Option<f64> {
    v.as_str().and_then(|s| s.parse::<f64>().ok()).or_else(|| v.as_f64())
}

/// Models of `GET /models`, free ones first, the best suited at the top.
pub fn parse_models(v: &Value) -> Vec<Model> {
    let mut out: Vec<Model> = v["data"]
        .as_array()
        .map(|a| a.as_slice())
        .unwrap_or_default()
        .iter()
        .filter_map(|m| {
            let id = m["id"].as_str()?.to_string();
            let p_in = price(&m["pricing"]["prompt"])?;
            let p_out = price(&m["pricing"]["completion"])?;
            // Text in, text out (no image generators, no embedding models).
            let outputs = m["architecture"]["output_modalities"].as_array();
            if outputs.is_some_and(|o| !o.iter().any(|x| x == "text")) {
                return None;
            }
            let params = m["supported_parameters"].as_array();
            let tools = params.is_some_and(|p| p.iter().any(|x| x == "tools"));
            let context = m["context_length"].as_u64().unwrap_or(0);
            let request = price(&m["pricing"]["request"]).unwrap_or(0.0);
            let free = p_in == 0.0 && p_out == 0.0 && request == 0.0 && !id.starts_with("openrouter/auto");
            Some(Model { name: m["name"].as_str().unwrap_or(&id).to_string(), id, free, context, tools, price_in: p_in * 1e6, price_out: p_out * 1e6, recommended: false, created: m["created"].as_i64().unwrap_or(0) })
        })
        .collect();
    // Free first; then tools, a context that holds a subject (32 k), a known family, the newest.
    out.sort_by(|a, b| b.free.cmp(&a.free).then(b.tools.cmp(&a.tools)).then((b.context >= 32_000).cmp(&(a.context >= 32_000))).then(family_rank(&a.id).cmp(&family_rank(&b.id))).then(b.created.cmp(&a.created)).then(a.id.cmp(&b.id)));
    for m in out.iter_mut().filter(|m| m.free && m.tools && m.context >= 32_000).take(5) {
        m.recommended = true;
    }
    out
}

fn anonymous() -> Endpoint {
    Endpoint { kind: Kind::OpenRouter, base: BASE.into(), key: super::secrets::get(super::secrets::OPENROUTER), model: String::new(), tools: true }
}

/// The list of models, from memory when fresh. `refresh` reads it again.
pub fn models(refresh: bool) -> Result<Vec<Model>> {
    {
        let c = MODELS.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((m, at)) = c.as_ref() {
            if !refresh && at.elapsed() < FRESH {
                return Ok(m.clone());
            }
        }
    }
    let v = super::openai::get_json(&anonymous(), "/models", Duration::from_secs(20))?;
    let list = parse_models(&v);
    if list.is_empty() {
        return Err(AppError::new("ai_failed", "OpenRouter n'a renvoyé aucun modèle."));
    }
    *MODELS.lock().unwrap_or_else(|e| e.into_inner()) = Some((list.clone(), Instant::now()));
    Ok(list)
}

/// Whether `model` may be used: free, or paid with the user's explicit consent.
pub fn check_model(list: &[Model], model: &str, allow_paid: bool) -> Result<()> {
    match list.iter().find(|m| m.id == model) {
        Some(m) if m.free || allow_paid => Ok(()),
        Some(m) => Err(AppError::new("ai_paid_blocked", format!("Le modèle « {} » est payant ({:.2} $ / {:.2} $ par million de tokens) : TekBoard ne l'utilise pas sans ton accord. Choisis un modèle gratuit, ou autorise les modèles payants dans Réglages → IA.", m.name, m.price_in, m.price_out))),
        None => Err(AppError::new("ai_failed", format!("Le modèle « {model} » n'est plus proposé par OpenRouter. Choisis-en un autre dans Réglages → IA."))),
    }
}

/// The key and the model, when both are set (no network).
pub fn configured(s: &AiSettings) -> Result<(String, String)> {
    let key = super::secrets::get(super::secrets::OPENROUTER).ok_or_else(|| AppError::new("ai_unconfigured", "Aucune clé OpenRouter : ajoute-la dans Réglages → IA (elle se crée gratuitement sur openrouter.ai/keys)."))?;
    let model = s.openrouter_model.trim().to_string();
    if model.is_empty() {
        return Err(AppError::new("ai_unconfigured", "Aucun modèle OpenRouter choisi : choisis-en un dans Réglages → IA."));
    }
    Ok((key, model))
}

/// Where requests go, after checking the key and the price of the model.
pub fn endpoint(s: &AiSettings) -> Result<Endpoint> {
    let (key, model) = configured(s)?;
    match models(false) {
        Ok(list) => check_model(&list, &model, s.allow_paid)?,
        // The list cannot be read (offline…): only a `:free` model is known to cost nothing.
        Err(_) if model.ends_with(":free") || s.allow_paid => {}
        Err(e) => return Err(AppError::new("ai_failed", format!("Impossible de confirmer que « {model} » est gratuit : {e}"))),
    }
    let tools = models(false).ok().and_then(|l| l.into_iter().find(|m| m.id == model)).map(|m| m.tools).unwrap_or(true);
    Ok(Endpoint { kind: Kind::OpenRouter, base: BASE.into(), key: Some(key), model, tools })
}

/// What `GET /key` says about the key (no secret in it).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyInfo {
    pub valid: bool,
    pub free_tier: Option<bool>,
    pub limit_remaining: Option<f64>,
    pub usage: Option<f64>,
}

pub fn key_info(key: &str) -> Result<KeyInfo> {
    let ep = Endpoint { key: Some(key.to_string()), ..anonymous() };
    let v = super::openai::get_json(&ep, "/key", Duration::from_secs(15))?;
    let d = &v["data"];
    Ok(KeyInfo { valid: true, free_tier: d["is_free_tier"].as_bool(), limit_remaining: d["limit_remaining"].as_f64(), usage: d["usage"].as_f64() })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample() -> Value {
        json!({"data": [
            {"id": "paid/big", "name": "Big", "context_length": 200000, "pricing": {"prompt": "0.000003", "completion": "0.000015"}, "supported_parameters": ["tools"]},
            {"id": "free/small:free", "name": "Small", "context_length": 8000, "pricing": {"prompt": "0", "completion": "0"}, "supported_parameters": []},
            {"id": "qwen/qwen3-coder:free", "name": "Qwen", "context_length": 64000, "created": 1, "pricing": {"prompt": "0", "completion": "0"}, "supported_parameters": ["tools"]},
            {"id": "free/tools:free", "name": "Tools", "context_length": 128000, "created": 5, "pricing": {"prompt": "0", "completion": "0"}, "supported_parameters": ["tools", "temperature"]},
            {"id": "free/image:free", "name": "Img", "context_length": 128000, "pricing": {"prompt": "0", "completion": "0"}, "architecture": {"output_modalities": ["image"]}},
            {"id": "openrouter/auto", "name": "Auto", "context_length": 2000000, "pricing": {"prompt": "0", "completion": "0"}},
            {"id": "weird/per-request", "name": "Req", "context_length": 128000, "pricing": {"prompt": "0", "completion": "0", "request": "0.01"}}
        ]})
    }

    #[test]
    fn free_models_come_first_and_tools_are_preferred() {
        let m = parse_models(&sample());
        let ids: Vec<&str> = m.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids[..2], ["qwen/qwen3-coder:free", "free/tools:free"], "a known family first, then the newest");
        assert!(!ids.contains(&"free/image:free"), "image models are left out");
        assert!(m[0].recommended && m[0].free && m[0].tools);
        let free: Vec<&str> = m.iter().filter(|m| m.free).map(|m| m.id.as_str()).collect();
        assert_eq!(free, ["qwen/qwen3-coder:free", "free/tools:free", "free/small:free"], "auto routing and per-request prices are not free");
        assert!((m.iter().find(|m| m.id == "paid/big").unwrap().price_in - 3.0).abs() < 1e-9);
    }

    #[test]
    fn a_paid_model_is_never_used_without_consent() {
        let m = parse_models(&sample());
        assert!(check_model(&m, "free/tools:free", false).is_ok());
        let e = check_model(&m, "paid/big", false).unwrap_err();
        assert_eq!(e.code(), "ai_paid_blocked");
        assert!(check_model(&m, "paid/big", true).is_ok());
        assert!(check_model(&m, "gone/model", true).is_err(), "an unknown model is refused too");
        assert_eq!(check_model(&m, "openrouter/auto", false).unwrap_err().code(), "ai_paid_blocked", "auto may pick a paid model");
    }
}
