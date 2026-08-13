'use client';

import { useState, useEffect } from 'react';
import { calendarApi, googleCalendarApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { Save, Calendar, Clock, Trash2, Plus, Globe } from 'lucide-react';

interface WorkingHours {
  [key: string]: { start: string; end: string };
}

interface Exception {
  date: string;
  is_closed: boolean;
}

interface CalendarSettingsData {
  calendar_enabled: boolean;
  timezone: string;
  appointment_duration_minutes: number;
  working_hours?: WorkingHours;
  exceptions?: Exception[];
  calendar_connected?: boolean;
}

interface CalendarSettingsProps {
  botID: string;
}

const DAYS = [
  { key: 'monday', label: 'Monday', dow: 1 },
  { key: 'tuesday', label: 'Tuesday', dow: 2 },
  { key: 'wednesday', label: 'Wednesday', dow: 3 },
  { key: 'thursday', label: 'Thursday', dow: 4 },
  { key: 'friday', label: 'Friday', dow: 5 },
  { key: 'saturday', label: 'Saturday', dow: 6 },
  { key: 'sunday', label: 'Sunday', dow: 0 },
];

// Map day-of-week number (0=Sunday) to the DAYS key for reverse lookup
const DOW_TO_KEY: Record<number, string> = {
  0: 'sunday',
  1: 'monday',
  2: 'tuesday',
  3: 'wednesday',
  4: 'thursday',
  5: 'friday',
  6: 'saturday',
};

const TIMEZONE_GROUPS: Record<string, Array<{ value: string; label: string }>> = {
  UTC: [{ value: 'UTC', label: 'UTC' }],
  'North America': [
    { value: 'America/New_York', label: 'Eastern Time (US & Canada)' },
    { value: 'America/Chicago', label: 'Central Time (US & Canada)' },
    { value: 'America/Denver', label: 'Mountain Time (US & Canada)' },
    { value: 'America/Los_Angeles', label: 'Pacific Time (US & Canada)' },
    { value: 'America/Toronto', label: 'Toronto' },
    { value: 'America/Vancouver', label: 'Vancouver' },
  ],
  Europe: [
    { value: 'Europe/London', label: 'London' },
    { value: 'Europe/Paris', label: 'Paris' },
    { value: 'Europe/Berlin', label: 'Berlin' },
    { value: 'Europe/Madrid', label: 'Madrid' },
    { value: 'Europe/Moscow', label: 'Moscow' },
  ],
  Asia: [
    { value: 'Asia/Kolkata', label: 'Kolkata' },
    { value: 'Asia/Dubai', label: 'Dubai' },
    { value: 'Asia/Tokyo', label: 'Tokyo' },
    { value: 'Asia/Shanghai', label: 'Shanghai' },
    { value: 'Asia/Singapore', label: 'Singapore' },
    { value: 'Asia/Seoul', label: 'Seoul' },
    { value: 'Asia/Jerusalem', label: 'Jerusalem' },
  ],
  Oceania: [
    { value: 'Australia/Sydney', label: 'Sydney' },
    { value: 'Australia/Melbourne', label: 'Melbourne' },
    { value: 'Pacific/Auckland', label: 'Auckland' },
  ],
};

export default function CalendarSettings({ botID }: CalendarSettingsProps) {
  const [settings, setSettings] = useState<CalendarSettingsData>({
    calendar_enabled: false,
    timezone: 'UTC',
    appointment_duration_minutes: 30,
    working_hours: {},
    exceptions: [],
  });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [newExceptionDate, setNewExceptionDate] = useState('');
  const [newExceptionClosed, setNewExceptionClosed] = useState(true);

  useEffect(() => {
    fetchSettings();
  }, [botID]);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const response = await calendarApi.getSettings(botID);
      const data = response.data as any;
      // Backend returns: calendar_connected, timezone, availability_rules, availability_exceptions
      // Transform to frontend format.
      const workingHours: WorkingHours = {};
      (data.availability_rules || []).forEach((rule: any) => {
        const dayKey = DOW_TO_KEY[rule.day_of_week];
        if (dayKey) {
          workingHours[dayKey] = {
            start: (rule.start_time || '09:00').slice(0, 5),
            end: (rule.end_time || '17:00').slice(0, 5),
          };
        }
      });
      const exceptions: Exception[] = (data.availability_exceptions || []).map((exc: any) => ({
        date: exc.exception_date,
        is_closed: exc.is_open !== true,
      }));
      setSettings({
        calendar_enabled: data.calendar_enabled || false,
        timezone: data.timezone || 'UTC',
        appointment_duration_minutes: data.appointment_duration_minutes || 30,
        working_hours: workingHours,
        exceptions: exceptions,
        calendar_connected: data.calendar_connected || false,
      });
    } catch {
      toast.error('Failed to load calendar settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Transform frontend format to backend format.
      const availabilityRules = DAYS.map((day) => {
        const wh = settings.working_hours?.[day.key];
        return {
          day_of_week: day.dow,
          start_time: wh ? `${wh.start}:00` : '09:00:00',
          end_time: wh ? `${wh.end}:00` : '17:00:00',
          timezone: settings.timezone,
        };
      });
      const availabilityExceptions = settings.exceptions?.map((exc) => ({
        exception_date: exc.date,
        is_open: !exc.is_closed,
        timezone: settings.timezone,
      })) || [];
      const payload = {
        calendar_enabled: settings.calendar_enabled,
        timezone: settings.timezone,
        appointment_duration_minutes: settings.appointment_duration_minutes,
        availability_rules: settings.calendar_enabled ? availabilityRules : [],
        availability_exceptions: availabilityExceptions,
      };
      await calendarApi.updateSettings(botID, payload);
      toast.success('Calendar settings saved');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to save calendar settings');
    } finally {
      setSaving(false);
    }
  };

  const handleConnectGoogleCalendar = async () => {
    setConnecting(true);
    try {
      // Redirect the browser to the backend's Google OAuth connect endpoint.
      // The backend issues a 302 redirect to Google's consent screen with
      // the bot_id encoded in the state parameter.
      await googleCalendarApi.connectCalendar(botID);
    } catch {
      toast.error('Failed to connect Google Calendar');
    } finally {
      setConnecting(false);
    }
  };

  const updateWorkingHours = (day: string, field: 'start' | 'end', value: string) => {
    setSettings((prev) => ({
      ...prev,
      working_hours: {
        ...prev.working_hours,
        [day]: {
          start: field === 'start' ? value : prev.working_hours?.[day]?.start || '09:00',
          end: field === 'end' ? value : prev.working_hours?.[day]?.end || '17:00',
        },
      },
    }));
  };

  const removeException = (index: number) => {
    setSettings((prev) => ({
      ...prev,
      exceptions: prev.exceptions?.filter((_, i) => i !== index) || [],
    }));
  };

  const addException = () => {
    if (!newExceptionDate) return;
    setSettings((prev) => ({
      ...prev,
      exceptions: [
        ...(prev.exceptions || []),
        { date: newExceptionDate, is_closed: newExceptionClosed },
      ],
    }));
    setNewExceptionDate('');
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gray-200 rounded w-1/4"></div>
          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Calendar size={20} />
          Calendar Settings
        </h2>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
        >
          <Save size={16} className={saving ? 'animate-pulse' : ''} />
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {/* Enable scheduling toggle */}
      <div className="border-b pb-6 mb-6">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            id="calendar_enabled"
            checked={settings.calendar_enabled}
            onChange={(e) => setSettings({ ...settings, calendar_enabled: e.target.checked })}
            className="mt-1 h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
          />
          <label htmlFor="calendar_enabled" className="block text-sm font-medium text-gray-700">
            Enable appointment scheduling
          </label>
        </div>
        <p className="text-xs text-gray-500 mt-1 ml-7">
          When enabled, customers can book appointments through the chat interface.
        </p>
      </div>

      {settings.calendar_enabled && (
        <>
          {/* Appointment duration */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Appointment duration (minutes)
            </label>
            <input
              type="number"
              min={15}
              max={120}
              step={15}
              value={settings.appointment_duration_minutes}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  appointment_duration_minutes: Number(e.target.value),
                })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Default slot length for new appointments. Defaults to 30.
            </p>
          </div>

          {/* Timezone selector */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Timezone
            </label>
            <select
              value={settings.timezone}
              onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <optgroup label="UTC">
                {TIMEZONE_GROUPS.UTC.map((tz) => (
                  <option key={tz.value} value={tz.value}>{tz.label}</option>
                ))}
              </optgroup>
              <optgroup label="North America">
                {TIMEZONE_GROUPS['North America'].map((tz) => (
                  <option key={tz.value} value={tz.value}>{tz.label}</option>
                ))}
              </optgroup>
              <optgroup label="Europe">
                {TIMEZONE_GROUPS.Europe.map((tz) => (
                  <option key={tz.value} value={tz.value}>{tz.label}</option>
                ))}
              </optgroup>
              <optgroup label="Asia">
                {TIMEZONE_GROUPS.Asia.map((tz) => (
                  <option key={tz.value} value={tz.value}>{tz.label}</option>
                ))}
              </optgroup>
              <optgroup label="Oceania">
                {TIMEZONE_GROUPS.Oceania.map((tz) => (
                  <option key={tz.value} value={tz.value}>{tz.label}</option>
                ))}
              </optgroup>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Used for appointment slot calculations and Google Calendar sync.
            </p>
          </div>

          {/* Working hours grid */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
              <Clock size={16} />
              Working Hours
            </h3>
            <p className="text-xs text-gray-500 mb-3">
              Set your availability for each day of the week. Times are in the selected timezone.
            </p>
            <div className="space-y-3">
              {DAYS.map((day) => {
                const dayHours = settings.working_hours?.[day.key] || { start: '09:00', end: '17:00' };
                return (
                  <div key={day.key} className="grid grid-cols-3 items-center gap-4">
                    <span className="text-sm text-gray-700 font-medium">{day.label}</span>
                    <input
                      type="time"
                      value={dayHours.start}
                      onChange={(e) => updateWorkingHours(day.key, 'start', e.target.value)}
                      className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                    <input
                      type="time"
                      value={dayHours.end}
                      onChange={(e) => updateWorkingHours(day.key, 'end', e.target.value)}
                      className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Exceptions list */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
              <Calendar size={16} />
              Exceptions
            </h3>
            <p className="text-xs text-gray-500 mb-3">
              Add dates when you are closed or unavailable for bookings.
            </p>

            {/* Add exception form */}
            <div className="flex flex-wrap gap-3 items-end mb-4">
              <input
                type="date"
                value={newExceptionDate}
                onChange={(e) => setNewExceptionDate(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="exception_closed"
                  checked={newExceptionClosed}
                  onChange={(e) => setNewExceptionClosed(e.target.checked)}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                />
                <label htmlFor="exception_closed" className="text-sm text-gray-700">
                  Closed all day
                </label>
              </div>
              <button
                onClick={addException}
                disabled={!newExceptionDate}
                className="flex items-center gap-1 px-3 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50 text-sm"
              >
                <Plus size={14} />
                Add
              </button>
            </div>

            {/* Exceptions list */}
            {settings.exceptions && settings.exceptions.length > 0 ? (
              <div className="space-y-2">
                {settings.exceptions.map((exception, index) => (
                  <div
                    key={index}
                    className={`flex items-center justify-between p-3 rounded-lg border ${
                      exception.is_closed
                        ? 'bg-red-50 border-red-200'
                        : 'bg-green-50 border-green-200'
                    }`}
                  >
                    <div>
                      <span className="text-sm font-medium text-gray-900">
                        {exception.date}
                      </span>
                      <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
                        exception.is_closed
                          ? 'bg-red-100 text-red-800'
                          : 'bg-green-100 text-green-800'
                      }`}>
                        {exception.is_closed ? 'Closed' : 'Open'}
                      </span>
                    </div>
                    <button
                      onClick={() => removeException(index)}
                      className="p-1 text-gray-400 hover:text-red-600 rounded"
                      title="Remove exception"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400">
                <Calendar size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">No exceptions added yet.</p>
              </div>
            )}
          </div>

          {/* Google Calendar connect */}
          <div className="border-t pt-6">
            <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
              <Globe size={16} />
              Google Calendar Integration
            </h3>
            <p className="text-xs text-gray-500 mb-3">
              Connect your Google Calendar to sync appointments and avoid double-booking.
            </p>
            {settings.calendar_connected ? (
              <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg">
                <span className="text-sm text-green-800 flex items-center gap-2">
                  <Calendar size={16} />
                  Google Calendar connected
                </span>
                <button
                  onClick={handleConnectGoogleCalendar}
                  className="px-3 py-1 text-xs text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <button
                onClick={handleConnectGoogleCalendar}
                disabled={connecting}
                className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                <Globe size={16} />
                {connecting ? 'Connecting...' : 'Connect Google Calendar'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
