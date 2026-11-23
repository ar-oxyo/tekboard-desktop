//! TekBoard's assistant (Tika) and every use of Claude Code.
//!
//! - `runner`: the one way Claude Code is started (isolated, streamed, cancellable).
//! - `stream`: reading Claude Code's stream-json output.
//! - `sandbox`: commands an agent runs, inside bubblewrap.
//! - `tools`: the actions Tika can take in TekBoard, with their risk level.

pub mod agent_tools;
pub mod chat;
pub mod ipc;
pub mod mcp;
pub mod memory;
pub mod runner;
pub mod sandbox;
pub mod stream;
pub mod tools;
