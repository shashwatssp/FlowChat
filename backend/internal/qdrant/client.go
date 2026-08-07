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
	"time"
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

// DocumentPoint represents a point to upsert with native inference.
// Instead of a pre-computed vector, Qdrant generates the embedding
// from the text using the specified model.
type DocumentPoint struct {
	ID      string
	Text    string
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
		http:    &http.Client{Timeout: 30 * time.Second},
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
		{"knowledge_chunks", 384},
		{"feedback_vectors", 384},
	}

	for _, col := range collections {
		body, err := c.doRequest(ctx, "GET", "/collections/"+col.name, nil)
		if err != nil {
			// Collection does not exist — create it.
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
		} else {
			// Collection exists — verify the vector size matches.
			// Qdrant returns the config at result.config.params.vectors.size
			// (NOT result.vectors.size — that path was previously used and
			// always parsed as 0, causing a destructive delete+recreate on
			// every startup that wiped all ingested knowledge).
			var info struct {
				Result struct {
					Config struct {
						Params struct {
							Vectors struct {
								Size int `json:"size"`
							} `json:"vectors"`
						} `json:"params"`
					} `json:"config"`
				} `json:"result"`
			}
			if jsonErr := json.Unmarshal(body, &info); jsonErr != nil {
				log.Printf("Qdrant collection already exists: %s (could not verify vector size)", col.name)
			} else if info.Result.Config.Params.Vectors.Size != col.vectorSize {
				log.Printf("Qdrant collection %s has vector size %d, need %d — deleting and recreating", col.name, info.Result.Config.Params.Vectors.Size, col.vectorSize)
				if delErr := c.DeleteCollection(ctx, col.name); delErr != nil {
					return fmt.Errorf("delete collection %s: %w", col.name, delErr)
				}
				createReq := map[string]interface{}{
					"vectors": map[string]interface{}{
						"size":     col.vectorSize,
						"distance": "Cosine",
					},
				}
				if _, err := c.doRequest(ctx, "PUT", "/collections/"+col.name, createReq); err != nil {
					return fmt.Errorf("recreate collection %s: %w", col.name, err)
				}
				log.Printf("Recreated Qdrant collection: %s", col.name)
			} else {
				log.Printf("Qdrant collection already exists: %s (vector size %d, OK)", col.name, info.Result.Config.Params.Vectors.Size)
			}
		}

		// Create payload index on bot_id for both new and existing collections.
		indexReq := map[string]interface{}{
			"field_name": "bot_id",
			"field_type": "keyword",
		}
		if _, err := c.doRequest(ctx, "PUT", "/collections/"+col.name+"/index", indexReq); err != nil {
			log.Printf("Warning: failed to create bot_id index on %s: %v", col.name, err)
		} else {
			log.Printf("Payload index on bot_id ready for collection: %s", col.name)
		}
	}
	return nil
}

// DeleteCollection removes a Qdrant collection by name.
func (c *Client) DeleteCollection(ctx context.Context, name string) error {
	_, err := c.doRequest(ctx, "DELETE", "/collections/"+name, nil)
	if err != nil {
		return fmt.Errorf("delete collection %s: %w", name, err)
	}
	return nil
}

// DeleteDocuments removes all points matching the given payload filter from a
// collection. The filter is a Qdrant filter object (e.g. {"must": [{"key": "bot_id", "match": {"value": "..."}}]}).
func (c *Client) DeleteDocuments(ctx context.Context, collection string, filter map[string]interface{}) error {
	reqBody := map[string]interface{}{"filter": filter, "wait": true}
	_, err := c.doRequest(ctx, "POST", "/collections/"+collection+"/points/delete", reqBody)
	if err != nil {
		return fmt.Errorf("delete documents from %s: %w", collection, err)
	}
	return nil
}

