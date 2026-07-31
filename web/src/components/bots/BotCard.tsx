'use client';

import Link from 'next/link';
import { Bot, ExternalLink, BarChart3, Calendar } from 'lucide-react';

interface BotCardProps {
  bot: {
    id: string;
    name: string;
    description: string;
    slug: string;
    avatar_url: string;
    system_prompt: string;
    api_key: string;
    usage_count: number;
    created_at: string;
  };
  onDelete: (botId: string) => void;
}

export default function BotCard({ bot, onDelete }: BotCardProps) {
  return (
    <div className="bg-white rounded-lg shadow-sm border hover:shadow-md transition-shadow">
      <div className="p-6">
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
              <h3 className="text-lg font-semibold text-gray-900">{bot.name}</h3>
              <p className="text-sm text-gray-500">
                Created {new Date(bot.created_at).toLocaleDateString()}
              </p>
            </div>
          </div>
          <button
            onClick={() => onDelete(bot.id)}
            className="text-gray-400 hover:text-red-600 transition-colors"
            title="Delete bot"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.975-1.858L5 7m5 5v5m0 0l-1.5-1.5m1.5 1.5l1.5-1.5M5 7V4a2 2 0 012-2h10a2 2 0 012 2v3m-5 5h-5m5 0L12 7m0 0l1.5 1.5M12 7v10"
              />
            </svg>
          </button>
        </div>

        {bot.description && (
          <p className="text-gray-600 text-sm mb-4 line-clamp-2">{bot.description}</p>
        )}

        <div className="flex items-center gap-4 text-xs text-gray-500 mb-4">
          <div className="flex items-center gap-1">
            <BarChart3 size={14} />
            <span>{bot.usage_count} chats</span>
          </div>
          <div className="flex items-center gap-1">
            <Calendar size={14} />
            <span>{new Date(bot.created_at).toLocaleDateString()}</span>
          </div>
        </div>

        <div className="flex gap-2 pt-4 border-t">
          <Link
            href={`/dashboard/bot/${bot.id}`}
            className="flex-1 px-3 py-2 bg-primary-600 text-white text-sm rounded-lg hover:bg-primary-700 text-center"
          >
            Manage
          </Link>
          <a
            href={`/chat/${bot.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 px-3 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50 text-center"
            title="Open chat"
          >
            <ExternalLink size={14} className="inline" />
          </a>
        </div>
      </div>
    </div>
  );
}
