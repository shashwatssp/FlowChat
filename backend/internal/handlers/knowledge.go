package handlers

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"flowchat/backend/internal/qdrant"
	"flowchat/backend/internal/supabase"
	"flowchat/backend/internal/utils"

	"github.com/gin-gonic/gin"
)

type KnowledgeHandler struct {
	supabaseClient *supabase.Client
	qdrantClient   *qdrant.Client
	openrouterKey  string
	chunkSize      int
	chunkOverlap   int
	questionModel  string
	visionModel    string
	baseURL        string
	embeddingModel string
	cohereClient   utils.Embedder
}

func NewKnowledgeHandler(client *supabase.Client, qdrant *qdrant.Client, openrouterKey string, chunkSize, chunkOverlap int, questionModel, visionModel, baseURL, embeddingModel string, cohereClient utils.Embedder) *KnowledgeHandler {
	return &KnowledgeHandler{
		supabaseClient: client,
		qdrantClient:   qdrant,
		openrouterKey:  openrouterKey,
		chunkSize:      chunkSize,
		chunkOverlap:   chunkOverlap,
		questionModel:  questionModel,
		visionModel:    visionModel,
		baseURL:        baseURL,
		embeddingModel: embeddingModel,
		cohereClient:   cohereClient,
	}
}

type UploadFileRequest struct {
	BotID string `form:"bot_id" binding:"required"`
}

func (h *KnowledgeHandler) UploadFile(c *gin.Context) {
	botID := c.PostForm("bot_id")
	if botID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bot_id is required"})
		return
	}

	// Get file from form
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No file uploaded"})
		return
	}

	// Validate file type (documents + images)
	allowedExtensions := []string{".txt", ".pdf", ".docx", ".md", ".csv", ".json", ".png", ".jpg", ".jpeg", ".webp", ".gif"}
	ext := strings.ToLower(filepath.Ext(file.Filename))
	valid := false
	for _, allowed := range allowedExtensions {
		if ext == allowed {
			valid = true
			break
		}
	}
	if !valid {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Unsupported file type"})
		return
	}

	// Read file content
	fileContent, err := file.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to open file"})
		return
	}
	defer fileContent.Close()

	content, err := io.ReadAll(fileContent)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read file"})
		return
	}

	// Determine source type and extract text. Images are described via a
	// vision model so the bot can reason about products/pricing photos.
	sourceType := "file_upload"
	var textContent string
	switch ext {
	case ".png", ".jpg", ".jpeg", ".webp", ".gif":
		sourceType = "image"
		embedder := utils.NewOpenRouterClient(h.openrouterKey, h.baseURL).WithEmbeddingModel(h.embeddingModel)
		mimeType := mime.TypeByExtension(ext)
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}
		description, descErr := embedder.GenerateImageDescription(c.Request.Context(), content, mimeType, h.visionModel)
		if descErr != nil {
			textContent = fmt.Sprintf("Product image (%s). Unable to generate a visual description.", file.Filename)
		} else {
			textContent = fmt.Sprintf("Product image (%s). %s", file.Filename, description)
		}
	default:
		textContent = string(content)
	}

	// Chunk the text
	chunks := utils.ChunkText(textContent, h.chunkSize, h.chunkOverlap)

	// Generate embeddings for chunks using Cohere (search_document).
	embeddings, err := h.cohereClient.GenerateEmbeddings(c.Request.Context(), chunks, "search_document")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to generate embeddings: %v", err)})
		return
	}

	// Store in Qdrant
	var points []qdrant.Point
	for i, chunk := range chunks {
		pointID := generateID()
		points = append(points, qdrant.Point{
			ID:     pointID,
			Vector: embeddings[i],
			Payload: map[string]interface{}{
				"bot_id":      botID,
				"source_name": file.Filename,
				"source_type": sourceType,
				"content":     chunk,
				"created_at":  time.Now().Format(time.RFC3339),
			},
		})
	}

	if err := h.qdrantClient.UpsertPoints(c.Request.Context(), "knowledge_chunks", points); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to store embeddings"})
		return
	}

	// Store source info in Supabase
	sourceData := map[string]interface{}{
		"bot_id":      botID,
		"name":        file.Filename,
		"type":        sourceType,
		"url":         "",
		"status":      "processed",
		"chunk_count": len(chunks),
		"created_at":  time.Now().Format(time.RFC3339),
	}

	_, err = h.supabaseClient.From("knowledge_sources").Insert(sourceData)
	if err != nil {
		// Don't fail if we can't store metadata - chunks are already stored
		fmt.Printf("Warning: Failed to store source metadata: %v\n", err)
	}

	c.JSON(http.StatusOK, gin.H{
		"message":     "File processed successfully",
		"chunks":      len(chunks),
		"source_name": file.Filename,
	})
}

