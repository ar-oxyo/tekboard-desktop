//! The instructions TekBoard gives to Claude Code, as editable templates.
//!
//! Each prompt has a default text shipped with the application and a list of variables
//! written `{{NAME}}`. The user may save variants ("presets") of a prompt and choose which
//! one is used; those live in the database, so they survive an update, while the defaults
//! stay in the code and improve with it.
//!
//! A prompt is only ever text: variables are replaced in one pass (a value is never read
//! again for more variables), the result is handed to Claude Code as a single argument,
//! and what Claude Code may do is decided elsewhere (`claude::build_argv`: fixed tools,
//! never a shell). Nothing written in a prompt or in a variable can run a command.

use crate::db;
use crate::error::{AppError, Result};
use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;

pub const MAX_BODY: usize = 20_000;
pub const MAX_PRESET_NAME: usize = 40;

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Var {
    pub name: &'static str,
    pub description: &'static str,
    /// Shown in the preview when no project is selected.
    pub sample: &'static str,
    /// The prompt cannot work without it: saving a variant that drops it is refused.
    pub required: bool,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Def {
    pub id: &'static str,
    pub title: &'static str,
    pub description: &'static str,
    /// What Claude Code may do when this prompt runs.
    pub access: &'static str,
    /// What TekBoard expects back; changing the prompt must keep it.
    pub expects: &'static str,
    pub default: &'static str,
    pub vars: &'static [Var],
}

const PROJECT: Var = Var { name: "PROJECT_NAME", description: "Name of the project", sample: "my_hunter", required: false };
const MODULE: Var = Var { name: "MODULE", description: "Module code, when the project has one", sample: "G-MUL-100", required: false };

pub const SUBJECT: &str = "moulinette.subject";
pub const TESTS: &str = "tests.generate";
pub const README: &str = "readme.generate";
pub const ANALYZE: &str = "repo.analyze";
pub const PERSONA: &str = "assistant.persona";
pub const MOULI_AGENT: &str = "moulinette.agent";
pub const TESTS_AGENT: &str = "tests.agent";

const MOULI_DEFAULT: &str = "Tu es l'évaluateur technique de la moulinette de TekBoard : une SIMULATION de la moulinette d'Epitech, jamais la vraie. Tu travailles sur une copie de travail jetable du projet d'un étudiant, dans un bac à sable sans réseau.\n\n\
Comment tu travailles :\n\
- Tu lis avec Read, Glob et Grep. Tu exécutes UNIQUEMENT avec l'outil mcp__tekboard__exec (il n'y a pas d'autre shell). Mets `timeout 10` (ou plus si nécessaire) devant tout programme de l'étudiant, et `valgrind --leak-check=full --error-exitcode=42` pour la mémoire.\n\
- Tu ne modifies jamais les sources. Tes fichiers de test, entrées et scripts vont dans .mouli/ (seul dossier où tu peux écrire avec Write).\n\
- Tu rends compte en direct : mcp__tekboard__phase au début de chaque étape ; mcp__tekboard__plan_check AVANT chaque vérification ; mcp__tekboard__check_result APRÈS l'avoir réellement exécutée, avec la commande et la sortie observée comme preuve, et une piste de correction concrète en cas d'échec. Jamais de résultat que tu n'as pas observé.\n\n\
Étapes (adapte-les au projet et à ce que tu découvres) :\n\
1. subject : lis .mouli/SUBJECT.md s'il existe (consignes), sinon déduis le projet du code. Liste les exigences vérifiables : nom du binaire, règles du Makefile, fonctions autorisées, comportements, codes de retour (84 en cas d'erreur à Epitech), sorties attendues.\n\
2. build : make, puis make re, make clean, make fclean ; le binaire attendu existe-t-il ? Avertissements ?\n\
3. arguments : aucun argument, trop d'arguments, arguments invalides, -h.\n\
4. edge_cases : entrées vides, très grandes, caractères spéciaux, fichiers absents ou illisibles, selon le sujet.\n\
5. errors : le programme sort-il proprement (code 84, message sur stderr) au lieu de planter ?\n\
6. memory : valgrind sur les cas principaux et sur les cas d'erreur ; fuites, lectures invalides.\n\
7. style : fonctions interdites (Grep), signes de non-respect du coding style Epitech (fonctions trop longues, plusieurs instructions par ligne, globales). Ce n'est pas Banana : dis-le.\n\
8. robustness : quand un problème apparaît, creuse : réduis le cas, trouve la cause (fichier et ligne), essaie des variantes proches.\n\
Fais au moins 12 vérifications pertinentes, au plus 40. Reste dans le temps : va à l'essentiel d'abord.\n\n\
Termine par mcp__tekboard__finish_report : un verdict d'une phrase, puis en Markdown les problèmes par gravité (critique, majeur, mineur) avec fichier:ligne quand tu le sais, la commande pour reproduire et la correction proposée. Rappelle que c'est une simulation.";

const TESTS_AGENT_DEFAULT: &str = "Tu écris des tests unitaires pour le projet d'un étudiant d'Epitech, dans une copie de travail jetable (le vrai projet ne sera modifié que si l'étudiant accepte ton diff).\n\n\
- Lis le code (Read, Glob, Grep) et .mouli/SUBJECT.md s'il existe.\n\
- Écris les tests dans tests/ avec Criterion (#include <criterion/criterion.h>, Test(suite, nom)), en ciblant les fonctions qui comptent : cas normaux, cas limites, erreurs. Pas de tests creux.\n\
- Si le Makefile n'a pas de règle tests_run, ajoute-la sans rien casser : compile les sources sauf le main avec les tests, --coverage -lcriterion, puis lance le binaire de test.\n\
- Compile et lance avec mcp__tekboard__exec (`make tests_run`, avec timeout). Corrige tes tests jusqu'à ce qu'ils compilent. Un test qui échoue parce que le code de l'étudiant a un bug est précieux : garde-le et signale-le.\n\
- Annonce tes étapes avec mcp__tekboard__phase.\n\
- Ne modifie aucun fichier source de l'étudiant : seulement tests/ et le Makefile.\n\
Termine par un court résumé en français : tests écrits, résultat de make tests_run, bugs trouvés.";

/// Who Artix is and how it works. Given as an addition to Claude Code's system prompt on every
/// turn of a conversation; the tools themselves enforce the rules that matter.
const PERSONA_DEFAULT: &str = "Tu es Artix, l'assistant d'organisation intégré à TekBoard, l'environnement de travail d'un étudiant d'Epitech. Tu vis dans l'application : tu vois ses projets, son calendrier, ses sessions, ses tests et ta mémoire, et tu AGIS avec les outils mcp__tekboard__*.\n\n\
Style : très court et direct. Pas d'introduction, pas de reformulation de la demande, pas de récapitulatif final, pas d'explication non demandée. Une phrase ou une petite liste suffit. Dis ce qui a été fait, en une ligne. Tu tutoies. Développe seulement si l'utilisateur demande des détails. Garde les mots techniques tels quels : « test », « tests », « zone de test », moulinette, Banana, bootstrap, follow-up, Makefile.\n\n\
Comprendre et agir :\n\
1. Repère l'intention, même implicite, et exécute-la quand elle est claire. « J'ai un rendez-vous médical jeudi à 14 h » → create_event kind event, 1 h par défaut, sans demander. « Je suis occupé demain après-midi » → create_event kind block sur l'après-midi (horaires de get_rhythm). « Je dois terminer mon projet vendredi » → create_task « Terminer <projet> » avec dueDay, puis suggest_plan limité au projet si du travail reste. « J'ai pris du retard sur X » → lis X (get_project), monte sa priorité (set_project_plan), puis suggest_plan reorganize. « Organise-moi ma semaine » → suggest_plan week.\n\
2. Ne pose une question que si une information indispensable manque (quel projet quand il y en a plusieurs, quel jour). Une seule question, courte. Ce qui a une valeur par défaut raisonnable (durée, titre) ne se demande pas.\n\
3. Lis les faits avant d'organiser : get_today, get_calendar, find_free_time, list_projects, get_project. Ne devine jamais une date, une heure ou un état. Les dates relatives (« jeudi », « demain ») se calculent depuis le contexte.\n\
4. Une entrée isolée : create_event, update_event ou move_event, exécutés tout de suite (l'utilisateur peut annuler). Plusieurs changements, une réorganisation ou toute suppression : propose_schedule, suggest_plan ou delete_event, qui demandent sa validation ; dis alors « je te propose », jamais « c'est fait ».\n\
5. Tu ne dis jamais qu'une chose est faite si un outil ne l'a pas confirmé. Si un outil refuse, dis-le en une ligne et propose une alternative.\n\
6. Un bon planning n'est pas un planning plein : rythme (get_rhythm), pauses, plafond quotidien (l'école compte), sessions pas trop longues, variété entre projets, temps libre, marge et bloc de tests avant chaque rendu. Si tout ne tient pas, dis-le et propose de prioriser.\n\
7. Décomposer un projet : lis le sujet (get_project ; analyze_subject s'il n'est pas lu), puis propose_breakdown avec des tâches aux intitulés courts et précis (3 à 8 mots, estimées, sous-tâches si utile, sans longues descriptions) et le travail restant total. Une décomposition ne crée jamais de session : l'utilisateur choisit ensuite s'il veut planifier. Réponds en une ligne.\n\
8. « Prépare-moi une session de 45 min » : start_focus. « J'en ai marre » : propose une vraie pause ou une activité courte et différente.\n\
9. Mémoire : remember ce qui servira plus tard (préférences, contraintes, décisions, difficultés, objectifs), en une phrase, sans secret. recall avant de redemander.\n\
10. navigate pour ouvrir un écran quand c'est utile. La moulinette de TekBoard est une simulation, pas la moulinette officielle.\n\n\
Le contexte en tête de chaque message (écran, journée, rendus, souvenirs) est à jour : utilise-le.";

pub const DEFS: &[Def] = &[
    Def {
        id: PERSONA,
        title: "Artix : identité et règles",
        description: "Ajouté aux instructions de Claude Code à chaque message de la conversation avec Artix.",
        access: "Aucun outil intégré : uniquement les outils de TekBoard (lecture, actions réversibles journalisées, propositions à valider).",
        expects: "Des réponses très courtes ; les actions explicites sont exécutées par les outils.",
        default: PERSONA_DEFAULT,
        vars: &[],
    },
    Def {
        id: MOULI_AGENT,
        title: "Moulinette d'Artix : rôle de l'évaluateur",
        description: "Instructions de l'agent qui simule une moulinette sur une copie de travail.",
        access: "Lecture de la copie, écriture dans .mouli/ seulement, commandes via le bac à sable de TekBoard (sans réseau).",
        expects: "Des appels phase / plan_check / check_result puis finish_report.",
        default: MOULI_DEFAULT,
        vars: &[],
    },
    Def {
        id: TESTS_AGENT,
        title: "Génération de tests : rôle de l'agent",
        description: "Instructions de l'agent qui écrit, compile et lance des tests sur une copie de travail.",
        access: "Écriture dans tests/ et le Makefile de la copie, commandes via le bac à sable ; le projet réel ne change qu'après validation.",
        expects: "Des fichiers dans tests/, éventuellement une règle tests_run, puis un résumé.",
        default: TESTS_AGENT_DEFAULT,
        vars: &[],
    },
    Def {
        id: SUBJECT,
        title: "Subject requirements check",
        description: "Claude Moulinette, last step: compares the code with the linked subject.",
        access: "Read-only: project files, minus .git and secrets.",
        expects: "A JSON array in a ```json block: [{\"requirement\", \"status\": met|not_met|unclear, \"evidence\"}].",
        default: "You are checking a student project against its assignment, before a manual review. Work only from what you can read in this folder.\n\n\
1. From the assignment below, list the requirements that can be checked by reading the repository (expected files, binary name, required functions or behaviours, allowed/forbidden functions, build rules, error handling the text demands). Ignore anything about grading or deadlines. At most 25 items.\n\
2. For each one, read the relevant files and decide: \"met\", \"not_met\", or \"unclear\" when the code alone cannot tell (never guess: unclear is the right answer for behaviour you cannot verify by reading).\n\
3. Answer with ONLY a JSON array in a ```json block: [{\"requirement\": \"…\", \"status\": \"met|not_met|unclear\", \"evidence\": \"file and line, or why it is unclear\"}]. No other text.\n\n\
--- ASSIGNMENT ---\n{{SUBJECT}}\n--- END ---",
        vars: &[Var { name: "SUBJECT", description: "Text of the subject PDF linked to the project", sample: "<the text of the linked subject PDF>", required: true }, PROJECT, MODULE],
    },
    Def {
        id: TESTS,
        title: "Unit test generation",
        description: "“Generate Unit Tests with Claude”: writes tests in tests/ only.",
        access: "Reads the project; may create or edit files inside tests/ only.",
        expects: "Test files under tests/, then a short plain-text summary.",
        default: "Write unit tests for this C project.\n\n\
- Read the sources first (Glob/Grep/Read). Find the functions that have no test yet in tests/.\n\
- Write tests with {{FRAMEWORK}}, in new files under tests/ named test_<topic>.c. You may only create or edit files inside tests/: do not try to change anything else.\n\
- Follow the Epitech coding style: standard file header comment, 4-space indentation, snake_case names.\n\
- Test real behaviour you verified by reading the code, including edge cases (empty input, NULL when the function handles it, limits). Do not invent behaviour: if you are unsure what a function should return, do not test that case.\n\
- Do not test static functions or main().\n\
- {{TEST_RULE_NOTE}}\n\n\
End with a short plain-text summary: the files you wrote, the functions covered, and what you chose not to test and why.",
        vars: &[
            Var { name: "FRAMEWORK", description: "Test framework found in the project (Criterion by default)", sample: "Criterion (#include <criterion/criterion.h>)", required: false },
            Var { name: "TEST_RULE_NOTE", description: "What the Makefile says about tests (a rule exists, or none and it cannot be edited)", sample: "The Makefile has a test rule: keep to what it compiles (check which files it takes).", required: false },
            PROJECT,
            MODULE,
        ],
    },
    Def {
        id: README,
        title: "README generation",
        description: "“Generate README” with Claude: proposes a README you review before anything is written.",
        access: "Read-only: project files, minus .git and secrets.",
        expects: "The README inside one ```markdown block.",
        default: "Write the README.md of this project. Work only from what you can read in this folder.\n\n\
- Read the sources, the Makefile and the tests first. Describe what the program really does, how to build it, how to run it (real arguments, taken from the argument handling in the code), and how to run the tests.\n\
- Do not invent features, options, or example output you did not derive from the code. If something cannot be known from the files, leave an HTML comment `<!-- TODO: … -->` instead of guessing.\n\
- Keep it short and practical: no badges, no marketing, no licence section unless a LICENSE file exists.\n\
- {{DISCLOSURE}}\n\
- Below is a factual skeleton TekBoard extracted (binary name, rules, test command, structure). Keep its facts; replace its TODO comments where the code lets you.\n\n\
Answer with ONLY the README content inside one ```markdown block.\n\n--- SKELETON ---\n{{SKELETON}}\n--- END ---",
        vars: &[
            Var { name: "SKELETON", description: "Factual README skeleton TekBoard extracts from the project", sample: "# my_hunter\n\n## Build\n\n```sh\nmake\n```\n\n<!-- TODO: what the program does -->", required: true },
            Var { name: "DISCLOSURE", description: "Sentence about AI assistance, according to the option ticked in the README dialog", sample: "Do not mention AI assistance anywhere.", required: false },
            PROJECT,
            MODULE,
        ],
    },
    Def {
        id: ANALYZE,
        title: "Repository analysis",
        description: "“Analyse repository”: a read-only review of the project's structure and risks.",
        access: "Read-only: project files, minus .git and secrets.",
        expects: "A Markdown report inside one ```markdown block.",
        default: "Analyse this repository ({{PROJECT_NAME}}{{MODULE_NOTE}}) and report what its author should know before handing it in. Work only from what you can read in this folder; never guess.\n\n\
1. Overview: what the program does, how it is organised (folders, main modules, entry point), how it is built.\n\
2. Risks, most serious first: bugs you can point to (file and line), unchecked allocations or returns, memory or file-descriptor leaks, undefined behaviour, error paths that are missing.\n\
3. Build and delivery: Makefile rules (all, clean, fclean, re), files that should not be tracked, anything that would not compile from a clean clone.\n\
4. Tests: what is covered, what is not.\n\
5. Three to five concrete next steps, ordered.\n\n\
Quote file paths and line numbers for every finding. Say \"not verified\" for anything you could not confirm by reading. Do not grade the project.\n\n\
Answer with ONLY the report inside one ```markdown block.",
        vars: &[PROJECT, MODULE, Var { name: "MODULE_NOTE", description: "“, module G-XXX-000” when the project has a module, empty otherwise", sample: ", module G-MUL-100", required: false }],
    },
];

pub fn def(id: &str) -> Result<&'static Def> {
    DEFS.iter().find(|d| d.id == id).ok_or_else(|| AppError::new("unknown_prompt", "Prompt inconnu"))
}

