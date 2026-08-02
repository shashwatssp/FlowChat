package handlers

import (
	"bufio"
	"context"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"flowchat/backend/internal/qdrant"
	"flowchat/backend/internal/supabase"
	"flowchat/backend/internal/utils"

	"github.com/gin-gonic/gin"
)

type ChatHandler struct {
	supabaseClient *supabase.Client
	qdrantClient   *qdrant.Client
	openrouterKey  string
	baseURL        string
	chatModel      string
	embeddingModel string
	cohereClient   utils.Embedder
}

func NewChatHandler(client *supabase.Client, qdrant *qdrant.Client, openrouterKey, baseURL, chatModel, embeddingModel string, cohereClient utils.Embedder) *ChatHandler {
	return &ChatHandler{
		supabaseClient: client,
		qdrantClient:   qdrant,
		openrouterKey:  openrouterKey,
		baseURL:        baseURL,
		chatModel:      chatModel,
		embeddingModel: embeddingModel,
		cohereClient:   cohereClient,
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

	log.Printf("[chat] STEP 1: looking up bot by slug=%s", botSlug)
	// Look up bot by slug
	botResults, err := h.supabaseClient.From("bots").
		Select("*").
		Eq("slug", botSlug).
		Execute(c.Request.Context())

	if err != nil || len(botResults) == 0 {
		log.Printf("[chat] bot not found slug=%s err=%v results=%d", botSlug, err, len(botResults))
		c.JSON(http.StatusNotFound, gin.H{"error": "Bot not found"})
		return
	}

	bot := botResults[0]
	botID := getString(bot, "id")
	botName := getString(bot, "name")
	systemPrompt := getString(bot, "system_prompt")
	log.Printf("[chat] STEP 2: bot found id=%s name=%s", botID, botName)

	// Get or create conversation
	conversationID := req.ConversationID
	if conversationID == "" {
		conversationID, err = utils.GenerateUUID()
		if err != nil {
			log.Printf("[chat] STEP 3 error: failed to generate UUID: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create conversation"})
			return
		}
		convData := map[string]interface{}{
			"id":         conversationID,
			"bot_id":     botID,
			"created_at": time.Now().Format(time.RFC3339),
		}
		log.Printf("[chat] STEP 3: creating new conversation id=%s", conversationID)
		if _, insertErr := h.supabaseClient.From("conversations").Insert(convData); insertErr != nil {
			log.Printf("[chat] STEP 3 error: failed to create conversation: %v", insertErr)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create conversation"})
			return
		}
		log.Printf("[chat] STEP 3 done: conversation created")
	} else {
		log.Printf("[chat] STEP 3: using existing conversation id=%s", conversationID)
	}

	// Generate the user's query embedding via Cohere (search_query).
	// Falls back to retrieval-less answering if embeddings are unavailable,
	// mirroring the Qdrant fallback below.
	log.Printf("[chat] STEP 4: starting Cohere embeddings for message=%q", req.Message)
	var queryEmbeddings [][]float32
	if h.cohereClient != nil {
		queryEmbeddings, err = h.cohereClient.GenerateEmbeddings(c.Request.Context(), []string{req.Message}, "search_query")
		if err != nil {
			log.Printf("[chat] WARN: cohere query embedding failed (%v); answering without knowledge context", err)
		} else {
			log.Printf("[chat] STEP 4 done: got %d embedding(s) dim=%d", len(queryEmbeddings), len(queryEmbeddings[0]))
		}
	} else {
		log.Printf("[chat] STEP 4 skipped: cohereClient is nil")
	}

	// Search Qdrant for relevant knowledge (only when we have an embedding)
	var searchResults []qdrant.SearchResult
	if len(queryEmbeddings) > 0 {
		filter := map[string]interface{}{
			"bot_id": botID,
		}
		log.Printf("[chat] STEP 5: starting Qdrant search on collection=knowledge_chunks")
		searchResults, err = h.qdrantClient.Search(c.Request.Context(), "knowledge_chunks", queryEmbeddings[0], 5, filter)
		if err != nil {
			log.Printf("[chat] STEP 5 error: Qdrant search failed (%v); continuing without context", err)
			searchResults = []qdrant.SearchResult{}
		} else {
			log.Printf("[chat] STEP 5 done: %d search results", len(searchResults))
		}
	} else {
		log.Printf("[chat] STEP 5 skipped: no query embeddings")
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
	log.Printf("[chat] STEP 6: calling LLM model=%s baseURL=%s stream=%v", model, h.baseURL, req.Stream)

	if req.Stream {
		// Streaming response
		h.handleStreamChat(c, messages, model, conversationID, botID, sources)
		return
	}


	// Non-streaming response
	// Chat completion via the OpenAI-compatible client.
	llm := utils.NewOpenRouterClient(h.openrouterKey, h.baseURL)
	chatReq := utils.ChatRequest{
		Model:       model,
		Messages:    messages,
		Stream:      false,
		Temperature: 0.7,
		MaxTokens:   512,
	}

	chatResp, err := llm.GenerateChat(c.Request.Context(), chatReq)
	log.Printf("[chat] STEP 6b: LLM response received err=%v", err)
	if err != nil {
		log.Printf("[chat] STEP 6 error: LLM request failed: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to generate response: %v", err)})
		return
	}
	log.Printf("[chat] STEP 6 done: LLM responded with %d choice(s)", len(chatResp.Choices))

	response := ""
	if len(chatResp.Choices) > 0 {
		response = chatResp.Choices[0].Message.Content
	}

	// Save messages to database
	if err := h.saveMessage(c.Request.Context(), conversationID, botID, "user", req.Message); err != nil {
		log.Printf("[chat] WARN: saveMessage (user) failed conv=%s bot_id=%s err=%v", conversationID, botID, err)
	}
	if err := h.saveMessage(c.Request.Context(), conversationID, botID, "assistant", response); err != nil {
		log.Printf("[chat] WARN: saveMessage (assistant) failed conv=%s bot_id=%s err=%v", conversationID, botID, err)
	}

	// Update usage count
	h.updateBotUsage(c.Request.Context(), botID)

	c.JSON(http.StatusOK, ChatResponse{
		Response:       response,
		ConversationID: conversationID,
		Sources:        sources,
	})
}

