//! Tools of the agents TekBoard runs on a working copy (Artix's moulinette, test generation).
//!
//! - `exec`: the only way an agent runs a command. It runs inside bubblewrap (`sandbox`), in
//!   the job's working copy and nowhere else, with time and resource limits. Every command
//!   and its result land in the job's activity feed: what the window shows is what ran.
//! - `plan_check`, `check_result`, `phase`, `finish_report`: how the moulinette reports. The
//!   live view is built from these calls, never from what the agent says in passing.

use super::sandbox;
use super::tools::Caller;
use crate::commands::AppState;
use crate::error::{AppError, Result};
use serde_json::{json, Value};
use std::time::Duration;

struct Spec {
    name: &'static str,
    label: &'static str,
    description: &'static str,
    schema: fn() -> Value,
}

fn obj(props: Value, required: &[&str]) -> Value {
    json!({"type": "object", "properties": props, "required": required, "additionalProperties": false})
}

const SPECS: &[Spec] = &[
    Spec {
        name: "exec",
        label: "Commande (bac à sable)",
        description: "Exécute une commande bash dans la copie de travail isolée : système en lecture seule, pas de réseau, dossier personnel masqué. Seule la copie de travail est modifiable. Utilise `timeout` pour tout programme qui pourrait boucler. Renvoie le code de sortie (ou le signal : 11 = segfault) et la fin de la sortie.",
        schema: || obj(json!({"command": {"type": "string", "description": "Commande bash"}, "timeoutSeconds": {"type": "integer", "description": "Limite, 1 à 300 (60 par défaut)"}}), &["command"]),
    },
    Spec {
        name: "phase",
        label: "Étape",
        description: "Annonce l'étape en cours (affichée en direct) : subject, build, arguments, edge_cases, errors, memory, style, robustness, report.",
        schema: || obj(json!({"phase": {"type": "string"}, "message": {"type": "string", "description": "Ce que tu fais, en une courte phrase"}}), &["phase", "message"]),
    },
    Spec {
        name: "plan_check",
        label: "Vérification prévue",
        description: "Déclare une vérification que tu vas faire (elle apparaît « prévue »). Donne un id court et stable.",
        schema: || obj(json!({"id": {"type": "string"}, "title": {"type": "string", "description": "Ce qui est vérifié"}, "category": {"type": "string", "description": "build | arguments | edge_cases | errors | memory | style | robustness | subject"}}), &["id", "title", "category"]),
    },
    Spec {
        name: "check_result",
        label: "Résultat de vérification",
        description: "Donne le résultat d'une vérification : status passed | failed | warning | skipped, la preuve (commande et sortie observée) et, en cas d'échec, une piste de correction concrète. N'annonce jamais un résultat que tu n'as pas observé avec exec.",
        schema: || obj(json!({"id": {"type": "string"}, "status": {"type": "string"}, "evidence": {"type": "string", "description": "Commande lancée et ce qu'elle a montré"}, "fix": {"type": "string", "description": "Comment corriger"}, "severity": {"type": "string", "description": "critical | major | minor"}}), &["id", "status", "evidence"]),
    },
    Spec {
        name: "finish_report",
        label: "Rapport final",
        description: "Termine avec le rapport : verdict d'une phrase, synthèse en Markdown (problèmes par gravité, pistes de correction, commandes pour reproduire). À appeler une seule fois, à la fin.",
        schema: || obj(json!({"verdict": {"type": "string"}, "summary": {"type": "string", "description": "Markdown"}}), &["verdict", "summary"]),
    },
];

pub const ALL: &[&str] = &["exec", "phase", "plan_check", "check_result", "finish_report"];

pub fn handles(name: &str) -> bool {
    ALL.contains(&name)
}

pub fn label(tool: &str) -> Option<String> {
    SPECS.iter().find(|s| s.name == tool).map(|s| s.label.to_string())
}

pub fn list_for(c: &Caller) -> Vec<Value> {
    SPECS.iter().filter(|s| c.allowed.contains(&s.name)).map(|s| json!({"name": s.name, "description": s.description, "inputSchema": (s.schema)()})).collect()
}

fn text<'a>(a: &'a Value, k: &str) -> Result<&'a str> {
    a.get(k).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).ok_or_else(|| AppError::new("invalid_args", format!("Paramètre manquant : {k}")))
}

