//! Reads the `stream-json` output of `claude -p --output-format stream-json --verbose`.
//!
//! Each line is one JSON object. The ones that matter here:
//! - `{"type":"system","subtype":"init","session_id","model",…}`
//! - `{"type":"assistant","message":{"content":[{"type":"text"|"tool_use",…}]}}`
//! - `{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id","content","is_error"}]}}`
//! - `{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text"}}}`
//! - `{"type":"result","subtype","is_error","result","num_turns","total_cost_usd","session_id","permission_denials"}`
//!
//! Anything else is ignored. A line that is not JSON at all is the program talking on
//! stderr (not logged in, bad flag): it is kept as `Raw` so the error can be shown.

use serde_json::Value;

#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    Init { session_id: String, model: String },
    /// A piece of text being written (only with `--include-partial-messages`).
    Delta(String),
    /// A complete text block of an assistant message.
    Text(String),
    ToolUse { id: String, name: String, input: Value },
    ToolResult { id: String, ok: bool, text: String },
    Result(Final),
    Raw(String),
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Final {
    pub ok: bool,
    pub subtype: String,
    pub text: String,
    pub turns: Option<u64>,
    pub cost_usd: Option<f64>,
    pub session_id: Option<String>,
    pub denials: Vec<String>,
    /// Output validated against `--json-schema`, when one was given.
    pub structured: Option<Value>,
}

/// Every event a line holds (an assistant message can carry several blocks).
pub fn parse_line(line: &str) -> Vec<Event> {
    let t = line.trim();
    if t.is_empty() {
        return vec![];
    }
    let Ok(v) = serde_json::from_str::<Value>(t) else {
        return vec![Event::Raw(t.to_string())];
    };
    match v["type"].as_str().unwrap_or_default() {
        "system" if v["subtype"] == "init" => vec![Event::Init { session_id: v["session_id"].as_str().unwrap_or_default().to_string(), model: v["model"].as_str().unwrap_or_default().to_string() }],
        "stream_event" => {
            let e = &v["event"];
            if e["type"] == "content_block_delta" && e["delta"]["type"] == "text_delta" && v["parent_tool_use_id"].is_null() {
                vec![Event::Delta(e["delta"]["text"].as_str().unwrap_or_default().to_string())]
            } else {
                vec![]
            }
        }
        "assistant" => {
            // Text of a sub-agent is not part of the answer.
            let nested = !v["parent_tool_use_id"].is_null();
            blocks(&v)
                .filter_map(|b| match b["type"].as_str()? {
                    "text" if !nested => Some(Event::Text(b["text"].as_str()?.to_string())),
                    "tool_use" => Some(Event::ToolUse { id: b["id"].as_str()?.to_string(), name: b["name"].as_str()?.to_string(), input: b["input"].clone() }),
                    _ => None,
                })
                .collect()
        }
        "user" => blocks(&v)
            .filter_map(|b| {
                (b["type"] == "tool_result").then(|| Event::ToolResult { id: b["tool_use_id"].as_str().unwrap_or_default().to_string(), ok: !b["is_error"].as_bool().unwrap_or(false), text: result_text(&b["content"]) })
            })
            .collect(),
        "result" => {
            let denials = v["permission_denials"].as_array().map(|a| a.iter().filter_map(|d| d["tool_name"].as_str().or_else(|| d.as_str()).map(str::to_string)).collect()).unwrap_or_default();
            let subtype = v["subtype"].as_str().unwrap_or_default().to_string();
            let is_error = v["is_error"].as_bool().unwrap_or(false) || subtype.starts_with("error");
            vec![Event::Result(Final {
                ok: !is_error,
                text: v["result"].as_str().unwrap_or_default().to_string(),
                subtype,
                turns: v["num_turns"].as_u64(),
                cost_usd: v["total_cost_usd"].as_f64(),
                session_id: v["session_id"].as_str().map(str::to_string),
                denials,
                structured: v.get("structured_output").filter(|s| !s.is_null()).cloned(),
            })]
        }
        _ => vec![],
    }
}

fn blocks(v: &Value) -> impl Iterator<Item = &Value> {
    v["message"]["content"].as_array().map(|a| a.iter()).into_iter().flatten()
}

/// A tool result's content is a string or a list of `{type:"text",text}` blocks.
fn result_text(content: &Value) -> String {
    match content {
        Value::String(s) => s.clone(),
        Value::Array(items) => items.iter().filter_map(|i| i["text"].as_str()).collect::<Vec<_>>().join("\n"),
        _ => String::new(),
    }
}

/// A short French description of a tool call, for the live activity feed.
/// MCP tools of TekBoard are described by their registry (`label_of`).
pub fn describe(name: &str, input: &Value, label_of: &dyn Fn(&str) -> Option<String>) -> (String, String) {
    let s = |k: &str| input[k].as_str().unwrap_or_default().to_string();
    match name {
        "Read" => ("Lecture".into(), short_path(&s("file_path"))),
        "Glob" => ("Recherche de fichiers".into(), s("pattern")),
        "Grep" => ("Recherche dans le code".into(), format!("« {} »", s("pattern"))),
        "Edit" | "MultiEdit" => ("Modification".into(), short_path(&s("file_path"))),
        "Write" => ("Écriture".into(), short_path(&s("file_path"))),
        "Bash" => ("Commande".into(), s("command")),
        "TodoWrite" => ("Liste de tâches".into(), String::new()),
        n if n.starts_with("mcp__tekboard__") => {
            let tool = &n["mcp__tekboard__".len()..];
            let detail = match tool {
                "exec" => s("command"),
                _ => input.as_object().map(|o| o.values().filter_map(|v| v.as_str()).take(2).collect::<Vec<_>>().join(" · ")).unwrap_or_default(),
            };
            (label_of(tool).unwrap_or_else(|| tool.replace('_', " ")), clip(&detail, 160))
        }
        other => (other.to_string(), String::new()),
    }
}

