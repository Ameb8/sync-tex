// src/export.rs
//
// Extracts the plain-text content of a Yjs document from a compacted snapshot
// plus an optional pending update log.
//
// ── How Yjs stores text ──────────────────────────────────────────────────────
//
//   SyncTeX stores the file content in a shared Yjs Text type bound to the
//   Monaco editor via MonacoBinding. The shared type is registered under the
//   key "content" on the Y.Doc (the default MonacoBinding key).
//
//   `yrs` exposes this as `doc.get_or_insert_text("content")`, and
//   `text.get_string(&txn)` returns the full UTF-8 string value.

use anyhow::{Context, Result};
use bytes::Bytes;
use yrs::{updates::decoder::Decode, Doc, GetString, Text, Transact, Update};

use crate::compaction::decode_length_prefixed;

/// The name under which MonacoBinding registers the shared Text type.
/// Must match the key used in the frontend:
///   `const yText = ydoc.getText("content")`
const TEXT_KEY: &str = "content";

/// Reconstruct a Yjs document from `snapshot_bytes` (required) and
/// `pending_bytes` (optional length-prefixed update log), then extract the
/// shared Text value as a UTF-8 string.
pub fn extract_text(
    snapshot_bytes: &[u8],
    pending_bytes: Option<&[u8]>,
) -> Result<String> {
    let doc = Doc::new();

    {
        let mut txn = doc.transact_mut();

        // Apply the compacted snapshot first — this is the authoritative base.
        let snapshot = Update::decode_v1(snapshot_bytes)
            .context("Failed to decode compacted snapshot")?;
        txn.apply_update(snapshot)
            .context("Failed to apply compacted snapshot")?;

        // Fold in any pending updates that arrived after the last compaction.
        if let Some(raw) = pending_bytes {
            if !raw.is_empty() {
                let updates = decode_length_prefixed(raw)
                    .context("Failed to decode pending update log framing")?;

                for (i, update_bytes) in updates.iter().enumerate() {
                    let update = Update::decode_v1(update_bytes).with_context(|| {
                        format!(
                            "Failed to decode pending Yjs update at index {i} ({} bytes)",
                            update_bytes.len()
                        )
                    })?;
                    txn.apply_update(update).with_context(|| {
                        format!("Failed to apply pending Yjs update at index {i}")
                    })?;
                }
            }
        }
    }

    // Read the shared Text type and serialise to a plain UTF-8 string.
    let txn = doc.transact();
    let text = doc.get_or_insert_text(TEXT_KEY);
    let content = text.get_string(&txn);

    Ok(content)
}

/// Convenience wrapper: extract text and return it as `Bytes` for upload.
pub fn extract_text_bytes(
    snapshot_bytes: &[u8],
    pending_bytes: Option<&[u8]>,
) -> Result<Bytes> {
    let text = extract_text(snapshot_bytes, pending_bytes)?;
    Ok(Bytes::from(text.into_bytes()))
}