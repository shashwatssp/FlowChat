package config

import (
	"fmt"
	"log"
	"os"
	"strconv"
)

type Config struct {
	SupabaseURL        string
	SupabaseKey        string
	SupabaseServiceKey string
	QdrantURL          string
	QdrantAPIKey       string
	OpenRouterAPIKey   string
	OpenRouterBaseURL  string
	ChatModel          string
	EmbeddingModel     string
	QuestionModel      string
	VisionModel        string
	JWTSecret          string
	AllowedOrigins     string
	Port               string
	Environment        string
	RateLimitPerMin    int
	MaxKnowledgeSize   int
	ChunkSize          int
	ChunkOverlap       int
}

func Load() (*Config, error) {
	cfg := &Config{
		SupabaseURL:        getEnv("SUPABASE_URL", ""),
		SupabaseKey:        getEnv("SUPABASE_KEY", ""),
		SupabaseServiceKey: getEnv("SUPABASE_SERVICE_KEY", ""),
		QdrantURL:          getEnv("QDRANT_URL", "http://localhost:6333"),
		QdrantAPIKey:       getEnv("QDRANT_API_KEY", ""),
		OpenRouterAPIKey:   getEnv("OPENROUTER_API_KEY", ""),
		OpenRouterBaseURL:  getEnv("LLM_BASE_URL", "https://openrouter.ai/api/v1"),
		ChatModel:          getEnv("LLM_CHAT_MODEL", "nvidia/llama-3.1-nemotron-ultra-253b:free"),
		EmbeddingModel:     getEnv("LLM_EMBEDDING_MODEL", "openai/text-embedding-3-small"),
		QuestionModel:      getEnv("LLM_QUESTION_MODEL", "google/gemini-2.0-flash:free"),
		VisionModel:        getEnv("LLM_VISION_MODEL", "google/gemini-2.0-flash:free"),
		JWTSecret:          getEnv("JWT_SECRET", "change-me-in-production"),
		AllowedOrigins:     getEnv("ALLOWED_ORIGINS", "http://localhost:3000,https://chat.chatflow.app"),
		Port:               getEnv("PORT", "8080"),
		Environment:        getEnv("ENV", "development"),
	}

	// Parse numeric configs
	if val, err := strconv.Atoi(getEnv("RATE_LIMIT_PER_MINUTE", "60")); err == nil {
		cfg.RateLimitPerMin = val
	}

	if val, err := strconv.Atoi(getEnv("MAX_KNOWLEDGE_SIZE_MB", "10")); err == nil {
		cfg.MaxKnowledgeSize = val * 1024 * 1024 // Convert to bytes
	}

	if val, err := strconv.Atoi(getEnv("CHUNK_SIZE", "500")); err == nil {
		cfg.ChunkSize = val
	}

	if val, err := strconv.Atoi(getEnv("CHUNK_OVERLAP", "50")); err == nil {
		cfg.ChunkOverlap = val
	}

	// Validate required configs
	if cfg.SupabaseURL == "" {
		return nil, fmt.Errorf("SUPABASE_URL is required")
	}
	if cfg.SupabaseKey == "" {
		return nil, fmt.Errorf("SUPABASE_KEY is required")
	}
	// OpenRouter and JWT secret warnings for dev, errors for prod
	if cfg.Environment == "development" {
		if cfg.OpenRouterAPIKey == "" {
			log.Println("Warning: OPENROUTER_API_KEY not set")
		}
		if cfg.JWTSecret == "change-me-in-production" {
			log.Println("Warning: JWT_SECRET not set - using insecure default")
		}
	} else {
		if cfg.OpenRouterAPIKey == "" {
			return nil, fmt.Errorf("OPENROUTER_API_KEY is required")
		}
		if cfg.JWTSecret == "change-me-in-production" {
			return nil, fmt.Errorf("JWT_SECRET must be set to a secure value")
		}
	}

	return cfg, nil
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
