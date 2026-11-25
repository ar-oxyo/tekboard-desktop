//! A run for OpenRouter and Ollama: what Claude Code does by itself, done by TekBoard.
//!
//! The model is asked; when it calls tools they run here (the project's `Read`/`Glob`/`Grep`
//! from `fstools`, TekBoard's own tools through `ipc::local`, with the same grant and rules
//! as for Claude Code), their results are given back, and so on until it answers. The job
//! gets the same activity entries as a Claude Code run, so every screen reads it the same.

use super::fstools::Fs;
use super::openai::{self, Endpoint};
use super::runner::{self, Answer, Request, Tools};
use super::stream::{self, Event};
use crate::error::{AppError, Result};
use crate::jobs::{Job, Outcome};
use serde_json::{json, Value};
use std::path::Path;
use std::time::Instant;

const MAX_TURNS: usize = 30;
const MAX_TOOL_RESULT: usize = 12_000;

/// The JSON object of an answer: a fenced block, or the text from the first `{` to the last `}`.
pub fn json_of(text: &str) -> Option<Value> {
    let fenced = crate::claude::fenced(text, "json");
    if let Ok(v @ Value::Object(_)) = serde_json::from_str::<Value>(fenced.trim()) {
        return Some(v);
    }
    let (a, b) = (text.find('{')?, text.rfind('}')?);
    (a < b).then(|| serde_json::from_str::<Value>(&text[a..=b]).ok()).flatten().filter(Value::is_object)
}

fn system_prompt(r: &Request, reads: bool) -> String {
    let mut s = r.system.clone().unwrap_or_default();
    if reads {
        s.push_str("\n\nLe projet à étudier est le dossier courant ; la liste de ses fichiers est donnée avec la demande. Avant de répondre, lis les fichiers utiles avec l'outil Read (et cherche avec Grep) : ne devine jamais le contenu d'un fichier que tu n'as pas lu. Tu ne peux rien modifier ni lancer de commande.");
    }
    if let Some(schema) = &r.json_schema {
        s.push_str("\n\nRéponds uniquement avec un objet JSON valide qui respecte ce schéma JSON, sans aucun texte avant ou après :\n");
        s.push_str(schema);
    }
    s.trim().to_string()
}

/// The first message: the files of the project come with the request, so even a small model
/// knows what it can read instead of guessing.
pub fn messages_with_files(r: &Request, files: Option<&str>) -> Vec<Value> {
    let mut m = messages(r, files.is_some());
    if let (Some(f), Some(last)) = (files, m.last_mut()) {
        last["content"] = json!(format!("{}\n\nFichiers du projet :\n{}", r.prompt, f));
    }
    m
}

pub fn messages(r: &Request, reads: bool) -> Vec<Value> {
    let mut m = Vec::new();
    let system = system_prompt(r, reads);
    if !system.is_empty() {
        m.push(json!({"role": "system", "content": system}));
    }
    for (role, text) in &r.history {
        m.push(json!({"role": role, "content": text}));
    }
    m.push(json!({"role": "user", "content": r.prompt}));
    m
}

