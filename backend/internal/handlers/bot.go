package handlers

import (
	"net/http"

	"chatflow/backend/internal/qdrant"
	"chatflow/backend/internal/supabase"
	"chatflow/backend/internal/utils"

	"github.com/gin-gonic/gin"
)

type BotHandler struct {
	supabaseClient *supabase.Client
	qdrantClient   *qdrant.Client
}

func NewBotHandler(client *supabase.Client, qdrant *qdrant.Client) *BotHandler {
	return &BotHandler{
		supabaseClient: client,
		qdrantClient:   qdrant,
	}
}

type CreateBotRequest struct {
	Name         string `json:"name" binding:"required"`
	Description  string `json:"description"`
	AvatarURL    string `json:"avatar_url"`
	SystemPrompt string `json:"system_prompt"`
}

type BotResponse struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Description  string `json:"description"`
	Slug         string `json:"slug"`
	AvatarURL    string `json:"avatar_url"`
	SystemPrompt string `json:"system_prompt"`
	APIKey       string `json:"api_key"`
	UsageCount   int64  `json:"usage_count"`
	CreatedAt    string `json:"created_at"`
	UpdatedAt    string `json:"updated_at"`
}

func (h *BotHandler) CreateBot(c *gin.Context) {
	var req CreateBotRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Get user ID from context
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not found in context"})
		return
	}

	// Generate unique slug
	slug := utils.GenerateSlug(req.Name)
	apiKey := utils.GenerateAPIKey()

	// Insert bot into Supabase
	data := map[string]interface{}{
		"name":          req.Name,
		"description":   req.Description,
		"user_id":       userID,
		"slug":          slug,
		"avatar_url":    req.AvatarURL,
		"system_prompt": req.SystemPrompt,
		"api_key":       apiKey,
		"usage_count":   0,
	}

	inserted, err := h.supabaseClient.From("bots").InsertReturning(data)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create bot"})
		return
	}

	// Fallback: fetch by slug if the returned row lacks an id
	botID := getString(inserted, "id")
	createdAt := getString(inserted, "created_at")
	updatedAt := getString(inserted, "updated_at")
	if botID == "" {
		rows, _ := h.supabaseClient.From("bots").
			Select("id,created_at,updated_at").
			Eq("slug", slug).
			Execute(c.Request.Context())
		if len(rows) > 0 {
			botID = getString(rows[0], "id")
			createdAt = getString(rows[0], "created_at")
			updatedAt = getString(rows[0], "updated_at")
		}
	}

	c.JSON(http.StatusOK, BotResponse{
		ID:           botID,
		Name:         req.Name,
		Description:  req.Description,
		Slug:         slug,
		AvatarURL:    req.AvatarURL,
		SystemPrompt: req.SystemPrompt,
		APIKey:       apiKey,
		UsageCount:   0,
		CreatedAt:    createdAt,
		UpdatedAt:    updatedAt,
	})
}

func (h *BotHandler) ListBots(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not found"})
		return
	}

	results, err := h.supabaseClient.From("bots").
		Select("*").
		Eq("user_id", userID.(string)).
		Order("created_at", true).
		Execute(c.Request.Context())

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch bots"})
		return
	}

	var bots []BotResponse
	for _, row := range results {
		bots = append(bots, BotResponse{
			ID:           getString(row, "id"),
			Name:         getString(row, "name"),
			Description:  getString(row, "description"),
			Slug:         getString(row, "slug"),
			AvatarURL:    getString(row, "avatar_url"),
			SystemPrompt: getString(row, "system_prompt"),
			UsageCount:   getInt64(row, "usage_count"),
			CreatedAt:    getString(row, "created_at"),
			UpdatedAt:    getString(row, "updated_at"),
		})
	}

	c.JSON(http.StatusOK, bots)
}