type ScrapeRequest struct {
	BotID   string `json:"bot_id" binding:"required"`
	URL     string `json:"url" binding:"required"`
	Sitemap bool   `json:"sitemap"`
}

func (h *KnowledgeHandler) ScrapeWebsite(c *gin.Context) {
	var req ScrapeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Scrape the URL (simplified implementation)
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(req.URL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch URL"})
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read response"})
		return
	}

	textContent := extractTextFromHTML(string(body))
	chunks := utils.ChunkText(textContent, h.chunkSize, h.chunkOverlap)

	// Generate embeddings using Cohere (search_document).
	embeddings, err := h.cohereClient.GenerateEmbeddings(c.Request.Context(), chunks, "search_document")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to generate embeddings: %v", err)})
		return
	}

	// Store in Qdrant
	var points []qdrant.Point
	for i, chunk := range chunks {
		pointID := generateID()
		points = append(points, qdrant.Point{
			ID:     pointID,
			Vector: embeddings[i],
			Payload: map[string]interface{}{
				"bot_id":      req.BotID,
				"source_name": req.URL,
				"source_type": "web_scraping",
				"content":     chunk,
				"created_at":  time.Now().Format(time.RFC3339),
			},
		})
	}

	if err := h.qdrantClient.UpsertPoints(c.Request.Context(), "knowledge_chunks", points); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to store embeddings"})
		return
	}

	// Store source info in Supabase
	sourceData := map[string]interface{}{
		"bot_id":      req.BotID,
		"name":        req.URL,
		"type":        "web_scraping",
		"url":         req.URL,
		"status":      "processed",
		"chunk_count": len(chunks),
		"created_at":  time.Now().Format(time.RFC3339),
	}

	_, err = h.supabaseClient.From("knowledge_sources").Insert(sourceData)
	if err != nil {
		fmt.Printf("Warning: Failed to store source metadata: %v\n", err)
	}

	c.JSON(http.StatusOK, gin.H{
		"message":     "Website scraped successfully",
		"chunks":      len(chunks),
		"source_name": req.URL,
	})
}

func (h *KnowledgeHandler) ListSources(c *gin.Context) {
	botID := c.Param("botID")

	results, err := h.supabaseClient.From("knowledge_sources").
		Select("*").
		Eq("bot_id", botID).
		Order("created_at", true).
		Execute(c.Request.Context())

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch sources"})
		return
	}

	c.JSON(http.StatusOK, results)
}

func (h *KnowledgeHandler) DeleteSource(c *gin.Context) {
	sourceID := c.Param("sourceID")

	qb, err := h.supabaseClient.From("knowledge_sources").Delete()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete source"})
		return
	}
	_, err = qb.Eq("id", sourceID).Execute(c.Request.Context())

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete source"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Source deleted successfully"})
}

func (h *KnowledgeHandler) ListConversations(c *gin.Context) {
	botID := c.Param("id")

	results, err := h.supabaseClient.From("conversations").
		Select("id,bot_id,started_at:created_at,last_message_at").
		Eq("bot_id", botID).
		Order("last_message_at", true).
		Execute(c.Request.Context())

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch conversations"})
		return
	}

	c.JSON(http.StatusOK, results)
}

func (h *KnowledgeHandler) GetConversation(c *gin.Context) {
	convID := c.Param("id")

	results, err := h.supabaseClient.From("messages").
		Select("*").
		Eq("conversation_id", convID).
		Order("created_at", false).
		Execute(c.Request.Context())

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch messages"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"messages": results})
}

type FeedbackRequest struct {
	Helpful bool   `json:"helpful"`
	Rating  int    `json:"rating"`
	Comment string `json:"comment"`
}

func (h *KnowledgeHandler) SaveFeedback(c *gin.Context) {
	convID := c.Param("id")
	var req FeedbackRequest

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	feedbackData := map[string]interface{}{
		"conversation_id": convID,
		"helpful":         req.Helpful,
		"comment":         req.Comment,
		"created_at":      time.Now().Format(time.RFC3339),
	}
	if req.Rating > 0 {
		feedbackData["rating"] = req.Rating
	}

	_, err := h.supabaseClient.From("feedback").Insert(feedbackData)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save feedback"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Feedback saved successfully"})
}

type SuggestQuestionsRequest struct {
	Name        string `json:"name" binding:"required"`
	Description string `json:"description"`
}

