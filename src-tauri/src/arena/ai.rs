//! Artix in the Arena, on request only:
//! - building a benchmark environment (data generators, scenarios) for a program, written
//!   as it streams so the screen shows each file the moment it is complete; nothing runs
//!   until the user has looked at the files and started the benchmark;
//! - writing the final report from the measured results alone, each claim tied to a
//!   measurement or labelled as a hypothesis.

use super::{BenchConfig, Scenario};
use crate::ai::runner::{self, Request, Tools};
use crate::ai::stream::Event;
use crate::error::{AppError, Result};
use crate::jobs::Job;
use crate::playground::DraftFile;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::Path;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiHypothesis {
    #[serde(default)]
    pub function: String,
    #[serde(default)]
    pub file: String,
    #[serde(default)]
    pub line: Option<u64>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Generated {
    pub files: Vec<DraftFile>,
    pub scenarios: Vec<Scenario>,
    pub hypotheses: Vec<AiHypothesis>,
    /// Files or scenarios dropped because they broke the rules (names, sizes…).
    pub rejected: Vec<String>,
}

pub fn generation_prompt(config: &BenchConfig, focus: &str) -> String {
    let program = config.variants.first().map(|v| if v.program.is_empty() { "le programme du brouillon".to_string() } else { v.program.clone() }).unwrap_or_default();
    format!(
        "Tu prépares un benchmark pour le programme C de ce dossier ({program}). {focus}\n\n\
Lis le code pour comprendre ce que le programme attend en entrée et quelles fonctions risquent d'être lentes.\n\
Écris des générateurs de données et des scénarios de taille croissante. Règles strictes :\n\
- un générateur est un fichier Python (.py, bibliothèque standard seulement) ou C (.c), appelé `gen N SEED SORTIE` : il écrit dans le fichier SORTIE des données de taille N, de façon reproductible avec SEED ;\n\
- pas d'accès réseau, pas de fichiers en dehors de SORTIE ;\n\
- 4 à 8 tailles par scénario, croissantes et assez espacées (facteur 2 par exemple), assez grandes pour durer de quelques millisecondes à quelques secondes ;\n\
- prévois aussi des cas limites (données déjà triées, toutes égales, vides…) quand c'est pertinent ;\n\
- `args` donne les arguments du programme, sans shell : `{{input}}` est remplacé par le chemin du fichier de données, `{{n}}` par la taille, `{{seed}}` par la graine ; `stdin: true` donne le fichier sur l'entrée standard.\n\n\
Format de réponse OBLIGATOIRE. Chaque fichier ainsi :\n\
=== FILE nom_du_fichier.py\n\
(contenu)\n\
=== END\n\n\
Puis un seul bloc ```json``` :\n\
{{\"scenarios\": [{{\"name\": \"…\", \"generator\": \"nom_du_fichier.py\", \"sizes\": [1000, 2000, 4000, 8000], \"seed\": 42, \"args\": \"{{input}}\", \"stdin\": false}}],\n\
 \"hypotheses\": [{{\"function\": \"…\", \"file\": \"…\", \"line\": 12, \"message\": \"pourquoi elle pourrait être lente (hypothèse, pas une mesure)\"}}]}}\n\
N'invente aucune mesure : tu n'as rien exécuté. Écris en français."
    )
}

/// Reads files out of a streamed answer: each `=== FILE name` … `=== END` block, once complete.
#[derive(Default)]
pub struct StreamFiles {
    buf: String,
    done: usize,
}

impl StreamFiles {
    /// Adds text and returns the files completed by it.
    pub fn feed(&mut self, text: &str) -> Vec<DraftFile> {
        self.buf.push_str(text);
        let mut out = Vec::new();
        loop {
            let rest = &self.buf[self.done..];
            let Some(start) = rest.find("=== FILE ") else { break };
            let after = &rest[start + 9..];
            let Some(nl) = after.find('\n') else { break };
            let name = after[..nl].trim().trim_matches('`').to_string();
            let body = &after[nl + 1..];
            let Some(end) = body.find("=== END") else { break };
            let mut content = body[..end].to_string();
            // A code fence around the content is tolerated.
            let trimmed = content.trim();
            if trimmed.starts_with("```") {
                let inner = trimmed.split_once('\n').map(|x| x.1).unwrap_or("");
                content = inner.trim_end().trim_end_matches("```").to_string();
            }
            if !content.ends_with('\n') {
                content.push('\n');
            }
            self.done += start + 9 + nl + 1 + end + 7;
            out.push(DraftFile { name, content, library: None });
        }
        out
    }
}

/// The scenarios and hypotheses of the final JSON block, checked against the files.
pub fn parse_tail(answer: &str, files: &[DraftFile]) -> Generated {
    let mut g = Generated { files: Vec::new(), ..Default::default() };
    for f in files {
        if crate::playground::validate(std::slice::from_ref(f)).is_ok() && (f.name.ends_with(".py") || f.name.ends_with(".c") || f.name.ends_with(".h") || f.name.ends_with(".txt")) {
            if !g.files.iter().any(|x| x.name == f.name) {
                g.files.push(f.clone());
            }
        } else {
            g.rejected.push(format!("fichier « {} » refusé (nom ou taille)", f.name));
        }
    }
    let body = crate::claude::fenced(answer, "json");
    let (Some(s), Some(e)) = (body.find('{'), body.rfind('}')) else {
        g.rejected.push("pas de bloc JSON de scénarios dans la réponse".into());
        return g;
    };
    let v: Value = serde_json::from_str(&body[s..=e]).unwrap_or(Value::Null);
    for raw in v["scenarios"].as_array().into_iter().flatten().take(6) {
        match serde_json::from_value::<Scenario>(raw.clone()) {
            Ok(mut sc) => {
                sc.sizes.retain(|n| *n > 0 && *n <= 1_000_000_000);
                sc.sizes.sort_unstable();
                sc.sizes.dedup();
                sc.sizes.truncate(12);
                let gen_ok = sc.generator.as_ref().is_none_or(|g2| g.files.iter().any(|f| &f.name == g2));
                if sc.sizes.is_empty() || !gen_ok || crate::jobs::split_command(&sc.args).is_err() {
                    g.rejected.push(format!("scénario « {} » refusé (tailles, générateur ou arguments)", sc.name));
                } else {
                    g.scenarios.push(sc);
                }
            }
            Err(e) => g.rejected.push(format!("scénario illisible : {e}")),
        }
    }
    g.hypotheses = v["hypotheses"].as_array().into_iter().flatten().filter_map(|h| serde_json::from_value(h.clone()).ok()).take(20).collect();
    g
}

/// Artix writes the benchmark environment in `dir` (a read-only copy of the program).
pub fn generate_in_job(job: &Job, dir: &Path, config: &BenchConfig, focus: &str) -> Result<&'static str> {
    job.start("generate");
    let mut req = Request::new(generation_prompt(config, focus), Tools::Read, Duration::from_secs(600));
    req.partial = true;
    let mut stream = StreamFiles::default();
    let mut files: Vec<DraftFile> = Vec::new();
    let mut saw_delta = false;
    let (outcome, answer) = runner::run(job, dir, &req, &mut |ev| {
        let text = match ev {
            Event::Delta(t) => {
                saw_delta = true;
                Some(t.as_str())
            }
            Event::Text(t) if !saw_delta => Some(t.as_str()),
            _ => None,
        };
        if let Some(t) = text {
            for f in stream.feed(t) {
                job.event(json!({"kind": "arena", "type": "file", "name": f.name, "bytes": f.content.len(), "source": "artix"}));
                files.push(f);
                job.set("generatedFiles", &files);
            }
        }
    })?;
    if outcome.cancelled {
        return Ok("cancelled");
    }
    let answer = answer?;
    // Providers that do not stream give the whole text at the end.
    if files.is_empty() {
        let mut s = StreamFiles::default();
        files = s.feed(&answer.text);
    }
    let g = parse_tail(&answer.text, &files);
    job.set("generated", &g);
    job.event(json!({"kind": "arena", "type": "generated", "files": g.files.len(), "scenarios": g.scenarios.len()}));
    if g.scenarios.is_empty() {
        job.end("generate", "failed", Some("aucun scénario utilisable".into()));
        return Ok("failed");
    }
    job.end("generate", if g.rejected.is_empty() { "success" } else { "warning" }, Some(format!("{} fichier(s), {} scénario(s)", g.files.len(), g.scenarios.len())));
    Ok(if g.rejected.is_empty() { "success" } else { "warning" })
}

