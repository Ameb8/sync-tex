package handlers

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgtype"

	db "projects-service/db/sqlc"
	"projects-service/internal/download"
)

const downloadProjectID = "7f202d80-2240-48c0-af41-ad8ba00143a1"
const downloadFileID = "a838a51a-c528-450b-80fe-134aa3759493"

type downloadTestReader struct {
	io.Reader
	closed bool
}

func (r *downloadTestReader) Close() error { r.closed = true; return nil }

type cancelingDownloadReader struct {
	chunks [][]byte
	cancel context.CancelFunc
	reads  int
}

func (r *cancelingDownloadReader) Read(p []byte) (int, error) {
	if r.reads >= len(r.chunks) {
		return 0, io.EOF
	}
	chunk := r.chunks[r.reads]
	r.reads++
	copy(p, chunk)
	if r.reads == 1 {
		r.cancel()
	}
	return len(chunk), nil
}

func (r *cancelingDownloadReader) Close() error { return nil }

type failingDownloadReader struct{ err error }

func (r failingDownloadReader) Read([]byte) (int, error) { return 0, r.err }
func (r failingDownloadReader) Close() error             { return nil }

func downloadTestHandler(t *testing.T, file db.File, resolved download.Resolved, resolveErr error) *Handler {
	t.Helper()
	return &Handler{
		downloadCanRead: func(context.Context, pgtype.UUID, string) (bool, error) { return true, nil },
		downloadGetFile: func(context.Context, pgtype.UUID) (db.File, error) { return file, nil },
		downloadResolve: func(context.Context, db.File) (download.Resolved, error) { return resolved, resolveErr },
	}
}

func downloadTestFile(t *testing.T, filename string) db.File {
	t.Helper()
	projectID, err := stringToPgUUID(downloadProjectID)
	if err != nil {
		t.Fatal(err)
	}
	fileID, err := stringToPgUUID(downloadFileID)
	if err != nil {
		t.Fatal(err)
	}
	return db.File{ID: fileID, ProjectID: projectID, Filename: filename, StorageKey: "not-exposed", FileType: db.FileTypeImage}
}

func downloadRequest(t *testing.T, h *Handler, userID, projectID, fileID string, ctx context.Context) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		if userID != "" {
			c.Set("user_id", userID)
		}
		c.Next()
	})
	router.GET("/projects/v1/projects/:projectID/files/:fileID/download", h.DownloadFile)
	req := httptest.NewRequest(http.MethodGet, "/projects/v1/projects/"+projectID+"/files/"+fileID+"/download", nil).WithContext(ctx)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, req)
	return response
}

func TestDownloadFileStreamsRawBytesWithAttachmentHeaders(t *testing.T) {
	file := downloadTestFile(t, "diagram.png")
	payload := []byte{0, 255, 4, 9}
	reader := &downloadTestReader{Reader: bytes.NewReader(payload)}
	h := downloadTestHandler(t, file, download.Resolved{Reader: reader, Filename: file.Filename, ContentType: "image/png"}, nil)
	response := downloadRequest(t, h, "owner", downloadProjectID, downloadFileID, context.Background())
	if response.Code != http.StatusOK || !bytes.Equal(response.Body.Bytes(), payload) {
		t.Fatalf("status/body: %d %v", response.Code, response.Body.Bytes())
	}
	if got := response.Header().Get("Content-Type"); got != "image/png" {
		t.Fatal(got)
	}
	if got := response.Header().Get("Content-Disposition"); got != `attachment; filename="diagram.png"; filename*=UTF-8''diagram.png` {
		t.Fatal(got)
	}
	if got := response.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Fatal(got)
	}
	if !reader.closed {
		t.Fatal("reader was not closed")
	}
}

func TestDownloadFileStreamsMaterializedCollaborativeText(t *testing.T) {
	file := downloadTestFile(t, "main.tex")
	reader := &downloadTestReader{Reader: strings.NewReader("\\section{Current text}\n")}
	h := downloadTestHandler(t, file, download.Resolved{Reader: reader, Filename: file.Filename, ContentType: "text/plain; charset=utf-8"}, nil)
	response := downloadRequest(t, h, "viewer", downloadProjectID, downloadFileID, context.Background())
	if response.Code != http.StatusOK || response.Body.String() != "\\section{Current text}\n" {
		t.Fatalf("status/body: %d %q", response.Code, response.Body.String())
	}
	if got := response.Header().Get("Content-Type"); got != "text/plain; charset=utf-8" {
		t.Fatal(got)
	}
}

