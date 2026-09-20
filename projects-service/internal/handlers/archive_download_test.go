package handlers

import (
	"archive/zip"
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgtype"

	db "projects-service/db/sqlc"
	"projects-service/internal/archiveplan"
	"projects-service/internal/download"
)

const downloadDirectoryID = "b838a51a-c528-450b-80fe-134aa3759493"
const downloadRootID = "c838a51a-c528-450b-80fe-134aa3759493"

func archiveUUID(t *testing.T, value string) pgtype.UUID {
	t.Helper()
	id, err := stringToPgUUID(value)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func archiveHandler(t *testing.T, resolver func(context.Context, db.File) (download.Resolved, error)) *Handler {
	t.Helper()
	projectID, directoryID, rootID := archiveUUID(t, downloadProjectID), archiveUUID(t, downloadDirectoryID), archiveUUID(t, downloadRootID)
	fileID := archiveUUID(t, downloadFileID)
	return &Handler{
		downloadCanRead: func(context.Context, pgtype.UUID, string) (bool, error) { return true, nil },
		downloadGetProject: func(context.Context, pgtype.UUID) (db.Project, error) {
			return db.Project{ID: projectID, Name: pgtype.Text{String: "My Project", Valid: true}}, nil
		},
		downloadGetDirectory: func(context.Context, pgtype.UUID) (db.Directory, error) {
			return db.Directory{ID: directoryID, ProjectID: projectID, ParentID: rootID, Name: "章"}, nil
		},
		downloadListDirectories: func(context.Context, pgtype.UUID) ([]db.Directory, error) {
			return []db.Directory{{ID: rootID, ProjectID: projectID, Name: "internal root"}, {ID: directoryID, ProjectID: projectID, ParentID: rootID, Name: "章"}}, nil
		},
		downloadListFiles: func(context.Context, pgtype.UUID) ([]db.File, error) {
			return []db.File{{ID: fileID, ProjectID: projectID, DirectoryID: directoryID, Filename: "résumé.tex", StorageKey: "private", FileType: db.FileTypeCollaborativeText}}, nil
		},
		downloadResolve: resolver,
	}
}

func archiveRequest(t *testing.T, h *Handler, path string, ctx context.Context) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(func(c *gin.Context) { c.Set("user_id", "viewer") })
	router.GET("/projects/v1/projects/:projectID/download", h.DownloadProject)
	router.GET("/projects/v1/projects/:projectID/directories/:dirID/download", h.DownloadDirectory)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil).WithContext(ctx))
	return response
}

func TestDownloadDirectoryStreamsPlannedZIP(t *testing.T) {
	h := archiveHandler(t, func(context.Context, db.File) (download.Resolved, error) {
		return download.Resolved{Reader: io.NopCloser(bytes.NewBufferString("latest text")), ContentType: "text/plain", Deflate: true}, nil
	})
	response := archiveRequest(t, h, "/projects/v1/projects/"+downloadProjectID+"/directories/"+downloadDirectoryID+"/download", context.Background())
	if response.Code != http.StatusOK || response.Header().Get("Content-Type") != "application/zip" {
		t.Fatalf("status/type = %d/%q", response.Code, response.Header().Get("Content-Type"))
	}
	if got := response.Header().Get("Content-Disposition"); got != `attachment; filename="_.zip"; filename*=UTF-8''%E7%AB%A0.zip` {
		t.Fatal(got)
	}
	reader, err := zip.NewReader(bytes.NewReader(response.Body.Bytes()), int64(response.Body.Len()))
	if err != nil {
		t.Fatal(err)
	}
	if len(reader.File) != 2 || reader.File[0].Name != "章/" || reader.File[1].Name != "章/résumé.tex" || reader.File[1].Method != zip.Deflate {
		t.Fatalf("entries: %#v", reader.File)
	}
	body, err := reader.File[1].Open()
	if err != nil {
		t.Fatal(err)
	}
	got, _ := io.ReadAll(body)
	body.Close()
	if string(got) != "latest text" {
		t.Fatal(string(got))
	}
}

