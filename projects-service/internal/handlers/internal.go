package handlers

import (
	"context"
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
		log.Printf("File not found with ID '%s': %v", fileID, err)
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
	// StatObject on the binary (uploads bucket) — fetches only metadata, no body
	objInfo, err := h.minioClient.StatObject(ctx, "uploads", file.StorageKey, minio.StatObjectOptions{})
	if err != nil {
		return fmt.Errorf("stat binary object: %w", err)
	}

	currentETag := objInfo.ETag

	// If DB etag matches current binary etag, text version is fresh — nothing to do
	if file.TextSourceEtag.Valid && file.TextSourceEtag.String == currentETag {
		return nil
	}

	// Generate download URL for snapshot file
	downloadSnapshotURL, err := h.generateDownloadURL(
		ctx,
		"snapshot",
		file.StorageKey,
		3*time.Minute,
		true,
	)

	// Generate download URL for uploads file
	downloadUpdatesURL, err := h.generateDownloadURL(
		ctx,
		"uploads",
		file.StorageKey,
		3*time.Minute,
		true,
	)

	// Generate upload URL for text file
	uploadTextURL, err := h.generateUploadURL(
		ctx,
		"text",
		file.StorageKey,
		3*time.Minute,
		true,
	)

	// Make gRPC request to file-data-service
	if err := h.fileDataClient.ExtractText(ctx, downloadSnapshotURL, downloadUpdatesURL, uploadTextURL); err != nil {
		log.Printf("Extraction service failed for file '%s': %v", file.StorageKey, err)
		return fmt.Errorf("invoke extract text service: %w", err)
	}

	// Update the stored etag in DB so next request skips regeneration
	if err := h.queries.UpdateFileTextEtag(ctx, file.ID, pgtype.Text{String: currentETag, Valid: true}); err != nil {
		return fmt.Errorf("update text etag: %w", err)
	}

	return nil
}
