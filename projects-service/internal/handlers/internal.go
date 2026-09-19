package handlers

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/minio/minio-go/v7"

	db "projects-service/db/sqlc"
)

// materializationSource records the complete identity of one optional Yjs
// source object. Presence is part of the identity: an absent update log is not
// equivalent to a present log with any ETag.
type materializationSource struct {
	present bool
	etag    string
}

func materializationIdentity(snapshot, pending materializationSource) string {
	part := func(source materializationSource) string {
		if !source.present {
			return "absent"
		}
		// ETags are opaque; encoding prevents delimiter ambiguity while retaining
		// the actual stable object version in the persisted identity.
		return "present:" + base64.RawURLEncoding.EncodeToString([]byte(source.etag))
	}
	return "v1;snapshot=" + part(snapshot) + ";pending=" + part(pending)
}

func objectNotFound(err error) bool {
	code := minio.ToErrorResponse(err).Code
	return code == "NoSuchKey" || code == "NoSuchObject" || code == "NotFound"
}

func (h *Handler) statMaterializationSource(ctx context.Context, bucket, key string) (materializationSource, error) {
	info, err := h.minioClient.StatObject(ctx, bucket, key, minio.StatObjectOptions{})
	if err == nil {
		return materializationSource{present: true, etag: info.ETag}, nil
	}
	if objectNotFound(err) {
		return materializationSource{}, nil
	}
	return materializationSource{}, fmt.Errorf("stat %s source: %w", bucket, err)
}

// DownloadFileInternal handles:
// GET /internal/file/:fileID/download
//
// Returns:
//
//	{
//	  "url": "<presigned_download_url>"
//	}
func (h *Handler) InternalDownloadFile(c *gin.Context) {
	// Parse file ID
	fileIDStr := c.Param("fileID")
	fileID, err := stringToPgUUID(fileIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid file ID"})
		return
	}

	// Fetch file from DB
	file, err := h.queries.GetFile(c.Request.Context(), fileID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "File not found"})
		return
	}

	// Get query params: ?type=uploads,snapshot,text
	// Default to all if empty
	queryTypes := c.Query("type") // returns "" if not provided
	var typesToReturn []string
	if queryTypes == "" {
		typesToReturn = []string{"uploads", "snapshot", "text"}
	} else {
		typesToReturn = strings.Split(queryTypes, ",")
	}

	// Validate allowed types
	validTypes := map[string]bool{"uploads": true, "snapshot": true, "text": true}
	for _, t := range typesToReturn {
		if !validTypes[t] {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid type, must be 'uploads', 'snapshot', or 'text'"})
			return
		}
	}

	// If text was requested, check if it needs regenerating before producing URLs
	if slices.Contains(typesToReturn, "text") {
		if err := h.ensureTextUpToDate(c.Request.Context(), file); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to ensure text version is up to date"})
			return
		}
	}

	// Generate download URLs for requested types
	urls := make(map[string]string)
	for _, t := range typesToReturn {
		storageBucket := t // bucket matches type
		downloadURL, err := h.generateDownloadURL(
			c.Request.Context(),
			storageBucket,
			file.StorageKey,
			15*time.Minute,
			true,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate download URL for " + t})
			return
		}
		urls[t] = downloadURL
	}

	c.JSON(http.StatusOK, urls)
}

// UploadFileInternal handles:
// GET /internal/file/:fileID/upload
//
// Returns:
//
//	{
//	  "url": "<presigned_upload_url>"
//	}
func (h *Handler) InternalUploadFile(c *gin.Context) {
	// Parse file ID
	fileIDStr := c.Param("fileID")
	fileID, err := stringToPgUUID(fileIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid file ID"})
		return
	}

	// Get query param: ?type=snapshot, ?type=uploads, or ?type=text
	fileType := c.DefaultQuery("type", "uploads")

	// Validate allowed values
	if fileType != "snapshot" && fileType != "uploads" && fileType != "text" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid type, must be 'compact', 'updates', or 'text'"})
		return
	}

	// Fetch file from DB
	file, err := h.queries.GetFile(c.Request.Context(), fileID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "File not found"})
		return
	}

	// Determine storage bucket
	storageBucket := "uploads"
	if fileType == "snapshot" {
		storageBucket = "snapshot"
	} else if fileType == "text" {
		storageBucket = "text"
	}

	// Generate presigned upload URL
	uploadURL, err := h.generateUploadURL(
		c.Request.Context(),
		storageBucket,
		file.StorageKey,
		15*time.Minute,
		true,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate upload URL"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"url": uploadURL,
	})
}

