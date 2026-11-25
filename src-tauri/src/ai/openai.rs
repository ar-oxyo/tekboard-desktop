//! One client for the OpenAI-compatible chat API that OpenRouter and Ollama both speak
//! (`POST {base}/chat/completions`, streamed as server-sent events).
//!
//! Blocking `ureq`, read line by line, so it runs inside a `Job` like everything else.
//! The key goes in a header only: never in a URL, a log or an error message.

use crate::error::{AppError, Result};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader};
use std::time::{Duration, Instant};

pub const MAX_ANSWER_TOKENS: u32 = 4096;

#[derive(Debug, Clone)]
pub struct Endpoint {
    pub kind: super::provider::Kind,
    /// `https://openrouter.ai/api/v1`, `http://localhost:11434/v1`.
    pub base: String,
    pub key: Option<String>,
    pub model: String,
    /// Models that cannot call tools (detected on the first refusal) are asked without them.
    pub tools: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    /// JSON text, as the model wrote it.
    pub arguments: String,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Turn {
    pub content: String,
    pub tool_calls: Vec<ToolCall>,
    pub finish: Option<String>,
    pub prompt_tokens: Option<u64>,
    pub completion_tokens: Option<u64>,
    pub cost_usd: Option<f64>,
}

/// Rebuilds a streamed answer from its `data:` lines.
#[derive(Debug, Default)]
pub struct Acc {
    turn: Turn,
    /// Tool calls by their index in the stream (arguments arrive in pieces).
    calls: Vec<ToolCall>,
    pub done: bool,
    pub error: Option<String>,
}

impl Acc {
    /// Reads one line; returns the text it adds, if any.
    pub fn feed(&mut self, line: &str) -> Option<String> {
        let line = line.trim();
        let data = line.strip_prefix("data:")?.trim();
        if data == "[DONE]" {
            self.done = true;
            return None;
        }
        let v: Value = serde_json::from_str(data).ok()?;
        if let Some(e) = v.get("error").filter(|e| !e.is_null()) {
            self.error = Some(e["message"].as_str().map(str::to_string).unwrap_or_else(|| e.to_string()));
            return None;
        }
        if let Some(u) = v.get("usage").filter(|u| u.is_object()) {
            self.turn.prompt_tokens = u["prompt_tokens"].as_u64();
            self.turn.completion_tokens = u["completion_tokens"].as_u64();
            self.turn.cost_usd = u["cost"].as_f64();
        }
        let choice = &v["choices"][0];
        if let Some(f) = choice["finish_reason"].as_str() {
            self.turn.finish = Some(f.to_string());
        }
        let delta = &choice["delta"];
        if let Some(calls) = delta["tool_calls"].as_array() {
            for c in calls {
                let i = c["index"].as_u64().unwrap_or(self.calls.len().saturating_sub(1) as u64) as usize;
                while self.calls.len() <= i {
                    self.calls.push(ToolCall { id: String::new(), name: String::new(), arguments: String::new() });
                }
                let slot = &mut self.calls[i];
                if let Some(id) = c["id"].as_str().filter(|s| !s.is_empty()) {
                    slot.id = id.to_string();
                }
                if let Some(n) = c["function"]["name"].as_str() {
                    slot.name.push_str(n);
                }
                // Some servers send the arguments as an object instead of text.
                match &c["function"]["arguments"] {
                    Value::String(a) => slot.arguments.push_str(a),
                    Value::Null => {}
                    other => slot.arguments.push_str(&other.to_string()),
                }
            }
        }
        let text = delta["content"].as_str().filter(|t| !t.is_empty())?;
        self.turn.content.push_str(text);
        Some(text.to_string())
    }

