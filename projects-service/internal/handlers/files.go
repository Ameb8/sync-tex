package handlers

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	db "projects-service/db/sqlc"
)

// CreateDirectory handles:
// POST /projects/v1/projects/:id/directories
//
// Body:
//
//	{
//	  "name": "Directory Name",
//	  "parent_id": "UUID or null"
//	}
func (h *Handler) CreateDirectory(c *gin.Context) {
	// Extract authenticated user ID from request context
	userID, err := h.getUserID(c)
	if err != nil { // Request context missing user_id
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	// Extract project ID from URL and convert to Postgres UUID type
	projectIDStr := c.Param("projectID")
	projectID, err := stringToPgUUID(projectIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project ID"})
		return
	}

	// Write permission check
	if ok, err := h.authorizer.CanWrite(c.Request.Context(), projectID, userID); !ok || err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	// Expected request body
	var req struct {
		Name     string  `json:"name" binding:"required"`
		ParentID *string `json:"parent_id"` // Optional
	}

	// Attempt to bind JSON request body
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Name is required"})
		return
	}

	// Generate UUID
	dirID := uuid.New()
	pgDirID, _ := stringToPgUUID(dirID.String())

	// Handle optional parent directry
	var parentID pgtype.UUID
	if req.ParentID != nil {
		// Parse parent ID from request body
		parentID, err = stringToPgUUID(*req.ParentID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid parent ID"})
			return
		}

		parentID.Valid = true // Mark as valid
	}

	// Insert directory into database
	directory, err := h.queries.CreateDirectory(
		c.Request.Context(),
		pgDirID,
		projectID,
		parentID,
		req.Name,
	)

	if err != nil { // Error inserting to database
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create directory"})
		return
	}

	c.JSON(http.StatusCreated, directory) // Return created directory
}

// UpdateDirectory handles:
// PATCH /projects/v1/projects/:projectID/directories/:dirID
//
// Body:
//
//	{
//	  "name": "Updated Name"
//	}
func (h *Handler) UpdateDirectory(c *gin.Context) {
	// Authenticte user
	userID, err := h.getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	// Parse project ID
	projectIDStr := c.Param("projectID")
	projectID, err := stringToPgUUID(projectIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project ID"})
		return
	}

	// Parse directory ID
	dirIDStr := c.Param("dirID")
	dirID, err := stringToPgUUID(dirIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid directory ID"})
		return
	}

	// Verify directory belongs to project
	directory, err := h.queries.GetDirectory(c.Request.Context(), dirID)
	if err != nil || directory.ProjectID != projectID {
		c.JSON(http.StatusNotFound, gin.H{"error": "Directory not found"})
		return
	}

	// Write permission check
	if ok, err := h.authorizer.CanWrite(c.Request.Context(), projectID, userID); !ok || err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	// Expected request body structure
	var req struct {
		Name string `json:"name" binding:"required"`
	}

	// Parse request body
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Name is required"})
		return
	}

	// Update directory name in datbase
	updated, err := h.queries.UpdateDirectory(c.Request.Context(), dirID, req.Name)

	if err != nil { // Error updating database
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update directory"})
		return
	}

	c.JSON(http.StatusOK, updated)
}

// DeleteDirectory handles:
// DELETE /projects/v1/projects/:projectID/directories/:dirID
func (h *Handler) DeleteDirectory(c *gin.Context) {
	// Parse user ID
	userID, err := h.getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	// Parse project ID
	projectIDStr := c.Param("projectID")
	projectID, err := stringToPgUUID(projectIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project ID"})
		return
	}

	// Parse directory ID
	dirIDStr := c.Param("dirID")
	dirID, err := stringToPgUUID(dirIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid directory ID"})
		return
	}

	// Write permission check
	if ok, err := h.authorizer.CanWrite(c.Request.Context(), projectID, userID); !ok || err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	// Verify directory belongs to project
	directory, err := h.queries.GetDirectory(c.Request.Context(), dirID)
	if err != nil || directory.ProjectID != projectID {
		c.JSON(http.StatusNotFound, gin.H{"error": "Directory not found"})
		return
	}

	// Delete directory from database
	err = h.queries.DeleteDirectory(c.Request.Context(), dirID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete directory"})
		return
	}

	c.JSON(http.StatusNoContent, nil)
}