pub fn run(job: &Job, dir: &Path, r: &Request, mut ep: Endpoint, on_event: &mut dyn FnMut(&Event)) -> Result<(Outcome, Result<Answer>)> {
    let started = Instant::now();
    let deadline = started + r.timeout;
    let fs = (r.tools == Tools::Read).then(|| Fs::new(dir));
    let token = r.mcp.as_ref().and_then(|m| super::ipc::token_in(&m.config));
    let mut specs: Vec<Value> = Vec::new();
    if fs.is_some() {
        specs.extend(super::fstools::specs());
    }
    if let Some(t) = &token {
        let list = super::ipc::local(t, "list", "", &json!({}));
        for tool in list["result"].as_array().map(|a| a.as_slice()).unwrap_or_default() {
            specs.push(json!({"type": "function", "function": {"name": tool["name"], "description": tool["description"], "parameters": tool["inputSchema"]}}));
        }
    }
    job.log(&format!("{} · modèle {} · {} outil(s)", ep.kind.name(), ep.model, specs.len()));
    let listing = fs.as_ref().and_then(|f| f.call("Glob", &json!({"pattern": "**"}))).and_then(|r| r.ok());
    let mut msgs = if fs.is_some() { messages_with_files(r, Some(listing.as_deref().unwrap_or("(aucun fichier lisible)"))) } else { messages(r, false) };
    let mut text = String::new();
    let (mut tokens_in, mut tokens_out, mut cost) = (0u64, 0u64, 0f64);
    let mut json_retry = r.json_schema.is_some();
    let mut turns = 0usize;
    let finish = |cancelled: bool, timed_out: bool, ok: bool| Outcome { code: Some(if ok { 0 } else { 1 }), output: String::new(), stdout: String::new(), stderr: String::new(), timed_out, cancelled, duration_ms: started.elapsed().as_millis() as u64 };

    let answer: Result<Answer> = loop {
        if job.cancelled() {
            return Ok((finish(true, false, false), Err(AppError::new("cancelled", "Annulé"))));
        }
        let now = Instant::now();
        if now >= deadline {
            return Ok((finish(false, true, false), Err(AppError::new("ai_failed", format!("{} n'a pas fini dans le temps imparti ({} min).", ep.kind.name(), r.timeout.as_secs() / 60)))));
        }
        if turns >= MAX_TURNS {
            break Err(AppError::new("ai_failed", format!("Le modèle s'est arrêté après {MAX_TURNS} étapes sans conclure. Essaie un modèle plus capable, ou une demande plus précise.")));
        }
        turns += 1;
        let mut partial_text = String::new();
        let res = openai::complete(&ep, &msgs, &specs, deadline - now, &|| job.cancelled(), &mut |d| {
            partial_text.push_str(d);
            if r.partial {
                job.set("partial", format!("{text}{partial_text}"));
            }
            on_event(&Event::Delta(d.to_string()));
        });
        let turn = match res {
            Ok(t) => t,
            Err(e) if e.code() == "cancelled" => return Ok((finish(true, false, false), Err(e))),
            Err(e) if ep.tools && !specs.is_empty() && openai::refuses_tools(&e) => {
                job.log("Ce modèle ne sait pas utiliser d'outils : il répond sans lire le projet ni TekBoard.");
                job.set("noTools", true);
                ep.tools = false;
                turns -= 1;
                continue;
            }
            Err(e) => break Err(e),
        };
        tokens_in += turn.prompt_tokens.unwrap_or(0);
        tokens_out += turn.completion_tokens.unwrap_or(0);
        cost += turn.cost_usd.unwrap_or(0.0);
        if !turn.content.trim().is_empty() {
            let ev = Event::Text(turn.content.clone());
            runner::show(job, &ev);
            on_event(&ev);
        }
        if turn.tool_calls.is_empty() || !ep.tools {
            text.push_str(&turn.content);
            if turn.finish.as_deref() == Some("length") && r.json_schema.is_none() {
                job.log("Réponse coupée : le modèle a atteint la longueur maximale.");
                text.push_str("\n\n_(Réponse coupée : le modèle a atteint la longueur maximale.)_");
            }
            if r.json_schema.is_some() {
                match json_of(&text) {
                    Some(v) => break Ok(answer(&text, v.into(), turns, cost)),
                    None if json_retry => {
                        json_retry = false;
                        job.log("La réponse n'était pas un JSON valide : nouvelle demande.");
                        msgs.push(json!({"role": "assistant", "content": text}));
                        msgs.push(json!({"role": "user", "content": "Ta réponse n'est pas un objet JSON valide. Renvoie uniquement l'objet JSON demandé, sans texte autour."}));
                        text.clear();
                        continue;
                    }
                    None => break Err(AppError::new("ai_failed", "La réponse n'était pas le JSON attendu, même après une seconde demande. Essaie un modèle plus capable.")),
                }
            }
            break Ok(answer(&text, None, turns, cost));
        }
        if r.partial && !turn.content.is_empty() {
            text.push_str(&turn.content);
            text.push_str("\n\n");
        }
        msgs.push(json!({"role": "assistant", "content": if turn.content.is_empty() { Value::Null } else { json!(turn.content) }, "tool_calls": turn.tool_calls.iter().map(|c| json!({"id": c.id, "type": "function", "function": {"name": c.name, "arguments": if c.arguments.trim().is_empty() { "{}" } else { c.arguments.as_str() }}})).collect::<Vec<_>>()}));
        for c in &turn.tool_calls {
            let input: Value = serde_json::from_str(if c.arguments.trim().is_empty() { "{}" } else { &c.arguments }).unwrap_or(json!({}));
            let from_fs = fs.as_ref().and_then(|f| f.call(&c.name, &input));
            // TekBoard's tools are shown as Claude Code shows them.
            let shown = if from_fs.is_some() { c.name.clone() } else { format!("mcp__tekboard__{}", c.name) };
            let ev = Event::ToolUse { id: c.id.clone(), name: shown, input: input.clone() };
            runner::show(job, &ev);
            on_event(&ev);
            let (ok, out) = match from_fs {
                Some(Ok(t)) => (true, t),
                Some(Err(t)) => (false, t),
                None => match &token {
                    Some(t) => {
                        let v = super::ipc::local(t, "call", &c.name, &input);
                        if v["ok"] == true {
                            (true, v["result"].to_string())
                        } else {
                            (false, v["error"].as_str().unwrap_or("Erreur").to_string())
                        }
                    }
                    None => (false, format!("L'outil {} n'existe pas ici.", c.name)),
                },
            };
            let ev = Event::ToolResult { id: c.id.clone(), ok, text: out.clone() };
            runner::show(job, &ev);
            on_event(&ev);
            msgs.push(json!({"role": "tool", "tool_call_id": c.id, "content": stream::clip(&out, MAX_TOOL_RESULT)}));
        }
    };
    if tokens_in + tokens_out > 0 {
        job.set("tokens", json!({"prompt": tokens_in, "completion": tokens_out}));
    }
    let ok = answer.is_ok();
    Ok((finish(false, false, ok), answer))
}

