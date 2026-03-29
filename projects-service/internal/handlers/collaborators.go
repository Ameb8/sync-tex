package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	db "projects-service/db/sqlc"
)

// CreateInvite - POST /projects/v1/projects/:projectID/invites
func (h *Handler) CreateInvite(c *gin.Context) {
	// Parse user ID
	userID, err := h.getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	// Parse project ID
	projectIDStr := c.Param("projectID")
	projectID, err := stringToPgUUID(projectIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project ID"})
		return
	}

	// Only owner can invite
	if ok, err := h.authorizer.IsOwner(c.Request.Context(), projectID, userID); !ok || err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only project owner can invite collaborators"})
		return
	}

	// Expected request payload structure
	var req struct {
		Role string `json:"role" binding:"required,oneof=editor viewer"`
	}

	// Bind json
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id and role (editor|viewer) are required"})
		return
	}

	// Generate invite ID
	inviteID := uuid.New()
	pgInviteID, _ := stringToPgUUID(inviteID.String())

	// Generate invite token
	token, err := h.generateInviteToken() // Generate secure token
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate invite"})
		return
	}

	// Calculate expiration time
	expiresAt := time.Now().Add(30 * 24 * time.Hour)

	// Upload invite to database
	invite, err := h.queries.CreateProjectInvite(c.Request.Context(), db.CreateProjectInviteParams{
		ID:        pgInviteID,
		ProjectID: projectID,
		Token:     token,
		Role:      req.Role,
		CreatedBy: userID,
		ExpiresAt: pgtype.Timestamp{Time: expiresAt, Valid: true},
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create invite"})
		return
	}

	// Generate sharable URL
	shareableURL := fmt.Sprintf("http://192.168.1.34./join?token=%s", token)

	c.JSON(http.StatusCreated, gin.H{
		"invite_id":  invite.ID,
		"token":      token,
		"link":       shareableURL,
		"role":       invite.Role,
		"expires_at": invite.ExpiresAt,
	})
}

// AcceptInvite - POST /projects/v1/invites/accept
func (h *Handler) AcceptInvite(c *gin.Context) {
	// Get user ID
	userID, err := h.getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	// Expected request payload format
	var req struct {
		Token string `json:"token" binding:"required"`
	}

	// Bind json
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "token is required"})
		return
	}

	// Get invite by token
	invite, err := h.queries.GetProjectInviteByToken(c.Request.Context(), req.Token)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Invalid or expired invite"})
		return
	}

	// Check if token expired
	if time.Now().After(invite.ExpiresAt.Time) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invite has expired"})
		return
	}

	// Check if user is already a collaborator on this project
	_, err = h.queries.GetCollaborator(c.Request.Context(), invite.ProjectID, userID)
	if err == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "You are already a collaborator on this project"})
		return
	}

	// Add user as collaborator
	collaborator, err := h.queries.CreateProjectCollaborator(
		c.Request.Context(),
		invite.ProjectID,
		userID,
		invite.Role,
		pgtype.Text{String: invite.CreatedBy, Valid: true},
		pgtype.Timestamp{Time: time.Now(), Valid: true},
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to accept invite"})
		return
	}

	c.JSON(http.StatusOK, collaborator)
}

// ListCollaborators - GET /projects/v1/projects/:projectID/collaborators
func (h *Handler) ListCollaborators(c *gin.Context) {
	userID, err := h.getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	projectIDStr := c.Param("projectID")
	projectID, err := stringToPgUUID(projectIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project ID"})
		return
	}

	// Read permission required
	if ok, err := h.authorizer.CanRead(c.Request.Context(), projectID, userID); !ok || err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	collaborators, err := h.queries.ListProjectCollaborators(c.Request.Context(), projectID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list collaborators"})
		return
	}

	c.JSON(http.StatusOK, collaborators)
}

// RemoveCollaborator - DELETE /projects/v1/projects/:projectID/collaborators/:userID
func (h *Handler) RemoveCollaborator(c *gin.Context) {
	userID, err := h.getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	projectIDStr := c.Param("projectID")
	projectID, err := stringToPgUUID(projectIDStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid project ID"})
		return
	}

	collaboratorUserID := c.Param("userID")

	// Only owner can remove collaborators
	if ok, err := h.authorizer.IsOwner(c.Request.Context(), projectID, userID); !ok || err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only project owner can remove collaborators"})
		return
	}

	// Can't remove yourself
	if collaboratorUserID == userID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot remove yourself"})
		return
	}

	err = h.queries.RemoveProjectCollaborator(c.Request.Context(), projectID, collaboratorUserID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to remove collaborator"})
		return
	}

	c.JSON(http.StatusNoContent, nil)
}

func (h *Handler) generateInviteToken() (string, error) {
	b := make([]byte, 32)
	_, err := rand.Read(b)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// GET /projects/v1/invites/join?token=...
func (h *Handler) JoinViaInvite(c *gin.Context) {
	token := c.Query("token")
	if token == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "token is required"})
		return
	}

	invite, err := h.queries.GetProjectInviteByToken(c.Request.Context(), token)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Invalid or expired invite"})
		return
	}

	if time.Now().After(invite.ExpiresAt.Time) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invite has expired"})
		return
	}

	// Redirect to frontend with token
	c.Redirect(http.StatusFound, fmt.Sprintf("http://100.79.49.102/join?token=%s", token))
}
