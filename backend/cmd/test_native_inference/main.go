package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"flowchat/backend/internal/config"
	"github.com/joho/godotenv"
)

const testCol = "native_inference_test"

func loadEnvFile(envPath string) {
	data, err := os.ReadFile(envPath)
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if idx := strings.Index(line, "="); idx > 0 {
			key := strings.TrimSpace(line[:idx])
			val := strings.TrimSpace(line[idx+1:])
			if os.Getenv(key) == "" {
				os.Setenv(key, val)
			}
		}
	}
}

func main() {
	dotEnvPath := filepath.Join(".env")
	loadEnvFile(dotEnvPath)
	if absPath, absErr := filepath.Abs(dotEnvPath); absErr == nil {
		loadEnvFile(absPath)
	}
	godotenv.Load(dotEnvPath)

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	client := &http.Client{Timeout: 30 * time.Second}

	// 1. Create collection with 384-dim vectors
	createBody := map[string]interface{}{
		"vectors": map[string]interface{}{
			"size":     384,
			"distance": "Cosine",
		},
	}
	if err := doJSON(ctx, client, cfg, "PUT", fmt.Sprintf("/collections/%s?wait=true", testCol), createBody, nil); err != nil {
		log.Printf("create collection: %v (may already exist, continuing)", err)
	} else {
		fmt.Println("Collection created (384-dim, Cosine)")
	}

	// 2. Upsert a document with native inference (E5 Small)
	upsertBody := map[string]interface{}{
		"points": []map[string]interface{}{
			{
				"id":      1,
				"payload": map[string]interface{}{"topic": "cooking", "type": "dessert"},
				"vector": map[string]interface{}{
					"text":  "Recipe for baking chocolate chip cookies requires flour, sugar, eggs, and chocolate chips.",
					"model": "intfloat/multilingual-e5-small",
				},
			},
		},
	}
	var upsertResp map[string]interface{}
	if err := doJSON(ctx, client, cfg, "PUT", fmt.Sprintf("/collections/%s/points?wait=true", testCol), upsertBody, &upsertResp); err != nil {
		log.Fatalf("upsert: %v", err)
	}
	fmt.Printf("Upsert response: %v\n", upsertResp["status"])

	// 3. Search with native inference
	searchBody := map[string]interface{}{
		"query": map[string]interface{}{
			"text":  "Recipe for baking chocolate chip cookies",
			"model": "intfloat/multilingual-e5-small",
		},
		"limit":        5,
		"with_payload": true,
		"with_vectors": false,
	}
	var searchResp map[string]interface{}
	if err := doJSON(ctx, client, cfg, "POST", fmt.Sprintf("/collections/%s/points/query", testCol), searchBody, &searchResp); err != nil {
		log.Fatalf("search: %v", err)
	}
	fmt.Printf("Search response: %+v\n", searchResp)

	// Pretty print the result points
	if result, ok := searchResp["result"].(map[string]interface{}); ok {
		if points, ok := result["points"].([]interface{}); ok {
			fmt.Printf("Found %d points\n", len(points))
			for i, p := range points {
				if pm, ok := p.(map[string]interface{}); ok {
					score := pm["score"]
					var payload map[string]interface{}
					if pp, ok := pm["payload"].(map[string]interface{}); ok {
						payload = pp
					}
					b, _ := json.Marshal(payload)
					fmt.Printf("[%d] score=%v payload=%s\n", i, score, string(b))
				}
			}
		}
	}

	fmt.Println("\n=== All tests passed! Native inference works. ===")
}

func doJSON(ctx context.Context, client *http.Client, cfg *config.Config, method, path string, body interface{}, respObj interface{}) error {
	jsonData, err := json.Marshal(body)
	if err != nil {
		return err
	}

	url := cfg.QdrantURL + path
	req, err := http.NewRequestWithContext(ctx, method, url, bytes.NewReader(jsonData))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if cfg.QdrantAPIKey != "" {
		req.Header.Set("api-key", cfg.QdrantAPIKey)
	}

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	if respObj != nil {
		if err := json.Unmarshal(respBody, respObj); err != nil {
			return fmt.Errorf("decode response: %w (raw: %s)", err, string(respBody))
		}
	}
	return nil
}
