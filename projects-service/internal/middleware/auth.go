package middleware

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

// AuthMiddleware store JWT secret used for authorization
type AuthMiddleware struct {
	jwtSecret string
}

// NewAuthMiddleware initializes midddleware with provided JWT secret
func NewAuthMiddleware(jwtSecret string) *AuthMiddleware {
	return &AuthMiddleware{jwtSecret: jwtSecret}
}


// ValidateJWT returns a Gin middleware handler function.
// This middleware:
//	- Extracts the JWT from the Authorization header
//	- Validates its format and signature
//	- Extracts claims (specifically user_id)
//	- Stores user_id in the request context for downstream handlers
func (m *AuthMiddleware) ValidateJWT() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Get auth header from test
		authHeader := c.GetHeader("Authorization")
		
		// Reject if auth header not present
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "No authorization header"})
			c.Abort()
			return
		}

		// Validate "Bearer <token>" header format
		parts := strings.Split(authHeader, " ")
		if len(parts) != 2 || parts[0] != "Bearer" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid authorization header format"})
			c.Abort()
			return
		}


		tokenString := parts[1] // Extract token string

		// Parse and validate JWT token
		token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
			// Ensure token uses HMAC signing method
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
			}

			return []byte(m.jwtSecret), nil // Return secret key
		})

		// If token invalid or parsing failure reject
		if err != nil || !token.Valid {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token"})
			c.Abort()
			return
		}

		// Extract user_id from claims
		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token claims"})
			c.Abort()
			return
		}

		// Validate user_id's existence
		userID, ok := claims["user_id"].(string)
		if !ok || userID == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Missing user_id in token"})
			c.Abort()
			return
		}

		// Store user_id in Gin context
		c.Set("user_id", userID)
		c.Next()
	}
}