    pub fn finish(mut self) -> Turn {
        for (i, mut c) in self.calls.into_iter().enumerate() {
            if c.name.is_empty() {
                continue;
            }
            if c.id.is_empty() {
                c.id = format!("call_{i}");
            }
            self.turn.tool_calls.push(c);
        }
        self.turn
    }
}

fn agent(timeout: Duration) -> ureq::Agent {
    ureq::Agent::config_builder().http_status_as_error(false).timeout_global(Some(timeout)).timeout_connect(Some(Duration::from_secs(10))).user_agent("TekBoard").max_redirects(2).build().into()
}

/// An error a person can act on, from an HTTP status and the server's answer.
pub fn explain(ep: &Endpoint, status: u16, body: &str) -> AppError {
    let server = serde_json::from_str::<Value>(body).ok().and_then(|v| v["error"]["message"].as_str().or(v["error"].as_str()).map(str::to_string)).unwrap_or_else(|| super::stream::clip(body, 300));
    let server = super::secrets::scrub(&server);
    let who = ep.kind.name();
    let msg = match (ep.kind, status) {
        (_, 401) | (_, 403) => format!("{who} refuse la clé API ({server}). Vérifie-la dans Réglages → IA."),
        (_, 402) => format!("{who} demande des crédits pour ce modèle ({server}). Choisis un modèle gratuit dans Réglages → IA."),
        (_, 429) => format!("{who} limite le nombre de requêtes (modèles gratuits : environ 20 par minute). Réessaie dans un moment. ({server})"),
        (_, 404) => format!("Le modèle « {} » est introuvable chez {who} ({server}). Choisis-en un autre dans Réglages → IA.", ep.model),
        (_, 408) | (_, 502..=504) => format!("{who} n'a pas répondu à temps ({status}). Réessaie, ou choisis un autre modèle."),
        _ => format!("{who} a refusé la requête ({status}) : {server}"),
    };
    AppError::new("ai_failed", msg)
}

fn transport(ep: &Endpoint, e: &ureq::Error) -> AppError {
    let raw = super::secrets::scrub(&e.to_string());
    match ep.kind {
        super::provider::Kind::Ollama => AppError::new("ai_failed", format!("Ollama ne répond pas sur {} ({raw}). Lance Ollama (`ollama serve`, ou le service ollama) puis réessaie.", ep.base.trim_end_matches("/v1"))),
        _ => AppError::new("ai_failed", format!("{} est injoignable ({raw}). Vérifie ta connexion à Internet.", ep.kind.name())),
    }
}

/// GET `{base}{path}` with the key, as JSON.
pub fn get_json(ep: &Endpoint, path: &str, timeout: Duration) -> Result<Value> {
    let mut req = agent(timeout).get(&format!("{}{path}", ep.base));
    if let Some(k) = &ep.key {
        req = req.header("Authorization", &format!("Bearer {k}"));
    }
    match req.call() {
        Ok(mut resp) => {
            let status = resp.status().as_u16();
            let body = resp.body_mut().with_config().limit(20 * 1024 * 1024).read_to_string().unwrap_or_default();
            if status != 200 {
                return Err(explain(ep, status, &body));
            }
            serde_json::from_str(&body).map_err(|_| AppError::new("ai_failed", format!("Réponse illisible de {}", ep.kind.name())))
        }
        Err(e) => Err(transport(ep, &e)),
    }
}

/// The request body. `tools` is the OpenAI `tools` list (may be empty).
pub fn body(ep: &Endpoint, messages: &[Value], tools: &[Value]) -> Value {
    // A bound on every answer: a small model can otherwise repeat itself until the job's timeout.
    let mut b = json!({"model": ep.model, "messages": messages, "stream": true, "max_tokens": MAX_ANSWER_TOKENS});
    if ep.tools && !tools.is_empty() {
        b["tools"] = json!(tools);
    }
    if ep.kind == super::provider::Kind::OpenRouter {
        // The cost of the answer (0 for free models). No `models` list: never another model.
        b["usage"] = json!({"include": true});
    } else {
        b["stream_options"] = json!({"include_usage": true});
    }
    b
}

/// One completion, streamed. `on_delta` sees the text as it is written; `cancelled` is polled
/// between lines.
pub fn complete(ep: &Endpoint, messages: &[Value], tools: &[Value], timeout: Duration, cancelled: &dyn Fn() -> bool, on_delta: &mut dyn FnMut(&str)) -> Result<Turn> {
    let started = Instant::now();
    let payload = body(ep, messages, tools).to_string();
    let mut req = agent(timeout).post(&format!("{}/chat/completions", ep.base)).header("Content-Type", "application/json").header("Accept", "text/event-stream");
    if let Some(k) = &ep.key {
        req = req.header("Authorization", &format!("Bearer {k}"));
    }
    if ep.kind == super::provider::Kind::OpenRouter {
        req = req.header("X-Title", "TekBoard");
    }
    let resp = match req.send(payload.as_str()) {
        Ok(r) => r,
        Err(e) => return Err(transport(ep, &e)),
    };
    let status = resp.status().as_u16();
    let mut body = resp.into_body();
    if status != 200 {
        let text = body.with_config().limit(64 * 1024).read_to_string().unwrap_or_default();
        return Err(explain(ep, status, &text));
    }
    let mut acc = Acc::default();
    let reader = BufReader::new(body.into_reader());
    for line in reader.lines() {
        if cancelled() {
            return Err(AppError::new("cancelled", "Annulé"));
        }
        let line = match line {
            Ok(l) => l,
            Err(e) if started.elapsed() >= timeout => return Err(AppError::new("ai_failed", format!("{} n'a pas fini dans le temps imparti ({e}).", ep.kind.name()))),
            Err(e) => return Err(AppError::new("ai_failed", format!("Réponse de {} interrompue : {}", ep.kind.name(), super::secrets::scrub(&e.to_string())))),
        };
        // Ollama's native errors are plain JSON lines.
        if line.starts_with('{') {
            if let Ok(v) = serde_json::from_str::<Value>(&line) {
                if let Some(e) = v["error"].as_str().or(v["error"]["message"].as_str()) {
                    acc.error = Some(e.to_string());
                }
            }
        }
        if let Some(t) = acc.feed(&line) {
            on_delta(&t);
        }
        if acc.done || acc.error.is_some() {
            break;
        }
    }
    if let Some(e) = acc.error.take() {
        return Err(AppError::new("ai_failed", format!("{} : {}", ep.kind.name(), super::secrets::scrub(&e))));
    }
    Ok(acc.finish())
}

/// Whether a refusal says the model cannot use tools (then it is asked again without them).
pub fn refuses_tools(e: &AppError) -> bool {
    let m = e.to_string().to_lowercase();
    m.contains("tool") && (m.contains("support") || m.contains("not available") || m.contains("no endpoints"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_streamed_answer_is_rebuilt() {
        let mut a = Acc::default();
        let mut text = String::new();
        for l in [
            ": OPENROUTER PROCESSING",
            r#"data: {"choices":[{"delta":{"role":"assistant","content":"Bon"}}]}"#,
            r#"data: {"choices":[{"delta":{"content":"jour"}}]}"#,
            "",
            r#"data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":2,"cost":0}}"#,
            "data: [DONE]",
        ] {
            if let Some(t) = a.feed(l) {
                text.push_str(&t);
            }
        }
        assert!(a.done);
        let t = a.finish();
        assert_eq!((text.as_str(), t.content.as_str(), t.finish.as_deref()), ("Bonjour", "Bonjour", Some("stop")));
        assert_eq!((t.prompt_tokens, t.completion_tokens, t.cost_usd), (Some(12), Some(2), Some(0.0)));
    }

    #[test]
    fn tool_calls_arrive_in_pieces() {
        let mut a = Acc::default();
        for l in [
            r#"data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"get_today","arguments":""}}]}}]}"#,
            r#"data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"c2","function":{"name":"Read","arguments":"{\"file_"}}]}}]}"#,
            r#"data: {"choices":[{"delta":{"tool_calls":[{"index":1,"function":{"arguments":"path\":\"main.c\"}"}}]}}]}"#,
            r#"data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}"#,
        ] {
            a.feed(l);
        }
        let t = a.finish();
        assert_eq!(t.tool_calls.len(), 2);
        assert_eq!(t.tool_calls[0], ToolCall { id: "c1".into(), name: "get_today".into(), arguments: String::new() });
        assert_eq!(serde_json::from_str::<Value>(&t.tool_calls[1].arguments).unwrap()["file_path"], "main.c");
    }

    #[test]
    fn ollama_style_object_arguments_and_errors() {
        let mut a = Acc::default();
        a.feed(r#"data: {"choices":[{"delta":{"tool_calls":[{"function":{"name":"recall","arguments":{"query":"x"}}}]}}]}"#);
        let t = a.finish();
        assert_eq!(t.tool_calls[0].id, "call_0");
        assert_eq!(serde_json::from_str::<Value>(&t.tool_calls[0].arguments).unwrap()["query"], "x");
        let mut b = Acc::default();
        b.feed(r#"data: {"error":{"message":"Rate limit exceeded","code":429}}"#);
        assert_eq!(b.error.as_deref(), Some("Rate limit exceeded"));
    }

    #[test]
    fn errors_are_explained_without_the_key() {
        let ep = Endpoint { kind: super::super::provider::Kind::OpenRouter, base: "https://openrouter.ai/api/v1".into(), key: Some("sk-or-secret-123456".into()), model: "m:free".into(), tools: true };
        let e = explain(&ep, 429, r#"{"error":{"message":"Rate limit exceeded: free-models-per-min"}}"#);
        assert!(e.to_string().contains("limite") && !e.to_string().contains("sk-or"));
        assert!(explain(&ep, 404, "{}").to_string().contains("m:free"));
        let b = body(&ep, &[json!({"role":"user","content":"x"})], &[]);
        assert!(b.get("tools").is_none() && b["stream"] == true && b.get("models").is_none(), "no fallback list: {b}");
        assert_eq!(b["max_tokens"], MAX_ANSWER_TOKENS, "every answer is bounded");
        assert!(refuses_tools(&AppError::new("ai_failed", "registry.ollama.ai/library/gemma:2b does not support tools")));
    }
}
