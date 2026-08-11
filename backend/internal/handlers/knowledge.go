package handlers

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"flowchat/backend/internal/qdrant"
	"flowchat/backend/internal/supabase"
	"flowchat/backend/internal/utils"
	"github.com/ledongthuc/pdf"

	"github.com/gin-gonic/gin"
)

type KnowledgeHandler struct {
	supabaseClient       *supabase.Client
	qdrantClient         *qdrant.Client
	openrouterKey        string
	firecrawlAPIKey      string
	chunkSize            int
	chunkOverlap         int
	questionModel        string
	visionModel          string
	baseURL              string
	embeddingModel       string
	cohereClient         utils.Embedder
	qdrantEmbeddingModel string
}

func NewKnowledgeHandler(client *supabase.Client, qdrant *qdrant.Client, openrouterKey string, chunkSize, chunkOverlap int, questionModel, visionModel, baseURL, embeddingModel, qdrantEmbeddingModel string, cohereClient utils.Embedder, firecrawlAPIKey string) *KnowledgeHandler {
	return &KnowledgeHandler{
		supabaseClient:       client,
		qdrantClient:         qdrant,
		openrouterKey:        openrouterKey,
		firecrawlAPIKey:      firecrawlAPIKey,
		chunkSize:            chunkSize,
		chunkOverlap:         chunkOverlap,
		questionModel:        questionModel,
		visionModel:          visionModel,
		baseURL:              baseURL,
		embeddingModel:       embeddingModel,
		cohereClient:         cohereClient,
		qdrantEmbeddingModel: qdrantEmbeddingModel,
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
	allowedExtensions := []string{".txt", ".pdf", ".docx", ".md", ".csv", ".json", ".tex", ".latex", ".png", ".jpg", ".jpeg", ".webp", ".gif"}
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
	case ".pdf":
		textContent, err = extractTextFromPDF(content)
		if err != nil {
			log.Printf("Warning: PDF extraction failed for %s: %v", file.Filename, err)
			textContent = fmt.Sprintf("File: %s (PDF text could not be extracted automatically)", file.Filename)
		}
	case ".tex", ".latex":
		textContent = stripLateMarkup(string(content))
	case ".docx":
		textContent, err = extractTextFromDocx(content)
		if err != nil {
			log.Printf("Warning: DOCX extraction failed for %s: %v", file.Filename, err)
			textContent = fmt.Sprintf("File: %s (DOCX text could not be extracted automatically)", file.Filename)
		}
	default:
		textContent = string(content)
	}

	// Chunk the text
	chunks := utils.ChunkText(textContent, h.chunkSize, h.chunkOverlap)

	// Store chunks in Qdrant using native inference (Qdrant generates embeddings internally).
	var docs []qdrant.DocumentPoint
	for _, chunk := range chunks {
		docs = append(docs, qdrant.DocumentPoint{
			ID:   generateID(),
			Text: chunk,
			Payload: map[string]interface{}{
				"bot_id":      botID,
				"source_name": file.Filename,
				"source_type": sourceType,
				"content":     chunk,
				"created_at":  time.Now().Format(time.RFC3339),
			},
		})
	}

	if err := h.qdrantClient.UpsertDocuments(c.Request.Context(), "knowledge_chunks", h.qdrantEmbeddingModel, docs); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to store embeddings in Qdrant"})
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

// RefineVoiceRequest accepts a raw speech-to-text transcript (as produced by
// the browser Web Speech API) and refines it into clean, structured text
// appropriate for the target field. The backend calls an LLM so that rambling
// or mis-transcribed speech becomes ready-to-save content.

type RefineVoiceRequest struct {
	Text  string `json:"text" binding:"required"`
	Field string `json:"field"`
}

// RefineVoice takes raw speech-to-text output and uses an LLM to convert it
// into clean, structured text suitable for the requested field. This lets a
// non-technical owner simply speak and get ready-to-save content.
//
// Accepted fields: bot_name, description, system_prompt, avatar_url,
// website_url, faq, bot_instructions, message, full_name, or empty/default.
func (h *KnowledgeHandler) RefineVoice(c *gin.Context) {
	var req RefineVoiceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if strings.TrimSpace(req.Text) == "" {
		c.JSON(http.StatusOK, gin.H{"text": ""})
		return
	}

	// Build a system prompt tailored to the field so the LLM produces output
	// in the right shape (plain text, structured, trimmed, etc.).
	var systemPrompt string
	switch strings.ToLower(strings.TrimSpace(req.Field)) {
	case "bot_name":
		systemPrompt = "You turn rambling speech into a clean, short business name (2-4 words). Return ONLY the name, no quotes, no extra text."
	case "description":
		systemPrompt = "You convert spoken words into a clear, concise 1-3 sentence description of a business for a chatbot profile. Fix grammar, remove filler, keep it professional and friendly. Return only the description text, no labels."
	case "system_prompt", "bot_instructions":
		systemPrompt = "You convert spoken words into a clean system prompt for an AI chatbot. The system prompt defines how the bot behaves, its tone, and what it should know. Return only the prompt text, no labels or wrapping. Keep it concise but complete."
	case "avatar_url", "website_url":
		systemPrompt = "Extract only the URL from the spoken text. Return just the URL string, nothing else."
	case "faq":
		systemPrompt = "Convert spoken Q&A pairs into a clean structured format. List each question and answer on its own line as 'Q: ...\\nA: ...'. Return only the Q&A text, no extra explanation."
	case "message":
		systemPrompt = "Refine the spoken text into a clean, natural chat message. Fix grammar and remove filler words like um, uh, like. Keep the original meaning. Return only the message text."
	case "full_name":
		systemPrompt = "Convert the spoken text into a clean full name (first and last). Return only the name, nothing else."
	default:
		systemPrompt = "Refine the spoken text into clean, well-written text. Fix grammar, remove filler words (um, uh, like, you know), and make it natural and professional. Return only the refined text."
	}

	embedder := utils.NewOpenRouterClient(h.openrouterKey, h.baseURL).WithEmbeddingModel(h.embeddingModel)
	chatReq := utils.ChatRequest{
		Model: h.questionModel,
		Messages: []map[string]interface{}{
			{"role": "system", "content": systemPrompt},
			{"role": "user", "content": req.Text},
		},
		Temperature: 0.3,
		MaxTokens:   1024,
	}

	chatResp, err := embedder.GenerateChat(c.Request.Context(), chatReq)
	if err != nil {
		log.Printf("[voice] refine failed (field=%s): %v", req.Field, err)
		// Fall back to returning the original text so the user is never blocked.
		c.JSON(http.StatusOK, gin.H{
			"text":    strings.TrimSpace(req.Text),
			"refined": false,
		})
		return
	}

	refined := ""
	if len(chatResp.Choices) > 0 {
		refined = strings.TrimSpace(chatResp.Choices[0].Message.Content)
	}
	if refined == "" {
		refined = strings.TrimSpace(req.Text)
	}

	c.JSON(http.StatusOK, gin.H{
		"text":    refined,
		"refined": true,
	})
}

func (h *KnowledgeHandler) ScrapeWebsite(c *gin.Context) {
	var req ScrapeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Try Firecrawl API first, fall back to basic HTTP scraping
	var textContent string
	var err error
	if h.firecrawlAPIKey != "" {
		textContent, err = h.scrapeWithFirecrawl(c.Request.Context(), req.URL, req.Sitemap)
		if err != nil {
			log.Printf("Warning: Firecrawl scrape failed for %s: %v; falling back to HTTP", req.URL, err)
		}
	}
	if textContent == "" {
		textContent, err = h.scrapeWithHTTP(req.URL)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch URL"})
			return
		}
	}
	chunks := utils.ChunkText(textContent, h.chunkSize, h.chunkOverlap)

	// Store chunks in Qdrant using native inference (Qdrant generates embeddings internally).
	var docs []qdrant.DocumentPoint
	for _, chunk := range chunks {
		docs = append(docs, qdrant.DocumentPoint{
			ID:   generateID(),
			Text: chunk,
			Payload: map[string]interface{}{
				"bot_id":      req.BotID,
				"source_name": req.URL,
				"source_type": "web_scraping",
				"content":     chunk,
				"created_at":  time.Now().Format(time.RFC3339),
			},
		})
	}

	if err := h.qdrantClient.UpsertDocuments(c.Request.Context(), "knowledge_chunks", h.qdrantEmbeddingModel, docs); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to store embeddings in Qdrant"})
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

// ReindexSource deletes existing Qdrant chunks for a knowledge source and
// rebuilds them. For web_scraping sources the stored URL is re-scraped;
// for file_upload / image sources the original file is not persisted on the
// backend, so re-indexing requires a fresh upload; for qa_pairs the original
// Q&A data is not stored, so re-indexing requires re-saving the pairs.
func (h *KnowledgeHandler) ReindexSource(c *gin.Context) {
	sourceID := c.Param("sourceID")

	// Fetch the source metadata from Supabase.
	results, err := h.supabaseClient.From("knowledge_sources").
		Select("id,bot_id,name,type,url,chunk_count").
		Eq("id", sourceID).
		Execute(c.Request.Context())
	if err != nil {
		log.Printf("[knowledge] reindex: failed to fetch source %s: %v", sourceID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch source"})
		return
	}
	if len(results) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Source not found"})
		return
	}
	src := results[0]
	sourceName, _ := src["name"].(string)
	botID, _ := src["bot_id"].(string)
	sourceType, _ := src["type"].(string)
	sourceURL, _ := src["url"].(string)

	// Build a Qdrant filter to delete existing points for this source.
	delFilter := map[string]interface{}{
		"must": []map[string]interface{}{
			{"key": "bot_id", "match": map[string]interface{}{"value": botID}},
			{"key": "source_name", "match": map[string]interface{}{"value": sourceName}},
		},
	}
	if err := h.qdrantClient.DeleteDocuments(c.Request.Context(), "knowledge_chunks", delFilter); err != nil {
		log.Printf("[knowledge] reindex: failed to delete old Qdrant points for source %s: %v", sourceID, err)
		// Continue — the source may simply have stale data already.
	}

	switch sourceType {
	case "web_scraping":
		if sourceURL == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "No URL stored for this web scraping source"})
			return
		}
		// Re-scrape the URL.
		var textContent string
		var scrapeErr error
		if h.firecrawlAPIKey != "" {
			textContent, scrapeErr = h.scrapeWithFirecrawl(c.Request.Context(), sourceURL, false)
			if scrapeErr != nil {
				log.Printf("[knowledge] reindex: Firecrawl re-scrape failed for %s: %v; falling back to HTTP", sourceURL, scrapeErr)
			}
		}
		if textContent == "" {
			textContent, scrapeErr = h.scrapeWithHTTP(sourceURL)
			if scrapeErr != nil {
				log.Printf("[knowledge] reindex: HTTP re-scrape failed for %s: %v", sourceURL, scrapeErr)
				c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to re-scrape URL: %v", scrapeErr)})
				return
			}
		}
		chunks := utils.ChunkText(textContent, h.chunkSize, h.chunkOverlap)
		var docs []qdrant.DocumentPoint
		for _, chunk := range chunks {
			docs = append(docs, qdrant.DocumentPoint{
				ID:   generateID(),
				Text: chunk,
				Payload: map[string]interface{}{
					"bot_id":      botID,
					"source_name": sourceName,
					"source_type": sourceType,
					"content":     chunk,
					"created_at":  time.Now().Format(time.RFC3339),
				},
			})
		}
		if err := h.qdrantClient.UpsertDocuments(c.Request.Context(), "knowledge_chunks", h.qdrantEmbeddingModel, docs); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to store embeddings in Qdrant"})
			return
		}
		// Update chunk_count in Supabase.
		updateData := map[string]interface{}{
			"status":      "processed",
			"chunk_count": len(chunks),
		}
		updQB, updErr := h.supabaseClient.From("knowledge_sources").Update(updateData)
		if updErr != nil {
			log.Printf("[knowledge] reindex: failed to stage source update: %v", updErr)
		} else if _, updErr := updQB.Eq("id", sourceID).Execute(c.Request.Context()); updErr != nil {
			log.Printf("[knowledge] reindex: failed to update source metadata: %v", updErr)
		}
		c.JSON(http.StatusOK, gin.H{
			"message": fmt.Sprintf("'%s' re-indexed successfully", sourceName),
			"chunks":  len(chunks),
		})

	case "file_upload":
		c.JSON(http.StatusBadRequest, gin.H{
			"error":       "Re-indexing file uploads requires re-uploading the original file. Please upload the file again using the upload endpoint.",
			"source_type": sourceType,
		})

	case "image":
		c.JSON(http.StatusBadRequest, gin.H{
			"error":       "Re-indexing images requires re-uploading the original image. Please upload the file again using the upload endpoint.",
			"source_type": sourceType,
		})

	case "qa_pairs":
		c.JSON(http.StatusBadRequest, gin.H{
			"error":       "Re-indexing Q&A pairs requires re-saving the Q&A data. Please re-submit the question/answer pairs using the QA endpoint.",
			"source_type": sourceType,
		})

	default:
		c.JSON(http.StatusBadRequest, gin.H{
			"error":       fmt.Sprintf("Re-indexing is not supported for source type '%s'", sourceType),
			"source_type": sourceType,
		})
	}
}

