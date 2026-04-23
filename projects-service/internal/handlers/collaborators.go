package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	db "projects-service/db/sqlc"
	"projects-service/internal/auth"
	"projects-service/internal/users"
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
	shareableURL := fmt.Sprintf("%s/join?token=%s", h.externalURL, token)

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

type CollaboratorResponse struct {
	ProjectID  string `json:"project_id"`
	UserID     string `json:"user_id"`
	Role       string `json:"role"`
	InvitedBy  string `json:"invited_by"`
	InvitedAt  string `json:"invited_at"`
	Email      string `json:"email"`
	Name       string `json:"name"`
	ProfilePic string `json:"profile_pic"`
}

// ListCollaborators - GET /projects/v1/projects/:projectID/collaborators
func (h *Handler) ListCollaborators(c *gin.Context) {
	// Get client's user ID
	userID, err := h.getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	// Get project ID
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

	// Query project collabortors from database
	collaborators, err := h.queries.ListProjectCollaborators(c.Request.Context(), projectID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list collaborators"})
		return
	}

	// Collect all unique user IDs (collaborators + inviters)
	idSet := make(map[string]struct{})
	for _, col := range collaborators {
		idSet[col.UserID] = struct{}{}

		if col.InvitedBy.Valid {
			idSet[col.InvitedBy.String] = struct{}{}
		}
	}
	ids := make([]string, 0, len(idSet))
	for id := range idSet {
		ids = append(ids, id)
	}

	log.Printf("DEBUG: collected %d unique IDs", len(ids))
	log.Printf("DEBUG: IDs: %+v", ids)

	// Fetch user data — degrade gracefully if users-service is down
	userMap, err := h.usersClient.GetUsers(c.Request.Context(), ids)
	if err != nil {
		log.Printf("warn: could not fetch user data for collaborators: %v", err)
		userMap = map[string]users.User{} // empty map, fields will be blank
	}

	// Build enriched response
	response := make([]CollaboratorResponse, 0, len(collaborators))
	for _, col := range collaborators {
		u := userMap[col.UserID]
		response = append(response, CollaboratorResponse{
			ProjectID:  pgUUIDToString(col.ProjectID),
			UserID:     col.UserID,
			Role:       string(col.Role),
			InvitedBy:  col.InvitedBy.String,
			InvitedAt:  col.InvitedAt.Time.Format(time.RFC3339),
			Email:      u.Email,
			Name:       u.Name,
			ProfilePic: u.ProfilePic,
		})
	}

	c.JSON(http.StatusOK, response)
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

// GetRole handles:
// GET /projects/v1/access
//
// Returns:
// 200 { allowed: true, user_id: "...", role: "owner"|"editor"|"viewer" }
// 403 { allowed: false }
func (h *Handler) GetRole(c *gin.Context) {
	ctx := c.Request.Context()

	// Get projectId from query
	projectIDStr := c.Query("projectId")
	if projectIDStr == "" {
		c.JSON(400, gin.H{"error": "projectId is required"})
		return
	}

	// Convert project ID to UUID
	var projectID pgtype.UUID
	if err := projectID.Scan(projectIDStr); err != nil {
		c.JSON(400, gin.H{"error": "invalid projectId"})
		return
	}

	// Extract userID from JWT
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(401, gin.H{"error": "unauthorized"})
		return
	}

	// Get user ID
	userIDStr, ok := userID.(string)
	if !ok {
		c.JSON(500, gin.H{"error": "invalid userID type"})
		return
	}

	// Get permission level
	perm, err := h.authorizer.GetUserPermission(ctx, projectID, userIDStr)
	if err != nil {
		c.JSON(500, gin.H{"error": "failed to check permissions"})
		return
	}

	// Return 403 if no access
	if perm == auth.PermissionNone {
		c.JSON(403, gin.H{
			"allowed": false,
		})
		return
	}

	// Success response
	c.JSON(200, gin.H{
		"allowed": true,
		"user_id": userIDStr,
		"role":    perm,
	})
}
