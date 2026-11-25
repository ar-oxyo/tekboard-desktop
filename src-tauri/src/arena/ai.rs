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
Procède dans l'ordre, sans lire plus que nécessaire : 1) le point d'entrée et la lecture des entrées, pour connaître le format exact attendu ; 2) les fonctions qui traitent ces données.\n\
Écris le MINIMUM de fichiers : la qualité compte, pas la quantité. Règles strictes :\n\
- un générateur est un fichier Python (.py, bibliothèque standard seulement) ou C (.c), appelé `gen N SEED SORTIE` : il écrit dans le fichier SORTIE des données de taille N, de façon reproductible avec SEED (même N et même SEED = même fichier) ;\n\
- un seul générateur suffit le plus souvent ; au plus 3 scénarios, et un fichier de plus seulement si les données ont une autre forme ;\n\
- pas d'accès réseau, pas de fichiers en dehors de SORTIE, pas de fichier d'aide ni de README ;\n\
- 5 à 8 tailles par scénario, croissantes d'un facteur 2, de petites (quelques millisecondes) à assez grandes (une à quelques secondes) : TekBoard teste d'abord les générateurs sur une petite taille, puis s'arrête de lui-même à la limite de temps ;\n\
- un cas limite (données déjà triées, toutes égales…) seulement s'il peut changer la complexité ;\n\
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
    let mut g = parse_tail(&answer.text, &files);
    if let Some(parent) = dir.parent() {
        if check_generators(job, &parent.join("gen-check"), &mut g)? {
            return Ok("cancelled");
        }
    }
    job.set("generated", &g);
    job.event(json!({"kind": "arena", "type": "generated", "files": g.files.len(), "scenarios": g.scenarios.len()}));
    if g.scenarios.is_empty() {
        job.end("generate", "failed", Some("aucun scénario utilisable".into()));
        return Ok("failed");
    }
    job.end("generate", if g.rejected.is_empty() { "success" } else { "warning" }, Some(format!("{} fichier(s), {} scénario(s)", g.files.len(), g.scenarios.len())));
    Ok(if g.rejected.is_empty() { "success" } else { "warning" })
}

