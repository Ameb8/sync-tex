# collab-service

Go. Real-time Yjs collaboration relay. Operates entirely on raw binary WebSocket frames — no Yjs decoding.

## Protocol

1. Client connects via WebSocket: `/collab/:project_id?token=<jwt>`
2. Service validates JWT, then fetches latest snapshot and updates log MinIO download urls from projects-service and sends it to the client as the initial state.
3. All subsequent messages are raw Yjs binary frames. Service broadcasts each frame to all other clients in the same project room and appends to update log.
4. Debounced timer triggers persistence by merging update log and uploading to MinIO.
5. Notifies projects-service and conducts final MinIO upload when file room becomes empty.

## Binary Protocol

Each websocket message starts with a 2-byte envelope.

### Byte 0 (Outer Type):

-- **0** *Sync*: document state updates (edits, snapshots)

-- **1** *Awareness*: ephemeral metadata (cursors, presence, selections) 

### Byte 1 (Inner Type):

-- **0** *SyncStep1*: client sends state vector requesting updates

-- **1** *SyncStep2*: server responding with full or partial state

-- **2** *Update: incremental edits after initial sync completed

## Rooms

In-memory map of `project_id → [connections]`. No Redis/pubsub; single-instance only. If horizontal scaling is needed this must change.


## Env

```
JWT_SECRET
FILE_DATA_SERVICE_ADDR   # gRPC address
PROJECTS_SERVICE_URL
```