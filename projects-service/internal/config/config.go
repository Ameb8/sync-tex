package config

import (
	"os"
)

// Config holds server configuration values
type Config struct {
	DatabaseURL 	string
	JWTSecret   	string
	Port        	string	
	FileDataAddr 	string
	ExternalURL		string
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

	fileDataAddr := os.Getenv("FILE_DATA_ADDR")
	if fileDataAddr == "" {
		fileDataAddr = "file-data-service:50051"
	}

	externalURL := os.Getenv("EXTERNAL_URL")

	return &Config{
		DatabaseURL: dbURL,
		JWTSecret:   jwtSecret,
		Port:        port,
		FileDataAddr: fileDataAddr,
		ExternalURL: externalURL,
	}
}