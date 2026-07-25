package supabase

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
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
	if useService && client.serviceKey != "" {
		req.Header.Set("Authorization", "Bearer "+client.serviceKey)
	} else {
		req.Header.Set("Authorization", "Bearer "+client.apiKey)
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
	method      string        // HTTP method for deferred write ops (PATCH, DELETE)
	body        interface{}   // data payload for deferred write ops
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
	if err := json.NewDecoder(resp.Body).Decode(&results); err != nil {
		return nil, fmt.Errorf("failed to decode results: %w", err)
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
	req.Header.Set("apikey", qb.client.apiKey)
	// Use service key (bypasses RLS) when available, otherwise fallback to anon key
	if qb.client.serviceKey != "" {
		req.Header.Set("Authorization", "Bearer "+qb.client.serviceKey)
	} else {
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

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("failed to decode signup response: %w", err)
	}

	if result["user"] == nil {
		return "", fmt.Errorf("signup failed - check email format")
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

func (a *AuthClient) SignIn(ctx context.Context, email, password string) (string, error) {
	signinData := map[string]interface{}{
		"email":    email,
		"password": password,
	}

	resp, err := a.client.rpc(ctx, "POST", AuthAPISuffix+"token", signinData, false)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("signin failed: %s", string(body))
	}

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("failed to decode signin response: %w", err)
	}

	accessToken, ok := result["access_token"].(string)
	if !ok {
		return "", fmt.Errorf("missing access token")
	}

	return accessToken, nil
}
