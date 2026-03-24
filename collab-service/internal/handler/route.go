package handler

import "net/http"

// Register wires all HTTP routes onto mux.
func Register(mux *http.ServeMux, ws *WSHandler) {
	// y-websocket connects to /ws/<docId>
	mux.Handle("/ws/", ws)

	// Health check for load balancer / Docker health check
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
}