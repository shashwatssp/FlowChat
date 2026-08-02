package supabase

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
)

const (
	PostgRESTAPISuffix = "/rest/v1/"
	AuthAPISuffix      = "/auth/v1/"
	FunctionsAPISuffix = "/functions/v1/"
)

type Client struct {
	url           string
	apiKey        string
	serviceKey    string
	httpClient    *http.Client
	serviceClient *Client // Client with service role key for admin operations
	mu            sync.RWMutex
}

type Option func(*Client)

func WithServiceKey(serviceKey string) Option {
	return func(c *Client) {
		c.serviceKey = serviceKey
	}
}

func NewClient(apiURL, apiKey string, opts ...Option) (*Client, error) {
	if apiURL == "" || apiKey == "" {
		return nil, fmt.Errorf("apiURL and apiKey are required")
	}

	client := &Client{
		url:        strings.TrimRight(apiURL, "/"),
		apiKey:     apiKey,
		httpClient: &http.Client{},
	}

	for _, opt := range opts {
		opt(client)
	}

	// Create service client if service key is provided
	if client.serviceKey != "" {
		serviceClient := &Client{
			url:        client.url,
			apiKey:     client.serviceKey,
			httpClient: &http.Client{},
		}
		client.serviceClient = serviceClient
	}

	return client, nil
}

// From adds a table reference for select operations
func (c *Client) From(table string) *QueryBuilder {
	return &QueryBuilder{
		client:      c,
		table:       table,
		queryParams: make(map[string]string),
	}
}

// Auth returns an auth client
func (c *Client) Auth() *AuthClient {
	return &AuthClient{
		client: c,
	}
}

// isJWT reports whether s is a compact JWT (three dot-separated base64 parts),
// i.e. a genuine bearer token. Supabase's newer opaque API keys
// (sb_publishable_*/sb_secret_*) are NOT JWTs; sending them as
// "Authorization: Bearer" makes PostgREST reject the request with
// "Expected 3 parts in JWT". For those keys the apikey header already conveys
// the correct role (anon or service) and a Bearer value must be omitted.
func isJWT(s string) bool {
	parts := strings.Split(s, ".")
	return len(parts) == 3 && parts[0] != "" && parts[1] != "" && parts[2] != ""
}

func (c *Client) rpc(ctx context.Context, method, endpoint string, body interface{}, useService bool) (*http.Response, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	var client *Client = c
	if useService && c.serviceClient != nil {
		client = c.serviceClient
	}

	var bodyReader io.Reader
	if body != nil {
		bodyBytes, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal request body: %w", err)
		}
		bodyReader = strings.NewReader(string(bodyBytes))
	}

	req, err := http.NewRequestWithContext(ctx, method, client.url+endpoint, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("apikey", client.apiKey)
	// Only attach an Authorization: Bearer header when we have a real JWT.
	// For service/admin calls the service key grants the role via the apikey
	// header (opaque keys are rejected as a Bearer by PostgREST); for legacy
	// JWT keys we still send the key as a Bearer token.
	switch {
	case useService && c.serviceKey != "" && isJWT(c.serviceKey):
		req.Header.Set("Authorization", "Bearer "+c.serviceKey)
	case !useService && isJWT(c.apiKey):
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}

	resp, err := client.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to execute request: %w", err)
	}

	return resp, nil
}

// GetUser retrieves the user based on the JWT token. It sends the user's
// own JWT (not the anon key) to Supabase's /auth/v1/user endpoint so that
// only a valid session is accepted.
func (c *Client) GetUser(ctx context.Context, token string) (map[string]interface{}, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", c.url+AuthAPISuffix+"user", nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("apikey", c.apiKey)
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to get user: %s", string(body))
	}

	var user map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&user); err != nil {
		return nil, fmt.Errorf("failed to decode user: %w", err)
	}

	return user, nil
}

type QueryBuilder struct {
	client      *Client
	table       string
	queryParams map[string]string
	selectQuery string
	filters     []string
	method      string      // HTTP method for deferred write ops (PATCH, DELETE)
	body        interface{} // data payload for deferred write ops
}

func (qb *QueryBuilder) Select(columns string) *QueryBuilder {
	qb.selectQuery = columns
	return qb
}

func (qb *QueryBuilder) Eq(column, value string) *QueryBuilder {
	qb.filters = append(qb.filters, fmt.Sprintf("%s=eq.%s", column, value))
	return qb
}

func (qb *QueryBuilder) Order(column string, desc bool) *QueryBuilder {
	direction := "asc"
	if desc {
		direction = "desc"
	}
	qb.filters = append(qb.filters, fmt.Sprintf("order=%s.%s", column, direction))
	return qb
}

func (qb *QueryBuilder) Limit(limit int) *QueryBuilder {
	qb.filters = append(qb.filters, fmt.Sprintf("limit=%d", limit))
	return qb
}

