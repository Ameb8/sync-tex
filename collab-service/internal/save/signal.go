package save

import (
	"log"
	"sort"
	"time"

	"github.com/ameb8/sync-tex/collab-service/internal/client"
	"github.com/ameb8/sync-tex/collab-service/internal/yjs"
)

// Coordinator manages the full save lifecycle for one document:
//
//   1. Schedule() is called on every document update. It resets a debounce
//      timer so rapid edits don't cause constant saves.
//
//   2. After the debounce window expires (default 5s), the coordinator calls
//      the savers provider to get the current eligible client list, picks the
//      most privileged one, and sends it a save signal [0xFF, "save"].
//
//   3. The nominated client POSTs the current document content to projects-service
//      REST endpoint (with its own JWT, so auth is double-checked there), then
//      sends back an ACK [0xFF, "ack"] over the WebSocket.
//
//   4. The coordinator waits up to SaveACKTimeout for the ACK. If it doesn't
//      arrive (client disconnected, slow network, save failed), it picks the next
//      eligible client and retries up to SaveMaxRetries times.
//
//   5. FireNow() bypasses the timer for the last-client-disconnecting case.
//
// This pattern means:
//   - Only one client saves at a time (no races between collaborators)
//   - The relay never touches file content (no Yjs decoding needed in Go)
//   - A disconnecting client can't cause data loss — the relay retries on another
//   - projects-service still validates the JWT on the REST save endpoint

type Coordinator struct {
	docID      string
	ackTimeout time.Duration
	maxRetries int

	// timer is the debounce timer. Reset on every document update.
	timer *debounceTimer

	// saverProvider returns the current live list of eligible savers.
	// Called lazily so it reflects the client list at the moment of firing,
	// not when the timer was scheduled.
	saverProvider func() []*client.Client
}

func NewCoordinator(docID string, debounceDelay, ackTimeout time.Duration, maxRetries int) *Coordinator {
	return &Coordinator{
		docID:      docID,
		ackTimeout: ackTimeout,
		maxRetries: maxRetries,
	}
}

// Schedule resets the debounce timer. The saversProvider is stored so that
// when the timer fires it uses the live client list, not a stale snapshot.
func (c *Coordinator) Schedule(saversProvider func() []*client.Client) {
	c.saverProvider = saversProvider
	if c.timer == nil {
		// Timer is created on first Schedule call to avoid needing the debounce
		// delay at construction time. Coordinator is created before any clients
		// connect, so delaying timer creation is fine.
		c.timer = newDebounceTimer(func() {
			if c.saverProvider != nil {
				c.signalWithRetry(c.saverProvider())
			}
		})
	}
	c.timer.reset()
}

// FireNow cancels any pending debounce and immediately signals eligible clients.
// Called when the last client disconnects so final edits aren't lost.
func (c *Coordinator) FireNow(savers []*client.Client) {
	if c.timer != nil {
		c.timer.stop()
	}
	if len(savers) > 0 {
		go c.signalWithRetry(savers)
	}
}

// Stop cancels the debounce timer without triggering a save.
// Called when a document is evicted from the hub.
func (c *Coordinator) Stop() {
	if c.timer != nil {
		c.timer.stop()
	}
}

// signalWithRetry attempts to nominate a saver from the candidates list.
// On failure (no ACK within timeout) it removes the nominee and tries the next.
// Candidates are sorted by role priority so owners are always tried first.
func (c *Coordinator) signalWithRetry(candidates []*client.Client) {
	if len(candidates) == 0 {
		log.Printf("[%s] no eligible savers — save skipped\n", c.docID)
		return
	}

	// Sort by role priority descending (owner=2, editor=1).
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].RolePriority() > candidates[j].RolePriority()
	})

	for attempt := 0; attempt < c.maxRetries && attempt < len(candidates); attempt++ {
		nominee := candidates[attempt]

		// Drain any stale ACK sitting in the buffer from a previous round.
		select {
		case <-nominee.SaveACK:
		default:
		}

		// Send the save signal.
		select {
		case nominee.Send <- yjs.SaveSignal():
			log.Printf("[%s] save signal → %s (%s) attempt %d\n",
				c.docID, nominee.UserID, nominee.Role, attempt+1)
		default:
			log.Printf("[%s] %s send buffer full, trying next\n", c.docID, nominee.UserID)
			continue
		}

		// Wait for ACK.
		select {
		case <-nominee.SaveACK:
			log.Printf("[%s] save ACK from %s\n", c.docID, nominee.UserID)
			return // success

		case <-time.After(c.ackTimeout):
			log.Printf("[%s] save ACK timeout from %s, retrying\n", c.docID, nominee.UserID)
			// Continue loop — try next candidate.
		}
	}

	log.Printf("[%s] save failed after %d attempts\n", c.docID, c.maxRetries)
}