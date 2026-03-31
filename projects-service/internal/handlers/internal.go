package handlers

import (
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
