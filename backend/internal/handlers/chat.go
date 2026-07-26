package handlers

import (
	"bufio"
	"context"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"chatflow/backend/internal/qdrant"
	"chatflow/backend/internal/supabase"
	"chatflow/backend/internal/utils"

	"github.com/gin-gonic/gin"
)

type ChatHandler struct {
	supabaseClient *supabase.Client
	qdrantClient   *qdrant.Client
	openrouterKey  string
	baseURL        string
	chatModel      string
	embeddingModel string
}

func NewChatHandler(client *supabase.Client, qdrant *qdrant.Client, openrouterKey, baseURL, chatModel, embeddingModel string) *ChatHandler {
	return &ChatHandler{
		supabaseClient: client,
		qdrantClient:   qdrant,
		openrouterKey:  openrouterKey,
		baseURL:        baseURL,
		chatModel:      chatModel,
		embeddingModel: embeddingModel,
	}
}

type ChatRequest struct {
	Message        string `json:"message" binding:"required"`
	ConversationID string `json:"conversation_id"`
	Stream         bool   `json:"stream"`
}

type ChatResponse struct {
	Response       string   `json:"response"`
	ConversationID string   `json:"conversation_id"`
	Sources        []Source `json:"sources"`
}

type Source struct {
	Content string  `json:"content"`
	Score   float32 `json:"score"`
	Name    string  `json:"name"`
}

func (h *ChatHandler) Chat(c *gin.Context) {
	botSlug := c.Param("botSlug")

	var req ChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Look up bot by slug
	botResults, err := h.supabaseClient.From("bots").
		Select("*").
		Eq("slug", botSlug).
		Execute(c.Request.Context())

	if err != nil || len(botResults) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Bot not found"})
		return
	}

	bot := botResults[0]
	botID := getString(bot, "id")
	botName := getString(bot, "name")
	systemPrompt := getString(bot, "system_prompt")

	// Get or create conversation
	conversationID := req.ConversationID
	if conversationID == "" {
		conversationID = generateID()
		convData := map[string]interface{}{
			"id":         conversationID,
			"bot_id":     botID,
			"created_at": time.Now().Format(time.RFC3339),
		}
		_, _ = h.supabaseClient.From("conversations").Insert(convData)
	}

	// Generate embedding for user query
	embedder := utils.NewOpenRouterClient(h.openrouterKey, h.baseURL).WithEmbeddingModel(h.embeddingModel)
	queryEmbeddings, err := embedder.GenerateEmbeddings(c.Request.Context(), []string{req.Message})
	if err != nil {
		// Graceful fallback: if no embedding provider is configured (e.g. Poolside
		// Platform currently has no embedding model), answer from the bot prompt
		// without retrieval-augmented context, mirroring the Qdrant fallback below.
		log.Printf("WARN: embeddings unavailable (%v); answering without knowledge context", err)
	}

	// Search Qdrant for relevant knowledge (only when we have an embedding)
	var searchResults []qdrant.SearchResult
	if len(queryEmbeddings) > 0 {
		filter := map[string]interface{}{
			"bot_id": botID,
		}
		searchResults, err = h.qdrantClient.Search(c.Request.Context(), "knowledge_chunks", queryEmbeddings[0], 5, filter)
		if err != nil {
			// If search fails, continue without context
			searchResults = []qdrant.SearchResult{}
		}
	} else {
		searchResults = []qdrant.SearchResult{}
	}

	// Build context from search results
	var contextBuilder strings.Builder
	var sources []Source
	for _, result := range searchResults {
		if content, ok := result.Payload["content"].(string); ok {
			contextBuilder.WriteString(content)
			contextBuilder.WriteString("\n\n")
			sources = append(sources, Source{
				Content: utils.TruncateString(content, 200),
				Score:   result.Score,
				Name:    getString(result.Payload, "source_name"),
			})
		}
	}

	// Get conversation history
	historyMessages, _ := h.getConversationHistory(c.Request.Context(), conversationID)

	// Build the prompt
	messages := []map[string]interface{}{}

	// System prompt
	if systemPrompt != "" {
		messages = append(messages, map[string]interface{}{
			"role":    "system",
			"content": systemPrompt,
		})
	} else {
		messages = append(messages, map[string]interface{}{
			"role":    "system",
			"content": fmt.Sprintf("You are %s, a helpful AI assistant. Answer questions based on the provided context. If the context doesn't contain relevant information, say so honestly.", botName),
		})
	}

	// Add context if available
	if contextBuilder.Len() > 0 {
		messages = append(messages, map[string]interface{}{
			"role":    "system",
			"content": fmt.Sprintf("Use the following context to answer the user's question:\n\n%s", contextBuilder.String()),
		})
	}

	// Add conversation history
	messages = append(messages, historyMessages...)

	// Add current user message
	messages = append(messages, map[string]interface{}{
		"role":    "user",
		"content": req.Message,
	})

	// Use the configured chat model
	model := h.chatModel

	if req.Stream {
		// Streaming response
		h.handleStreamChat(c, messages, model, conversationID, sources)
		return
	}

	// Non-streaming response
	chatReq := utils.ChatRequest{
		Model:       model,
		Messages:    messages,
		Stream:      false,
		Temperature: 0.7,
		MaxTokens:   2048,
	}

	chatResp, err := embedder.GenerateChat(c.Request.Context(), chatReq)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to generate response: %v", err)})
		return
	}

	response := ""
	if len(chatResp.Choices) > 0 {
		response = chatResp.Choices[0].Message.Content
	}

	// Save messages to database
	h.saveMessage(c.Request.Context(), conversationID, botID, "user", req.Message)
	h.saveMessage(c.Request.Context(), conversationID, botID, "assistant", response)

	// Update usage count
	h.updateBotUsage(c.Request.Context(), botID)

	c.JSON(http.StatusOK, ChatResponse{
		Response:       response,
		ConversationID: conversationID,
		Sources:        sources,
	})
}

