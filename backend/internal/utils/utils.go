package utils

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// ChunkText splits text into chunks of specified size with overlap
func ChunkText(text string, chunkSize, overlap int) []string {
	if len(text) <= chunkSize {
		return []string{text}
	}

	var chunks []string
	start := 0

	for start < len(text) {
		end := start + chunkSize
		if end > len(text) {
			end = len(text)
		}

		// Try to find a sentence boundary to break cleanly
		if end < len(text) {
			for i := end; i > start && i > end-50; i-- {
				if text[i] == '.' || text[i] == '!' || text[i] == '?' {
					end = i + 1
					break
				}
			}
		}

		chunk := text[start:end]
		chunks = append(chunks, chunk)

		if end >= len(text) {
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
}

type ChatResponse struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	Model   string `json:"model"`
	Choices []struct {
		Index   int `json:"index"`
		Message struct {
			Role      string                   `json:"role"`
			Content   string                   `json:"content"`
			ToolCalls []map[string]interface{} `json:"tool_calls,omitempty"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
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
		client:         &http.Client{Timeout: 120 * time.Second},
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
	httpReq.Header.Set("HTTP-Referer", "https://chatflow.app")
	httpReq.Header.Set("X-Title", "ChatFlow")

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
	httpReq.Header.Set("HTTP-Referer", "https://chatflow.app")
	httpReq.Header.Set("X-Title", "ChatFlow")

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