fn short_path(p: &str) -> String {
    let parts: Vec<&str> = p.rsplit('/').take(3).collect();
    parts.into_iter().rev().collect::<Vec<_>>().join("/")
}

pub fn clip(s: &str, max: usize) -> String {
    let s = s.trim();
    if s.chars().count() <= max {
        return s.to_string();
    }
    let cut: String = s.chars().take(max).collect();
    format!("{cut}…")
}

/// The error to show when a run ended badly, in the user's words.
pub fn explain(f: &Final) -> String {
    match f.subtype.as_str() {
        "error_max_budget_usd" => "Budget maximal atteint pour cette tâche (réglable dans Réglages → IA).".into(),
        "error_max_turns" => "Claude Code a atteint le nombre maximal d'étapes avant de finir.".into(),
        "error_during_execution" if f.text.is_empty() => "Claude Code s'est arrêté sur une erreur pendant l'exécution.".into(),
        _ if f.text.is_empty() => format!("Claude Code n'a rien répondu ({}).", if f.subtype.is_empty() { "sans détail" } else { &f.subtype }),
        _ => f.text.clone(),
    }
}

/// What a non-JSON line most likely means.
pub fn explain_raw(line: &str) -> String {
    let l = line.to_lowercase();
    if l.contains("login") || l.contains("not logged") || l.contains("invalid api key") || l.contains("authenticat") {
        format!("Claude Code n'est pas connecté à ton compte : lance `claude` dans un terminal et utilise /login. ({})", clip(line, 160))
    } else if l.contains("unknown option") || l.contains("error: option") {
        format!("Cette version de Claude Code ne connaît pas une option utilisée par TekBoard : mets-la à jour (`claude update`). ({})", clip(line, 160))
    } else {
        clip(line, 400)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Lines recorded from a real run of Claude Code 2.1.330 (trimmed).
    const INIT: &str = r#"{"type":"system","subtype":"init","cwd":"/tmp/x","session_id":"a978","tools":["Bash","Read"],"model":"claude-haiku-5-5","permissionMode":"dontAsk"}"#;
    const TOOL: &str = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"toolu_1","name":"Bash","input":{"command":"gcc main.c","description":"Compile"}}]},"parent_tool_use_id":null}"#;
    const RESULT_ERR: &str = r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"Exit code 1\nboom","is_error":true,"tool_use_id":"toolu_1"}]},"parent_tool_use_id":null}"#;
    const DELTA: &str = r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Sal"}},"parent_tool_use_id":null}"#;
    const DONE: &str = r#"{"type":"result","subtype":"success","is_error":false,"num_turns":3,"result":"Fini.","session_id":"a978","total_cost_usd":0.0015,"permission_denials":[]}"#;

    #[test]
    fn real_lines_are_understood() {
        assert_eq!(parse_line(INIT), vec![Event::Init { session_id: "a978".into(), model: "claude-haiku-5-5".into() }]);
        match &parse_line(TOOL)[0] {
            Event::ToolUse { id, name, input } => assert_eq!((id.as_str(), name.as_str(), input["command"].as_str()), ("toolu_1", "Bash", Some("gcc main.c"))),
            e => panic!("{e:?}"),
        }
        assert_eq!(parse_line(RESULT_ERR), vec![Event::ToolResult { id: "toolu_1".into(), ok: false, text: "Exit code 1\nboom".into() }]);
        assert_eq!(parse_line(DELTA), vec![Event::Delta("Sal".into())]);
        match &parse_line(DONE)[0] {
            Event::Result(f) => {
                assert!(f.ok);
                assert_eq!((f.text.as_str(), f.turns, f.session_id.as_deref()), ("Fini.", Some(3), Some("a978")));
            }
            e => panic!("{e:?}"),
        }
    }

    #[test]
    fn errors_and_noise() {
        assert_eq!(parse_line("Invalid API key · Please run /login"), vec![Event::Raw("Invalid API key · Please run /login".into())]);
        assert!(explain_raw("Invalid API key · Please run /login").contains("/login"));
        let budget = Final { subtype: "error_max_budget_usd".into(), ..Default::default() };
        assert!(explain(&budget).contains("Budget"));
        match &parse_line(r#"{"type":"result","subtype":"error_during_execution","is_error":true,"result":""}"#)[0] {
            Event::Result(f) => assert!(!f.ok),
            e => panic!("{e:?}"),
        }
        assert!(parse_line(r#"{"type":"rate_limit_event"}"#).is_empty());
        assert!(parse_line("").is_empty());
    }

    #[test]
    fn tool_calls_are_described_in_french() {
        let none = |_: &str| None;
        assert_eq!(describe("Read", &serde_json::json!({"file_path":"/a/b/src/main.c"}), &none), ("Lecture".into(), "b/src/main.c".into()));
        assert_eq!(describe("mcp__tekboard__exec", &serde_json::json!({"command":"make re"}), &none).1, "make re");
        let named = |t: &str| (t == "get_today").then(|| "Lecture de ta journée".to_string());
        assert_eq!(describe("mcp__tekboard__get_today", &serde_json::json!({}), &named).0, "Lecture de ta journée");
    }
}
