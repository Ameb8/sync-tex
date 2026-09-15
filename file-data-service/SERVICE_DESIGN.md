# File Data Service — System Design Document

## 1. System Overview

### 1.1 Purpose and Role
The `file-data-service` is a high-performance, stateless computational microservice within the SyncTeX collaborative LaTeX IDE platform. Implemented in Rust, it serves as the dedicated engine for Conflict-free Replicated Data Type (CRDT) document lifecycle management, specifically handling:
- **Yjs Document Compaction (`CompactDocument`)**: Merging cumulative, length-prefixed binary Yjs update streams and base snapshots into canonical, minimal Yjs v1 binary document snapshots.
- **Plain-Text Export (`ExportDocument`)**: Reconstructing complete in-memory CRDT document representations from snapshots and pending updates, extracting plain UTF-8 text from the shared `"content"` `Text` CRDT structure (bound to Monaco Editor), and writing exported text directly to object storage.

By isolating CRDT compilation and serialization inside a dedicated Rust service powered by `yrs` (the native Rust port of Yjs), the SyncTeX architecture offloads compute-intensive and memory-sensitive operations from Go services (`collab-service`, `projects-service`) and Python services (`assistant-service`, `compile-service`).

### 1.2 Architectural Positioning
- **Stateless Computational Node**: The service maintains no local database, file system state, or session memory between requests. All state is fetched on-demand from object storage via presigned URLs and streamed directly in memory.
- **Object Storage Offloading**: The service does not directly configure S3/MinIO access keys or credentials. Instead, caller services (`projects-service`) supply time-limited, presigned GET and PUT URLs, keeping `file-data-service` decoupled from storage credentials and access control logic.
- **Internal gRPC Boundary**: Operates strictly within the private container network over HTTP/2 gRPC (`compaction.CompactionService` protocol) listening on port `50051`.

---

## 2. Technology Stack & Component Architecture

### 2.1 Technology Stack
- **Language & Runtime**: Rust (2021 Edition, Rust 1.94+ compiler)
- **gRPC Framework**: `tonic` (v0.12) built on `hyper` and `tokio`
- **Protocol Buffers Runtime & Compiler**: `prost` (v0.13) and `tonic-build` (v0.12)
- **CRDT Engine**: `yrs` (v0.21) — native Rust implementation of Yjs CRDT
- **Asynchronous HTTP Client**: `reqwest` (v0.12) with native-tls / OpenSSL, connection pooling, and byte streaming
- **Buffer & Stream Utilities**: `bytes` (v1.x), `tokio-util` (v0.7), and `futures` (v0.3)
- **Error Handling**: `anyhow` (v1.x) with contextual error chains (`context`, `with_context`)
- **Structured Observability**: `tracing` (v0.1) and `tracing-subscriber` (v0.3) with `EnvFilter`
- **Containerization**: Multi-stage Docker build targeting `linux/arm64` (Raspberry Pi 5) and `linux/amd64` using `debian:bookworm-slim`

### 2.2 Component Architecture & Module Breakdown

The codebase is structured into cohesive modules with distinct responsibilities:

- `src/main.rs`: Entrypoint for the application. Initializes structured tracing (`tracing-subscriber`), reads environment configuration, registers signal handlers (`SIGINT` and `SIGTERM`), constructs the gRPC service, and starts the `tonic::transport::Server` listener with graceful shutdown.
- `src/config.rs`: Strongly typed configuration container. Reads runtime parameters such as `GRPC_ADDR` from the process environment.
- `src/proto.rs`: Encapsulates code generation macros (`tonic::include_proto!("compaction")`), exposing the gRPC service traits, server builders, and request/response structs.
- `src/server.rs`: Implements the `compaction::compaction_service_server::CompactionService` trait. Manages HTTP client lifecycle (`reqwest::Client` in `Arc`), validates incoming RPC arguments, creates distributed tracing spans (`#[instrument]`), maps business execution to response envelopes, and formats error chains.
- `src/compaction.rs`: Houses the core Yjs CRDT compaction logic and binary framing decoder (`decode_length_prefixed`). Applies update streams and base snapshots to in-memory `yrs::Doc` instances within write transactions, then serializes the complete document state into a minimal binary snapshot.
- `src/export.rs`: Houses the plain-text extraction logic. Reassembles the CRDT document from a base snapshot and optional pending updates, accesses the root `Text` CRDT type (`"content"`), and extracts the unified UTF-8 string.
- `src/http.rs`: Async HTTP helpers using `reqwest::Client` to download binary data from presigned GET URLs and upload binary or text payloads to presigned PUT URLs with accurate `Content-Type` and `Content-Length` headers.
- `build.rs`: Cargo build script executing `tonic-build` to compile `proto/compaction.proto` into Rust stubs at build time.

