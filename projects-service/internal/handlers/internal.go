package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// DownloadFileInternal handles:
// GET /internal/file/:fileID/download
//
// Returns:
// {
//   "url": "<presigned_download_url>"
// }
func (h* Handler) InternalDownloadFile(c *gin.Context) {
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

	// Generate presigned download URL
	downloadURL, err := h.generateDownloadURL(
		c.Request.Context(),
		"uploads",
		file.StorageKey,
		15*time.Minute,
		true
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate download URL"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"url": downloadURL,
	})
}


// DownloadFileInternal handles:
// GET /internal/file/:fileID/upload
//
// Returns:
// {
//   "url": "<presigned_upload_url>"
// }
func (h* Handler) InternalUploadFile(c *gin.Context) {
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

	// Generate presigned upload URL
	uploadURL, err := h.generateUploadURL(
		c.Request.Context(),
		"uploads",
		file.StorageKey,
		15*time.Minute,
		true
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate upload URL"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"url": uploadURL,
	})
}