// SuggestQuestions generates candidate FAQ questions for a business using an LLM
// (OpenRouter). The business name + description seed the generation.
func (h *KnowledgeHandler) SuggestQuestions(c *gin.Context) {
	var req SuggestQuestionsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	prompt := fmt.Sprintf(`You are an assistant that generates FAQ questions for a small business chatbot. The business is named "%s". Description: %s. Generate 6 to 8 questions that a customer might realistically ask this business. Return ONLY a JSON array of question strings, with no extra text or markdown.`, req.Name, req.Description)

	embedder := utils.NewOpenRouterClient(h.openrouterKey, h.baseURL).WithEmbeddingModel(h.embeddingModel)
	chatReq := utils.ChatRequest{
		Model: h.questionModel,
		Messages: []map[string]interface{}{
			{"role": "system", "content": "You generate concise FAQ questions for a business. Output ONLY a JSON array of question strings."},
			{"role": "user", "content": prompt},
		},
		Temperature: 0.7,
		MaxTokens:   500,
	}

	chatResp, err := embedder.GenerateChat(c.Request.Context(), chatReq)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to generate questions: %v", err)})
		return
	}

	content := ""
	if len(chatResp.Choices) > 0 {
		content = chatResp.Choices[0].Message.Content
	}

	var questions []string
	if err := json.Unmarshal([]byte(content), &questions); err != nil {
		// Fallback: split on lines and strip formatting
		for _, line := range strings.Split(strings.TrimSpace(content), "\n") {
			line = strings.TrimSpace(strings.Trim(line, "[]\""))
			if line != "" {
				questions = append(questions, line)
			}
		}
	}
	if len(questions) == 0 {
		questions = []string{}
	}

	c.JSON(http.StatusOK, gin.H{"questions": questions})
}

// SaveQA stores answered FAQ pairs (owner-provided Q&A) as embedded knowledge
// for the bot.

type QAPair struct {
	Question string `json:"question"`
	Answer   string `json:"answer"`
}

type SaveQARequest struct {
	BotID   string   `json:"bot_id" binding:"required"`
	QAPairs []QAPair `json:"qa_pairs" binding:"required"`
}

func (h *KnowledgeHandler) SaveQA(c *gin.Context) {
	var req SaveQARequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Build a single text blob from non-empty Q&A pairs
	var builder strings.Builder
	for _, qa := range req.QAPairs {
		if qa.Question == "" || qa.Answer == "" {
			continue
		}
		builder.WriteString("Q: ")
		builder.WriteString(qa.Question)
		builder.WriteString("\nA: ")
		builder.WriteString(qa.Answer)
		builder.WriteString("\n\n")
	}
	text := builder.String()
	if text == "" {
		c.JSON(http.StatusOK, gin.H{"message": "No Q&A pairs to save", "chunks": 0})
		return
	}

	chunks := utils.ChunkText(text, h.chunkSize, h.chunkOverlap)
	// Generate embeddings using Cohere (search_document).
	embeddings, err := h.cohereClient.GenerateEmbeddings(c.Request.Context(), chunks, "search_document")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to generate embeddings: %v", err)})
		return
	}

	now := time.Now().Format(time.RFC3339)
	var points []qdrant.Point
	for i, chunk := range chunks {
		points = append(points, qdrant.Point{
			ID:     generateID(),
			Vector: embeddings[i],
			Payload: map[string]interface{}{
				"bot_id":      req.BotID,
				"source_name": "Business FAQ",
				"source_type": "qa_pairs",
				"content":     chunk,
				"created_at":  now,
			},
		})
	}

	if err := h.qdrantClient.UpsertPoints(c.Request.Context(), "knowledge_chunks", points); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to store embeddings"})
		return
	}

	sourceData := map[string]interface{}{
		"bot_id":      req.BotID,
		"name":        "Business FAQ",
		"type":        "qa_pairs",
		"url":         "",
		"status":      "processed",
		"chunk_count": len(chunks),
		"created_at":  now,
	}
	_, _ = h.supabaseClient.From("knowledge_sources").Insert(sourceData)

	c.JSON(http.StatusOK, gin.H{
		"message": "Q&A saved successfully",
		"chunks":  len(chunks),
	})
}

// Helper functions

func generateID() string {
	b := make([]byte, 16)
	// Use crypto/rand for secure random generation
	r, _ := rand.Read(b)
	if r == 0 {
		// Fallback if rand.Read fails
		for i := range b {
			b[i] = byte(time.Now().UnixNano() % 256)
		}
	}
	return fmt.Sprintf("%x", b)
}

func extractTextFromHTML(html string) string {
	// Remove HTML tags
	re := regexp.MustCompile(`<[^>]*>`)
	text := re.ReplaceAllString(html, "")

	// Clean whitespace
	text = strings.Join(strings.Fields(text), " ")

	return text
}