---

## 3. Database and Data Storage Architecture

### 3.1 Relational Database
The `file-data-service` is entirely **stateless** and does **not** own, connect to, or manage a relational database instance. It executes no database migrations and maintains no persistent disk storage.

Database metadata regarding files, versions, and text cache ETags is owned exclusively by `projects-service` (`postgres-projects`).

<ERD-DIAGRAM>

*(Note: Logical file relationships and ETag tracking are managed externally in the `projects-service` PostgreSQL database; `file-data-service` operates strictly on data buffers.)*

### 3.2 Object Storage Buckets and Formats
The service processes objects across three primary MinIO S3 buckets via presigned URLs provided by caller services:

| Bucket Name | Object Key Format | Content Payload | Consumer / Producer Role in `file-data-service` |
|-------------|-------------------|-----------------|------------------------------------------------|
| `uploads` | `<projectID>/<fileID>` | Length-prefixed binary stream of individual raw Yjs updates (`application/octet-stream`) | **Downloaded** during `CompactDocument` and `ExportDocument` |
| `snapshot` | `<projectID>/<fileID>` | Consolidated, minimal Yjs v1 binary document state (`application/octet-stream`) | **Uploaded** during `CompactDocument`; **Downloaded** during `ExportDocument` |
| `text` | `<projectID>/<fileID>` | Raw UTF-8 plain-text string extracted from the document (`text/plain; charset=utf-8`) | **Uploaded** during `ExportDocument` |

### 3.3 Wire Framing Formats

#### 3.3.1 Length-Prefixed Update Log Framing (`uploads` Bucket)
The `collab-service` buffers incremental collaborative edits and persists them as a concatenated stream of length-prefixed binary frames. The `file-data-service` decodes this format in `src/compaction.rs:decode_length_prefixed`:

```
+------------------------------------+------------------------------------+
| Field                              | Size / Type                        |
+------------------------------------+------------------------------------+
| Frame Length (N)                   | 4 bytes (uint32, Big-Endian)       |
| Raw Yjs v1 Binary Update Payload   | N bytes                            |
| Frame Length (M)                   | 4 bytes (uint32, Big-Endian)       |
| Raw Yjs v1 Binary Update Payload   | M bytes                            |
| ...                                | ...                                |
+------------------------------------+------------------------------------+
```

- Each frame starts with a 4-byte big-endian unsigned integer indicating the byte length of the subsequent Yjs update.
- The parser verifies that the buffer contains at least 4 bytes for the header, reads `len`, asserts that `buf.len() >= len`, slices the exact payload, and advances the buffer pointer until exhaustion.
- Truncated or malformed frames immediately abort processing with a detailed `anyhow::Result` error.

#### 3.3.2 Compacted Snapshot Format (`snapshot` Bucket)
- Encoded using `yrs::ReadTxn::encode_state_as_update_v1(&StateVector::default())`.
- Compacting against an empty `StateVector` serializes the full CRDT document state into a single contiguous Yjs v1 update blob without diffs.
- This format eliminates superseded deletions, coalesces split text insertions into contiguous chunks, and provides a snapshot that clients or workers can load in a single call to `Y.applyUpdate(doc, bytes)`.

#### 3.3.3 Shared Text Format (`text` Bucket)
- The collaborative editor binds the Monaco editor model to a shared Yjs `Text` type under the key `"content"`:
  ```javascript
  const yText = ydoc.getText("content");
  ```
