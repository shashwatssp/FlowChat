package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"time"

	"flowchat/backend/internal/supabase"

	"github.com/gin-gonic/gin"
)

// CalendarHandler manages the Google Calendar OAuth flow for bots.
// It stores OAuth tokens in the bot_calendar_tokens Supabase table and
// provides helpers to obtain a valid (auto-refreshed) access token.
type CalendarHandler struct {
	supabaseClient *supabase.Client
	clientID       string
	clientSecret   string
	redirectURL    string
	scopes         string

	googleAuthURL  string
	googleTokenURL string
	calendarAPIURL string
}

// NewCalendarHandler creates a new CalendarHandler.
func NewCalendarHandler(client *supabase.Client, clientID, clientSecret, redirectURL, scopes string) *CalendarHandler {
	return &CalendarHandler{
		supabaseClient: client,
		clientID:       clientID,
		clientSecret:   clientSecret,
		redirectURL:    redirectURL,
		scopes:         scopes,
		googleAuthURL:  "https://accounts.google.com/o/oauth2/v2/auth",
		googleTokenURL: "https://oauth2.googleapis.com/token",
		calendarAPIURL: "https://www.googleapis.com/calendar/v3/calendars/primary",
	}
}

// ---------------------------------------------------------------------------
// OAuth flow
// ---------------------------------------------------------------------------

// Connect redirects the bot owner to Google's OAuth consent screen.
// Query param: bot_id (required)
func (h *CalendarHandler) Connect(c *gin.Context) {
	botID := c.Query("bot_id")
	if botID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bot_id is required"})
		return
	}

	// Encode the bot_id into the state parameter so we can recover it in the
	// callback. Using base64 keeps the state opaque to the user.
	state := encodeState(botID)

	u, err := url.Parse(h.googleAuthURL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to build OAuth URL"})
		return
	}

	q := u.Query()
	q.Set("client_id", h.clientID)
	q.Set("redirect_uri", h.redirectURL)
	q.Set("response_type", "code")
	q.Set("scope", h.scopes)
	q.Set("access_type", "offline")
	q.Set("prompt", "consent") // force refresh token on every grant
	q.Set("state", state)
	u.RawQuery = q.Encode()

	log.Printf("[calendar] Connect: redirecting bot_id=%s to Google OAuth", botID)
	c.Redirect(http.StatusFound, u.String())
}

