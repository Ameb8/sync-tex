package persist

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
)

// Uploader fetches a presigned upload URL and PUTs state bytes to the file store.
type Uploader struct {
	docID          string
	serviceURL     string
	internalSecret string
	httpClient     *http.Client
}

func NewUploader(docID, serviceURL, internalSecret string) *Uploader {
	return &Uploader{
		docID:          docID,
		serviceURL:     serviceURL,
		internalSecret: internalSecret,
		httpClient:     &http.Client{},
	}
}

// Upload fetches a fresh presigned URL and PUTs data to the file store.
// Returns nil on success.
func (u *Uploader) Upload(data []byte) error {
	// Get presigned upload URL
	log.Println("File Save Triggered...")
	url := fmt.Sprintf("%s/file/%s/upload", u.serviceURL, u.docID)
	log.Printf("Fetching Presigned Upload URL From:\t%s", url)

	// Construct http request
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("build upload URL request: %w", err)
	}
	req.Header.Set("X-Internal-Secret", u.internalSecret)

	resp, err := u.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("fetch presigned upload URL: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("presigned URL fetch returned %d: %s", resp.StatusCode, body)
	}

	var presigned presignedResponse
	if err := json.NewDecoder(resp.Body).Decode(&presigned); err != nil {
		return fmt.Errorf("decode presigned URL: %w", err)
	}

	// PUT to file store
	log.Printf("Uploading File To:\t%s", presigned.URL)
	putReq, err := http.NewRequest(http.MethodPut, presigned.URL, bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("build PUT request: %w", err)
	}
	putReq.Header.Set("Content-Type", "application/octet-stream")
	putReq.ContentLength = int64(len(data))

	putResp, err := u.httpClient.Do(putReq)
	if err != nil {
		return fmt.Errorf("PUT to file store: %w", err)
	}
	defer putResp.Body.Close()

	if putResp.StatusCode < 200 || putResp.StatusCode >= 300 {
		body, _ := io.ReadAll(putResp.Body)
		return fmt.Errorf("file store PUT returned %d: %s", putResp.StatusCode, body)
	}

	log.Printf("[%s] uploaded %d bytes to file store\n", u.docID, len(data))
	return nil
}
