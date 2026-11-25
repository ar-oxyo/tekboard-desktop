//! TekBoard's assistant (Artix) and every use of an AI.
//!
//! - `provider`: which AI answers (none, Claude Code, OpenRouter, Ollama) and what it can do.
//! - `runner`: the one way a request runs; Claude Code is started there (isolated, streamed,
//!   cancellable), OpenRouter and Ollama go through `openai` and `toolloop`.
//! - `fstools`: reading a project for models other than Claude Code.
//! - `secrets`: API keys, kept out of the settings.
//! - `stream`: reading Claude Code's stream-json output.
//! - `sandbox`: commands an agent runs, inside bubblewrap.
//! - `tools`: the actions Artix can take in TekBoard, with their risk level.

pub mod agent_tools;
pub mod agents;
pub mod chat;
pub mod fstools;
pub mod insights;
pub mod ipc;
pub mod mcp;
pub mod memory;
pub mod ollama;
pub mod openai;
pub mod openrouter;
pub mod provider;
pub mod runner;
pub mod sandbox;
pub mod secrets;
pub mod stream;
pub mod subject;
pub mod toolloop;
pub mod tools;
pub mod workcopy;