// UpsertDocuments upserts points into Qdrant using native inference.
// Qdrant generates vector embeddings from the text using the specified model,
// eliminating the need for a separate embedding API call.
func (c *Client) UpsertDocuments(ctx context.Context, collection, model string, points []DocumentPoint) error {
	if len(points) == 0 {
		return nil
	}
	type pointStruct struct {
		ID      interface{}             `json:"id"`
		Vector  map[string]interface{}  `json:"vector"`
		Payload map[string]interface{}  `json:"payload"`
	}
	pts := make([]pointStruct, len(points))
	for i, p := range points {
		pts[i] = pointStruct{
			ID: p.ID,
			Vector: map[string]interface{}{
				"text":  p.Text,
				"model": model,
			},
			Payload: p.Payload,
		}
	}
	reqBody := map[string]interface{}{"points": pts}
	log.Printf("[qdrant] UpsertDocuments: collection=%s model=%s points=%d", collection, model, len(points))
	respBody, err := c.doRequest(ctx, "PUT", "/collections/"+collection+"/points?wait=true", reqBody)
	if err != nil {
		log.Printf("[qdrant] UpsertDocuments ERROR: %v", err)
		log.Printf("[qdrant] UpsertDocuments raw response: %s", string(respBody))
		return fmt.Errorf("upsert documents: %w", err)
	}
	log.Printf("[qdrant] UpsertDocuments OK: collection=%s points=%d response=%s", collection, len(points), string(respBody))
	return nil
}

// SearchDocuments searches Qdrant using native inference text-to-vector.
// The query text is embedded by Qdrant using the specified model and used
// to find similar vectors in the collection.
func (c *Client) SearchDocuments(ctx context.Context, collection, model, queryText string, topK int, filter map[string]interface{}) ([]SearchResult, error) {
	reqBody := map[string]interface{}{
		"query": map[string]interface{}{
			"text":  queryText,
			"model": model,
		},
		"limit":        topK,
		"with_payload": true,
		"with_vectors": false,
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

	reqJSON, _ := json.Marshal(reqBody)
	log.Printf("[qdrant] SearchDocuments: collection=%s model=%s topK=%d filter=%v query=%q", collection, model, topK, filter, queryText)
	log.Printf("[qdrant] SearchDocuments request body: %s", string(reqJSON))

	respBody, err := c.doRequest(ctx, "POST", "/collections/"+collection+"/points/query", reqBody)
	if err != nil {
		log.Printf("[qdrant] SearchDocuments ERROR: %v", err)
		log.Printf("[qdrant] SearchDocuments raw response: %s", string(respBody))
		return nil, fmt.Errorf("search documents: %w", err)
	}
	log.Printf("[qdrant] SearchDocuments raw response: %s", string(respBody))

	var resp struct {
		Result struct {
			Points []struct {
				ID      interface{}            `json:"id"`
				Score   float32                `json:"score"`
				Payload map[string]interface{} `json:"payload"`
			} `json:"points"`
		} `json:"result"`
	}
	if err := json.Unmarshal(respBody, &resp); err != nil {
		log.Printf("[qdrant] SearchDocuments unmarshal error: %v, raw response: %s", err, string(respBody))
		return nil, fmt.Errorf("decode search documents results: %w", err)
	}

	var results []SearchResult
	for _, hit := range resp.Result.Points {
		results = append(results, SearchResult{
			ID:      fmt.Sprintf("%v", hit.ID),
			Score:   hit.Score,
			Payload: hit.Payload,
		})
	}
	log.Printf("[qdrant] SearchDocuments: query=%q model=%s found=%d", queryText, model, len(results))
	return results, nil
}

// UpsertPoints inserts or updates pre-computed vectors in Qdrant (legacy path).
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

// Search finds similar pre-computed vectors in the collection (legacy path).
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

// HealthCheck verifies the Qdrant connection.
func (c *Client) HealthCheck(ctx context.Context) error {
	_, err := c.doRequest(ctx, "GET", "/healthz", nil)
	if err != nil {
		return fmt.Errorf("health check failed: %w", err)
	}
	return nil
}
