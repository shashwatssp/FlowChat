package handlers

import (
	"net/http"

	"chatflow/backend/internal/supabase"
	"chatflow/backend/internal/utils"

	"github.com/gin-gonic/gin"
)

type AuthHandler struct {
	supabaseClient *supabase.Client
	jwtSecret      string
	supabaseURL    string
}

func NewAuthHandler(client *supabase.Client, jwtSecret, supabaseURL string) *AuthHandler {
	return &AuthHandler{
		supabaseClient: client,
		jwtSecret:      jwtSecret,
		supabaseURL:    supabaseURL,
	}
}

type RegisterRequest struct {
	Email    string                 `form:"email" json:"email" binding:"required,email"`
	Password string                 `form:"password" json:"password" binding:"required,min=6"`
	Data     map[string]interface{} `form:"data" json:"data"`
}

type LoginRequest struct {
	Email    string `form:"email" json:"email" binding:"required,email"`
	Password string `form:"password" json:"password" binding:"required"`
}

type RegisterResponse struct {
	Message string `json:"message"`
	UserID  string `json:"user_id"`
}

type LoginResponse struct {
	Message     string `json:"message"`
	AccessToken string `json:"access_token"`
}

func (h *AuthHandler) Register(c *gin.Context) {
	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if !utils.IsValidEmail(req.Email) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid email address"})
		return
	}

	if len(req.Password) < 6 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Password must be at least 6 characters"})
		return
	}

	// Create user via Supabase Auth
	userID, err := h.supabaseClient.Auth().SignUp(c.Request.Context(), req.Email, req.Password, req.Data)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, RegisterResponse{
		Message: "User registered successfully",
		UserID:  userID,
	})
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Sign in via Supabase Auth
	accessToken, err := h.supabaseClient.Auth().SignIn(c.Request.Context(), req.Email, req.Password)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid credentials"})
		return
	}

	c.JSON(http.StatusOK, LoginResponse{
		Message:     "Login successful",
		AccessToken: accessToken,
	})
}

// OAuth - Placeholder for OAuth flow (Google, GitHub, etc.)
func (h *AuthHandler) OAuth(c *gin.Context) {
	provider := c.Param("provider")

	// Check if the provider is supported
	switch provider {
	case "google", "github", "azure", "discord":
		// Return OAuth URL for the provider
		oauthURL := h.supabaseURL + "/auth/v1/authorize?" +
			"provider=" + provider +
			"&redirect_to=" + c.Query("redirect")

		c.JSON(http.StatusOK, gin.H{
			"url": oauthURL,
		})
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported OAuth provider"})
	}
}
