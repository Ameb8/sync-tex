package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	db "projects-service/db/sqlc"
	"projects-service/internal/auth"
)

type collaboratorTestDB struct {
	project      db.Project
	invites      []db.ProjectInvite
	deleted      int64
	lastQuery    string
	lastExec     string
	lastExecArgs []interface{}
}

func (f *collaboratorTestDB) Exec(_ context.Context, sql string, args ...interface{}) (pgconn.CommandTag, error) {
	f.lastExec = sql
	f.lastExecArgs = args
	return pgconn.NewCommandTag(fmt.Sprintf("DELETE %d", f.deleted)), nil
}

func (f *collaboratorTestDB) Query(_ context.Context, sql string, _ ...interface{}) (pgx.Rows, error) {
	f.lastQuery = sql
	return &inviteRows{invites: f.invites}, nil
}

func (f *collaboratorTestDB) QueryRow(_ context.Context, sql string, _ ...interface{}) pgx.Row {
	if strings.Contains(sql, "FROM projects") {
		return projectRow{project: f.project}
	}
	return errorRow{err: pgx.ErrNoRows}
}

type projectRow struct {
	project db.Project
}

func (r projectRow) Scan(dest ...interface{}) error {
	*dest[0].(*pgtype.UUID) = r.project.ID
	*dest[1].(*string) = r.project.OwnerID
	*dest[2].(*pgtype.Text) = r.project.Name
	*dest[3].(*pgtype.Timestamp) = r.project.CreatedAt
	return nil
}

type errorRow struct {
	err error
}

func (r errorRow) Scan(_ ...interface{}) error {
	return r.err
}

type inviteRows struct {
	invites []db.ProjectInvite
	index   int
}

func (r *inviteRows) Close()                                       {}
func (r *inviteRows) Err() error                                   { return nil }
func (r *inviteRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r *inviteRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (r *inviteRows) Values() ([]interface{}, error)               { return nil, nil }
func (r *inviteRows) RawValues() [][]byte                          { return nil }
func (r *inviteRows) Conn() *pgx.Conn                              { return nil }

func (r *inviteRows) Next() bool {
	if r.index >= len(r.invites) {
		return false
	}
	r.index++
	return true
}

func (r *inviteRows) Scan(dest ...interface{}) error {
	invite := r.invites[r.index-1]
	*dest[0].(*pgtype.UUID) = invite.ID
	*dest[1].(*pgtype.UUID) = invite.ProjectID
	*dest[2].(*string) = invite.Token
	*dest[3].(*string) = invite.Role
	*dest[4].(*string) = invite.CreatedBy
	*dest[5].(*pgtype.Timestamp) = invite.CreatedAt
	*dest[6].(*pgtype.Timestamp) = invite.ExpiresAt
	return nil
}

func newCollaboratorTestHandler(fakeDB *collaboratorTestDB) *Handler {
	queries := db.New(fakeDB)
	return &Handler{
		queries:     queries,
		authorizer:  auth.NewAuthorizer(queries),
		externalURL: "https://sync-tex.com/",
	}
}

func authenticatedRouter(userID string) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("user_id", userID)
		c.Next()
	})
	return router
}