func (h *ChatHandler) handleStreamChat(c *gin.Context, messages []map[string]interface{}, model, conversationID string, sources []Source) {
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")

	chatReq := utils.ChatRequest{
		Model:       model,
		Messages:    messages,
		Stream:      true,
		Temperature: 0.7,
		MaxTokens:   2048,
	}

	embedder := utils.NewOpenRouterClient(h.openrouterKey, h.baseURL)
	stream, err := embedder.GenerateChatStream(c.Request.Context(), chatReq)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to start streaming"})
		return
	}
	defer stream.Close()

	scanner := bufio.NewScanner(stream)
	var fullResponse strings.Builder

	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}

		// Send the chunk to client
		fmt.Fprintf(c.Writer, "data: %s\n\n", line)
		c.Writer.Flush()

		// Collect full response for saving
		if strings.Contains(line, "\"content\"") {
			// Simple extraction - in production, parse JSON properly
			fullResponse.WriteString(line)
		}
	}

	// Send conversation ID and sources at the end
	metaData := fmt.Sprintf(`{"conversation_id": "%s", "sources": %v}`, conversationID, formatSources(sources))
	fmt.Fprintf(c.Writer, "data: %s\n\n", metaData)
	c.Writer.Flush()

	// Save messages asynchronously
	go func() {
		h.saveMessage(context.Background(), conversationID, "", "user", extractUserMessage(messages))
		h.saveMessage(context.Background(), conversationID, "", "assistant", fullResponse.String())
	}()
}

func (h *ChatHandler) getConversationHistory(ctx context.Context, conversationID string) ([]map[string]interface{}, error) {
	results, err := h.supabaseClient.From("messages").
		Select("role, content").
		Eq("conversation_id", conversationID).
		Order("created_at", false).
		Limit(10).
		Execute(ctx)

	if err != nil {
		return nil, err
	}

	// Reverse to get chronological order
	var messages []map[string]interface{}
	for i := len(results) - 1; i >= 0; i-- {
		messages = append(messages, results[i])
	}

	return messages, nil
}

func (h *ChatHandler) saveMessage(ctx context.Context, conversationID, botID, role, content string) {
	data := map[string]interface{}{
		"conversation_id": conversationID,
		"bot_id":          botID,
		"role":            role,
		"content":         content,
		"created_at":      time.Now().Format(time.RFC3339),
	}
	_, _ = h.supabaseClient.From("messages").Insert(data)
}

func (h *ChatHandler) updateBotUsage(ctx context.Context, botID string) {
	// Increment usage count using Supabase RPC function
	h.supabaseClient.From("bots").RPC("increment_bot_usage", map[string]interface{}{
		"bot_id": botID,
	})
}

func extractUserMessage(messages []map[string]interface{}) string {
	for i := len(messages) - 1; i >= 0; i-- {
		if role, ok := messages[i]["role"].(string); ok && role == "user" {
			if content, ok := messages[i]["content"].(string); ok {
				return content
			}
		}
	}
	return ""
}

func formatSources(sources []Source) string {
	// Simple JSON formatting
	var parts []string
	for _, s := range sources {
		parts = append(parts, fmt.Sprintf(`{"content":"%s","score":%.2f,"name":"%s"}`,
			strings.ReplaceAll(s.Content, `"`, `\"`), s.Score, s.Name))
	}
	return "[" + strings.Join(parts, ",") + "]"
}
