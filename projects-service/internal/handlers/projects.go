package handlers

import (
	"time"
	"context"
	"encoding/json"
	"net/http"
	"log"
	"fmt"

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

type File struct {
	ID       		string `json:"id"`
	Filename 		string `json:"filename"`
	FileType 		string `json:"file_type"`
	StorageKey		string `json:"storage_key"`
	DownloadURL	string `json:"download_url"`
}

type RawFile struct {
	ID          string `json:"id"`
	DirectoryID string `json:"directory_id"`
	Filename    string `json:"filename"`
	FileType    string `json:"file_type"`
	StorageKey	string `json:"storage_key"`
}

type Node struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Children []*Node `json:"children"`
	Files    []File  `json:"files"`
}

type Directory struct {
	ID       string  `json:"id"`
	ParentID *string `json:"parent_id"`
	Name     string  `json:"name"`
}

// buildProjectTree converts a flat directory + file list into a nested tree structure.
//
// Input:
// - directories with parent_id relationships
// - files with directory_id
//
// Output:
// - []*Node representing root directories with recursively nested children
func buildProjectTree(
	directories []Directory,
	files []RawFile,
) []*Node {

	// Map of directoryID to Node pointer for O(1) lookup
	dirMap := make(map[string]*Node)

	// Initialize all nodes (no relationships yet)
	for _, d := range directories {
		dirMap[d.ID] = &Node{
			ID:       d.ID,
			Name:     d.Name,
			Children: []*Node{}, // ensure [] instead of null
			Files:    []File{},  // ensure [] instead of null
		}
	}

	var roots []*Node

	// Build parent-child relationships
	for _, d := range directories {
		node := dirMap[d.ID]

		// Root directory (no parent)
		if d.ParentID == nil {
			roots = append(roots, node)
			continue
		}

		// Attach to parent if it exists
		if parent, ok := dirMap[*d.ParentID]; ok {
			parent.Children = append(parent.Children, node)
		} else {
			// Safety fallback: treat as root if parent missing
			roots = append(roots, node)
		}
	}

	// Attach files to their respective directories
	for _, f := range files {
		if dir, ok := dirMap[f.DirectoryID]; ok {
			dir.Files = append(dir.Files, File{
				ID:       f.ID,
				Filename: f.Filename,
				FileType: f.FileType,
				StorageKey: f.StorageKey,
			})
		}
	}

	return roots
}

// GetProjectTree handles:
// GET /projects/v1/projects/:id/tree
func (h *Handler) GetProjectTree(c *gin.Context) {
	log.Println("Project Tree requested")
	// Parse user ID
	userID, err := h.getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	// Read and convert project ID from path parameter
	projectIDStr := c.Param("projectID")
	pgUUID, err := stringToPgUUID(projectIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project ID"})
		return
	}

	// Ensure read permissions
	if ok, err := h.authorizer.CanRead(c.Request.Context(), pgUUID, userID); !ok || err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	// Ensure project exists
	_, err = h.queries.GetProject(c.Request.Context(), pgUUID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Project not found"})
		return
	}

	// Retrieve flat project structure from database
	structure, err := h.queries.GetProjectStructureAsJSON(c.Request.Context(), pgUUID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch project structure"})
		return
	}

	// Struct to store flat json project from DB
	var raw struct {
		ProjectID   string      `json:"project_id"`
		Directories []Directory `json:"directories"`
		Files       []RawFile   `json:"files"`
	}

	// Parse database response into struct
	if err := json.Unmarshal(structure, &raw); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to parse structure"})
		return
	}

	// Build nested tree from flat data
	tree := buildProjectTree(raw.Directories, raw.Files)
	enrichTreeWithPresignedURLs(c.Request.Context(), h, tree, 1*time.Hour)

	c.JSON(http.StatusOK, gin.H{
		"project_id": raw.ProjectID,
		"tree":       tree,
	})
}


// enrichTreeWithPresignedURLs recursively adds presigned URLs to all files in the tree
func enrichTreeWithPresignedURLs(
	ctx context.Context,
	h *Handler,
	nodes []*Node,
	expiry time.Duration,
) {
	log.Println("Enriching trees with Presigned URL")

	for _, node := range nodes {
		// Add URLs to files in this node
		for i := range node.Files {
			// Generate URL based on storage_key pattern: projectID/fileID
			url, err := h.generateDownloadURL(ctx, "uploads", node.Files[i].StorageKey, expiry)
			if err != nil { // Log error but don't fail entire response
				fmt.Printf("ERROR generating download URL for %s: %v\n", node.Files[i].StorageKey, err)
				continue
			} else {
				log.Println("Presigned URL Generated", url)
			}
			node.Files[i].DownloadURL = url
		}

		// Recurse into children
		if len(node.Children) > 0 {
			enrichTreeWithPresignedURLs(ctx, h, node.Children, expiry)
		}
	}
}
