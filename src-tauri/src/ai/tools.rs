//! Registry of the tools TekBoard exposes to Claude Code over MCP.

/// French label of a TekBoard tool, for the activity feed.
pub fn label(tool: &str) -> Option<String> {
    let l = match tool {
        "exec" => "Commande (bac à sable)",
        _ => return None,
    };
    Some(l.to_string())
}