/// Runs each generator a scenario uses at a small size, twice with the same seed, in the
/// sandbox: a generator that fails, writes nothing or is not reproducible is set aside with
/// the reason, before anyone uses it. Returns true when the job was cancelled.
fn check_generators(job: &Job, work: &Path, g: &mut Generated) -> Result<bool> {
    use crate::ai::sandbox::Limits;
    if g.scenarios.iter().all(|s| s.generator.is_none()) || crate::ai::sandbox::check().is_err() {
        return Ok(false);
    }
    std::fs::create_dir_all(work)?;
    crate::playground::materialize(&g.files, work)?;
    let limits = Limits { wall: Duration::from_secs(20), cpu_seconds: 30, file_mb: 64, output_cap: 16 * 1024, mem_mb: Some(1024), tasks: Some(32), address_space_free: false };
    let mut verdicts: std::collections::HashMap<(String, u64), std::result::Result<(), String>> = std::collections::HashMap::new();
    let mut kept = Vec::new();
    for sc in std::mem::take(&mut g.scenarios) {
        let Some(gen) = sc.generator.clone() else {
            kept.push(sc);
            continue;
        };
        let n = sc.sizes.first().copied().unwrap_or(16).min(64);
        let key = (gen.clone(), n);
        if !verdicts.contains_key(&key) {
            let path = work.join(&gen);
            let base: Vec<String> = if gen.ends_with(".py") {
                vec!["python3".into(), path.to_string_lossy().into_owned()]
            } else {
                let bin = work.join(format!("{gen}.bin"));
                let out = super::exec(job, work, &["cc".into(), "-O1".into(), "-o".into(), bin.to_string_lossy().into_owned(), path.to_string_lossy().into_owned(), "-lm".into()], None, &limits, false)?;
                if out.cancelled {
                    return Ok(true);
                }
                if !out.ok() {
                    verdicts.insert(key.clone(), Err(format!("{gen} ne compile pas")));
                }
                vec![bin.to_string_lossy().into_owned()]
            };
            if !verdicts.contains_key(&key) {
                let mut texts = Vec::new();
                for i in 0..2 {
                    let file = work.join(format!("{gen}.{n}.{i}.txt"));
                    let mut argv = base.clone();
                    argv.extend([n.to_string(), sc.seed.to_string(), file.to_string_lossy().into_owned()]);
                    let out = super::exec(job, work, &argv, None, &limits, false)?;
                    if out.cancelled {
                        return Ok(true);
                    }
                    texts.push(if out.ok() { std::fs::read(&file).ok() } else { None });
                }
                let verdict = match (&texts[0], &texts[1]) {
                    (Some(a), Some(b)) if a.is_empty() || b.is_empty() => Err(format!("{gen} n'écrit rien pour n={n}")),
                    (Some(a), Some(b)) if a != b => Err(format!("{gen} donne deux fichiers différents pour la même graine")),
                    (Some(_), Some(_)) => Ok(()),
                    _ => Err(format!("{gen} échoue pour n={n}")),
                };
                verdicts.insert(key.clone(), verdict);
            }
        }
        match &verdicts[&key] {
            Ok(()) => kept.push(sc),
            Err(why) => g.rejected.push(format!("scénario « {} » écarté : {why}", sc.name)),
        }
    }
    g.scenarios = kept;
    job.log(&format!("Générateurs testés : {} scénario(s) gardé(s), {} écarté(s).", g.scenarios.len(), g.rejected.len()));
    let _ = std::fs::remove_dir_all(work);
    Ok(false)
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
    fn generators_are_tried_before_being_offered() {
        if crate::toolenv::which("python3").is_none() || crate::ai::sandbox::check().is_err() {
            return;
        }
        let sc = |name: &str, gen: &str| Scenario { name: name.into(), generator: Some(gen.into()), sizes: vec![1000, 2000], seed: 3, args: "{input}".into(), stdin: false };
        let f = |name: &str, content: &str| DraftFile { name: name.into(), content: content.into(), library: None };
        let good = "import random, sys\nn, s, out = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]\nrandom.seed(s)\nopen(out, 'w').write(' '.join(str(random.randint(0, 9)) for _ in range(n)))\n";
        let noisy = "import random, sys, time\nn, s, out = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]\nrandom.seed(time.time_ns())\nopen(out, 'w').write(' '.join(str(random.randint(0, 10**9)) for _ in range(n)))\n";
        let broken = "import sys\nraise SystemExit(3)\n";
        let mut g = Generated { files: vec![f("good.py", good), f("noisy.py", noisy), f("broken.py", broken)], scenarios: vec![sc("ok", "good.py"), sc("ok bis", "good.py"), sc("bruit", "noisy.py"), sc("cassé", "broken.py")], ..Default::default() };
        let jobs = crate::jobs::Jobs::default();
        let db = std::sync::Arc::new(std::sync::Mutex::new(crate::db::open_in_memory().unwrap()));
        let tmp = tempfile::tempdir().unwrap();
        let work = tmp.path().join("check");
        let (tx, rx) = std::sync::mpsc::channel();
        jobs.start(db, "arena_ai", None, "t".into(), &[("generate", "x")], move |job| {
            let cancelled = check_generators(job, &work, &mut g)?;
            tx.send((cancelled, g)).unwrap();
            Ok("success")
        });
        let (cancelled, g) = rx.recv_timeout(Duration::from_secs(60)).unwrap();
        assert!(!cancelled);
        assert_eq!(g.scenarios.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(), ["ok", "ok bis"]);
        assert!(g.rejected.iter().any(|r| r.contains("bruit") && r.contains("graine")), "{:?}", g.rejected);
        assert!(g.rejected.iter().any(|r| r.contains("cassé") && r.contains("échoue")), "{:?}", g.rejected);
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
