# System Design Document: Collab Service (`collab-service`)

## 1. Executive Summary & Purpose

The **Collab Service** (`collab-service`) is the real-time collaboration engine of the SyncTeX platform. Built in Go, it functions as a high-performance, non-decoding WebSocket relay for collaborative document editing powered by the Yjs Conflict-free Replicated Data Type (CRDT) framework.

### Primary Responsibilities
- **WebSocket Connection Lifecycle**: Accepts, authenticates, and maintains persistent full-duplex WebSocket connections from browser clients.
- **Opaque Yjs Binary Relay**: Routes raw binary CRDT updates and awareness frames between clients editing the same document without deserializing CRDT structures.
- **Role-Based Permission Enforcement**: Restricts write operations based on user roles (`owner`, `editor`, vs. `viewer`), filtering out unauthorized document mutations while permitting presence/cursor awareness.
- **Initial Document Seeding**: Reconstructs current document state for newly connected clients by fetching compacted snapshots and uncompacted update logs from object storage (MinIO via `projects-service`) and replaying in-memory delta updates.
- **Debounced Persistence**: Buffers incremental update frames in memory and flushes them to object storage via presigned URLs on a debounced timer.
- **Room Lifecycle & Compaction Trigger**: Manages in-memory document room allocation and triggers asynchronous snapshot compaction via `projects-service` when all editors disconnect from a document room.

---

## 2. Core Design Principles & Architectural Patterns

### 2.1 Opaque / Zero-Decode Binary Relay
Unlike traditional collaborative backends that parse operation transforms or deserialize CRDT trees in memory, `collab-service` operates almost entirely on raw binary payloads:
- It inspects only the leading 1–2 envelope bytes to determine the message category (`Sync` vs. `Awareness`) and sub-action (`SyncStep1`, `SyncStep2`, `SyncUpdate`).
- CRDT state resolution, vector clock comparison, and conflict resolution are delegated to the clients (frontend Yjs instances) and the asynchronous compaction worker (`file-data-service` in Rust).
- This architecture minimizes CPU and memory overhead, avoids garbage collection pauses in Go, and ensures horizontal throughput for large binary payloads.

### 2.2 Goroutine-per-Connection Pump Pattern
Every connected client executes two dedicated goroutines:
1. **`ReadPump`**: Reads binary frames from the WebSocket connection, enforces heartbeat deadlines (pong timeouts), validates envelope framing, and dispatches messages to the hub.
2. **`WritePump`**: Reads serialized messages from a buffered Go channel (`Send` channel with capacity 512) and flushes them to the underlying WebSocket connection. It also manages periodic WebSocket `Ping` control frames.

### 2.3 Centralized Thread-Safe Hub & Document Rooms
The service organizes active collaborative sessions into document rooms managed by a central `Hub`. Synchronization is maintained using read/write mutexes (`sync.RWMutex`), providing lock granularity at both the global hub level (for room creation/deletion) and individual document room level (for client registration, awareness caching, and update appending).

---

## 3. Communication Protocols & Wire Framing

### 3.1 WebSocket Handshake & Route
- **Route**: `GET /ws/<docId>?projectId=<projectId>&token=<jwt>`
- **Subprotocol**: Gorilla WebSocket binary framing over HTTP/1.1 upgraded connections.
- **Reverse Proxy Route**: Handled through nginx at `/ws/` with HTTP/1.1 upgrade headers and buffering disabled.

### 3.2 Binary Message Envelope Format
Every incoming and outgoing message on the WebSocket connection adheres to the standard Yjs binary wire protocol. The envelope consists of a 1- or 2-byte header followed by the binary payload:

#### Outer Message Type (Byte 0)
- `0x00` (`MsgSync`): Document synchronization and mutation frames.
- `0x01` (`MsgAwareness`): Ephemeral presence data (cursor positions, user selections, client metadata, user color).

