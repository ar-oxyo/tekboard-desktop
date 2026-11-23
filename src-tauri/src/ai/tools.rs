//! What Tika can do in TekBoard. One registry, used by the MCP bridge (Claude Code calls a
//! tool), by the suggestion buttons and by the window: the same logic everywhere.
//!
//! Each tool has a risk level:
//! - `Read`: reads only.
//! - `Reversible`: done at once, written to the journal (`ai_actions`) with what undoes it.
//! - `Approval`: nothing changes; a proposal (`ai_proposals`) is created for the user to accept,
//!   edit or refuse. Bulk calendar changes, deletions and file writes are always this kind.
//!
//! What a tool returns is the truth Tika works from: it never claims something happened
//! unless a tool said so.

use super::memory;
use crate::commands::AppState;
use crate::error::{AppError, Result};
use crate::schedule::{self, Busy, Placement, Rhythm};
use rusqlite::{params, Connection};
use serde_json::{json, Value};

#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Risk {
    Read,
    Reversible,
    Approval,
}

pub struct Spec {
    pub name: &'static str,
    pub label: &'static str,
    pub risk: Risk,
    pub description: &'static str,
    pub schema: fn() -> Value,
}

/// Who is calling: a conversation, or an agent job.
#[derive(Debug, Clone, Default)]
pub struct Caller {
    pub thread_id: Option<i64>,
    pub job_id: Option<u64>,
    /// Working copy of an agent job (`exec` runs there, nowhere else).
    pub work_dir: Option<std::path::PathBuf>,
    /// Tools this caller may use.
    pub allowed: Vec<&'static str>,
}

fn obj(props: Value, required: &[&str]) -> Value {
    json!({"type": "object", "properties": props, "required": required, "additionalProperties": false})
}
fn none() -> Value {
    obj(json!({}), &[])
}
fn s(desc: &str) -> Value {
    json!({"type": "string", "description": desc})
}
fn n(desc: &str) -> Value {
    json!({"type": "integer", "description": desc})
}
fn b(desc: &str) -> Value {
    json!({"type": "boolean", "description": desc})
}

const TIME: &str = "Heure locale AAAA-MM-JJTHH:MM";