- In `file-data-service`, the extraction logic calls `doc.get_or_insert_text("content")` and evaluates `text.get_string(&txn)`, yielding a standard UTF-8 string that is uploaded with `Content-Type: text/plain; charset=utf-8`.

---

## 4. gRPC Interface Specification

The service interface is defined in `proto/compaction.proto` within the `compaction` package.

```protobuf
syntax = "proto3";

package compaction;
option go_package = "projects-service/proto;proto";

service CompactionService {
  rpc CompactDocument(CompactRequest) returns (CompactResponse);
  rpc ExportDocument (ExportRequest)   returns (ExportResponse);
}

message CompactRequest {
  string download_url      = 1;
  string upload_url        = 2;
  string base_snapshot_url = 3;
}

message CompactResponse {
  bool   success              = 1;
  string error_message        = 2;
  uint32 updates_merged       = 3;
  uint64 compacted_size_bytes = 4;
}

message ExportRequest {
  string snapshot_url        = 1;
  string pending_updates_url = 2;
  string upload_url          = 3;
}

message ExportResponse {
  bool   success        = 1;
  string error_message  = 2;
  uint64 exported_bytes = 3;
}
```

### 4.1 RPC: `CompactDocument`
Merges an uncompacted update log with an optional existing base snapshot, uploads the resulting single-state snapshot to the designated URL, and returns the compaction metrics.

#### Request Parameters (`CompactRequest`)
- `download_url` (*string, required*): Presigned MinIO GET URL for the uncompacted length-prefixed update stream in the `uploads` bucket.
- `upload_url` (*string, required*): Presigned MinIO PUT URL for storing the resulting compacted snapshot in the `snapshot` bucket.
- `base_snapshot_url` (*string, optional*): Presigned MinIO GET URL for downloading the prior base snapshot from the `snapshot` bucket. If omitted or empty, compaction builds the document state exclusively from the update log.

#### Response Fields (`CompactResponse`)
- `success` (*bool*): Indicates whether the entire download, decode, merge, encode, and upload sequence completed successfully.
- `error_message` (*string*): Contains the formatted error chain (`{:#}`) if `success` is `false`; empty string on success.
- `updates_merged` (*uint32*): Number of individual length-prefixed Yjs updates parsed and applied to the CRDT document.
- `compacted_size_bytes` (*uint64*): Size in bytes of the final compacted snapshot uploaded to MinIO.

### 4.2 RPC: `ExportDocument`
Extracts plain UTF-8 text from a base snapshot and optional pending update log, uploading the resulting plain-text file to object storage.

#### Request Parameters (`ExportRequest`)
- `snapshot_url` (*string, required*): Presigned MinIO GET URL for the base snapshot from the `snapshot` bucket.
- `pending_updates_url` (*string, optional*): Presigned MinIO GET URL for pending updates from the `uploads` bucket. If provided and non-empty, pending updates are folded into the document state before extraction.
- `upload_url` (*string, required*): Presigned MinIO PUT URL for writing the extracted text to the `text` bucket.

#### Response Fields (`ExportResponse`)
- `success` (*bool*): Indicates whether document reconstruction, text extraction, and text upload succeeded.
- `error_message` (*string*): Contains the formatted error chain if `success` is `false`; empty string on success.
- `exported_bytes` (*uint64*): Number of UTF-8 bytes written to the `text` bucket.

---

## 5. Detailed Component Workflows & Execution Flow

### 5.1 Document Compaction Workflow (`CompactDocument`)

