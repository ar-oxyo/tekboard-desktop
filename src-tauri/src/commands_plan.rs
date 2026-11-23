//! Planning commands: tasks, calendar entries, estimates, time logged, and the assistant.

use crate::commands::AppState;
use crate::error::{AppError, Result};
use crate::planner::{self, Action, Applied, PlanEvent, ProjectPlan, Task, WorkLog};
use crate::{claude, db, subjects};
use std::time::Duration;
use tauri::State;

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

#[tauri::command(async)]
pub fn plan_state(state: State<'_, AppState>) -> Result<planner::State> {
    planner::state(&state.conn(), now())
}

#[tauri::command(async)]
pub fn plan_task_save(state: State<'_, AppState>, task: Task) -> Result<Task> {
    planner::save_task(&state.conn(), &task, now())
}

#[tauri::command(async)]
pub fn plan_task_delete(state: State<'_, AppState>, id: i64) -> Result<()> {
    planner::delete_task(&state.conn(), id)
}

#[tauri::command(async)]
pub fn plan_event_save(state: State<'_, AppState>, event: PlanEvent) -> Result<PlanEvent> {
    planner::save_event(&state.conn(), &event, now())
}

#[tauri::command(async)]
pub fn plan_event_delete(state: State<'_, AppState>, id: i64) -> Result<()> {
    planner::delete_event(&state.conn(), id)
}

/// `estimate_min` / `color`: absent = unchanged, `null` = cleared.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPatch {
    pub priority: Option<i64>,
    #[serde(default, deserialize_with = "present")]
    pub estimate_min: Option<Option<i64>>,
    #[serde(default, deserialize_with = "present")]
    pub color: Option<Option<String>>,
}

/// Tells a field that is `null` (`Some(None)`) from one that is absent (`None`).
fn present<'de, T: serde::Deserialize<'de>, D: serde::Deserializer<'de>>(d: D) -> std::result::Result<Option<Option<T>>, D::Error> {
    Ok(Some(<Option<T> as serde::Deserialize>::deserialize(d)?))
}

#[tauri::command(async)]
pub fn plan_project_set(state: State<'_, AppState>, key: String, patch: ProjectPatch) -> Result<ProjectPlan> {
    planner::set_project(&state.conn(), &key, patch.priority, patch.estimate_min, patch.color)
}

#[tauri::command(async)]
pub fn plan_log_add(state: State<'_, AppState>, project: Option<String>, task_id: Option<i64>, title: String, started_at: i64, seconds: i64) -> Result<WorkLog> {
    planner::log_work(&state.conn(), project.as_deref(), task_id, &title, started_at, seconds)
}

/// Applies a plan the user has just reviewed. `origin` is `auto` (computed here) or `claude`.
#[tauri::command(async)]
pub fn plan_apply(state: State<'_, AppState>, actions: Vec<Action>, origin: String) -> Result<Applied> {
    let origin = if origin == "claude" { "claude" } else { "auto" };
    planner::apply(&state.conn(), &actions, origin, now())
}

// ───────────────────────────── assistant ─────────────────────────────

const MAX_CONTEXT: usize = 60_000;

pub const INSTRUCTIONS: &str = r#"You are the planning assistant built into TekBoard, a desktop app an Epitech student uses to organise projects, hand-ins and work sessions. Answer in the language of the student's request.

All you know is the CONTEXT below, produced by the app (JSON, local times written YYYY-MM-DDTHH:MM). You have no tool: do not ask to read files or to look anything up.

Rules:
- Entries with "source": "my" come from the school (sessions, hand-ins). They cannot be moved or deleted: plan around them.
- Place work sessions only inside the "free" slots, never over another entry, and never after the hand-in of the project they belong to.
- A session lasts between 30 minutes and "prefs.sessionMinutes"; leave "prefs.breakMinutes" between two sessions; do not plan more than "prefs.maxMinutesPerDay" of work on one day.
- "estimateMin" is the work still to do on a project and "plannedMin" what is already in the calendar: plan the difference, most urgent hand-in first, then highest priority.
- Use project keys and entry ids exactly as given. Never invent a project, a deadline or an id.
- If the time available is not enough, say so plainly and plan what fits.

