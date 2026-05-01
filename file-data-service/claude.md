# file-data-service

Rust. tonic gRPC server. Owns all Yjs document operations: appending updates, compacting logs into snapshots, and exporting plain text. Stateless — all state lives in MinIO.

## Responsibilities


- **Compaction**: Merge accumulated update log into a single snapshot using `yrs`. Triggered by gRPC `compaction` request. Replaces log + old snapshot with new snapshot object.
- **Text export**: Apply snapshot (and any pending updates) via `yrs`, extract plain UTF-8 text from the Yjs `Text` type. Used by `assistant-service` for AI context assembly and by `projects-service` for text cache population.

## MinIO Layout

Source of truth for a file can be accessed by applying all updates in uploads to snapshot document.

- **uploads**: Store Yjs update logs, each prefixed with their lenght in Bytes

- **snapshot**: Compacted Yjs binary document

- **text**: Text representation of document


## gRPC Services

### CompactDocument

Merges a base snapshot + update log into a new compacted snapshot.

#### Request

- **download_url**: URL for update log (Yjs updates)
- **base_snapshot_url**: URL for existing snapshot (optional starting point)
- **upload_url**: destination for new compacted snapshot

#### Response

- **success**: operation status
- **error_message**: populated on failure
- **updates_merged**: number of updates applied
- **compacted_size_bytes**: size of resulting snapshot

### ExportDocument

Produces a fully materialized document (plain text) from snapshot + pending updates.

#### Request
- **snapshot_url**: base snapshot
- **pending_updates_url**: additional updates to apply
- **upload_url**: destination for exported result

#### Response

- **success**: operation status
- **error_message**: populated on failure
- **exported_bytes**: size of exported output

## Env

```
MINIO_ENDPOINT
MINIO_ACCESS_KEY
MINIO_SECRET_KEY
MINIO_BUCKET
GRPC_PORT
```