package persist

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"sync"
)

// Seeder fetches the persisted Yjs state for a document from projects-service.
// sync.Once ensures the fetch runs at most once per document lifetime in the relay,
// even if multiple clients connect simultaneously.
type Seeder struct {
	docID          string
	serviceURL     string
	internalSecret string
	httpClient     *http.Client

	once  sync.Once
	state []byte // raw Yjs state bytes, nil if new file or fetch failed
}

func NewSeeder(docID, serviceURL, internalSecret string) *Seeder {
	return &Seeder{
		docID:          docID,
		serviceURL:     serviceURL,
		internalSecret: internalSecret,
		httpClient:     &http.Client{},
	}
}

// Load fetches the Yjs state on first call; subsequent calls return the cached
// result. Returns nil for new files (404 from projects-service is expected).
//
// projects-service endpoint:
//   GET /internal/files/:docId/yjs-state
//   X-Internal-Secret: <secret>
//   → 200  body: raw Y.encodeStateAsUpdate(ydoc) bytes
//   → 404  new file, no state yet
func (s *Seeder) Load() []byte {
	s.once.Do(func() {
		url := fmt.Sprintf("%s/internal/files/%s/yjs-state", s.serviceURL, s.docID)
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
			log.Printf("[%s] no persisted Yjs state (new file)\n", s.docID)
			return
		}
		if resp.StatusCode != http.StatusOK {
			log.Printf("[%s] seed fetch returned %d\n", s.docID, resp.StatusCode)
			return
		}

		state, err := io.ReadAll(resp.Body)
		if err != nil {
			log.Printf("[%s] seed read error: %v\n", s.docID, err)
			return
		}
		s.state = state
		log.Printf("[%s] seeded %d bytes\n", s.docID, len(state))
	})
	return s.state
}