pub const SPECS: &[Spec] = &[
    Spec { name: "get_today", label: "Lecture de ta journée", risk: Risk::Read, description: "La journée de l'utilisateur : date et heure, ce qui est prévu aujourd'hui (cours, sessions, rendus), la charge du jour face à son rythme, les prochains rendus et la session de travail en cours. À appeler en premier pour toute question d'organisation.", schema: none },
    Spec { name: "list_projects", label: "Liste des projets", risk: Risk::Read, description: "Les projets : clé (à réutiliser dans les autres outils), nom, module, statut, rendu, estimation du travail restant, temps déjà planifié, priorité, dernier commit.", schema: || obj(json!({"all": b("Inclure les projets terminés")}), &[]) },
    Spec { name: "get_project", label: "Lecture d'un projet", risk: Risk::Read, description: "Tout sur un projet : état git, rendu, tâches, résumé du sujet (s'il a été analysé), souvenirs liés, derniers résultats de tests et de moulinette.", schema: || obj(json!({"project": s("Clé du projet (list_projects)")}), &["project"]) },
    Spec { name: "get_calendar", label: "Lecture du calendrier", risk: Risk::Read, description: "Le calendrier jour par jour : entrées (avec leur id pour move_event), cours, rendus, et la charge de chaque jour (travail, école, plafond, temps libre).", schema: || obj(json!({"from": s("Premier jour AAAA-MM-JJ (aujourd'hui par défaut)"), "days": n("Nombre de jours, 1 à 14 (7 par défaut)")}), &[]) },
    Spec { name: "find_free_time", label: "Recherche de temps libre", risk: Risk::Read, description: "Créneaux libres dans les horaires de travail, pauses avant et après chaque bloc déjà comptées, repas protégés exclus. Indique aussi ce qu'il reste sous le plafond de chaque jour.", schema: || obj(json!({"from": s("Premier jour AAAA-MM-JJ (aujourd'hui)"), "days": n("1 à 14 (3)"), "minMinutes": n("Durée minimale (30)")}), &[]) },
    Spec { name: "get_rhythm", label: "Lecture du rythme", risk: Risk::Read, description: "Le rythme de travail choisi : mode, horaires, jours, plafond quotidien, longueur des sessions, pauses, temps libre gardé, marge avant rendu.", schema: none },
    Spec { name: "recall", label: "Recherche dans ma mémoire", risk: Risk::Read, description: "Cherche dans la mémoire durable (préférences, décisions, difficultés, prochaines étapes, rapports). À utiliser avant de redemander une information à l'utilisateur.", schema: || obj(json!({"query": s("Mots-clés"), "project": s("Clé de projet pour limiter la recherche")}), &["query"]) },
    Spec { name: "remember", label: "Mémorisation", risk: Risk::Reversible, description: "Garde un fait utile pour les prochaines conversations (une phrase courte, jamais de secret). Types : preference, goal, constraint, decision, difficulty, next_step (expire après 14 jours), fact, test_report. Si un souvenir proche existe, l'outil le renvoie : mets-le à jour avec update_memory plutôt que d'en créer un autre.", schema: || obj(json!({"kind": s("Type"), "content": s("Le fait, en une phrase"), "project": s("Clé du projet concerné (sinon global)"), "pinned": b("Toujours présent dans le contexte"), "force": b("Créer même si un souvenir proche existe")}), &["kind", "content"]) },
    Spec { name: "update_memory", label: "Mise à jour d'un souvenir", risk: Risk::Reversible, description: "Corrige ou complète un souvenir existant (son numéro est donné par recall ou le contexte).", schema: || obj(json!({"id": n("Numéro du souvenir"), "content": s("Nouveau texte"), "pinned": b("Épinglé")}), &["id"]) },
    Spec { name: "forget", label: "Oubli d'un souvenir", risk: Risk::Reversible, description: "Supprime un souvenir devenu faux ou inutile.", schema: || obj(json!({"id": n("Numéro du souvenir")}), &["id"]) },
    Spec { name: "create_task", label: "Création d'une tâche", risk: Risk::Reversible, description: "Ajoute une tâche (avec sous-tâches éventuelles) à un projet ou à l'inbox.", schema: || obj(json!({"title": s("Titre court"), "project": s("Clé du projet"), "estimateMin": n("Estimation en minutes"), "priority": n("0 aucune, 1 basse, 2 moyenne, 3 haute"), "dueDay": s("Échéance AAAA-MM-JJ"), "notes": s("Détails"), "subtasks": {"type": "array", "items": {"type": "string"}, "description": "Titres des sous-tâches"}}), &["title"]) },
    Spec { name: "update_task", label: "Mise à jour d'une tâche", risk: Risk::Reversible, description: "Modifie une tâche : titre, fait/pas fait, estimation, priorité, échéance.", schema: || obj(json!({"id": n("Numéro de la tâche"), "title": s("Titre"), "done": b("Terminée"), "estimateMin": n("Minutes"), "priority": n("0–3"), "dueDay": s("AAAA-MM-JJ")}), &["id"]) },
    Spec { name: "set_project_plan", label: "Réglage d'un projet", risk: Risk::Reversible, description: "Fixe l'estimation du travail restant (minutes) et/ou la priorité (0–3) d'un projet.", schema: || obj(json!({"project": s("Clé du projet"), "estimateMin": n("Travail restant en minutes"), "priority": n("0–3")}), &["project"]) },
    Spec { name: "create_event", label: "Ajout au calendrier", risk: Risk::Reversible, description: "Ajoute UNE entrée au calendrier : session (travail sur un projet), event (personnel), block (créneau indisponible), reminder. Une session est vérifiée (horaires, pauses, plafond) : en cas de problème rien n'est créé et l'outil dit pourquoi. Pour plusieurs entrées, utilise propose_schedule.", schema: || obj(json!({"kind": s("session | event | block | reminder"), "title": s("Titre"), "start": s(TIME), "end": s(TIME), "project": s("Clé du projet (sessions)"), "taskId": n("Tâche liée"), "notes": s("Notes")}), &["kind", "title", "start", "end"]) },
    Spec { name: "move_event", label: "Déplacement d'une entrée", risk: Risk::Reversible, description: "Déplace ou redimensionne UNE entrée du calendrier (id donné par get_calendar). Vérifiée comme create_event.", schema: || obj(json!({"id": n("Id de l'entrée"), "start": s(TIME), "end": s(TIME)}), &["id", "start", "end"]) },
    Spec { name: "delete_event", label: "Suppression proposée", risk: Risk::Approval, description: "Propose de supprimer une entrée du calendrier. Rien n'est supprimé avant l'accord de l'utilisateur.", schema: || obj(json!({"id": n("Id de l'entrée"), "reason": s("Pourquoi")}), &["id"]) },
    Spec { name: "propose_schedule", label: "Proposition de planning", risk: Risk::Approval, description: "Propose un ensemble de changements (créer des sessions, déplacer, supprimer, créer des tâches, estimations, priorités). Le plan est vérifié par le moteur de planning : s'il y a des erreurs (chevauchement, pause manquante, plafond dépassé, hors horaires), rien n'est proposé et l'outil renvoie la liste à corriger. Sinon l'utilisateur voit une carte et décide. Actions : {type:create_session, project?, title, start, end, taskId?}, {type:move_event, id, start, end}, {type:delete_event, id}, {type:create_task, project?, title, estimateMin?, priority?, dueDay?, subtasks?}, {type:set_priority, project, priority}, {type:set_estimate, project, estimateMin}.", schema: || obj(json!({"title": s("Titre court de la proposition"), "rationale": s("Pourquoi ce plan, en 1 à 3 phrases"), "actions": {"type": "array", "items": {"type": "object"}, "description": "Changements"}}), &["title", "actions"]) },
    Spec { name: "start_focus", label: "Démarrage d'une session", risk: Risk::Reversible, description: "Démarre une session de concentration chronométrée (une seule à la fois). Durées usuelles : 25, 45, 50, 90 min. Une session mixte enchaîne ensuite sur autre chose (thenTitle, thenMinutes). La session s'arrête d'elle-même si personne ne répond après la fin prévue.", schema: || obj(json!({"title": s("Ce sur quoi on travaille"), "project": s("Clé du projet"), "minutes": n("Durée prévue, 5 à 240"), "taskId": n("Tâche liée"), "eventId": n("Entrée du calendrier liée"), "thenTitle": s("Activité suivante (session mixte)"), "thenMinutes": n("Durée de l'activité suivante")}), &["title", "minutes"]) },
    Spec { name: "extend_focus", label: "Prolongation de la session", risk: Risk::Read, description: "Ajoute du temps à la session en cours.", schema: || obj(json!({"minutes": n("Minutes à ajouter, 5 à 120")}), &["minutes"]) },
    Spec { name: "stop_focus", label: "Fin de la session", risk: Risk::Read, description: "Termine la session en cours ; done=true marque aussi sa tâche et son entrée du calendrier comme faites.", schema: || obj(json!({"done": b("Travail terminé")}), &[]) },
    Spec { name: "suggest_plan", label: "Calcul d'un planning", risk: Risk::Approval, description: "Calcule avec le moteur de TekBoard un planning réaliste (pauses, plafond, temps libre, marge et bloc de tests avant chaque rendu) à partir des estimations des projets, et le propose à l'utilisateur. scope : day, week, two_weeks, reorganize (replacer les sessions passées non faites). Plus fiable que de placer les sessions toi-même : utilise-le, puis ajuste avec propose_schedule si besoin.", schema: || obj(json!({"scope": s("day | week | two_weeks | reorganize"), "project": s("Limiter à un projet (clé)")}), &["scope"]) },
    Spec { name: "start_moulinette", label: "Lancement de la moulinette", risk: Risk::Read, description: "Lance la moulinette de Tika (agent évaluateur dans un bac à sable, sur une copie du projet ; quelques minutes). Renvoie l'id de la tâche : attends-la avec wait_job puis explique les problèmes à partir du rapport.", schema: || obj(json!({"project": s("Clé du projet (dépôt local)")}), &["project"]) },
    Spec { name: "generate_tests", label: "Génération de tests", risk: Risk::Read, description: "Lance la génération de tests unitaires sur une copie du projet (rien n'est écrit dans le projet : l'utilisateur valide le diff). Renvoie l'id de la tâche, à attendre avec wait_job.", schema: || obj(json!({"project": s("Clé du projet (dépôt local)")}), &["project"]) },
    Spec { name: "wait_job", label: "Attente d'une tâche", risk: Risk::Read, description: "Attend qu'une tâche (moulinette, tests) se termine, au plus 240 s, et renvoie son résultat : vérifications, verdict, rapport. Rappelle-le si elle tourne encore.", schema: || obj(json!({"id": n("Id de la tâche"), "seconds": n("Attente maximale, 10 à 240")}), &["id"]) },
    Spec { name: "analyze_subject", label: "Lecture du sujet", risk: Risk::Read, description: "Lit le sujet PDF lié à un projet une fois pour toutes et en garde un résumé structuré (exigences, binaire, fonctions autorisées, fonctionnalités estimées, idées de tests). À faire avant de décomposer un projet dont le sujet n'a pas de résumé. Renvoie un id de tâche à attendre avec wait_job.", schema: || obj(json!({"project": s("Clé du projet")}), &["project"]) },
    Spec { name: "sync_my_epitech", label: "Synchronisation MY Epitech", risk: Risk::Read, description: "Relit MY Epitech (projets, rendus, agenda) et télécharge les nouveaux sujets PDF des projets en cours, rattachés aux dépôts correspondants. Nécessite une session MY Epitech ouverte.", schema: none },
    Spec { name: "navigate", label: "Navigation", risk: Risk::Read, description: "Ouvre un écran de TekBoard pour l'utilisateur : today, projects, planning, school, stats, resources, settings ; avec un projet, ouvre sa page (onglet : overview, plan, checks, git, libraries, notes).", schema: || obj(json!({"page": s("Écran"), "project": s("Clé du projet"), "tab": s("Onglet de la page projet")}), &["page"]) },
    Spec { name: "list_runs", label: "Historique des vérifications", risk: Risk::Read, description: "Dernières exécutions (tests, Banana, TestRepo, moulinette, analyses) avec leur statut et leur résumé.", schema: || obj(json!({"project": s("Clé du projet"), "kind": s("Type d'exécution"), "limit": n("1 à 20")}), &[]) },
    Spec { name: "get_report", label: "Lecture d'un rapport", risk: Risk::Read, description: "Le rapport complet d'une exécution (id donné par list_runs), avec la fin de son journal.", schema: || obj(json!({"id": n("Id de l'exécution")}), &["id"]) },
    Spec { name: "list_libraries", label: "Liste des bibliothèques", risk: Risk::Read, description: "Les bibliothèques enregistrées dans TekBoard et leur dossier.", schema: none },
    Spec { name: "my_epitech_status", label: "État de MY Epitech", risk: Risk::Read, description: "Si MY Epitech est connecté, la dernière synchronisation, et ce qui manque pour récupérer les sujets.", schema: none },
];

