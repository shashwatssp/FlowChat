package utils

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"
)

// ChunkText splits text into chunks of approximately chunkSize runes
// (Unicode code points) with overlap runes between consecutive chunks.
// Working on runes rather than bytes avoids slicing in the middle of a
// multi-byte UTF-8 sequence, which would produce garbled text.
func ChunkText(text string, chunkSize, overlap int) []string {
	if chunkSize <= 0 {
		return []string{text}
	}
	runes := []rune(text)
	if len(runes) <= chunkSize {
		return []string{text}
	}

	var chunks []string
	start := 0

	for start < len(runes) {
		end := start + chunkSize
		if end > len(runes) {
			end = len(runes)
		}

		// Try to find a sentence boundary to break cleanly
		if end < len(runes) {
			for i := end; i > start && i > end-50; i-- {
				r := runes[i]
				if r == '.' || r == '!' || r == '?' {
					end = i + 1
					break
				}
			}
		}

		chunks = append(chunks, string(runes[start:end]))

		if end >= len(runes) {
			break
		}

		// Apply overlap
		start = end - overlap
		if start < 0 {
			start = 0
		}
	}

	return chunks
}

// GenerateSlug creates a URL-friendly slug from text
func GenerateSlug(text string) string {
	// Convert to lowercase
	result := strings.ToLower(text)

	// Replace spaces with hyphens
	result = strings.ReplaceAll(result, " ", "-")

	// Remove special characters except hyphens and alphanumerics
	result = regexp.MustCompile(`[^a-z0-9\-]`).ReplaceAllString(result, "")

	// Remove consecutive hyphens
	for strings.Contains(result, "--") {
		result = strings.ReplaceAll(result, "--", "-")
	}

	// Trim leading/trailing hyphens
	result = strings.Trim(result, "-")

	// Ensure it's not empty
	if result == "" {
		result = "chatbot"
	}

	// Limit length
	if len(result) > 50 {
		result = result[:50]
		result = strings.Trim(result, "-")
	}

	return result
}

// GenerateAPIKey creates a random API key
func GenerateAPIKey() string {
	bytes := make([]byte, 32)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

// GenerateUUID creates a random RFC 4122 version 4 UUID string.
func GenerateUUID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	// Set version (4) and variant (random) bits per RFC 4122.
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16]), nil
}

// OpenRouterClient wraps an OpenRouter / OpenAI-compatible LLM API.
type OpenRouterClient struct {
	apiKey         string
	baseURL        string
	client         *http.Client
	embeddingModel string
}

type EmbeddingRequest struct {
	Model string   `json:"model"`
	Input []string `json:"input"`
}

type EmbeddingResponse struct {
	Data []struct {
		Embedding []float32 `json:"embedding"`
		Index     int       `json:"index"`
	} `json:"data"`
	Usage struct {
		PromptTokens int `json:"prompt_tokens"`
		TotalTokens  int `json:"total_tokens"`
	} `json:"usage"`
}

type ChatRequest struct {
	Model       string                   `json:"model"`
	Messages    []map[string]interface{} `json:"messages"`
	Stream      bool                     `json:"stream"`
	Temperature float32                  `json:"temperature"`
	MaxTokens   int                      `json:"max_tokens"`
	Tools       []map[string]interface{} `json:"tools,omitempty"`
	Reason      map[string]interface{}   `json:"reasoning,omitempty"`
}

