package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// ListProjects handles:
// GET /projects/v1/projects
//
// Query params:
// - ?filter=owned → only projects owned by user
// - default → all accessible projects (owned + shared)
func (h *Handler) ListProjects(c *gin.Context) {
	userID, err := h.getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	filter := c.Query("filter")

	var projects interface{}
	if filter == "owned" {
		projects, err = h.queries.ListProjectsByOwner(c.Request.Context(), userID)
	} else {
		projects, err = h.queries.ListProjectsByUser(c.Request.Context(), userID)
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list projects"})
		return
	}

	c.JSON(http.StatusOK, projects)
}

// CreateProject handles:
// POST /projects/v1/projects
//
// Body:
//
//	{
//	  "name": "Project Name"
//	}
func (h *Handler) CreateProject(c *gin.Context) {
	userID, err := h.getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	var req struct {
		Name string `json:"name" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Name is required"})
		return
	}

	projectID := uuid.New()
	pgUUID, _ := stringToPgUUID(projectID.String())

	var name pgtype.Text
	name.Scan(req.Name)

	project, err := h.queries.CreateProject(c.Request.Context(), pgUUID, userID, name)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create project"})
		return
	}

	c.JSON(http.StatusCreated, project)
}

// GetProject handles:
// GET /projects/v1/projects/:id
func (h *Handler) GetProject(c *gin.Context) {
	userID, err := h.getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	projectIDStr := c.Param("projectID")
	pgUUID, err := stringToPgUUID(projectIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project ID"})
		return
	}

	if ok, err := h.authorizer.CanRead(c.Request.Context(), pgUUID, userID); !ok || err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

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
//
//	{
//	  "name": "Updated Name"
//	}
func (h *Handler) UpdateProject(c *gin.Context) {
	userID, err := h.getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	projectIDStr := c.Param("projectID")
	pgUUID, err := stringToPgUUID(projectIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project ID"})
		return
	}

	if ok, err := h.authorizer.CanWrite(c.Request.Context(), pgUUID, userID); !ok || err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	var req struct {
		Name string `json:"name" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Name is required"})
		return
	}

	var name pgtype.Text
	name.Scan(req.Name)

	project, err := h.queries.UpdateProjectName(c.Request.Context(), pgUUID, name)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update project"})
		return
	}

	c.JSON(http.StatusOK, project)
}

// DeleteProject handles:
// DELETE /projects/v1/projects/:id
func (h *Handler) DeleteProject(c *gin.Context) {
	userID, err := h.getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	projectIDStr := c.Param("projectID")
	pgUUID, err := stringToPgUUID(projectIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project ID"})
		return
	}

	if ok, err := h.authorizer.IsOwner(c.Request.Context(), pgUUID, userID); !ok || err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only project owner can delete files"})
		return
	}

	err = h.queries.DeleteProject(c.Request.Context(), pgUUID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete project"})
		return
	}

	c.JSON(http.StatusNoContent, nil)
}

// GetProjectTree handles:
// GET /projects/v1/projects/:id/tree
func (h *Handler) GetProjectTree(c *gin.Context) {
	userID, err := h.getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	projectIDStr := c.Param("projectID")
	pgUUID, err := stringToPgUUID(projectIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project ID"})
		return
	}

	if ok, err := h.authorizer.CanRead(c.Request.Context(), pgUUID, userID); !ok || err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	_, err = h.queries.GetProject(c.Request.Context(), pgUUID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Project not found"})
		return
	}

	structure, err := h.queries.GetProjectStructureAsJSON(c.Request.Context(), pgUUID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch project structure"})
		return
	}

	c.Data(http.StatusOK, "application/json", structure)
}
