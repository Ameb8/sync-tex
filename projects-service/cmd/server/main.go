package main

import (
	"log"

	"github.com/gin-gonic/gin"

	"projects-service/internal/config"
	"projects-service/internal/db"
	"projects-service/internal/handlers"
	"projects-service/internal/middleware"
	"projects-service/internal/routes"
)

func main() {
	log.Println("Server starting...")

	// Load project config from environment
	cfg := config.Load()

	// Connect to database
	queries := db.New(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Database initialization failed: %v", err)
	}
	defer db.Close() // Ensure db. connection pool gets closed

	// Initialize handlers
	h, _ := handlers.NewHandler(queries)

	// Set up auth middleware
	authMiddleware := middleware.NewAuthMiddleware(cfg.JWTSecret)
	
	// Setup router
	r := gin.Default()
	routes.SetupRoutes(r, h, authMiddleware)

	// Run server
	log.Printf("Server starting on port %s", cfg.Port)
	if err := r.Run(":" + cfg.Port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
