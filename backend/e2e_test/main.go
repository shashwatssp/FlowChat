// Command e2e_test exercises the FlowChat API contract against a running backend.
//
// It deliberately does not start the backend. Configure its target and test
// data with:
//
//	E2E_BASE_URL          API base URL (default: http://localhost:8080/api/v1)
//	E2E_EMAIL             unique registration email (default: generated)
//	E2E_PASSWORD          registration password (default: FlowChatE2E123!)
//	E2E_BOT_NAME          bot name (default: FlowChat E2E Bot)
//	E2E_BOT_DESCRIPTION   bot description
//	E2E_TIMEOUT_SECONDS   per-request timeout (default: 30)
//
// Real routes (from cmd/server/main.go):
//
//	POST /auth/register        {email, password}        -> {message, user_id}
//	POST /auth/login           {email, password}        -> {message, access_token}
//	POST /bots                 {name, description}      (Bearer) -> {id, slug, api_key, ...}
//	GET  /bots/:botID          (Bearer)
//	GET  /bots/public/:slug    (no auth)
//	POST /knowledge/upload     multipart: bot_id, file  (Bearer) -> {message, chunks, source_name}
//	POST /chat/:botSlug        {message, conversation_id, stream} -> {response, conversation_id, sources}
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

type config struct {
	baseURL        string
	email          string
	password       string
	botName        string
	botDescription string
	timeout        time.Duration
}

type runner struct {
	client  *http.Client
	config  config
	token   string
	botID   string
	botSlug string
	failed  bool
}

func main() {
	cfg, err := loadConfig()
	if err != nil {
		fmt.Printf("[FAIL] configuration: %v\n", err)
		os.Exit(1)
	}

	r := runner{
		client: &http.Client{Timeout: cfg.timeout},
		config: cfg,
	}
	r.run()
	if r.failed {
		fmt.Println("\nRESULT: FAIL")
		os.Exit(1)
	}
	fmt.Println("\nRESULT: PASS")
}

func loadConfig() (config, error) {
	timeoutSeconds, err := strconv.Atoi(envOr("E2E_TIMEOUT_SECONDS", "30"))
	if err != nil || timeoutSeconds <= 0 {
		return config{}, fmt.Errorf("E2E_TIMEOUT_SECONDS must be a positive integer")
	}

	email := os.Getenv("E2E_EMAIL")
	if email == "" {
		email = fmt.Sprintf("flowchat-e2e-%d@example.com", time.Now().UnixNano())
	}

	return config{
		baseURL:        strings.TrimRight(envOr("E2E_BASE_URL", "http://localhost:8080/api/v1"), "/"),
		email:          email,
		password:       envOr("E2E_PASSWORD", "FlowChatE2E123!"),
		botName:        envOr("E2E_BOT_NAME", "FlowChat E2E Bot"),
		botDescription: envOr("E2E_BOT_DESCRIPTION", "Temporary bot created by the integration test."),
		timeout:        time.Duration(timeoutSeconds) * time.Second,
	}, nil
}

func (r *runner) run() {
	// 0. Health (no auth)
	r.request("health", http.MethodGet, "/health", nil, false)

	// 1. Register
	register := r.request("register", http.MethodPost, "/auth/register", map[string]any{
		"email":    r.config.email,
		"password": r.config.password,
	}, false)
	if !register.ok {
		r.skipDependentSteps("register did not succeed")
		return
	}

	// 2. Login
	login := r.request("login", http.MethodPost, "/auth/login", map[string]any{
		"email":    r.config.email,
		"password": r.config.password,
	}, false)
	if !login.ok {
		r.skipDependentSteps("login did not succeed")
		return
	}
	r.token = stringField(login.json, "access_token")
	if r.token == "" {
		r.fail("login", "response did not contain access_token", login.status, login.body)
		r.skipDependentSteps("login response had no access token")
		return
	}

	// 3. Create bot (authenticated)
	bot := r.request("create bot", http.MethodPost, "/bots", map[string]any{
		"name":        r.config.botName,
		"description": r.config.botDescription,
	}, true)
	if !bot.ok {
		r.skipBotDependentSteps("bot creation did not succeed")
		return
	}
	r.botID = stringField(bot.json, "id")
	r.botSlug = stringField(bot.json, "slug")
	if r.botID == "" || r.botSlug == "" {
		r.fail("create bot", "response did not contain id/slug", bot.status, bot.body)
		r.skipBotDependentSteps("bot response had no id/slug")
		return
	}

	// 4. Read bot back (authenticated)
	r.request("get bot", http.MethodGet, "/bots/"+r.botID, nil, true)

	// 5. Upload knowledge (multipart: bot_id + file)
	r.uploadKnowledge("upload knowledge", r.botID, "faq.txt", "FlowChat is a configurable AI assistant platform. It lets teams train bots on their own documents and answer questions with citations.")

	// 6. Chat by slug (public endpoint, no auth) — RAG via Qdrant
	chat := r.request("chat", http.MethodPost, "/chat/"+r.botSlug, map[string]any{
		"message": "What is FlowChat?",
		"stream":  false,
	}, false)
	if chat.ok {
		if n, _ := sourcesLen(chat.json); n > 0 {
			fmt.Printf("[PASS] chat returned sources (RAG context present)\n")
		} else {
			fmt.Printf("[NOTE] chat succeeded but no sources were returned (knowledge may not have matched)\n")
		}
	}

	// 7. Public bot lookup by slug (no auth)
	r.request("get public bot", http.MethodGet, "/bots/public/"+r.botSlug, nil, false)
}

