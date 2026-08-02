package middleware

import (
	"context"
	"log"
	"net/http"
	"strings"

	"flowchat/backend/internal/supabase"
	"flowchat/backend/internal/utils"

	"github.com/gin-gonic/gin"
)

type contextKey string

const UserIDKey contextKey = "userID"
const BotIDKey contextKey = "botID"

// JWTAuth middleware validates locally-issued HS256 JWT tokens and sets
// the user UUID in the request context. This replaces the previous Supabase
// /auth/v1/user lookup, which rejected our self-signed tokens.
func JWTAuth(jwtSecret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			log.Printf("[auth] JWTAuth: missing Authorization header path=%s", c.Request.URL.Path)
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
			log.Printf("[auth] JWTAuth: empty token path=%s", c.Request.URL.Path)
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token format"})
			c.Abort()
			return
		}
		claims, err := utils.VerifyToken(jwtSecret, token)
		if err != nil {
			log.Printf("[auth] JWTAuth: verify failed path=%s err=%v", c.Request.URL.Path, err)
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid or expired token"})
			c.Abort()
			return
		}
		if claims.UserID == "" {
			log.Printf("[auth] JWTAuth: token has no user_id path=%s", c.Request.URL.Path)
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid token: no user ID"})
			c.Abort()
			return
		}
		c.Set(string(UserIDKey), claims.UserID)
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