/// What the report is written from: the measured results, trimmed to what matters.
pub fn report_facts(results: &Value) -> Value {
    let series: Vec<Value> = results["series"].as_array().into_iter().flatten().map(|s| {
        json!({
            "variant": results["variants"][s["variant"].as_u64().unwrap_or(0) as usize],
            "scenario": results["config"]["scenarios"][s["scenario"].as_u64().unwrap_or(0) as usize]["name"],
            "points": s["points"].as_array().into_iter().flatten().map(|p| json!({"n": p["n"], "wallMsMedian": p["wall"]["median"], "wallMsMad": p["wall"]["mad"], "cpuMsMedian": p["cpu"]["median"], "maxRssKb": p["maxRssKb"], "ir": p["ir"], "runs": p["samples"].as_array().map(|a| a.len()), "outliers": p["wall"]["outliers"], "failed": p["failed"]})).collect::<Vec<_>>(),
            "fitTime": s["fitTime"],
            "fitInstructions": s["fitIr"],
            "hotFunctions": s["hot"]["functions"].as_array().map(|a| a.iter().take(8).cloned().collect::<Vec<_>>()),
            "profiledAtN": s["profiledN"],
            "heapPeakBytes": s["heapPeak"],
            "heap": s["heap"],
        })
    }).collect();
    json!({ "series": series, "staticHypotheses": results["hypotheses"], "notes": results["notes"], "machine": results["machine"] })
}

