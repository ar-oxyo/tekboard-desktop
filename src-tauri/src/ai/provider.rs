//! Which AI answers TekBoard's requests: none, Claude Code, OpenRouter or a local model (Ollama).
//!
//! Every AI feature goes through `runner::run`, which asks this module where the request goes.
//! Claude Code keeps its own path (`runner`); OpenRouter and Ollama share one OpenAI-compatible
//! client (`openai`, `toolloop`). What a provider cannot do is refused before anything runs,
//! with a message that says why (`require`, `route`).
//!
//! The choice is part of the AI settings (`chat::AiSettings`). It is kept in memory too, so
//! `runner::run` does not need the database.

use super::chat::AiSettings;
use super::runner::{Request, Tools};
use crate::error::{AppError, Result};
use serde::Serialize;
use std::sync::Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    None,
    Claude,
    OpenRouter,
    Ollama,
}

impl Kind {
    pub fn parse(s: &str) -> Option<Kind> {
        match s {
            "none" => Some(Kind::None),
            "claude" => Some(Kind::Claude),
            "openrouter" => Some(Kind::OpenRouter),
            "ollama" => Some(Kind::Ollama),
            _ => None,
        }
    }
    pub fn id(self) -> &'static str {
        match self {
            Kind::None => "none",
            Kind::Claude => "claude",
            Kind::OpenRouter => "openrouter",
            Kind::Ollama => "ollama",
        }
    }
    pub fn name(self) -> &'static str {
        match self {
            Kind::None => "Aucune IA",
            Kind::Claude => "Claude Code",
            Kind::OpenRouter => "OpenRouter",
            Kind::Ollama => "IA locale (Ollama)",
        }
    }
}

/// What a feature needs from the model.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Feature {
    /// Text in, text (or JSON) out: planning assistant, subject analysis.
    Text,
    /// Conversation with Artix, which calls TekBoard's tools.
    Chat,
    /// Reads the files of a project: analysis, README, subject check.
    ReadFiles,
    /// Edits files and runs commands in a sandbox: moulinette agent, test generation.
    Agent,
}

/// What each provider can do, for the UI.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Caps {
    pub text: bool,
    pub chat: bool,
    pub read_files: bool,
    pub agents: bool,
}

pub fn caps(kind: Kind) -> Caps {
    match kind {
        Kind::None => Caps { text: false, chat: false, read_files: false, agents: false },
        Kind::Claude => Caps { text: true, chat: true, read_files: true, agents: true },
        Kind::OpenRouter | Kind::Ollama => Caps { text: true, chat: true, read_files: true, agents: false },
    }
}

static CURRENT: Mutex<Option<AiSettings>> = Mutex::new(None);

/// Keeps the settings in memory (at start and after every save).
pub fn set_current(s: &AiSettings) {
    *CURRENT.lock().unwrap_or_else(|e| e.into_inner()) = Some(s.clone());
}

pub fn current_settings() -> AiSettings {
    CURRENT.lock().unwrap_or_else(|e| e.into_inner()).clone().unwrap_or_default()
}

/// The provider in use. Settings saved before 0.7 have no provider: those installs kept
/// using Claude Code, so they still do while it is there (see `migrate`).
pub fn kind_of(s: &AiSettings) -> Kind {
    match Kind::parse(&s.provider) {
        Some(k) => k,
        None if crate::claude::executable().is_ok() => Kind::Claude,
        None => Kind::None,
    }
}

pub fn current() -> Kind {
    kind_of(&current_settings())
}

/// Settings written before providers existed get one, once: Claude Code when it answers,
/// otherwise none (the user picks one in the first-launch screen or in Settings).
/// `claude_ready` is asked only when needed (it starts `claude --version`), outside the lock.
pub fn migrate(db: &std::sync::Mutex<rusqlite::Connection>, claude_ready: impl FnOnce() -> bool) -> Result<bool> {
    let lock = || db.lock().unwrap_or_else(|e| e.into_inner());
    if Kind::parse(&AiSettings::load(&lock()).provider).is_some() {
        return Ok(false);
    }
    let kind = if claude_ready() { Kind::Claude } else { Kind::None };
    let conn = lock();
    let mut s = AiSettings::load(&conn);
    if Kind::parse(&s.provider).is_some() {
        return Ok(false);
    }
    s.provider = kind.id().into();
    s.save(&conn)?;
    Ok(true)
}

pub fn unavailable() -> AppError {
    AppError::new("ai_unavailable", "Aucune IA n'est configurée. Choisis Claude Code, OpenRouter ou une IA locale dans Réglages → IA (TekBoard fonctionne aussi sans).")
}

pub fn needs_claude(kind: Kind) -> AppError {
    AppError::new("ai_needs_claude", format!("Cette fonction modifie des fichiers et lance des commandes dans un bac à sable : elle nécessite Claude Code. Avec {}, utilise plutôt l'analyse du projet ou le chat.", kind.name()))
}