#### Inner Sync Type (Byte 1, evaluated when Byte 0 is `MsgSync`)
- `0x00` (`SyncStep1`): Client state vector request. Sent by a client to query missing document state from peers.
- `0x01` (`SyncStep2`): Document state payload. Sent by server/peers containing full or partial CRDT state updates.
- `0x02` (`SyncUpdate`): Incremental CRDT update representing user edits (insertions, deletions, formatting).

### 3.3 Persistence Storage Framing (Length-Prefixed Framing)
When persisting uncompacted update logs to MinIO, multiple discrete Yjs update blobs are concatenated into a single byte stream using 4-byte big-endian length prefixes:

```
[ 4-byte uint32 length N ] [ N bytes of binary Yjs update payload ]
[ 4-byte uint32 length M ] [ M bytes of binary Yjs update payload ]
...
```

This framing allows the `Seeder` to split the combined storage object into individual discrete `SyncStep2` frames upon room initialization, ensuring that client-side `Y.applyUpdate` decodes each frame correctly.

---

## 4. Authentication, Authorization & Access Control

Authentication and authorization occur **prior** to the WebSocket upgrade to ensure that unauthorized connections receive standard HTTP error responses rather than abrupt WebSocket disconnects.

### 4.1 Token Extraction
Tokens are extracted via `auth.ExtractToken`:
1. `Authorization: Bearer <token>` header (if supplied by the client or reverse proxy).
2. `token` query parameter: `?token=<jwt>` (standard for browser WebSocket APIs which cannot set custom HTTP headers during connection establishment).

### 4.2 Pre-Upgrade Validation with `projects-service`
The `auth.Checker` issues a synchronous HTTP GET request to `projects-service`:
- **Endpoint**: `GET /projects/v1/projects/:projectID/access`
- **Headers**:
  - `Authorization: Bearer <token>`
  - `X-Internal-Secret: <INTERNAL_SECRET>`
- **Response Format**:
  ```json
  {
    "allowed": true,
    "user_id": "usr_94a7e2b1",
    "role": "owner"
  }
  ```
- **Error Handling**:
  - HTTP 401 / 403: Returns HTTP 403 Forbidden to client.
  - Non-200 or Network Timeout: Returns HTTP 503 Service Unavailable.

### 4.3 Role-Based Permissions in Live Session
- **Owner / Editor**: Full read/write access. Updates (`SyncUpdate`, `SyncStep2`) are broadcast to peers and appended to the document's update log for persistence.
- **Viewer**: Read-only access. Viewers receive initial document snapshots and real-time updates. They may broadcast `MsgAwareness` (cursor/presence) and emit `SyncStep1` (state synchronization request), but any inbound `SyncUpdate` or `SyncStep2` messages are silently dropped by `isViewerBlocked` checks.

---

## 5. Runtime Architecture & Data Structures

`collab-service` manages active sessions completely in memory using Go data structures organized in a hierarchical relationship:

- **Hub Hierarchy**:
  - The singleton **Hub** maintains a registry map of active documents (`map[string]*Document`).
  - Each **Document** instance manages room-specific state, including its connected clients (`map[*client.Client]bool`), cached awareness states (`map[*client.Client][]byte`), in-memory update history (`[][]byte`), and persistence controllers (`Seeder` and `Uploader`).
  - Each **Client** represents an active WebSocket connection with its own buffered channel (`Send chan []byte`), identity metadata, and role permissions.

### 5.1 Structure Definitions & Memory Layout

#### `Hub`
The singleton root coordinator holding all active document rooms:
- `documents`: Hash map mapping `docID` (file UUID string) to `*Document`.
- `seederFactory` / `uploaderFactory`: Factory functions decoupling persistence layer initialization from hub internals.