pub fn spec(name: &str) -> Option<&'static Spec> {
    SPECS.iter().find(|s| s.name == name)
}

/// French label of a TekBoard tool, for the activity feed.
pub fn label(tool: &str) -> Option<String> {
    spec(tool).map(|s| s.label.to_string()).or_else(|| super::agent_tools::label(tool))
}

/// Tools of the conversation with Tika.
pub fn chat_tools() -> Vec<&'static str> {
    SPECS.iter().map(|s| s.name).collect()
}

/// The MCP description of the tools this caller may use.
pub fn list_for(c: &Caller) -> Vec<Value> {
    let mut out: Vec<Value> = SPECS.iter().filter(|s| c.allowed.contains(&s.name)).map(|s| json!({"name": s.name, "description": s.description, "inputSchema": (s.schema)()})).collect();
    out.extend(super::agent_tools::list_for(c));
    out
}

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

fn arg<'a>(a: &'a Value, k: &str) -> Option<&'a str> {
    a.get(k).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty())
}
fn arg_i(a: &Value, k: &str) -> Option<i64> {
    a.get(k).and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.trim().parse().ok())))
}
fn need<'a>(a: &'a Value, k: &str) -> Result<&'a str> {
    arg(a, k).ok_or_else(|| AppError::new("invalid_args", format!("Paramètre manquant : {k}")))
}
fn need_i(a: &Value, k: &str) -> Result<i64> {
    arg_i(a, k).ok_or_else(|| AppError::new("invalid_args", format!("Paramètre manquant ou non numérique : {k}")))
}

/// Runs a tool for `caller`. Reversible tools are journaled; the returned value says what
/// really happened.
pub fn call(state: &AppState, caller: &Caller, name: &str, args: &Value) -> Result<Value> {
    if !caller.allowed.contains(&name) {
        return Err(AppError::new("tool_refused", format!("L'outil {name} n'est pas disponible ici.")));
    }
    if super::agent_tools::handles(name) {
        return super::agent_tools::call(state, caller, name, args);
    }
    let spec = spec(name).ok_or_else(|| AppError::new("tool_unknown", format!("Outil inconnu : {name}")))?;
    let out = run(state, caller, name, args)?;
    if spec.risk == Risk::Reversible {
        if let Some(undo) = out.undo {
            let conn = state.conn();
            conn.execute(
                "INSERT INTO ai_actions (thread_id, tool, summary, args, result, undo, status, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'done', ?7)",
                params![caller.thread_id, name, out.summary, args.to_string(), out.value.to_string(), undo.to_string(), now()],
            )?;
            let id = conn.last_insert_rowid();
            drop(conn);
            crate::notify::changed(&["ai"]);
            crate::notify::emit("ai-action", json!({"id": id, "tool": name, "summary": out.summary, "threadId": caller.thread_id}));
            let mut v = out.value;
            if let Value::Object(m) = &mut v {
                m.insert("actionId".into(), json!(id));
            }
            return Ok(v);
        }
    }
    Ok(out.value)
}

struct Out {
    value: Value,
    summary: String,
    undo: Option<Value>,
}

fn read(value: Value) -> Result<Out> {
    Ok(Out { value, summary: String::new(), undo: None })
}

/// Everything the planning tools need, read once.
struct World {
    board: Vec<crate::projects::BoardItem>,
    repos: Vec<crate::scanner::RepoInfo>,
    plan: crate::planner::State,
    agenda: crate::mydata::Agenda,
    rhythm: Rhythm,
    busy: Vec<Busy>,
}

fn world(state: &AppState) -> Result<World> {
    let (repos, overview) = crate::commands::load_repos(state)?;
    let board = crate::projects::board(&repos, &overview, chrono::Utc::now());
    let conn = state.conn();
    let agenda = crate::mydata::agenda(&conn, &overview, &board);
    let plan = crate::planner::state(&conn, now())?;
    let rhythm = Rhythm::load(&conn);
    let busy = schedule::busy_from(&plan.events, &agenda.items);
    Ok(World { board, repos, plan, agenda, rhythm, busy })
}

fn day_arg(a: &Value) -> Result<i64> {
    match arg(a, "from") {
        Some(d) => {
            let date = chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").map_err(|_| AppError::new("invalid_args", format!("« {d} » n'est pas une date AAAA-MM-JJ")))?;
            Ok(crate::planner::parse_local(&format!("{date}T00:00"))?)
        }
        None => Ok(schedule::day_of(now())),
    }
}

fn project_title(w: &World, key: &str) -> String {
    w.board.iter().find(|b| b.repo_path.as_deref() == Some(key) || b.my_id.map(|i| format!("my:{i}")).as_deref() == Some(key)).map(|b| b.title.clone()).or_else(|| w.repos.iter().find(|r| r.path == key).map(|r| r.name.clone())).unwrap_or_else(|| key.rsplit('/').next().unwrap_or(key).to_string())
}

fn calendar_items(w: &World, from: i64, to: i64) -> Vec<Value> {
    let mut items: Vec<(i64, Value)> = Vec::new();
    for e in &w.plan.events {
        if e.end > from && e.start < to {
            items.push((e.start, json!({"id": e.id, "kind": e.kind, "title": e.title, "start": schedule::local_iso(e.start), "end": schedule::local_iso(e.end), "allDay": e.all_day, "project": e.project, "done": e.done, "origin": e.origin})));
        }
    }
    for a in &w.agenda.items {
        let start = a.start.as_deref().and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()).map(|d| d.timestamp());
        let day = crate::planner::parse_local(&format!("{}T00:00", a.day)).unwrap_or(0);
        let t = start.unwrap_or(day);
        if t >= from && t < to && (a.mine || a.kind == "deadline" || a.kind == "holiday" || a.kind == "start") {
            items.push((t, json!({"kind": format!("école:{}", a.kind), "title": a.title, "start": start.map(schedule::local_iso).unwrap_or_else(|| a.day.clone()), "end": a.end.as_deref().and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()).map(|d| schedule::local_iso(d.timestamp())), "module": a.module, "project": a.repo_path, "registered": a.status.as_deref() != Some("not_registered"), "exam": a.exam})));
        }
    }
    items.sort_by_key(|(t, _)| *t);
    items.into_iter().map(|(_, v)| v).collect()
}

fn rhythm_json(r: &Rhythm) -> Value {
    json!({"mode": schedule::mode_label(&r.mode), "horaires": format!("{:02}:{:02}–{:02}:{:02}", r.day_start / 60, r.day_start % 60, r.day_end / 60, r.day_end % 60), "joursTravailles": r.work_days, "plafondParJour": schedule::dur(r.max_minutes_per_day), "session": schedule::dur(r.session_minutes), "pause": schedule::dur(r.break_minutes), "pauseLongue": format!("{} après {} blocs", schedule::dur(r.long_break_minutes), r.blocks_before_long_break), "tempsLibreGarde": schedule::dur(r.flex_minutes), "pausesProtegees": r.protected.iter().map(|[a, b]| format!("{:02}:{:02}–{:02}:{:02}", a / 60, a % 60, b / 60, b % 60)).collect::<Vec<_>>(), "margeAvantRendu": format!("{} jour(s)", r.buffer_days)})
}

