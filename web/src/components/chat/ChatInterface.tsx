'use client';

import { useState } from 'react';
import { chatApi } from '@/lib/api';
import toast from 'react-hot-toast';
import MessageList from './MessageList';
import ChatInput from './ChatInput';

interface Source {
  content: string;
  score: number;
  name: string;
}

export default function ChatInterface({ botSlug }: { botSlug: string }) {
  const [messages, setMessages] = useState<Array<{
    role: 'user' | 'assistant';
    content: string;
  }>>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState('');
  const [sources, setSources] = useState<Source[]>([]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setLoading(true);

    try {
      const response = await chatApi.chat(botSlug, userMessage, conversationId);
      const data = response.data;

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.response },
      ]);

      if (!conversationId && data.conversation_id) {
        setConversationId(data.conversation_id);
      }

      if (data.sources) {
        setSources(data.sources);
      }
    } catch (error: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Sorry, I encountered an error. Please try again.',
        },
      ]);
      toast.error(error.response?.data?.error || 'Failed to send message');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    toast.success(`File selected: ${file.name}. Feature coming soon.`);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <MessageList messages={messages} loading={loading} />

      {sources.length > 0 && !loading && (
        <div className="border-t bg-gray-50 p-3">
          <p className="text-xs text-gray-500 mb-2">Sources:</p>
          <div className="space-y-1">
            {sources.map((source, idx) => (
              <div key={idx} className="text-xs text-gray-600 bg-white px-2 py-1 rounded">
                <span className="font-medium">{source.name}</span>
                <span className="ml-1 text-gray-400">({source.score.toFixed(2)})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <ChatInput
        value={input}
        onChange={setInput}
        onSend={handleSend}
        onFileUpload={handleFileUpload}
        disabled={loading}
      />
    </div>
  );
}
