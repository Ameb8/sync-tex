package routes

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"projects-service/internal/handlers"
	"projects-service/internal/middleware"
)

func TestSetupRoutesRegistersInviteLinkEndpoints(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	SetupRoutes(router, &handlers.Handler{}, middleware.NewAuthMiddleware("test-secret"))

	wanted := map[string]bool{
		"GET /projects/v1/projects/:projectID/files/:fileID/download":           false,
		"GET /projects/v1/projects/:projectID/collaborators/links":              false,
		"DELETE /projects/v1/projects/:projectID/collaborators/links/:inviteID": false,
	}
	for _, route := range router.Routes() {
		key := route.Method + " " + route.Path
		if _, ok := wanted[key]; ok {
			wanted[key] = true
		}
	}
	for route, found := range wanted {
		if !found {
			t.Errorf("route not registered: %s", route)
		}
	}
}

func TestDownloadRouteRejectsUnauthenticatedRequests(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	SetupRoutes(router, &handlers.Handler{}, middleware.NewAuthMiddleware("test-secret"))

	request := httptest.NewRequest(http.MethodGet,
		"/projects/v1/projects/7f202d80-2240-48c0-af41-ad8ba00143a1/files/a838a51a-c528-450b-80fe-134aa3759493/download", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status: %d", response.Code)
	}
}