fn planned_minutes(w: &World, key: &str, from: i64) -> i64 {
    w.plan.events.iter().filter(|e| (e.kind == "session" || e.kind == "task") && e.project.as_deref() == Some(key) && !e.done && e.end > from).map(|e| (e.end - e.start.max(from)) / 60).sum()
}

fn run(state: &AppState, caller: &Caller, name: &str, a: &Value) -> Result<Out> {
    match name {
        "get_today" => {
            let w = world(state)?;
            let t = now();
            let day = schedule::day_of(t);
            let soon: Vec<Value> = w.board.iter().filter(|b| b.state != "unknown" && b.status != "done").take(8).map(|b| json!({"projet": b.title, "cle": b.repo_path.clone().or(b.my_id.map(|i| format!("my:{i}"))), "rendu": b.at.clone().or(b.day.clone()), "etat": b.state, "module": b.module, "clone": b.cloned})).collect();
            read(json!({
                "maintenant": schedule::local_iso(t),
                "jour": schedule::day_label(day),
                "aujourdhui": calendar_items(&w, day, schedule::next_day(day)),
                "charge": schedule::day_load(&w.busy, &w.rhythm, day),
                "rendusProches": soon,
                "rythme": rhythm_json(&w.rhythm),
                "sessionEnCours": crate::focus::current_json(&state.conn()),
                "evaluationsEnAttente": w.agenda.peer_todo,
            }))
        }
        "list_projects" => {
            let w = world(state)?;
            let all = a.get("all").and_then(Value::as_bool).unwrap_or(false);
            let t = now();
            let mut out = Vec::new();
            for bi in &w.board {
                if !all && bi.status == "done" {
                    continue;
                }
                let key = bi.repo_path.clone().or(bi.my_id.map(|i| format!("my:{i}")));
                let pp = key.as_ref().and_then(|k| w.plan.projects.iter().find(|p| &p.key == k));
                out.push(json!({"cle": key, "nom": bi.title, "module": bi.module, "statut": bi.status, "rendu": bi.at.clone().or(bi.day.clone()), "etatRendu": bi.state, "clone": bi.cloned, "travailRestantMin": pp.and_then(|p| p.estimate_min), "planifieMin": key.as_ref().map(|k| planned_minutes(&w, k, t)), "priorite": pp.map(|p| p.priority).unwrap_or(0)}));
            }
            for r in &w.repos {
                if out.iter().any(|o| o["cle"].as_str() == Some(r.path.as_str())) || (!all && r.progress == "done") {
                    continue;
                }
                let pp = w.plan.projects.iter().find(|p| p.key == r.path);
                out.push(json!({"cle": r.path, "nom": r.name, "type": r.kind, "statut": r.progress, "dernierCommit": r.last_commit.as_ref().map(|c| c.date.clone()), "travailRestantMin": pp.and_then(|p| p.estimate_min), "planifieMin": planned_minutes(&w, &r.path, t), "priorite": pp.map(|p| p.priority).unwrap_or(0)}));
            }
            read(json!({"projets": out}))
        }
        "get_project" => {
            let key = need(a, "project")?.to_string();
            let w = world(state)?;
            let repo = w.repos.iter().find(|r| r.path == key);
            let bi = w.board.iter().find(|b| b.repo_path.as_deref() == Some(&key) || b.my_id.map(|i| format!("my:{i}")).as_deref() == Some(&key));
            if repo.is_none() && bi.is_none() {
                return Err(AppError::new("not_found", format!("Aucun projet « {key} » : utilise une clé donnée par list_projects.")));
            }
            let conn = state.conn();
            let tasks: Vec<Value> = w.plan.tasks.iter().filter(|t| t.project.as_deref() == Some(&key)).map(|t| json!({"id": t.id, "titre": t.title, "fait": t.done_at.is_some(), "estimationMin": t.estimate_min, "priorite": t.priority, "echeance": t.due_day, "parent": t.parent_id})).collect();
            let brief: Option<Value> = conn.query_row("SELECT brief, stale, updated_at FROM project_briefs WHERE project = ?1", [&key], |r| Ok(json!({"resume": serde_json::from_str::<Value>(&r.get::<_, String>(0)?).unwrap_or(Value::Null), "perime": r.get::<_, i64>(1)? != 0, "misAJour": r.get::<_, i64>(2)?}))).ok();
            let mems: Vec<Value> = memory::list(&conn, Some(&memory::project_scope(&key)), false, now())?.into_iter().take(20).map(|m| json!({"id": m.id, "type": m.kind, "texte": m.content})).collect();
            let runs: Vec<Value> = crate::db::list_runs(&conn, Some(&key), None, 6)?.into_iter().map(|r| json!({"id": r.id, "type": r.kind, "statut": r.status, "titre": r.title, "date": r.started_at, "resume": crate::ai::stream::clip(&summary_text(&r.summary), 300)})).collect();
            let pp = w.plan.projects.iter().find(|p| p.key == key);
            read(json!({
                "cle": key,
                "nom": bi.map(|b| b.title.clone()).or(repo.map(|r| r.name.clone())),
                "module": bi.and_then(|b| b.module.clone()),
                "rendu": bi.and_then(|b| b.at.clone().or(b.day.clone())),
                "statut": bi.map(|b| b.status.clone()).or(repo.map(|r| r.progress.clone())),
                "git": repo.map(|r| json!({"branche": r.status.as_ref().and_then(|s| s.branch.clone()), "fichiersModifies": r.status.as_ref().map(|s| s.staged + s.unstaged + s.untracked), "enAvance": r.status.as_ref().map(|s| s.ahead), "enRetard": r.status.as_ref().map(|s| s.behind), "dernierCommit": r.last_commit.as_ref().map(|c| format!("{} — {}", c.date, c.subject))})),
                "travailRestantMin": pp.and_then(|p| p.estimate_min),
                "planifieMin": planned_minutes(&w, &key, now()),
                "taches": tasks,
                "sujet": brief,
                "souvenirs": mems,
                "dernieresVerifications": runs,
            }))
        }
        "get_calendar" => {
            let w = world(state)?;
            let from = day_arg(a)?;
            let days = arg_i(a, "days").unwrap_or(7).clamp(1, 14);
            let mut out = Vec::new();
            let mut d = from;
            for _ in 0..days {
                let next = schedule::next_day(d);
                out.push(json!({"jour": schedule::day_label(d), "date": schedule::local_iso(d)[..10].to_string(), "charge": schedule::day_load(&w.busy, &w.rhythm, d), "entrees": calendar_items(&w, d, next)}));
                d = next;
            }
            read(json!({"jours": out, "rythme": rhythm_json(&w.rhythm)}))
        }
        "find_free_time" => {
            let w = world(state)?;
            let t = now();
            let from = day_arg(a)?.max(t);
            let days = arg_i(a, "days").unwrap_or(3).clamp(1, 14);
            let mut to = schedule::day_of(from);
            for _ in 0..days {
                to = schedule::next_day(to);
            }
            let min = arg_i(a, "minMinutes").unwrap_or(30).clamp(15, 480);
            let slots: Vec<Value> = schedule::free_slots(&w.busy, &w.rhythm, from, to, min).iter().map(|s| json!({"jour": schedule::day_label(schedule::day_of(s.start)), "debut": schedule::local_iso(s.start), "fin": schedule::local_iso(s.end), "duree": schedule::dur((s.end - s.start) / 60)})).collect();
            let mut caps = Vec::new();
            let mut d = schedule::day_of(from);
            while d < to {
                let l = schedule::day_load(&w.busy, &w.rhythm, d);
                caps.push(json!({"jour": l.label, "travailPlanifie": schedule::dur(l.work_min), "ecole": schedule::dur(l.school_min), "resteSousLePlafond": schedule::dur((l.max_min - l.work_min - l.school_min / 2).max(0)), "jourTravaille": l.working_day}));
                d = schedule::next_day(d);
            }
            read(json!({"creneaux": slots, "parJour": caps, "rappel": "Ne remplis pas tout : garde le temps libre prévu par le rythme et des pauses entre les blocs."}))
        }
        "get_rhythm" => read(rhythm_json(&Rhythm::load(&state.conn()))),
        "recall" => {
            let q = need(a, "query")?;
            let scope = arg(a, "project").map(memory::project_scope);
            let found = memory::search(&state.conn(), q, scope.as_deref(), 8, now())?;
            read(json!({"souvenirs": found.iter().map(|m| json!({"id": m.id, "type": m.kind, "portee": m.scope, "texte": m.content, "maj": m.updated_at})).collect::<Vec<_>>()}))
        }
        "remember" => {
            let scope = arg(a, "project").map(memory::project_scope).unwrap_or_else(|| "global".into());
            let added = memory::add(&state.conn(), &scope, need(a, "kind")?, need(a, "content")?, "assistant", a.get("pinned").and_then(Value::as_bool).unwrap_or(false), a.get("force").and_then(Value::as_bool).unwrap_or(false), now())?;
            crate::notify::changed(&["memory"]);
            match added {
                memory::Added::Saved { memory: m } => Ok(Out { summary: format!("Souvenir gardé : {}", crate::ai::stream::clip(&m.content, 80)), undo: Some(json!({"op": "delete_memory", "id": m.id})), value: json!({"status": "saved", "id": m.id}) }),
                memory::Added::Similar { similar } => Ok(Out { summary: String::new(), undo: None, value: json!({"status": "similar_exists", "message": "Un souvenir proche existe : mets-le à jour (update_memory) ou recommence avec force=true s'il s'agit d'autre chose.", "similaires": similar.iter().map(|m| json!({"id": m.id, "texte": m.content})).collect::<Vec<_>>()}) }),
            }
        }
        "update_memory" => {
            let id = need_i(a, "id")?;
            let conn = state.conn();
            let before = memory::get(&conn, id)?.ok_or_else(|| AppError::new("not_found", format!("Aucun souvenir n°{id}")))?;
            let m = memory::update(&conn, id, &memory::Patch { content: arg(a, "content").map(str::to_string), pinned: a.get("pinned").and_then(Value::as_bool), ..Default::default() }, now())?;
            crate::notify::changed(&["memory"]);
            Ok(Out { summary: format!("Souvenir mis à jour : {}", crate::ai::stream::clip(&m.content, 80)), undo: Some(json!({"op": "restore_memory", "memory": before})), value: json!({"status": "updated", "id": id}) })
        }
        "forget" => {
            let id = need_i(a, "id")?;
            let m = memory::delete(&state.conn(), id)?.ok_or_else(|| AppError::new("not_found", format!("Aucun souvenir n°{id}")))?;
            crate::notify::changed(&["memory"]);
            Ok(Out { summary: format!("Souvenir oublié : {}", crate::ai::stream::clip(&m.content, 80)), undo: Some(json!({"op": "restore_memory", "memory": m})), value: json!({"status": "deleted", "id": id}) })
        }
        "create_task" => {
            let conn = state.conn();
            let t = now();
            let task = crate::planner::save_task(&conn, &crate::planner::Task { title: need(a, "title")?.into(), project: arg(a, "project").map(str::to_string), estimate_min: arg_i(a, "estimateMin"), priority: arg_i(a, "priority").unwrap_or(0).clamp(0, 3), due_day: arg(a, "dueDay").map(str::to_string), notes: arg(a, "notes").unwrap_or_default().into(), kind: "task".into(), ..Default::default() }, t)?;
            let mut subs = Vec::new();
            for st in a.get("subtasks").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str).take(30) {
                subs.push(crate::planner::save_task(&conn, &crate::planner::Task { title: st.into(), project: task.project.clone(), parent_id: Some(task.id), kind: "task".into(), ..Default::default() }, t)?.id);
            }
            drop(conn);
            crate::notify::changed(&["plan"]);
            Ok(Out { summary: format!("Tâche créée : {}{}", task.title, if subs.is_empty() { String::new() } else { format!(" (+{} sous-tâches)", subs.len()) }), undo: Some(json!({"op": "delete_task", "id": task.id})), value: json!({"status": "created", "id": task.id, "subtasks": subs}) })
        }
        "update_task" => {
            let id = need_i(a, "id")?;
            let conn = state.conn();
            let before = crate::planner::get_task(&conn, id)?;
            let mut t = before.clone();
            if let Some(x) = arg(a, "title") {
                t.title = x.into();
            }
            if let Some(d) = a.get("done").and_then(Value::as_bool) {
                t.done_at = d.then_some(now());
            }
            if let Some(x) = arg_i(a, "estimateMin") {
                t.estimate_min = Some(x);
            }
            if let Some(x) = arg_i(a, "priority") {
                t.priority = x.clamp(0, 3);
            }
            if let Some(x) = arg(a, "dueDay") {
                t.due_day = Some(x.into());
            }
            let saved = crate::planner::save_task(&conn, &t, now())?;
            drop(conn);
            crate::notify::changed(&["plan", "insights"]);
            Ok(Out { summary: format!("Tâche mise à jour : {}", saved.title), undo: Some(json!({"op": "restore_task", "task": before})), value: json!({"status": "updated", "id": id}) })
        }
        "set_project_plan" => {
            let key = need(a, "project")?;
            let conn = state.conn();
            let before = crate::planner::state(&conn, now())?.projects.into_iter().find(|p| p.key == key);
            let est = arg_i(a, "estimateMin").map(|m| Some(m.clamp(0, 2000 * 60)));
            let p = crate::planner::set_project(&conn, key, arg_i(a, "priority").map(|x| x.clamp(0, 3)), est, None)?;
            drop(conn);
            crate::notify::changed(&["plan"]);
            Ok(Out { summary: format!("Projet réglé : {}{}", p.estimate_min.map(|m| format!("reste {} ", schedule::dur(m))).unwrap_or_default(), if p.priority > 0 { format!("priorité {}", p.priority) } else { String::new() }), undo: Some(json!({"op": "restore_project", "key": key, "priority": before.as_ref().map(|b| b.priority).unwrap_or(0), "estimateMin": before.and_then(|b| b.estimate_min)})), value: json!({"status": "updated", "projet": p}) })
        }
        "create_event" | "move_event" => {
            let w = world(state)?;
            let t = now();
            let (start, end) = (crate::planner::parse_local(need(a, "start")?)?, crate::planner::parse_local(need(a, "end")?)?);
            let (event, before) = if name == "move_event" {
                let id = need_i(a, "id")?;
                let ev = crate::planner::get_event(&state.conn(), id)?;
                (crate::planner::PlanEvent { start, end, ..ev.clone() }, Some(ev))
            } else {
                let kind = need(a, "kind")?;
                if !crate::planner::EVENT_KINDS.contains(&kind) {
                    return Err(AppError::new("invalid_args", "kind : session, event, block ou reminder"));
                }
                (crate::planner::PlanEvent { id: 0, kind: kind.into(), title: need(a, "title")?.into(), start, end, project: arg(a, "project").map(str::to_string), task_id: arg_i(a, "taskId"), notes: arg(a, "notes").unwrap_or_default().into(), origin: "claude".into(), ..Default::default() }, None)
            };
            let work = event.kind == "session" || event.kind == "task";
            let v = schedule::validate(&[Placement { index: 0, event_id: before.as_ref().map(|e| e.id), start, end, work, title: event.title.clone() }], &w.busy, &w.rhythm, t);
            let errors: Vec<&str> = v.iter().filter(|x| x.severity == "error").map(|x| x.message.as_str()).collect();
            if !errors.is_empty() {
                return read(json!({"status": "refused", "message": "Rien n'a été modifié : corrige ces points ou choisis un autre créneau (find_free_time).", "problemes": errors}));
            }
            let saved = crate::planner::save_event(&state.conn(), &event, t)?;
            crate::notify::changed(&["plan", "insights"]);
            let warnings: Vec<&str> = v.iter().filter(|x| x.severity == "warning").map(|x| x.message.as_str()).collect();
            let when = format!("{} {}–{}", schedule::day_label(schedule::day_of(start)), &schedule::local_iso(start)[11..], &schedule::local_iso(end)[11..]);
            match before {
                Some(b) => Ok(Out { summary: format!("Déplacé : {} → {when}", saved.title), undo: Some(json!({"op": "move_event", "id": b.id, "start": b.start, "end": b.end})), value: json!({"status": "moved", "id": saved.id, "avertissements": warnings}) }),
                None => Ok(Out { summary: format!("Ajouté : {} · {when}", saved.title), undo: Some(json!({"op": "delete_event", "id": saved.id})), value: json!({"status": "created", "id": saved.id, "avertissements": warnings}) }),
            }
        }
        "delete_event" => {
            let id = need_i(a, "id")?;
            let ev = crate::planner::get_event(&state.conn(), id)?;
            let actions = vec![crate::planner::Action::DeleteEvent { id }];
            let pid = propose(state, caller, "schedule", &format!("Supprimer « {} »", ev.title), arg(a, "reason").unwrap_or_default(), &json!({"actions": actions}))?;
            read(json!({"status": "proposed", "proposalId": pid, "message": "L'utilisateur voit une carte pour accepter ou refuser la suppression. Rien n'est supprimé tant qu'il n'a pas accepté."}))
        }
        "propose_schedule" => {
            let actions: Vec<crate::planner::Action> = serde_json::from_value(a.get("actions").cloned().unwrap_or(Value::Null)).map_err(|e| AppError::new("invalid_args", format!("Actions illisibles : {e}")))?;
            if actions.is_empty() {
                return Err(AppError::new("invalid_args", "Aucune action dans la proposition."));
            }
            let w = world(state)?;
            let v = check_actions(&w, &actions)?;
            let errors: Vec<Value> = v.iter().filter(|x| x.severity == "error").map(|x| json!({"action": x.index, "probleme": x.message})).collect();
            if !errors.is_empty() {
                return read(json!({"status": "rejected", "message": "Plan non proposé : il ne respecte pas le rythme de l'utilisateur. Corrige ces points puis rappelle propose_schedule.", "problemes": errors}));
            }
            let warnings: Vec<String> = v.iter().filter(|x| x.severity == "warning").map(|x| x.message.clone()).collect();
            let pid = propose(state, caller, "schedule", need(a, "title")?, arg(a, "rationale").unwrap_or_default(), &json!({"actions": actions, "warnings": warnings}))?;
            read(json!({"status": "proposed", "proposalId": pid, "avertissements": warnings, "message": "L'utilisateur voit la proposition et peut l'accepter en tout ou partie, ou la refuser. Ne dis pas qu'elle est appliquée."}))
        }
        "start_focus" => {
            let w = world(state)?;
            let mut title = need(a, "title")?.to_string();
            let project = arg(a, "project").map(str::to_string);
            if let Some(p) = &project {
                let name = project_title(&w, p);
                if !title.contains(&name) {
                    title = format!("{name} — {title}");
                }
            }
            let f = crate::focus::start(&state.conn(), &crate::focus::Start { title, project, task_id: arg_i(a, "taskId"), event_id: arg_i(a, "eventId"), minutes: need_i(a, "minutes")?, then_title: arg(a, "thenTitle").map(str::to_string), then_min: arg_i(a, "thenMinutes") }, now())?;
            crate::notify::changed(&["focus"]);
            Ok(Out { summary: format!("Session démarrée : {} ({} min)", f.title, f.planned_min), undo: Some(json!({"op": "stop_focus", "id": f.id})), value: json!({"status": "started", "id": f.id, "minutes": f.planned_min, "finPrevue": schedule::local_iso(f.started_at + f.planned_s())}) })
        }
        "extend_focus" => {
            let f = crate::focus::extend(&state.conn(), need_i(a, "minutes")?, now())?;
            crate::notify::changed(&["focus"]);
            read(json!({"status": "extended", "minutesPrevues": f.planned_min}))
        }
        "stop_focus" => {
            let f = crate::focus::stop(&state.conn(), "stopped", now(), a.get("done").and_then(Value::as_bool).unwrap_or(false))?;
            crate::notify::changed(&["focus", "plan"]);
            read(json!({"status": "stopped", "minutes": f.seconds.unwrap_or(0) / 60}))
        }
        "suggest_plan" => {
            let scope = need(a, "scope")?;
            let only = arg(a, "project");
            let (title, sug) = suggest(state, scope, only)?;
            if sug.actions.is_empty() {
                return read(json!({"status": "nothing", "message": if sug.unplaced.is_empty() { "Rien à placer : les projets estimés sont déjà planifiés, ou aucun n'a d'estimation (set_project_plan)." } else { "Aucun créneau ne convient." }, "nonPlace": sug.unplaced, "notes": sug.notes}));
            }
            let pid = propose(state, caller, "schedule", &title, &sug.notes.join(" "), &json!({"actions": sug.actions, "warnings": sug.unplaced.iter().map(|u| format!("Sans créneau : {} ({})", u.title, schedule::dur(u.minutes))).collect::<Vec<_>>(), "origin": "auto"}))?;
            read(json!({"status": "proposed", "proposalId": pid, "changements": sug.actions.len(), "nonPlace": sug.unplaced, "notes": sug.notes}))
        }
        "start_moulinette" | "generate_tests" => {
            let dir = crate::commands::repo_dir_of(state, need(a, "project")?)?;
            let id = if name == "start_moulinette" { super::agents::moulinette(state, dir.clone())? } else { super::agents::generate_tests(state, dir.clone())? };
            crate::notify::emit("ui-show-job", json!({"id": id, "repo": dir}));
            read(json!({"status": "started", "jobId": id, "message": "Tâche lancée : l'utilisateur la suit en direct dans Vérifier. Utilise wait_job pour le résultat."}))
        }
        "wait_job" => {
            let id = need_i(a, "id")? as u64;
            let secs = arg_i(a, "seconds").unwrap_or(180).clamp(10, 240);
            let t0 = std::time::Instant::now();
            loop {
                let v = state.jobs.get(id).ok_or_else(|| AppError::new("not_found", "Tâche inconnue (terminée depuis longtemps ? utilise list_runs)."))?;
                if v.status != "running" || t0.elapsed().as_secs() as i64 >= secs {
                    let checks: Vec<Value> = v.events.iter().filter(|e| e["kind"] == "check").map(|e| json!({"titre": e["title"], "statut": e["status"], "preuve": crate::ai::stream::clip(e["evidence"].as_str().unwrap_or(""), 300), "piste": e["fix"]})).collect();
                    return read(json!({"statut": v.status, "etapes": v.steps.iter().map(|s| json!({"etape": s.label, "statut": s.status, "detail": s.detail})).collect::<Vec<_>>(), "verifications": checks, "verdict": v.summary.get("verdict"), "rapport": v.summary.get("report").and_then(Value::as_str).map(|r| crate::ai::stream::clip(r, 5000)), "fichiersEcrits": v.summary.get("changes").and_then(Value::as_array).map(|c| c.iter().map(|x| x["path"].clone()).collect::<Vec<_>>()), "erreur": v.summary.get("error")}));
                }
                std::thread::sleep(std::time::Duration::from_secs(2));
            }
        }
        "analyze_subject" => {
            let p = need(a, "project")?;
            let id = super::subject::subject_of(state, p)?.ok_or_else(|| AppError::new("not_found", "Aucun sujet n'est lié à ce projet : importe-le (École → Sujets ou sync_my_epitech) ou lie-le."))?;
            let job = super::subject::analyze(state, id)?;
            read(json!({"status": "started", "jobId": job}))
        }
        "sync_my_epitech" => {
            let r = crate::commands_my::sync_now(state)?;
            read(json!({"routesLues": r.ok, "echecs": r.failed, "refuse": r.unauthorized, "sujetsImportes": r.subjects_imported, "detail": r.detail}))
        }
        "navigate" => {
            let page = need(a, "page")?;
            if !["today", "projects", "planning", "school", "stats", "resources", "settings"].contains(&page) {
                return Err(AppError::new("invalid_args", "Écran inconnu."));
            }
            crate::notify::emit("ui-navigate", json!({"page": page, "project": arg(a, "project"), "tab": arg(a, "tab")}));
            read(json!({"status": "opened", "page": page}))
        }
        "list_runs" => {
            let limit = arg_i(a, "limit").unwrap_or(8).clamp(1, 20) as u32;
            let runs = crate::db::list_runs(&state.conn(), arg(a, "project"), arg(a, "kind"), limit)?;
            read(json!({"executions": runs.iter().map(|r| json!({"id": r.id, "type": r.kind, "projet": r.repo_path, "statut": r.status, "titre": r.title, "date": schedule::local_iso(r.started_at), "dureeMs": r.duration_ms, "resume": crate::ai::stream::clip(&summary_text(&r.summary), 240)})).collect::<Vec<_>>()}))
        }
        "get_report" => {
            let r = crate::db::get_run(&state.conn(), need_i(a, "id")?)?.ok_or_else(|| AppError::new("not_found", "Exécution introuvable"))?;
            let log = r.log.unwrap_or_default();
            let tail: String = log.chars().rev().take(4000).collect::<Vec<_>>().into_iter().rev().collect();
            read(json!({"id": r.id, "type": r.kind, "statut": r.status, "titre": r.title, "date": schedule::local_iso(r.started_at), "resume": r.summary, "finDuJournal": tail}))
        }
        "list_libraries" => {
            let conn = state.conn();
            let mut st = conn.prepare("SELECT id, name, path FROM libraries ORDER BY name")?;
            let libs: Vec<Value> = st.query_map([], |r| Ok(json!({"id": r.get::<_, i64>(0)?, "nom": r.get::<_, String>(1)?, "dossier": r.get::<_, String>(2)?})))?.collect::<std::result::Result<_, _>>()?;
            read(json!({"bibliotheques": libs}))
        }
        "my_epitech_status" => {
            let connected = state.my.lock().unwrap_or_else(|e| e.into_inner()).token.is_some();
            let last: Option<(i64, i64, i64)> = state.conn().query_row("SELECT at, ok, failed FROM my_sync_log ORDER BY at DESC LIMIT 1", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).ok();
            read(json!({"connecte": connected, "derniereSynchro": last.map(|(at, ok, failed)| json!({"date": schedule::local_iso(at), "routesLues": ok, "echecs": failed})), "conseil": if connected { "La synchronisation récupère aussi les sujets PDF des projets en cours." } else { "Pour récupérer sujets et rendus : École → MY Epitech → Se connecter (une fenêtre du vrai site s'ouvre)." }}))
        }
        other => Err(AppError::new("tool_unknown", format!("Outil inconnu : {other}"))),
    }
}

