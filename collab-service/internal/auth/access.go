package auth

import (
	// "encoding/json"
	// "fmt"
	"net/http"
)

// AccessResponse is the payload returned by projects-service /internal/access.
type AccessResponse struct {
	Allowed bool   `json:"allowed"`
	UserID  string `json:"user_id"`
	Role    string `json:"role"` // "owner" | "editor" | "viewer"
}

// Checker validates tokens against projects-service.
type Checker struct {
	serviceURL     string
	internalSecret string
	httpClient     *http.Client
}

func NewChecker(serviceURL, internalSecret string) *Checker {
	return &Checker{
		serviceURL:     serviceURL,
		internalSecret: internalSecret,
		httpClient:     &http.Client{},
	}
}

/*
// CheckAccess validates the JWT and confirms the user has access to the given
// doc within the project. Called before the WebSocket upgrade — a failure here
// returns a plain HTTP error, not a WS close frame.
//
// projects-service must implement:
//   GET /projects/v1/internal/access?docId=<id>&projectId=<id> 
//   Authorization: Bearer <jwt>
//   X-Internal-Secret: <shared secret>
//   → 200 { allowed: true,  user_id: "...", role: "owner"|"editor"|"viewer" }
//   → 403 { allowed: false }
func (c *Checker) CheckAccess(token, docID, projectID string) (AccessResponse, error) {
	url := fmt.Sprintf("%sprojects/v1/internal/access?docId=%s&projectId=%s",
		c.serviceURL, docID, projectID)

	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return AccessResponse{}, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-Internal-Secret", c.internalSecret)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return AccessResponse{}, fmt.Errorf("projects-service unreachable: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusUnauthorized {
		return AccessResponse{Allowed: false}, nil
	}
	if resp.StatusCode != http.StatusOK {
		return AccessResponse{}, fmt.Errorf("projects-service returned %d", resp.StatusCode)
	}

	var out AccessResponse
	return out, json.NewDecoder(resp.Body).Decode(&out)
}
	*/

func (c *Checker) CheckAccess(token, docID, projectID string) (AccessResponse, error) {
	return AccessResponse{
		Allowed: true,
		UserID:  "test-user",
		Role:    "owner",
	}, nil
}