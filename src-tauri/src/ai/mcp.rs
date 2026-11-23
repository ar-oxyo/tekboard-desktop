//! `tekboard mcp --socket <path>`: the MCP server Claude Code starts (stdio, JSON-RPC 2.0, one
//! message per line). It only relays: `tools/list` and `tools/call` go to the running app over
//! its socket with the run's token (`TEKBOARD_TOKEN`), and the answer comes back as MCP content.

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;

const VERSIONS: &[&str] = &["2025-06-18", "2025-03-26", "2024-11-05"];

struct Link {
    token: String,
    socket: String,
    conn: Option<(UnixStream, BufReader<UnixStream>)>,
}

impl Link {
    fn ask(&mut self, op: &str, name: Option<&str>, args: Option<&Value>) -> Result<Value, String> {
        if self.conn.is_none() {
            let s = UnixStream::connect(&self.socket).map_err(|e| format!("TekBoard n'est pas joignable ({e}). Est-il ouvert ?"))?;
            let r = BufReader::new(s.try_clone().map_err(|e| e.to_string())?);
            self.conn = Some((s, r));
        }
        let (w, r) = self.conn.as_mut().ok_or("pas de connexion")?;
        let req = json!({"token": self.token, "op": op, "name": name, "args": args});
        let sent = w.write_all(format!("{req}\n").as_bytes());
        let mut line = String::new();
        if sent.is_err() || r.read_line(&mut line).unwrap_or(0) == 0 {
            self.conn = None;
            return Err("La connexion à TekBoard a été coupée.".into());
        }
        let v: Value = serde_json::from_str(&line).map_err(|_| "réponse illisible de TekBoard".to_string())?;
        if v["ok"].as_bool() == Some(true) {
            Ok(v["result"].clone())
        } else {
            Err(v["error"].as_str().unwrap_or("erreur inconnue").to_string())
        }
    }
}

/// Answer to one JSON-RPC message, or `None` for a notification.
fn reply(link: &mut Link, msg: &Value) -> Option<Value> {
    let id = msg.get("id").cloned();
    let method = msg["method"].as_str().unwrap_or_default();
    let id = id?;
    let result = match method {
        "initialize" => {
            let asked = msg["params"]["protocolVersion"].as_str().unwrap_or_default();
            let version = if VERSIONS.contains(&asked) { asked } else { VERSIONS[0] };
            Ok(json!({"protocolVersion": version, "capabilities": {"tools": {"listChanged": false}}, "serverInfo": {"name": "tekboard", "version": env!("CARGO_PKG_VERSION")}}))
        }
        "ping" => Ok(json!({})),
        "tools/list" => link.ask("list", None, None).map(|tools| json!({"tools": tools})).map_err(|e| (-32603, e)),
        "tools/call" => {
            let name = msg["params"]["name"].as_str().unwrap_or_default();
            let args = msg["params"].get("arguments").cloned().unwrap_or(json!({}));
            // A refused or failed tool is a tool result with isError (Claude reads it and adapts),
            // not a protocol error.
            Ok(match link.ask("call", Some(name), Some(&args)) {
                Ok(v) => json!({"content": [{"type": "text", "text": v.to_string()}], "isError": false}),
                Err(e) => json!({"content": [{"type": "text", "text": e}], "isError": true}),
            })
        }
        "resources/list" => Ok(json!({"resources": []})),
        "prompts/list" => Ok(json!({"prompts": []})),
        _ => Err((-32601, format!("méthode inconnue : {method}"))),
    };
    Some(match result {
        Ok(r) => json!({"jsonrpc": "2.0", "id": id, "result": r}),
        Err((code, message)) => json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}}),
    })
}

/// Entry point of `tekboard mcp`. Returns the process exit code.
pub fn main(args: &[String]) -> i32 {
    let socket = args.iter().position(|a| a == "--socket").and_then(|i| args.get(i + 1)).cloned().unwrap_or_default();
    let token = std::env::var("TEKBOARD_TOKEN").unwrap_or_default();
    if socket.is_empty() || token.is_empty() {
        eprintln!("usage: tekboard mcp --socket <path> (TEKBOARD_TOKEN required)");
        return 2;
    }
    let mut link = Link { token, socket, conn: None };
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let out = match serde_json::from_str::<Value>(&line) {
            Ok(Value::Array(batch)) => {
                let answers: Vec<Value> = batch.iter().filter_map(|m| reply(&mut link, m)).collect();
                (!answers.is_empty()).then(|| Value::Array(answers))
            }
            Ok(msg) => reply(&mut link, &msg),
            Err(_) => Some(json!({"jsonrpc": "2.0", "id": null, "error": {"code": -32700, "message": "JSON illisible"}})),
        };
        if let Some(o) = out {
            if writeln!(stdout, "{o}").and_then(|_| stdout.flush()).is_err() {
                break;
            }
        }
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::net::UnixListener;

    #[test]
    fn json_rpc_round_trip_through_a_fake_app() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.sock");
        let listener = UnixListener::bind(&path).unwrap();
        std::thread::spawn(move || {
            let (s, _) = listener.accept().unwrap();
            let mut w = s.try_clone().unwrap();
            for line in BufReader::new(s).lines() {
                let req: Value = serde_json::from_str(&line.unwrap()).unwrap();
                let ans = match (req["token"].as_str(), req["op"].as_str()) {
                    (Some("t"), Some("list")) => json!({"ok": true, "result": [{"name": "get_today", "description": "d", "inputSchema": {"type": "object"}}]}),
                    (Some("t"), Some("call")) if req["name"] == "get_today" => json!({"ok": true, "result": {"jour": "lundi 2"}}),
                    _ => json!({"ok": false, "error": "refusé"}),
                };
                writeln!(w, "{ans}").unwrap();
            }
        });
        let mut link = Link { token: "t".into(), socket: path.to_string_lossy().into_owned(), conn: None };
        let init = reply(&mut link, &json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}})).unwrap();
        assert_eq!(init["result"]["protocolVersion"], "2025-06-18");
        assert!(reply(&mut link, &json!({"jsonrpc": "2.0", "method": "notifications/initialized"})).is_none(), "notifications get no answer");
        let list = reply(&mut link, &json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})).unwrap();
        assert_eq!(list["result"]["tools"][0]["name"], "get_today");
        let ok = reply(&mut link, &json!({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "get_today", "arguments": {}}})).unwrap();
        assert_eq!(ok["result"]["isError"], false);
        assert!(ok["result"]["content"][0]["text"].as_str().unwrap().contains("lundi 2"));
        let refused = reply(&mut link, &json!({"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "rm_rf", "arguments": {}}})).unwrap();
        assert_eq!(refused["result"]["isError"], true);
        let unknown = reply(&mut link, &json!({"jsonrpc": "2.0", "id": 5, "method": "nope"})).unwrap();
        assert_eq!(unknown["error"]["code"], -32601);
    }
}