func TestDownloadProjectOmitsStructuralRootAndStoresCompressedRaw(t *testing.T) {
	h := archiveHandler(t, func(context.Context, db.File) (download.Resolved, error) {
		return download.Resolved{Reader: io.NopCloser(bytes.NewBufferString("pdf")), ContentType: "application/pdf"}, nil
	})
	h.downloadListFiles = func(context.Context, pgtype.UUID) ([]db.File, error) {
		return []db.File{{ID: archiveUUID(t, downloadFileID), ProjectID: archiveUUID(t, downloadProjectID), DirectoryID: archiveUUID(t, downloadRootID), Filename: "paper.pdf", StorageKey: "private", FileType: db.FileTypePdf}}, nil
	}
	response := archiveRequest(t, h, "/projects/v1/projects/"+downloadProjectID+"/download", context.Background())
	reader, err := zip.NewReader(bytes.NewReader(response.Body.Bytes()), int64(response.Body.Len()))
	if err != nil {
		t.Fatal(err)
	}
	if len(reader.File) != 2 || reader.File[0].Name != "paper.pdf" || reader.File[0].Method != zip.Store || reader.File[1].Name != "章/" {
		t.Fatalf("entries: %#v", reader.File)
	}
}

func TestDownloadArchiveValidatesIDsAndReadAccess(t *testing.T) {
	h := archiveHandler(t, func(context.Context, db.File) (download.Resolved, error) { return download.Resolved{}, nil })
	if response := archiveRequest(t, h, "/projects/v1/projects/not-a-uuid/download", context.Background()); response.Code != http.StatusBadRequest {
		t.Fatal(response.Code)
	}
	if response := archiveRequest(t, h, "/projects/v1/projects/"+downloadProjectID+"/directories/not-a-uuid/download", context.Background()); response.Code != http.StatusBadRequest {
		t.Fatal(response.Code)
	}
	h.downloadCanRead = func(context.Context, pgtype.UUID, string) (bool, error) { return false, nil }
	if response := archiveRequest(t, h, "/projects/v1/projects/"+downloadProjectID+"/download", context.Background()); response.Code != http.StatusForbidden {
		t.Fatal(response.Code)
	}
}

func TestDownloadArchiveRejectsPathConflictBeforeZIPHeaders(t *testing.T) {
	h := archiveHandler(t, func(context.Context, db.File) (download.Resolved, error) {
		t.Fatal("resolver called for invalid plan")
		return download.Resolved{}, nil
	})
	h.downloadListFiles = func(context.Context, pgtype.UUID) ([]db.File, error) {
		return []db.File{
			{ID: archiveUUID(t, downloadFileID), ProjectID: archiveUUID(t, downloadProjectID), DirectoryID: archiveUUID(t, downloadRootID), Filename: "same.tex", StorageKey: "one", FileType: db.FileTypeCollaborativeText},
			{ID: archiveUUID(t, "d838a51a-c528-450b-80fe-134aa3759493"), ProjectID: archiveUUID(t, downloadProjectID), DirectoryID: archiveUUID(t, downloadRootID), Filename: "same.tex", StorageKey: "two", FileType: db.FileTypeCollaborativeText},
		}, nil
	}
	response := archiveRequest(t, h, "/projects/v1/projects/"+downloadProjectID+"/download", context.Background())
	if response.Code != http.StatusConflict || response.Header().Get("Content-Type") == "application/zip" {
		t.Fatalf("status/type = %d/%q", response.Code, response.Header().Get("Content-Type"))
	}
}

func TestDownloadArchiveMapsFirstObjectFailureBeforeZIPHeaders(t *testing.T) {
	h := archiveHandler(t, func(context.Context, db.File) (download.Resolved, error) {
		return download.Resolved{}, download.ErrMissingObject
	})
	response := archiveRequest(t, h, "/projects/v1/projects/"+downloadProjectID+"/directories/"+downloadDirectoryID+"/download", context.Background())
	if response.Code != http.StatusNotFound || response.Body.String() != `{"error":"File content not found"}` {
		t.Fatalf("status/body: %d %q", response.Code, response.Body.String())
	}
	if response.Header().Get("Content-Type") == "application/zip" || response.Header().Get("Content-Disposition") != "" {
		t.Fatalf("ZIP headers committed on error: %#v", response.Header())
	}
}