/// Names written `{{NAME}}` in a template, in order of first appearance.
pub fn variables_in(template: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut rest = template;
    while let Some(start) = rest.find("{{") {
        let after = &rest[start + 2..];
        match after.find("}}") {
            Some(end) => {
                let name = &after[..end];
                if !name.is_empty() && name.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_') {
                    if !out.iter().any(|n| n == name) {
                        out.push(name.to_string());
                    }
                    rest = &after[end + 2..];
                } else {
                    rest = after;
                }
            }
            None => break,
        }
    }
    out
}

/// Replaces `{{NAME}}` by its value, in a single pass over the template: the text of a
/// value is copied as it is and never scanned for more variables. Unknown names are left
/// untouched (they are refused when a variant is saved).
pub fn render(template: &str, values: &HashMap<String, String>) -> String {
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        match after.find("}}").map(|end| (&after[..end], end)) {
            Some((name, end)) if values.contains_key(name) => {
                out.push_str(&values[name]);
                rest = &after[end + 2..];
            }
            _ => {
                out.push_str("{{");
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Checks a variant before it is saved. Returns warnings that do not prevent saving.
pub fn validate(def: &Def, body: &str) -> Result<Vec<String>> {
    if body.trim().is_empty() {
        return Err(AppError::new("invalid_prompt", "Le prompt est vide"));
    }
    if body.len() > MAX_BODY {
        return Err(AppError::new("invalid_prompt", format!("Le prompt est trop long ({} caractères, {MAX_BODY} au plus)", body.len())));
    }
    if body.contains('\0') {
        return Err(AppError::new("invalid_prompt", "Le prompt contient un caractère qui ne peut pas être passé à un programme"));
    }
    let used = variables_in(body);
    let unknown: Vec<&String> = used.iter().filter(|n| !def.vars.iter().any(|v| v.name == n.as_str())).collect();
    if !unknown.is_empty() {
        return Err(AppError::new("invalid_prompt", format!("Variable{} inconnue : {}. Disponibles ici : {}.", if unknown.len() > 1 { "s" } else { "" }, unknown.iter().map(|n| format!("{{{{{n}}}}}")).collect::<Vec<_>>().join(", "), def.vars.iter().map(|v| format!("{{{{{}}}}}", v.name)).collect::<Vec<_>>().join(", "))));
    }
    let missing: Vec<&str> = def.vars.iter().filter(|v| v.required && !used.iter().any(|n| n == v.name)).map(|v| v.name).collect();
    if !missing.is_empty() {
        return Err(AppError::new("invalid_prompt", format!("Ce prompt ne peut pas fonctionner sans {}.", missing.iter().map(|n| format!("{{{{{n}}}}}")).collect::<Vec<_>>().join(", "))));
    }
    let mut warnings = Vec::new();
    if def.id == SUBJECT && !body.contains("json") {
        warnings.push("The answer is read as a JSON checklist: without that instruction the result will show as unreadable.".to_string());
    }
    if (def.id == README || def.id == ANALYZE) && !body.contains("markdown") {
        warnings.push("TekBoard takes the text of the first ```markdown block; without that instruction the whole answer is used.".to_string());
    }
    if def.id == TESTS && !body.contains("tests/") {
        warnings.push("Claude Code may only write inside tests/, whatever the prompt says: tell it so, or it will waste turns trying elsewhere.".to_string());
    }
    Ok(warnings)
}

fn active_key(id: &str) -> String {
    format!("prompt_active|{id}")
}

/// Name of the variant in use, or `None` for the default.
pub fn active_preset(conn: &Connection, id: &str) -> Result<Option<String>> {
    Ok(db::get_setting(conn, &active_key(id))?.filter(|p| !p.is_empty()))
}

pub fn set_active(conn: &Connection, id: &str, preset: Option<&str>) -> Result<()> {
    def(id)?;
    if let Some(p) = preset {
        if !db::prompt_variants(conn, id)?.iter().any(|(name, _, _)| name == p) {
            return Err(AppError::new("unknown_preset", "Cette version n'existe plus"));
        }
    }
    db::set_setting(conn, &active_key(id), preset.unwrap_or(""))
}

/// The template to use right now: the active variant when it exists and is still valid, else the default.
pub fn template(conn: &Connection, id: &str) -> Result<String> {
    let d = def(id)?;
    if let Some(name) = active_preset(conn, id)? {
        if let Some((_, body, _)) = db::prompt_variants(conn, id)?.into_iter().find(|(n, _, _)| *n == name) {
            // A variant saved by an older version may use a variable that no longer exists.
            if validate(d, &body).is_ok() {
                return Ok(body);
            }
        }
    }
    Ok(d.default.to_string())
}

pub fn save(conn: &Connection, id: &str, preset: &str, body: &str, now: i64) -> Result<Vec<String>> {
    let d = def(id)?;
    let name = preset.trim();
    if name.is_empty() || name.chars().count() > MAX_PRESET_NAME || name.chars().any(|c| c.is_control()) {
        return Err(AppError::new("invalid_preset", format!("Une version a besoin d'un nom de {MAX_PRESET_NAME} caractères au plus")));
    }
    let warnings = validate(d, body)?;
    db::prompt_save(conn, id, name, body, now)?;
    Ok(warnings)
}

pub fn delete(conn: &Connection, id: &str, preset: &str) -> Result<()> {
    def(id)?;
    db::prompt_delete(conn, id, preset)?;
    if active_preset(conn, id)?.as_deref() == Some(preset) {
        db::set_setting(conn, &active_key(id), "")?;
    }
    Ok(())
}

/// Values every prompt may use, taken from the repository itself.
pub fn common_values(repo: &Path) -> HashMap<String, String> {
    let folder = repo.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let remote_name = crate::git::origin_url(repo).as_deref().and_then(crate::epitech::parse_remote).map(|r| r.name);
    let ep = remote_name.as_deref().and_then(crate::epitech::parse_repo_name).or_else(|| crate::epitech::parse_repo_name(&folder));
    let mut v = HashMap::new();
    v.insert("PROJECT_NAME".to_string(), ep.as_ref().map(|e| e.project.clone()).unwrap_or(folder));
    v.insert("MODULE_NOTE".to_string(), ep.as_ref().map(|e| format!(", module {}", e.module)).unwrap_or_default());
    v.insert("MODULE".to_string(), ep.map(|e| e.module).unwrap_or_default());
    v
}

/// Sample values, for a preview without a project.
pub fn sample_values(def: &Def) -> HashMap<String, String> {
    def.vars.iter().map(|v| (v.name.to_string(), v.sample.to_string())).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn values(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn every_default_is_valid_and_uses_only_its_own_variables() {
        for d in DEFS {
            let warnings = validate(d, d.default).unwrap_or_else(|e| panic!("{}: {e}", d.id));
            assert!(warnings.is_empty(), "{}: {warnings:?}", d.id);
            let rendered = render(d.default, &sample_values(d));
            assert!(!rendered.contains("{{"), "{}: a variable was left unresolved", d.id);
        }
        assert_eq!(DEFS.iter().map(|d| d.id).collect::<std::collections::HashSet<_>>().len(), DEFS.len());
    }

    #[test]
    fn variables_are_replaced_once_and_values_are_never_expanded() {
        let v = values(&[("A", "{{B}} and $(rm -rf ~) `id`"), ("B", "secret")]);
        assert_eq!(render("x {{A}} y {{B}} {{A}}", &v), "x {{B}} and $(rm -rf ~) `id` y secret {{B}} and $(rm -rf ~) `id`");
        assert_eq!(render("{{UNKNOWN}} {{ A }} {{A", &v), "{{UNKNOWN}} {{ A }} {{A", "anything that is not a known variable stays as typed");
        assert_eq!(render("{{{{A}}}}", &values(&[("A", "v")])), "{{v}}");
        assert_eq!(render("no variable", &v), "no variable");
        assert_eq!(render("é{{B}}ü", &v), "ésecretü");
    }

    #[test]
    fn variable_names_are_listed_once_in_order() {
        assert_eq!(variables_in("{{B}} {{A}} {{B}} {{not a var}} {{lower}} {{A_2}} {{"), vec!["B", "A", "A_2"]);
        assert!(variables_in("plain {text}").is_empty());
    }

    #[test]
    fn a_variant_must_keep_required_variables_and_cannot_invent_any() {
        let d = def(SUBJECT).unwrap();
        assert_eq!(validate(d, "Check it. json").unwrap_err().code(), "invalid_prompt", "{{SUBJECT}} is required");
        let e = validate(d, "{{SUBJECT}} {{HOME}} {{SHELL_CMD}}").unwrap_err();
        assert!(e.to_string().contains("{{HOME}}") && e.to_string().contains("{{SUBJECT}}"), "{e}");
        assert_eq!(validate(d, "  ").unwrap_err().code(), "invalid_prompt");
        assert_eq!(validate(d, &"x".repeat(MAX_BODY + 1)).unwrap_err().code(), "invalid_prompt");
        assert_eq!(validate(d, "a\0b {{SUBJECT}}").unwrap_err().code(), "invalid_prompt");
        assert!(validate(d, "Answer in a ```json block.\n{{SUBJECT}} for {{PROJECT_NAME}}").unwrap().is_empty());
        assert_eq!(validate(d, "{{SUBJECT}}").unwrap().len(), 1, "dropping the answer format is allowed but flagged");
        assert_eq!(def("nope").unwrap_err().code(), "unknown_prompt");
    }

    #[test]
    fn presets_are_saved_chosen_and_restored_to_default() {
        let conn = db::open_in_memory().unwrap();
        let d = def(README).unwrap();
        assert_eq!(template(&conn, README).unwrap(), d.default);
        let mine = "Short README, in French.\n```markdown\n{{SKELETON}}";
        save(&conn, README, "french", mine, 1).unwrap();
        assert_eq!(template(&conn, README).unwrap(), d.default, "saving does not switch to the variant");
        set_active(&conn, README, Some("french")).unwrap();
        assert_eq!(template(&conn, README).unwrap(), mine);
        assert_eq!(template(&conn, TESTS).unwrap(), def(TESTS).unwrap().default, "other prompts are untouched");
        assert_eq!(set_active(&conn, README, Some("ghost")).unwrap_err().code(), "unknown_preset");
        assert_eq!(save(&conn, README, "bad", "no skeleton here", 2).unwrap_err().code(), "invalid_prompt");
        assert_eq!(save(&conn, README, "  ", mine, 2).unwrap_err().code(), "invalid_preset");
        // Restore default: either pick it, or delete the variant in use.
        set_active(&conn, README, None).unwrap();
        assert_eq!(template(&conn, README).unwrap(), d.default);
        set_active(&conn, README, Some("french")).unwrap();
        delete(&conn, README, "french").unwrap();
        assert_eq!((template(&conn, README).unwrap(), active_preset(&conn, README).unwrap()), (d.default.to_string(), None));
    }

    #[test]
    fn a_variant_broken_by_an_update_falls_back_to_the_default() {
        let conn = db::open_in_memory().unwrap();
        // Written straight to the database, as an older version could have.
        db::prompt_save(&conn, SUBJECT, "old", "{{SUBJECT}} {{REMOVED_VARIABLE}}", 1).unwrap();
        db::set_setting(&conn, &active_key(SUBJECT), "old").unwrap();
        assert_eq!(template(&conn, SUBJECT).unwrap(), def(SUBJECT).unwrap().default);
    }

    #[test]
    fn a_prompt_stays_one_argument_and_cannot_widen_what_claude_may_do() {
        let hostile = "{{SUBJECT}} -- --allowedTools Bash --dangerously-skip-permissions\njson";
        let d = def(SUBJECT).unwrap();
        validate(d, hostile).unwrap();
        let text = render(hostile, &values(&[("SUBJECT", "--tools Bash; $(reboot)")]));
        let argv = crate::ai::runner::argv("claude", &crate::ai::runner::Request::new(text.clone(), crate::ai::runner::Tools::Read, std::time::Duration::from_secs(1)));
        assert_eq!(argv.last().unwrap(), &text, "the whole prompt is the last argument");
        assert_eq!(argv[argv.len() - 2], "--", "options end before the prompt");
        let tools_at = argv.iter().position(|a| a == "--tools").unwrap();
        let allowed_at = argv.iter().position(|a| a == "--allowedTools").unwrap();
        assert_eq!(&argv[tools_at + 1..allowed_at], ["Read", "Glob", "Grep"]);
        assert_eq!(argv[..argv.len() - 1].iter().filter(|a| a.contains("Bash")).count(), 0);
    }
}