type ChatResponse struct {
	ID       string `json:"id"`
	Object   string `json:"object"`
	Created  int64  `json:"created"`
	Model    string `json:"model"`
	Provider string `json:"provider,omitempty"`
	Choices  []struct {
		Index   int `json:"index"`
		Message struct {
			Role             string                     `json:"role"`
			Content          string                     `json:"content"`
			Reasoning        string                     `json:"reasoning,omitempty"`
			ReasoningDetails []map[string]interface{} `json:"reasoning_details,omitempty"`
			ToolCalls        []map[string]interface{} `json:"tool_calls,omitempty"`
		} `json:"message"`
		FinishReason       string `json:"finish_reason"`
		NativeFinishReason string `json:"native_finish_reason,omitempty"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
}

func NewOpenRouterClient(apiKey, baseURL string) *OpenRouterClient {
	if baseURL == "" {
		baseURL = "https://openrouter.ai/api/v1"
	}
	return &OpenRouterClient{
		apiKey:         apiKey,
		baseURL:        baseURL,
		client:         &http.Client{Timeout: 180 * time.Second},
		embeddingModel: "openai/text-embedding-3-small",
	}
}

// WithEmbeddingModel sets the embedding model used by GenerateEmbeddings.
func (c *OpenRouterClient) WithEmbeddingModel(model string) *OpenRouterClient {
	if model != "" {
		c.embeddingModel = model
	}
	return c
}

// GenerateEmbeddings creates embeddings for text using OpenRouter
func (c *OpenRouterClient) GenerateEmbeddings(ctx context.Context, texts []string) ([][]float32, error) {
	// Use the configured embedding model
	model := c.embeddingModel

	reqBody := EmbeddingRequest{
		Model: model,
		Input: texts,
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", c.baseURL+"/embeddings", bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to make request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("embedding request failed: %s", string(body))
	}

	var embeddingResp EmbeddingResponse
	if err := json.NewDecoder(resp.Body).Decode(&embeddingResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	var embeddings [][]float32
	for _, data := range embeddingResp.Data {
		embeddings = append(embeddings, data.Embedding)
	}

	return embeddings, nil
}

// GenerateChat creates a chat completion using OpenRouter
func (c *OpenRouterClient) GenerateChat(ctx context.Context, req ChatRequest) (*ChatResponse, error) {
	jsonData, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", c.baseURL+"/chat/completions", bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)
	httpReq.Header.Set("HTTP-Referer", "https://flowchat.app")
	httpReq.Header.Set("X-Title", "FlowChat")

	resp, err := c.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("failed to make request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("chat request failed: %s", string(body))
	}

	var chatResp ChatResponse
	if err := json.NewDecoder(resp.Body).Decode(&chatResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &chatResp, nil
}

// GenerateChatStream creates a streaming chat completion
func (c *OpenRouterClient) GenerateChatStream(ctx context.Context, req ChatRequest) (io.ReadCloser, error) {
	req.Stream = true
	jsonData, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", c.baseURL+"/chat/completions", bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)
	httpReq.Header.Set("HTTP-Referer", "https://flowchat.app")
	httpReq.Header.Set("X-Title", "FlowChat")

	resp, err := c.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("failed to make request: %w", err)
	}

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("streaming request failed: %s", string(body))
	}

	return resp.Body, nil
}

// GenerateImageDescription uses a vision-capable model to describe an image so
// it can be embedded into the knowledge base.
func (c *OpenRouterClient) GenerateImageDescription(ctx context.Context, imageData []byte, mimeType, model string) (string, error) {
	base64Str := base64.StdEncoding.EncodeToString(imageData)
	messages := []map[string]interface{}{
		{
			"role":    "system",
			"content": "You are a detail-oriented assistant describing images for a business knowledge base. Describe every visible product, price, logo, sign, text, or business-relevant detail accurately and concisely.",
		},
		{
			"role": "user",
			"content": []map[string]interface{}{
				{"type": "text", "text": "Describe everything visible in this image, focusing on any text, products, prices, logos, signs, or business information. Be detailed and accurate."},
				{"type": "image_url", "image_url": fmt.Sprintf("data:%s;base64,%s", mimeType, base64Str)},
			},
		},
	}
	req := ChatRequest{
		Model:       model,
		Messages:    messages,
		Stream:      false,
		Temperature: 0.3,
		MaxTokens:   1024,
	}
	resp, err := c.GenerateChat(ctx, req)
	if err != nil {
		return "", fmt.Errorf("vision request failed: %w", err)
	}
	if len(resp.Choices) > 0 {
		return resp.Choices[0].Message.Content, nil
	}
	return "", fmt.Errorf("no response from vision model")
}

// Embedder is the provider-agnostic contract for producing text embeddings.
// Cohere, OpenAI, Google, xAI, Voyage, Jina etc. can implement this so they
// are swapped via configuration without touching the handlers.
// inputType is "search_document" for documents/chunks and "search_query"
// for user questions (Cohere embed-v4.0 requires input_type).
type Embedder interface {
	GenerateEmbeddings(ctx context.Context, texts []string, inputType string) ([][]float32, error)
}

// CohereClient wraps the Cohere v2 embed API. It supports batched requests,
// retries 429/5xx responses with exponential backoff, a configurable timeout
// via its HTTP client, structured logging, strong typing and descriptive
// errors. Keys are never hard-coded: they come from configuration.
//
// Note: Cohere embed-v4.0 produces 1536-dim vectors, which exactly matches the
// Qdrant "knowledge_chunks" collection (Cosine, 1536) - no padding or
// collection recreation is required.
type CohereClient struct {
	apiKey         string
	baseURL        string
	model          string
	httpClient     *http.Client
	maxRetries     int
	initialBackoff time.Duration
	maxBackoff     time.Duration
}

// cohereEmbedRequest is the body sent to POST /v2/embed.
type cohereEmbedRequest struct {
	Model          string   `json:"model"`
	InputType      string   `json:"input_type"`
	Texts          []string `json:"texts"`
	EmbeddingTypes []string `json:"embedding_types"`
}

// cohereEmbedResponse models the relevant parts of the Cohere /v2/embed response.
type cohereEmbedResponse struct {
	Embeddings struct {
		Float [][]float32 `json:"float"`
	} `json:"embeddings"`
}

// NewCohereClient creates a Cohere embed client. apiKey is read from config
// (never hard-coded in source).
func NewCohereClient(apiKey, baseURL string) *CohereClient {
	if baseURL == "" {
		baseURL = "https://api.cohere.com/v2"
	}
	return &CohereClient{
		apiKey:         apiKey,
		baseURL:        baseURL,
		model:          "embed-v4.0",
		httpClient:     &http.Client{Timeout: 120 * time.Second},
		maxRetries:     5,
		initialBackoff: 500 * time.Millisecond,
		maxBackoff:     8 * time.Second,
	}
}

// WithModel sets the embedding model (default embed-v4.0).
func (c *CohereClient) WithModel(model string) *CohereClient {
	if model != "" {
		c.model = model
	}
	return c
}

// GenerateEmbeddings creates embeddings for texts using Cohere.
// inputType must be "search_document" (documents/chunks) or "search_query"
// (user questions). Cohere accepts multiple texts per request; large batches
// are split into chunks of maxBatch (96) for reliability.
func (c *CohereClient) GenerateEmbeddings(ctx context.Context, texts []string, inputType string) ([][]float32, error) {
	if len(texts) == 0 {
		return nil, nil
	}
	if inputType == "" {
		inputType = "search_document"
	}

	const maxBatch = 96
	var embeddings [][]float32

	for i := 0; i < len(texts); i += maxBatch {
		end := i + maxBatch
		if end > len(texts) {
			end = len(texts)
		}
		batch := texts[i:end]

		vecs, err := c.embedBatch(ctx, batch, inputType)
		if err != nil {
			return nil, err
		}
		embeddings = append(embeddings, vecs...)
	}

	if len(embeddings) != len(texts) {
		return nil, fmt.Errorf("cohere: embedding count mismatch (requested %d, got %d)", len(texts), len(embeddings))
	}

	log.Printf("cohere: generated %d embeddings (model=%s, input_type=%s)", len(embeddings), c.model, inputType)
	return embeddings, nil
}

// embedBatch sends one Cohere /embed request for a batch of texts, retrying
// 429 and 5xx responses with exponential backoff.
func (c *CohereClient) embedBatch(ctx context.Context, texts []string, inputType string) ([][]float32, error) {
	body := cohereEmbedRequest{
		Model:          c.model,
		InputType:      inputType,
		Texts:          texts,
		EmbeddingTypes: []string{"float"},
	}

	jsonData, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal cohere request: %w", err)
	}

	url := c.baseURL + "/embed"
	backoff := c.initialBackoff

	for attempt := 0; attempt <= c.maxRetries; attempt++ {
		req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(jsonData))
		if err != nil {
			return nil, fmt.Errorf("failed to create cohere request: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+c.apiKey)

		resp, err := c.httpClient.Do(req)
		if err != nil {
			if ctx.Err() != nil {
				return nil, fmt.Errorf("cohere request cancelled: %w", ctx.Err())
			}
			return nil, fmt.Errorf("cohere request failed: %w", err)
		}

		// Retry on rate-limit / transient server errors.
		if resp.StatusCode == 429 || resp.StatusCode >= 500 {
			resp.Body.Close()
			if attempt == c.maxRetries {
				return nil, fmt.Errorf("cohere embed failed after %d retries (status %d)", c.maxRetries, resp.StatusCode)
			}
			select {
			case <-ctx.Done():
				return nil, fmt.Errorf("cohere request cancelled: %w", ctx.Err())
			case <-time.After(backoff):
			}
			backoff *= 2
			if backoff > c.maxBackoff {
				backoff = c.maxBackoff
			}
			continue
		}

		defer resp.Body.Close()

		if resp.StatusCode >= 400 {
			respBody, _ := io.ReadAll(resp.Body)
			return nil, fmt.Errorf("cohere embed request failed (status %d): %s", resp.StatusCode, string(respBody))
		}

		var cr cohereEmbedResponse
		if err := json.NewDecoder(resp.Body).Decode(&cr); err != nil {
			return nil, fmt.Errorf("failed to decode cohere response: %w", err)
		}
		if len(cr.Embeddings.Float) == 0 {
			return nil, fmt.Errorf("cohere: no embeddings returned in response")
		}
		return cr.Embeddings.Float, nil
	}

	return nil, fmt.Errorf("cohere embed failed: exhausted retries")
}

// CosineSimilarity calculates cosine similarity between two vectors
func CosineSimilarity(a, b []float32) float64 {
	if len(a) != len(b) {
		return 0
	}

	var dotProduct float64
	var normA float64
	var normB float64

	for i := 0; i < len(a); i++ {
		dotProduct += float64(a[i]) * float64(b[i])
		normA += float64(a[i]) * float64(a[i])
		normB += float64(b[i]) * float64(b[i])
	}

	if normA == 0 || normB == 0 {
		return 0
	}

	return dotProduct / (math.Sqrt(normA) * math.Sqrt(normB))
}

// SanitizeString removes potentially harmful characters
func SanitizeString(s string) string {
	return strings.Map(func(r rune) rune {
		if r < 32 && r != '\n' && r != '\t' {
			return -1
		}
		return r
	}, s)
}

// IsValidEmail performs basic email validation
func IsValidEmail(email string) bool {
	emailRegex := regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)
	return emailRegex.MatchString(email)
}

// TruncateString truncates a string to max length
func TruncateString(s string, maxLen int) string {
	if utf8.RuneCountInString(s) <= maxLen {
		return s
	}
	return string([]rune(s)[:maxLen])
}

// EnsureDir creates directory if it doesn't exist
func EnsureDir(path string) error {
	return os.MkdirAll(path, 0755)
}

// ReadFile reads a file and returns its contents
func ReadFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("failed to read file: %w", err)
	}
	return string(data), nil
}

// HashPassword hashes a password using bcrypt.
func HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(bytes), nil
}

// VerifyPassword compares a bcrypt-hashed password with a plain-text password.
func VerifyPassword(hashedPassword, password string) error {
	return bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(password))
}

// JWTClaims holds the claims embedded in locally-issued JWT tokens.
// HS256 is used (no external JWT library required) so tokens are issued
// and verified entirely within the backend via the shared JWT_SECRET.
type JWTClaims struct {
	UserID   string `json:"user_id"`
	Email    string `json:"email"`
	IssuedAt int64  `json:"iat"`
	Expiry   int64  `json:"exp"`
}

// GenerateToken creates a signed HS256 JWT for local authentication.
// The token carries user_id, email, iat and exp claims and is signed with the
// provided secret using HMAC-SHA256.
func GenerateToken(secret, userID, email string) (string, error) {
	claims := JWTClaims{
		UserID:   userID,
		Email:    email,
		IssuedAt: time.Now().Unix(),
		Expiry:   time.Now().Add(24 * time.Hour).Unix(),
	}

	header := map[string]interface{}{"alg": "HS256", "typ": "JWT"}
	headerJSON, err := json.Marshal(header)
	if err != nil {
		return "", fmt.Errorf("marshal jwt header: %w", err)
	}
	claimsJSON, err := json.Marshal(claims)
	if err != nil {
		return "", fmt.Errorf("marshal jwt claims: %w", err)
	}

	encodedHeader := base64.RawURLEncoding.EncodeToString(headerJSON)
	encodedClaims := base64.RawURLEncoding.EncodeToString(claimsJSON)
	signingInput := encodedHeader + "." + encodedClaims

	sig := hmac.New(sha256.New, []byte(secret))
	sig.Write([]byte(signingInput))
	encodedSig := base64.RawURLEncoding.EncodeToString(sig.Sum(nil))

	return signingInput + "." + encodedSig, nil
}

// VerifyToken verifies an HS256 JWT signed with the given secret and returns
// its claims. It checks the signature, decodes the payload, and validates
// the expiry.
func VerifyToken(secret, token string) (*JWTClaims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("invalid token format")
	}

	signingInput := parts[0] + "." + parts[1]
	expectedSig := hmac.New(sha256.New, []byte(secret))
	expectedSig.Write([]byte(signingInput))
	expectedStr := base64.RawURLEncoding.EncodeToString(expectedSig.Sum(nil))

	if !hmac.Equal([]byte(expectedStr), []byte(parts[2])) {
		return nil, fmt.Errorf("invalid token signature")
	}

	decoded, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("decode jwt payload: %w", err)
	}

	var claims JWTClaims
	if err := json.Unmarshal(decoded, &claims); err != nil {
		return nil, fmt.Errorf("unmarshal jwt claims: %w", err)
	}

	if time.Now().Unix() > claims.Expiry {
		return nil, fmt.Errorf("token expired")
	}

	return &claims, nil
}
