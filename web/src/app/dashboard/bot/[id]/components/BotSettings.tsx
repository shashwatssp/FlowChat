'use client';

import { useState } from 'react';
import { botApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { Save, BarChart3, RefreshCw } from 'lucide-react';
import VoiceInput from '@/components/ui/VoiceInput';

interface Bot {
  id: string;
  name: string;
  description: string;
  slug: string;
  avatar_url: string;
  system_prompt: string;
  api_key: string;
  usage_count: number;
  created_at: string;
  updated_at: string;
}

interface BotStats {
  total_conversations: number;
  total_messages: number;
  knowledge_sources: number;
}

interface BotSettingsProps {
  bot: Bot;
  onBotUpdated: (bot: Bot) => void;
}

export default function BotSettings({ bot, onBotUpdated }: BotSettingsProps) {
  const [name, setName] = useState(bot.name);
  const [description, setDescription] = useState(bot.description);
  const [avatarURL, setAvatarURL] = useState(bot.avatar_url);
  const [systemPrompt, setSystemPrompt] = useState(bot.system_prompt);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stats, setStats] = useState<BotStats | null>(null);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const response = await botApi.getStats(bot.id);
      setStats(response.data);
    } catch (error) {
      toast.error('Failed to load stats');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await botApi.update(bot.id, {
        name,
        description,
        avatar_url: avatarURL,
        system_prompt: systemPrompt,
      });
      toast.success('Bot updated successfully');
      // Re-fetch bot to get updated data
      const response = await botApi.get(bot.id);
      onBotUpdated(response.data);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to update bot');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-gray-50 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-primary-600">
            {stats?.total_conversations ?? '-'}
          </div>
          <div className="text-sm text-gray-600">Conversations</div>
        </div>
        <div className="bg-gray-50 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-primary-600">
            {stats?.total_messages ?? '-'}
          </div>
          <div className="text-sm text-gray-600">Messages</div>
        </div>
        <div className="bg-gray-50 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-primary-600">
            {stats?.knowledge_sources ?? '-'}
          </div>
          <div className="text-sm text-gray-600">Knowledge Sources</div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={fetchStats}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-md hover:bg-gray-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh Stats
        </button>
      </div>

      {/* Bot Settings Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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

        {/* Bot Info */}
        <div className="border-t pt-6 space-y-3">
          <h3 className="text-lg font-medium text-gray-900">Bot Info</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Bot ID:</span>
              <span className="ml-2 text-gray-900 font-mono">{bot.id}</span>
            </div>
            <div>
              <span className="text-gray-500">Slug:</span>
              <span className="ml-2 text-gray-900">{bot.slug}</span>
            </div>
            <div>
              <span className="text-gray-500">Usage:</span>
              <span className="ml-2 text-gray-900">{bot.usage_count} chats</span>
            </div>
            <div>
              <span className="text-gray-500">Created:</span>
              <span className="ml-2 text-gray-900">
                {new Date(bot.created_at).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
          >
            <Save size={16} className={saving ? 'animate-pulse' : ''} />
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
