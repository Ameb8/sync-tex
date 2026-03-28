package auth

import (
	"net/http"
	"strings"
)

// ExtractToken pulls the JWT from the request.
// y-websocket cannot set request headers, so the token travels as ?token=.
// We also accept the Authorization header for any future clients that can set it.
// Always use wss:// in production so the token isn't exposed in plaintext.
func ExtractToken(r *http.Request) string {
	if h := r.Header.Get("Authorization"); h != "" {
		return strings.TrimPrefix(h, "Bearer ")
	}
	return r.URL.Query().Get("token")
}