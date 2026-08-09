'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { conversationApi, botApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { MessageSquare, Calendar, Search } from 'lucide-react';

interface Conversation {
  id: string;
  bot_id: string;
  bot_name?: string;
  started_at: string;
  message_count?: number;
}

interface Bot {
  id: string;
  name: string;
}

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [bots, setBots] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
      return;
    }
    fetchData();
  }, [router]);

  const fetchData = async () => {
    try {
      // Fetch bots to build a lookup map
      const botsResponse = await botApi.list();
      const botMap: Record<string, string> = {};
      botsResponse.data.forEach((bot: Bot) => {
        botMap[bot.id] = bot.name;
      });
      setBots(botMap);

      // Fetch conversations for each bot
      let allConversations: Conversation[] = [];
      for (const botId of Object.keys(botMap)) {
        try {
          const response = await conversationApi.list(botId);
          const convsWithBot = (response.data || []).map((conv: any) => ({
            ...conv,
            bot_name: botMap[botId],
          }));
          allConversations = [...allConversations, ...convsWithBot];
        } catch {
          // Skip bots with errors
        }
      }

      // Sort by created_at descending
allConversations.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
      setConversations(allConversations);
    } catch (error: any) {
      if (error.response?.status === 401) {
        localStorage.removeItem('token');
        router.push('/login');
      } else {
        toast.error('Failed to load conversations');
      }
    } finally {
      setLoading(false);
    }
  };

  const filteredConversations = conversations.filter(conv =>
    conv.bot_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    conv.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Conversations</h1>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
            <input
              type="text"
              placeholder="Search conversations..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>

        {filteredConversations.length === 0 ? (
          <div className="text-center py-16">
            <MessageSquare className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-xl font-medium text-gray-900 mb-2">No conversations yet</h3>
            <p className="text-gray-600">
              Conversations will appear here when users interact with your bots.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredConversations.map((conv) => (
              <div key={conv.id} className="bg-white rounded-lg shadow-sm p-4 border hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                      <MessageSquare size={20} className="text-primary-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">
                        {conv.bot_name || 'Unknown Bot'}
                      </p>
                      <div className="flex items-center gap-1 text-xs text-gray-500">
                        <Calendar size={12} />
<span>{new Date(conv.started_at).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                  <Link
                    href={`/dashboard/bot/${conv.bot_id}`}
                    className="text-sm text-primary-600 hover:text-primary-700"
                  >
                    View Bot
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