type boundedGeneratedReader struct {
	remaining int64
	maxBuffer int
}

func (r *boundedGeneratedReader) Read(p []byte) (int, error) {
	if len(p) > r.maxBuffer {
		r.maxBuffer = len(p)
	}
	if r.remaining == 0 {
		return 0, io.EOF
	}
	n := len(p)
	if int64(n) > r.remaining {
		n = int(r.remaining)
	}
	for i := range p[:n] {
		p[i] = byte(i)
	}
	r.remaining -= int64(n)
	return n, nil
}

func TestArchiveStreamsLargeGeneratedFileWithFixedCopyBuffer(t *testing.T) {
	projectID, rootID, fileID := downloadProjectID, downloadRootID, downloadFileID
	plan, err := archiveplan.ProjectPlan(projectID, archiveplan.Metadata{
		Directories: []archiveplan.Directory{{ID: rootID, ProjectID: projectID, Name: "root"}},
		Files:       []archiveplan.File{{ID: fileID, ProjectID: projectID, DirectoryID: rootID, Filename: "large.pdf", StorageKey: "large", Classification: download.ClassificationRaw}},
	})
	if err != nil {
		t.Fatal(err)
	}
	reader := &boundedGeneratedReader{remaining: 8 << 20}
	h := archiveHandler(t, func(context.Context, db.File) (download.Resolved, error) {
		return download.Resolved{Reader: io.NopCloser(reader), Filename: "large.pdf", ContentType: "application/pdf"}, nil
	})
	writer := zip.NewWriter(io.Discard)
	if err := h.writeArchive(context.Background(), writer, plan); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if reader.maxBuffer > downloadCopyBufferSize {
		t.Fatalf("archive requested %d bytes at once; copy buffer is %d", reader.maxBuffer, downloadCopyBufferSize)
	}
}

func TestArchiveCancellationDoesNotResolveLaterFiles(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	calls := 0
	h := archiveHandler(t, func(_ context.Context, _ db.File) (download.Resolved, error) {
		calls++
		return download.Resolved{Reader: &cancelingDownloadReader{chunks: [][]byte{[]byte("first")}, cancel: cancel}}, nil
	})
	file2 := archiveUUID(t, "d838a51a-c528-450b-80fe-134aa3759493")
	h.downloadListFiles = func(context.Context, pgtype.UUID) ([]db.File, error) {
		return []db.File{{ID: archiveUUID(t, downloadFileID), ProjectID: archiveUUID(t, downloadProjectID), DirectoryID: archiveUUID(t, downloadDirectoryID), Filename: "one.tex", StorageKey: "one", FileType: db.FileTypeCollaborativeText}, {ID: file2, ProjectID: archiveUUID(t, downloadProjectID), DirectoryID: archiveUUID(t, downloadDirectoryID), Filename: "two.tex", StorageKey: "two", FileType: db.FileTypeCollaborativeText}}, nil
	}
	archiveRequest(t, h, "/projects/v1/projects/"+downloadProjectID+"/directories/"+downloadDirectoryID+"/download", ctx)
	if calls != 1 {
		t.Fatalf("resolved %d files after cancellation", calls)
	}
}

func TestDownloadDirectoryRejectsCrossProjectBeforePlanning(t *testing.T) {
	h := archiveHandler(t, func(context.Context, db.File) (download.Resolved, error) {
		t.Fatal("resolver called")
		return download.Resolved{}, nil
	})
	h.downloadGetDirectory = func(context.Context, pgtype.UUID) (db.Directory, error) {
		return db.Directory{ProjectID: archiveUUID(t, "e838a51a-c528-450b-80fe-134aa3759493")}, nil
	}
	response := archiveRequest(t, h, "/projects/v1/projects/"+downloadProjectID+"/directories/"+downloadDirectoryID+"/download", context.Background())
	if response.Code != http.StatusNotFound {
		t.Fatal(response.Code)
	}
}
