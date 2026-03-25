//! Thin wrapper around the `yrs` crate (the Rust Yjs implementation).
//!
//! We keep the Yjs Doc behind a Mutex so every caller gets exclusive access
//! for the duration of an update or encode.  Contention is low because
//! updates are applied serially per document.

use std::sync::Mutex;
use yrs::{Doc, GetString, ReadTxn, StateVector, Text, Transact, Update};
use yrs::updates::decoder::Decode;

use crate::error::{CollabError, Result};

/// Owns a single Yjs `Doc` for one collaborative document.
pub struct YjsEngine {
    /// The underlying Yjs document.  Wrapped in a `std::sync::Mutex` (not
    /// tokio's) because `Doc` is !Send and operations are CPU-bound and short.
    doc: Mutex<Doc>,
}

impl YjsEngine {
    /// Create a fresh, empty Yjs document.
    pub fn new() -> Self {
        Self {
            doc: Mutex::new(Doc::new()),
        }
    }

    /// Initialise a Yjs document from a previously persisted state snapshot
    /// (the raw bytes returned by `encode_state`).
    ///
    /// This is called when the first client connects and we have already
    /// downloaded the document state from the file store.
    pub fn from_snapshot(snapshot: &[u8]) -> Result<Self> {
        let doc = Doc::new();
        {
            // Apply the snapshot as an update so Yjs rebuilds its internal
            // state from the encoded V1 state vector + update bytes.
            let mut txn = doc.transact_mut();
            let update = Update::decode_v1(snapshot)
                .map_err(|e| CollabError::Yjs(e.to_string()))?;
            txn.apply_update(update)
                .map_err(|e| CollabError::Yjs(e.to_string()))?;
        }
        Ok(Self {
            doc: Mutex::new(doc),
        })
    }

    /// Apply a binary Yjs update received over WebSocket from a client.
    ///
    /// Returns `Ok(())` on success.  Errors here should be logged and the
    /// update dropped, but should NOT disconnect the sending client — Yjs
    /// is designed to tolerate out-of-order or duplicate updates.
    pub fn apply_update(&self, update_bytes: &[u8]) -> Result<()> {
        let doc = self.doc.lock().unwrap(); // poisoning = panic is fine here
        let mut txn = doc.transact_mut();
        let update = Update::decode_v1(update_bytes)
            .map_err(|e| CollabError::Yjs(e.to_string()))?;
        txn.apply_update(update)
            .map_err(|e| CollabError::Yjs(e.to_string()))?;
        Ok(())
    }

    /// Encode the full current document state as a byte vector suitable for
    /// uploading to the file store or sending to a new client as an initial
    /// sync message.
    pub fn encode_state(&self) -> Vec<u8> {
        let doc = self.doc.lock().unwrap();
        let txn = doc.transact();
        // `encode_state_as_update` with an empty StateVector encodes *all*
        // known state, equivalent to a full document snapshot.
        txn.encode_state_as_update_v1(&StateVector::default())
    }

    /// Initialise a Yjs document from a plain UTF-8 string (e.g. LaTeX source
    /// downloaded from the file store).  Inserts the content into a shared Text
    /// type under the key "content", which must match the key used on the frontend
    /// (`doc.getText("content")`).
    pub fn from_plaintext(content: &str) -> Self {
        let doc = Doc::new();
        {
            let text = doc.get_or_insert_text("content");
            let mut txn = doc.transact_mut();
            text.insert(&mut txn, 0, content);
        }
        Self { doc: Mutex::new(doc) }
    }

    /// Extract the document content as a plain UTF-8 string for persistence.
    /// Reads from the shared Text type under key "content".
    pub fn get_text_content(&self) -> String {
        let doc = self.doc.lock().unwrap();
        let txn = doc.transact();
        let text = doc.get_or_insert_text("content");
        text.get_string(&txn)
    }
}


