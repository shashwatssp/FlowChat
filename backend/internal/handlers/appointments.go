package handlers

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"flowchat/backend/internal/supabase"

	"github.com/gin-gonic/gin"
)

// AppointmentHandler manages the appointment / booking lifecycle for a bot.
// It depends only on the Supabase client (Go + Gin + Supabase PostgREST).
type AppointmentHandler struct {
	supabaseClient *supabase.Client
}

// NewAppointmentHandler creates a new AppointmentHandler.
func NewAppointmentHandler(client *supabase.Client) *AppointmentHandler {
	return &AppointmentHandler{
		supabaseClient: client,
	}
}

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

// CalendarSettingsResponse is returned by GetCalendarSettings.
type CalendarSettingsResponse struct {
	CalendarEnabled            bool                     `json:"calendar_enabled"`
	CalendarConnected          bool                     `json:"calendar_connected"`
	Timezone                   string                   `json:"timezone"`
	AppointmentDurationMinutes int                      `json:"appointment_duration_minutes"`
	AvailabilityRules          []map[string]interface{} `json:"availability_rules"`
	AvailabilityExceptions     []map[string]interface{} `json:"availability_exceptions"`
}

// UpdateCalendarSettingsRequest updates calendar settings and availability rules.
type UpdateCalendarSettingsRequest struct {
	CalendarEnabled            bool                           `json:"calendar_enabled"`
	Timezone                   string                         `json:"timezone"`
	AppointmentDurationMinutes int                            `json:"appointment_duration_minutes"`
	AvailabilityRules          []AvailabilityRuleRequest      `json:"availability_rules"`
	AvailabilityExceptions     []AvailabilityExceptionRequest `json:"availability_exceptions"`
}

type AvailabilityRuleRequest struct {
	DayOfWeek int    `json:"day_of_week"` // 0=Sunday .. 6=Saturday
	StartTime string `json:"start_time"`  // "15:04:05"
	EndTime   string `json:"end_time"`    // "15:04:05"
	Timezone  string `json:"timezone"`    // e.g. "America/New_York"
}

type AvailabilityExceptionRequest struct {
	ExceptionDate string `json:"exception_date"` // "2006-01-02"
	IsOpen        bool   `json:"is_open"`
	StartTime     string `json:"start_time"` // "15:04:05"
	EndTime       string `json:"end_time"`   // "15:04:05"
	Timezone      string `json:"timezone"`
	Note          string `json:"note"`
}

// CheckAvailabilityRequest is the body for checking a specific slot.
type CheckAvailabilityRequest struct {
	StartTime string `json:"start_time" binding:"required"` // RFC3339
	EndTime   string `json:"end_time" binding:"required"`   // RFC3339
}

// ConflictInfo describes a slot that is already taken.
type ConflictInfo struct {
	Type      string `json:"type"` // "appointment" | "hold" | "rule"
	ID        string `json:"id"`
	StartTime string `json:"start_time"`
	EndTime   string `json:"end_time"`
	Status    string `json:"status,omitempty"`
}

type CheckAvailabilityResponse struct {
	Available bool           `json:"available"`
	Conflicts []ConflictInfo `json:"conflicts"`
}

// BookAppointmentRequest is the body for creating an appointment.
type BookAppointmentRequest struct {
	StartTime     string `json:"start_time" binding:"required"`     // RFC3339
	EndTime       string `json:"end_time" binding:"required"`       // RFC3339
	CustomerName  string `json:"customer_name" binding:"required"`  // REQUIRED
	CustomerPhone string `json:"customer_phone" binding:"required"` // REQUIRED
	CustomerEmail string `json:"customer_email"`
	Notes         string `json:"notes"`
}

type BookAppointmentResponse struct {
	ID      string `json:"id"`
	Status  string `json:"status"`
	Message string `json:"message"`
}

// AvailabilitySlot returned by GetAvailability.
type AvailabilitySlot struct {
	StartTime string `json:"start_time"` // RFC3339
	EndTime   string `json:"end_time"`   // RFC3339
}