func (h *KnowledgeHandler) ListConversations(c *gin.Context) {
	botID := c.Param("id")

	results, err := h.supabaseClient.From("conversations").
		Select("*").
		Eq("bot_id", botID).
		Order("started_at", true).
		Execute(c.Request.Context())

	if err != nil {
		log.Printf("Error listing conversations for bot %s: %v", botID, err)
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
		log.Printf("Error fetching messages for conversation %s: %v", convID, err)
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
		Reason:      map[string]interface{}{"enabled": true},
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
	// Store chunks in Qdrant using native inference (Qdrant generates embeddings internally).
	now := time.Now().Format(time.RFC3339)
	var docs []qdrant.DocumentPoint
	for _, chunk := range chunks {
		docs = append(docs, qdrant.DocumentPoint{
			ID:   generateID(),
			Text: chunk,
			Payload: map[string]interface{}{
				"bot_id":      req.BotID,
				"source_name": "Business FAQ",
				"source_type": "qa_pairs",
				"content":     chunk,
				"created_at":  now,
			},
		})
	}

	if err := h.qdrantClient.UpsertDocuments(c.Request.Context(), "knowledge_chunks", h.qdrantEmbeddingModel, docs); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to store embeddings in Qdrant"})
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

// SaveTextRequest accepts raw text (e.g. transcribed from voice) and stores
// it as embedded knowledge chunks for the bot, following the same pipeline as
// file uploads and Q&A: chunk → embed → upsert into Qdrant.

type SaveTextRequest struct {
	BotID string `json:"bot_id" binding:"required"`
	Text  string `json:"text" binding:"required"`
}

// SaveText takes arbitrary text content, chunks it, and stores the chunks in
// Qdrant's knowledge_chunks collection (scoped to bot_id) using native
// inference so Qdrant generates embeddings internally. A knowledge_sources
// row is also written so the content shows up in the document management
// table and can be re-indexed later.
func (h *KnowledgeHandler) SaveText(c *gin.Context) {
	var req SaveTextRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	text := strings.TrimSpace(req.Text)
	if text == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Text content is required"})
		return
	}

	chunks := utils.ChunkText(text, h.chunkSize, h.chunkOverlap)
	if len(chunks) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No chunks could be generated from the provided text"})
		return
	}

	now := time.Now().Format(time.RFC3339)
	var docs []qdrant.DocumentPoint
	for _, chunk := range chunks {
		docs = append(docs, qdrant.DocumentPoint{
			ID:   generateID(),
			Text: chunk,
			Payload: map[string]interface{}{
				"bot_id":      req.BotID,
				"source_name": "Voice transcript",
				"source_type": "voice_to_text",
				"content":     chunk,
				"created_at":  now,
			},
		})
	}

	if err := h.qdrantClient.UpsertDocuments(c.Request.Context(), "knowledge_chunks", h.qdrantEmbeddingModel, docs); err != nil {
		log.Printf("[knowledge] SaveText: Qdrant upsert failed bot_id=%s: %v", req.BotID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Failed to store embeddings in Qdrant: %v", err)})
		return
	}

	sourceData := map[string]interface{}{
		"bot_id":      req.BotID,
		"name":        "Voice transcript",
		"type":        "voice_to_text",
		"url":         "",
		"status":      "processed",
		"chunk_count": len(chunks),
		"created_at":  now,
	}
	if _, err := h.supabaseClient.From("knowledge_sources").Insert(sourceData); err != nil {
		fmt.Printf("Warning: Failed to store source metadata: %v\n", err)
	}

	log.Printf("[knowledge] SaveText: bot_id=%s chunks=%d", req.BotID, len(chunks))
	c.JSON(http.StatusOK, gin.H{
		"message":     "Voice transcript saved to knowledge base successfully",
		"chunks":      len(chunks),
		"source_name": "Voice transcript",
		"source_type": "voice_to_text",
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

// scrapeWithFirecrawl uses the Firecrawl API to scrape a URL and return extracted markdown text.
func (h *KnowledgeHandler) scrapeWithFirecrawl(ctx context.Context, url string, sitemap bool) (string, error) {
	endpoint := "https://api.firecrawl.dev/v1/scrape"
	if sitemap {
		endpoint = "https://api.firecrawl.dev/v1/crawl"
	}

	payload := map[string]interface{}{
		"url": url,
	}
	if sitemap {
		payload["scrapeOptions"] = map[string]interface{}{
			"formats": []string{"markdown"},
		}
	} else {
		payload["formats"] = []string{"markdown"}
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("failed to marshal Firecrawl request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewBuffer(jsonData))
	if err != nil {
		return "", fmt.Errorf("failed to create Firecrawl request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+h.firecrawlAPIKey)

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("Firecrawl request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read Firecrawl response: %w", err)
	}

	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("Firecrawl API error (status %d): %s", resp.StatusCode, string(body))
	}

	return parseFirecrawlResponse(body)
}

// scrapeWithHTTP performs a basic HTTP GET and HTML tag stripping as a fallback.
func (h *KnowledgeHandler) scrapeWithHTTP(url string) (string, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return "", fmt.Errorf("HTTP request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response: %w", err)
	}

	return extractTextFromHTML(string(body)), nil
}

// parseFirecrawlResponse extracts text content from a Firecrawl API response.
// Handles both array (crawl) and single-object (scrape) data formats.
func parseFirecrawlResponse(body []byte) (string, error) {
	var raw map[string]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		return "", fmt.Errorf("failed to parse Firecrawl JSON: %w", err)
	}

	if success, ok := raw["success"].(bool); ok && !success {
		if errMsg, ok := raw["error"].(string); ok && errMsg != "" {
			return "", fmt.Errorf("Firecrawl error: %s", errMsg)
		}
		return "", fmt.Errorf("Firecrawl returned success=false")
	}

	data, ok := raw["data"]
	if !ok {
		return "", fmt.Errorf("no data field in Firecrawl response")
	}

	var texts []string
	switch v := data.(type) {
	case []interface{}:
		for _, item := range v {
			if itemMap, ok := item.(map[string]interface{}); ok {
				text := firecrawlTextFromItem(itemMap)
				if text != "" {
					texts = append(texts, text)
				}
			}
		}
	case map[string]interface{}:
		text := firecrawlTextFromItem(v)
		if text != "" {
			texts = append(texts, text)
		}
	}

	if len(texts) == 0 {
		return "", fmt.Errorf("no content in Firecrawl response")
	}

	return strings.Join(texts, "\n\n"), nil
}

func firecrawlTextFromItem(data map[string]interface{}) string {
	if md, ok := data["markdown"].(string); ok && md != "" {
		return md
	}
	if text, ok := data["text"].(string); ok && text != "" {
		return text
	}
	if content, ok := data["content"].(string); ok && content != "" {
		return content
	}
	return ""
}

// extractTextFromPDF extracts text content from a PDF file using github.com/ledongthuc/pdf.
func extractTextFromPDF(content []byte) (string, error) {
	r, err := pdf.NewReader(bytes.NewReader(content), int64(len(content)))
	if err != nil {
		return "", fmt.Errorf("failed to open PDF: %w", err)
	}

	textReader, err := r.GetPlainText()
	if err != nil {
		return "", fmt.Errorf("failed to extract PDF text: %w", err)
	}

	textBytes, err := io.ReadAll(textReader)
	if err != nil {
		return "", fmt.Errorf("failed to read PDF text: %w", err)
	}

	return strings.Join(strings.Fields(string(textBytes)), " "), nil
}

// extractTextFromDocx extracts text content from a DOCX file using archive/zip
// and XML parsing of the embedded word/document.xml.
func extractTextFromDocx(content []byte) (string, error) {
	reader := bytes.NewReader(content)
	zipReader, err := zip.NewReader(reader, int64(len(content)))
	if err != nil {
		return "", fmt.Errorf("failed to open DOCX archive: %w", err)
	}

	for _, file := range zipReader.File {
		if file.Name != "word/document.xml" {
			continue
		}
		f, err := file.Open()
		if err != nil {
			return "", fmt.Errorf("failed to open document.xml: %w", err)
		}
		defer f.Close()

		xmlData, err := io.ReadAll(f)
		if err != nil {
			return "", fmt.Errorf("failed to read document.xml: %w", err)
		}

		return extractTextFromDocxXML(xmlData), nil
	}

	return "", fmt.Errorf("document.xml not found in DOCX file")
}

// extractTextFromDocxXML parses the OOXML document.xml content and extracts
// readable text from <w:t> elements.
func extractTextFromDocxXML(data []byte) string {
	xmlContent := string(data)
	matches := regexp.MustCompile(`<w:t[^>]*>(.*?)</w:t>`).FindAllStringSubmatch(xmlContent, -1)

	var texts []string
	for _, match := range matches {
		if len(match) > 1 {
			text := strings.TrimSpace(match[1])
			if text != "" {
				texts = append(texts, text)
			}
		}
	}

	result := strings.Join(texts, " ")
	result = strings.ReplaceAll(result, "&amp;", "&")
	result = strings.ReplaceAll(result, "&lt;", "<")
	result = strings.ReplaceAll(result, "&gt;", ">")
	result = strings.ReplaceAll(result, "&quot;", "\"")
	result = strings.ReplaceAll(result, "&apos;", "'")

	return result
}

// stripLateMarkup removes LaTeX markup commands and environments from text,
// leaving only the readable content.
func stripLateMarkup(text string) string {
	// Remove comments (% to end of line)
	text = regexp.MustCompile(`(?m)%.*$`).ReplaceAllString(text, "")

	// Remove LaTeX environments: \begin{env}...\end{env}
	text = regexp.MustCompile(`(?s)\\begin\{[a-zA-Z]*\}.*?\\end\{[a-zA-Z]*\}`).ReplaceAllString(text, " ")

	// Remove display math $$...$$
	text = regexp.MustCompile(`(?s)\$\$.*?\$\$`).ReplaceAllString(text, " ")

	// Remove display math \[...\]
	text = regexp.MustCompile(`(?s)\\\[.*?\\\]`).ReplaceAllString(text, " ")

	// Remove inline math $...$
	text = regexp.MustCompile(`\$.+?\$`).ReplaceAllString(text, " ")

	// Remove LaTeX commands with arguments: \command{arg}
	text = regexp.MustCompile(`\\[a-zA-Z]+(?:\{[^}]*\})*`).ReplaceAllString(text, " ")

	// Remove remaining LaTeX commands (without args): \command
	text = regexp.MustCompile(`\\[a-zA-Z]+\*?\s*`).ReplaceAllString(text, " ")

	// Remove leftover braces, brackets, and special chars
	text = strings.ReplaceAll(text, "{", " ")
	text = strings.ReplaceAll(text, "}", " ")
	text = strings.ReplaceAll(text, "[", " ")
	text = strings.ReplaceAll(text, "]", " ")
	text = strings.ReplaceAll(text, "$", " ")
	text = strings.ReplaceAll(text, "&", " ")
	text = strings.ReplaceAll(text, "^", " ")
	text = strings.ReplaceAll(text, "_", " ")

	// Clean up whitespace
	text = regexp.MustCompile(`\s+`).ReplaceAllString(text, " ")

	return strings.TrimSpace(text)
}