pub fn report_prompt(facts: &Value) -> String {
    format!(
        "Voici les résultats MESURÉS d'un benchmark (TekBoard Algorithm Arena), en JSON :\n```json\n{}\n```\n\n\
Écris le rapport final en français, en Markdown, avec exactement ces sections :\n\
## Ce qui ralentit réellement le programme\n## Les preuves\n## Les limites des mesures\n## Optimisations envisageables\n## Compromis\n\n\
Règles : chaque affirmation sur la vitesse cite une valeur du JSON (taille, médiane, instructions, fonction) ; ce qui ne vient pas des mesures est marqué « Hypothèse : ». \
N'invente aucun chiffre. Les hypothèses statiques (staticHypotheses) ne sont que des pistes : dis lesquelles les mesures confirment ou non. \
La complexité estimée (fitTime, fitInstructions) a un niveau de confiance : respecte-le. Ne modifie et ne réécris pas le programme : propose, avec les compromis vitesse / mémoire / lisibilité.",
        serde_json::to_string_pretty(facts).unwrap_or_default()
    )
}

pub fn report_in_job(job: &Job, dir: &Path, results: &Value) -> Result<&'static str> {
    if results["series"].as_array().is_none_or(|s| s.is_empty()) {
        return Err(AppError::new("no_results", "Aucun résultat à commenter"));
    }
    job.start("report");
    let mut req = Request::new(report_prompt(&report_facts(results)), Tools::None, Duration::from_secs(300));
    req.partial = true;
    let (outcome, answer) = runner::run(job, dir, &req, &mut |_| {})?;
    if outcome.cancelled {
        return Ok("cancelled");
    }
    let answer = answer?;
    job.set("report", answer.text.trim());
    job.end("report", "success", None);
    Ok("success")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn files_appear_as_soon_as_they_are_complete() {
        let mut s = StreamFiles::default();
        assert!(s.feed("Je lis le code…\n=== FILE gen.py\nimport sys\n").is_empty());
        let got = s.feed("print(1)\n=== END\n\n=== FILE edge.py\n```python\nprint(2)\n```\n=== EN");
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].name, "gen.py");
        assert_eq!(got[0].content, "import sys\nprint(1)\n");
        let got = s.feed("D\nfin");
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].content, "print(2)\n");
    }

    #[test]
    fn the_json_tail_is_checked() {
        let files = vec![DraftFile { name: "gen.py".into(), content: "x\n".into(), library: None }, DraftFile { name: "../evil.py".into(), content: "x".into(), library: None }];
        let answer = "…\n```json\n{\"scenarios\": [{\"name\": \"aléatoire\", \"generator\": \"gen.py\", \"sizes\": [4000, 1000, 2000, 0, 1000], \"seed\": 1, \"args\": \"{input}\"}, {\"name\": \"bad\", \"generator\": \"nope.py\", \"sizes\": [1]}, {\"name\": \"shell\", \"sizes\": [1], \"args\": \"a | b\"}], \"hypotheses\": [{\"function\": \"bubble\", \"file\": \"sort.c\", \"line\": 3, \"message\": \"double boucle\"}]}\n```";
        let g = parse_tail(answer, &files);
        assert_eq!(g.files.len(), 1);
        assert_eq!(g.scenarios.len(), 1);
        assert_eq!(g.scenarios[0].sizes, vec![1000, 2000, 4000]);
        assert_eq!(g.hypotheses[0].function, "bubble");
        assert_eq!(g.rejected.len(), 3, "{:?}", g.rejected);
        assert!(parse_tail("no json here", &[]).rejected.iter().any(|r| r.contains("JSON")));
    }

    #[test]
    fn the_report_is_built_from_measurements_only() {
        let results = json!({"variants": ["A"], "config": {"scenarios": [{"name": "s"}]}, "series": [{"variant": 0, "scenario": 0, "points": [{"n": 10, "wall": {"median": 1.5, "mad": 0.1, "outliers": []}, "samples": [{}, {}]}], "fitTime": {"model": "O(n)"}}], "hypotheses": [], "notes": []});
        let f = report_facts(&results);
        assert_eq!(f["series"][0]["variant"], "A");
        assert_eq!(f["series"][0]["points"][0]["wallMsMedian"], 1.5);
        assert_eq!(f["series"][0]["points"][0]["runs"], 2);
        let p = report_prompt(&f);
        assert!(p.contains("Hypothèse") && p.contains("N'invente aucun chiffre"));
    }
}