type AvailabilityResponse struct {
	Timezone string             `json:"timezone"`
	Slots    []AvailabilitySlot `json:"slots"`
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

var rfc3339 = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}`)

// parseTime parses an RFC3339 timestamp, tolerating a trailing "Z".
func parseTime(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	if !rfc3339.MatchString(s) {
		return time.Time{}, fmt.Errorf("invalid timestamp format: %s", s)
	}
	return time.Parse(time.RFC3339, s)
}

// parseTimeOfDay parses a "15:04:05" string into a time.Time (on date 0001-01-01).
func parseTimeOfDay(s string) (time.Time, error) {
	return time.Parse("15:04:05", strings.TrimSpace(s))
}

// timeOverlap reports whether two half-open intervals [a1,a2) and [b1,b2) overlap.
func timeOverlap(a1, a2, b1, b2 time.Time) bool {
	return a1.Before(a2) && b1.Before(b2) && a1.Before(b2) && b1.Before(a2)
}

// fetchBot pulls the bot row by id (or slug). Returns nil if not found.
func (h *AppointmentHandler) fetchBot(ctx context.Context, botID string) (map[string]interface{}, error) {
	rows, err := h.supabaseClient.From("bots").
		// Use Select("*") so newly-added columns (e.g.
		// appointment_duration_minutes) are returned automatically and the
		// query never breaks on a missing optional column.
		Select("*").
		Eq("id", botID).
		Execute(ctx)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	return rows[0], nil
}

// hasCalendarTokens reports whether Google Calendar OAuth tokens exist for the bot.
func (h *AppointmentHandler) hasCalendarTokens(ctx context.Context, botID string) (bool, error) {
	rows, err := h.supabaseClient.From("bot_calendar_tokens").
		Select("id").
		Eq("bot_id", botID).
		Execute(ctx)
	if err != nil {
		return false, err
	}
	return len(rows) > 0, nil
}

// fetchAvailabilityRules returns all availability rules for a bot.
func (h *AppointmentHandler) fetchAvailabilityRules(ctx context.Context, botID string) ([]map[string]interface{}, error) {
	return h.supabaseClient.From("availability_rules").
		Select("*").
		Eq("bot_id", botID).
		Execute(ctx)
}

// fetchAvailabilityExceptions returns all availability exceptions for a bot.
func (h *AppointmentHandler) fetchAvailabilityExceptions(ctx context.Context, botID string) ([]map[string]interface{}, error) {
	return h.supabaseClient.From("availability_exceptions").
		Select("*").
		Eq("bot_id", botID).
		Execute(ctx)
}

// fetchAppointmentsForBot returns all non-cancelled appointments for a bot.
func (h *AppointmentHandler) fetchAppointmentsForBot(ctx context.Context, botID string) ([]map[string]interface{}, error) {
	rows, err := h.supabaseClient.From("appointments").
		Select("id,start_time,end_time,customer_name,status").
		Eq("bot_id", botID).
		Execute(ctx)
	if err != nil {
		return nil, err
	}
	// Filter out cancelled appointments in Go (we can't filter status via Eq easily
	// across all PostgREST versions, and the column type is text).
	var active []map[string]interface{}
	for _, r := range rows {
		if s, _ := r["status"].(string); s == "" || s == "cancelled" {
			continue
		}
		active = append(active, r)
	}
	return active, nil
}

// fetchHoldsForBot returns active (non-expired) holds for a bot.
func (h *AppointmentHandler) fetchHoldsForBot(ctx context.Context, botID string) ([]map[string]interface{}, error) {
	rows, err := h.supabaseClient.From("appointment_holds").
		Select("id,start_time,end_time,expires_at").
		Eq("bot_id", botID).
		Execute(ctx)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	var active []map[string]interface{}
	for _, r := range rows {
		if exp, _ := r["expires_at"].(string); exp != "" {
			if t, perr := time.Parse(time.RFC3339, exp); perr == nil && t.Before(now) {
				continue // expired hold — skip
			}
		}
		active = append(active, r)
	}
	return active, nil
}

// ---------------------------------------------------------------------------
// Endpoint 1: GetCalendarSettings
// ---------------------------------------------------------------------------

// GetCalendarSettings returns the bot's calendar configuration: whether the
// calendar is enabled, whether it's connected (OAuth tokens exist), the
// timezone, and all availability rules / exceptions.
func (h *AppointmentHandler) GetCalendarSettings(c *gin.Context) {
	botID := c.Param("botID")
	ctx := c.Request.Context()

	bot, err := h.fetchBot(ctx, botID)
	if err != nil || bot == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Bot not found"})
		return
	}

	rules, _ := h.fetchAvailabilityRules(ctx, botID)
	exceptions, _ := h.fetchAvailabilityExceptions(ctx, botID)
	connected, _ := h.hasCalendarTokens(ctx, botID)

	c.JSON(http.StatusOK, CalendarSettingsResponse{
		CalendarEnabled:            getString(bot, "calendar_enabled") == "true",
		CalendarConnected:          connected,
		Timezone:                   getString(bot, "timezone"),
		AppointmentDurationMinutes: botAppointmentDuration(bot),
		AvailabilityRules:          rules,
		AvailabilityExceptions:     exceptions,
	})
}

// ---------------------------------------------------------------------------
// Endpoint 2: UpdateCalendarSettings
// ---------------------------------------------------------------------------

// UpdateCalendarSettings updates the bot's timezone, calendar_enabled flag,
// and replaces all availability rules and exceptions.
func (h *AppointmentHandler) UpdateCalendarSettings(c *gin.Context) {
	botID := c.Param("botID")
	ctx := c.Request.Context()

	var req UpdateCalendarSettingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Update bot row
	botData := map[string]interface{}{
		"calendar_enabled": req.CalendarEnabled,
		"updated_at":       time.Now().Format(time.RFC3339),
	}
	if req.Timezone != "" {
		botData["timezone"] = req.Timezone
	}
	botQB, botErr := h.supabaseClient.From("bots").Update(botData)
	if botErr != nil {
		log.Printf("[appointments] UpdateCalendarSettings: failed to build bot update bot_id=%s err=%v", botID, botErr)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update calendar settings"})
		return
	}
	if _, err := botQB.Eq("id", botID).Execute(ctx); err != nil {
		log.Printf("[appointments] UpdateCalendarSettings: failed to update bot bot_id=%s err=%v", botID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update calendar settings"})
		return
	}

	// Best-effort persist of the configured appointment duration. This is a
	// separate update so that if the appointment_duration_minutes column has
	// not been migrated yet (PostgREST PGRST204), the rest of the calendar
	// settings still save successfully and the duration simply falls back to
	// its default (30). Once the migration is applied, this persists normally.
	if req.AppointmentDurationMinutes > 0 {
		durData := map[string]interface{}{
			"appointment_duration_minutes": req.AppointmentDurationMinutes,
			"updated_at":                   time.Now().Format(time.RFC3339),
		}
		durQB, durErr := h.supabaseClient.From("bots").Update(durData)
		if durErr != nil {
			log.Printf("[appointments] UpdateCalendarSettings: duration update non-fatal bot_id=%s err=%v", botID, durErr)
		} else if _, derr := durQB.Eq("id", botID).Execute(ctx); derr != nil {
			log.Printf("[appointments] UpdateCalendarSettings: duration update non-fatal bot_id=%s err=%v", botID, derr)
		}
	}

	// Replace availability rules
	if req.AvailabilityRules != nil {
		rulesDelQB, rulesDelErr := h.supabaseClient.From("availability_rules").Delete()
		if rulesDelErr != nil {
			log.Printf("[appointments] UpdateCalendarSettings: failed to build rules delete bot_id=%s err=%v", botID, rulesDelErr)
		} else if _, err := rulesDelQB.Eq("bot_id", botID).Execute(ctx); err != nil {
			log.Printf("[appointments] UpdateCalendarSettings: failed to clear rules bot_id=%s err=%v", botID, err)
		}
		for _, r := range req.AvailabilityRules {
			rule := map[string]interface{}{
				"bot_id":      botID,
				"day_of_week": r.DayOfWeek,
				"start_time":  r.StartTime,
				"end_time":    r.EndTime,
				"timezone":    r.Timezone,
			}
			if _, err := h.supabaseClient.From("availability_rules").InsertReturning(rule); err != nil {
				log.Printf("[appointments] UpdateCalendarSettings: failed to insert rule bot_id=%s err=%v", botID, err)
			}
		}
	}

	// Replace availability exceptions
	if req.AvailabilityExceptions != nil {
		excDelQB, excDelErr := h.supabaseClient.From("availability_exceptions").Delete()
		if excDelErr != nil {
			log.Printf("[appointments] UpdateCalendarSettings: failed to build exceptions delete bot_id=%s err=%v", botID, excDelErr)
		} else if _, err := excDelQB.Eq("bot_id", botID).Execute(ctx); err != nil {
			log.Printf("[appointments] UpdateCalendarSettings: failed to clear exceptions bot_id=%s err=%v", botID, err)
		}
		for _, e := range req.AvailabilityExceptions {
			exc := map[string]interface{}{
				"bot_id":         botID,
				"exception_date": e.ExceptionDate,
				"is_open":        e.IsOpen,
				"start_time":     e.StartTime,
				"end_time":       e.EndTime,
				"timezone":       e.Timezone,
				"note":           e.Note,
			}
			if _, err := h.supabaseClient.From("availability_exceptions").InsertReturning(exc); err != nil {
				log.Printf("[appointments] UpdateCalendarSettings: failed to insert exception bot_id=%s err=%v", botID, err)
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{"message": "Calendar settings updated successfully"})
}

// ---------------------------------------------------------------------------
// Endpoint 3: ListAppointments
// ---------------------------------------------------------------------------

// ListAppointments returns all appointments for a bot, optionally filtered
// by status via the ?status= query parameter.
func (h *AppointmentHandler) ListAppointments(c *gin.Context) {
	botID := c.Param("botID")
	ctx := c.Request.Context()

	query := h.supabaseClient.From("appointments").
		Select("id,bot_id,start_time,end_time,customer_name,customer_phone,customer_email,notes,status,calendar_event_id,created_at,updated_at").
		Eq("bot_id", botID).
		Order("start_time", true)

	if status := c.Query("status"); status != "" {
		query = query.Eq("status", status)
	}

	rows, err := query.Execute(ctx)
	if err != nil {
		log.Printf("[appointments] ListAppointments: failed bot_id=%s err=%v", botID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch appointments"})
		return
	}

	appointments := make([]map[string]interface{}, 0, len(rows))
	for _, row := range rows {
		appointments = append(appointments, row)
	}

	c.JSON(http.StatusOK, gin.H{"appointments": appointments})
}

// ---------------------------------------------------------------------------
// Endpoint 4: CheckAvailability
// ---------------------------------------------------------------------------

// CheckAvailability checks whether a specific [start_time, end_time) slot is
// free for the given bot, considering existing appointments and holds.
func (h *AppointmentHandler) CheckAvailability(c *gin.Context) {
	botID := c.Param("botID")
	ctx := c.Request.Context()

	var req CheckAvailabilityRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		// Also accept query params for convenience
		req.StartTime = c.Query("start_time")
		req.EndTime = c.Query("end_time")
		if req.StartTime == "" || req.EndTime == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
	}

	start, err := parseTime(req.StartTime)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("invalid start_time: %v", err)})
		return
	}
	end, err := parseTime(req.EndTime)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("invalid end_time: %v", err)})
		return
	}
	if !end.After(start) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "end_time must be after start_time"})
		return
	}

	available, conflicts := h.checkSlot(ctx, botID, start, end)
	c.JSON(http.StatusOK, CheckAvailabilityResponse{
		Available: available,
		Conflicts: conflicts,
	})
}

// checkSlot performs the actual availability check against appointments and holds.
func (h *AppointmentHandler) checkSlot(ctx context.Context, botID string, start, end time.Time) (bool, []ConflictInfo) {
	var conflicts []ConflictInfo

	// Check existing appointments
	appointments, _ := h.fetchAppointmentsForBot(ctx, botID)
	for _, appt := range appointments {
		aStart, _ := parseTime(getString(appt, "start_time"))
		aEnd, _ := parseTime(getString(appt, "end_time"))
		if aStart.IsZero() || aEnd.IsZero() {
			continue
		}
		if timeOverlap(start, end, aStart, aEnd) {
			conflicts = append(conflicts, ConflictInfo{
				Type:      "appointment",
				ID:        getString(appt, "id"),
				StartTime: getString(appt, "start_time"),
				EndTime:   getString(appt, "end_time"),
				Status:    getString(appt, "status"),
			})
		}
	}

	// Check active holds
	holds, _ := h.fetchHoldsForBot(ctx, botID)
	for _, hold := range holds {
		hStart, _ := parseTime(getString(hold, "start_time"))
		hEnd, _ := parseTime(getString(hold, "end_time"))
		if hStart.IsZero() || hEnd.IsZero() {
			continue
		}
		if timeOverlap(start, end, hStart, hEnd) {
			conflicts = append(conflicts, ConflictInfo{
				Type:      "hold",
				ID:        getString(hold, "id"),
				StartTime: getString(hold, "start_time"),
				EndTime:   getString(hold, "end_time"),
			})
		}
	}

	// Also check availability rules: the slot must fall within at least one
	// rule's day-of-week range (and not be excluded by an exception).
	rules, _ := h.fetchAvailabilityRules(ctx, botID)
	exceptions, _ := h.fetchAvailabilityExceptions(ctx, botID)

	if !h.isSlotWithinAvailability(ctx, start, end, rules, exceptions) {
		conflicts = append(conflicts, ConflictInfo{
			Type: "rule",
			ID:   "out-of-hours",
		})
	}

	return len(conflicts) == 0, conflicts
}

// isSlotWithinAvailability checks whether [start, end) falls within the
// bot's availability rules, accounting for day-of-week and exceptions.
// The start/end times arrive as UTC (from the frontend's .toISOString()),
// while rule time-of-day strings are stored in the bot's local timezone.
// We must evaluate the rule window in that timezone so the overlap check
// compares absolute instants correctly.
func (h *AppointmentHandler) isSlotWithinAvailability(ctx context.Context, start, end time.Time, rules []map[string]interface{}, exceptions []map[string]interface{}) bool {
	// Fail-closed: when no weekly working-hours rules are configured, no slot
	// is considered within availability — so appointments cannot be made outside
	// of explicitly configured working hours (previously a bot with no rules
	// would accept any slot).
	if len(rules) == 0 {
		return false
	}

	// Pick the timezone from the first rule (all rules for a bot share it).
	tz := getString(rules[0], "timezone")
	loc, locErr := time.LoadLocation(tz)
	if locErr != nil || loc == nil {
		loc = time.UTC
	}

	// Check exceptions first (they override rules). Compute the date in
	// the rule timezone so slots near midnight UTC still map to the correct
	// local calendar date.
	exceptionDate := start.In(loc).Format("2006-01-02")
	for _, exc := range exceptions {
		if getString(exc, "exception_date") != exceptionDate {
			continue
		}
		if getString(exc, "is_open") == "true" || getString(exc, "is_open") == "1" {
			return true // explicitly open on this date
		}
		return false // explicitly closed
	}

	// Check day-of-week rules. The weekday and time-of-day are evaluated in
	// the rule timezone, not in UTC, because the frontend sends times converted
	// to UTC via .toISOString() while rule times are stored in local time.
	dayOfWeek := int(start.In(loc).Weekday())
	for _, rule := range rules {
		if getInt64(rule, "day_of_week") != int64(dayOfWeek) {
			continue
		}
		ruleStart, _ := parseTimeOfDay(getString(rule, "start_time"))
		ruleEnd, _ := parseTimeOfDay(getString(rule, "end_time"))
		if ruleStart.IsZero() || ruleEnd.IsZero() {
			continue
		}
		// Build the rule's working-hours window in the rule timezone so
		// time-of-day strings (local) are interpreted correctly. Go's
		// time.Time comparison uses absolute instants, so timeOverlap below
		// works across timezones.
		slotStart := time.Date(start.Year(), start.Month(), start.Day(),
				ruleStart.Hour(), ruleStart.Minute(), ruleStart.Second(), 0, loc)
		slotEnd := time.Date(start.Year(), start.Month(), start.Day(),
			ruleEnd.Hour(), ruleEnd.Minute(), ruleEnd.Second(), 0, loc)
		if timeOverlap(start, end, slotStart, slotEnd) {
			return true
		}
	}

	return false
}

// CheckBotCalendarReady is a convenience method for the chat handler: it
// returns true when the bot has calendar enabled, calendar connected, and
// at least one availability rule configured.
func (h *AppointmentHandler) CheckBotCalendarReady(ctx context.Context, botID string) (bool, error) {
	bot, err := h.fetchBot(ctx, botID)
	if err != nil || bot == nil {
		return false, fmt.Errorf("bot not found")
	}
	if getString(bot, "calendar_enabled") != "true" {
		return false, nil
	}
	connected, err := h.hasCalendarTokens(ctx, botID)
	if err != nil || !connected {
		return false, nil
	}
	rules, err := h.fetchAvailabilityRules(ctx, botID)
	if err != nil {
		return false, err
	}
	return len(rules) > 0, nil
}

// ---------------------------------------------------------------------------
// Endpoint 5: BookAppointment
// ---------------------------------------------------------------------------

// BookAppointment creates a confirmed appointment. customer_name and
// customer_phone are required. Returns 409 Conflict if the slot is already
// taken (race-safe via the UNIQUE(bot_id, start_time, end_time) constraint).
func (h *AppointmentHandler) BookAppointment(c *gin.Context) {
	botID := c.Param("botID")
	ctx := c.Request.Context()

	var req BookAppointmentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	start, err := parseTime(req.StartTime)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("invalid start_time: %v", err)})
		return
	}
	end, err := parseTime(req.EndTime)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("invalid end_time: %v", err)})
		return
	}
	if !end.After(start) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "end_time must be after start_time"})
		return
	}

	// Quick availability check before attempting insert.
	available, conflicts := h.checkSlot(ctx, botID, start, end)
	if !available {
		conflictStrs := make([]string, 0, len(conflicts))
		for _, ci := range conflicts {
			conflictStrs = append(conflictStrs, fmt.Sprintf("%s:%s", ci.Type, ci.ID))
		}
		c.JSON(http.StatusConflict, gin.H{
			"error":     "Time slot is not available",
			"conflicts": conflictStrs,
		})
		return
	}

	// Attempt to acquire a booking lock (best-effort distributed lock).
	slotKey := fmt.Sprintf("%sT%d", botID, start.UnixNano())
	lockData := map[string]interface{}{
		"bot_id":    botID,
		"slot_key":  slotKey,
		"locked_at": time.Now().Format(time.RFC3339),
		"locked_by": fmt.Sprintf("book:%s", req.CustomerName),
	}
	if _, lockErr := h.supabaseClient.From("booking_locks").InsertReturning(lockData); lockErr != nil {
		// Lock already held by another request — slot is being processed.
		log.Printf("[appointments] BookAppointment: lock held bot_id=%s slot=%s", botID, slotKey)
		c.JSON(http.StatusConflict, gin.H{"error": "Slot is being processed, please try again"})
		return
	}

	// Insert the appointment. The UNIQUE(bot_id, start_time, end_time)
	// constraint catches any race-condition double-booking.
	apptData := map[string]interface{}{
		"bot_id":         botID,
		"start_time":     req.StartTime,
		"end_time":       req.EndTime,
		"customer_name":  req.CustomerName,
		"customer_phone": req.CustomerPhone,
		"customer_email": req.CustomerEmail,
		"notes":          req.Notes,
		"status":         "pending",
	}
	inserted, err := h.supabaseClient.From("appointments").InsertReturning(apptData)
	if err != nil {
		// Clean up the lock.
		if lbQB, lbErr := h.supabaseClient.From("booking_locks").Delete(); lbErr == nil {
			_, _ = lbQB.Eq("bot_id", botID).Eq("slot_key", slotKey).Execute(ctx)
		}
		if isUniqueViolation(err) {
			c.JSON(http.StatusConflict, gin.H{
				"error": "Time slot is already booked",
				"conflicts": []ConflictInfo{{
					Type: "appointment",
				}},
			})
			return
		}
		log.Printf("[appointments] BookAppointment: insert failed bot_id=%s err=%v", botID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create appointment"})
		return
	}

	// Clean up the lock.
	if lbQB, lbErr := h.supabaseClient.From("booking_locks").Delete(); lbErr == nil {
		_, _ = lbQB.Eq("bot_id", botID).Eq("slot_key", slotKey).Execute(ctx)
	}

	c.JSON(http.StatusCreated, BookAppointmentResponse{
		ID:      getString(inserted, "id"),
		Status:  getString(inserted, "status"),
		Message: "Appointment booked successfully",
	})
}

// ---------------------------------------------------------------------------
// Endpoint 6: CancelAppointment
// ---------------------------------------------------------------------------

// CancelAppointment cancels an appointment by setting its status to 'cancelled'.
func (h *AppointmentHandler) CancelAppointment(c *gin.Context) {
	botID := c.Param("botID")
	appointmentID := c.Param("appointmentID")
	ctx := c.Request.Context()

	// Verify the appointment belongs to this bot.
	rows, err := h.supabaseClient.From("appointments").
		Select("id,status").
		Eq("bot_id", botID).
		Eq("id", appointmentID).
		Execute(ctx)
	if err != nil || len(rows) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Appointment not found"})
		return
	}

	// Update status to cancelled.
	apptQB, apptErr := h.supabaseClient.From("appointments").Update(map[string]interface{}{
		"status":     "cancelled",
		"updated_at": time.Now().Format(time.RFC3339),
	})
	if apptErr != nil {
		log.Printf("[appointments] CancelAppointment: failed to build update id=%s err=%v", appointmentID, apptErr)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to cancel appointment"})
		return
	}
	if _, err := apptQB.Eq("id", appointmentID).Execute(ctx); err != nil {
		log.Printf("[appointments] CancelAppointment: failed id=%s err=%v", appointmentID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to cancel appointment"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Appointment cancelled successfully"})
}

// ---------------------------------------------------------------------------
// Endpoint 7: GetAvailability
// ---------------------------------------------------------------------------

// GetAvailability generates available time slots for a date range based on
// the bot's availability rules and exceptions, filtering out slots that are
// already taken by appointments or holds.
//
// Query params:
//
//	start_date=2006-01-02   (required)
//	end_date=2006-01-02     (required)
//	duration=30             (minutes, default 30)
func (h *AppointmentHandler) GetAvailability(c *gin.Context) {
	botID := c.Param("botID")
	ctx := c.Request.Context()

	startDateStr := c.Query("start_date")
	endDateStr := c.Query("end_date")
	if startDateStr == "" || endDateStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "start_date and end_date query parameters are required"})
		return
	}

	startDate, err := time.Parse("2006-01-02", startDateStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid start_date, expected YYYY-MM-DD"})
		return
	}
	endDate, err := time.Parse("2006-01-02", endDateStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid end_date, expected YYYY-MM-DD"})
		return
	}

	durationMinutes := 30
	if d := c.Query("duration"); d != "" {
		if parsed, perr := parseInt(d); perr == nil && parsed > 0 {
			durationMinutes = parsed
		}
	}
	duration := time.Duration(durationMinutes) * time.Minute

	// Fetch rules, exceptions, appointments, and holds.
	rules, _ := h.fetchAvailabilityRules(ctx, botID)
	exceptions, _ := h.fetchAvailabilityExceptions(ctx, botID)
	appointments, _ := h.fetchAppointmentsForBot(ctx, botID)
	holds, _ := h.fetchHoldsForBot(ctx, botID)

	// Build a set of unavailable intervals per day.
	type interval struct{ start, end time.Time }
	blocked := make([]interval, 0)

	for _, appt := range appointments {
		s, _ := parseTime(getString(appt, "start_time"))
		e, _ := parseTime(getString(appt, "end_time"))
		if !s.IsZero() && !e.IsZero() {
			blocked = append(blocked, interval{s, e})
		}
	}
	for _, hold := range holds {
		s, _ := parseTime(getString(hold, "start_time"))
		e, _ := parseTime(getString(hold, "end_time"))
		if !s.IsZero() && !e.IsZero() {
			blocked = append(blocked, interval{s, e})
		}
	}

	// Build exception lookup: date -> (is_open, start, end)
	excMap := make(map[string]struct {
		isOpen bool
		start  time.Time
		end    time.Time
	})
	for _, exc := range exceptions {
		excMap[getString(exc, "exception_date")] = struct {
			isOpen bool
			start  time.Time
			end    time.Time
		}{
			isOpen: getString(exc, "is_open") == "true",
			start:  mustParseTimeOfDay(getString(exc, "start_time")),
			end:    mustParseTimeOfDay(getString(exc, "end_time")),
		}
	}

	bot, _ := h.fetchBot(ctx, botID)
	timeZone := getString(bot, "timezone")
	if timeZone == "" {
		timeZone = "UTC"
	}
	// No explicit ?duration= param was supplied: fall back to the bot's
	// persisted default slot length (defaults to 30 minutes).
	if c.Query("duration") == "" {
		if d := botAppointmentDuration(bot); d > 0 {
			durationMinutes = d
			duration = time.Duration(durationMinutes) * time.Minute
		}
	}
	loc, _ := time.LoadLocation(timeZone)
	if loc == nil {
		loc = time.UTC
	}

	var slots []AvailabilitySlot
	current := startDate
	for !current.After(endDate) {
		dateStr := current.Format("2006-01-02")
		dayOfWeek := int(current.Weekday())

		// Determine the open window for this day.
		windowStart, windowEnd := time.Time{}, time.Time{}
		var isOpen bool

		if exc, ok := excMap[dateStr]; ok {
			if exc.isOpen {
				isOpen = true
				if !exc.start.IsZero() && !exc.end.IsZero() {
					windowStart = time.Date(current.Year(), current.Month(), current.Day(),
						exc.start.Hour(), exc.start.Minute(), exc.start.Second(), 0, loc)
					windowEnd = time.Date(current.Year(), current.Month(), current.Day(),
						exc.end.Hour(), exc.end.Minute(), exc.end.Second(), 0, loc)
				}
			}
		} else {
			// Look up recurring rules for this day of week.
			for _, rule := range rules {
				if getInt64(rule, "day_of_week") == int64(dayOfWeek) {
					ruleStart, _ := parseTimeOfDay(getString(rule, "start_time"))
					ruleEnd, _ := parseTimeOfDay(getString(rule, "end_time"))
					if ruleStart.IsZero() || ruleEnd.IsZero() {
						continue
					}
					if !windowStart.IsZero() {
						continue // already found a window for this day
					}
					windowStart = time.Date(current.Year(), current.Month(), current.Day(),
						ruleStart.Hour(), ruleStart.Minute(), ruleStart.Second(), 0, loc)
					windowEnd = time.Date(current.Year(), current.Month(), current.Day(),
						ruleEnd.Hour(), ruleEnd.Minute(), ruleEnd.Second(), 0, loc)
					isOpen = true
				}
			}
		}

		// Generate slots within the window.
		if isOpen && !windowStart.IsZero() && !windowEnd.IsZero() {
			slotStart := windowStart
			for slotStart.Add(duration).Before(windowEnd) || slotStart.Add(duration).Equal(windowEnd) {
				slotEnd := slotStart.Add(duration)

				// Check against blocked intervals.
				conflict := false
				for _, b := range blocked {
					if timeOverlap(slotStart, slotEnd, b.start, b.end) {
						conflict = true
						break
					}
				}

				if !conflict {
					slots = append(slots, AvailabilitySlot{
						StartTime: slotStart.Format(time.RFC3339),
						EndTime:   slotEnd.Format(time.RFC3339),
					})
				}

				slotStart = slotEnd
			}
		}

		current = current.AddDate(0, 0, 1)
	}

	c.JSON(http.StatusOK, AvailabilityResponse{
		Timezone: timeZone,
		Slots:    slots,
	})
}

// botAppointmentDuration reads the persisted default appointment slot length
// (minutes) from a bot row, defaulting to 30 when the column is absent or
// non-positive. Supabase returns numeric columns as float64.
func botAppointmentDuration(bot map[string]interface{}) int {
	if bot == nil {
		return 30
	}
	switch n := bot["appointment_duration_minutes"].(type) {
	case float64:
		if n > 0 {
			return int(n)
		}
	case int:
		if n > 0 {
			return n
		}
	case int64:
		if n > 0 {
			return int(n)
		}
	}
	return 30
}

// CalendarContextForChat builds a concise system-prompt fragment describing the
// bot's Google Calendar availability so the chat LLM can reason about open vs.
// booked times. It returns an empty string when the calendar is not yet ready
// (enabled + connected + at least one availability rule), so callers can
// append it unconditionally.
func (h *AppointmentHandler) CalendarContextForChat(ctx context.Context, botID string, daysAhead int) string {
	ready, err := h.CheckBotCalendarReady(ctx, botID)
	if err != nil || !ready {
		return ""
	}
	bot, _ := h.fetchBot(ctx, botID)
	duration := botAppointmentDuration(bot)
	tz := getString(bot, "timezone")
	if tz == "" {
		tz = "UTC"
	}
	rules, _ := h.fetchAvailabilityRules(ctx, botID)
	exceptions, _ := h.fetchAvailabilityExceptions(ctx, botID)
	appointments, _ := h.fetchAppointmentsForBot(ctx, botID)

	// Format upcoming bookings within [now, now+daysAhead) days.
	now := time.Now().UTC()
	end := now.AddDate(0, 0, daysAhead)
	var booked []string
	for _, a := range appointments {
		start, _ := parseTime(getString(a, "start_time"))
		aEnd, _ := parseTime(getString(a, "end_time"))
		if start.IsZero() || aEnd.IsZero() {
			continue
		}
		if !start.Before(now) && start.Before(end) {
			booked = append(booked, fmt.Sprintf("%s–%s (%s)",
				start.Format(time.RFC3339), aEnd.Format(time.RFC3339), getString(a, "customer_name")))
		}
	}

	b := strings.Builder{}
	fmt.Fprintf(&b, "Google Calendar is connected and enabled. Appointment duration is %d minutes, timezone %s. ", duration, tz)
	if len(rules) == 0 {
		b.WriteString("No weekly working-hours rules are set, so no slots are available by default. ")
	} else {
		b.WriteString("Weekly working hours: ")
		for _, r := range rules {
			fmt.Fprintf(&b, "day %d %s-%s, ",
				getInt64(r, "day_of_week"), getString(r, "start_time"), getString(r, "end_time"))
		}
	}
	if len(exceptions) > 0 {
		b.WriteString("Date exceptions: ")
		for _, e := range exceptions {
			fmt.Fprintf(&b, "%s open=%s, ", getString(e, "exception_date"), getString(e, "is_open"))
		}
	}
	if len(booked) == 0 {
		fmt.Fprintf(&b, "No appointments booked in the next %d days. ", daysAhead)
	} else {
		fmt.Fprintf(&b, "Appointments already booked in the next %d days: %s. ", daysAhead, strings.Join(booked, "; "))
	}
	fmt.Fprintf(&b, "When the user asks to schedule, propose a %d-minute slot within the working hours that does not overlap an existing booking, then confirm before finalising.", duration)
	return b.String()
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// isUniqueViolation checks whether an error returned by the Supabase client
// represents a PostgreSQL unique-constraint violation (error code 23505).
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "23505") || strings.Contains(msg, "duplicate key")
}

func parseInt(s string) (int, error) {
	var n int
	_, err := fmt.Sscanf(s, "%d", &n)
	return n, err
}

func mustParseTimeOfDay(s string) time.Time {
	t, _ := parseTimeOfDay(s)
	return t
}
