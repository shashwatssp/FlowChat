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
}

interface BotFormProps {
  bot?: Partial<Bot>;
  onSubmit: (data: {
    name: string;
    description: string;
    avatar_url: string;
    system_prompt: string;
  }) => Promise<void>;
  onCancel: () => void;
  loading?: boolean;
}

export default function BotForm({ bot, onSubmit, onCancel, loading }: BotFormProps) {
  const [name, setName] = useState(bot?.name || '');
  const [description, setDescription] = useState(bot?.description || '');
  const [avatarURL, setAvatarURL] = useState(bot?.avatar_url || '');
  const [systemPrompt, setSystemPrompt] = useState(bot?.system_prompt || '');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit({ name, description, avatar_url: avatarURL, system_prompt: systemPrompt });
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
