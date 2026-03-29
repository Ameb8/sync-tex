package hub

import (
	"log"
	"sync"
	"time"

	"github.com/ameb8/sync-tex/collab-service/internal/client"
	"github.com/ameb8/sync-tex/collab-service/internal/persist"
	"github.com/ameb8/sync-tex/collab-service/internal/yjs"
)

// Document holds all runtime state for one open collaborative file.
type Document struct {
	ID      string
	mu      sync.RWMutex
	clients map[*client.Client]bool

	// updateLog accumulates binary Yjs updates since last compaction.
	// New clients receive all of these in sequence to reach current state.
	updateLog [][]byte

	// seeder downloads the initial binary Yjs state from the file store.
	// sync.Once inside ensures it only runs on first client connect.
	seeder *persist.Seeder

	// uploader PUTs the current update log to the file store.
	uploader *persist.Uploader

	// debounce timer — reset on every document update, fires upload after
	// a quiet period. Replaced by a fresh timer each reset.
	debounceTimer *time.Timer
	debounceDelay time.Duration
}

// Hub is the global registry of open documents.
type Hub struct {
	mu        sync.RWMutex
	documents map[string]*Document

	seederFactory   func(docID string) *persist.Seeder
	uploaderFactory func(docID string) *persist.Uploader
	debounceDelay   time.Duration
}

func New(
	seederFactory func(docID string) *persist.Seeder,
	uploaderFactory func(docID string) *persist.Uploader,
	debounceDelay time.Duration,
) *Hub {
	return &Hub{
		documents:       make(map[string]*Document),
		seederFactory:   seederFactory,
		uploaderFactory: uploaderFactory,
		debounceDelay:   debounceDelay,
	}
}

// GetOrCreate returns the Document for docID, creating it if needed.
func (h *Hub) GetOrCreate(docID string) *Document {
	h.mu.Lock()
	defer h.mu.Unlock()

	if doc, ok := h.documents[docID]; ok {
		return doc
	}
	doc := &Document{
		ID:            docID,
		clients:       make(map[*client.Client]bool),
		seeder:        h.seederFactory(docID),
		uploader:      h.uploaderFactory(docID),
		debounceDelay: h.debounceDelay,
	}
	h.documents[docID] = doc
	log.Printf("[hub] created doc %s\n", docID)
	return doc
}

// removeIfEmpty evicts the document from the hub if no clients remain.
func (h *Hub) removeIfEmpty(doc *Document) {
	h.mu.Lock()
	defer h.mu.Unlock()

	doc.mu.RLock()
	count := len(doc.clients)
	doc.mu.RUnlock()

	if count == 0 {
		delete(h.documents, doc.ID)
		log.Printf("[hub] evicted empty doc %s\n", doc.ID)
	}
}

// Register adds a client to its document
func (h *Hub) Register(c *client.Client) {
	doc := h.GetOrCreate(c.DocID)

	// Seed the new client with current document state before registering
	// it in the client map, so it doesn't receive its own seed as a broadcast.
	h.seedClient(doc, c)

	doc.mu.Lock()
	doc.clients[c] = true
	n := len(doc.clients)
	doc.mu.Unlock()

	log.Printf("[%s] %s (%s) connected — %d clients\n", c.DocID, c.UserID, c.Role, n)
}

// seedClient sends the persisted state followed by all in-memory updates
// to bring a new client to the current document state.
func (h *Hub) seedClient(doc *Document, c *client.Client) {
	// Load persisted state (sync.Once — only downloads on first connect)
	seed := doc.seeder.Load()

	doc.mu.RLock()
	// Copy update log under read lock to avoid holding it during sends
	updates := make([][]byte, len(doc.updateLog))
	copy(updates, doc.updateLog)
	doc.mu.RUnlock()

	log.Printf("[%s] seeding %s — seed=%d bytes, %d in-memory updates\n",
		doc.ID, c.UserID, len(seed), len(updates))

	if len(seed) == 0 && len(updates) == 0 {
		log.Printf("[%s] no state to seed for %s\n", doc.ID, c.UserID)
		return
	}

	// Split length-prefixed seed blob into individual payloads and send each
	// as a separate WebSocket message. Y.applyUpdate handles one update at a
	// time — sending a concatenated blob causes it to apply only the first entry.
	seedCount := 0
	remaining := seed
	for len(remaining) >= 4 {
		length := uint32(remaining[0])<<24 | uint32(remaining[1])<<16 |
			uint32(remaining[2])<<8 | uint32(remaining[3])
		remaining = remaining[4:]
		if int(length) > len(remaining) {
			log.Printf("[%s] seed blob corrupted at entry %d\n", doc.ID, seedCount)
			break
		}
		payload := remaining[:length]
		remaining = remaining[length:]
		c.Send <- payload
		seedCount++
	}
	log.Printf("[%s] sent %d seed entries to %s\n", doc.ID, seedCount, c.UserID)

	// Send in-memory updates (already individual payloads)
	for i, payload := range updates {
		c.Send <- payload
		log.Printf("[%s] replayed update %d/%d (%d bytes) to %s\n",
			doc.ID, i+1, len(updates), len(payload), c.UserID)
	}
}

