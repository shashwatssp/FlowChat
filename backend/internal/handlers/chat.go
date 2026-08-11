package handlers

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"flowchat/backend/internal/qdrant"
	"flowchat/backend/internal/supabase"
	"flowchat/backend/internal/utils"

	"github.com/gin-gonic/gin"
)

// bookingIntentRegex matches messages expressing an intent to schedule or book
// an appointment/meeting (e.g. "I want to book an appointment", "Can I schedule a meeting?").
var bookingIntentRegex = regexp.MustCompile(`(?i)\b(appointment|meeting|reservation|schedule|booking)\b|\bbook\s+(?:an?\s+)?(?:appointment|meeting|slot|time|visit|date)\b`)

type ChatHandler struct {
	supabaseClient       *supabase.Client
	qdrantClient         *qdrant.Client
	openrouterKey        string
	baseURL              string
	chatModel            string
	embeddingModel       string
	cohereClient         utils.Embedder
	qdrantEmbeddingModel string
	appointmentHandler   *AppointmentHandler
}

func NewChatHandler(client *supabase.Client, qdrant *qdrant.Client, openrouterKey, baseURL, chatModel, embeddingModel, qdrantEmbeddingModel string, cohereClient utils.Embedder, appointmentHandler *AppointmentHandler) *ChatHandler {
	return &ChatHandler{
		supabaseClient:       client,
		qdrantClient:         qdrant,
		openrouterKey:        openrouterKey,
		baseURL:              baseURL,
		chatModel:            chatModel,
		embeddingModel:       embeddingModel,
		cohereClient:         cohereClient,
		qdrantEmbeddingModel: qdrantEmbeddingModel,
		appointmentHandler:   appointmentHandler,
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
	botOwnerID := getString(bot, "user_id") // used for the NOT NULL user_id on conversations
	log.Printf("[chat] STEP 2: bot found id=%s name=%s owner=%s", botID, botName, botOwnerID)

	// Get or create conversation
	conversationID := req.ConversationID
	if conversationID == "" {
		conversationID, err = utils.GenerateUUID()
		if err != nil {
			log.Printf("[chat] STEP 3 error: failed to generate UUID: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create conversation"})
			return
		}
		// The conversations table uses started_at / last_message_at
		// (both DEFAULT now()) — it has NO created_at column, so we
		// must not send one in the Insert payload.
		// user_id is NOT NULL on the live schema, so we set it to the
		// bot owner's id (the conversation was initiated through their bot).
		convData := map[string]interface{}{
			"id":      conversationID,
			"bot_id":  botID,
			"user_id": botOwnerID,
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

	// Appointment / booking intent detection.
	// When the bot has calendar_enabled=true and the user's message looks like
	// they want to schedule an appointment, short-circuit the LLM and respond
	// with a prompt for their name and phone number.
	calendarEnabled := getString(bot, "calendar_enabled") == "true"
	if calendarEnabled && h.appointmentHandler != nil && bookingIntentRegex.MatchString(req.Message) {
		log.Printf("[chat] Booking intent detected bot_id=%s", botID)
		ready, checkErr := h.appointmentHandler.CheckBotCalendarReady(c.Request.Context(), botID)
		if checkErr != nil {
			log.Printf("[chat] CheckBotCalendarReady error bot_id=%s err=%v", botID, checkErr)
		}
		if ready {
			bookingPrompt := "I'd be happy to help you book an appointment! " +
				"Please provide your name and phone number, and let me know " +
				"what date and time you'd prefer."

			// Save the user message.
			if err := h.saveMessage(c.Request.Context(), conversationID, botID, "user", req.Message); err != nil {
				log.Printf("[chat] WARN: saveMessage (user) failed conv=%s bot_id=%s err=%v", conversationID, botID, err)
			}
			// Save the assistant response.
			if err := h.saveMessage(c.Request.Context(), conversationID, botID, "assistant", bookingPrompt); err != nil {
				log.Printf("[chat] WARN: saveMessage (assistant) failed conv=%s bot_id=%s err=%v", conversationID, botID, err)
			}
			// Update usage count.
			if err := h.updateBotUsage(c.Request.Context(), botID); err != nil {
				log.Printf("[chat] WARN: updateBotUsage failed bot_id=%s err=%v", botID, err)
			}

		// Send the booking prompt as an SSE stream. The frontend always
		// requests stream=true (via chatApi.chatStream), so we must return
		// SSE events — a plain JSON response cannot be parsed by parseStream.
		c.Header("Content-Type", "text/event-stream")
		c.Header("Cache-Control", "no-cache")
		c.Header("Connection", "keep-alive")

		// Emit the booking prompt as a content delta chunk.
		contentJSON, jErr := json.Marshal(map[string]interface{}{
			"choices": []map[string]interface{}{
				{"delta": map[string]interface{}{"content": bookingPrompt}},
			},
		})
		if jErr == nil {
			fmt.Fprintf(c.Writer, "data: %s\n\n", string(contentJSON))
			c.Writer.Flush()
		}

		// Emit conversation-id metadata (mirrors handleStreamChat).
		metaData := fmt.Sprintf(`{"conversation_id": "%s", "sources": []}`, conversationID)
		fmt.Fprintf(c.Writer, "data: %s\n\n", metaData)
		c.Writer.Flush()
		return
		}
	}

	// Search Qdrant for relevant knowledge using native inference text-to-vector.
	// Qdrant generates the embedding internally — no separate embedding API call needed.
	filter := map[string]interface{}{
		"bot_id": botID,
	}
	log.Printf("[chat] STEP 4: Qdrant native inference search collection=knowledge_chunks model=%s", h.qdrantEmbeddingModel)
	searchResults, err := h.qdrantClient.SearchDocuments(c.Request.Context(), "knowledge_chunks", h.qdrantEmbeddingModel, req.Message, 5, filter)
	if err != nil {
		log.Printf("[chat] STEP 4 error: Qdrant search failed (%v); continuing without context", err)
		searchResults = []qdrant.SearchResult{}
	} else {
		log.Printf("[chat] STEP 4 done: %d search results", len(searchResults))
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

	// When the bot has a connected, configured calendar, give the LLM concise
	// availability context (working hours + already-booked times + duration)
	// so it can reason about open vs. taken slots and never double-book.
	if calendarEnabled && h.appointmentHandler != nil {
		if calCtx := h.appointmentHandler.CalendarContextForChat(c.Request.Context(), botID, 7); calCtx != "" {
			messages = append(messages, map[string]interface{}{
				"role":    "system",
				"content": calCtx,
			})
		}
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
		Reason:      map[string]interface{}{"enabled": true},
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
	response = cleanResponse(response)

	// Save messages to database
	if err := h.saveMessage(c.Request.Context(), conversationID, botID, "user", req.Message); err != nil {
		log.Printf("[chat] WARN: saveMessage (user) failed conv=%s bot_id=%s err=%v", conversationID, botID, err)
	}
	if err := h.saveMessage(c.Request.Context(), conversationID, botID, "assistant", response); err != nil {
		log.Printf("[chat] WARN: saveMessage (assistant) failed conv=%s bot_id=%s err=%v", conversationID, botID, err)
	}

	// Update usage count
	if err := h.updateBotUsage(c.Request.Context(), botID); err != nil {
		log.Printf("[chat] WARN: updateBotUsage failed bot_id=%s err=%v", botID, err)
	}

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
		Reason:      map[string]interface{}{"enabled": true},
	}

	client := utils.NewOpenRouterClient(h.openrouterKey, h.baseURL)
	stream, err := client.GenerateChatStream(c.Request.Context(), chatReq)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to start streaming"})
		return
	}
	defer stream.Close()

	scanner := bufio.NewScanner(stream)
	// Increase buffer to handle large SSE lines (reasoning payloads can be large)
	scanBuf := make([]byte, 0, 1024*1024)
	scanner.Buffer(scanBuf, 1024*1024)

	var fullResponse strings.Builder

	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}

		// OpenRouter sends standard SSE lines: "data: {json}".
		// Some providers also send comment lines prefixed with ':' that may
		// embed JSON (e.g. ": OPENROUTER PROCESSING{json}"). Strip the prefix
		// so we never double-prepend "data:" when forwarding.
		payload := line
		if strings.HasPrefix(line, "data:") {
			payload = strings.TrimSpace(line[len("data:"):])
		}

		// Handle SSE comment lines that embed JSON after the comment prefix
		if strings.HasPrefix(payload, ":") {
			if jsonIdx := strings.Index(payload, "{"); jsonIdx >= 0 {
				payload = strings.TrimSpace(payload[jsonIdx:])
			} else {
				continue
			}
		}

		// Skip empty, [DONE], or non-JSON markers
		if payload == "" || payload == "[DONE]" || payload == "data:" {
			continue
		}

		// Parse the SSE event - handle both standard JSON chunks and
		// chunks that contain trailing raw text after the JSON object
		// (some reasoning models, e.g. gpt-oss-20b, emit content as raw
		// text after the final JSON reasoning chunk).
		var evt struct {
			Choices []struct {
				Delta struct {
					Content          string                   `json:"content"`
					Reasoning        string                   `json:"reasoning"`
					ReasoningDetails []map[string]interface{} `json:"reasoning_details"`
				} `json:"delta"`
				FinishReason       string `json:"finish_reason"`
				NativeFinishReason string `json:"native_finish_reason"`
			} `json:"choices"`
			Model    string `json:"model"`
			Provider string `json:"provider"`
		}

		// Try direct JSON unmarshal first (the common case)
		if jsonErr := json.Unmarshal([]byte(payload), &evt); jsonErr == nil && len(evt.Choices) > 0 {
			content := evt.Choices[0].Delta.Content
			reasoningLen := len(evt.Choices[0].Delta.Reasoning)
			log.Printf("[chat] SSE chunk: model=%s provider=%s content_len=%d reasoning_len=%d finish=%s",
				evt.Model, evt.Provider, len(content), reasoningLen, evt.Choices[0].FinishReason)
			if content != "" {
				fullResponse.WriteString(content)
			}
			// Forward the SSE event to the client
			fmt.Fprintf(c.Writer, "data: %s\n\n", payload)
			c.Writer.Flush()
		} else {
			// json.Unmarshal failed - the payload may contain JSON
			// followed by trailing raw text (e.g. {"json":...}Hello!).
			// Use json.Decoder to parse just the JSON portion, then
			// extract any remaining text as content.
			decoder := json.NewDecoder(strings.NewReader(payload))
			if decodeErr := decoder.Decode(&evt); decodeErr == nil && len(evt.Choices) > 0 {
				content := evt.Choices[0].Delta.Content
				log.Printf("[chat] SSE chunk (decoder): model=%s content_len=%d finish=%s",
					evt.Model, len(content), evt.Choices[0].FinishReason)
				if content != "" {
					fullResponse.WriteString(content)
				}
				// Forward clean JSON (without trailing raw text)
				cleanJSON, mErr := json.Marshal(evt)
				if mErr == nil {
					fmt.Fprintf(c.Writer, "data: %s\n\n", string(cleanJSON))
					c.Writer.Flush()
				}
				// Extract and forward any trailing raw text as content
				if remaining, rerr := io.ReadAll(decoder.Buffered()); rerr == nil && len(remaining) > 0 {
					trailing := strings.TrimSpace(string(remaining))
					if trailing != "" && !strings.HasPrefix(trailing, "{") {
						log.Printf("[chat] SSE trailing text: len=%d", len(trailing))
						fullResponse.WriteString(trailing)
						trailingEvt := map[string]interface{}{
							"choices": []map[string]interface{}{
								{"delta": map[string]interface{}{"content": trailing}},
							},
						}
						trailingJSON, tErr := json.Marshal(trailingEvt)
						if tErr == nil {
							fmt.Fprintf(c.Writer, "data: %s\n\n", string(trailingJSON))
							c.Writer.Flush()
						}
					}
				}
			} else {
				// Not JSON at all - treat as raw text content
				log.Printf("[chat] SSE raw text payload: len=%d", len(payload))
				fullResponse.WriteString(payload)
				rawEvt := map[string]interface{}{
					"choices": []map[string]interface{}{
						{"delta": map[string]interface{}{"content": payload}},
					},
				}
				rawJSON, rErr := json.Marshal(rawEvt)
				if rErr == nil {
					fmt.Fprintf(c.Writer, "data: %s\n\n", string(rawJSON))
					c.Writer.Flush()
				}
			}
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
		if err := h.saveMessage(context.Background(), conversationID, botID, "assistant", cleanResponse(fullResponse.String())); err != nil {
			log.Printf("[chat] WARN: async saveMessage (assistant) failed conv=%s bot_id=%s err=%v", conversationID, botID, err)
		}
		// Increment usage count so streamed chats are counted too
		if err := h.updateBotUsage(context.Background(), botID); err != nil {
			log.Printf("[chat] WARN: async updateBotUsage failed bot_id=%s err=%v", botID, err)
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

func (h *ChatHandler) updateBotUsage(ctx context.Context, botID string) error {
	// Increment usage count using Supabase RPC function
	_, err := h.supabaseClient.From("bots").RPC("increment_bot_usage", map[string]interface{}{
		"bot_id": botID,
	})
	if err != nil {
		log.Printf("[chat] WARN: updateBotUsage RPC failed bot_id=%s err=%v", botID, err)
	}
	return err
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

// cleanResponse tidies up the LLM's raw output so the end user gets a
// well-formatted, tidy answer. It:
//  1. Strips leading/trailing whitespace and stray control characters.
//  2. Removes common LLM leakage prefixes such as "Assistant:" or "Bot:".
//  3. Collapses 3+ consecutive newlines into exactly two.
//  4. Trims trailing whitespace on every line.
func cleanResponse(text string) string {
	// 1 — strip stray control characters (except tab/newline)
	text = regexp.MustCompile(`[[:cntrl:]]`).ReplaceAllString(text, "")
	// 2 — remove leading role prefixes like "Assistant:" / "Assistant -" / "Bot:"
	text = regexp.MustCompile(`(?i)^(?:assistant|bot|ai)\s*[:\-]\s*\n*`).ReplaceAllString(text, "")
	// 3 — collapse 3+ newlines to exactly two
	text = regexp.MustCompile(`\n{3,}`).ReplaceAllString(text, "\n\n")
	// 4 — trim trailing whitespace on each line, then leading/trailing blank lines
	lines := strings.Split(text, "\n")
	for i, line := range lines {
		lines[i] = strings.TrimRight(line, " \t")
	}
	text = strings.Join(lines, "\n")
	text = strings.TrimSpace(text)
	return text
}

func formatSources(sources []Source) string {
	// Proper JSON encoding — safe even when source content contains
	// newlines, quotes, or other special characters.
	type serializedSource struct {
		Content string  `json:"content"`
		Score   float32 `json:"score"`
		Name    string  `json:"name"`
	}
	out := make([]serializedSource, len(sources))
	for i, s := range sources {
		out[i] = serializedSource{Content: s.Content, Score: s.Score, Name: s.Name}
	}
	data, err := json.Marshal(out)
	if err != nil {
		return "[]"
	}
	return string(data)
}
