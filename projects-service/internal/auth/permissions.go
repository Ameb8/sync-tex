package auth

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"
	db "projects-service/db/sqlc"
)

// PermissionLevel defines the access control levels
type PermissionLevel string

const (
	PermissionNone   PermissionLevel = "none"
	PermissionViewer PermissionLevel = "viewer"
	PermissionEditor PermissionLevel = "editor"
	PermissionOwner  PermissionLevel = "owner"
)

// Authorizer handles all permission checks
type Authorizer struct {
	queries *db.Queries
}

// NewAuthorizer creates a new authorization checker
func NewAuthorizer(queries *db.Queries) *Authorizer {
	return &Authorizer{queries: queries}
}

// GetUserPermission returns the highest permission level a user has for a project
func (a *Authorizer) GetUserPermission(
	ctx context.Context,
	projectID pgtype.UUID,
	userID string,
) (PermissionLevel, error) {
	// Check if user is owner
	project, err := a.queries.GetProject(ctx, projectID)
	if err != nil {
		return PermissionNone, err
	}

	if project.OwnerID == userID {
		return PermissionOwner, nil
	}

	// Check if user is collaborator
	collab, err := a.queries.GetCollaborator(ctx, projectID, userID)

	// Acceess denied
	if err != nil {
		return PermissionNone, nil
	}

	switch collab.Role {
	case "editor":
		return PermissionEditor, nil
	case "viewer":
		return PermissionViewer, nil
	default:
		return PermissionNone, nil
	}
}

// CanRead checks if user has read access (viewer or editor or owner)
func (a *Authorizer) CanRead(
	ctx context.Context,
	projectID pgtype.UUID,
	userID string,
) (bool, error) {
	perm, err := a.GetUserPermission(ctx, projectID, userID)
	if err != nil {
		return false, err
	}
	return perm != PermissionNone, nil
}

// CanWrite checks if user has write access (editor or owner)
func (a *Authorizer) CanWrite(
	ctx context.Context,
	projectID pgtype.UUID,
	userID string,
) (bool, error) {
	perm, err := a.GetUserPermission(ctx, projectID, userID)
	if err != nil {
		return false, err
	}
	return perm == PermissionEditor || perm == PermissionOwner, nil
}

// IsOwner checks if user is the owner
func (a *Authorizer) IsOwner(
	ctx context.Context,
	projectID pgtype.UUID,
	userID string,
) (bool, error) {
	perm, err := a.GetUserPermission(ctx, projectID, userID)
	if err != nil {
		return false, err
	}
	return perm == PermissionOwner, nil
}

// CheckPermission is a generic permission checker that returns error on denial
// Useful for middleware-style checks
func (a *Authorizer) CheckPermission(
	ctx context.Context,
	projectID pgtype.UUID,
	userID string,
	required PermissionLevel,
) error {
	perm, err := a.GetUserPermission(ctx, projectID, userID)
	if err != nil {
		return fmt.Errorf("permission check failed: %w", err)
	}

	// Permission hierarchy: none < viewer < editor < owner
	if !a.hasPermission(perm, required) {
		return fmt.Errorf("insufficient permissions: required %s, got %s", required, perm)
	}

	return nil
}

// hasPermission checks if userPerm meets the required level
func (a *Authorizer) hasPermission(userPerm, required PermissionLevel) bool {
	hierarchy := map[PermissionLevel]int{
		PermissionNone:   0,
		PermissionViewer: 1,
		PermissionEditor: 2,
		PermissionOwner:  3,
	}
	return hierarchy[userPerm] >= hierarchy[required]
}