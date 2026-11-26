//! The contract between Artix and the whiteboard. The model never writes drawing code nor a
//! diagram language: it fills one small JSON document whose every field and value is listed
//! here. The answer is parsed and checked here (unknown kinds, dangling ids, limits), and when
//! it breaks the contract the model is told exactly what to fix and asked again, a bounded
//! number of times. Only a checked, normalised document reaches the window, which draws it
//! itself (lib/boards.ts). Works the same with every provider: it is plain text in, JSON out.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const MAX_NODES: usize = 40;
pub const MAX_EDGES: usize = 80;
pub const MAX_GROUPS: usize = 8;
pub const MAX_PARTICIPANTS: usize = 10;
pub const MAX_MESSAGES: usize = 40;
pub const MAX_NOTES: usize = 8;
pub const MAX_LABEL: usize = 80;
pub const MAX_NOTE: usize = 400;
/// Asked again at most this many times after a first answer that breaks the contract.
pub const MAX_REPAIRS: usize = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "UPPERCASE")]
pub enum Direction {
    #[default]
    Tb,
    Lr,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Shape {
    #[default]
    Box,
    Round,
    Diamond,
    Ellipse,
    Note,
    Text,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Tone {
    #[default]
    Plain,
    Accent,
    Warn,
    Ok,
    Muted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Line {
    #[default]
    Solid,
    Dashed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Arrow {
    #[default]
    End,
    Both,
    None,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Node {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub shape: Shape,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    #[serde(default)]
    pub tone: Tone,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Edge {
    pub from: String,
    pub to: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default)]
    pub style: Line,
    #[serde(default)]
    pub arrow: Arrow,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Group {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Participant {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Message {
    pub from: String,
    pub to: String,
    pub label: String,
    /// An answer (drawn dashed).
    #[serde(default)]
    pub reply: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Note {
    pub anchor: String,
    pub note: String,
}

/// Everything Artix may put on a board.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Spec {
    Graph {
        #[serde(default)]
        direction: Direction,
        nodes: Vec<Node>,
        #[serde(default)]
        edges: Vec<Edge>,
        #[serde(default)]
        groups: Vec<Group>,
    },
    Sequence {
        participants: Vec<Participant>,
        messages: Vec<Message>,
    },
    Annotations {
        notes: Vec<Note>,
    },
}

/// What is asked: a diagram (graph or sequence) or notes on what is already drawn.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ask {
    Diagram,
    Annotate,
}

impl Ask {
    pub fn from_kind(kind: &str) -> Option<Ask> {
        match kind {
            "diagram" => Some(Ask::Diagram),
            "annotate" => Some(Ask::Annotate),
            _ => None,
        }
    }
}

const CONTRACT_DIAGRAM: &str = r#"Contrat (aucun autre champ ni valeur n'existe) :
- Graphe (organigramme, algorithme, architecture, dépendances, structures reliées) :
  {"type":"graph","direction":"TB|LR","nodes":[{"id":"a","label":"…","shape":"box|round|diamond|ellipse|note|text","group":"g1","tone":"plain|accent|warn|ok|muted"}],"edges":[{"from":"a","to":"b","label":"…","style":"solid|dashed","arrow":"end|both|none"}],"groups":[{"id":"g1","label":"…"}]}
- Séquence (échanges client-serveur, appels entre processus) :
  {"type":"sequence","participants":[{"id":"c","label":"Client"}],"messages":[{"from":"c","to":"s","label":"GET /","reply":false}]}
Règles : ids en lettres, chiffres, _ ou -, uniques ; chaque from, to et group cite un id déclaré ; diamond = décision ; group, tone, label d'un lien, style et arrow sont facultatifs. Pas de coordonnées, de couleurs, de code, de Mermaid ni de fonctions : TekBoard place et dessine lui-même."#;

/// The first request to the model.
pub fn prompt(ask: Ask, request: &str, context: &str) -> String {
    let request: String = request.chars().take(4000).collect();
    let context: String = context.chars().take(20_000).collect();
    match ask {
        Ask::Diagram => format!(
            "Tu prépares un schéma pour le tableau blanc d'un étudiant en informatique (C, Unix). Demande :\n{request}\n\nContenu actuel du tableau (contexte, peut être vide) :\n{context}\n\n\
Réponds UNIQUEMENT avec un bloc ```json``` qui respecte ce contrat.\n{CONTRACT_DIAGRAM}\n\
Limites : au plus {MAX_NODES} nœuds, {MAX_EDGES} liens, {MAX_GROUPS} groupes, {MAX_PARTICIPANTS} participants, {MAX_MESSAGES} messages ; libellés de {MAX_LABEL} caractères au plus, en français. \
Pour une structure de données (liste chaînée, arbre, pile…), un nœud par maillon et un lien par pointeur."
        ),
        Ask::Annotate => format!(
            "Voici le contenu d'un tableau blanc d'étudiant en informatique :\n{context}\n\nAjoute au plus 6 annotations pédagogiques courtes (une ou deux phrases) qui expliquent ou corrigent ce qui est dessiné. {request}\n\
Réponds UNIQUEMENT avec un bloc ```json``` : {{\"type\":\"annotations\",\"notes\":[{{\"anchor\":\"texte exact d'un élément du tableau\",\"note\":\"annotation\"}}]}}. \
`anchor` reprend mot pour mot un texte présent dans le contenu ci-dessus ; aucun autre champ n'existe."
        ),
    }
}

/// The follow-up when an answer breaks the contract: exactly what is wrong, and the answer.
pub fn repair_prompt(ask: Ask, previous: &str, errors: &[String]) -> String {
    let previous: String = previous.chars().take(12_000).collect();
    let list = errors.iter().take(12).map(|e| format!("- {e}")).collect::<Vec<_>>().join("\n");
    let contract = match ask {
        Ask::Diagram => CONTRACT_DIAGRAM,
        Ask::Annotate => "{\"type\":\"annotations\",\"notes\":[{\"anchor\":\"…\",\"note\":\"…\"}]}",
    };
    format!("Ta réponse précédente ne respecte pas le contrat du tableau blanc :\n{list}\n\nRéponse précédente :\n{previous}\n\nCorrige uniquement ces points et renvoie le document complet, UNIQUEMENT dans un bloc ```json```.\n{contract}")
}

/// The JSON document of an answer: its first ```json block, or the outermost braces.
fn json_of(answer: &str) -> Option<&str> {
    let body = match answer.find("```") {
        Some(open) => {
            let rest = &answer[open + 3..];
            let rest = rest.strip_prefix("json").unwrap_or(rest);
            &rest[..rest.find("```").unwrap_or(rest.len())]
        }
        None => answer,
    };
    let (s, e) = (body.find('{')?, body.rfind('}')?);
    (e > s).then(|| &body[s..=e])
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 32 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Trimmed, on one line, at most `max` characters.
fn clean(text: &str, max: usize) -> String {
    let one: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    one.chars().take(max).collect()
}

/// Reads and checks an answer. `Ok` is the normalised document (labels trimmed and clipped);
/// `Err` lists every breach, phrased so the model can fix it.
pub fn check(answer: &str, ask: Ask, context: &str) -> Result<Spec, Vec<String>> {
    let Some(json) = json_of(answer) else {
        return Err(vec!["aucun document JSON : réponds par un bloc ```json``` contenant un seul objet".into()]);
    };
    let spec: Spec = serde_json::from_str(json).map_err(|e| vec![format!("JSON hors contrat : {e}")])?;
    let mut errors = Vec::new();
    let spec = match (ask, spec) {
        (Ask::Diagram, Spec::Graph { direction, nodes, edges, groups }) => {
            if nodes.is_empty() {
                errors.push("nodes est vide : au moins un nœud".into());
            }
            if nodes.len() > MAX_NODES {
                errors.push(format!("{} nœuds : au plus {MAX_NODES}", nodes.len()));
            }
            if edges.len() > MAX_EDGES {
                errors.push(format!("{} liens : au plus {MAX_EDGES}", edges.len()));
            }
            if groups.len() > MAX_GROUPS {
                errors.push(format!("{} groupes : au plus {MAX_GROUPS}", groups.len()));
            }
            let mut group_ids = HashSet::new();
            for (i, g) in groups.iter().enumerate() {
                if !valid_id(&g.id) {
                    errors.push(format!("groups[{i}].id « {} » : lettres, chiffres, _ ou - (32 au plus)", g.id));
                } else if !group_ids.insert(g.id.as_str()) {
                    errors.push(format!("groups[{i}].id « {} » est en double", g.id));
                }
            }
            let mut ids = HashSet::new();
            for (i, n) in nodes.iter().enumerate() {
                if !valid_id(&n.id) {
                    errors.push(format!("nodes[{i}].id « {} » : lettres, chiffres, _ ou - (32 au plus)", n.id));
                } else if !ids.insert(n.id.as_str()) {
                    errors.push(format!("nodes[{i}].id « {} » est en double", n.id));
                }
                if n.label.trim().is_empty() && n.shape != Shape::Text {
                    errors.push(format!("nodes[{i}].label est vide"));
                }
                if let Some(g) = n.group.as_deref().filter(|g| !group_ids.contains(g)) {
                    errors.push(format!("nodes[{i}].group « {g} » n'est pas l'id d'un groupe déclaré dans groups"));
                }
            }
            for (i, e) in edges.iter().enumerate() {
                for (side, id) in [("from", &e.from), ("to", &e.to)] {
                    if !ids.contains(id.as_str()) {
                        errors.push(format!("edges[{i}].{side} « {id} » n'est pas l'id d'un nœud déclaré dans nodes"));
                    }
                }
            }
            let nodes = nodes.into_iter().map(|n| Node { label: clean(&n.label, MAX_LABEL), ..n }).collect();
            let edges = edges.into_iter().map(|e| Edge { label: e.label.map(|l| clean(&l, MAX_LABEL)).filter(|l| !l.is_empty()), ..e }).collect();
            let groups = groups.into_iter().map(|g| Group { label: clean(&g.label, MAX_LABEL), ..g }).collect();
            Spec::Graph { direction, nodes, edges, groups }
        }
        (Ask::Diagram, Spec::Sequence { participants, messages }) => {
            if participants.len() < 2 || participants.len() > MAX_PARTICIPANTS {
                errors.push(format!("{} participants : entre 2 et {MAX_PARTICIPANTS}", participants.len()));
            }
            if messages.is_empty() || messages.len() > MAX_MESSAGES {
                errors.push(format!("{} messages : entre 1 et {MAX_MESSAGES}", messages.len()));
            }
            let mut ids = HashSet::new();
            for (i, p) in participants.iter().enumerate() {
                if !valid_id(&p.id) {
                    errors.push(format!("participants[{i}].id « {} » : lettres, chiffres, _ ou - (32 au plus)", p.id));
                } else if !ids.insert(p.id.as_str()) {
                    errors.push(format!("participants[{i}].id « {} » est en double", p.id));
                }
            }
            for (i, m) in messages.iter().enumerate() {
                for (side, id) in [("from", &m.from), ("to", &m.to)] {
                    if !ids.contains(id.as_str()) {
                        errors.push(format!("messages[{i}].{side} « {id} » n'est pas l'id d'un participant"));
                    }
                }
            }
            let participants = participants.into_iter().map(|p| Participant { label: clean(&p.label, MAX_LABEL), ..p }).collect();
            let messages = messages.into_iter().map(|m| Message { label: clean(&m.label, MAX_LABEL), ..m }).collect();
            Spec::Sequence { participants, messages }
        }
        (Ask::Annotate, Spec::Annotations { notes }) => {
            if notes.is_empty() || notes.len() > MAX_NOTES {
                errors.push(format!("{} annotations : entre 1 et {MAX_NOTES}", notes.len()));
            }
            let haystack = context.to_lowercase();
            for (i, n) in notes.iter().enumerate() {
                let anchor = n.anchor.trim().to_lowercase();
                if anchor.is_empty() || !haystack.contains(&anchor) {
                    errors.push(format!("notes[{i}].anchor « {} » ne figure pas sur le tableau : reprends mot pour mot un texte présent", n.anchor));
                }
                if n.note.trim().is_empty() {
                    errors.push(format!("notes[{i}].note est vide"));
                }
            }
            Spec::Annotations { notes: notes.into_iter().map(|n| Note { anchor: clean(&n.anchor, 200), note: clean(&n.note, MAX_NOTE) }).collect() }
        }
        (Ask::Diagram, Spec::Annotations { .. }) => return Err(vec!["un schéma est demandé : type « graph » ou « sequence », pas « annotations »".into()]),
        (Ask::Annotate, _) => return Err(vec!["ici, uniquement {\"type\":\"annotations\",\"notes\":[…]}".into()]),
    };
    if errors.is_empty() {
        Ok(spec)
    } else {
        Err(errors)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_graph_in_a_json_block_is_read_and_normalised() {
        let answer = "Voici :\n```json\n{\"type\":\"graph\",\"direction\":\"LR\",\"nodes\":[{\"id\":\"a\",\"label\":\"  Début \"},{\"id\":\"b\",\"label\":\"n > 0 ?\",\"shape\":\"diamond\"}],\"edges\":[{\"from\":\"a\",\"to\":\"b\",\"extra\":1}]}\n```";
        let Spec::Graph { direction, nodes, edges, .. } = check(answer, Ask::Diagram, "").unwrap() else { panic!("graph") };
        assert_eq!(direction, Direction::Lr);
        assert_eq!(nodes[0].label, "Début");
        assert_eq!(nodes[1].shape, Shape::Diamond);
        assert_eq!((edges[0].style, edges[0].arrow), (Line::Solid, Arrow::End), "defaults for what was left out");
    }

    #[test]
    fn invented_kinds_dangling_ids_and_other_languages_are_refused_with_what_to_fix() {
        // A shape that does not exist.
        let e = check(r#"{"type":"graph","nodes":[{"id":"a","label":"x","shape":"hexagon"}]}"#, Ask::Diagram, "").unwrap_err();
        assert!(e[0].contains("hexagon"), "{e:?}");
        // A link to a node that was never declared, and a duplicate id.
        let e = check(r#"{"type":"graph","nodes":[{"id":"a","label":"x"},{"id":"a","label":"y"}],"edges":[{"from":"a","to":"zz"}]}"#, Ask::Diagram, "").unwrap_err();
        assert!(e.iter().any(|m| m.contains("double")) && e.iter().any(|m| m.contains("« zz »")), "{e:?}");
        // Mermaid, or code, instead of the document.
        assert!(check("```mermaid\nflowchart TD\nA-->B\n```", Ask::Diagram, "").is_err());
        assert!(check("drawRect(0, 0, 10, 10)", Ask::Diagram, "").is_err());
        // A function call is not a type.
        assert!(check(r#"{"type":"draw","calls":["rect()"]}"#, Ask::Diagram, "").is_err());
    }

    #[test]
    fn limits_hold() {
        let nodes: Vec<String> = (0..MAX_NODES + 1).map(|i| format!("{{\"id\":\"n{i}\",\"label\":\"x\"}}")).collect();
        let e = check(&format!("{{\"type\":\"graph\",\"nodes\":[{}]}}", nodes.join(",")), Ask::Diagram, "").unwrap_err();
        assert!(e.iter().any(|m| m.contains("au plus 40")), "{e:?}");
    }

    #[test]
    fn sequences_need_declared_participants() {
        let ok = r#"{"type":"sequence","participants":[{"id":"c","label":"Client"},{"id":"s","label":"Serveur"}],"messages":[{"from":"c","to":"s","label":"GET /"},{"from":"s","to":"c","label":"200","reply":true}]}"#;
        assert!(matches!(check(ok, Ask::Diagram, ""), Ok(Spec::Sequence { .. })));
        let bad = r#"{"type":"sequence","participants":[{"id":"c","label":"Client"},{"id":"s","label":"Serveur"}],"messages":[{"from":"c","to":"db","label":"SELECT"}]}"#;
        assert!(check(bad, Ask::Diagram, "").unwrap_err()[0].contains("db"));
    }

    #[test]
    fn annotations_must_name_something_on_the_board() {
        let context = "Textes :\n- malloc(sizeof(node_t))\n- free(head)";
        let ok = r#"{"type":"annotations","notes":[{"anchor":"free(head)","note":"Libère aussi les maillons suivants."}]}"#;
        assert!(check(ok, Ask::Annotate, context).is_ok());
        let bad = r#"{"type":"annotations","notes":[{"anchor":"realloc","note":"x"}]}"#;
        assert!(check(bad, Ask::Annotate, context).unwrap_err()[0].contains("realloc"));
        assert!(check(r#"{"type":"graph","nodes":[]}"#, Ask::Annotate, context).is_err(), "only notes when notes are asked");
    }

    #[test]
    fn the_repair_request_lists_the_errors_and_repeats_the_contract() {
        let p = repair_prompt(Ask::Diagram, "{…}", &["edges[0].to « zz » n'est pas l'id d'un nœud".into()]);
        assert!(p.contains("« zz »") && p.contains("\"type\":\"graph\""));
        assert!(prompt(Ask::Diagram, "une pile", "").contains("au plus 40 nœuds"));
    }
}
