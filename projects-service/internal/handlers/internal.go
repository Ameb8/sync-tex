package handlers

import (
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
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
