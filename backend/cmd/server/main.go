package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"flowchat/backend/internal/config"
	"flowchat/backend/internal/handlers"
	"flowchat/backend/internal/middleware"
	"flowchat/backend/internal/qdrant"
	"flowchat/backend/internal/supabase"
	"flowchat/backend/internal/utils"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func loadEnvFile(envPath string) {
	data, err := os.ReadFile(envPath)
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if idx := strings.Index(line, "="); idx > 0 {
			key := strings.TrimSpace(line[:idx])
			val := strings.TrimSpace(line[idx+1:])
			if os.Getenv(key) == "" {
				os.Setenv(key, val)
			}
		}
	}
}

func main() {
	// Load environment variables from .env alongside this module
	dotEnvPath := filepath.Join(".env")
	loadEnvFile(dotEnvPath)
	if absPath, absErr := filepath.Abs(dotEnvPath); absErr == nil {
		loadEnvFile(absPath)
	}
	if err := godotenv.Load(dotEnvPath); err != nil {
		log.Println("Warning: .env file not found")
	}

	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// Initialize services
	supabaseClient, err := supabase.NewClient(cfg.SupabaseURL, cfg.SupabaseKey, supabase.WithServiceKey(cfg.SupabaseServiceKey))
	if err != nil {
		log.Fatalf("Failed to initialize Supabase client: %v", err)
	}

	qdrantClient, err := qdrant.NewClient(cfg.QdrantURL, cfg.QdrantAPIKey)
	if err != nil {
		log.Fatalf("Failed to initialize Qdrant client: %v", err)
	}

	// Initialize Qdrant collections
	if err := qdrantClient.InitializeCollections(); err != nil {
		log.Printf("Warning: Failed to initialize Qdrant collections (continuing in degraded mode, vector search disabled): %v", err)
	}

	// Setup router
	router := gin.New()
	router.Use(gin.Recovery())
	router.Use(gin.Logger())

	// CORS configuration
	router.Use(cors.New(cors.Config{
		AllowOrigins:     strings.Split(cfg.AllowedOrigins, ","),
		AllowMethods:     []string{"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"},
		AllowHeaders:     []string{"Origin", "Content-Length", "Content-Type", "Authorization"},
		AllowCredentials: true,
		ExposeHeaders:    []string{"Content-Length"},
	}))

	// Health check
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":  "ok",
			"service": "FlowChat API",
			"version": "1.0.0",
		})
	})

	// Initialize handlers
	authHandler := handlers.NewAuthHandler(supabaseClient, cfg.JWTSecret, cfg.SupabaseURL)
	botHandler := handlers.NewBotHandler(supabaseClient, qdrantClient)
	cohereClient := utils.NewCohereClient(cfg.CohereAPIKey, cfg.CohereBaseURL).WithModel(cfg.CohereEmbeddingModel)
	knowledgeHandler := handlers.NewKnowledgeHandler(supabaseClient, qdrantClient, cfg.OpenRouterAPIKey, cfg.ChunkSize, cfg.ChunkOverlap, cfg.QuestionModel, cfg.VisionModel, cfg.OpenRouterBaseURL, cfg.EmbeddingModel, cfg.QdrantEmbeddingModel, cohereClient, cfg.FirecrawlAPIKey)
	// Google Calendar integration
	calendarHandler := handlers.NewCalendarHandler(supabaseClient, cfg.GoogleCalendarClientID, cfg.GoogleCalendarClientSecret, cfg.GoogleCalendarRedirectURL, cfg.GoogleCalendarScopes)
	appointmentHandler := handlers.NewAppointmentHandler(supabaseClient)
	chatHandler := handlers.NewChatHandler(supabaseClient, qdrantClient, cfg.OpenRouterAPIKey, cfg.OpenRouterBaseURL, cfg.ChatModel, cfg.EmbeddingModel, cfg.QdrantEmbeddingModel, cohereClient, appointmentHandler)

	// Google Calendar OAuth routes (public — callback URL matches .env)
	router.GET("/auth/google/calendar/connect", calendarHandler.Connect)
	router.GET("/auth/google/calendar/callback", calendarHandler.Callback)

	// Routes
	api := router.Group("/api/v1")
	{
		// Auth routes (public)
		auth := api.Group("/auth")
		{
			auth.POST("/register", authHandler.Register)
			auth.POST("/login", authHandler.Login)
			auth.POST("/oauth/:provider", authHandler.OAuth)
		}

		// Chat endpoint (public - accessible via the bot slug link, no auth required)
		chat := api.Group("/chat")
		{
			chat.POST("/:botSlug", chatHandler.Chat)
		}

		// Public bot lookup (no auth) - used by shareable chat links & the widget
		api.GET("/bots/public/:slug", botHandler.GetPublicBot)

		// Public booking routes — customers can check availability and book
		// appointments without authentication (link-based access).
		botsPublic := api.Group("/bots")
		{
			botsPublic.GET("/:botID/availability", appointmentHandler.GetAvailability)
			botsPublic.POST("/:botID/availability/check", appointmentHandler.CheckAvailability)
			botsPublic.POST("/:botID/appointments", appointmentHandler.BookAppointment)
		}

		// Protected routes
		protected := api.Group("")
		protected.Use(middleware.JWTAuth(cfg.JWTSecret))
		{
			// Bot management
			bots := protected.Group("/bots")
			{
				bots.POST("", botHandler.CreateBot)
				bots.GET("", botHandler.ListBots)
				bots.GET("/:botID", botHandler.GetBot)
				bots.PUT("/:botID", botHandler.UpdateBot)
				bots.DELETE("/:botID", botHandler.DeleteBot)
				bots.GET("/:botID/stats", botHandler.GetBotStats)

			// Calendar appointment management
			bots.GET("/:botID/settings/calendar", appointmentHandler.GetCalendarSettings)
			bots.PUT("/:botID/settings/calendar", appointmentHandler.UpdateCalendarSettings)
			// Backwards-compatible alias for the bare settings path
			bots.GET("/:botID/settings", appointmentHandler.GetCalendarSettings)
			bots.PUT("/:botID/settings", appointmentHandler.UpdateCalendarSettings)
			bots.GET("/:botID/appointments", appointmentHandler.ListAppointments)
			bots.DELETE("/:botID/appointments/:appointmentID", appointmentHandler.CancelAppointment)
			}

// Knowledge management
knowledge := protected.Group("/knowledge")
					{
					knowledge.POST("/upload", knowledgeHandler.UploadFile)
					knowledge.POST("/scrape", knowledgeHandler.ScrapeWebsite)
					knowledge.POST("/refine", knowledgeHandler.RefineVoice)
					knowledge.POST("/suggest-questions", knowledgeHandler.SuggestQuestions)
knowledge.POST("/qa", knowledgeHandler.SaveQA)
					knowledge.POST("/save-text", knowledgeHandler.SaveText)
					knowledge.POST("/:sourceID/reindex", knowledgeHandler.ReindexSource)
					knowledge.GET("/:botID", knowledgeHandler.ListSources)
					knowledge.DELETE("/:sourceID", knowledgeHandler.DeleteSource)
				}

			// Conversations
			conversations := protected.Group("/conversations")
			{
				conversations.GET("/:id", knowledgeHandler.ListConversations)
				conversations.GET("/:id/messages", knowledgeHandler.GetConversation)
				conversations.POST("/:id/feedback", knowledgeHandler.SaveFeedback)
			}
		}

		// Widget route (public)
		api.GET("/widget/:botID", handlers.WidgetHandler)
	}

	// Start server
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Starting FlowChat API server on port %s", port)
	if err := router.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

// init does any required initialization
func init() {
	// Ensure we have a JWT secret
	if os.Getenv("JWT_SECRET") == "" {
		log.Println("Warning: JWT_SECRET not set, using default (not secure for production)")
	}
}
