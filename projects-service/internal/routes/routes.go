package routes

import (
	"github.com/gin-gonic/gin"

	"projects-service/internal/handlers"
	"projects-service/internal/middleware"
)

// SetupRoutes for API endpoints
func SetupRoutes(r *gin.Engine, h *handlers.Handler, authMiddleware *middleware.AuthMiddleware) {
	// Public routes
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// Protected API routes
	api := r.Group("/projects/v1")
	api.Use(authMiddleware.ValidateJWT())

	// Projects
	api.GET("/projects", h.ListProjects)
	api.POST("/projects", h.CreateProject)
	api.GET("/projects/:projectID", h.GetProject)
	api.PATCH("/projects/:projectID", h.UpdateProject)
	api.DELETE("/projects/:projectID", h.DeleteProject)

	// Project tree
	api.GET("/projects/:projectID/tree", h.GetProjectTree)

	// Directories
	api.POST("/projects/:projectID/directories", h.CreateDirectory)
	api.PATCH("/projects/:projectID/directories/:dirID", h.UpdateDirectory)
	api.DELETE("/projects/:projectID/directories/:dirID", h.DeleteDirectory)

	// Files
	api.POST("/projects/:projectID/files", h.CreateFile)
	api.POST("/projects/:projectID/files:fileID/upload", h.GetUploadURL)
	api.GET("/projects/:projectID/files/:fileID", h.GetFile)
	api.GET("/projects/:projectID/files/:fileID/content", h.GetFileContent)
	api.PATCH("/projects/:projectID/files/:fileID", h.UpdateFile)
	api.DELETE("/projects/:projectID/files/:fileID", h.DeleteFile)

	// Collaborators
	api.POST("/projects/:projectID/invites", h.CreateInvite)
	api.POST("/invites/accept", h.AcceptInvite)
	api.GET("/projects/:projectID/collaborators", h.ListCollaborators)
	api.DELETE("/projects/:projectID/collaborators/:userID", h.RemoveCollaborator)
}