```
projects-service                 file-data-service                     MinIO Storage
       |                                |                                    |
       |--- CompactDocument(req) ------>|                                    |
       |                                |--- GET base_snapshot_url --------->|
       |                                |<-- 200 OK (Base Snapshot) ---------|
       |                                |                                    |
       |                                |--- GET download_url (updates) ---->|
       |                                |<-- 200 OK (Update Log Stream) -----|
       |                                |                                    |
       |                                | [Decode Length-Prefixed Frames]    |
       |                                | [yrs::Doc::new()]                  |
       |                                | [Apply Base Snapshot to Txn]       |
       |                                | [Apply Incremental Updates to Txn] |
       |                                | [Encode State as v1 Update]        |
       |                                |                                    |
       |                                |--- PUT upload_url (Snapshot) ----->|
       |                                |<-- 200 OK -------------------------|
       |                                |                                    |
       |<-- CompactResponse(success) ---|                                    |
```

1. **Request Reception & Validation**:
   - `CompactionServiceImpl::compact_document` receives the gRPC `CompactRequest`.
   - Validates that `download_url` and `upload_url` are non-empty. If either is missing, returns `tonic::Status::invalid_argument`.
2. **Base Snapshot Retrieval (Optional & Resilient)**:
   - If `base_snapshot_url` is non-empty, issues an HTTP GET via `http::download_bytes`.
   - If downloading the base snapshot fails (e.g., first-time file creation where no previous snapshot exists), the error is logged as a warning (`warn!`) and compaction gracefully proceeds with `base_snapshot = None`.
3. **Update Log Retrieval**:
   - Downloads the length-prefixed update byte stream from `download_url`.
   - Rejects non-2xx HTTP responses immediately with an error detailing the status code and response body.
4. **Framing Decoding & CRDT Compaction (`compaction::compact_update_log`)**:
   - `decode_length_prefixed` parses the raw byte buffer into discrete `Vec<Vec<u8>>` update payloads.
   - Instantiates a fresh `yrs::Doc`.
   - Opens a single write transaction: `let mut txn = doc.transact_mut()`.
   - If a base snapshot is present, decodes it via `Update::decode_v1` and applies it: `txn.apply_update(base)`.
   - Iterates through the decoded update vectors in sequence, calling `Update::decode_v1` and `txn.apply_update(update)` for each update.
   - Commits the write transaction when `txn` is dropped.
   - Opens a read transaction `let txn = doc.transact()` and encodes the total state via `txn.encode_state_as_update_v1(&StateVector::default())`.
5. **Compacted Snapshot Upload**:
   - Calls `http::upload_bytes` to upload the compacted byte vector to `upload_url`.
   - Sets headers: `Content-Type: application/octet-stream` and explicit `Content-Length`.
6. **Response Dispatch**:
   - Returns a successful `CompactResponse` containing `updates_merged` and `compacted_size_bytes`.
   - In case of failure at any step, returns `CompactResponse { success: false, error_message: ... }` rather than an unhandled gRPC status exception, ensuring caller receives structured diagnostic details.

---

### 5.2 Plain-Text Extraction Workflow (`ExportDocument`)

```
projects-service                 file-data-service                     MinIO Storage
       |                                |                                    |
       |--- ExportDocument(req) ------->|                                    |
       |                                |--- GET snapshot_url -------------->|
       |                                |<-- 200 OK (Base Snapshot) ---------|
       |                                |                                    |
       |                                |--- GET pending_updates_url ------->| (if specified)
       |                                |<-- 200 OK (Pending Updates) -------|
       |                                |                                    |
       |                                | [yrs::Doc::new()]                  |
       |                                | [Apply Snapshot to Txn]            |
       |                                | [Apply Pending Updates to Txn]     |
       |                                | [doc.get_or_insert_text("content")]|
       |                                | [text.get_string(&txn)]            |
       |                                |                                    |
       |                                |--- PUT upload_url (Plain Text) --->|
       |                                |<-- 200 OK -------------------------|
       |                                |                                    |
       |<-- ExportResponse(success) ----|                                    |
```

1. **Request Reception & Validation**:
   - Validates that `snapshot_url` and `upload_url` are non-empty.
2. **Snapshot and Pending Updates Download**:
   - Downloads the base snapshot from `snapshot_url` (required).
   - If `pending_updates_url` is non-empty, downloads the uncompacted update log from `pending_updates_url`.
