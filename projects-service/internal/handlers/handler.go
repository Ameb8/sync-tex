package handlers

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"
	"log"
	

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/minio/minio-go/v7"
	"github.com/jackc/pgx/v5/pgxpool"
	
	"projects-service/internal/auth"
	"projects-service/internal/storage"
	db "projects-service/db/sqlc"
)

// Handlers contains all HTTP handlers
// Stores database and auth dependencies
type Handler struct {
	db			*pgxpool.Pool
	queries 	*db.Queries
	authorizer 	*auth.Authorizer
	minioClient	*minio.Client
}

// NewHandler initializes a new Handler object
// Includes required dependencies
func NewHandler(pool *pgxpool.Pool, queries *db.Queries) (*Handler, error) {
	// Initialize minio client
	minioClient, err := storage.NewMinioClient()
	if err != nil {
		return nil, fmt.Errorf("failed to initialize MinIO client: %w", err)
	} else {
		log.Println("MinIO Client initialized")
	}
	
	return &Handler{ // Initialize handler
		db:			pool,
		queries:    queries,
		authorizer: auth.NewAuthorizer(queries),
		minioClient: minioClient,
	}, nil
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

// generateDownloadURL creates a presigned download URL
func (h *Handler) generateDownloadURL(
	ctx context.Context,
	bucketName string,
	objectName string,
	expiry time.Duration,
) (string, error) {
	url, err := h.minioClient.PresignedGetObject(
		ctx,
		bucketName,
		objectName,
		expiry,
		nil,
	)
	if err != nil {
		log.Println("Error generating presigned download URL", err)
		return "", err
	}

	// Replace internal hostname with external gateway
	externalURL := url.String()
	gatewayURL := os.Getenv("GATEWAY_URL")
	log.Println("gatewayURL for presigned:\t", gatewayURL)
	if gatewayURL != "" {
		externalURL = strings.ReplaceAll(externalURL, "http://minio:9000", gatewayURL)
	}
	
	return externalURL, nil
}

// generateUploadURL creates a presigned upload URL
func (h *Handler) generateUploadURL(
	ctx context.Context,
	bucketName string,
	objectName string,
	expiry time.Duration,
) (string, error) {
	url, err := h.minioClient.PresignedPutObject(
		ctx,
		bucketName,
		objectName,
		expiry,
	)
	if err != nil {
		log.Println("Error generating presigned upload URL")
		return "", err
	}

	// Replace internal hostname with external gateway
	externalURL := url.String()
	log.Println("Generated Upload URL:\t", externalURL)
	gatewayURL := os.Getenv("GATEWAY_URL")
	if gatewayURL != "" {
		externalURL = strings.ReplaceAll(externalURL, "http://minio:9000", gatewayURL)
	}
	
	return externalURL, nil
}


// deleteObject removes a file from MinIO storage
func (h *Handler) deleteObject(
	ctx context.Context,
	bucketName string,
	objectName string,
) error {
	return h.minioClient.RemoveObject(ctx, bucketName, objectName, minio.RemoveObjectOptions{})
}