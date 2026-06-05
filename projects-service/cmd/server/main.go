package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

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
	pool, queries, err := db.New(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Database initialization failed: %v", err)
	}

	defer db.Close(pool) // Ensure db. connection pool gets closed

	// Initialize handlers
	h, _ := handlers.NewHandler(pool, queries, cfg)

	// Set up auth middleware
	authMiddleware := middleware.NewAuthMiddleware(cfg.JWTSecret)

	// Setup router
	r := gin.Default()
	routes.SetupRoutes(r, h, authMiddleware)

	srv := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: r,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	serverErr := make(chan error, 1)
	go func() {
		log.Printf("Server starting on port %s", cfg.Port)
		serverErr <- srv.ListenAndServe()
	}()

	select {
	case err := <-serverErr:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("Failed to start server: %v", err)
		}
	case <-ctx.Done():
		stop()
		log.Println("Shutdown signal received")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("Graceful shutdown timed out: %v", err)
		if closeErr := srv.Close(); closeErr != nil {
			log.Printf("Forced server close failed: %v", closeErr)
		}
	}

	log.Println("Server stopped")
}