func (h *ChatHandler) handleStreamChat(c *gin.Context, messages []map[string]interface{}, model, conversationID, botID string, sources []Source) {
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")

	chatReq := utils.ChatRequest{
		Model:       model,
		Messages:    messages,
		Stream:      true,
		Temperature: 0.7,
		MaxTokens:   512,
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

	// Save messages asynchronously (with real bot_id so the not-null FK is satisfied)
	go func() {
		if err := h.saveMessage(context.Background(), conversationID, botID, "user", extractUserMessage(messages)); err != nil {
			log.Printf("[chat] WARN: async saveMessage (user) failed conv=%s bot_id=%s err=%v", conversationID, botID, err)
		}
		if err := h.saveMessage(context.Background(), conversationID, botID, "assistant", fullResponse.String()); err != nil {
			log.Printf("[chat] WARN: async saveMessage (assistant) failed conv=%s bot_id=%s err=%v", conversationID, botID, err)
		}
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

func (h *ChatHandler) saveMessage(ctx context.Context, conversationID, botID, role, content string) error {
	data := map[string]interface{}{
		"conversation_id": conversationID,
		"bot_id":          botID,
		"role":            role,
		"content":         content,
		"created_at":      time.Now().Format(time.RFC3339),
	}
	_, err := h.supabaseClient.From("messages").Insert(data)
	if err != nil {
		log.Printf("[chat] WARN: saveMessage DB insert failed role=%s conv=%s bot_id=%s err=%v", role, conversationID, botID, err)
	}
	return err
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
