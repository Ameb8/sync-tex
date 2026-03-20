package config

import (
	"os"
)

// Config holds server configuration values
type Config struct {
	DatabaseURL string
	JWTSecret   string
	Port        string	
}

// Load configuration from environment
// Return as struct
func Load() *Config {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://postgres:postgres@localhost:5433/projects_db?sslmode=disable"
	}

	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		jwtSecret = "dev-secret-change-in-production"
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8003"
	}

	return &Config{
		DatabaseURL: dbURL,
		JWTSecret:   jwtSecret,
		Port:        port,
	}
}