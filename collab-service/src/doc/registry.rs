//! `DocRegistry` — the central in-memory store mapping `doc_id` strings to
//! their live `DocState`.
//!
//! Uses `DashMap` so individual document locks don't block each other.
//! The only time we need exclusive access to an entry is during first-connect
//! initialisation; after that, per-doc `RwLock`s inside each entry suffice.

use std::sync::Arc;
use dashmap::DashMap;
use tokio::sync::RwLock;

use crate::doc::doc_state::{ClientId, DocState};
use crate::error::{CollabError, Result};
use crate::yjs::engine::YjsEngine;

/// Wraps each `DocState` in an `Arc<RwLock>` so:
///  - Multiple readers (e.g. broadcast) can proceed concurrently.
///  - Writers (apply update, add/remove client) take an exclusive lock.
pub type SharedDocState = Arc<RwLock<DocState>>;

/// Registry of all live documents.
#[derive(Clone, Default)]
pub struct DocRegistry {
    /// `doc_id` → shared doc state
    docs: Arc<DashMap<String, SharedDocState>>,
}

impl DocRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Return the `SharedDocState` for `doc_id` if it already exists.
    pub fn get(&self, doc_id: &str) -> Option<SharedDocState> {
        self.docs.get(doc_id).map(|r| r.clone())
    }

    /// Insert a new document entry, or return the existing one if already present.
    /// This prevents two simultaneous first-connects from creating duplicate state.
    pub fn insert(&self, doc_id: String, engine: YjsEngine) -> SharedDocState {
        // entry().or_insert_with() is atomic in DashMap — only one caller wins
        self.docs
            .entry(doc_id)
            .or_insert_with(|| Arc::new(RwLock::new(DocState::new(engine))))
            .clone()
}

    /// Remove a document from the registry entirely.
    ///
    /// Called after the last client disconnects and the final upload has been
    /// confirmed.
    pub fn remove(&self, doc_id: &str) {
        self.docs.remove(doc_id);
    }

    /// True if the registry contains an entry for `doc_id`.
    pub fn contains(&self, doc_id: &str) -> bool {
        self.docs.contains_key(doc_id)
    }

    /// Return the number of currently-connected clients for `doc_id`.
    pub async fn client_count(&self, doc_id: &str) -> usize {
        match self.get(doc_id) {
            Some(state) => state.read().await.clients.len(),
            None => 0,
        }
    }
}