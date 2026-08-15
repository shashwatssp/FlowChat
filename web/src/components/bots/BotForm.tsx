'use client';

import { useState } from 'react';
import { Bot } from 'lucide-react';
import VoiceInput from '@/components/ui/VoiceInput';

interface Bot {
  id: string;
  name: string;
  description: string;
  avatar_url: string;
  system_prompt: string;
  calendar_enabled?: boolean;
  timezone?: string;
}

interface BotFormProps {
  bot?: Partial<Bot>;
  onSubmit: (data: {
    name: string;
    description: string;
    avatar_url: string;
    system_prompt: string;
    calendar_enabled?: boolean;
    timezone?: string;
  }) => Promise<void>;
  onCancel: () => void;
  loading?: boolean;
}

export default function BotForm({ bot, onSubmit, onCancel, loading }: BotFormProps) {
  const [name, setName] = useState(bot?.name || '');
  const [description, setDescription] = useState(bot?.description || '');
  const [avatarURL, setAvatarURL] = useState(bot?.avatar_url || '');
  const [systemPrompt, setSystemPrompt] = useState(bot?.system_prompt || '');
  const [calendarEnabled, setCalendarEnabled] = useState(bot?.calendar_enabled || false);
  const [timezone, setTimezone] = useState(bot?.timezone || 'UTC');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit({
      name,
      description,
      avatar_url: avatarURL,
      system_prompt: systemPrompt,
      calendar_enabled: calendarEnabled,
      timezone: calendarEnabled ? timezone : 'UTC',
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <VoiceInput
        label="Bot Name"
        value={name}
        onChange={setName}
        placeholder="My Awesome Bot"
        field="bot_name"
        required
      />

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Avatar URL
        </label>
        <input
          type="url"
          value={avatarURL}
          onChange={(e) => setAvatarURL(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
          placeholder="https://example.com/avatar.png"
        />
      </div>

      <VoiceInput
        label="Description"
        value={description}
        onChange={setDescription}
        placeholder="What does your bot do?"
        field="description"
        textarea
        rows={3}
        helperText="A short summary of your bot and the business it represents. Customers see this when they start a chat."
      />

      <VoiceInput
        label="Bot Instructions"
        value={systemPrompt}
        onChange={setSystemPrompt}
        placeholder="You are a helpful assistant that answers questions based on the provided context..."
        field="system_prompt"
        textarea
        rows={6}
        helperText="This defines how your bot behaves — its personality, tone, and expertise. Write it in plain language so the bot knows how to respond to customers."
      />

      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            id="calendar_enabled"
            checked={calendarEnabled}
            onChange={(e) => setCalendarEnabled(e.target.checked)}
            className="mt-1 h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
          />
          <label htmlFor="calendar_enabled" className="block text-sm font-medium text-gray-700">
            Enable appointment scheduling
          </label>
        </div>
        {calendarEnabled && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Timezone
            </label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="UTC">UTC</option>
              <optgroup label="North America">
                <option value="America/New_York">Eastern Time (US &amp; Canada)</option>
                <option value="America/Chicago">Central Time (US &amp; Canada)</option>
                <option value="America/Denver">Mountain Time (US &amp; Canada)</option>
                <option value="America/Los_Angeles">Pacific Time (US &amp; Canada)</option>
                <option value="America/Toronto">Toronto</option>
                <option value="America/Vancouver">Vancouver</option>
              </optgroup>
              <optgroup label="Europe">
                <option value="Europe/London">London</option>
                <option value="Europe/Paris">Paris</option>
                <option value="Europe/Berlin">Berlin</option>
                <option value="Europe/Madrid">Madrid</option>
                <option value="Europe/Moscow">Moscow</option>
              </optgroup>
              <optgroup label="Asia">
                <option value="Asia/Kolkata">Kolkata</option>
                <option value="Asia/Dubai">Dubai</option>
                <option value="Asia/Tokyo">Tokyo</option>
                <option value="Asia/Shanghai">Shanghai</option>
                <option value="Asia/Singapore">Singapore</option>
                <option value="Asia/Seoul">Seoul</option>
                <option value="Asia/Jerusalem">Jerusalem</option>
              </optgroup>
              <optgroup label="Oceania">
                <option value="Australia/Sydney">Sydney</option>
                <option value="Australia/Melbourne">Melbourne</option>
                <option value="Pacific/Auckland">Auckland</option>
              </optgroup>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Used for appointment slot calculations and Google Calendar sync.
            </p>
          </div>
        )}
      </div>

      <div className="flex gap-3 pt-4">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading}
          className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading ? 'Saving...' : (bot?.id ? 'Update Bot' : 'Create Bot')}
        </button>
      </div>
    </form>
  );
}
