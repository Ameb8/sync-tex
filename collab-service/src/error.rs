//! Unified error type for the entire service.
//! Using `thiserror` lets us annotate variants with display messages while
//! still carrying the original source error for logging.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum CollabError {
    #[error("projects-service request failed: {0}")]
    ProjectsClient(#[from] reqwest::Error),

    #[error("yjs operation failed: {0}")]
    Yjs(String),

    #[error("document not found in registry: {doc_id}")]
    DocNotFound { doc_id: String },

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("serialisation error: {0}")]
    Serialisation(#[from] serde_json::Error),

    #[error("upload failed with status {status}: {body}")]
    UploadFailed { status: u16, body: String },
}

/// Convenience alias used throughout the crate.
pub type Result<T> = std::result::Result<T, CollabError>;