fn summary_text(v: &Value) -> String {
    for k in ["verdict", "headline", "report", "reply", "error"] {
        if let Some(s) = v.get(k).and_then(Value::as_str) {
            return s.to_string();
        }
    }
    let steps: Vec<String> = v.get("steps").and_then(Value::as_array).into_iter().flatten().map(|s| format!("{} : {}", s["label"].as_str().unwrap_or(""), s["status"].as_str().unwrap_or(""))).collect();
    steps.join(" · ")
}

/// Hand-in instant of a board item.
fn due_of(b: &crate::projects::BoardItem) -> Option<i64> {
    b.at.as_deref().and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok()).map(|d| d.timestamp()).or_else(|| b.day.as_deref().and_then(|d| crate::planner::parse_local(&format!("{d}T23:59")).ok()))
}

/// A plan computed by the engine for `scope` (`day`, `week`, `two_weeks`, `reorganize`).
pub fn suggest(state: &AppState, scope: &str, only: Option<&str>) -> Result<(String, schedule::Suggestion)> {
    let w = world(state)?;
    let t = now();
    let due_by_key = |k: &str| w.board.iter().find(|b| b.repo_path.as_deref() == Some(k) || b.my_id.map(|i| format!("my:{i}")).as_deref() == Some(k)).and_then(due_of);
    if scope == "reorganize" {
        return Ok(("Replacer ce qui n'a pas été fait".into(), schedule::reorganize(&w.plan.events, &due_by_key, &w.busy, &w.rhythm, t)));
    }
    let days = match scope {
        "day" => 1,
        "week" => 7,
        "two_weeks" => 14,
        _ => return Err(AppError::new("invalid_args", "scope : day, week, two_weeks ou reorganize")),
    };
    let mut needs = Vec::new();
    for p in &w.plan.projects {
        let Some(est) = p.estimate_min else { continue };
        if only.is_some_and(|o| o != p.key) {
            continue;
        }
        let done = w.board.iter().any(|b| (b.repo_path.as_deref() == Some(&p.key)) && b.status == "done") || w.repos.iter().any(|r| r.path == p.key && r.progress == "done");
        if done {
            continue;
        }
        let left = est - planned_minutes(&w, &p.key, t);
        if left > 0 {
            needs.push(schedule::Need { key: p.key.clone(), title: project_title(&w, &p.key), minutes: left, due: due_by_key(&p.key), priority: p.priority });
        }
    }
    let title = match (scope, only) {
        (_, Some(k)) => format!("Sessions pour {}", project_title(&w, k)),
        ("day", _) => "Plan pour aujourd'hui".into(),
        ("week", _) => "Plan pour la semaine".into(),
        _ => "Plan pour deux semaines".into(),
    };
    Ok((title, schedule::suggest(&needs, &w.busy, &w.rhythm, t, days)))
}

