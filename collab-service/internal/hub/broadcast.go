package hub

import (
	"log"

	"github.com/ameb8/sync-tex/collab-service/internal/client"
)

// Broadcast sends msg to every client in doc except the sender.
// Non-blocking: if a peer's send buffer is full the message is dropped
// and logged. A full buffer usually means a dead or very slow connection.
func Broadcast(doc *Document, sender *client.Client, msg []byte) {
	doc.mu.RLock()
	defer doc.mu.RUnlock()

	for peer := range doc.clients {
		if peer == sender {
			continue
		}
		select {
		case peer.Send <- msg:
		default:
			log.Printf("[%s] dropped msg for slow peer %s\n", doc.ID, peer.UserID)
		}
	}
}