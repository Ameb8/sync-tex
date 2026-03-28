package persist

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"sync"
)

type presignedResponse struct {
	URL string `json:"url"`
}

type Seeder struct {
	docID          string
	serviceURL     string
	internalSecret string
	httpClient     *http.Client

	once  sync.Once
	state []byte
}

func NewSeeder(docID, serviceURL, internalSecret string) *Seeder {
	return &Seeder{
		docID:          docID,
		serviceURL:     serviceURL,
		internalSecret: internalSecret,
		httpClient:     &http.Client{},
	}
}

// Load fetches the document state on first call, caches result.
// Returns nil for new files.
// The state bytes are whatever is in the file store — either plain UTF-8
// text (never been collaborative) or binary Yjs state (previously collab).
// The distinction is handled by the frontend on first connect.
func (s *Seeder) Load() []byte {
	s.once.Do(func() {
		// Get presigned download URL from projects-service
		url := fmt.Sprintf("%s/file/%s/download", s.serviceURL, s.docID)
		req, err := http.NewRequest(http.MethodGet, url, nil)
		if err != nil {
			log.Printf("[%s] seed request build error: %v\n", s.docID, err)
			return
		}
		req.Header.Set("X-Internal-Secret", s.internalSecret)

		resp, err := s.httpClient.Do(req)
		if err != nil {
			log.Printf("[%s] seed fetch error: %v\n", s.docID, err)
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode == http.StatusNotFound {
			log.Printf("[%s] no persisted state (new file)\n", s.docID)
			return
		}
		if resp.StatusCode != http.StatusOK {
			log.Printf("[%s] presigned URL fetch returned %d\n", s.docID, resp.StatusCode)
			return
		}

		var presigned presignedResponse
		if err := json.NewDecoder(resp.Body).Decode(&presigned); err != nil {
			log.Printf("[%s] presigned URL decode error: %v\n", s.docID, err)
			return
		}

		// Download raw bytes from file store
		dlResp, err := s.httpClient.Get(presigned.URL)
		if err != nil {
			log.Printf("[%s] file store download error: %v\n", s.docID, err)
			return
		}
		defer dlResp.Body.Close()

		if dlResp.StatusCode != http.StatusOK {
			log.Printf("[%s] file store returned %d\n", s.docID, dlResp.StatusCode)
			return
		}

		state, err := io.ReadAll(dlResp.Body)
		if err != nil {
			log.Printf("[%s] seed read error: %v\n", s.docID, err)
			return
		}
		s.state = state
		log.Printf("[%s] seeded %d bytes\n", s.docID, len(state))
	})
	return s.state
}
