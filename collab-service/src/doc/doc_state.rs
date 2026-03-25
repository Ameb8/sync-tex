//! Per-document in-memory state.
//!
//! `DocState` bundles:
//! - the live Yjs engine (the authoritative CRDT state)
//! - the set of currently-connected WebSocket client sender handles
//! - a channel to signal the upload scheduler that a new update arrived

use std::collections::HashMap;
use tokio::sync::mpsc;
use tokio::sync::oneshot;
use crate::yjs::engine::YjsEngine;

/// A unique identifier for one WebSocket connection.
pub type ClientId = u64;

/// The message type broadcast to connected clients.
/// We keep it as raw bytes because Yjs updates are opaque binary blobs.
pub type BroadcastMsg = Vec<u8>;

/// In-memory state for a single collaborative document.
pub struct DocState {
    /// The live Yjs CRDT for this document.
    pub engine: YjsEngine,

    /// Map of connected client IDs → their WebSocket send channel.
    ///
    /// Sending to the channel pushes bytes out through the WebSocket.
    /// We use `mpsc::UnboundedSender` here for simplicity; for a production
    /// service you may want backpressure via bounded channels.
    pub clients: HashMap<ClientId, mpsc::UnboundedSender<BroadcastMsg>>,

    /// Notify the upload scheduler that a Yjs update has been applied.
    /// The scheduler debounces/intervals uploads based on these signals.
    /// `None` before the scheduler task is spawned.
    pub upload_notify: Option<mpsc::UnboundedSender<()>>,

    /// Fired when the last client disconnects to trigger a final upload
    /// before the scheduler task exits.
    pub upload_stop_tx: Option<oneshot::Sender<()>>,
}

impl DocState {
    /// Construct an empty `DocState` with no clients and a fresh Yjs engine.
    pub fn new(engine: YjsEngine) -> Self {
        Self {
            engine,
            clients: HashMap::new(),
            upload_notify: None,
            upload_stop_tx: None,
        }
    }

    /// Broadcast a raw Yjs update to every client *except* the sender.
    ///
    /// Clients whose send channel has been dropped (i.e., disconnected but
    /// not yet removed from the map) are silently skipped; the registry's
    /// disconnect handler will clean them up shortly.
    pub fn broadcast_except(&self, exclude: ClientId, msg: &[u8]) {
        for (&client_id, tx) in &self.clients {
            if client_id == exclude {
                continue;
            }
            // `send` on an UnboundedSender only fails if the receiver is gone.
            let _ = tx.send(msg.to_vec());
        }
    }

    /// Notify the upload scheduler that the document was updated.
    pub fn notify_update(&self) {
        if let Some(tx) = &self.upload_notify {
            let _ = tx.send(());
        }
    }
}