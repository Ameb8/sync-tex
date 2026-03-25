//! WebSocket connection handler.
//!
//! Axum calls `ws_handler` for each incoming upgrade request.  We extract the
//! `doc_id` from the path, then call `handle_socket` which owns the lifetime
//! of one WebSocket connection.

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use axum::{
    extract::{Path, State, WebSocketUpgrade},
    response::IntoResponse,
};
use axum::extract::ws::{Message, WebSocket};
use futures_util::StreamExt;
use tokio::sync::mpsc;
use tracing::{debug, error, info, warn};

use crate::state::AppState;
use crate::doc::doc_state::ClientId;
use crate::error::CollabError;
use crate::yjs::engine::YjsEngine;
use crate::upload;


/// Monotonically increasing counter for generating unique client IDs.
static CLIENT_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

fn next_client_id() -> ClientId {
    CLIENT_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
}

/// Axum handler for `GET /ws/:doc_id`.
///
/// Performs the WebSocket upgrade handshake and delegates to `handle_socket`.
pub async fn ws_handler(
    Path(doc_id): Path<String>,
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, doc_id, state))
}

/// Owns the lifecycle of a single WebSocket connection for one `doc_id`.
async fn handle_socket(
    socket: WebSocket,
    doc_id: String,
    app_state: Arc<AppState>,
) {
    let client_id = next_client_id();
    info!(client_id, doc_id = %doc_id, "Client connected");

    // Split into send/recv halves so we can run them concurrently.
    let (ws_tx, mut ws_rx) = socket.split();

    // Create an mpsc channel: the broadcast path writes here; the send task
    // drains it into the WebSocket.
    let (outbound_tx, outbound_rx) = mpsc::unbounded_channel::<Vec<u8>>();

    // Spawn a dedicated task that forwards messages from `outbound_rx` into
    // the WebSocket sink.  This decouples broadcast from the receive loop.
    tokio::spawn(send_task(ws_tx, outbound_rx));

    // First-connect vs subsequent-connect initialisation
    let doc_state = if let Some(existing) = app_state.registry.get(&doc_id) {
        // Document already loaded — send the current in-memory snapshot to this
        // new client so they can catch up immediately.
        let snapshot = {
            let state = existing.read().await;
            state.engine.encode_state()
        };

        // Error sending snapshot
        if outbound_tx.send(snapshot).is_err() {
            warn!(client_id, doc_id = %doc_id, "Client channel closed before initial sync");
            return;
        }
        existing
    } else {
        // First client for this document — load state from the file store.
        match load_document(&doc_id, &app_state).await {
            Ok(doc_state) => doc_state,
            Err(e) => {
                error!(client_id, doc_id = %doc_id, error = %e, "Failed to load document");
                return;
            }
        }
    };

    // Register this client in the document's client map.
    {
        let mut state = doc_state.write().await;
        state.clients.insert(client_id, outbound_tx.clone());
    }

    info!(client_id, doc_id = %doc_id, "Client registered; entering receive loop");

    // Receive loop — process incoming Yjs updates
    while let Some(msg) = ws_rx.next().await as Option<Result<Message, _>> {
        match msg {
            // Handle Yjs CRDT updates
            Ok(Message::Binary(bytes)) => {
                // 1. Apply the update to the in-memory Yjs engine.
                // 2. Broadcast to all *other* clients connected to this doc.
                // 3. Notify the upload scheduler.
                let mut state = doc_state.write().await;

                if let Err(e) = state.engine.apply_update(&bytes) {
                    warn!(client_id, doc_id = %doc_id, error = %e,
                          "Failed to apply Yjs update — dropping");
                    continue;
                }

                // Broadcast updates
                state.broadcast_except(client_id, &bytes);
                state.notify_update();
            }

            // Handle ping messages
            Ok(Message::Ping(payload)) => {
                // Axum auto-replies to pings, but we log them for visibility.
                debug!(client_id, "Received ping");
                let _ = outbound_tx.send(payload); // echo as pong
            }

            // Handle connection closes
            Ok(Message::Close(_)) => {
                info!(client_id, doc_id = %doc_id, "Client sent Close frame");
                break;
            }

            // Unexpected request type
            Ok(_) => {
                // Text frames, continuation frames, etc. — not expected from a
                // Yjs client but not fatal.
                warn!(client_id, doc_id = %doc_id, "Unexpected non-binary WS message");
            }

            // Error handling message
            Err(e) => {
                error!(client_id, doc_id = %doc_id, error = %e, "WebSocket error");
                break;
            }
        }
    }

    // Disconnect cleanup
    info!(client_id, doc_id = %doc_id, "Client disconnecting");

    // Determine if any conenctions left
    let is_last = {
        let mut state = doc_state.write().await;
        state.clients.remove(&client_id);
        state.clients.is_empty()
    };

    if is_last { // Ensure document saved if all connectioons are closed
        info!(doc_id = %doc_id, "Last client disconnected — signalling scheduler and removing doc");

        // Signal the upload scheduler to do a final upload before it exits.
        // We take the stop sender out of the doc state and fire it.
        // The registry entry is removed after the scheduler confirms the upload.
        {
            let mut state = doc_state.write().await;
            if let Some(stop_tx) = state.upload_stop_tx.take() {
                let _: Result<_, _>  = stop_tx.send(());
            }
        }

        // Give the scheduler a moment to flush.  In production you'd want a
        // proper shutdown barrier here (e.g. a oneshot reply or join handle),
        // but a short yield is often sufficient for low-latency file stores.
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;

        app_state.registry.remove(&doc_id);
    }
}

/// Task that drains `outbound_rx` and writes each message into the WebSocket.
async fn send_task(
    mut ws_tx: futures_util::stream::SplitSink<WebSocket, Message>,
    mut outbound_rx: mpsc::UnboundedReceiver<Vec<u8>>,
) {
    use futures_util::SinkExt;
    while let Some(bytes) = outbound_rx.recv().await {
        if ws_tx.send(Message::Binary(bytes)).await.is_err() {
            // The socket closed on the other side; receiver will notice shortly.
            break;
        }
    }
}

/// Load a document from scratch (first connect path):
///   1. Fetch presigned download URL from projects-service.
///   2. Download raw state bytes.
///   3. Build a `YjsEngine` from the snapshot (or empty if none exists).
///   4. Insert into the registry.
///   5. Spawn the upload scheduler.
async fn load_document(
    doc_id: &str,
    app_state: &Arc<AppState>,
) -> crate::error::Result<crate::doc::registry::SharedDocState> {
    let download_url = app_state.projects_client.get_download_url(doc_id).await?;

    let snapshot = app_state.projects_client
        .download_state(&download_url)
        .await
        .unwrap_or_default();

    let engine = if snapshot.is_empty() {
        YjsEngine::new()
    } else {
        let text = String::from_utf8(snapshot)
            .map_err(|e| CollabError::Yjs(e.to_string()))?;
        YjsEngine::from_plaintext(&text)
    };

    let doc_state = app_state.registry.insert(doc_id.to_string(), engine);

    let (notify_tx, notify_rx) = mpsc::unbounded_channel();

    // spawn() returns the stop Sender — no separate oneshot::channel() call needed
    let stop_tx = upload::scheduler::spawn(
        doc_id.to_string(),
        doc_state.clone(),
        app_state.projects_client.clone(),
        notify_rx,
        app_state.config.upload_debounce,
        app_state.config.upload_max_interval,
    );

    {
        let mut state = doc_state.write().await;
        state.upload_notify = Some(notify_tx);
        state.upload_stop_tx = Some(stop_tx);
    }

    Ok(doc_state)
}

