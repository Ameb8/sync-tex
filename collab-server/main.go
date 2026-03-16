package main

import (
	"log"
	"net/http"
	"strings"
	"sync"

	"github.com/gorilla/websocket"
)

// Document tracks clients connected to a specific doc
type Document struct {
	id      string
	mu      sync.RWMutex
	clients map[*Client]bool
}

// Client represents a connected WebSocket client
type Client struct {
	doc  *Document
	conn *websocket.Conn
	send chan []byte
}

// Hub manages all documents
type Hub struct {
	mu        sync.RWMutex
	documents map[string]*Document
}

var hub = &Hub{
	documents: make(map[string]*Document),
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}


// Websocket handler
func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	// Extract doc ID from URL path: /ws/docId
	// y-websocket sends: GET /ws/docId
	docId := strings.TrimPrefix(r.URL.Path, "/ws/")
	if docId == "" || docId == "/ws" {
		http.Error(w, "Missing doc ID in path", http.StatusBadRequest)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v\n", err)
		return
	}

	doc := getOrCreateDocument(docId)

	client := &Client{
		doc:  doc,
		conn: conn,
		send: make(chan []byte, 256),
	}

	doc.mu.Lock()
	doc.clients[client] = true
	clientCount := len(doc.clients)
	doc.mu.Unlock()

	log.Printf("[%s] Client connected. Total: %d\n", docId, clientCount)

	go client.readPump()
	go client.writePump()
}


// Get or create document
func getOrCreateDocument(docId string) *Document {
	hub.mu.Lock()
	defer hub.mu.Unlock()

	if doc, exists := hub.documents[docId]; exists {
		return doc
	}

	doc := &Document{
		id:      docId,
		clients: make(map[*Client]bool),
	}
	hub.documents[docId] = doc
	log.Printf("Created document: %s\n", docId)
	return doc
}


// Receive Yjs updates from clients
func (c *Client) readPump() {
	defer func() {
		c.unregister()
		c.conn.Close()
	}()

	for {
		// Read binary message (Yjs update)
		_, messageBytes, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v\n", err)
			}
			return
		}

		// Forward Yjs upodate to other clients
		log.Printf("[%s] Broadcast %d bytes\n", c.doc.id, len(messageBytes))
		c.broadcast(messageBytes)
	}
}


// Send message to all connected clients
func (c *Client) broadcast(message []byte) {
	c.doc.mu.RLock()
	defer c.doc.mu.RUnlock()

	for client := range c.doc.clients {
		if client == c {
			continue
		}

		select {
		case client.send <- message:
		default:
			log.Printf("Client buffer full, dropping message\n")
		}
	}
}


// Send queued messages to client
func (c *Client) writePump() {
	for messageBytes := range c.send {
		err := c.conn.WriteMessage(websocket.BinaryMessage, messageBytes)
		if err != nil {
			log.Printf("Write error: %v\n", err)
			return
		}
	}
}


// Remove client
func (c *Client) unregister() {
	c.doc.mu.Lock()
	defer c.doc.mu.Unlock()

	if _, ok := c.doc.clients[c]; ok {
		delete(c.doc.clients, c)
		close(c.send)
		log.Printf("[%s] Client disconnected. Total: %d\n", c.doc.id, len(c.doc.clients))
	}
}

// Run server
func main() {
	http.HandleFunc("/ws/", handleWebSocket)

	log.Println("WebSocket relay listening on 0.0.0.0:8080")
	log.Println("Proxied through nginx at collab://localhost/ws?doc=<docId>")
	log.Fatal(http.ListenAndServe("0.0.0.0:8080", nil))
}