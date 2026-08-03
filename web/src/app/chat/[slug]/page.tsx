'use client';

import { useParams } from 'next/navigation';
import { Bot } from 'lucide-react';
import ChatInterface from '@/components/chat/ChatInterface';

export default function ChatPage() {
  const params = useParams();
  const botSlug = params.slug as string;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
              <Bot className="w-6 h-6 text-primary-600" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">FlowChat Assistant</h1>
              <p className="text-sm text-gray-500">Powered by AI</p>
            </div>
          </div>
        </div>
      </header>

      {/* Chat Interface */}
      <ChatInterface botSlug={botSlug} />
    </div>
  );
}