pub fn call(state: &AppState, caller: &Caller, name: &str, a: &Value) -> Result<Value> {
    let job = caller.job_id.and_then(|id| state.jobs.handle(id)).ok_or_else(|| AppError::new("tool_refused", "Cet outil n'existe que pendant une tâche."))?;
    if job.cancelled() {
        return Err(AppError::new("cancelled", "La tâche a été interrompue : arrête-toi."));
    }
    let at = chrono::Utc::now().timestamp_millis();
    match name {
        "exec" => {
            let work = caller.work_dir.as_ref().ok_or_else(|| AppError::new("tool_refused", "Pas de copie de travail."))?;
            let command = text(a, "command")?;
            if command.len() > 4000 {
                return Err(AppError::new("invalid_args", "Commande trop longue."));
            }
            let secs = a.get("timeoutSeconds").and_then(Value::as_u64).unwrap_or(60).clamp(1, 300);
            let id = format!("exec-{at}");
            job.event(json!({"kind": "exec", "id": id, "label": "Commande", "detail": command, "status": "running", "at": at}));
            job.log(&format!("$ {command}"));
            let e = sandbox::exec(work, command, &sandbox::Limits { wall: Duration::from_secs(secs), cpu_seconds: secs * 2, ..Default::default() })?;
            let ok = !e.timed_out && e.signal.is_none() && e.code == Some(0);
            let shown = sandbox::describe(&e);
            job.log(&crate::ai::stream::clip(&shown, 3000));
            job.update_event(&id, |ev| {
                ev["status"] = json!(if ok { "ok" } else { "error" });
                ev["result"] = json!(crate::ai::stream::clip(&shown, 1200));
                ev["code"] = json!(e.code);
                ev["signal"] = json!(e.signal);
                ev["timedOut"] = json!(e.timed_out);
                ev["ms"] = json!(e.duration_ms);
            });
            Ok(json!({"exitCode": e.code, "signal": e.signal, "timedOut": e.timed_out, "durationMs": e.duration_ms, "output": e.output, "truncated": e.truncated}))
        }
        "phase" => {
            let phase = text(a, "phase")?;
            let message = text(a, "message")?;
            job.event(json!({"kind": "phase", "phase": phase, "text": message, "at": at}));
            job.set("phase", phase);
            Ok(json!({"ok": true}))
        }
        "plan_check" => {
            let id = text(a, "id")?;
            let title = text(a, "title")?;
            let category = text(a, "category")?;
            job.add_step(&format!("check:{id}"), title);
            job.event(json!({"kind": "check", "id": format!("check:{id}"), "title": title, "category": category, "status": "planned", "at": at}));
            Ok(json!({"ok": true}))
        }
        "check_result" => {
            let id = format!("check:{}", text(a, "id")?);
            let status = text(a, "status")?;
            let status = match status {
                "passed" | "failed" | "warning" | "skipped" => status,
                _ => return Err(AppError::new("invalid_args", "status : passed, failed, warning ou skipped")),
            };
            let evidence = text(a, "evidence")?.to_string();
            let fix = a.get("fix").and_then(Value::as_str).unwrap_or_default().to_string();
            let severity = a.get("severity").and_then(Value::as_str).unwrap_or(if status == "failed" { "major" } else { "minor" }).to_string();
            let step_status = match status {
                "passed" => "success",
                "failed" => "failed",
                "warning" => "warning",
                _ => "skipped",
            };
            job.end(&id, step_status, Some(crate::ai::stream::clip(&evidence, 300)));
            let mut found = false;
            job.update_event(&id, |ev| {
                found = true;
                ev["status"] = json!(status);
                ev["evidence"] = json!(crate::ai::stream::clip(&evidence, 2000));
                ev["fix"] = json!(crate::ai::stream::clip(&fix, 1200));
                ev["severity"] = json!(severity);
            });
            if !found {
                job.event(json!({"kind": "check", "id": id, "title": id.trim_start_matches("check:"), "category": "other", "status": status, "evidence": evidence, "fix": fix, "severity": severity, "at": at}));
            }
            Ok(json!({"ok": true}))
        }
        "finish_report" => {
            job.set("verdict", text(a, "verdict")?);
            job.set("report", text(a, "summary")?);
            job.event(json!({"kind": "phase", "phase": "report", "text": "Rapport rédigé", "at": at}));
            Ok(json!({"ok": true, "message": "Rapport enregistré. Tu peux t'arrêter."}))
        }
        other => Err(AppError::new("tool_unknown", format!("Outil inconnu : {other}"))),
    }
}