/// Checks proposed actions with the planning engine.
fn check_actions(w: &World, actions: &[crate::planner::Action]) -> Result<Vec<schedule::Violation>> {
    use crate::planner::Action;
    let mut placements = Vec::new();
    for (i, act) in actions.iter().enumerate() {
        match act {
            Action::CreateSession { start, end, title, kind, .. } => placements.push(Placement { index: i, event_id: None, start: crate::planner::parse_local(start)?, end: crate::planner::parse_local(end)?, work: kind.as_deref().is_none_or(|k| k == "session" || k == "task"), title: title.clone() }),
            Action::MoveEvent { id, start, end } => {
                let ev = w.plan.events.iter().find(|e| e.id == *id).ok_or_else(|| AppError::new("invalid_args", format!("Action {i} : aucune entrée n°{id}")))?;
                placements.push(Placement { index: i, event_id: Some(*id), start: crate::planner::parse_local(start)?, end: crate::planner::parse_local(end)?, work: ev.kind == "session" || ev.kind == "task", title: ev.title.clone() });
            }
            _ => {}
        }
    }
    // Deleted entries free their time.
    let deleted: Vec<i64> = actions.iter().filter_map(|x| if let Action::DeleteEvent { id } = x { Some(*id) } else { None }).collect();
    let busy: Vec<Busy> = w.busy.iter().filter(|b| b.event_id.is_none_or(|id| !deleted.contains(&id))).cloned().collect();
    Ok(schedule::validate(&placements, &busy, &w.rhythm, now()))
}