// Callback handles Google's OAuth redirect, exchanges the auth code for
// tokens, and stores them in bot_calendar_tokens.
func (h *CalendarHandler) Callback(c *gin.Context) {
	code := c.Query("code")
	state := c.Query("state")
	if code == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "authorization code is required"})
		return
	}

	botID, err := decodeState(state)
	if err != nil {
		log.Printf("[calendar] Callback: invalid state err=%v", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid state parameter"})
		return
	}

	// Exchange the authorization code for access + refresh tokens.
	tokenResp, err := h.exchangeCodeForToken(code)
	if err != nil {
		log.Printf("[calendar] Callback: token exchange failed bot_id=%s err=%v", botID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to exchange authorization code for tokens"})
		return
	}

	// Store (upsert) tokens in bot_calendar_tokens.
	expiry := time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second)
	tokenRow := map[string]interface{}{
		"bot_id":        botID,
		"access_token":  tokenResp.AccessToken,
		"refresh_token": tokenResp.RefreshToken,
		"token_type":    tokenResp.TokenType,
		"expiry":        expiry.Format(time.RFC3339),
		"scope":         tokenResp.Scope,
		"updated_at":    time.Now().Format(time.RFC3339),
	}

	// Delete any existing tokens row, then insert the new one.
	if tokDelQB, tokDelErr := h.supabaseClient.From("bot_calendar_tokens").Delete(); tokDelErr == nil {
		_, _ = tokDelQB.Eq("bot_id", botID).Execute(c.Request.Context())
	}
	inserted, err := h.supabaseClient.From("bot_calendar_tokens").InsertReturning(tokenRow)
	if err != nil {
		log.Printf("[calendar] Callback: failed to store tokens bot_id=%s err=%v", botID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to store calendar tokens"})
		return
	}

	log.Printf("[calendar] Callback: tokens stored bot_id=%s token_id=%s", botID, getString(inserted, "id"))
	c.JSON(http.StatusOK, gin.H{
		"message":            "Google Calendar connected successfully",
		"calendar_connected": true,
	})
}

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

type googleTokenResponse struct {
	AccessToken  string `json:"access_token"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
	Scope        string `json:"scope"`
	TokenType    string `json:"token_type"`
}

// exchangeCodeForToken exchanges an OAuth authorization code for tokens.
func (h *CalendarHandler) exchangeCodeForToken(code string) (*googleTokenResponse, error) {
	formData := url.Values{}
	formData.Set("code", code)
	formData.Set("client_id", h.clientID)
	formData.Set("client_secret", h.clientSecret)
	formData.Set("redirect_uri", h.redirectURL)
	formData.Set("grant_type", "authorization_code")

	resp, err := http.PostForm(h.googleTokenURL, formData)
	if err != nil {
		return nil, fmt.Errorf("http request to token endpoint failed: %w", err)
	}
	defer resp.Body.Close()

	var raw map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("failed to decode token response: %w", err)
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("token exchange failed: %v", raw)
	}

	// Manually extract fields to handle both string and float64 JSON types.
	out := &googleTokenResponse{
		TokenType: getString(raw, "token_type"),
	}
	if at, ok := raw["access_token"].(string); ok {
		out.AccessToken = at
	}
	if rt, ok := raw["refresh_token"].(string); ok {
		out.RefreshToken = rt
	}
	if sc, ok := raw["scope"].(string); ok {
		out.Scope = sc
	}
	if exp, ok := raw["expires_in"].(float64); ok {
		out.ExpiresIn = int(exp)
	}

	return out, nil
}

// refreshToken uses a refresh token to obtain a new access token.
func (h *CalendarHandler) refreshToken(refreshToken string) (*googleTokenResponse, error) {
	formData := url.Values{}
	formData.Set("client_id", h.clientID)
	formData.Set("client_secret", h.clientSecret)
	formData.Set("refresh_token", refreshToken)
	formData.Set("grant_type", "refresh_token")

	resp, err := http.PostForm(h.googleTokenURL, formData)
	if err != nil {
		return nil, fmt.Errorf("refresh token http request failed: %w", err)
	}
	defer resp.Body.Close()

	var raw map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("failed to decode refresh response: %w", err)
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("refresh token failed: %v", raw)
	}

	out := &googleTokenResponse{
		TokenType: getString(raw, "token_type"),
		Scope:     getString(raw, "scope"),
	}
	if at, ok := raw["access_token"].(string); ok {
		out.AccessToken = at
	}
	if rt, ok := raw["refresh_token"].(string); ok && rt != "" {
		out.RefreshToken = rt // Google may rotate refresh tokens
	}
	if exp, ok := raw["expires_in"].(float64); ok {
		out.ExpiresIn = int(exp)
	}

	return out, nil
}

// GetValidAccessToken fetches the bot's Google Calendar tokens, refreshing
// if necessary, and returns a valid bearer access token.
func (h *CalendarHandler) GetValidAccessToken(c *gin.Context, botID string) (string, error) {
	ctx := c.Request.Context()

	rows, err := h.supabaseClient.From("bot_calendar_tokens").
		Select("access_token,refresh_token,expiry").
		Eq("bot_id", botID).
		Execute(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to fetch calendar tokens: %w", err)
	}
	if len(rows) == 0 {
		return "", fmt.Errorf("calendar not connected for bot %s", botID)
	}

	row := rows[0]
	accessToken := getString(row, "access_token")
	refreshToken := getString(row, "refresh_token")
	expiryStr := getString(row, "expiry")

	// Check if the token is expired (with a 60-second safety margin).
	needsRefresh := false
	if expiryStr != "" {
		if exp, perr := time.Parse(time.RFC3339, expiryStr); perr == nil {
			needsRefresh = time.Now().Add(60 * time.Second).After(exp)
		} else {
			needsRefresh = true
		}
	} else {
		needsRefresh = true
	}

	if needsRefresh {
		if refreshToken == "" {
			return "", fmt.Errorf("access token expired and no refresh token available")
		}

		refreshed, err := h.refreshToken(refreshToken)
		if err != nil {
			log.Printf("[calendar] GetValidAccessToken: refresh failed bot_id=%s err=%v", botID, err)
			return "", fmt.Errorf("failed to refresh access token: %w", err)
		}

		// Update stored tokens.
		newExpiry := time.Now().Add(time.Duration(refreshed.ExpiresIn) * time.Second)
		updateData := map[string]interface{}{
			"access_token": refreshed.AccessToken,
			"expiry":       newExpiry.Format(time.RFC3339),
			"updated_at":   time.Now().Format(time.RFC3339),
		}
		if refreshed.RefreshToken != "" {
			updateData["refresh_token"] = refreshed.RefreshToken
		}
		tokQB, tokErr := h.supabaseClient.From("bot_calendar_tokens").Update(updateData)
		if tokErr != nil {
			log.Printf("[calendar] GetValidAccessToken: failed to build token update bot_id=%s err=%v", botID, tokErr)
		} else if _, err := tokQB.Eq("bot_id", botID).Execute(ctx); err != nil {
			log.Printf("[calendar] GetValidAccessToken: failed to persist refreshed tokens bot_id=%s err=%v", botID, err)
		}

		accessToken = refreshed.AccessToken
	}

	return accessToken, nil
}

// ---------------------------------------------------------------------------
// Google Calendar API helpers
// ---------------------------------------------------------------------------

// CreateCalendarEvent creates a Google Calendar event for the given appointment
// and returns the Google event ID. Returns an empty string if the bot's
// calendar is not connected.
func (h *CalendarHandler) CreateCalendarEvent(c *gin.Context, botID, summary, description, customerEmail string, startTime, endTime time.Time) (string, string, error) {
	accessToken, err := h.GetValidAccessToken(c, botID)
	if err != nil {
		return "", "", err
	}

	event := map[string]interface{}{
		"summary":     summary,
		"description": description,
		"start": map[string]interface{}{
			"dateTime": startTime.Format(time.RFC3339),
			"timeZone": startTime.Location().String(),
		},
		"end": map[string]interface{}{
			"dateTime": endTime.Format(time.RFC3339),
			"timeZone": endTime.Location().String(),
		},
	}
	if customerEmail != "" {
		event["attendees"] = []map[string]interface{}{
			{"email": customerEmail},
		}
	}

	body, _ := json.Marshal(event)
	req, err := http.NewRequestWithContext(c.Request.Context(), "POST", h.calendarAPIURL+"/events", bytes.NewReader(body))
	if err != nil {
		return "", "", fmt.Errorf("failed to create calendar event request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("calendar event API call failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		respBody, _ := io.ReadAll(resp.Body)
		log.Printf("[calendar] CreateCalendarEvent: API error bot_id=%s status=%d body=%s", botID, resp.StatusCode, string(respBody))
		return "", "", fmt.Errorf("google calendar API returned %d: %s", resp.StatusCode, string(respBody))
	}

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", "", fmt.Errorf("failed to decode calendar event response: %w", err)
	}

	eventID := getString(result, "id")
	htmlLink := getString(result, "htmlLink")
	log.Printf("[calendar] CreateCalendarEvent: event created bot_id=%s event_id=%s", botID, eventID)

	return eventID, htmlLink, nil
}

// ---------------------------------------------------------------------------
// State encoding for OAuth (stateless, no server-side session needed)
// ---------------------------------------------------------------------------

// encodeState base64-encodes the bot_id so it can survive the OAuth redirect.
func encodeState(botID string) string {
	return url.QueryEscape(botID)
}

// decodeState extracts the bot_id from the OAuth state parameter.
func decodeState(state string) (string, error) {
	botID, err := url.QueryUnescape(state)
	if err != nil {
		return "", fmt.Errorf("failed to decode state: %w", err)
	}
	if botID == "" {
		return "", fmt.Errorf("bot_id is empty")
	}
	return botID, nil
}