fn answer(text: &str, structured: Option<Value>, turns: usize, cost: f64) -> Answer {
    Answer { text: text.trim().to_string(), cost_usd: (cost > 0.0).then_some(cost), turns: Some(turns as u64), session_id: None, structured, denials: vec![] }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn json_is_found_in_the_answer() {
        assert_eq!(json_of("```json\n{\"a\":1}\n```").unwrap()["a"], 1);
        assert_eq!(json_of("Voici : {\"a\": {\"b\": 2}} voilà").unwrap()["a"]["b"], 2);
        assert!(json_of("pas de json").is_none() && json_of("[1,2]").is_none());
    }

    #[test]
    fn messages_carry_role_history_and_schema() {
        let mut r = Request::new("Question ?", Tools::Read, Duration::from_secs(5));
        r.system = Some("Tu es Artix.".into());
        r.json_schema = Some("{\"type\":\"object\"}".into());
        r.history = vec![("user".into(), "avant".into()), ("assistant".into(), "réponse".into())];
        let m = messages(&r, true);
        assert_eq!(m.len(), 4);
        let sys = m[0]["content"].as_str().unwrap();
        assert!(sys.starts_with("Tu es Artix.") && sys.contains("outil Read") && sys.contains("{\"type\":\"object\"}"));
        let with = messages_with_files(&r, Some("Makefile\nsrc/main.c\n"));
        assert!(with.last().unwrap()["content"].as_str().unwrap().ends_with("Fichiers du projet :\nMakefile\nsrc/main.c\n"));
        assert_eq!((m[1]["role"].as_str(), m[3]["content"].as_str()), (Some("user"), Some("Question ?")));
        assert_eq!(messages(&Request::new("x", Tools::None, Duration::from_secs(5)), false).len(), 1, "no empty system message");
    }
}
