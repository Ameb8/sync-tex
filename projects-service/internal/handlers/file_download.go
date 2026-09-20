package handlers

import (
	"context"
	"errors"
	"io"
	"log"
	"mime"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgtype"

	db "projects-service/db/sqlc"
	"projects-service/internal/download"
)

const downloadCopyBufferSize = 32 * 1024

// DownloadFile handles GET /projects/v1/projects/:projectID/files/:fileID/download.
// It is intentionally separate from the internal presigned-URL endpoint: this
// route authorizes the caller and streams the user-facing export itself.
func (h *Handler) DownloadFile(c *gin.Context) {
	userID, err := h.getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	projectID, err := stringToPgUUID(c.Param("projectID"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project ID"})
		return
	}
	fileID, err := stringToPgUUID(c.Param("fileID"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid file ID"})
		return
	}

	canRead, err := h.canReadForDownload(c.Request.Context(), projectID, userID)
	if err != nil || !canRead {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	file, err := h.getFileForDownload(c.Request.Context(), fileID)
	if err != nil || file.ProjectID != projectID {
		// Do not reveal that a file belonging to another project exists.
		c.JSON(http.StatusNotFound, gin.H{"error": "File not found"})
		return
	}

	resolved, err := h.resolveFileDownload(c.Request.Context(), file)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return
		}
		writeDownloadResolutionError(c, err)
		return
	}
	if resolved.Reader == nil {
		// A resolver must always return a stream on success. Treat a violated
		// adapter contract as an upstream failure while JSON can still be sent.
		c.JSON(http.StatusBadGateway, gin.H{"error": "File content is temporarily unavailable"})
		return
	}
	defer resolved.Close()

	// MinIO object reads are lazy. Probe one bounded chunk before committing
	// attachment headers so an unavailable object can still be reported as a
	// useful JSON error. This does not change the streaming memory bound.
	prefix := make([]byte, downloadCopyBufferSize)
	n, readErr := readDownloadPrefix(c.Request.Context(), resolved.Reader, prefix)
	if readErr != nil && !errors.Is(readErr, io.EOF) {
		if errors.Is(readErr, context.Canceled) || errors.Is(readErr, context.DeadlineExceeded) {
			return
		}
		writeDownloadResolutionError(c, readErr)
		return
	}

	// All failures which can still become JSON have happened above. From here
	// the response is deliberately streamed in a fixed-size buffer.
	c.Header("Cache-Control", "private, no-store")
	c.Header("Content-Type", safeDownloadContentType(resolved.ContentType))
	c.Header("Content-Disposition", attachmentDisposition(resolved.Filename))
	c.Status(http.StatusOK)
	if n > 0 {
		if _, err := c.Writer.Write(prefix[:n]); err != nil {
			return
		}
	}
	if readErr != io.EOF {
		if _, err := io.CopyBuffer(c.Writer, contextReader{ctx: c.Request.Context(), reader: resolved.Reader}, make([]byte, downloadCopyBufferSize)); err != nil && !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
			// Headers may already be committed. Keep provider detail out of logs.
			log.Printf("file download stream failed project_id=%s file_id=%s", pgUUIDToString(projectID), pgUUIDToString(fileID))
		}
	}
}

func readDownloadPrefix(ctx context.Context, reader io.Reader, buffer []byte) (int, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	n, err := reader.Read(buffer)
	if contextErr := ctx.Err(); contextErr != nil {
		return 0, contextErr
	}
	if err != nil && !errors.Is(err, io.EOF) {
		return 0, err
	}
	return n, err
}

// contextReader prevents a reader which does not itself observe cancellation
// from being copied again after the client has disconnected. MinIO also gets
// the request context when it opens its stream; this wrapper closes the gap
// between reads without buffering content.
type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r contextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	n, err := r.reader.Read(p)
	if contextErr := r.ctx.Err(); contextErr != nil {
		return 0, contextErr
	}
	return n, err
}

func (h *Handler) canReadForDownload(ctx context.Context, projectID pgtype.UUID, userID string) (bool, error) {
	if h.downloadCanRead != nil {
		return h.downloadCanRead(ctx, projectID, userID)
	}
	return h.authorizer.CanRead(ctx, projectID, userID)
}

func (h *Handler) getFileForDownload(ctx context.Context, fileID pgtype.UUID) (db.File, error) {
	if h.downloadGetFile != nil {
		return h.downloadGetFile(ctx, fileID)
	}
	return h.queries.GetFile(ctx, fileID)
}

func (h *Handler) resolveFileDownload(ctx context.Context, file db.File) (download.Resolved, error) {
	if h.downloadResolve != nil {
		return h.downloadResolve(ctx, file)
	}
	return h.ResolveDownloadContent(ctx, file)
}

func writeDownloadResolutionError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, download.ErrMissingObject):
		c.JSON(http.StatusNotFound, gin.H{"error": "File content not found"})
	case errors.Is(err, download.ErrMaterialization):
		c.JSON(http.StatusBadGateway, gin.H{"error": "File content could not be prepared"})
	case errors.Is(err, download.ErrStorage):
		c.JSON(http.StatusBadGateway, gin.H{"error": "File content is temporarily unavailable"})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "File download unavailable"})
	}
}

func safeDownloadContentType(value string) string {
	mediaType, params, err := mime.ParseMediaType(value)
	if err != nil || mediaType == "" || strings.ContainsAny(value, "\r\n") {
		return "application/octet-stream"
	}
	return mime.FormatMediaType(mediaType, params)
}

func attachmentDisposition(filename string) string {
	clean := strings.Map(func(r rune) rune {
		if r == '\r' || r == '\n' || r == 0 || r < 0x20 || r == 0x7f {
			return -1
		}
		return r
	}, filename)
	if clean == "" || !utf8.ValidString(clean) {
		clean = "download"
	}
	return `attachment; filename="` + asciiFilename(clean) + `"; filename*=UTF-8''` + rfc5987Encode(clean)
}

func asciiFilename(filename string) string {
	var b strings.Builder
	for _, r := range filename {
		// Keep the fallback portable as well as syntactically safe. The UTF-8
		// filename* parameter retains the recorded name, while this legacy
		// fallback must not look like a path on common client platforms.
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') || strings.ContainsRune(" ._-()", r) {
			b.WriteRune(r)
		} else {
			b.WriteByte('_')
		}
	}
	if b.Len() == 0 {
		return "download"
	}
	return b.String()
}

func rfc5987Encode(value string) string {
	const hex = "0123456789ABCDEF"
	var b strings.Builder
	for _, c := range []byte(value) {
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || strings.ContainsRune("!#$&+-.^_`|~", rune(c)) {
			b.WriteByte(c)
		} else {
			b.WriteByte('%')
			b.WriteByte(hex[c>>4])
			b.WriteByte(hex[c&15])
		}
	}
	return b.String()
}