3. **CRDT State Reconstruction (`export::extract_text_bytes`)**:
   - Instantiates a fresh `yrs::Doc`.
   - Opens a write transaction `txn = doc.transact_mut()`.
   - Applies the base snapshot: `txn.apply_update(Update::decode_v1(snapshot)?)`.
   - If pending updates exist, decodes length-prefixed frames and applies each update sequentially to `txn`.
   - Commits the write transaction.
4. **Text Type Extraction**:
   - Opens a read transaction `txn = doc.transact()`.
   - Accesses the root CRDT text structure: `let text = doc.get_or_insert_text("content")`.
   - Extracts the complete plain-text string: `let content = text.get_string(&txn)`.
   - Converts the string to UTF-8 `Bytes`.
5. **Text Upload**:
   - Dispatches HTTP PUT to `upload_url` via `http::upload_text`.
   - Sets headers: `Content-Type: text/plain; charset=utf-8` and explicit `Content-Length`.
6. **Response Dispatch**:
   - Returns `ExportResponse` with `success = true` and `exported_bytes = text_bytes.len()`.

---

## 6. Inter-Service Interactions & System Integration

The `file-data-service` is an essential downstream worker supporting real-time editing, document persistence, compilation, and RAG-based AI assistance.

### 6.1 Interaction with `collab-service` (via `projects-service`)
- **Trigger**: When all collaborative editors disconnect from a document room, `collab-service` flushes its in-memory update buffer to the `uploads` bucket in MinIO.
- **Compaction Invocation**: `collab-service` triggers `projects-service` via `GET /projects/internal/v1/file/:fileID/compact`.
- **Execution**: `projects-service` generates presigned MinIO URLs and calls `file-data-service:CompactDocument`.
- **Cleanup**: Upon successful compaction, `projects-service` purges the obsolete length-prefixed update log from the `uploads` bucket, leaving only the minimal compacted snapshot in the `snapshot` bucket.

### 6.2 Interaction with `assistant-service` (via `projects-service`)
- **Trigger**: When a user mentions a file (`@file.tex`), requests AI chat completions, or enables automatic project indexing (`PATCH /projects/{project_id}/auto-context`), `assistant-service` requests project text download URLs via `GET /projects/internal/v1/project/{id}/download?type=text`.
- **ETag Validation**: `projects-service` inspects `files.text_source_etag` against the current ETag of the `uploads` object.
- **On-Demand Text Generation**: If the ETag is outdated, `projects-service` issues an `ExportDocument` gRPC call to `file-data-service` to regenerate the plain text representation in the `text` bucket and updates the database ETag.
- **Consumption**: `assistant-service` downloads the plain-text LaTeX source from the `text` bucket to execute structural chunking, vector embedding generation (Voyage AI), and prompt injection.

### 6.3 Interaction with `compile-service` (via `projects-service`)
- **Trigger**: When a user initiates a LaTeX build (`pdflatex`, `xelatex`, `lualatex`), `compile-service` requests project files and source texts from `projects-service`.
- **Fresh Text Guarantee**: `projects-service` uses `file-data-service`'s `ExportDocument` to ensure that all LaTeX source files in the `text` bucket reflect the latest CRDT edits before compilation sandboxes mount the project directory.

### 6.4 Service Interaction Matrix

| Upstream Caller | Protocol | Operation / RPC | Purpose |
|-----------------|----------|-----------------|---------|
| `projects-service` | gRPC (`proto3`) | `CompactDocument` | Merges uncompacted updates into a unified snapshot upon room close or explicit trigger. |
| `projects-service` | gRPC (`proto3`) | `ExportDocument` | Extracts UTF-8 plain text from CRDT documents for AI RAG indexing and LaTeX compilation. |

---

## 7. Performance, Concurrency & Resource Characteristics

### 7.1 Zero-Allocation & Commutative CRDT Transactions
- **Batched Transactions**: In `compaction.rs` and `export.rs`, all decoded update frames are applied within a single `doc.transact_mut()` block. Batching updates into one transaction avoids intermediate state recalculations and significantly reduces memory allocation overhead.
- **Commutative Update Application**: Because Yjs updates are commutative and idempotent, frames can be applied sequentially without topological sorting, guaranteeing deterministic convergence across all distributed clients.
- **Compact State Serialization**: Compacting state with `encode_state_as_update_v1(&StateVector::default())` eliminates tombstones and structural redundancies, reducing memory footprint by up to 80–90% compared to raw operation logs.