func TestDownloadFileValidatesAuthenticationAndIdentifiers(t *testing.T) {
	h := downloadTestHandler(t, db.File{}, download.Resolved{}, nil)
	if got := downloadRequest(t, h, "", downloadProjectID, downloadFileID, context.Background()).Code; got != http.StatusUnauthorized {
		t.Fatal(got)
	}
	if got := downloadRequest(t, h, "user", "bad", downloadFileID, context.Background()).Code; got != http.StatusBadRequest {
		t.Fatal(got)
	}
	if got := downloadRequest(t, h, "user", downloadProjectID, "bad", context.Background()).Code; got != http.StatusBadRequest {
		t.Fatal(got)
	}
}

func TestDownloadFileAllowsEachReadRoleAndDeniesOthers(t *testing.T) {
	allowedRoles := map[string]bool{"owner": true, "editor": true, "viewer": true}
	for _, userID := range []string{"owner", "editor", "viewer"} {
		t.Run(userID, func(t *testing.T) {
			file := downloadTestFile(t, "x.pdf")
			h := downloadTestHandler(t, file, download.Resolved{Reader: io.NopCloser(strings.NewReader("x")), Filename: "x.pdf", ContentType: "application/pdf"}, nil)
			h.downloadCanRead = func(_ context.Context, _ pgtype.UUID, gotUserID string) (bool, error) {
				return allowedRoles[gotUserID], nil
			}
			if got := downloadRequest(t, h, userID, downloadProjectID, downloadFileID, context.Background()).Code; got != http.StatusOK {
				t.Fatal(got)
			}
		})
	}
	file := downloadTestFile(t, "x.pdf")
	h := downloadTestHandler(t, file, download.Resolved{}, nil)
	h.downloadCanRead = func(_ context.Context, _ pgtype.UUID, gotUserID string) (bool, error) {
		return allowedRoles[gotUserID], nil
	}
	if got := downloadRequest(t, h, "outsider", downloadProjectID, downloadFileID, context.Background()).Code; got != http.StatusForbidden {
		t.Fatal(got)
	}
}

func TestDownloadFileHidesCrossProjectFile(t *testing.T) {
	file := downloadTestFile(t, "secret.pdf")
	other, _ := stringToPgUUID("33333333-3333-4333-8333-333333333333")
	file.ProjectID = other
	called := false
	h := downloadTestHandler(t, file, download.Resolved{}, nil)
	h.downloadResolve = func(context.Context, db.File) (download.Resolved, error) {
		called = true
		return download.Resolved{}, nil
	}
	if got := downloadRequest(t, h, "owner", downloadProjectID, downloadFileID, context.Background()).Code; got != http.StatusNotFound || called {
		t.Fatalf("status=%d resolved=%v", got, called)
	}
}

func TestDownloadFileMapsAbsentMetadataToNotFound(t *testing.T) {
	file := downloadTestFile(t, "missing.pdf")
	h := downloadTestHandler(t, file, download.Resolved{}, nil)
	h.downloadGetFile = func(context.Context, pgtype.UUID) (db.File, error) {
		return db.File{}, io.EOF
	}
	called := false
	h.downloadResolve = func(context.Context, db.File) (download.Resolved, error) {
		called = true
		return download.Resolved{}, nil
	}

	response := downloadRequest(t, h, "owner", downloadProjectID, downloadFileID, context.Background())
	if response.Code != http.StatusNotFound || called {
		t.Fatalf("status=%d resolved=%v", response.Code, called)
	}
}

func TestDownloadFileUsesSafeUnicodeAttachmentFilename(t *testing.T) {
	file := downloadTestFile(t, "résumé \"final\".tex\r\nInjected: x")
	h := downloadTestHandler(t, file, download.Resolved{Reader: io.NopCloser(strings.NewReader("x")), Filename: file.Filename, ContentType: "bad\r\nheader"}, nil)
	response := downloadRequest(t, h, "owner", downloadProjectID, downloadFileID, context.Background())
	if got := response.Header().Get("Content-Type"); got != "application/octet-stream" {
		t.Fatal(got)
	}
	disposition := response.Header().Get("Content-Disposition")
	if strings.ContainsAny(disposition, "\r\n") || !strings.Contains(disposition, "filename*=UTF-8''r%C3%A9sum%C3%A9%20%22final%22.texInjected%3A%20x") {
		t.Fatal(disposition)
	}
	if !strings.Contains(disposition, `filename="r_sum_ _final_.texInjected_ x"`) {
		t.Fatal(disposition)
	}
}

