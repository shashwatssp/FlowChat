package handlers

import (
	"log"
	"net/http"

	"flowchat/backend/internal/supabase"
	"flowchat/backend/internal/utils"

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

	// Local-auth path: hash password with bcrypt, create the user through
	// Supabase GoTrue (admin API creates a confirmed auth.users row which
	// satisfies the users.id FK via the on_auth_user_created trigger), then
	// store the bcrypt hash in the users profile row.
	passwordHash, err := utils.HashPassword(req.Password)
	if err != nil {
		log.Printf("[auth] Register: bcrypt hash failed email=%s err=%v", req.Email, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to hash password"})
		return
	}

	// Step 1: Create the user in auth.users via GoTrue admin API.
	// This sets email_confirm=true (no confirmation email sent) and the
	// trigger auto-creates a matching row in the users table.
	signupData := map[string]interface{}{}
	if req.Data != nil {
		signupData = req.Data
	}
	userID, err := h.supabaseClient.Auth().SignUp(c.Request.Context(), req.Email, req.Password, signupData)
	if err != nil {
		log.Printf("[auth] Register: GoTrue signup failed email=%s err=%v", req.Email, err)
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	log.Printf("[auth] Register: GoTrue user created id=%s email=%s", userID, req.Email)

	// Step 2: Store bcrypt password_hash in the users profile row.
	// Try Update first (row was created by trigger); fall back to InsertReturning
	// in case the trigger is disabled or didn't fire. The service_role key
	// bypasses RLS on both operations.
	updateQB, updateErr := h.supabaseClient.From("users").Select("*").Update(map[string]interface{}{
		"password_hash": passwordHash,
		"email":         req.Email,
	})
	if updateErr != nil {
		log.Printf("[auth] Register: Update builder error id=%s err=%v; trying INSERT", userID, updateErr)
	} else {
		if _, updateExecErr := updateQB.Eq("id", userID).Execute(c.Request.Context()); updateExecErr != nil {
			log.Printf("[auth] Register: UPDATE password_hash failed id=%s err=%v; trying INSERT", userID, updateExecErr)
		} else {
			log.Printf("[auth] Register: password_hash stored id=%s", userID)
			log.Printf("[auth] Register: success email=%s user_id=%s", req.Email, userID)
			c.JSON(http.StatusOK, RegisterResponse{
				Message: "User registered successfully",
				UserID:  userID,
			})
			return
		}
	}

	// Fallback: INSERT a new users row with the GoTrue-provided id.
	insertData := map[string]interface{}{
		"id":            userID,
		"email":         req.Email,
		"password_hash": passwordHash,
	}
	if req.Data != nil {
		if fullName, ok := req.Data["full_name"]; ok {
			insertData["full_name"] = fullName
		}
		if avatar, ok := req.Data["avatar_url"]; ok {
			insertData["avatar_url"] = avatar
		}
	}
	if _, insertErr := h.supabaseClient.From("users").InsertReturning(insertData); insertErr != nil {
		log.Printf("[auth] Register: INSERT password_hash also failed id=%s err=%v", userID, insertErr)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Account created but password hash could not be stored"})
		return
	}
	log.Printf("[auth] Register: success email=%s user_id=%s", req.Email, userID)
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

	// Local-auth path: fetch the user row by email (service-role, bypasses RLS),
	// verify the bcrypt password hash, then issue a self-signed HS256 JWT.
	rows, err := h.supabaseClient.From("users").
		Select("id,email,full_name,password_hash").
		Eq("email", req.Email).
		Execute(c.Request.Context())
	if err != nil {
		log.Printf("[auth] Login: query failed email=%s err=%v", req.Email, err)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid credentials"})
		return
	}
	if len(rows) == 0 {
		log.Printf("[auth] Login: user not found email=%s", req.Email)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid credentials"})
		return
	}

	user := rows[0]
	passwordHash, _ := user["password_hash"].(string)
	if passwordHash == "" {
		log.Printf("[auth] Login: no password hash stored email=%s", req.Email)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid credentials"})
		return
	}

	if err := utils.VerifyPassword(passwordHash, req.Password); err != nil {
		log.Printf("[auth] Login: password mismatch email=%s", req.Email)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid credentials"})
		return
	}

	// Issue a local JWT
	userID, _ := user["id"].(string)
	token, err := utils.GenerateToken(h.jwtSecret, userID, req.Email)
	if err != nil {
		log.Printf("[auth] Login: token generation failed email=%s err=%v", req.Email, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

	log.Printf("[auth] Login: success email=%s user_id=%s", req.Email, userID)
	c.JSON(http.StatusOK, LoginResponse{
		Message:     "Login successful",
		AccessToken: token,
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