#### `Document`
Represents an active document collaboration room:
- `clients`: Set of active connected `*Client` references.
- `awareness`: Hash map storing the most recent raw awareness frame per client, enabling fast replay to newly connected peers.
- `snapshot`: Cached binary snapshot downloaded on initial room creation.
- `updateLog`: Slice of raw binary Yjs update slices (`[][]byte`) received during the active lifetime of the room.
- `debounceTimer`: Re-armable timer that coordinates asynchronous writes to object storage after edit bursts.

#### `Client`
Represents a single active WebSocket connection:
- `Send`: 512-slot buffered byte channel. Outbound broadcasts are non-blocking; if a slow or unresponsive client exhausts the buffer, the message is dropped rather than blocking the hub.
- `UserID` & `Role`: Identity and authorization level established during handshake.

---

## 6. Data Storage & Persistence Model

### 6.1 Database Strategy
`collab-service` is **stateless with regards to local relational/SQL storage**. It does not run its own PostgreSQL or SQLite database, nor does it maintain a local disk database.

- **Persistent State Ownership**: Canonical project and file metadata reside in `projects-service` (backed by PostgreSQL `postgres-projects`).
- **Object Payloads**: Document binary data (compacted snapshots and update logs) reside in MinIO S3 object storage.
- **Relational Schema Reference**: For relational metadata schemas governing file IDs, project access permissions, and collaborator roles, refer to `<ERD-DIAGRAM>` within the `projects-service` documentation.

### 6.2 MinIO Storage Layout
For each collaborative document (`docID`), storage objects are partitioned across MinIO buckets:
- `snapshot` bucket: Contains the fully compacted Yjs binary document state (key: `<storageKey>`).
- `uploads` bucket: Contains the concatenated length-prefixed uncompacted update frames (key: `<storageKey>`).
- `text` bucket: Contains plain UTF-8 text representations exported for non-collaborative workflows or compilation.

---

## 7. End-to-End Operational Workflows

### 7.1 Client Connection & Initial Seeding Flow
1. **Handshake**: Client initiates WebSocket connection: `GET /ws/<fileID>?projectId=<projectID>&token=<jwt>`.
2. **Access Gate**: `WSHandler` validates access against `projects-service`.
3. **Upgrade**: Gorilla WebSocket upgrader upgrades connection with 4096-byte buffers.
4. **Room Lookup/Creation**: `Hub.GetOrCreate(docID)` fetches the existing room or instantiates a new `Document`.
5. **Initial State Seeding**:
   - `Seeder.Load()` executes (guarded by `sync.Once`).
   - Requests presigned download URLs for `uploads` and `snapshot` buckets from `projects-service` (`GET /projects/internal/v1/file/:fileID/download?type=uploads,snapshot`).
   - Downloads binary snapshot and length-prefixed update logs from MinIO.
6. **Seed Delivery**:
   - Server sends `WrapSyncStep2(snapshot)` to client.
   - Server unpacks length-prefixed entries from the seed updates log and sends each as a discrete `WrapSyncStep2(payload)`.
   - Server replays any accumulated in-memory `doc.updateLog` entries as `WrapSyncUpdate(payload)`.
   - Server transmits all cached peer awareness states from `doc.awareness`.
7. **Client Registration & Goroutine Spawn**:
   - Client is added to `doc.clients`.
   - `c.ReadPump(hub)` and `c.WritePump()` goroutines are launched.

### 7.2 Real-Time Collaboration & Message Routing Flow
1. **Frame Ingestion**: `c.ReadPump` receives a binary frame from client.
2. **Envelope Parsing**: `yjs.Parse(msg)` extracts `Outer`, `Inner`, and `Payload`.
3. **Dispatch Handling**:
   - **Awareness (`Outer == 0x01`)**:
     - Caches raw awareness frame in `doc.awareness[c]`.
     - Non-blocking broadcast to all other room clients (`Broadcast(doc, c, msg)`).
   - **SyncStep1 (`Outer == 0x00, Inner == 0x00`)**:
     - Client is requesting delta updates based on its state vector.
     - Broadcasts `SyncStep1` to other room peers so active peers can send differential updates.
   - **SyncUpdate / SyncStep2 (`Outer == 0x00, Inner == 0x01 | 0x02`)**:
     - Validates writer permissions (`c.CanWrite()`). If viewer, the update is dropped.
     - Appends raw update payload to `doc.updateLog`.
     - Broadcasts update payload wrapped in `WrapSyncUpdate` to all other connected clients.
     - Resets the upload debounce timer via `doc.scheduleUpload()`.

