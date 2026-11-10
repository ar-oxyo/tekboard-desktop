use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

/// Every backend failure reaches the UI as `{ code, message }`.
/// `code` is stable and lets the UI pick a specific empty/error state.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{message}")]
    Coded { code: &'static str, message: String },
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Db(#[from] rusqlite::Error),
    #[error("{0}")]
    Json(#[from] serde_json::Error),
}

impl AppError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        AppError::Coded { code, message: message.into() }
    }

    pub fn code(&self) -> &'static str {
        match self {
            AppError::Coded { code, .. } => code,
            AppError::Io(_) => "io",
            AppError::Db(_) => "database",
            AppError::Json(_) => "json",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("code", self.code())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
