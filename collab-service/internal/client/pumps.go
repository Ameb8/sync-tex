package client

import (
	"log"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait  = 10 * time.Second
	pongWait   = 60 * time.Second
	pingPeriod = 30 * time.Second
)

// MessageHandler is called by readPump for every valid inbound message.
// The hub implements this to handle routing and persistence.
type MessageHandler interface {
	HandleMessage(c *Client, msg []byte)
	Unregister(c *Client)
}

// ReadPump reads from the WebSocket and dispatches to handler.
// Runs in its own goroutine; cleans up via handler.Unregister on exit.
func (c *Client) ReadPump(handler MessageHandler) {
	defer func() {
		handler.Unregister(c)
		c.Conn.Close()
	}()

	c.Conn.SetReadDeadline(time.Now().Add(pongWait))
	c.Conn.SetPongHandler(func(string) error {
		c.Conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		mt, msg, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err,
				websocket.CloseGoingAway,
				websocket.CloseAbnormalClosure) {
				log.Printf("[%s] unexpected close from %s: %v\n", c.DocID, c.UserID, err)
			}
			return
		}
		if mt != websocket.BinaryMessage || len(msg) == 0 {
			continue
		}
		handler.HandleMessage(c, msg)
	}
}

// WritePump drains the Send channel to the WebSocket.
// Runs in its own goroutine; exits when Send is closed.
func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case msg, ok := <-c.Send:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.Conn.WriteMessage(websocket.BinaryMessage, msg); err != nil {
				log.Printf("[%s] write error for %s: %v\n", c.DocID, c.UserID, err)
				return
			}

		case <-ticker.C:
			c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