// Unregister removes a client. If it was the last one, triggers a final save
// and evicts the document from the hub.
func (h *Hub) Unregister(c *client.Client) {
	doc := h.GetOrCreate(c.DocID)

	doc.mu.Lock()
	if _, ok := doc.clients[c]; !ok {
		doc.mu.Unlock()
		return
	}
	delete(doc.clients, c)
	remaining := len(doc.clients)

	// Cancel any pending debounce before final upload
	if doc.debounceTimer != nil {
		doc.debounceTimer.Stop()
		doc.debounceTimer = nil
	}

	close(c.Send)
	doc.mu.Unlock()

	log.Printf("[%s] %s disconnected (%d remaining)\n", c.DocID, c.UserID, remaining)

	// Last client — upload synchronously before evicting so no edits are lost.
	if remaining == 0 {
		// Run as a goroutine so Unregister returns promptly to the pump.
		go func() {
			doc.upload()
			h.removeIfEmpty(doc)
		}()
	}
}

// HandleMessage is the central dispatch called by client.ReadPump.
func (h *Hub) HandleMessage(c *client.Client, msg []byte) {
	log.Printf("[%s] HandleMessage from %s — %d bytes, first byte=0x%02x\n",
		c.DocID, c.UserID, len(msg), msg[0])

	doc := h.GetOrCreate(c.DocID)

	m, ok := yjs.Parse(msg)
	if !ok { // Message parse failure
		log.Printf("[%s] failed to parse message from %s — first byte=0x%02x len=%d\n",
			c.DocID, c.UserID, msg[0], len(msg))
		return
	}

	// Log message
	log.Printf("[%s] parsed outer=%d inner=%d payload=%d bytes\n",
		c.DocID, m.Outer, m.Inner, len(m.Payload))

	switch m.Outer {
	case yjs.MsgAwareness:
		// Awareness (cursors/presence) — broadcast to all peers including viewers.
		log.Println("[Message Type]: Awareness")
		Broadcast(doc, c, msg)

	case yjs.MsgSync:
		switch m.Inner {
		case yjs.SyncStep1:
			// New client requesting state. Broadcast to trigger peers to respond
			// with their current state, catching up any edits since last flush.
			log.Println("[Message Type]: SyncStep1")
			Broadcast(doc, c, msg)

		case yjs.SyncStep2, yjs.SyncUpdate:
			log.Println("[Message Type]: SyncStep2")
			// Document update — viewers cannot push these.
			if !c.CanWrite() {
				log.Printf("[%s] blocked update from viewer %s\n", c.DocID, c.UserID)
				return
			}
			// Log every incoming update
			log.Printf("[%s] update received from %s — type=%d inner=%d payload=%d bytes\n",
				doc.ID, c.UserID, m.Outer, m.Inner, len(m.Payload))

			// Append changes to in-memory update log
			doc.mu.Lock()
			doc.updateLog = append(doc.updateLog, m.Payload)
			logLen := len(doc.updateLog)
			doc.mu.Unlock()

			log.Printf("[%s] update log now has %d entries\n", doc.ID, logLen)

			BroadcastPayload(doc, c, m.Payload) // Broadcast changes
			doc.scheduleUpload()                // Reset debounce timer
		}
	}
}

// BroadcastPayload sends raw Yjs update bytes to every client except the sender.
func BroadcastPayload(doc *Document, sender *client.Client, payload []byte) {
	doc.mu.RLock()
	defer doc.mu.RUnlock()

	for peer := range doc.clients {
		if peer == sender {
			continue
		}
		select {
		case peer.Send <- payload:
		default:
			log.Printf("[%s] dropped payload for slow peer %s\n", doc.ID, peer.UserID)
		}
	}
}

// scheduleUpload resets the debounce timer. The upload fires after a quiet
// period with no new updates.
func (doc *Document) scheduleUpload() {
	doc.mu.Lock()
	defer doc.mu.Unlock()

	if doc.debounceTimer != nil {
		doc.debounceTimer.Stop()
	}

	log.Printf("[%s] upload debounce armed (%s)\n", doc.ID, doc.debounceDelay)
	doc.debounceTimer = time.AfterFunc(doc.debounceDelay, func() {
		log.Printf("[%s] debounce fired — uploading\n", doc.ID)
		doc.upload()
	})
}

// upload concatenates the seed and all update log entries into a single
// blob and PUTs it to the file store. Errors are logged but not fatal —
// the next debounce cycle will retry.
func (doc *Document) upload() {
	seed := doc.seeder.Load()

	doc.mu.RLock()
	updates := make([][]byte, len(doc.updateLog))
	copy(updates, doc.updateLog)
	doc.mu.RUnlock()

	if len(seed) == 0 && len(updates) == 0 {
		log.Printf("[%s] nothing to upload\n", doc.ID)
		return
	}

	// Build blob: each entry is [4-byte big-endian length][payload bytes]
	// This allows seedClient to split entries on next load.
	var buf []byte

	// Re-emit existing seed entries (already length-prefixed from previous upload)
	buf = append(buf, seed...)

	// Append new update entries with length prefix
	for _, payload := range updates {
		length := uint32(len(payload))
		buf = append(buf, byte(length>>24), byte(length>>16), byte(length>>8), byte(length))
		buf = append(buf, payload...)
	}

	log.Printf("[%s] uploading %d bytes (%d seed + %d updates)\n",
		doc.ID, len(buf), len(seed), len(updates))

	if err := doc.uploader.Upload(buf); err != nil {
		log.Printf("[%s] upload failed: %v\n", doc.ID, err)
		return
	}
	log.Printf("[%s] upload succeeded\n", doc.ID)

}
