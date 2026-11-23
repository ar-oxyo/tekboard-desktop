//! End-to-end check of Tika without a window: a real Claude Code turn, through the MCP bridge
//! and the tools socket, on a throwaway database.
//!
//! cargo run --example tika_e2e -- "<question>"   (uses the Claude Code installed here)
use std::sync::{Arc, Mutex};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    // Claude Code starts this same program as the MCP bridge.
    if args.get(1).map(String::as_str) == Some("mcp") {
        std::process::exit(tekboard_lib::ai::mcp::main(&args[2..]));
    }
    let question = args.get(1).cloned().unwrap_or_else(|| "Organise-moi ma journée mais laisse-moi du temps libre.".into());
    let base = std::env::temp_dir().join(format!("tika-e2e-{}", std::process::id()));
    std::fs::create_dir_all(&base).unwrap();
    let conn = tekboard_lib::db::open(&base.join("tekboard.db")).unwrap();
    // A small, realistic planning: one project with work left, a class tomorrow.
    tekboard_lib::planner::set_project(&conn, "/p/my_rpg", Some(3), Some(Some(600)), None).unwrap();
    let state: &'static tekboard_lib::commands::AppState = Box::leak(Box::new(tekboard_lib::commands::AppState::for_tests(Arc::new(Mutex::new(conn)), base.join("data"), base.join("cache"))));
    tekboard_lib::ai::ipc::serve_static(state).unwrap();
    // `--mouli <repo>` / `--tests <repo>`: an agent on a real repository instead of a conversation.
    let agent = args.iter().position(|a| a == "--mouli" || a == "--tests").map(|i| (args[i].clone(), std::path::PathBuf::from(&args[i + 1])));
    if let Some((what, repo)) = agent {
        let mut s = tekboard_lib::ai::chat::AiSettings::load(&state.conn());
        s.agent_model = std::env::var("AGENT_MODEL").unwrap_or_else(|_| "sonnet".into());
        s.agent_minutes = 10;
        s.save(&state.conn()).unwrap();
        let job = if what == "--mouli" { tekboard_lib::ai::agents::moulinette(state, repo).unwrap() } else { tekboard_lib::ai::agents::generate_tests(state, repo).unwrap() };
        let mut seen = 0;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(700));
            let v = state.jobs.get(job).unwrap();
            for e in &v.events[seen.min(v.events.len())..] {
                match e["kind"].as_str() {
                    Some("phase") => eprintln!("== {} : {}", e["phase"].as_str().unwrap_or(""), e["text"].as_str().unwrap_or("")),
                    Some("check") => eprintln!("  [check {}] {}", e["status"].as_str().unwrap_or(""), e["title"].as_str().unwrap_or("")),
                    Some("exec") => eprintln!("  $ {}", e["detail"].as_str().unwrap_or("")),
                    _ => {}
                }
            }
            seen = v.events.len();
            if v.status != "running" {
                println!("STATUS {}", v.status);
                for st in &v.steps {
                    println!("STEP {} {} {}", st.status, st.label, st.detail.clone().unwrap_or_default());
                }
                println!("COUNTS {}", v.summary.get("counts").cloned().unwrap_or_default());
                println!("VERDICT {}", v.summary.get("verdict").cloned().unwrap_or_default());
                if let Some(c) = v.summary.get("changes") {
                    println!("CHANGES {}", c.as_array().map(|a| a.iter().map(|x| x["path"].as_str().unwrap_or("").to_string()).collect::<Vec<_>>().join(", ")).unwrap_or_default());
                }
                println!("REPORT {}", v.summary.get("report").and_then(|r| r.as_str()).unwrap_or("-"));
                if let Some(e) = v.summary.get("error") {
                    println!("ERROR {e}");
                }
                break;
            }
        }
        let _ = std::fs::remove_dir_all(&base);
        return;
    }
    let screen = tekboard_lib::ai::chat::Screen { page: "today".into(), ..Default::default() };
    let (thread, job) = tekboard_lib::ai::chat::send(state, None, &question, &screen).unwrap();
    eprintln!("thread {thread}, job {job}: {question}");
    let mut seen = 0;
    loop {
        std::thread::sleep(std::time::Duration::from_millis(500));
        let v = state.jobs.get(job).unwrap();
        for e in &v.events[seen.min(v.events.len())..] {
            eprintln!("  · {} {} [{}]", e["label"].as_str().unwrap_or(e["kind"].as_str().unwrap_or("")), e["detail"].as_str().unwrap_or(""), e["status"].as_str().unwrap_or(""));
        }
        seen = v.events.len();
        if v.status != "running" {
            println!("STATUS {}", v.status);
            println!("REPLY {}", v.summary.get("reply").and_then(|r| r.as_str()).unwrap_or("-"));
            if let Some(e) = v.summary.get("error") {
                println!("ERROR {e}");
            }
            let c = state.conn();
            let n: i64 = c.query_row("SELECT COUNT(*) FROM ai_proposals", [], |r| r.get(0)).unwrap();
            let a: i64 = c.query_row("SELECT COUNT(*) FROM ai_actions", [], |r| r.get(0)).unwrap();
            let m: i64 = c.query_row("SELECT COUNT(*) FROM ai_memories", [], |r| r.get(0)).unwrap();
            println!("PROPOSALS {n} ACTIONS {a} MEMORIES {m}");
            if let Ok(p) = c.query_row("SELECT payload FROM ai_proposals ORDER BY id DESC LIMIT 1", [], |r| r.get::<_, String>(0)) {
                println!("LAST PROPOSAL {p}");
            }
            if args.iter().any(|a| a == "--log") {
                println!("{}", v.log);
            }
            break;
        }
    }
    let _ = std::fs::remove_dir_all(&base);
}