### 7.2 Connection Pooling & Asynchronous I/O
- **Reused HTTP Client**: `CompactionServiceImpl` maintains a single `reqwest::Client` instance wrapped in an `Arc`. The client retains an internal connection pool, minimizing TCP/TLS handshake latency when performing multiple presigned S3 operations.
- **Client Timeouts**: Configured with an explicit 120-second timeout (`Duration::from_secs(120)`) to guard against hung S3 connections while accommodating large document transfers.
- **Non-Blocking Tokio Runtime**: The multi-threaded Tokio runtime handles concurrent gRPC requests across worker threads, utilizing lightweight green threads (tasks) for I/O and CPU-bound CRDT decoding.

### 7.3 Embedded ARM64 Efficiency
- Designed to run efficiently within resource-constrained environments (e.g., Raspberry Pi 5 with 4GB/8GB RAM).
- Zero-copy byte slicing via the `bytes` crate ensures update payloads are referenced without duplicate heap allocations.
- Minimal binary size (~15MB compressed) and zero garbage collection overhead ensure predictable latency spikes during bulk compilation or indexing operations.

---

## 8. Configuration, Observability & Deployment

### 8.1 Configuration Parameters
The service loads runtime settings from environment variables on startup:

| Environment Variable | Default Value | Description |
|----------------------|---------------|-------------|
| `GRPC_ADDR` | `0.0.0.0:50051` | Network interface and port for the gRPC server listener. Set to `[::]:50051` in production container. |
| `RUST_LOG` | `info` | Logging verbosity filter directive (e.g., `info`, `debug`, `compaction_service=trace`). |

### 8.2 Observability & Tracing
- **Structured Tracing**: Implemented using `tracing` and `tracing-subscriber`.
- **Span Instrumentation**: All gRPC handler functions are annotated with `#[instrument]`, attaching contextual metadata (`download_url`, `upload_url`, `updates_merged`, `compacted_size_bytes`, `exported_bytes`) to all nested log events.
- **Error Chain Propagation**: Detailed error reporting using `anyhow` ensures that nested network, decoding, and I/O failures are logged with full root-cause error chains (`{:#}`).

### 8.3 Health Checking & Liveness Probes
- In production containers, a custom lightweight Rust binary (`/app/healthcheck`) is compiled and executed by Docker's `HEALTHCHECK` directive.
- **Mechanism**: The probe performs a local TCP socket connection test against the port defined in `GRPC_ADDR` (verifying both IPv4 `127.0.0.1:<port>` and IPv6 `[::1]:<port>`).
- **Configuration**:
  ```dockerfile
  HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
      CMD ["/app/healthcheck"]
  ```

### 8.4 Graceful Shutdown Lifecycle
- The server captures `SIGINT` (Ctrl+C) and `SIGTERM` signals via `tokio::signal`.
- Upon receiving a termination signal, Tonic stops accepting new inbound connections, drains in-flight compaction and export RPCs, and terminates cleanly, preventing corrupted or partial snapshot writes during container restarts or Docker Swarm rolling updates.

### 8.5 Container Security & Multi-Stage Build
- **Multi-Stage Build**: Built with `rust:1.94-bookworm` (with Cargo cache mounts for dependencies and target directories), deployed onto minimal `debian:bookworm-slim`.
- **Non-Root Execution**: Runs under a dedicated unprivileged system user and group (`appuser:appgroup`).
- **Minimal Attack Surface**: The runtime container contains only essential runtime libraries (`ca-certificates`, `libssl3`) and the application binaries (`/app/server`, `/app/healthcheck`).
- **No Secret Storage**: The container holds no storage access keys, database passwords, or JWT secrets. Access is strictly mediated via caller-provided presigned URLs.
