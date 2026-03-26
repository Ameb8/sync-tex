//! Per-document upload scheduler.
//!
//! Strategy: debounce + max-interval ceiling.
//!
//!  - Every time a Yjs update is applied, the ws_handler sends `()` on the
//!    `notify_tx` channel.
//!  - The scheduler resets a debounce timer on each signal.
//!  - If the debounce fires (quiet period elapsed), upload immediately.
//!  - If updates keep coming non-stop, the max-interval timer forces an upload
//!    anyway so we don't go arbitrarily long without persisting.
//!  - When `stop_rx` is signalled (last client disconnected), drain any
//!    remaining debounce and do a final upload before the task exits.

use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot, RwLock};
use tokio::time::{sleep, Instant};
use tracing::{error, info, debug};

use crate::doc::doc_state::DocState;
use crate::projects::client::ProjectsClient;

/// Spawn the upload scheduler task for one document.
///
/// Returns a `oneshot::Sender<()>` that the caller fires when the last client
/// disconnects.  The task guarantees one final upload before it exits.
pub fn spawn(
    doc_id: String,
    doc_state: Arc<RwLock<DocState>>,
    projects_client: ProjectsClient,
    mut notify_rx: mpsc::UnboundedReceiver<()>,
    debounce: Duration,
    max_interval: Duration,
) -> oneshot::Sender<()> {
    let (stop_tx, mut stop_rx) = oneshot::channel::<()>();

    tokio::spawn(async move {
        // Track when we last uploaded so we can enforce the max_interval ceiling.
        let mut last_upload = Instant::now();

        // Whether the debounce timer is currently "armed" (i.e. an update
        // arrived and we're waiting for quiet).
        let mut debounce_armed = false;
        let mut debounce_deadline = Instant::now(); // only valid when armed

        loop {
            // How long until the max_interval forces an upload regardless?
            let since_last = last_upload.elapsed();
            let force_in = max_interval.saturating_sub(since_last);

            tokio::select! {
                // A new Yjs update arrived — reset the debounce timer.
                Some(()) = notify_rx.recv() => {
                    debounce_armed = true;
                    debounce_deadline = Instant::now() + debounce;
                }

                // Debounce quiet period elapsed — upload now.
                _ = sleep(if debounce_armed {
                    debounce_deadline.saturating_duration_since(Instant::now())
                } else {
                    // If not armed, sleep for a long time (woken by other arms).
                    Duration::from_secs(3600)
                }), if debounce_armed => {
                    debounce_armed = false;
                    debug!(doc_id = %doc_id, "Save triggered: debounce quiet period elapsed");
                    do_upload(&doc_id, &doc_state, &projects_client).await;
                    last_upload = Instant::now();
                }

                // Max interval ceiling — force an upload even if updates
                // keep arriving continuously.
                _ = sleep(force_in) => {
                    if debounce_armed {
                        debounce_armed = false;
                        debug!(doc_id = %doc_id, "Save triggered: max interval ceiling reached");
                        do_upload(&doc_id, &doc_state, &projects_client).await;
                        last_upload = Instant::now();
                    }
                }

                // Last client disconnected — do a final upload then exit.
                _ = &mut stop_rx => {
                    debug!(doc_id = %doc_id, "Save triggered: last client disconnected");
                    do_upload(&doc_id, &doc_state, &projects_client).await;
                    break;
                }
            }
        }

        info!(doc_id = %doc_id, "Upload scheduler task exiting");
    });

    stop_tx
}

/// Encode the current in-memory document state and upload it to the file store.
///
/// Errors are logged but not propagated — a failed upload doesn't crash the
/// service; the next scheduled upload will retry.
async fn do_upload(
    doc_id: &str,
    doc_state: &Arc<RwLock<DocState>>,
    projects_client: &ProjectsClient,
) {
    // Get textual state of doocument
    let text = {
        let state = doc_state.read().await;
        state.engine.get_text_content()
    };

    debug!(
        doc_id = %doc_id,
        bytes = text.len(),
        content = %text,
        "Upload triggered"
    );

    let snapshot = text.into_bytes();

    // Fetch a fresh presigned upload URL from the projects-service.
    let upload_url = match projects_client.get_upload_url(doc_id).await {
        Ok(url) => url,
        Err(e) => {
            error!(doc_id = %doc_id, error = %e, "Failed to get upload URL");
            return;
        }
    };

    // PUT the snapshot bytes to the file store.
    match projects_client.upload_state(&upload_url, snapshot).await {
        Ok(()) => info!(doc_id = %doc_id, "Document state uploaded successfully"),
        Err(e) => error!(doc_id = %doc_id, error = %e, "Upload to file store failed"),
    }
}