package users

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"time"
)

type User struct {
	ID         string `json:"id"`
	Email      string `json:"email"`
	Name       string `json:"name"`
	ProfilePic string `json:"profile_pic"`
}

type Client struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

func NewClient() *Client {
	return &Client{
		baseURL: os.Getenv("USERS_INTERNAL_API_URL"),
		apiKey:  os.Getenv("USERS_INTERNAL_API_KEY"),
		http:    &http.Client{Timeout: 5 * time.Second},
	}
}

// GetUsers fetches user data for a slice of user IDs.
// Returns a map of userID -> User for easy lookup.
func (c *Client) GetUsers(ctx context.Context, userIDs []string) (map[string]User, error) {
	// No users requested
	if len(userIDs) == 0 {
		return map[string]User{}, nil
	}

	// Build query params: ?user_ids=1&user_ids=2&...
	params := url.Values{}
	for _, id := range userIDs {
		params.Add("user_ids", id)
	}

	// Prepare http request
	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		fmt.Sprintf("%s/auth/internal/users?%s", c.baseURL, params.Encode()),
		nil,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to build users request: %w", err)
	}

	// Set API key
	req.Header.Set("X-Internal-Api-Key", c.apiKey)
	log.Printf("users-service request: GET %s/auth/internal/users?%s", c.baseURL, params.Encode())

	// Make http request
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("users-service request failed: %w", err)
	}
	defer resp.Body.Close()

	log.Printf("users-service status: %d %s", resp.StatusCode, resp.Status)

	// Check status code
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("users-service returned status %d", resp.StatusCode)
	}

	// Read full response data
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read users response: %w", err)
	}

	// Log raw json
	log.Printf("users-service response: %s", string(bodyBytes))

	// Unmarshel into user objects
	var users []User
	if err := json.Unmarshal(bodyBytes, &users); err != nil {
		return nil, fmt.Errorf("failed to decode users response: %w", err)
	}

	// Index by ID for O(1) lookup when enriching collaborators
	result := make(map[string]User, len(users))
	for _, u := range users {
		result[u.ID] = u
	}
	return result, nil
}