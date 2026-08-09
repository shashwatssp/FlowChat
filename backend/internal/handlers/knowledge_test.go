package handlers

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"flowchat/backend/internal/config"
	"flowchat/backend/internal/qdrant"
	"flowchat/backend/internal/supabase"
	"flowchat/backend/internal/utils"

	"github.com/gin-gonic/gin"
)

// newTestKnowledgeHandler creates a KnowledgeHandler wired to mock HTTP servers
// so we can test SaveText (and other) handlers without real Qdrant/Supabase.
func newTestKnowledgeHandler(t *testing.T) (*KnowledgeHandler, *httptest.Server, *httptest.Server, func()) {
	t.Helper()

	// Mock Qdrant server
	qdrantSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		// Qdrant upsert returns {"result": true, "status": {"wait": true}}
		w.Write([]byte(`{"result":true,"status":{"wait":true}}`))
	}))

	// Mock Supabase server
	supabaseSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		// PostgREST returns the inserted rows for select=*, or empty array for plain insert
		if strings.Contains(r.URL.RawQuery, "select") {
			w.Write([]byte(`[{"id":"test-id","name":"test"}]`))
		} else {
			w.Write([]byte(`{}`))
		}
	}))

	cfg := config.Config{
		SupabaseURL:        supabaseSrv.URL,
		SupabaseKey:        "test-key",
		SupabaseServiceKey: "test-service-key",
		QdrantURL:          qdrantSrv.URL,
		QdrantAPIKey:       "test-qdrant-key",
		ChunkSize:          500,
		ChunkOverlap:       50,
	}

	supabaseClient, err := supabase.NewClient(cfg.SupabaseURL, cfg.SupabaseKey, supabase.WithServiceKey(cfg.SupabaseServiceKey))
	if err != nil {
		t.Fatalf("failed to create supabase client: %v", err)
	}

	qdrantClient, err := qdrant.NewClient(cfg.QdrantURL, cfg.QdrantAPIKey)
	if err != nil {
		// NewClient logs a warning on health check failure but returns client; that's OK
		if qdrantClient == nil {
			t.Fatalf("failed to create qdrant client: %v", err)
		}
	}

	cohereClient := utils.NewCohereClient("", "").WithModel("")

	handler := &KnowledgeHandler{
		supabaseClient:       supabaseClient,
		qdrantClient:         qdrantClient,
		chunkSize:            cfg.ChunkSize,
		chunkOverlap:         cfg.ChunkOverlap,
		embeddingModel:       "openai/text-embedding-3-small",
		qdrantEmbeddingModel: "openai/text-embedding-3-small",
		cohereClient:         cohereClient,
	}

	cleanup := func() {
		qdrantSrv.Close()
		supabaseSrv.Close()
	}

	return handler, qdrantSrv, supabaseSrv, cleanup
}

func TestSaveText_Success(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler, qdrantSrv, supabaseSrv, cleanup := newTestKnowledgeHandler(t)
	defer cleanup()

	// Track that Qdrant received an upsert
	qdrantUpsertCalled := false
	qdrantSrv.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/points") && r.Method == "PUT" {
			qdrantUpsertCalled = true
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"result":true}`))
	})

	// Track that Supabase received an insert
	supabaseInsertCalled := false
	supabaseSrv.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/rest/v1/knowledge_sources" && r.Method == "POST" {
			supabaseInsertCalled = true
			body, _ := io.ReadAll(r.Body)
			var payload map[string]interface{}
			json.Unmarshal(body, &payload)
			if payload["type"] != "voice_to_text" {
				t.Errorf("expected source_type voice_to_text, got %v", payload["type"])
			}
			if payload["name"] != "Voice transcript" {
				t.Errorf("expected source_name 'Voice transcript', got %v", payload["name"])
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{}`))
	})

	router := gin.New()
	router.POST("/save-text", handler.SaveText)

	longText := strings.Repeat("This is a test sentence for the knowledge base. ", 30)

	w := httptest.NewRecorder()
	reqBody, _ := json.Marshal(map[string]string{
		"bot_id": "bot-123",
		"text":   longText,
	})
	req, _ := http.NewRequest("POST", "/save-text", strings.NewReader(string(reqBody)))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d. body=%s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)

	if resp["chunks"] == nil {
		t.Fatal("expected chunks in response")
	}
	chunkCount := int(resp["chunks"].(float64))
	if chunkCount < 1 {
		t.Errorf("expected at least 1 chunk, got %d", chunkCount)
	}

	if resp["source_type"] != "voice_to_text" {
		t.Errorf("expected source_type 'voice_to_text', got %v", resp["source_type"])
	}

	if !qdrantUpsertCalled {
		t.Error("expected Qdrant upsert to be called")
	}

	if !supabaseInsertCalled {
		t.Error("expected Supabase insert to be called for knowledge_sources")
	}
}

