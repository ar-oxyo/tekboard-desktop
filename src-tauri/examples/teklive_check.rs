//! End-to-end check of TekLive with a real VS Code, isolated from the user's own setup:
//!   cargo run --example teklive_check -- <folder> <extensions-dir> <user-data-dir> [vsix-out]
//! Writes the TekBoard Bridge package (when `vsix-out` is given), starts the relay on the LAN
//! address, leaves a bridge request for `folder`, opens VS Code with the isolated folders and
//! prints what the relay sees for 120 s (room, peers, invitation link).

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() < 3 {
        eprintln!("usage: teklive_check <folder> <extensions-dir> <user-data-dir> [vsix-out]");
        std::process::exit(2);
    }
    let (folder, ext_dir, data_dir) = (PathBuf::from(&args[0]), &args[1], &args[2]);
    if let Some(out) = args.get(3) {
        std::fs::write(out, tekboard_lib::teklive::bridge_vsix().unwrap()).unwrap();
        println!("bridge package written to {out}");
        return;
    }
    let ip = tekboard_lib::connect::netdiag::default_ip().map(std::net::IpAddr::V4).expect("no network");
    let relay = tekboard_lib::teklive::relay::Relay::start(ip, None, Arc::new(|s: &tekboard_lib::teklive::relay::RelayState| println!("relay: room={:?} peers={:?}", s.room, s.peers))).await.unwrap();
    let server = format!("ws://{}", relay.addr);
    println!("relay listening on {server}");
    let req = tekboard_lib::teklive::write_request(&folder, serde_json::json!({"action": "host", "server": server, "userName": "TekBoard check"})).unwrap();
    println!("bridge request: {}", req.display());
    let _code = std::process::Command::new("code").args(["--ozone-platform=x11", "--extensions-dir", ext_dir, "--user-data-dir", data_dir, "--new-window", "--disable-workspace-trust", &folder.to_string_lossy()]).spawn().unwrap();
    for _ in 0..120 {
        tokio::time::sleep(Duration::from_secs(1)).await;
        let s = relay.state();
        if let Some(room) = &s.room {
            println!("LINK {}", tekboard_lib::teklive::link_of(room, &relay.addr));
        }
    }
    relay.stop();
}
