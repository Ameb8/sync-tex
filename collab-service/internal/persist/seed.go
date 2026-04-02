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
	UploadsURL  string `json:"uploads"`
	SnapshotURL string `json:"snapshot"`
	URL         string `json:"url"`
}

type Seeder struct {
	docID          string
	serviceURL     string
	internalSecret string
	httpClient     *http.Client

	once     sync.Once
	snapshot []byte // raw Yjs snapshot binary (single apply on frontend)
	updates  []byte // length-prefixed update log blob
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
func (s *Seeder) Load() (snapshot []byte, updates []byte) {
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

		// Read response body
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			log.Printf("[%s] read body error: %v\n", s.docID, err)
			return
		}

		// Debug Logs (raw JSON)
		log.Printf("[%s] presigned raw response: %s\n", s.docID, string(body))

		// Initialize presignedResponse instance
		var presigned presignedResponse
		if err := json.Unmarshal(body, &presigned); err != nil {
			log.Printf("[%s] presigned URL decode error: %v\n", s.docID, err)
			return
		}

		log.Printf("[%s] presigned struct: %+v\n", s.docID, presigned)

		// Download snapshot (may be empty for small/new documents)
		if presigned.SnapshotURL != "" {
			snap, err := s.download("snapshot", presigned.SnapshotURL)
			if err != nil {
				log.Printf("[%s] snapshot download error: %v\n", s.docID, err)
				// non-fatal — fall through to updates
			} else {
				s.snapshot = snap
				log.Printf("[%s] snapshot: %d bytes\n", s.docID, len(snap))
			}
		}

		// Download update log
		if presigned.UploadsURL != "" {
			upd, err := s.download("updates", presigned.UploadsURL)
			if err != nil {
				log.Printf("[%s] updates download error: %v\n", s.docID, err)
			} else {
				s.updates = upd
				log.Printf("[%s] updates: %d bytes\n", s.docID, len(upd))
			}
		}
	})
	return s.snapshot, s.updates
}

// download fetches a presigned URL and returns the raw body bytes.
// A 404 is treated as empty (not an error) since the snapshot may not exist yet.
func (s *Seeder) download(label, url string) ([]byte, error) {
	resp, err := s.httpClient.Get(url)
	if err != nil {
		return nil, fmt.Errorf("%s GET: %w", label, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		log.Printf("[%s] %s not found (empty)\n", s.docID, label)
		return nil, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s store returned %d", label, resp.StatusCode)
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("%s read: %w", label, err)
	}
	return data, nil
}
