package main

import (
	"context"
	"log"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	db "projects-service/db/sqlc"
	"projects-service/internal/handlers"
	"projects-service/internal/middleware"
)

func main() {
	log.Println("Server starting...")

	// Database connection
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://postgres:postgres@localhost:5433/projects_db?sslmode=disable"
	}

	// Initialize a PostgreSQL connection pool.
	// pgxpool manages multiple connections efficiently.
	pool, err := pgxpool.New(context.Background(), dbURL)
	if err != nil {
		log.Fatalf("Unable to connect to database: %v", err)
	}
	defer pool.Close() // Close pool on app termination

	// Verify DB connectivity
	if err := pool.Ping(context.Background()); err != nil {
		log.Fatalf("Unable to ping database: %v", err)
	}

	log.Println("Connected to database successfully")

	// Initialize queries
	queries := db.New(pool)

	// Initialize handlers
	h, _ := handlers.NewHandler(queries)

	// Setup router
	r := gin.Default()

	// Add auth middleware
	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		jwtSecret = "dev-secret-change-in-production"
	}

	// Initialize autnetiction middleware
	authMiddleware := middleware.NewAuthMiddleware(jwtSecret)

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

	// Initialize port
	port := os.Getenv("PORT")
	if port == "" {
		port = "8003"
	}

	// Start HTTP server
	log.Printf("Server starting on port %s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
