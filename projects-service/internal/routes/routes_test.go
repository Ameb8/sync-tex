package routes

import (
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
