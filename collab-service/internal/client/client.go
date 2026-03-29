package client

import (
	"time"

	"github.com/gorilla/websocket"
)

type Client struct {
	DocID    string
	Conn     *websocket.Conn
	Send     chan []byte
	UserID   string
	Role     string
	JoinedAt time.Time
}

func New(docID, userID, role string, conn *websocket.Conn) *Client {
	return &Client{
		DocID:    docID,
		Conn:     conn,
		Send:     make(chan []byte, 512),
		UserID:   userID,
		Role:     role,
		JoinedAt: time.Now(),
	}
}

func (c *Client) CanWrite() bool {
	return c.Role == "owner" || c.Role == "editor"
}
