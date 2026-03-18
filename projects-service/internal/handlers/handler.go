package handlers

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	
	"projects-service/internal/auth"
	db "projects-service/db/sqlc"
)

// Handlers contains all HTTP handlers
// Stores database and auth dependencies
type Handler struct {
	queries *db.Queries
	authorizer *auth.Authorizer
}

// NewHandler initializes a new Handler object
// Includes required dependencies
func NewHandler(queries *db.Queries) *Handler {
	return &Handler{
		queries:    queries,
		authorizer: auth.NewAuthorizer(queries),
	}
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
//
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