### 7.3 Debounced Upload Flow
1. **Debounce Trigger**: Incoming document updates call `doc.scheduleUpload()`, resetting the `time.Timer` for `SaveDebounceDelay` (default 5,000 ms).
2. **Upload Execution**: When the timer expires:
   - Copies `doc.updateLog` under a read lock.
   - Concatenates the original seed log with new updates formatted as `[4-byte big-endian length][payload]`.
   - Fetches a presigned upload URL from `projects-service`: `GET /projects/internal/v1/file/:fileID/upload?type=uploads`.
   - Executes an HTTP PUT with `Content-Type: application/octet-stream` directly to MinIO.
   - If upload fails, the error is logged and in-memory updates remain queued for the next debounce trigger.

### 7.4 Room Teardown & Document Compaction Flow
1. **Client Disconnect**: WebSocket connection closes. `ReadPump` calls `Hub.Unregister(c)`.
2. **State Cleanup**:
   - Removes client from `doc.clients` and `doc.awareness`.
   - Stops active debounce timers.
   - Closes client `Send` channel.
3. **Empty Room Evaluation**:
   - If `len(doc.clients) == 0`:
     - Spawns background teardown goroutine.
     - Executes synchronous `doc.upload()` to ensure all outstanding in-memory edits are stored in MinIO.
     - Invokes `projects-service` compaction endpoint: `GET /projects/internal/v1/file/:fileID/compact` with `X-Internal-Secret`.
     - `projects-service` coordinates with `file-data-service` (Rust `yrs`) to merge snapshots and update logs into a unified snapshot and purge the `uploads` bucket.
     - Evicts `doc` from `Hub.documents` map.

### 7.5 Graceful Shutdown Flow
Upon receiving `SIGINT` or `SIGTERM`:
1. Root context cancels HTTP server listener.
2. Server initiates `srv.Shutdown()` with a 40-second grace timeout.
3. Active WebSocket connections close, triggering client cleanup and final persistence uploads.
4. Server exits cleanly without losing in-flight document mutations.

---

## 8. Inter-Service Interactions & Integration Matrix

| Target Component | Communication Mode | Purpose | Authentication / Headers |
| :--- | :--- | :--- | :--- |
| **Frontend Client** | Full-Duplex WebSocket (`/ws/<docId>`) | Real-time Yjs CRDT edit relay & awareness stream | `?token=<JWT>` query param or `Authorization: Bearer <JWT>` |
| **nginx Gateway** | HTTP/1.1 Reverse Proxy | Gateway entrypoint, TLS termination, WebSocket upgrade forwarding | Forwarded headers (`Upgrade`, `Connection`, `X-Forwarded-For`) |
| **projects-service** | Internal HTTP REST (`GET /projects/v1/projects/:id/access`) | Validates user JWT and resolves project access role | `Authorization: Bearer <JWT>`, `X-Internal-Secret: <SECRET>` |
| **projects-service** | Internal HTTP REST (`GET /projects/internal/v1/file/:id/download`) | Obtains presigned S3 URLs to download initial document state | `X-Internal-Secret: <SECRET>` |
| **projects-service** | Internal HTTP REST (`GET /projects/internal/v1/file/:id/upload`) | Obtains presigned S3 URLs to upload uncompacted update logs | `X-Internal-Secret: <SECRET>` |
| **projects-service** | Internal HTTP REST (`GET /projects/internal/v1/file/:id/compact`) | Triggers background Yjs snapshot compaction upon last user disconnect | `X-Internal-Secret: <SECRET>` |
| **MinIO S3** | HTTP PUT / GET (via Presigned URLs) | Reads base snapshots/update logs and writes concatenated updates | S3 Presigned URL query signature |
| **file-data-service** | Indirect (Invoked via `projects-service` gRPC) | Compacts Yjs updates into single snapshot and exports plain text | gRPC internal RPC |