func (qb *QueryBuilder) Execute(ctx context.Context) ([]map[string]interface{}, error) {
	endpoint := PostgRESTAPISuffix + qb.table
	params := strings.Join(qb.filters, "&")
	if params != "" {
		endpoint += "?" + params
	}

	var resp *http.Response
	var err error

	if qb.method != "" {
		// Deferred write operation (PATCH/DELETE) — filters act as the WHERE clause
		if qb.selectQuery != "" {
			if strings.Contains(endpoint, "?") {
				endpoint += "&"
			} else {
				endpoint += "?"
			}
			endpoint += "select=" + qb.selectQuery
		}
		resp, err = qb.client.rpc(ctx, qb.method, endpoint, qb.body, true)
	} else {
		// GET — apply select query param
		if qb.selectQuery != "" {
			if strings.Contains(endpoint, "?") {
				endpoint += "&"
			} else {
				endpoint += "?"
			}
			endpoint += "select=" + qb.selectQuery
		}
		resp, err = qb.client.rpc(ctx, "GET", endpoint, nil, true)
	}
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("query failed: %s", string(body))
	}

	var results []map[string]interface{}
	decErr := json.NewDecoder(resp.Body).Decode(&results)
	if decErr != nil && decErr != io.EOF {
		return nil, fmt.Errorf("failed to decode results: %w", decErr)
	}

	return results, nil
}

func (qb *QueryBuilder) Insert(data map[string]interface{}) (*QueryBuilder, error) {
	ctx := context.Background()
	endpoint := PostgRESTAPISuffix + qb.table
	resp, err := qb.client.rpc(ctx, "POST", endpoint, data, true)
	if err != nil {
		return qb, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return qb, fmt.Errorf("insert failed: %s", string(body))
	}

	// Return the inserted data
	return qb, nil
}

// InsertReturning inserts data and returns the inserted row (with generated columns such as id).
func (qb *QueryBuilder) InsertReturning(data map[string]interface{}) (map[string]interface{}, error) {
	ctx := context.Background()
	endpoint := PostgRESTAPISuffix + qb.table + "?select=*"
	req, err := http.NewRequestWithContext(ctx, "POST", qb.client.url+endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	// Inserts that set user_id/explicit fields must run as the service role to
	// bypass RLS. With opaque API keys the service role is conveyed by the
	// apikey header alone (a Bearer value is not sent for opaque keys).
	apiKey := qb.client.apiKey
	if qb.client.serviceKey != "" {
		apiKey = qb.client.serviceKey
	}
	req.Header.Set("apikey", apiKey)
	if qb.client.serviceKey != "" && isJWT(qb.client.serviceKey) {
		req.Header.Set("Authorization", "Bearer "+qb.client.serviceKey)
	} else if isJWT(qb.client.apiKey) {
		req.Header.Set("Authorization", "Bearer "+qb.client.apiKey)
	}
	req.Header.Set("Prefer", "return=representation")
	bodyBytes, err := json.Marshal(data)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal data: %w", err)
	}
	req.Body = io.NopCloser(bytes.NewReader(bodyBytes))

	resp, err := qb.client.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("insert failed: %s", string(respBody))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read insert response: %w", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		// PostgREST may return an array for batch inserts; fall back.
		var arr []map[string]interface{}
		if err2 := json.Unmarshal(body, &arr); err2 != nil || len(arr) == 0 {
			return nil, fmt.Errorf("failed to decode result: %w", err)
		}
		result = arr[0]
	}
	return result, nil
}

func (qb *QueryBuilder) InsertMultiple(data []map[string]interface{}) (*QueryBuilder, error) {
	ctx := context.Background()
	endpoint := PostgRESTAPISuffix + qb.table
	resp, err := qb.client.rpc(ctx, "POST", endpoint, data, true)
	if err != nil {
		return qb, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return qb, fmt.Errorf("batch insert failed: %s", string(body))
	}

	return qb, nil
}

// RPC calls a Supabase stored procedure and returns the results as rows.
func (qb *QueryBuilder) RPC(function string, args map[string]interface{}) ([]map[string]interface{}, error) {
	ctx := context.Background()
	endpoint := PostgRESTAPISuffix + "rpc/" + function
	resp, err := qb.client.rpc(ctx, "POST", endpoint, args, true)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("rpc failed: %s", string(body))
	}

	var results []map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&results); err != nil {
		// RPC may return a scalar or empty body; treat as success
		return nil, nil
	}
	return results, nil
}

// Update stages a PATCH operation. It does NOT execute immediately;
// chain .Eq()/.Order() etc. and call .Execute(ctx) to send the request.
func (qb *QueryBuilder) Update(data map[string]interface{}) (*QueryBuilder, error) {
	qb.method = "PATCH"
	qb.body = data
	return qb, nil
}

