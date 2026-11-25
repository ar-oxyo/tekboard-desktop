//! End-to-end check of an AI provider without a window, on a throwaway database.
//!
//! cargo run --example provider_e2e -- <none|claude|openrouter|ollama> <chat|json|read DIR|agent DIR> [question]
//!
//! - `MODEL`: the model to use (OpenRouter id, Ollama name).
//! - OpenRouter key: `OPENROUTER_API_KEY`, or `TEKBOARD_SECRETS=<data folder>` to use the key
//!   saved by the app (`~/.local/share/dev.tekboard.app`). The key is never printed.
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tekboard_lib::ai::{chat, runner};

fn wait(state: &tekboard_lib::commands::AppState, job: u64, log: bool) {
    let mut seen = 0;
    loop {
        std::thread::sleep(Duration::from_millis(400));
        let v = state.jobs.get(job).unwrap();
        for e in &v.events[seen.min(v.events.len())..] {
            if e["kind"] == "tool" {
                eprintln!("  · {} {} [{}]", e["label"].as_str().unwrap_or(""), e["detail"].as_str().unwrap_or(""), e["status"].as_str().unwrap_or(""));
            }
        }
        seen = v.events.len();
        if v.status != "running" {
            println!("STATUS {}", v.status);
            for k in ["reply", "answer", "structured", "error", "tokens", "noTools"] {
                if let Some(x) = v.summary.get(k) {
                    println!("{} {}", k.to_uppercase(), x.as_str().map(str::to_string).unwrap_or_else(|| x.to_string()));
                }
            }
            if log {
                println!("--- LOG ---\n{}", v.log);
            }
            return;
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("mcp") {
        std::process::exit(tekboard_lib::ai::mcp::main(&args[2..]));
    }
    let provider = args.get(1).cloned().unwrap_or_else(|| "none".into());
    let mode = args.get(2).cloned().unwrap_or_else(|| "chat".into());
    let log = args.iter().any(|a| a == "--log");
    let base = std::env::temp_dir().join(format!("provider-e2e-{}", std::process::id()));
    std::fs::create_dir_all(&base).unwrap();
    let conn = tekboard_lib::db::open(&base.join("tekboard.db")).unwrap();
    let state: &'static tekboard_lib::commands::AppState = Box::leak(Box::new(tekboard_lib::commands::AppState::for_tests(Arc::new(Mutex::new(conn)), base.join("data"), base.join("cache"))));
    tekboard_lib::ai::secrets::init(&std::env::var("TEKBOARD_SECRETS").map(std::path::PathBuf::from).unwrap_or_else(|_| base.join("data")));
    tekboard_lib::ai::ipc::serve_static(state).unwrap();
    let mut s = chat::AiSettings::load(&state.conn());
    s.provider = provider.clone();
    let model = std::env::var("MODEL").unwrap_or_default();
    match provider.as_str() {
        "openrouter" => s.openrouter_model = model,
        "ollama" => s.ollama_model = model,
        _ => {}
    }
    s.save(&state.conn()).unwrap();
    println!("PROVIDER {:?}", tekboard_lib::ai::provider::status());

    match mode.as_str() {
        "chat" => {
            let q = args.get(3).filter(|a| !a.starts_with("--")).cloned().unwrap_or_else(|| "Quels sont mes projets ? Réponds en une phrase.".into());
            let screen = chat::Screen { page: "today".into(), ..Default::default() };
            match chat::send(state, None, &q, &screen) {
                Ok((_, job)) => wait(state, job, log),
                Err(e) => println!("REFUSED {} {}", e.code(), e),
            }
        }
        "json" | "read" => {
            let dir = if mode == "read" { std::path::PathBuf::from(args.get(3).expect("read DIR")) } else { base.clone() };
            let mut req = if mode == "read" {
runner::Request::new(std::env::var("QUESTION").unwrap_or_else(|_| "Quel binaire ce projet produit-il (regarde le Makefile) et quelles fonctions sont définies dans ses fichiers .c ? Réponds en 3 lignes.".into()), runner::Tools::Read, Duration::from_secs(600))
            } else {
                runner::Request::new("Donne la capitale de la France et le nombre de lettres de son nom.", runner::Tools::None, Duration::from_secs(300))
            };
            if mode == "json" {
                req.json_schema = Some(r#"{"type":"object","properties":{"capitale":{"type":"string"},"lettres":{"type":"integer"}},"required":["capitale","lettres"]}"#.into());
            }
            if let Err(e) = tekboard_lib::ai::provider::require(tekboard_lib::ai::provider::Feature::ReadFiles) {
                println!("REFUSED {} {}", e.code(), e);
                return;
            }
            let job = state.jobs.start(state.db.clone(), "e2e", None, "e2e".into(), &[("run", "run")], move |job| {
                job.start("run");
                let (_o, a) = runner::run(job, &dir, &req, &mut |_| {})?;
                match &a {
                    Ok(a) => {
                        job.set("answer", &a.text);
                        if let Some(v) = &a.structured {
                            job.set("structured", v);
                        }
                    }
                    Err(e) => job.set("error", format!("{} {e}", e.code())),
                }
                runner::end_step(job, "run", &a, |_| String::new());
                Ok(if a.is_ok() { "success" } else { "failed" })
            });
            wait(state, job, log);
        }
        "agent" => {
            let repo = std::path::PathBuf::from(args.get(3).expect("agent DIR"));
            match tekboard_lib::ai::agents::moulinette(state, repo) {
                Ok(job) => wait(state, job, log),
                Err(e) => println!("REFUSED {} {}", e.code(), e),
            }
        }
        "models" => match tekboard_lib::ai::openrouter::models(true) {
            Ok(m) => {
                println!("MODELS {} (gratuits : {}, gratuits avec outils : {})", m.len(), m.iter().filter(|m| m.free).count(), m.iter().filter(|m| m.free && m.tools).count());
                for x in m.iter().filter(|m| m.recommended) {
                    println!("RECOMMENDED {} · {} k · outils {}", x.id, x.context / 1000, x.tools);
                }
                let paid = m.iter().find(|m| !m.free).map(|m| m.id.clone()).unwrap_or_default();
                println!("PAID-CHECK {paid}: {:?}", tekboard_lib::ai::openrouter::check_model(&m, &paid, false).map_err(|e| e.code()));
            }
            Err(e) => println!("ERROR {e}"),
        },
        "pull" => {
            let model = args.get(3).cloned().expect("pull MODEL");
            let job = state.jobs.start(state.db.clone(), "ollama_pull", Some(model.clone()), "pull".into(), &[("pull", "pull")], move |job| {
                job.start("pull");
                let r = tekboard_lib::ai::ollama::pull(job, tekboard_lib::ai::ollama::DEFAULT_URL, &model);
                job.set("answer", format!("{:?}", r.as_ref().map(|_| "ok").map_err(|e| e.to_string())));
                job.end("pull", if r.is_ok() { "success" } else { "failed" }, None);
                Ok(if r.is_ok() { "success" } else { "failed" })
            });
            wait(state, job, log);
            let info = tekboard_lib::ai::ollama::info(&tekboard_lib::ai::provider::current_settings());
            println!("INSTALLED {:?} RECOMMENDED {}", info.models.iter().map(|m| m.name.clone()).collect::<Vec<_>>(), info.recommended.model);
        }
        other => println!("unknown mode {other}"),
    }
    let _ = std::fs::remove_dir_all(&base);
}
