#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `tekboard mcp …`: the bridge Claude Code starts to reach TekBoard's tools (no window).
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("mcp") {
        std::process::exit(tekboard_lib::ai::mcp::main(&args[2..]));
    }
    tekboard_lib::run()
}
