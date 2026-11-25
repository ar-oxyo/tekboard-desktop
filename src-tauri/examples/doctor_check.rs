//! TekBoard Doctor without a window, on a throwaway database: one line per check.
//! cargo run --example doctor_check   (run it with a reduced PATH to simulate missing tools)
use std::sync::{Arc, Mutex};

fn main() {
    let base = std::env::temp_dir().join(format!("doctor-check-{}", std::process::id()));
    std::fs::create_dir_all(base.join("data")).unwrap();
    let conn = tekboard_lib::db::open(&base.join("data/tekboard.db")).unwrap();
    let state = tekboard_lib::commands::AppState::for_tests(Arc::new(Mutex::new(conn)), base.join("data"), base.join("cache"));
    tekboard_lib::ai::secrets::init(&base.join("data"));
    let facts = tekboard_lib::doctor::diagnosis::Facts { version: "0.7.0".into(), my_connected: false, my_last_sync: None, my_stored: false, update: Err("not checked".into()), update_enabled: false, deep: false };
    let r = tekboard_lib::doctor::diagnosis::run(&state, &facts);
    for c in &r.checks {
        println!("{:<14} {:<13} {} {}", c.id, format!("{:?}", c.status), c.detail, c.command.as_deref().map(|x| format!("[{x}]")).unwrap_or_default());
    }
    let _ = std::fs::remove_dir_all(&base);
}
