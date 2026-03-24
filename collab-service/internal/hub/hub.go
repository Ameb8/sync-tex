package hub

import (
	"log"
	"sync"

	"github.com/ameb8/sync-tex/collab-service/internal/client"
	"github.com/ameb8/sync-tex/collab-service/internal/persist"
	"github.com/ameb8/sync-tex/collab-service/internal/save"
	"github.com/ameb8/sync-tex/collab-service/internal/yjs"
)

// Document holds all runtime state for one open collaborative file.
type Document struct {
	ID      string
	mu      sync.RWMutex
	clients map[*client.Client]bool

	// coordinator manages debounced save scheduling and client nomination.
	coordinator *save.Coordinator

	// seeder fetches the initial Yjs state from projects-service on first connect.
	seeder *persist.Seeder
}

// Hub is the global registry of open documents.
type Hub struct {
	mu        sync.RWMutex
	documents map[string]*Document

	// Dependencies injected at startup.
	saveCoordFactory func(docID string) *save.Coordinator
	seederFactory    func(docID string) *persist.Seeder
}

func New(
	saveCoordFactory func(docID string) *save.Coordinator,
	seederFactory func(docID string) *persist.Seeder,
) *Hub {
	return &Hub{
		documents:        make(map[string]*Document),
		saveCoordFactory: saveCoordFactory,
		seederFactory:    seederFactory,
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
		ID:          docID,
		clients:     make(map[*client.Client]bool),
		coordinator: h.saveCoordFactory(docID),
		seeder:      h.seederFactory(docID),
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
		doc.coordinator.Stop()
		delete(h.documents, doc.ID)
		log.Printf("[hub] evicted empty doc %s\n", doc.ID)
	}
}

// Register adds a client to its document and loads seed state if this is the
// first connection to this document.
func (h *Hub) Register(c *client.Client) {
	doc := h.GetOrCreate(c.DocID)

	// Load seed state exactly once per document lifetime.
	// Subsequent clients receive state from their peers via normal Yjs sync.
	//seedState := doc.seeder.Load()

	doc.mu.Lock()
	doc.clients[c] = true
	n := len(doc.clients)
	doc.mu.Unlock()

	log.Printf("[%s] %s (%s) connected — %d clients\n", c.DocID, c.UserID, c.Role, n)

	// Send seed state to the new client as a sync step 2.
	// This brings them to the last persisted version before peer sync kicks in.
	/*
	if len(seedState) > 0 {
		select {
		case c.Send <- yjs.WrapSyncStep2(seedState):
		default:
			log.Printf("[%s] seed send to %s dropped (buffer full)\n", c.DocID, c.UserID)
		}
	}
	*/
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
	close(c.Send)
	doc.mu.Unlock()

	log.Printf("[%s] %s disconnected (%d remaining)\n", c.DocID, c.UserID, remaining)

	if remaining == 0 {
		// Last client left — fire a final save immediately rather than waiting
		// for the debounce timer, so no in-flight edits are lost.
		doc.coordinator.FireNow(doc.eligibleSavers())
	}

	h.removeIfEmpty(doc)
}

// HandleMessage is the central dispatch called by client.ReadPump.
func (h *Hub) HandleMessage(c *client.Client, msg []byte) {
	doc := h.GetOrCreate(c.DocID)

	m, ok := yjs.Parse(msg)
	if !ok {
		return
	}

	switch m.Outer {
	case yjs.MsgAwareness:
		// Awareness (cursors/presence) — broadcast to all peers including viewers.
		Broadcast(doc, c, msg)

	case yjs.MsgSync:
		switch m.Inner {
		case yjs.SyncStep1:
			// New client requesting state. Broadcast to trigger peers to respond
			// with their current state, catching up any edits since last flush.
			Broadcast(doc, c, msg)

		case yjs.SyncStep2, yjs.SyncUpdate:
			// Document update — viewers cannot push these.
			if !c.CanWrite() {
				log.Printf("[%s] blocked update from viewer %s\n", c.DocID, c.UserID)
				return
			}
			Broadcast(doc, c, msg)

			// Schedule a debounced save. coordinator picks the best available
			// eligible client after the debounce window expires.
			doc.coordinator.Schedule(doc.eligibleSavers)
		}
	}
}

// eligibleSavers returns the current set of clients that can be nominated to save.
// Called lazily by the coordinator so it always gets the live client list.
func (doc *Document) eligibleSavers() []*client.Client {
	doc.mu.RLock()
	defer doc.mu.RUnlock()

	var out []*client.Client
	for c := range doc.clients {
		if c.CanWrite() {
			out = append(out, c)
		}
	}
	return out
}