// InternalCompactFile handles:
// GET /internal/file/:fileID/compact
func (h *Handler) InternalCompactFile(c *gin.Context) {
	// Parse file ID
	fileIDStr := c.Param("fileID")
	fileID, err := stringToPgUUID(fileIDStr)
	if err != nil {
		log.Printf("Invalid file ID '%s': %v", fileIDStr, err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid file ID"})
		return
	}

	// Fetch file from DB
	file, err := h.queries.GetFile(c.Request.Context(), fileID)
	if err != nil {
		log.Printf("File not found with ID '%s': %v", fileIDStr, err)
		c.JSON(http.StatusNotFound, gin.H{"error": "File not found"})
		return
	}

	// Generate upload URL for snapshot file
	uploadURL, err := h.generateUploadURL(
		c.Request.Context(),
		"snapshot",
		file.StorageKey,
		3*time.Minute,
		true,
	)
	if err != nil {
		log.Printf("Failed to generate snapshot upload URL for '%s': %v", file.StorageKey, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate snapshots upload URL"})
		return
	}

	// Generate download URL for existing snapshot file
	downloadSnapshotURL, err := h.generateDownloadURL(
		c.Request.Context(),
		"snapshot",
		file.StorageKey,
		3*time.Minute,
		true,
	)
	if err != nil {
		log.Printf("Failed to generate snapshot download URL for '%s': %v", file.StorageKey, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate snapshots download URL"})
		return
	}

	// Generate download URL for uploads file
	downloadURL, err := h.generateDownloadURL(
		c.Request.Context(),
		"uploads",
		file.StorageKey,
		3*time.Minute,
		true,
	)
	if err != nil {
		log.Printf("Failed to generate uploads download URL for '%s': %v", file.StorageKey, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate upload files download URL"})
		return
	}

	// Make gRPC request to file-data-service
	if err := h.fileDataClient.CompactDocument(c.Request.Context(), downloadURL, uploadURL, downloadSnapshotURL); err != nil {
		log.Printf("Compaction service failed for file '%s': %v", file.StorageKey, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to invoke compaction service"})
		return
	}

	// Delete old uploads file if successful
	h.deleteObject(
		c.Request.Context(),
		"uploads",
		file.StorageKey,
	)
	if err != nil { // log failure
		log.Printf("failed to delete object %s from bucket %s: %v", file.StorageKey, "uploads", err)
	} else { // log success
		log.Printf("successfully deleted object %s from bucket %s", file.StorageKey, "uploads")
	}

	c.JSON(http.StatusOK, gin.H{
		"url": uploadURL,
	})
}

func (h *Handler) ensureTextUpToDate(ctx context.Context, file db.File) error {
	// Snapshot and pending updates are independently optional. Only an explicit
	// object-not-found result means absent; auth, transport, and timeout errors
	// must stop materialization rather than silently producing empty text.
	snapshot, err := h.statMaterializationSource(ctx, "snapshot", file.StorageKey)
	if err != nil {
		return err
	}
	pending, err := h.statMaterializationSource(ctx, "uploads", file.StorageKey)
	if err != nil {
		return err
	}
	currentIdentity := materializationIdentity(snapshot, pending)

	// A matching marker alone is insufficient: text may have been deleted.
	if file.TextSourceEtag.Valid && file.TextSourceEtag.String == currentIdentity {
		_, err := h.minioClient.StatObject(ctx, "text", file.StorageKey, minio.StatObjectOptions{})
		if err == nil {
			return nil
		}
		if !objectNotFound(err) {
			return fmt.Errorf("stat materialized text object: %w", err)
		}
	}

	var downloadSnapshotURL, downloadUpdatesURL string
	if snapshot.present {
		downloadSnapshotURL, err = h.generateDownloadURL(ctx, "snapshot", file.StorageKey, 3*time.Minute, true)
		if err != nil {
			return fmt.Errorf("generate snapshot download URL: %w", err)
		}
	}
	if pending.present {
		downloadUpdatesURL, err = h.generateDownloadURL(ctx, "uploads", file.StorageKey, 3*time.Minute, true)
		if err != nil {
			return fmt.Errorf("generate pending-update download URL: %w", err)
		}
	}

	// Generate upload URL for text file
	uploadTextURL, err := h.generateUploadURL(
		ctx,
		"text",
		file.StorageKey,
		3*time.Minute,
		true,
	)
	if err != nil {
		return fmt.Errorf("generate text upload URL: %w", err)
	}

	// Make gRPC request to file-data-service
	if err := h.fileDataClient.ExtractText(ctx, downloadSnapshotURL, downloadUpdatesURL, uploadTextURL); err != nil {
		log.Printf("Extraction service failed for file '%s': %v", file.StorageKey, err)
		return fmt.Errorf("invoke extract text service: %w", err)
	}

	// The objects can change while extraction is in flight. Never advance the
	// freshness marker for bytes that may have come from an older pair; a later
	// request will regenerate from the newly observed sources instead.
	latestSnapshot, err := h.statMaterializationSource(ctx, "snapshot", file.StorageKey)
	if err != nil {
		return err
	}
	latestPending, err := h.statMaterializationSource(ctx, "uploads", file.StorageKey)
	if err != nil {
		return err
	}
	if materializationIdentity(latestSnapshot, latestPending) != currentIdentity {
		return fmt.Errorf("materialization sources changed during extraction")
	}

	// Update the stored etag in DB so next request skips regeneration
	if err := h.queries.UpdateFileTextEtag(ctx, file.ID, pgtype.Text{String: currentIdentity, Valid: true}); err != nil {
		return fmt.Errorf("update text freshness identity: %w", err)
	}

	return nil
}

// InternalDownloadProject handles:
// GET /internal/project/:projectID/download
//
// Optional query param: ?type=uploads,snapshot,text
// If omitted, files are returned without presigned URLs.
//
// Returns:
//
//	{
//	  "files": [
//	    {
//	      "id": "...",
//	      "filename": "...",
//	      "file_type": "...",
//	      "storage_key": "...",
//	      "urls": { "uploads": "...", ... }   // omitted if ?type not provided
//	    }
//	  ]
//	}
func (h *Handler) InternalDownloadProject(c *gin.Context) {
	// Parse project ID
	projectIDStr := c.Param("projectID")
	projectID, err := stringToPgUUID(projectIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project ID"})
		return
	}

	// Fetch all files for the project
	files, err := h.queries.ListFilesByProject(c.Request.Context(), projectID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch project files"})
		return
	}

	// Parse optional ?type= query param
	queryTypes := c.Query("type")
	var typesToReturn []string
	withURLs := queryTypes != ""
	if withURLs {
		typesToReturn = strings.Split(queryTypes, ",")
		validTypes := map[string]bool{"uploads": true, "snapshot": true, "text": true}
		for _, t := range typesToReturn {
			if !validTypes[t] {
				c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid type, must be 'uploads', 'snapshot', or 'text'"})
				return
			}
		}
	}

	// Build response
	type FileEntry struct {
		ID       string            `json:"id"`
		Filename string            `json:"filename"`
		FileType db.FileType       `json:"file_type"`
		URLs     map[string]string `json:"urls,omitempty"`
	}

	entries := make([]FileEntry, 0, len(files))

	for _, file := range files {
		entry := FileEntry{
			ID:       pgUUIDToString(file.ID),
			Filename: file.Filename,
			FileType: file.FileType,
		}

		if withURLs {
			// Ensure text is fresh before generating its URL
			if slices.Contains(typesToReturn, "text") {
				if err := h.ensureTextUpToDate(c.Request.Context(), file); err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{
						"error": fmt.Sprintf("Failed to ensure text version is up to date for file %s", entry.ID),
					})
					return
				}
			}

			urls := make(map[string]string, len(typesToReturn))
			for _, t := range typesToReturn {
				url, err := h.generateDownloadURL(
					c.Request.Context(),
					t, // bucket matches type
					file.StorageKey,
					15*time.Minute,
					true,
				)
				if err != nil {
					c.JSON(http.StatusInternalServerError, gin.H{
						"error": fmt.Sprintf("Failed to generate %s URL for file %s", t, entry.ID),
					})
					return
				}
				urls[t] = url
			}
			entry.URLs = urls
		}

		entries = append(entries, entry)
	}

	c.JSON(http.StatusOK, gin.H{"files": entries})
}