// Delete stages a DELETE operation. It does NOT execute immediately;
// chain .Eq()/.Order() etc. and call .Execute(ctx) to send the request.
func (qb *QueryBuilder) Delete() (*QueryBuilder, error) {
	qb.method = "DELETE"
	qb.body = nil
	return qb, nil
}

type AuthClient struct {
	client *Client
}

func (a *AuthClient) SignUp(ctx context.Context, email, password string, data map[string]interface{}) (string, error) {
	// Preferred path: create the user through the GoTrue Admin API with
	// email_confirm=true. The admin endpoint (service_role key) does NOT send a
	// confirmation email, which bypasses Supabase's "over_email_send_rate_limit"
	// (HTTP 429) that throttles the public /auth/v1/signup endpoint once
	// email-confirmation is enabled on the project.
	if a.client.serviceKey != "" {
		adminData := map[string]interface{}{
			"email":         email,
			"password":      password,
			"email_confirm": true,
		}
		if data != nil {
			adminData["user_metadata"] = data
		}
		userID, err := a.adminCreateUser(ctx, adminData)
		if err == nil {
			log.Printf("[supabase] SignUp: created confirmed user via admin API id=%s email=%s", userID, email)
			return userID, nil
		}
		// Fall back to the public signup so the caller still gets a concrete
		// Supabase response rather than an opaque failure.
		log.Printf("[supabase] SignUp: admin create failed (%v); trying public signup", err)
	}

	// Fallback: public signup (anon key, no Bearer).
	signupData := map[string]interface{}{
		"email":    email,
		"password": password,
	}
	if data != nil {
		signupData["data"] = data
	}

	resp, err := a.client.rpc(ctx, "POST", AuthAPISuffix+"signup", signupData, false)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	log.Printf("[supabase] SignUp: public signup -> HTTP %d body=%s", resp.StatusCode, string(body))

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("failed to decode signup response: %w (body=%s)", err, string(body))
	}

	if result["user"] == nil {
		msg := ""
		if m, ok := result["msg"].(string); ok && m != "" {
			msg = m
		} else if e, ok := result["error"].(string); ok && e != "" {
			msg = e
		}
		if msg == "" {
			msg = "signup failed - check email format"
		}
		return "", fmt.Errorf("%s", msg)
	}

	user, ok := result["user"].(map[string]interface{})
	if !ok {
		return "", fmt.Errorf("invalid user data in response")
	}

	userID, ok := user["id"].(string)
	if !ok {
		return "", fmt.Errorf("missing user ID")
	}

	return userID, nil
}

// adminCreateUser creates a user via the GoTrue Admin API using the service_role
// key. Setting email_confirm=true means NO confirmation email is sent, so the
// email rate-limit (HTTP 429) does not apply. The admin endpoint also requires
// Authorization: Bearer <service-key> even for opaque keys (the apikey header
// alone is not sufficient for GoTrue admin endpoints, unlike PostgREST).
func (a *AuthClient) adminCreateUser(ctx context.Context, payload map[string]interface{}) (string, error) {
	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal admin create body: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", a.client.url+AuthAPISuffix+"admin/users", bytes.NewReader(bodyBytes))
	if err != nil {
		return "", fmt.Errorf("create admin signup request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("apikey", a.client.serviceKey)
	req.Header.Set("Authorization", "Bearer "+a.client.serviceKey)

	resp, err := a.client.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("execute admin signup: %w", err)
	}
	defer resp.Body.Close()

	respBytes, _ := io.ReadAll(resp.Body)
	log.Printf("[supabase] adminCreateUser -> HTTP %d body=%s", resp.StatusCode, string(respBytes))

	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("admin create user failed: %s", strings.TrimSpace(string(respBytes)))
	}

	var result map[string]interface{}
	_ = json.Unmarshal(respBytes, &result)

	if id, ok := result["id"].(string); ok && id != "" {
		return id, nil
	}
	return "", fmt.Errorf("admin create user: no id in response (body=%s)", strings.TrimSpace(string(respBytes)))
}

func (a *AuthClient) SignIn(ctx context.Context, email, password string) (string, error) {
	signinData := map[string]interface{}{
		"email":    email,
		"password": password,
	}

	// Supabase's /auth/v1/token requires grant_type=password as a query
	// parameter (not in the JSON body); omitting it returns unsupported_grant_type.
	resp, err := a.client.rpc(ctx, "POST", AuthAPISuffix+"token?grant_type=password", signinData, false)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	log.Printf("[supabase] SignIn: token exchange -> HTTP %d body=%s", resp.StatusCode, string(body))

	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("signin failed: %s", string(body))
	}

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("failed to decode signin response: %w (body=%s)", err, string(body))
	}

	accessToken, ok := result["access_token"].(string)
	if !ok {
		return "", fmt.Errorf("missing access token")
	}

	return accessToken, nil
}
