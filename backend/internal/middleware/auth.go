package middleware

import (
	"context"
	"net/http"
	"strings"

	"chatflow/backend/internal/supabase"

"github.com/gin-gonic/gin"
)

type contextKey string

const UserIDKey contextKey = "userID"
const BotIDKey contextKey = "botID"

// JWTAuth middleware validates JWT tokens via Supabase /auth/v1/user
// and sets the real user UUID in the request context.
func JWTAuth(jwtSecret string, supabaseClient *supabase.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Authorization header required"})
			c.Abort()
			return
		}
		var token string
		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) == 2 && strings.ToLower(parts[0]) == "bearer" {
			token = parts[1]
		} else {
			token = authHeader
		}
		if token == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token format"})
			c.Abort()
			return
		}
		user, err := supabaseClient.GetUser(c.Request.Context(), token)
		if err != nil || user["id"] == nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired token"})
			c.Abort()
			return
		}
		userID, ok := user["id"].(string)
		if !ok || userID == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token: no user ID"})
			c.Abort()
			return
		}
		c.Set(string(UserIDKey), userID)
		c.Next()
	}
}

// APIKeyMiddleware validates bot API keys for public widget access.
func APIKeyMiddleware(supabaseClient *supabase.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		apiKey := c.GetHeader("X-API-Key")
		if apiKey == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "X-API-Key header required"})
			c.Abort()
			return
		}
		botID, err := validateAPIKey(c.Request.Context(), supabaseClient, apiKey)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid API key"})
			c.Abort()
			return
		}
		c.Set(string(BotIDKey), botID)
		c.Next()
	}
}

func validateAPIKey(ctx context.Context, client *supabase.Client, apiKey string) (string, error) {
	results, err := client.From("bots").
		Select("id").
		Eq("api_key", apiKey).
		Execute(ctx)
	if err != nil {
		return "", err
	}
	if len(results) == 0 {
		return "", nil
	}
	botID, ok := results[0]["id"].(string)
	if !ok {
		return "", nil
	}
	return botID, nil
}
