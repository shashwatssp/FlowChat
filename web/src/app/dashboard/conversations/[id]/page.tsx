'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { conversationApi, botApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { ArrowLeft, Calendar, ThumbsUp, ThumbsDown, Bot, User } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface ConversationMessage {
  id: string;
  conversation_id: string;
  bot_id: string;
  role: string;
  content: string;
  created_at: string;
}

interface Bot {
  id: string;
  name: string;
  slug: string;
}

export default function ConversationDetailPage() {
  const params = useParams();
  const convID = params.id as string;
  const router = useRouter();
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [botName, setBotName] = useState('Unknown Bot');
  const [feedbackGiven, setFeedbackGiven] = useState<Record<string, boolean | null>>({});

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
      return;
    }
    fetchMessages();
  }, [convID, router]);

  const fetchMessages = async () => {
    setLoading(true);
    try {
      const response = await conversationApi.getMessages(convID);
      const msgs = response.data.messages || [];
      setMessages(msgs);

      // Fetch bot name
      if (msgs.length > 0 && msgs[0].bot_id) {
        try {
          const botResponse = await botApi.get(msgs[0].bot_id);
          setBotName(botResponse.data.name || 'Unknown Bot');
        } catch {
          setBotName('Unknown Bot');
        }
      }
    } catch (error: any) {
      if (error.response?.status === 401) {
        localStorage.removeItem('token');
        router.push('/login');
      } else {
        toast.error('Failed to load conversation');
      }
    } finally {
      setLoading(false);
    }
  };

  const submitFeedback = async (messageId: string, helpful: boolean) => {
    try {
      await conversationApi.saveFeedback(convID, {
        helpful,
        rating: helpful ? 5 : 1,
        comment: '',
      });
      setFeedbackGiven({ ...feedbackGiven, [messageId]: helpful });
      toast.success('Feedback saved');
    } catch {
      toast.error('Failed to save feedback');
    }
  };

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
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-4 mb-6">
            <Link
              href="/dashboard/conversations"
              className="text-gray-500 hover:text-gray-700 transition-colors"
            >
              <ArrowLeft size={20} />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{botName}</h1>
              <div className="flex items-center gap-2 text-sm text-gray-500 mt-1">
                <Calendar size={14} />
                <span>
                  {messages.length > 0
                    ? new Date(messages[0].created_at).toLocaleString()
                    : 'Unknown date'}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border">
            <div className="divide-y">
              {messages.map((msg) => (
                <div key={msg.id} className="p-6">
                  <div className="flex gap-4">
                    <div className="flex-shrink-0">
                      {msg.role === 'user' ? (
                        <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center">
                          <User size={16} className="text-gray-600" />
                        </div>
                      ) : (
                        <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
                          <Bot size={16} className="text-primary-600" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="prose max-w-none">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                      <div className="flex items-center gap-2 mt-3">
                        <span className="text-xs text-gray-500">
                          {new Date(msg.created_at).toLocaleTimeString()}
                        </span>
                        {msg.role === 'assistant' && (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => submitFeedback(msg.id, true)}
                              className={`p-1 rounded ${
                                feedbackGiven[msg.id] === true
                                  ? 'bg-green-100 text-green-600'
                                  : 'text-gray-400 hover:text-green-600 hover:bg-green-50'
                              }`}
                              title="Helpful"
                            >
                              <ThumbsUp size={14} />
                            </button>
                            <button
                              onClick={() => submitFeedback(msg.id, false)}
                              className={`p-1 rounded ${
                                feedbackGiven[msg.id] === false
                                  ? 'bg-red-100 text-red-600'
                                  : 'text-gray-400 hover:text-red-600 hover:bg-red-50'
                              }`}
                              title="Not helpful"
                            >
                              <ThumbsDown size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