func TestDownloadFileMapsResolutionFailuresAndCancellation(t *testing.T) {
	file := downloadTestFile(t, "main.tex")
	for _, tt := range []struct {
		err    error
		status int
	}{
		{download.ErrMissingObject, http.StatusNotFound},
		{download.ErrMaterialization, http.StatusBadGateway},
		{download.ErrStorage, http.StatusBadGateway},
	} {
		h := downloadTestHandler(t, file, download.Resolved{}, tt.err)
		if got := downloadRequest(t, h, "owner", downloadProjectID, downloadFileID, context.Background()).Code; got != tt.status {
			t.Fatalf("%v: %d", tt.err, got)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	called := false
	h := downloadTestHandler(t, file, download.Resolved{}, nil)
	h.downloadResolve = func(ctx context.Context, _ db.File) (download.Resolved, error) {
		called = true
		return download.Resolved{}, ctx.Err()
	}
	response := downloadRequest(t, h, "owner", downloadProjectID, downloadFileID, ctx)
	if !called || response.Body.Len() != 0 {
		t.Fatalf("called=%v body=%q", called, response.Body.String())
	}
}

func TestDownloadFileMapsLazyStorageFailureBeforeCommittingAttachment(t *testing.T) {
	file := downloadTestFile(t, "missing.pdf")
	h := downloadTestHandler(t, file, download.Resolved{
		Reader:      failingDownloadReader{err: download.ErrMissingObject},
		Filename:    file.Filename,
		ContentType: "application/pdf",
	}, nil)
	response := downloadRequest(t, h, "owner", downloadProjectID, downloadFileID, context.Background())
	if response.Code != http.StatusNotFound || response.Body.String() != `{"error":"File content not found"}` {
		t.Fatalf("status/body: %d %q", response.Code, response.Body.String())
	}
	if response.Header().Get("Content-Disposition") != "" || response.Header().Get("Cache-Control") != "" {
		t.Fatalf("attachment headers committed on error: %#v", response.Header())
	}
}

func TestDownloadFileStopsCopyingWhenRequestIsCancelledDuringStream(t *testing.T) {
	file := downloadTestFile(t, "large.pdf")
	ctx, cancel := context.WithCancel(context.Background())
	reader := &cancelingDownloadReader{chunks: [][]byte{[]byte("first"), []byte("second")}, cancel: cancel}
	h := downloadTestHandler(t, file, download.Resolved{Reader: reader, Filename: file.Filename, ContentType: "application/pdf"}, nil)

	response := downloadRequest(t, h, "owner", downloadProjectID, downloadFileID, ctx)
	if reader.reads != 1 {
		t.Fatalf("read %d chunks after cancellation", reader.reads)
	}
	if response.Body.Len() != 0 {
		t.Fatalf("wrote bytes after cancellation: %q", response.Body.String())
	}
}

func TestDownloadFileRejectsResolverSuccessWithoutAStream(t *testing.T) {
	file := downloadTestFile(t, "missing.pdf")
	h := downloadTestHandler(t, file, download.Resolved{Filename: file.Filename}, nil)
	response := downloadRequest(t, h, "owner", downloadProjectID, downloadFileID, context.Background())
	if response.Code != http.StatusBadGateway || response.Body.String() != `{"error":"File content is temporarily unavailable"}` {
		t.Fatalf("status/body: %d %q", response.Code, response.Body.String())
	}
}

func TestAttachmentDispositionFallback(t *testing.T) {
	if got := attachmentDisposition("\r\n"); got != `attachment; filename="download"; filename*=UTF-8''download` {
		t.Fatal(got)
	}
	if got := rfc5987Encode("a b/é"); got != "a%20b%2F%C3%A9" {
		t.Fatal(got)
	}
	if got := asciiFilename(`nested/path\name.txt`); got != "nested_path_name.txt" {
		t.Fatal(got)
	}
}
