package handler

import (
	"log"
	"net/http"
	"strings"

	"github.com/gorilla/websocket"
	"github.com/ameb8/sync-tex/collab-service/internal/auth"
	"github.com/ameb8/sync-tex/collab-service/internal/client"
	"github.com/ameb8/sync-tex/collab-service/internal/hub"
)

var upgrader = websocket.Upgrader{
	CheckOrigin:     func(r *http.Request) bool { return true }, // restrict in prod
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
}

// WSHandler handles WebSocket upgrade requests.
type WSHandler struct {
	hub     *hub.Hub
	checker *auth.Checker
}

func NewWSHandler(h *hub.Hub, checker *auth.Checker) *WSHandler {
	return &WSHandler{hub: h, checker: checker}
}

// ServeHTTP handles GET /ws/<docId>?projectId=<pid>&token=<jwt>
//
// Auth happens here, before the upgrade. A rejected request gets a plain
// HTTP error response — once the connection is upgraded to WebSocket, there
// is no way to send an HTTP status code back to the client.
func (wsh *WSHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	docID := strings.TrimPrefix(r.URL.Path, "/ws/")
	if docID == "" {
		http.Error(w, "missing doc ID", http.StatusBadRequest)
		return
	}

	projectID := r.URL.Query().Get("projectId")
	if projectID == "" {
		http.Error(w, "missing projectId", http.StatusBadRequest)
		return
	}

	token := auth.ExtractToken(r)
	if token == "" {
		http.Error(w, "missing auth token", http.StatusUnauthorized)
		return
	}

	access, err := wsh.checker.CheckAccess(token, docID, projectID)
	if err != nil {
		log.Printf("[auth] service error for doc %s: %v\n", docID, err)
		http.Error(w, "auth service unavailable", http.StatusServiceUnavailable)
		return
	}
	if !access.Allowed {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[ws] upgrade error: %v\n", err)
		return
	}

	c := client.New(docID, access.UserID, access.Role, conn)

	// Register adds the client to the doc and sends it the seed state.
	wsh.hub.Register(c)

	// Pumps run in separate goroutines for each connection.
	// ReadPump calls hub.HandleMessage for inbound messages and
	// hub.Unregister when the connection closes.
	go c.WritePump()
	go c.ReadPump(wsh.hub)
}