func TestSaveText_EmptyText(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler, _, _, cleanup := newTestKnowledgeHandler(t)
	defer cleanup()

	router := gin.New()
	router.POST("/save-text", handler.SaveText)

	w := httptest.NewRecorder()
	reqBody, _ := json.Marshal(map[string]string{
		"bot_id": "bot-123",
		"text":   "   \n  \n  ",
	})
	req, _ := http.NewRequest("POST", "/save-text", strings.NewReader(string(reqBody)))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400 for empty text, got %d. body=%s", w.Code, w.Body.String())
	}
}

func TestSaveText_MissingBotID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler, _, _, cleanup := newTestKnowledgeHandler(t)
	defer cleanup()

	router := gin.New()
	router.POST("/save-text", handler.SaveText)

	w := httptest.NewRecorder()
	reqBody, _ := json.Marshal(map[string]string{
		"text": "Some knowledge content here",
	})
	req, _ := http.NewRequest("POST", "/save-text", strings.NewReader(string(reqBody)))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400 for missing bot_id, got %d", w.Code)
	}
}

func TestSaveText_Chunking(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler, qdrantSrv, _, cleanup := newTestKnowledgeHandler(t)
	defer cleanup()

	// Capture the upsert payload to verify chunking
	var upsertedTexts []string
	qdrantSrv.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/points") && r.Method == "PUT" {
			body, _ := io.ReadAll(r.Body)
			var payload struct {
				Points []struct {
					Vector struct {
						Text string `json:"text"`
					} `json:"vector"`
				} `json:"points"`
			}
			json.Unmarshal(body, &payload)
			for _, p := range payload.Points {
				upsertedTexts = append(upsertedTexts, p.Vector.Text)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"result":true}`))
	})

	router := gin.New()
	router.POST("/save-text", handler.SaveText)

	// Text that should produce multiple chunks (> 500 chars with default chunkSize)
	longText := strings.Repeat("Lorem ipsum dolor sit amet, consectetur adipiscing elit. ", 20)

	w := httptest.NewRecorder()
	reqBody, _ := json.Marshal(map[string]string{
		"bot_id": "bot-456",
		"text":   longText,
	})
	req, _ := http.NewRequest("POST", "/save-text", strings.NewReader(string(reqBody)))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d. body=%s", w.Code, w.Body.String())
	}

	if len(upsertedTexts) < 2 {
		t.Errorf("expected at least 2 chunks for long text, got %d", len(upsertedTexts))
	}

	// Verify chunks are non-empty and from the original text
	for _, chunk := range upsertedTexts {
		if chunk == "" {
			t.Error("expected non-empty chunks")
		}
	}
}

func TestSaveText_ResponseFormat(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler, _, _, cleanup := newTestKnowledgeHandler(t)
	defer cleanup()

	router := gin.New()
	router.POST("/save-text", handler.SaveText)

	w := httptest.NewRecorder()
	reqBody, _ := json.Marshal(map[string]string{
		"bot_id": "bot-789",
		"text":   "Some important business information that customers should know.",
	})
	req, _ := http.NewRequest("POST", "/save-text", strings.NewReader(string(reqBody)))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)

	// Check response fields
	if resp["message"] == nil {
		t.Error("expected message field in response")
	}
	if resp["chunks"] == nil {
		t.Error("expected chunks field in response")
	}
	if resp["source_name"] != "Voice transcript" {
		t.Errorf("expected source_name 'Voice transcript', got %v", resp["source_name"])
	}
	if resp["source_type"] != "voice_to_text" {
		t.Errorf("expected source_type 'voice_to_text', got %v", resp["source_type"])
	}
}