---

## 9. Configuration & Environment Variables

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `PORT` | String | `8080` | Port for the HTTP server to bind and listen on. |
| `PROJECTS_SERVICE_URL` | String | `http://projects-service:8003` | Base internal URL for communicating with `projects-service`. Automatically strips trailing path suffixes. |
| `INTERNAL_SECRET` | String | `dev-secret` | Shared secret key sent in `X-Internal-Secret` header for microservice-to-microservice authentication. |
| `SAVE_DEBOUNCE_MS` | Integer | `5000` | Inactivity debounce window in milliseconds before accumulated updates are flushed to object storage. |
| `LOG_LEVEL` | String | `info` | Logging verbosity level. |

---

## 10. Concurrency Model, Error Handling & Failure Modes

### 10.1 Concurrency & Race Condition Prevention
- **Two-Tier Locking**: `Hub.mu` guards document room instantiation and eviction. `Document.mu` guards client membership, awareness states, update logs, and timers within a specific room.
- **Lock Deferral during I/O**: Mutexes are never held across network I/O calls (HTTP presigned URL generation, MinIO file transfers, or WebSocket socket writes).
- **Snapshot/Log Isolation**: In-memory slices are copied under read locks (`make([][]byte, len(doc.updateLog))`) prior to serialization or transmission.

### 10.2 Slow Peer Mitigation (Head-of-Line Blocking Prevention)
- Each client maintains a buffered Go channel (`Send chan []byte`, cap 512).
- The `Broadcast` function uses a non-blocking `select`:
  ```go
  select {
  case peer.Send <- msg:
  default:
      log.Printf("[%s] dropped msg for slow peer %s\n", doc.ID, peer.UserID)
  }
  ```
- If a client's write queue fills up due to high network latency or stalled TCP windows, non-essential awareness or delta frames are dropped, and subsequent heartbeat timeouts close the stalled connection.

### 10.3 Heartbeat & Dead Peer Detection
- Clients must respond to WebSocket `Ping` control frames with standard `Pong` replies.
- `pingPeriod` is set to 30 seconds.
- `pongWait` deadline is set to 60 seconds. If no pong is received within 60 seconds, the connection is aborted, triggering cleanup and room eviction.

### 10.4 Resilient Seeding & Partial State Recovery
- If MinIO snapshot download fails (e.g. 404 for newly created files), the seeder treats it as an empty document and proceeds without failing.
- If the length-prefixed seed updates log contains a corrupted entry, parsing terminates at the corrupted boundary and logs the anomaly without crashing the session.

---

## 11. Deployment, Containerization & Health Checks

### 11.1 Containerization
- **Multi-Stage Build**: Built with Go 1.24 on Debian Bookworm with BuildKit cache mounts (`/go/pkg/mod`, `/root/.cache/go-build`).
- **Static Compilation**: Compiled with `CGO_ENABLED=0` and `-ldflags="-s -w"` to produce a fully self-contained static binary.
- **Distroless Runtime**: Deployed on `gcr.io/distroless/static-debian12` running under an unprivileged `nonroot` user.
- **ARM64 Architecture**: Fully compatible with Linux ARM64 (Raspberry Pi 5 target).

### 11.2 Health Checking
- The service exposes `GET /health` returning HTTP 200 OK.
- Because distroless images lack `curl` and `wget`, a minimal static Go binary `/app/healthcheck` is compiled during container build and executed by Docker's `HEALTHCHECK` probe every 15 seconds.