fn propose(state: &AppState, caller: &Caller, kind: &str, title: &str, rationale: &str, payload: &Value) -> Result<i64> {
    let conn = state.conn();
    conn.execute("INSERT INTO ai_proposals (thread_id, kind, title, rationale, payload, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)", params![caller.thread_id, kind, title, rationale, payload.to_string(), now()])?;
    let id = conn.last_insert_rowid();
    drop(conn);
    crate::notify::changed(&["ai"]);
    crate::notify::emit("ai-proposal", json!({"id": id, "threadId": caller.thread_id}));
    Ok(id)
}

/// Puts back what a journaled action changed.
pub fn undo(state: &AppState, action_id: i64) -> Result<String> {
    let conn = state.conn();
    let (undo, status, summary): (Option<String>, String, String) = conn.query_row("SELECT undo, status, summary FROM ai_actions WHERE id = ?1", [action_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).map_err(|_| AppError::new("not_found", "Action introuvable"))?;
    if status != "done" {
        return Err(AppError::new("already_undone", "Cette action a déjà été annulée."));
    }
    let u: Value = serde_json::from_str(&undo.unwrap_or_default()).map_err(|_| AppError::new("not_undoable", "Cette action ne peut pas être annulée."))?;
    apply_undo(&conn, &u)?;
    conn.execute("UPDATE ai_actions SET status = 'undone' WHERE id = ?1", [action_id])?;
    drop(conn);
    crate::notify::changed(&["plan", "memory", "ai", "insights"]);
    Ok(summary)
}

fn apply_undo(conn: &Connection, u: &Value) -> Result<()> {
    let id = u["id"].as_i64().unwrap_or(0);
    match u["op"].as_str().unwrap_or_default() {
        "delete_event" => crate::planner::delete_event(conn, id),
        "move_event" => {
            let ev = crate::planner::get_event(conn, id)?;
            crate::planner::save_event(conn, &crate::planner::PlanEvent { start: u["start"].as_i64().unwrap_or(ev.start), end: u["end"].as_i64().unwrap_or(ev.end), ..ev }, now()).map(|_| ())
        }
        "delete_task" => crate::planner::delete_task(conn, id),
        "restore_task" => {
            let t: crate::planner::Task = serde_json::from_value(u["task"].clone())?;
            crate::planner::save_task(conn, &t, now()).map(|_| ())
        }
        "delete_memory" => memory::delete(conn, id).map(|_| ()),
        "restore_memory" => memory::restore(conn, &serde_json::from_value(u["memory"].clone())?),
        "restore_project" => crate::planner::set_project(conn, u["key"].as_str().unwrap_or_default(), Some(u["priority"].as_i64().unwrap_or(0)), Some(u["estimateMin"].as_i64()), None).map(|_| ()),
        "stop_focus" => crate::focus::discard(conn, id, now()).map(|_| ()),
        other => Err(AppError::new("not_undoable", format!("Annulation inconnue : {other}"))),
    }
}

/// The user's decision on a proposal. `keep`: indexes of the actions to apply (all when `None`).
pub fn decide(state: &AppState, id: i64, accept: bool, keep: Option<Vec<usize>>) -> Result<Value> {
    let conn = state.conn();
    let (payload, status, title): (String, String, String) = conn.query_row("SELECT payload, status, title FROM ai_proposals WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).map_err(|_| AppError::new("not_found", "Proposition introuvable"))?;
    if status != "pending" {
        return Err(AppError::new("already_decided", "Cette proposition a déjà été traitée."));
    }
    let t = now();
    let outcome = if accept {
        let p: Value = serde_json::from_str(&payload)?;
        let all: Vec<crate::planner::Action> = serde_json::from_value(p["actions"].clone())?;
        let chosen: Vec<crate::planner::Action> = match &keep {
            Some(k) => all.iter().enumerate().filter(|(i, _)| k.contains(i)).map(|(_, a)| a.clone()).collect(),
            None => all.clone(),
        };
        let applied = crate::planner::apply(&conn, &chosen, "claude", t)?;
        json!({"accepted": true, "applied": applied, "kept": chosen.len(), "of": all.len()})
    } else {
        json!({"accepted": false})
    };
    conn.execute("UPDATE ai_proposals SET status = ?2, outcome = ?3, decided_at = ?4 WHERE id = ?1", params![id, if accept { "accepted" } else { "rejected" }, outcome.to_string(), t])?;
    drop(conn);
    crate::notify::changed(&["plan", "ai", "insights"]);
    let _ = title;
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_tool_has_a_valid_schema_and_a_french_label() {
        let mut names = std::collections::HashSet::new();
        for s in SPECS {
            assert!(names.insert(s.name), "duplicate {}", s.name);
            let schema = (s.schema)();
            assert_eq!(schema["type"], "object", "{}", s.name);
            for r in schema["required"].as_array().unwrap() {
                assert!(schema["properties"].get(r.as_str().unwrap()).is_some(), "{}: required {r} not declared", s.name);
            }
            assert!(!s.label.is_empty() && !s.description.is_empty());
        }
    }

    #[test]
    fn bulk_and_destructive_changes_always_need_approval() {
        for name in ["delete_event", "propose_schedule"] {
            assert_eq!(spec(name).unwrap().risk, Risk::Approval, "{name}");
        }
        for name in ["get_today", "get_calendar", "recall", "list_projects"] {
            assert_eq!(spec(name).unwrap().risk, Risk::Read, "{name}");
        }
    }

    #[test]
    fn undo_puts_things_back() {
        let c = crate::db::open_in_memory().unwrap();
        let ev = crate::planner::save_event(&c, &crate::planner::PlanEvent { kind: "session".into(), title: "S".into(), start: 1000, end: 4600, origin: "claude".into(), ..Default::default() }, 1).unwrap();
        apply_undo(&c, &json!({"op": "move_event", "id": ev.id, "start": 2000, "end": 5600})).unwrap();
        assert_eq!(crate::planner::get_event(&c, ev.id).unwrap().start, 2000);
        apply_undo(&c, &json!({"op": "delete_event", "id": ev.id})).unwrap();
        assert!(crate::planner::get_event(&c, ev.id).is_err());
        let m = match memory::add(&c, "global", "fact", "Aime le café", "assistant", false, false, 1).unwrap() {
            memory::Added::Saved { memory } => memory,
            _ => unreachable!(),
        };
        let gone = memory::delete(&c, m.id).unwrap().unwrap();
        apply_undo(&c, &json!({"op": "restore_memory", "memory": gone})).unwrap();
        assert!(memory::get(&c, m.id).unwrap().is_some());
    }
}
