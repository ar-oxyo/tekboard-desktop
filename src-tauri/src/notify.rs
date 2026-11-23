//! Backend → window events. Two kinds only:
//! - `data-changed` with the list of data domains that changed (`plan`, `repos`, `focus`,
//!   `memory`, `insights`, `runs`, `subjects`, `my`, `libraries`…). The window maps each
//!   domain to the queries it must re-read, so every screen stays current without a refresh.
//! - `job-progress` with a job id: the window fetches what is new in that job.
//!
//! Outside the app (unit tests, the MCP bridge) there is no window and every call is a no-op.

use serde::Serialize;
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

static APP: OnceLock<AppHandle> = OnceLock::new();

pub fn init(app: AppHandle) {
    let _ = APP.set(app);
}

pub fn app() -> Option<&'static AppHandle> {
    APP.get()
}

/// Tells the window that these data domains changed.
pub fn changed(domains: &[&str]) {
    if let Some(app) = APP.get() {
        let _ = app.emit("data-changed", domains);
    }
}

pub fn emit<S: Serialize + Clone>(event: &str, payload: S) {
    if let Some(app) = APP.get() {
        let _ = app.emit(event, payload);
    }
}