func TestListInviteLinksReturnsPersistedActiveLinks(t *testing.T) {
	projectID, _ := stringToPgUUID("7f202d80-2240-48c0-af41-ad8ba00143a1")
	inviteID, _ := stringToPgUUID("a838a51a-c528-450b-80fe-134aa3759493")
	createdAt := time.Date(2026, time.September, 17, 10, 0, 0, 0, time.UTC)
	expiresAt := createdAt.Add(30 * 24 * time.Hour)
	fakeDB := &collaboratorTestDB{
		project: db.Project{ID: projectID, OwnerID: "owner"},
		invites: []db.ProjectInvite{{
			ID:        inviteID,
			ProjectID: projectID,
			Token:     "invite-token",
			Role:      "viewer",
			CreatedBy: "owner",
			CreatedAt: pgtype.Timestamp{Time: createdAt, Valid: true},
			ExpiresAt: pgtype.Timestamp{Time: expiresAt, Valid: true},
		}},
	}
	handler := newCollaboratorTestHandler(fakeDB)
	router := authenticatedRouter("owner")
	router.GET("/projects/v1/projects/:projectID/collaborators/links", handler.ListInviteLinks)

	request := httptest.NewRequest(http.MethodGet, "/projects/v1/projects/7f202d80-2240-48c0-af41-ad8ba00143a1/collaborators/links", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", response.Code, response.Body.String())
	}
	var body struct {
		Links []InviteLinkResponse `json:"links"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(body.Links) != 1 {
		t.Fatalf("expected one link, got %d", len(body.Links))
	}
	link := body.Links[0]
	if link.InviteID != "a838a51a-c528-450b-80fe-134aa3759493" {
		t.Errorf("unexpected invite ID %q", link.InviteID)
	}
	if link.Link != "https://sync-tex.com/join?token=invite-token" {
		t.Errorf("unexpected share link %q", link.Link)
	}
	if !strings.Contains(fakeDB.lastQuery, "expires_at > NOW()") {
		t.Errorf("active-link query does not filter expired invites: %s", fakeDB.lastQuery)
	}
}

func TestListInviteLinksRejectsNonOwner(t *testing.T) {
	projectID, _ := stringToPgUUID("7f202d80-2240-48c0-af41-ad8ba00143a1")
	fakeDB := &collaboratorTestDB{
		project: db.Project{ID: projectID, OwnerID: "owner"},
	}
	handler := newCollaboratorTestHandler(fakeDB)
	router := authenticatedRouter("collaborator")
	router.GET("/projects/v1/projects/:projectID/collaborators/links", handler.ListInviteLinks)

	request := httptest.NewRequest(http.MethodGet, "/projects/v1/projects/7f202d80-2240-48c0-af41-ad8ba00143a1/collaborators/links", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusForbidden {
		t.Fatalf("expected status 403, got %d: %s", response.Code, response.Body.String())
	}
	if fakeDB.lastQuery != "" {
		t.Error("invite links were queried for a non-owner")
	}
}

func TestRevokeInviteLinkDeletesInviteWithinProject(t *testing.T) {
	projectID, _ := stringToPgUUID("7f202d80-2240-48c0-af41-ad8ba00143a1")
	fakeDB := &collaboratorTestDB{
		project: db.Project{ID: projectID, OwnerID: "owner"},
		deleted: 1,
	}
	handler := newCollaboratorTestHandler(fakeDB)
	router := authenticatedRouter("owner")
	router.DELETE("/projects/v1/projects/:projectID/collaborators/links/:inviteID", handler.RevokeInviteLink)

	request := httptest.NewRequest(http.MethodDelete, "/projects/v1/projects/7f202d80-2240-48c0-af41-ad8ba00143a1/collaborators/links/a838a51a-c528-450b-80fe-134aa3759493", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("expected status 204, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(fakeDB.lastExec, "project_id = $1 AND id = $2") {
		t.Errorf("revoke query is not scoped to the project: %s", fakeDB.lastExec)
	}
	if len(fakeDB.lastExecArgs) != 2 {
		t.Fatalf("expected project and invite IDs, got %d arguments", len(fakeDB.lastExecArgs))
	}
}

func TestRevokeInviteLinkReturnsNotFound(t *testing.T) {
	projectID, _ := stringToPgUUID("7f202d80-2240-48c0-af41-ad8ba00143a1")
	fakeDB := &collaboratorTestDB{
		project: db.Project{ID: projectID, OwnerID: "owner"},
		deleted: 0,
	}
	handler := newCollaboratorTestHandler(fakeDB)
	router := authenticatedRouter("owner")
	router.DELETE("/projects/v1/projects/:projectID/collaborators/links/:inviteID", handler.RevokeInviteLink)

	request := httptest.NewRequest(http.MethodDelete, "/projects/v1/projects/7f202d80-2240-48c0-af41-ad8ba00143a1/collaborators/links/a838a51a-c528-450b-80fe-134aa3759493", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusNotFound {
		t.Fatalf("expected status 404, got %d: %s", response.Code, response.Body.String())
	}
}
