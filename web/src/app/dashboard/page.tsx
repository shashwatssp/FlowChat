'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { botApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { Plus, MessageSquare, Trash2, ExternalLink } from 'lucide-react';

interface Bot {
  id: string;
  name: string;
  description: string;
  slug: string;
  api_key: string;
  usage_count: number;
  created_at: string;
}

export default function DashboardPage() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
      return;
    }
    fetchBots();
  }, [router]);

  const fetchBots = async () => {
    try {
      const response = await botApi.list();
      setBots(Array.isArray(response.data) ? response.data : []);
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

  const handleDelete = async (botId: string) => {
    if (!confirm('Are you sure you want to delete this bot?')) return;
    
    try {
      await botApi.delete(botId);
      toast.success('Bot deleted');
      fetchBots();
    } catch (error) {
      toast.error('Failed to delete bot');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    router.push('/');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-primary-600">FlowChat</h1>
          <div className="flex gap-4">
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              <Plus size={20} />
              New Bot
            </button>
            <button
              onClick={handleLogout}
              className="px-4 py-2 text-gray-600 hover:text-gray-900"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <h2 className="text-2xl font-bold mb-6">Your Chatbots</h2>
        
        {bots.length === 0 ? (
          <div className="text-center py-12">
            <MessageSquare className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-xl font-medium text-gray-900 mb-2">No chatbots yet</h3>
            <p className="text-gray-600 mb-6">Create your first chatbot to get started</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
            >
              Create Your First Bot
            </button>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {bots.map((bot) => (
              <div key={bot.id} className="bg-white rounded-lg shadow-sm p-6">
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-lg font-semibold">{bot.name}</h3>
                  <button
                    onClick={() => handleDelete(bot.id)}
                    className="text-gray-400 hover:text-red-600"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
                <p className="text-gray-600 text-sm mb-4 line-clamp-2">{bot.description}</p>
                <div className="text-xs text-gray-500 mb-4">
                  <p>Usage: {bot.usage_count} chats</p>
                  <p>Created: {new Date(bot.created_at).toLocaleDateString()}</p>
                </div>
                <div className="flex gap-2">
                  <Link
                    href={`/dashboard/bot/${bot.id}`}
                    className="flex-1 px-3 py-2 bg-primary-600 text-white text-sm rounded hover:bg-primary-700 text-center"
                  >
                    Manage
                  </Link>
                  <a
                    href={`/chat/${bot.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-2 border border-gray-300 text-gray-700 text-sm rounded hover:bg-gray-50"
                  >
                    <ExternalLink size={16} />
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Create Bot Modal */}
      {showCreateModal && (
        <CreateBotModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            fetchBots();
          }}
        />
      )}
    </div>
  );
}

function CreateBotModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await botApi.create({ name, description, system_prompt: systemPrompt });
      toast.success('Bot created successfully!');
      onCreated();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to create bot');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full">
        <h2 className="text-xl font-bold mb-4">Create New Chatbot</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Bot Name *
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="My Awesome Bot"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              rows={3}
              placeholder="What does your bot do?"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              System Prompt
            </label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              rows={4}
              placeholder="You are a helpful assistant that..."
            />
          </div>
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Bot'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}