// CreateFile handles:
// POST /projects/v1/projects/:projectID/files
//
// Body:
//
//	{
//	  "filename": "document.tex",
//	  "directory_id": "UUID",
//	  "file_type": "tex"
//	}
func (h *Handler) CreateFile(c *gin.Context) {
	// Parse user ID
	userID, err := h.getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	// Parse project ID
	projectIDStr := c.Param("projectID")
	projectID, err := stringToPgUUID(projectIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project ID"})
		return
	}

	// Write permission check
	if ok, err := h.authorizer.CanWrite(c.Request.Context(), projectID, userID); !ok || err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	// Expected request body
	var req struct {
		Filename    string `json:"filename" binding:"required"`
		DirectoryID string `json:"directory_id" binding:"required"`
		FileType    string `json:"file_type"`
	}

	// Parse request body
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Filename and directory_id are required"})
		return
	}

	// Get Directory ID and convert to PgUUID
	dirID, err := stringToPgUUID(req.DirectoryID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid directory ID"})
		return
	}

	// Verify directory belongs to project
	directory, err := h.queries.GetDirectory(c.Request.Context(), dirID)
	if err != nil || directory.ProjectID != projectID {
		c.JSON(http.StatusNotFound, gin.H{"error": "Directory not found"})
		return
	}

	// Generate file id and convert to PgUUID
	fileID := uuid.New()
	pgFileID, _ := stringToPgUUID(fileID.String())

	// Generate storage key
	storageKey := projectIDStr + "/" + fileID.String()

	// Assign file type
	if req.FileType == "" {
		req.FileType = "other"
	}

	// Create file in database
	file, err := h.queries.CreateFile(c.Request.Context(), db.CreateFileParams{
		ID:          pgFileID,
		DirectoryID: dirID,
		ProjectID:   projectID,
		Filename:    req.Filename,
		StorageKey:  storageKey,
		FileType:    db.FileType(req.FileType),
	})

	// Error creting file in database
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create file"})
		return
	}

	// Generate presigned upload URL
	uploadURL, err := h.generateUploadURL(c.Request.Context(), "uploads", storageKey, 15*time.Minute, false)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate upload URL"})
		return
	}

	// File created
	c.JSON(http.StatusCreated, gin.H{
		"id":           file.ID,
		"filename":     file.Filename,
		"file_type":    file.FileType,
		"storage_key":  file.StorageKey,
		"directory_id": file.DirectoryID,
		"project_id":   file.ProjectID,
		"upload_url":   uploadURL,
	})
}

// GetFile handles:
// GET /projects/v1/projects/:projectID/files/:fileID
func (h *Handler) GetFile(c *gin.Context) {
	userID, err := h.getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	projectIDStr := c.Param("projectID")
	projectID, err := stringToPgUUID(projectIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project ID"})
		return
	}

	fileIDStr := c.Param("fileID")
	fileID, err := stringToPgUUID(fileIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid file ID"})
		return
	}

	// Read permission check
	if ok, err := h.authorizer.CanRead(c.Request.Context(), projectID, userID); !ok || err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	file, err := h.queries.GetFile(c.Request.Context(), fileID)
	if err != nil || file.ProjectID != projectID {
		c.JSON(http.StatusNotFound, gin.H{"error": "File not found"})
		return
	}

	c.JSON(http.StatusOK, file)
}
// GetUploadURL handles:
// POST /projects/v1/projects/:projectID/files/:fileID/upload
//
// Returns presigned URL for direct upload
func (h *Handler) GetUploadURL(c *gin.Context) {
	userID, err := h.getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	// Get project ID and convert to PgUUID
	projectIDStr := c.Param("projectID")
	projectID, err := stringToPgUUID(projectIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project ID"})
		return
	}

	// Get file ID and convert to PgUUID
	fileIDStr := c.Param("fileID")
	fileID, err := stringToPgUUID(fileIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid file ID"})
		return
	}

	// Write permission check
	if ok, err := h.authorizer.CanWrite(c.Request.Context(), projectID, userID); !ok || err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	// Verify file exists and belongs to project
	file, err := h.queries.GetFile(c.Request.Context(), fileID)
	if err != nil || file.ProjectID != projectID {
		c.JSON(http.StatusNotFound, gin.H{"error": "File not found"})
		return
	}

	// storage_key format: projectID/fileID
	storageKey := fmt.Sprintf("%s/%s", projectIDStr, fileIDStr)
	
	// Generate presigned upload URL (15 min expiry)
	uploadURL, err := h.generateUploadURL(c.Request.Context(), "uploads", storageKey, 15*time.Minute, false)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate upload URL"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"upload_url": uploadURL,
		"storage_key": storageKey,
	})
}


// UpdateFile handles:
// PATCH /projects/v1/projects/:projectID/files/:fileID
//
// Body:
//
//	{
//	  "filename": "updated.tex"
//	}
func (h *Handler) UpdateFile(c *gin.Context) {
	userID, err := h.getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	projectIDStr := c.Param("projectID")
	projectID, err := stringToPgUUID(projectIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project ID"})
		return
	}

	fileIDStr := c.Param("fileID")
	fileID, err := stringToPgUUID(fileIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid file ID"})
		return
	}

	// Write permission check
	if ok, err := h.authorizer.CanWrite(c.Request.Context(), projectID, userID); !ok || err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	var req struct {
		Filename string `json:"filename" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Filename is required"})
		return
	}

	file, err := h.queries.GetFile(c.Request.Context(), fileID)
	if err != nil || file.ProjectID != projectID {
		c.JSON(http.StatusNotFound, gin.H{"error": "File not found"})
		return
	}

	updated, err := h.queries.UpdateFile(
		c.Request.Context(),
		fileID,
		req.Filename,
	)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update file"})
		return
	}

	c.JSON(http.StatusOK, updated)
}

// DeleteFile handles:
// DELETE /projects/v1/projects/:projectID/files/:fileID
func (h *Handler) DeleteFile(c *gin.Context) {
	userID, err := h.getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	projectIDStr := c.Param("projectID")
	projectID, err := stringToPgUUID(projectIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project ID"})
		return
	}

	fileIDStr := c.Param("fileID")
	fileID, err := stringToPgUUID(fileIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid file ID"})
		return
	}

	// Write permission check
	if ok, err := h.authorizer.CanWrite(c.Request.Context(), projectID, userID); !ok || err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	file, err := h.queries.GetFile(c.Request.Context(), fileID)
	if err != nil || file.ProjectID != projectID {
		c.JSON(http.StatusNotFound, gin.H{"error": "File not found"})
		return
	}

	err = h.queries.DeleteFile(c.Request.Context(), fileID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete file"})
		return
	}

	c.JSON(http.StatusNoContent, nil)
}