/// Whether `feature` can run with the provider in use. Called before a job starts, so the
/// error reaches the user at once.
pub fn require(feature: Feature) -> Result<Kind> {
    let kind = current();
    match kind {
        Kind::None => Err(unavailable()),
        Kind::Claude => crate::claude::executable().map(|_| kind),
        k if feature == Feature::Agent => Err(needs_claude(k)),
        k => Ok(k),
    }
}

/// Where a request goes.
pub enum Route {
    Claude,
    Compat(super::openai::Endpoint),
}

/// The tools of agent jobs (everything else a run may be given is read-only or a TekBoard tool).
fn is_agentic(r: &Request) -> bool {
    matches!(r.tools, Tools::ReadEdit(_)) || r.mcp.as_ref().is_some_and(|m| m.allow.iter().any(|t| super::agent_tools::handles(t)))
}

pub fn route(r: &Request) -> Result<Route> {
    let s = current_settings();
    let kind = kind_of(&s);
    match kind {
        Kind::None => Err(unavailable()),
        Kind::Claude => Ok(Route::Claude),
        k if is_agentic(r) => Err(needs_claude(k)),
        Kind::OpenRouter => super::openrouter::endpoint(&s).map(Route::Compat),
        Kind::Ollama => super::ollama::endpoint(&s).map(Route::Compat),
    }
}

/// State of the provider in use, for Settings and for the screens that need AI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub provider: Kind,
    /// The provider is set up (a model is chosen, a key is there…). Not a network check.
    pub configured: bool,
    pub model: Option<String>,
    pub caps: Caps,
    /// What is missing, in words the UI shows as they are.
    pub detail: Option<String>,
}

pub fn status() -> Status {
    let s = current_settings();
    let kind = kind_of(&s);
    let (configured, model, detail) = match kind {
        Kind::None => (false, None, Some("Aucune IA : les fonctions d'Artix sont désactivées.".to_string())),
        Kind::Claude => match crate::claude::executable() {
            Ok(_) => (true, Some(s.chat_model.clone()).filter(|m| !m.is_empty()), None),
            Err(e) => (false, None, Some(e.to_string())),
        },
        Kind::OpenRouter => match super::openrouter::configured(&s) {
            Ok((_, model)) => (true, Some(model), None),
            Err(e) => (false, Some(s.openrouter_model.clone()).filter(|m| !m.is_empty()), Some(e.to_string())),
        },
        Kind::Ollama => match super::ollama::configured(&s) {
            Ok(model) => (true, Some(model), None),
            Err(e) => (false, None, Some(e.to_string())),
        },
    };
    Status { provider: kind, configured, model, caps: caps(kind), detail }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn kinds_round_trip_and_capabilities() {
        for k in [Kind::None, Kind::Claude, Kind::OpenRouter, Kind::Ollama] {
            assert_eq!(Kind::parse(k.id()), Some(k));
        }
        assert_eq!(Kind::parse(""), None);
        assert!(caps(Kind::Claude).agents && !caps(Kind::OpenRouter).agents && !caps(Kind::Ollama).agents);
        assert!(caps(Kind::Ollama).chat && caps(Kind::OpenRouter).read_files);
        assert_eq!(caps(Kind::None), Caps { text: false, chat: false, read_files: false, agents: false });
    }

    #[test]
    fn older_settings_get_a_provider_once() {
        let db = std::sync::Mutex::new(crate::db::open_in_memory().unwrap());
        crate::db::set_setting(&db.lock().unwrap(), "ai_settings", r#"{"chatModel":"opus"}"#).unwrap();
        assert!(migrate(&db, || true).unwrap());
        let s = AiSettings::load(&db.lock().unwrap());
        assert_eq!((s.provider.as_str(), s.chat_model.as_str()), ("claude", "opus"), "the other settings are kept");
        assert!(!migrate(&db, || panic!("not asked again")).unwrap());
        let fresh = std::sync::Mutex::new(crate::db::open_in_memory().unwrap());
        assert!(migrate(&fresh, || false).unwrap());
        assert_eq!(AiSettings::load(&fresh.lock().unwrap()).provider, "none");
    }

    #[test]
    fn agent_requests_are_recognised() {
        let read = Request::new("x", Tools::Read, Duration::from_secs(1));
        assert!(!is_agentic(&read));
        assert!(is_agentic(&Request::new("x", Tools::ReadEdit(vec!["tests/**".into()]), Duration::from_secs(1))));
        let mut chat = Request::new("x", Tools::None, Duration::from_secs(1));
        chat.mcp = Some(super::super::runner::Mcp { config: "/tmp/x".into(), allow: vec!["*".into()] });
        assert!(!is_agentic(&chat), "the conversation's tools are TekBoard's own");
        chat.mcp = Some(super::super::runner::Mcp { config: "/tmp/x".into(), allow: vec!["exec".into()] });
        assert!(is_agentic(&chat), "exec runs commands");
    }
}
