package client

import (
	"time"

	"github.com/gorilla/websocket"
)

// Client represents one connected WebSocket peer.
type Client struct {
	// DocID is the document this client is editing.
	DocID string

	// Conn is the underlying WebSocket connection.
	Conn *websocket.Conn

	// Send is the outbound message queue. writePump drains it.
	// Closed by unregister() to signal writePump to exit.
	Send chan []byte

	// UserID and Role come from projects-service at connect time.
	UserID string
	Role   string // "owner" | "editor" | "viewer"

	JoinedAt time.Time

	// SaveACK is signaled by readPump when the client sends back a save ACK.
	// The save coordinator in save/signal.go reads from this channel to confirm
	// the client successfully persisted the document.
	// Buffered(1) so the sender never blocks if no one is listening yet.
	SaveACK chan struct{}
}

func New(docID, userID, role string, conn *websocket.Conn) *Client {
	return &Client{
		DocID:    docID,
		Conn:     conn,
		Send:     make(chan []byte, 512),
		UserID:   userID,
		Role:     role,
		JoinedAt: time.Now(),
		SaveACK:  make(chan struct{}, 1),
	}
}

// CanWrite returns true if this client is allowed to push document updates.
func (c *Client) CanWrite() bool {
	return c.Role == "owner" || c.Role == "editor"
}

// RolePriority returns a numeric priority for saver nomination.
// Higher = more preferred. Owners are preferred over editors.
func (c *Client) RolePriority() int {
	switch c.Role {
	case "owner":
		return 2
	case "editor":
		return 1
	default:
		return 0
	}
}