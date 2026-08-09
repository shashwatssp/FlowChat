'use client';

import { useState, useEffect } from 'react';
import { conversationApi } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  MessageSquare,
  Calendar,
  Trash2,
  RefreshCw,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react';

interface Conversation {
  id: string;
  bot_id: string;
  started_at?: string;
  last_message_at?: string;
  // Handle both field names for backward compatibility
  created_at?: string;
}

interface Message {
  id: string;
  conversation_id: string;
  bot_id: string;
  role: string;
  content: string;
  created_at: string;
}

interface ConversationHistoryProps {
  botID: string;
}

export default function ConversationHistory({ botID }: ConversationHistoryProps) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedConv, setExpandedConv] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [loadingMessages, setLoadingMessages] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetchConversations();
  }, [botID]);

  const fetchConversations = async () => {
    setLoading(true);
    try {
      const response = await conversationApi.list(botID);
      setConversations(response.data || []);
    } catch (error) {
      toast.error('Failed to load conversations');
    } finally {
      setLoading(false);
    }
  };

  const fetchMessages = async (convID: string) => {
    if (messages[convID]) {
      // Already loaded, just toggle
      setExpandedConv(expandedConv === convID ? null : convID);
      return;
    }

    setLoadingMessages({ ...loadingMessages, [convID]: true });
    try {
      const response = await conversationApi.getMessages(convID);
      setMessages({ ...messages, [convID]: response.data.messages || [] });
      setExpandedConv(convID);
    } catch (error) {
      toast.error('Failed to load conversation');
    } finally {
      setLoadingMessages({ ...loadingMessages, [convID]: false });
    }
  };

  const submitFeedback = async (convID: string, helpful: boolean) => {
    try {
      await conversationApi.saveFeedback(convID, {
        helpful,
        rating: 0,
        comment: '',
      });
      toast.success('Feedback saved');
    } catch (error) {
      toast.error('Failed to save feedback');
    }
  };

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-gray-50 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-primary-600">
            {conversations.length}
          </div>
          <div className="text-sm text-gray-600">Total Conversations</div>
        </div>
        <div className="bg-gray-50 rounded-lg p-4 text-center">
          <RefreshCw
            size={24}
            className="mx-auto text-gray-400 cursor-pointer hover:text-primary-600"
            onClick={fetchConversations}
          />
          <div className="text-sm text-gray-600">Refresh</div>
        </div>
      </div>

      {/* Conversations List */}
      <div className="bg-white border rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading conversations...</div>
        ) : conversations.length === 0 ? (
          <div className="p-8 text-center">
            <MessageSquare className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No conversations yet.</p>
            <p className="text-sm text-gray-400 mt-1">
              Conversations will appear here when users chat with your bot.
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {conversations.map((conv) => (
              <div key={conv.id} className="border-b">
                {/* Conversation header */}
                <div
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50"
                  onClick={() => fetchMessages(conv.id)}
                >
                  <div className="flex items-center gap-3">
                    <MessageSquare size={20} className="text-gray-400" />
                    <div>
                      <span className="text-sm font-medium text-gray-900">
                        Conversation {conv.id.substring(0, 8)}...
                      </span>
                      <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                        <Calendar size={12} />
                        <span>
{new Date(conv.started_at || conv.created_at || '').toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-gray-500">
                    <span>
                      {(messages[conv.id]?.length || 0) / 2 || 0}{' '}
                      exchanges
                    </span>
                  </div>
                </div>

                {/* Expanded messages */}
                {expandedConv === conv.id && (
                  <div className="px-4 pb-4 bg-gray-50">
                    {loadingMessages[conv.id] ? (
                      <div className="py-8 text-center text-gray-500">
                        Loading messages...
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {messages[conv.id]?.map((msg) => (
                          <div
                            key={msg.id}
                            className={`p-3 rounded-lg text-sm ${
                              msg.role === 'user'
                                ? 'bg-primary-50 ml-auto max-w-[80%]'
                                : 'bg-white mr-auto max-w-[80%]'
                            }`}
                          >
                            <span className="font-medium text-xs text-gray-500 uppercase">
                              {msg.role}
                            </span>
                            <p className="mt-1 text-gray-800 whitespace-pre-wrap">
                              {msg.content}
                            </p>
                          </div>
                        ))}

                        {/* Feedback */}
                        <div className="flex items-center gap-2 pt-2">
                          <span className="text-xs text-gray-500">
                            Was this helpful?
                          </span>
                          <button
                            onClick={() => submitFeedback(conv.id, true)}
                            className="p-1 text-green-600 hover:bg-green-100 rounded"
                            title="Helpful"
                          >
                            <ThumbsUp size={14} />
                          </button>
                          <button
                            onClick={() => submitFeedback(conv.id, false)}
                            className="p-1 text-red-600 hover:bg-red-100 rounded"
                            title="Not helpful"
                          >
                            <ThumbsDown size={14} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