func (r *runner) skipDependentSteps(reason string) {
	r.skip("login", reason)
	r.skip("create bot", reason)
	r.skipBotDependentSteps(reason)
}

func (r *runner) skipBotDependentSteps(reason string) {
	r.skip("upload knowledge", reason)
	r.skip("chat", reason)
	r.skip("get public bot", reason)
}

func sourcesLen(obj map[string]any) (int, bool) {
	if obj == nil {
		return 0, false
	}
	v, ok := obj["sources"]
	if !ok || v == nil {
		return 0, false
	}
	arr, ok := v.([]any)
	return len(arr), ok
}

type result struct {
	ok     bool
	status int
	body   string
	json   map[string]any
}

func (r *runner) request(step, method, path string, payload any, authenticated bool) result {
	var body []byte
	if payload != nil {
		var err error
		body, err = json.Marshal(payload)
		if err != nil {
			r.fail(step, fmt.Sprintf("could not encode request JSON: %v", err), 0, "")
			return result{}
		}
	}
	return r.do(step, method, path, body, "application/json", authenticated)
}

// uploadKnowledge posts a multipart form (bot_id + file) to /knowledge/upload.
func (r *runner) uploadKnowledge(step, botID, filename, content string) result {
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	if err := writer.WriteField("bot_id", botID); err != nil {
		r.fail(step, fmt.Sprintf("could not write bot_id field: %v", err), 0, "")
		return result{}
	}
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		r.fail(step, fmt.Sprintf("could not create form file: %v", err), 0, "")
		return result{}
	}
	if _, err := part.Write([]byte(content)); err != nil {
		r.fail(step, fmt.Sprintf("could not write file content: %v", err), 0, "")
		return result{}
	}
	if err := writer.Close(); err != nil {
		r.fail(step, fmt.Sprintf("could not close multipart writer: %v", err), 0, "")
		return result{}
	}
	return r.do(step, http.MethodPost, "/knowledge/upload", buf.Bytes(), writer.FormDataContentType(), true)
}

func (r *runner) do(step, method, path string, requestBody []byte, contentType string, authenticated bool) result {
	req, err := http.NewRequestWithContext(context.Background(), method, r.config.baseURL+path, bytes.NewReader(requestBody))
	if err != nil {
		r.fail(step, fmt.Sprintf("could not create request: %v", err), 0, "")
		return result{}
	}
	req.Header.Set("Accept", "application/json")
	if len(requestBody) > 0 {
		req.Header.Set("Content-Type", contentType)
	}
	if authenticated {
		req.Header.Set("Authorization", "Bearer "+r.token)
	}

	resp, err := r.client.Do(req)
	if err != nil {
		r.fail(step, fmt.Sprintf("%s %s: %v", method, req.URL, err), 0, "")
		return result{}
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		r.fail(step, fmt.Sprintf("could not read response: %v", err), resp.StatusCode, "")
		return result{status: resp.StatusCode}
	}
	bodyText := string(respBody)
	res := result{
		ok:     resp.StatusCode >= http.StatusOK && resp.StatusCode < http.StatusMultipleChoices,
		status: resp.StatusCode,
		body:   bodyText,
		json:   decodeObject(respBody),
	}
	preview := strings.ReplaceAll(bodyText, "\n", " ")
	if len(preview) > 200 {
		preview = preview[:200]
	}
	if res.ok {
		fmt.Printf("[PASS] %s: HTTP %d (%s)\n", step, res.status, preview)
	} else {
		r.fail(step, "expected a 2xx response", res.status, res.body)
	}
	return res
}

func (r *runner) fail(step, message string, status int, body string) {
	r.failed = true
	preview := strings.ReplaceAll(body, "\n", " ")
	if len(preview) > 300 {
		preview = preview[:300]
	}
	if status == 0 {
		fmt.Printf("[FAIL] %s: %s\n", step, message)
		return
	}
	fmt.Printf("[FAIL] %s: HTTP %d; %s\nResponse: %s\n", step, status, message, preview)
}

func (r *runner) skip(step, reason string) {
	fmt.Printf("[SKIP] %s: %s\n", step, reason)
}

func decodeObject(body []byte) map[string]any {
	var value map[string]any
	if err := json.Unmarshal(body, &value); err != nil {
		return nil
	}
	return value
}

func stringField(object map[string]any, field string) string {
	if object == nil {
		return ""
	}
	value, ok := object[field]
	if !ok {
		return ""
	}
	text, _ := value.(string)
	return text
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
