'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useBotStore } from '@/lib/store';
import { botApi } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  Plus,
  Bot,
  ExternalLink,
  BarChart3,
  Calendar,
  Trash2,
  Edit3,
  X,
} from 'lucide-react';
import BotForm from '@/components/bots/BotForm';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';

interface Bot {
  id: string;
  name: string;
  description: string;
  slug: string;
  avatar_url: string;
  system_prompt: string;
  calendar_enabled?: boolean;
  timezone?: string;
  api_key: string;
  usage_count: number;
  created_at: string;
  updated_at: string;
}

type ModalMode = 'create' | 'edit' | null;

interface BotFormPayload {
  name: string;
  description: string;
  avatar_url: string;
  system_prompt: string;
  calendar_enabled?: boolean;
  timezone?: string;
}

/**
 * Bot management list.
 *
 * Responsibilities (all bot-management actions live here):
 *   - list bots with stats (total bots / total chats)
 *   - create a new bot (opens BotForm in a modal)
 *   - rename / edit a bot (opens BotForm pre-filled, PUT then re-fetch)
 *   - delete a bot (confirm + DELETE)
 *   - configure settings / open chat (links out to /dashboard/bot/[id] and /chat/[slug])
 */
export default function BotList() {
  const router = useRouter();
  const { bots, fetchBots, addBot, updateBot, removeBot } = useBotStore();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [editingBot, setEditingBot] = useState<Bot | null>(null);

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token) {
      router.push('/login');
      return;
    }
    loadBots();
  }, [router, fetchBots]);

  const loadBots = async () => {
    setLoading(true);
    try {
      await fetchBots();
    } catch (error: any) {
      if (error.response?.status === 401) {
        localStorage.removeItem('token');
        router.push('/login');
      } else {
        toast.error('Failed to load bots');
      }
    } finally {
      setLoading(false);
    }
  };

  const resetModal = () => {
    setModalMode(null);
    setEditingBot(null);
  };

  const openCreate = () => {
    setEditingBot(null);
    setModalMode('create');
  };

  const openEdit = (bot: Bot) => {
    setEditingBot(bot);
    setModalMode('edit');
  };

  // POST /bots returns the created bot -> optimistic add to the store.
  const handleCreate = async (data: BotFormPayload) => {
    setSubmitting(true);
    try {
      const response = await botApi.create({
        name: data.name,
        description: data.description,
        avatar_url: data.avatar_url,
        system_prompt: data.system_prompt,
        calendar_enabled: data.calendar_enabled,
        timezone: data.timezone,
      });
      addBot(response.data);
      toast.success('Bot created successfully');
      resetModal();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to create bot');
    } finally {
      setSubmitting(false);
    }
  };

  // PUT /bots/:id returns only a message -> re-fetch the bot to get the
  // full updated object, matching the API contract.
  const handleUpdate = async (data: BotFormPayload) => {
    if (!editingBot) return;
    setSubmitting(true);
    try {
      await botApi.update(editingBot.id, {
        name: data.name,
        description: data.description,
        avatar_url: data.avatar_url,
        system_prompt: data.system_prompt,
        calendar_enabled: data.calendar_enabled,
        timezone: data.timezone,
      });
      const response = await botApi.get(editingBot.id);
      updateBot(response.data);
      toast.success('Bot updated');
      resetModal();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to update bot');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (bot: Bot) => {
    if (!confirm(`Delete "${bot.name}"? This cannot be undone.`)) return;
    try {
      await botApi.delete(bot.id);
      removeBot(bot.id);
      toast.success('Bot deleted');
    } catch {
      toast.error('Failed to delete bot');
    }
  };

  const totalUsage = bots.reduce(
    (sum, bot) => sum + (bot.usage_count || 0),
    0
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats + primary action (stacks on mobile so nothing overflows) */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid grid-cols-2 gap-3 sm:flex sm:items-center sm:gap-4">
          <div className="bg-white rounded-lg shadow-sm border px-4 py-3 sm:min-w-[150px]">
            <p className="text-xs text-gray-500 uppercase">Total Bots</p>
            <p className="text-2xl font-bold text-gray-900">{bots.length}</p>
          </div>
          <div className="bg-white rounded-lg shadow-sm border px-4 py-3 sm:min-w-[160px]">
            <p className="text-xs text-gray-500 uppercase">Total Chats</p>
            <p className="text-2xl font-bold text-gray-900">{totalUsage}</p>
          </div>
        </div>
        <Button
          icon={<Plus size={18} />}
          variant="primary"
          onClick={openCreate}
          className="w-full sm:w-auto"
        >
          New Bot
        </Button>
      </div>

      {/* Bot grid */}
      {bots.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg shadow-sm border">
          <Bot className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-xl font-medium text-gray-900 mb-2">No chatbots yet</h3>
          <p className="text-gray-600 mb-6">
            Create your first chatbot to get started.
          </p>
          <Button
            icon={<Plus size={18} />}
            variant="primary"
            onClick={openCreate}
          >
            Create Your First Bot
          </Button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {bots.map((bot) => (
            <Card
              key={bot.id}
              className="group hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  {bot.avatar_url ? (
                    <img
                      src={bot.avatar_url}
                      alt={bot.name}
                      className="w-12 h-12 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center">
                      <Bot size={24} className="text-primary-600" />
                    </div>
                  )}
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">
                      {bot.name}
                    </h3>
                    <p className="text-xs text-gray-500">
                      Created{' '}
                      {new Date(bot.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => openEdit(bot)}
                    className="p-1.5 text-gray-500 hover:text-gray-900 rounded hover:bg-gray-100"
                    title="Rename / edit"
                  >
                    <Edit3 size={16} />
                  </button>
                  <button
                    onClick={() => handleDelete(bot)}
                    className="p-1.5 text-gray-500 hover:text-red-600 rounded hover:bg-gray-50"
                    title="Delete bot"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              {bot.description && (
                <p className="text-gray-600 text-sm mb-4 line-clamp-2">
                  {bot.description}
                </p>
              )}

              <div className="flex items-center gap-4 text-xs text-gray-500 mb-4">
                <div className="flex items-center gap-1">
                  <BarChart3 size={14} />
                  <span>{bot.usage_count || 0} chats</span>
                </div>
                <div className="flex items-center gap-1">
                  <Calendar size={14} />
                  <span>
                    {new Date(bot.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-4 border-t">
                <Link
                  href={`/dashboard/bot/${bot.id}`}
                  className="flex-1 px-3 py-2 bg-primary-600 text-white text-sm rounded-lg hover:bg-primary-700 text-center"
                >
                  Configure Settings
                </Link>
                <a
                  href={`/chat/${bot.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 px-3 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50 text-center"
                  title="Open chat"
                >
                  <ExternalLink size={14} />
                </a>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit (rename) modal */}
      {modalMode && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={resetModal}
        >
          <div
            className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-xl font-semibold text-gray-900">
                {modalMode === 'create'
                  ? 'Create New Bot'
                  : `Edit "${editingBot?.name}"`}
              </h2>
              <button
                onClick={resetModal}
                className="text-gray-400 hover:text-gray-700 transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-4">
              <BotForm
                bot={
                  modalMode === 'edit' && editingBot
                    ? {
                        id: editingBot.id,
                        name: editingBot.name,
                        description: editingBot.description,
                        avatar_url: editingBot.avatar_url,
                        system_prompt: editingBot.system_prompt,
                      }
                    : undefined
                }
                onSubmit={modalMode === 'create' ? handleCreate : handleUpdate}
                onCancel={resetModal}
                loading={submitting}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