Reply with ONE fenced json block and nothing else:
```json
{"reply": "what the student should know, plain text, a few short lines", "actions": []}
```
Allowed actions (use [] when advice is enough):
{"type": "create_session", "project": "<key or null>", "title": "...", "start": "YYYY-MM-DDTHH:MM", "end": "YYYY-MM-DDTHH:MM", "taskId": null}
{"type": "move_event", "id": 12, "start": "...", "end": "..."}   (personal entries only)
{"type": "delete_event", "id": 12}                               (personal entries only)
{"type": "create_task", "project": "<key or null>", "title": "...", "estimateMin": 60, "priority": 0-3, "dueDay": "YYYY-MM-DD or null", "subtasks": ["..."]}
{"type": "set_priority", "project": "<key>", "priority": 0-3}
{"type": "set_estimate", "project": "<key>", "estimateMin": 720}
Nothing is applied until the student reviews the changes and presses "Apply plan"."#;

pub fn build_prompt(question: &str, context: &str, subject: Option<&str>) -> String {
    let mut p = format!("{INSTRUCTIONS}\n\nCONTEXT\n{context}\n");
    if let Some(s) = subject {
        p.push_str(&format!("\nSUBJECT OF THE PROJECT (text extracted from its PDF, may be truncated)\n{s}\n"));
    }
    p.push_str(&format!("\nREQUEST\n{}\n", question.trim()));
    p
}

/// Asks Claude Code about the planning. `context` is what the calendar shows (built by the
/// UI); with `subject_of`, the text of that repository's linked subject is added. Claude
/// gets no tool at all, and its proposals are only returned: nothing is written here.
#[tauri::command(async)]
pub fn assistant_start(state: State<'_, AppState>, question: String, context: String, subject_of: Option<String>) -> Result<u64> {
    let question = question.trim().to_string();
    if question.is_empty() || question.len() > 4000 {
        return Err(AppError::new("invalid_question", "Write a request of at most 4000 characters"));
    }
    if context.len() > MAX_CONTEXT || serde_json::from_str::<serde_json::Value>(&context).is_err() {
        return Err(AppError::new("invalid_context", "The planning context is too large or unreadable"));
    }
    // A second question must never receive the answer to the first one.
    if state.jobs.active("assistant", None).is_some() {
        return Err(AppError::new("busy", "Une réponse est déjà en cours : attends-la ou annule-la."));
    }
    claude::executable()?;
    let subject = subject_of.and_then(|repo| {
        let conn = state.conn();
        let s = db::list_subjects(&conn).ok()?.into_iter().find(|s| s.repo_path.as_deref() == Some(repo.as_str()))?;
        claude::pdf_text(&subjects::file_path(&state.subjects(), &s), 14_000)
    });
    let prompt = build_prompt(&question, &context, subject.as_deref());
    let dir = state.cache_dir.join("assistant");
    std::fs::create_dir_all(&dir)?;
    let title: String = format!("Planning assistant — {}", question.chars().take(60).collect::<String>());
    Ok(state.jobs.start(state.db.clone(), "assistant", None, title, &[("claude", "Claude Code looks at your planning")], move |job| {
        job.start("claude");
        job.set("withSubject", subject.is_some());
        let (o, answer) = claude::run_chat(job, &dir, &prompt, Duration::from_secs(300))?;
        if o.cancelled {
            return Ok("cancelled");
        }
        match answer {
            Ok(a) => {
                let r = planner::parse_reply(&a.text);
                job.end("claude", "success", Some(format!("{} change(s) proposed", r.actions.len())));
                job.set("reply", &r.reply);
                job.set("actions", &r.actions);
                job.set("rejected", &r.rejected);
                job.set("costUsd", a.cost_usd);
                Ok("success")
            }
            Err(e) => {
                job.set("error", e.to_string());
                job.end("claude", "failed", Some(e.to_string()));
                Ok("failed")
            }
        }
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_prompt_carries_rules_context_and_request_in_that_order() {
        let p = build_prompt("  Plan my week ", "{\"projects\":[]}", Some("Write a shell."));
        let (rules, ctx, subject, req) = (p.find("Rules:").unwrap(), p.find("CONTEXT\n{").unwrap(), p.find("SUBJECT OF THE PROJECT").unwrap(), p.find("REQUEST\nPlan my week\n").unwrap());
        assert!(rules < ctx && ctx < subject && subject < req);
        assert!(p.contains("Apply plan") && p.contains("\"source\": \"my\""));
        assert!(!build_prompt("x", "{}", None).contains("SUBJECT OF"));
    }

    #[test]
    fn a_missing_field_is_left_alone_and_null_clears_it() {
        let p: ProjectPatch = serde_json::from_str("{\"priority\":2}").unwrap();
        assert_eq!((p.priority, p.estimate_min, p.color.is_none()), (Some(2), None, true));
        let p: ProjectPatch = serde_json::from_str("{\"estimateMin\":null,\"color\":\"#aabbcc\"}").unwrap();
        assert_eq!((p.estimate_min, p.color), (Some(None), Some(Some("#aabbcc".into()))));
    }
}
