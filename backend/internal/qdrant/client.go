package qdrant

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
)

// Client communicates with Qdrant via its HTTP REST API.
type Client struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

type Point struct {
	ID      string
	Vector  []float32
	Payload map[string]interface{}
}

type SearchResult struct {
	ID      string
	Score   float32
	Payload map[string]interface{}
}

func NewClient(baseURL, apiKey string) (*Client, error) {
	baseURL = strings.TrimRight(baseURL, "/")
	if !strings.HasPrefix(baseURL, "http") {
		baseURL = "http://" + baseURL
	}

	c := &Client{
		baseURL: baseURL,
		apiKey:  apiKey,
		http:    &http.Client{},
	}

	if err := c.HealthCheck(context.Background()); err != nil {
		log.Printf("Warning: Qdrant health check failed: %v", err)
	}

	return c, nil
}

func (c *Client) doRequest(ctx context.Context, method, path string, body interface{}) ([]byte, error) {
	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("marshal request: %w", err)
		}
		bodyReader = bytes.NewReader(data)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		req.Header.Set("api-key", c.apiKey)
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("qdrant error (status %d): %s", resp.StatusCode, string(respBody))
	}
	return respBody, nil
}

func (c *Client) InitializeCollections() error {
	ctx := context.Background()
	collections := []struct {
		name       string
		vectorSize int
	}{
		{"knowledge_chunks", 1536},
		{"feedback_vectors", 1536},
	}

	for _, col := range collections {
		_, err := c.doRequest(ctx, "GET", "/collections/"+col.name, nil)
		if err == nil {
			continue
		}
		createReq := map[string]interface{}{
			"vectors": map[string]interface{}{
				"size":     col.vectorSize,
				"distance": "Cosine",
			},
		}
		if _, err := c.doRequest(ctx, "PUT", "/collections/"+col.name, createReq); err != nil {
			return fmt.Errorf("create collection %s: %w", col.name, err)
		}
		log.Printf("Created Qdrant collection: %s", col.name)
	}
	return nil
}

// UpsertPoints inserts or updates vectors in Qdrant
func (c *Client) UpsertPoints(ctx context.Context, collection string, points []Point) error {
	if len(points) == 0 {
		return nil
	}
	type pointStruct struct {
		ID      uint64                 `json:"id"`
		Vector  []float32              `json:"vector"`
		Payload map[string]interface{} `json:"payload"`
	}
	pts := make([]pointStruct, len(points))
	for i, p := range points {
		pts[i] = pointStruct{
			ID:      hashStringToUint64(p.ID),
			Vector:  p.Vector,
			Payload: p.Payload,
		}
	}
	reqBody := map[string]interface{}{"points": pts}
	if _, err := c.doRequest(ctx, "PUT", "/collections/"+collection+"/points", reqBody); err != nil {
		return fmt.Errorf("upsert points: %w", err)
	}
	return nil
}

// Search finds similar vectors in the collection
func (c *Client) Search(ctx context.Context, collection string, vector []float32, topK int, filter map[string]interface{}) ([]SearchResult, error) {
	reqBody := map[string]interface{}{
		"vector":       vector,
		"limit":        topK,
		"with_payload": true,
	}
	if len(filter) > 0 {
		must := []map[string]interface{}{}
		for k, v := range filter {
			must = append(must, map[string]interface{}{
				"key":   k,
				"match": map[string]interface{}{"value": v},
			})
		}
		reqBody["filter"] = map[string]interface{}{"must": must}
	}

	respBody, err := c.doRequest(ctx, "POST", "/collections/"+collection+"/points/search", reqBody)
	if err != nil {
		return nil, fmt.Errorf("search: %w", err)
	}
	var resp struct {
		Result []struct {
			ID      interface{}            `json:"id"`
			Score   float32                `json:"score"`
			Payload map[string]interface{} `json:"payload"`
		} `json:"result"`
	}
	if err := json.Unmarshal(respBody, &resp); err != nil {
		return nil, fmt.Errorf("decode search results: %w", err)
	}
	var results []SearchResult
	for _, hit := range resp.Result {
		results = append(results, SearchResult{
			ID:      fmt.Sprintf("%v", hit.ID),
			Score:   hit.Score,
			Payload: hit.Payload,
		})
	}
	return results, nil
}

func hashStringToUint64(s string) uint64 {
	var hash uint64 = 5381
	for _, c := range s {
		hash = ((hash << 5) + hash) + uint64(c)
	}
	return hash
}

// HealthCheck verifies the Qdrant connection
func (c *Client) HealthCheck(ctx context.Context) error {
	_, err := c.doRequest(ctx, "GET", "/healthz", nil)
	if err != nil {
		return fmt.Errorf("health check failed: %w", err)
	}
	return nil
}
