// src/compaction.rs
//
// Core compaction logic: decode a length-prefixed binary Yjs update log and
// merge all updates into a single compacted Yjs binary update.
//
// ── Wire format of the update log ────────────────────────────────────────────
//
//   The collab-service stores Yjs updates as a flat byte stream:
//
//     ┌───────────────────────────────────────────────────────┐
//     │  [uint32 BE, 4 bytes]  length of update N             │
//     │  [<length> bytes]      raw Yjs v1 binary update N     │
//     │  [uint32 BE, 4 bytes]  length of update N+1           │
//     │  ...                                                  │
//     └───────────────────────────────────────────────────────┘
//
//   This matches the framing used by the Go collab-service when persisting
//   CRDT state to MinIO. 
//
// ── Compaction strategy ───────────────────────────────────────────────────────
//
//   We create a fresh in-memory `yrs::Doc`, apply every update in sequence via
//   a write transaction, then encode the document's complete state as a single
//   Yjs v1 binary update.  The result is semantically equivalent to replaying
//   all updates but is substantially smaller because:
//     • Redundant/superseded struct fields are eliminated.
//     • The state is expressed as a single snapshot rather than an operation log.
//
//   The compacted update can be applied by the frontend in one call:
//     `Y.applyUpdate(doc, compactedBytes)`

use anyhow::{bail, Context, Result};
use bytes::Bytes;
use tracing::{debug, warn};
use yrs::{updates::decoder::Decode, Doc, ReadTxn, StateVector, Transact, Update};

/// Result returned by [`compact_update_log`].
pub struct CompactionResult {
    /// The merged Yjs update as a raw byte vector, ready for upload.
    pub compacted_bytes: Bytes,
    /// How many individual updates were decoded and applied.
    pub updates_merged: u32,
}

/// Decode the length-prefixed update log in `raw` and merge all updates into
/// a single compacted Yjs binary update.
///
/// # Errors
///
/// Returns an error if:
/// - The byte stream is truncated (a length prefix claims more bytes than remain).
/// - Any individual update fails to decode (corrupt data).
/// - The final state encoding fails (should not happen in practice).
pub fn compact_update_log(raw: &[u8], base_snapshot: Option<&[u8]>) -> Result<CompactionResult> {
    // Parse the length-prefixed stream into individual update blobs.
    let updates = decode_length_prefixed(raw).context("Failed to decode update log framing")?;

    let update_count = updates.len() as u32;
    debug!(count = update_count, "Decoded updates from log");

    if update_count == 0 && base_snapshot.is_none() {
        // A document with no updates is valid (empty doc); encode its empty state.
        warn!("Update log contained zero updates — producing empty document snapshot");
    }

    // Create a temporary in-memory Yjs document.
    // `yrs::Doc` is the root CRDT container, equivalent to `new Y.Doc()` in JS.
    let doc = Doc::new();

    // Apply each update inside a single write transaction.
    // Batching into one transaction is slightly more efficient than one txn per
    // update and produces the same result because Yjs updates are commutative.
    {
        let mut txn = doc.transact_mut();

        // If a base snapshot was provided, apply it first to seed the document
        // state before folding in the new updates
        if let Some(snapshot_bytes) = base_snapshot {
            let base = Update::decode_v1(snapshot_bytes)
                .context("Failed to decode base snapshot")?;
            txn.apply_update(base)
                .context("Failed to apply base snapshot")?;
            debug!(bytes = snapshot_bytes.len(), "Applied base snapshot");
        }

        for (i, update_bytes) in updates.iter().enumerate() {
            // Decode the raw bytes into a structured `yrs::Update`.
            let update = Update::decode_v1(update_bytes).with_context(|| {
                format!("Failed to decode Yjs update at index {i} ({} bytes)", update_bytes.len())
            })?;

            // Apply the decoded update to the document.
            txn.apply_update(update).with_context(|| {
                format!("Failed to apply Yjs update at index {i}")
            })?;
        }
        // `txn` is dropped here, committing all changes to `doc`.
    }

    // Encode the full document state as a Yjs v1 binary update.
    //
    // `encode_state_as_update` with an empty StateVector encodes *everything*
    // (no differential — the caller has no prior state to diff against).
    // This is exactly what the frontend needs for a cold-load: a single
    // `Y.applyUpdate(doc, bytes)` call that reconstructs the whole document.
    let txn = doc.transact();
    let compacted = txn.encode_state_as_update_v1(&StateVector::default());

    debug!(
        compacted_bytes = compacted.len(),
        updates_merged = update_count,
        "Compaction complete"
    );

    Ok(CompactionResult {
        compacted_bytes: Bytes::from(compacted),
        updates_merged: update_count,
    })
}

// Internal helpers

/// Parse a stream of `[uint32-BE length][<length> bytes]` frames and return
/// each payload as a `Vec<u8>`.
///
/// This mirrors the framing written by the Go collab-service:
///   binary.Write(buf, binary.BigEndian, uint32(len(update)))
///   buf.Write(update)
fn decode_length_prefixed(mut buf: &[u8]) -> Result<Vec<Vec<u8>>> {
    let mut updates: Vec<Vec<u8>> = Vec::new();

    while !buf.is_empty() {
        // Each frame begins with a 4-byte big-endian length prefix.
        if buf.len() < 4 {
            bail!(
                "Truncated update log: expected 4-byte length prefix but only {} byte(s) remain",
                buf.len()
            );
        }

        // Read the 4-byte big-endian length prefix.
        let len = u32::from_be_bytes([buf[0], buf[1], buf[2], buf[3]]) as usize;
        buf = &buf[4..];

        if buf.len() < len {
            bail!(
                "Truncated update log: length prefix claims {} bytes but only {} remain",
                len,
                buf.len()
            );
        }

        // Slice out the payload and advance the cursor.
        updates.push(buf[..len].to_vec());
        buf = &buf[len..];
    }

    Ok(updates)
}
