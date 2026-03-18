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
	h := handlers.NewHandler(queries)

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
	{
		// Projects
		api.GET("/projects", h.ListProjects)
		api.POST("/projects", h.CreateProject)
		api.GET("/projects/:id", h.GetProject)
		api.PATCH("/projects/:id", h.UpdateProject)
		api.DELETE("/projects/:id", h.DeleteProject)
		
		// Project tree
		api.GET("/projects/:id/tree", h.GetProjectTree)
		
		// Directories
		api.POST("/projects/:id/directories", h.CreateDirectory)
		api.PATCH("/directories/:id", h.UpdateDirectory)
		api.DELETE("/directories/:id", h.DeleteDirectory)
		
		// Files
		api.POST("/files", h.CreateFile)
		api.GET("/files/:id", h.GetFile)
		api.GET("/files/:id/content", h.GetFileContent)
		api.PATCH("/files/:id", h.UpdateFile)
		api.DELETE("/files/:id", h.DeleteFile)
		
		// Collaborators
		api.POST("/projects/:id/invites", h.CreateInvite)
		api.POST("/invites/accept", h.AcceptInvite)
		api.GET("/projects/:id/collaborators", h.ListCollaborators)
		api.DELETE("/projects/:id/collaborators/:id", h.RemoveCollaborator)
	}

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