package handlers

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	
	"projects-service/internal/auth"
	db "projects-service/db/sqlc"
)

// Handlers contains all HTTP handlers
// Stores database and auth dependencies
type Handler struct {
	queries *db.Queries
	authorizer *auth.Authorizer
}

// NewHandler initializes a new Handler object
// Includes required dependencies
func NewHandler(queries *db.Queries) *Handler {
	return &Handler{
		queries:    queries,
		authorizer: auth.NewAuthorizer(queries),
	}
}

// getUserID extracts the authenticated user's ID from the Gin context.
// This value is expected to be set by authentication middleware.
//
// Returns:
// - string: user ID
// - error: if user_id is missing or invalid
func (h *Handler) getUserID(c *gin.Context) (string, error) {
	userID, exists := c.Get("user_id")
	if !exists {
		return "", fmt.Errorf("user_id not found in context")
	}
	return userID.(string), nil
}

// stringToPgUUID converts a UUID string into pgtype.UUID
// which is required for PostgreSQL queries using pgx.
//
// Returns an error if the string is not a valid UUID.
func stringToPgUUID(uuidStr string) (pgtype.UUID, error) {
	uid, err := uuid.Parse(uuidStr)
	if err != nil {
		return pgtype.UUID{}, err
	}
	
	var pgUUID pgtype.UUID
	err = pgUUID.Scan(uid.String())
	return pgUUID, err
}

// pgUUIDToString converts pgtype.UUID back to a standard string.
func pgUUIDToString(pgUUID pgtype.UUID) string {
	if !pgUUID.Valid {
		return ""
	}
	uid, _ := uuid.FromBytes(pgUUID.Bytes[:])
	return uid.String()
}

// ListProjects handles:
// GET /projects/v1/projects
//
// Query params:
// - ?filter=owned → only projects owned by user
// - default → all accessible projects (owned + shared)
func (h *Handler) ListProjects(c *gin.Context) {
	// Extract user id
	userID, err := h.getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	// extract query parameter
	filter := c.Query("filter") // ?filter=owned or ?filter=shared
	
	var projects []db.Project
	if filter == "owned" { // Query owned properties
		projects, err = h.queries.ListProjectsByOwner(c.Request.Context(), userID)
	} else { // Query all properties
		projects, err = h.queries.ListProjectsByUser(c.Request.Context(), userID)
	}

	// Database retrievel error
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list projects"})
		return
	}

	// Return prject as JSON
	c.JSON(http.StatusOK, projects)
}

// CreateProject handles:
// POST /projects/v1/projects
//
// Body:
// {
//   "name": "Project Name"
// }
func (h *Handler) CreateProject(c *gin.Context) {
	// Ensure user is authenticated
	userID, err := h.getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	// Request payload structure
	var req struct {
		Name string `json:"name" binding:"required"`
	}

	// Bind and validate JSON input
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Name is required"})
		return
	}

	// Generate new UUID
	projectID := uuid.New()
	pgUUID, _ := stringToPgUUID(projectID.String())
	
	// Convert name to pgtype.Text
	var name pgtype.Text
	name.Scan(req.Name)

	// Create project in database
	project, err := h.queries.CreateProject(c.Request.Context(), pgUUID, userID, name)
	
	// Error inserting project
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create project"})
		return
	}

	// Return created project
	c.JSON(http.StatusCreated, project)
}

// GetProject handles:
// GET /projects/v1/projects/:id
func (h *Handler) GetProject(c *gin.Context) {
	// Extract user ID
	userID, err := h.getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	// Extract project ID from URL path
	projectIDStr := c.Param("id")
	
	// Convert to pgtype.UUID
	pgUUID, err := stringToPgUUID(projectIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project ID"})
		return
	}

	// Read permission check
	if ok, err := h.authorizer.CanRead(c.Request.Context(), pgUUID, userID); !ok || err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	// Fetch project from database
	project, err := h.queries.GetProject(c.Request.Context(), pgUUID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Project not found"})
		return
	}

	c.JSON(http.StatusOK, project)
}

// UpdateProject handles:
// PATCH /projects/v1/projects/:id
//
// Body:
// {
//   "name": "Updated Name"
// }
func (h *Handler) UpdateProject(c *gin.Context) {
	// Extract user ID
	userID, err := h.getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	projectIDStr := c.Param("id")
	
	// Validate project ID
	pgUUID, err := stringToPgUUID(projectIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project ID"})
		return
	}

	// Write permission check
	if ok, err := h.authorizer.CanWrite(c.Request.Context(), pgUUID, userID); !ok || err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	// Request payload
	var req struct {
		Name string `json:"name" binding:"required"`
	}

	// Validate request body
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Name is required"})
		return
	}

	// Convert name to pgtype.Text
	var name pgtype.Text
	name.Scan(req.Name)

	// Update project name in DB
	project, err := h.queries.UpdateProjectName(c.Request.Context(), pgUUID, name)
	if err != nil { // Error updating name
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update project"})
		return
	}

	c.JSON(http.StatusOK, project)
}

// DeleteProject handles:
// DELETE /projects/v1/projects/:id
func (h *Handler) DeleteProject(c *gin.Context) {
	// Extract user ID
	userID, err := h.getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	projectIDStr := c.Param("id")
	
	// Validate project ID
	pgUUID, err := stringToPgUUID(projectIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project ID"})
		return
	}

	// Owner permission check
	if ok, err := h.authorizer.IsOwner(c.Request.Context(), pgUUID, userID); !ok || err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only project owner can delete files"})
		return
	}

	// Delete project from database
	err = h.queries.DeleteProject(c.Request.Context(), pgUUID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete project"})
		return
	}

	c.JSON(http.StatusNoContent, nil)
}

// GetProjectTree handles:
// GET /projects/v1/projects/:id/tree
//
// Returns the full nested directory and file structure for a project as JSON.
func (h *Handler) GetProjectTree(c *gin.Context) {
	// Extract user ID for authorization check
	userID, err := h.getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	// Extract project ID from URL path
	projectIDStr := c.Param("id")
	
	// Convert to pgtype.UUID
	pgUUID, err := stringToPgUUID(projectIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project ID"})
		return
	}

	// Cheeck read permission
	if ok, err := h.authorizer.CanRead(c.Request.Context(), pgUUID, userID); !ok || err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	// Verify user has access to this project
	_, err = h.queries.GetProject(c.Request.Context(), pgUUID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Project not found"})
		return
	}

	// Fetch the project structure as JSON
	structure, err := h.queries.GetProjectStructureAsJSON(c.Request.Context(), pgUUID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch project structure"})
		return
	}

	// Return the structure (already JSON from DB)
	c.JSON(http.StatusOK, structure)
}

// Stub handlers for unimplemented endpoints

func (h *Handler) CreateDirectory(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented yet"})
}

func (h *Handler) UpdateDirectory(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented yet"})
}

func (h *Handler) DeleteDirectory(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented yet"})
}

func (h *Handler) CreateFile(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented yet"})
}

func (h *Handler) GetFile(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented yet"})
}

func (h *Handler) GetFileContent(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented yet"})
}

func (h *Handler) UpdateFile(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented yet"})
}

func (h *Handler) DeleteFile(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented yet"})
}

func (h *Handler) CreateInvite(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented yet"})
}

func (h *Handler) AcceptInvite(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented yet"})
}

func (h *Handler) ListCollaborators(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented yet"})
}

func (h *Handler) RemoveCollaborator(c *gin.Context) {
	c.JSON(http.StatusNotImplemented, gin.H{"error": "Not implemented yet"})
}