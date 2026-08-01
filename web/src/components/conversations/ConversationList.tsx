'use client';

import { MessageCircle } from 'lucide-react';

interface ConversationListProps {
  conversations: Array<{
    id: string;
    bot_name?: string;
    created_at: string;
    message_count?: number;
  }>;
  loading?: boolean;
  onSelect: (id: string) => void;
  selectedId?: string;
}

export default function ConversationList({
  conversations,
  loading,
  onSelect,
  selectedId,
}: ConversationListProps) {
  if (loading) {
    return (
      <div className="p-4 text-center text-gray-500">
        Loading conversations...
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="p-8 text-center">
<MessageCircle className="w-12 h-12 text-gray-300 mx-auto mb-3" />
        <p className="text-gray-500">No conversations yet</p>
      </div>
    );
  }

  return (
    <div className="divide-y">
      {conversations.map((conv) => (
        <div
          key={conv.id}
          onClick={() => onSelect(conv.id)}
          className={`p-4 cursor-pointer transition-colors ${
            selectedId === conv.id
              ? 'bg-primary-50 border-r-2 border-primary-600'
              : 'hover:bg-gray-50'
          }`}
        >
          <div className="flex items-center gap-3">
<MessageCircle size={16} className="text-gray-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {conv.bot_name || 'Unknown Bot'}
              </p>
              <p className="text-xs text-gray-500">
                {new Date(conv.created_at).toLocaleString()}
              </p>
            </div>
            {conv.message_count && (
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">
                {conv.message_count} msgs
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
