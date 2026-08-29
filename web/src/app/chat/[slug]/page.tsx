'use client';

import { useParams } from 'next/navigation';
import { useState, useEffect } from 'react';
import { Bot } from 'lucide-react';
import { botApi } from '@/lib/api';
import ChatInterface from '@/components/chat/ChatInterface';

interface PublicBot {
  id: string;
  name: string;
  description: string;
  slug: string;
  avatar_url: string;
  usage_count: number;
  created_at: string;
}

export default function ChatPage() {
  const params = useParams();
  const botSlug = params.slug as string;
  const [bot, setBot] = useState<PublicBot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchBot = async () => {
      try {
        const response = await botApi.getPublicBot(botSlug);
        setBot(response.data);
      } catch (error) {
        // Bot not found — keep page visible with fallback header
        console.error('Failed to fetch bot:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchBot();
  }, [botSlug]);

  return (
    <div className="h-[100dvh] bg-gray-50 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            {bot?.avatar_url ? (
              <img
                src={bot.avatar_url}
                alt={bot.name || 'Bot'}
                className="w-10 h-10 rounded-full object-cover"
              />
            ) : (
              <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                <Bot className="w-6 h-6 text-primary-600" />
              </div>
            )}
            <div>
              <h1 className={`text-base sm:text-lg font-semibold ${loading ? 'text-gray-400' : 'text-gray-900'}`}>
                {loading ? 'Loading...' : (bot?.name || 'FlowChat Assistant')}
              </h1>
              <p className="text-sm text-gray-500">powered by FlowChat</p>
            </div>
          </div>
        </div>
      </header>

      {/* Chat Interface — wrap in a flex-1 container so it fills the
          remaining height of the 100dvh page above the bottom system
          bars. Without this, ChatInterface sizes to its content and the
          browser shows a large gray gap below the input. */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <ChatInterface botSlug={botSlug} botID={bot?.id || ''} emptyStateBotName={bot?.name} />
      </div>
    </div>
  );
}