func (h *BotHandler) GetBot(c *gin.Context) {
	botID := c.Param("botID")

	results, err := h.supabaseClient.From("bots").
		Select("*").
		Eq("id", botID).
		Execute(c.Request.Context())

	if err != nil || len(results) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Bot not found"})
		return
	}

	bot := results[0]
	c.JSON(http.StatusOK, BotResponse{
		ID:           getString(bot, "id"),
		Name:         getString(bot, "name"),
		Description:  getString(bot, "description"),
		Slug:         getString(bot, "slug"),
		AvatarURL:    getString(bot, "avatar_url"),
		SystemPrompt: getString(bot, "system_prompt"),
		UsageCount:   getInt64(bot, "usage_count"),
		CreatedAt:    getString(bot, "created_at"),
		UpdatedAt:    getString(bot, "updated_at"),
	})
}

func (h *BotHandler) UpdateBot(c *gin.Context) {
	botID := c.Param("botID")
	var req CreateBotRequest

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	data := map[string]interface{}{
		"name":          req.Name,
		"description":   req.Description,
		"avatar_url":    req.AvatarURL,
		"system_prompt": req.SystemPrompt,
	}

	qb, err := h.supabaseClient.From("bots").Update(data)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update bot"})
		return
	}
	_, err = qb.Eq("id", botID).Execute(c.Request.Context())

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update bot"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Bot updated successfully"})
}

func (h *BotHandler) DeleteBot(c *gin.Context) {
	botID := c.Param("botID")

	qb, err := h.supabaseClient.From("bots").Delete()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete bot"})
		return
	}
	_, err = qb.Eq("id", botID).Execute(c.Request.Context())

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete bot"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Bot deleted successfully"})
}

func (h *BotHandler) GetBotStats(c *gin.Context) {
	botID := c.Param("botID")

	// Get total conversations
	conversations, _ := h.supabaseClient.From("conversations").
		Select("id").
		Eq("bot_id", botID).
		Execute(c.Request.Context())

	// Get total messages
	messages, _ := h.supabaseClient.From("messages").
		Select("id").
		Eq("bot_id", botID).
		Execute(c.Request.Context())

	// Get knowledge sources count
	sources, _ := h.supabaseClient.From("knowledge_sources").
		Select("id").
		Eq("bot_id", botID).
		Execute(c.Request.Context())

	c.JSON(http.StatusOK, gin.H{
		"total_conversations": len(conversations),
		"total_messages":      len(messages),
		"knowledge_sources":   len(sources),
	})
}

// GetPublicBot returns public-facing bot info (no auth, no api_key) for the
// shareable chat link / embedded widget.
func (h *BotHandler) GetPublicBot(c *gin.Context) {
	slug := c.Param("slug")

	results, err := h.supabaseClient.From("bots").
		Select("id,name,description,slug,avatar_url,usage_count,created_at").
		Eq("slug", slug).
		Execute(c.Request.Context())

	if err != nil || len(results) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Bot not found"})
		return
	}

	bot := results[0]
	c.JSON(http.StatusOK, gin.H{
		"id":          getString(bot, "id"),
		"name":        getString(bot, "name"),
		"description": getString(bot, "description"),
		"slug":        getString(bot, "slug"),
		"avatar_url":  getString(bot, "avatar_url"),
		"usage_count": getInt64(bot, "usage_count"),
		"created_at":  getString(bot, "created_at"),
	})
}

// WidgetHandler serves the embeddable widget JavaScript
func WidgetHandler(c *gin.Context) {
	botID := c.Param("botID")
	widgetJS := `
(function() {
  var script = document.createElement('script');
  script.src = 'https://cdn.chatflow.app/widget-v1.js';
  script.onload = function() {
    if (window.ChatFlowWidget) {
      window.ChatFlowWidget.init({
        botId: '` + botID + `',
        containerId: 'chatflow-widget'
      });
    }
  };
  document.head.appendChild(script);
})();`

	c.Header("Content-Type", "application/javascript")
	c.String(http.StatusOK, widgetJS)
}

// Helper functions
func getString(m map[string]interface{}, key string) string {
	if val, ok := m[key]; ok {
		if s, ok := val.(string); ok {
			return s
		}
	}
	return ""
}

func getInt64(m map[string]interface{}, key string) int64 {
	if val, ok := m[key]; ok {
		switch v := val.(type) {
		case float64:
			return int64(v)
		case int64:
			return v
		case int:
			return int64(v)
		}
	}
	return 0
}
