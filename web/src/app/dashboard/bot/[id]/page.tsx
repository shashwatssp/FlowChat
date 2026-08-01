'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { botApi, knowledgeApi, conversationApi } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  Settings,
  Upload,
  Globe,
  MessageSquare,
  BarChart3,
  ExternalLink,
  ArrowLeft,
} from 'lucide-react';
import BotSettings from './components/BotSettings';
import KnowledgeManager from './components/KnowledgeManager';
import ConversationHistory from './components/ConversationHistory';

type Tab = 'settings' | 'knowledge' | 'conversations';

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

export default function BotManagementPage() {
  const params = useParams();
  const botID = params.id as string;
  const router = useRouter();
  const [bot, setBot] = useState<Bot | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('settings');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
      return;
    }
    fetchBot();
  }, [router]);

  const fetchBot = async () => {
    try {
      const response = await botApi.get(botID);
      setBot(response.data);
    } catch (error: any) {
      if (error.response?.status === 401) {
        localStorage.removeItem('token');
        router.push('/login');
      } else {
        toast.error('Failed to load bot');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleBotUpdated = (updatedBot: Bot) => {
    setBot(updatedBot);
  };

  if (loading || !bot) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'settings', label: 'Settings', icon: <Settings size={16} /> },
    { id: 'knowledge', label: 'Knowledge Base', icon: <Upload size={16} /> },
    { id: 'conversations', label: 'Conversations', icon: <MessageSquare size={16} /> },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/dashboard"
                className="text-gray-500 hover:text-gray-700 transition-colors"
              >
                <ArrowLeft size={20} />
              </Link>
              <div className="flex items-center gap-3">
                {bot.avatar_url ? (
                  <img
                    src={bot.avatar_url}
                    alt={bot.name}
                    className="w-10 h-10 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                    <MessageSquare className="w-6 h-6 text-primary-600" />
                  </div>
                )}
                <div>
                  <h1 className="text-xl font-bold text-gray-900">{bot.name}</h1>
                  <p className="text-sm text-gray-500">
                    <Link
                      href={`/chat/${bot.slug}`}
                      className="text-primary-600 hover:text-primary-700 inline-flex items-center gap-1"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink size={12} />
                      {process.env.NEXT_PUBLIC_API_URL?.replace('/api/v1', '') || 'http://localhost:3000'}/chat/{bot.slug}
                    </Link>
                  </p>
                </div>
              </div>
            </div>

            <Link
              href={`/chat/${bot.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 flex items-center gap-2"
            >
              <ExternalLink size={16} />
              Open Chat
            </Link>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="container mx-auto px-4 py-6">
        <div className="bg-white rounded-lg shadow-sm border">
          <nav className="flex border-b overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-6 py-4 text-sm font-medium whitespace-nowrap transition-colors ${
                  activeTab === tab.id
                    ? 'border-primary-600 text-primary-600 border-b-2'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }}`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="p-6">
            {activeTab === 'settings' && (
              <BotSettings bot={bot} onBotUpdated={handleBotUpdated} />
            )}
            {activeTab === 'knowledge' && (
              <KnowledgeManager botID={bot.id} />
            )}
            {activeTab === 'conversations' && (
              <ConversationHistory botID={bot.id} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
