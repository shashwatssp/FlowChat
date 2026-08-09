'use client';

import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { botApi, conversationApi } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  MessageSquare,
  BarChart3,
  Clock,
  Database,
  Activity,
  RefreshCw,
} from 'lucide-react';

interface BotStats {
  total_conversations: number;
  total_messages: number;
  knowledge_sources: number;
}

interface Conversation {
  id: string;
  bot_id: string;
  created_at: string;
}

interface Message {
  id: string;
  conversation_id: string;
  bot_id: string;
  role: string;
  content: string;
  created_at: string;
}

interface AnalyticsChartsProps {
  botID: string;
  botName?: string;
}

// Sample the most recent N conversations to keep message fetching bounded.
const MAX_CONVERSATIONS = 30;
// Show the most recent N dates on the volume chart.
const MAX_DATES = 14;

// Lightweight English stop-word list for rough keyword extraction.
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'is', 'are', 'to', 'of',
  'in', 'on', 'for', 'with', 'at', 'by', 'from', 'it', 'this', 'that', 'these',
  'those', 'as', 'be', 'was', 'were', 'been', 'being', 'have', 'has', 'had',
  'i', 'you', 'we', 'they', 'he', 'she', 'them', 'your', 'my', 'our', 'their',
  'his', 'her', 'its', 'not', 'no', 'so', 'do', 'does', 'did', 'what', 'how',
  'when', 'where', 'which', 'who', 'whom', 'can', 'will', 'would', 'could',
  'should', 'there', 'here', 'about', 'than', 'out', 'up', 'down', 'more',
  'most', 'some', 'any', 'all', 'every', 'each', 'also', 'only', 'very',
  'just', 'like', 'such',
]);

/**
 * Per-bot analytics.
 *
 * Fetches bot stats and conversation messages from the existing API and
 * renders lightweight, dependency-free charts (pure Tailwind/CSS):
 *   - stat cards (conversations, messages, knowledge sources, avg msgs/conv,
 *     avg duration)
 *   - message volume over time (bar chart)
 *   - common topics (horizontal keyword-frequency bar chart)
 *
 * The API does not yet expose active-user or feedback-aggregation endpoints,
 * so those dimensions are intentionally left out rather than fabricated.
 */
export default function AnalyticsCharts({ botID, botName }: AnalyticsChartsProps) {
  const router = useRouter();
  const [stats, setStats] = useState<BotStats | null>(null);
  const [volumeData, setVolumeData] = useState<
    Array<{ date: string; count: number }>
  >([]);
  const [topTopics, setTopTopics] = useState<
    Array<{ word: string; count: number }>
  >([]);
  const [avgDuration, setAvgDuration] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token) {
      router.push('/login');
      return;
    }
    loadAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, botID]);

  const loadAnalytics = async () => {
    setLoading(true);
    try {
      const statsRes = await botApi.getStats(botID);
      setStats(statsRes.data as BotStats);

      const convRes = await conversationApi.list(botID);
      const conversations = ((convRes.data || []) as Conversation[]).sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      if (conversations.length > 0) {
        const sample = conversations.slice(0, MAX_CONVERSATIONS);
        const msgsPerConv = await Promise.all(
          sample.map((c) =>
            conversationApi
              .getMessages(c.id)
              .then((r) => (r.data?.messages || []) as Message[])
              .catch(() => [] as Message[])
          )
        );
        const allMessages: Message[] = msgsPerConv.flat();

        // Message volume by date (most recent MAX_DATES first, displayed oldest→newest).
        const dateCounts: Record<string, number> = {};
        allMessages.forEach((m) => {
          const d = new Date(m.created_at).toLocaleDateString();
          dateCounts[d] = (dateCounts[d] || 0) + 1;
        });
        const volume = Object.entries(dateCounts)
          .map(([date, count]) => ({ date, count }))
          .sort(
            (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
          )
          .slice(0, MAX_DATES)
          .reverse();
        setVolumeData(volume);

        // Common topics = top keywords by frequency across all messages.
        const wordCounts: Record<string, number> = {};
        allMessages.forEach((m) => {
          (m.content || '')
            .toLowerCase()
            .replace(/[^a-z0-9\s]/gi, ' ')
            .split(/\s+/)
            .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
            .forEach((w) => {
              wordCounts[w] = (wordCounts[w] || 0) + 1;
            });
        });
        const topics = Object.entries(wordCounts)
          .map(([word, count]) => ({ word, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 8);
        setTopTopics(topics);

        // Average conversation duration (last - first message), in minutes.
        let totalDuration = 0;
        let counted = 0;
        msgsPerConv.forEach((msgs) => {
          if (msgs.length >= 2) {
            const times = msgs.map((m) =>
              new Date(m.created_at).getTime()
            );
            const duration = Math.max(...times) - Math.min(...times);
            if (duration > 0) {
              totalDuration += duration;
              counted += 1;
            }
          }
        });
        setAvgDuration(
          counted > 0 ? totalDuration / counted / (1000 * 60) : null
        );
      }
    } catch (error: any) {
      if (error.response?.status === 401) {
        localStorage.removeItem('token');
        router.push('/login');
      } else {
        toast.error('Failed to load analytics');
      }
    } finally {
      setLoading(false);
    }
  };

  const totalMessages = stats?.total_messages ?? 0;
  const totalConversations = stats?.total_conversations ?? 0;
  const avgMsgsPerConv =
    totalConversations > 0
      ? (totalMessages / totalConversations).toFixed(1)
      : '0';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Analytics</h2>
          {botName && <p className="text-sm text-gray-500">{botName}</p>}
        </div>
        <button
          onClick={loadAnalytics}
          className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
          title="Refresh"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard
          icon={<MessageSquare size={20} />}
          label="Conversations"
          value={totalConversations}
        />
        <StatCard
          icon={<BarChart3 size={20} />}
          label="Messages"
          value={totalMessages}
        />
        <StatCard
          icon={<Database size={20} />}
          label="Knowledge Sources"
          value={stats?.knowledge_sources ?? 0}
        />
        <StatCard
          icon={<Activity size={20} />}
          label="Avg Msgs/Conv"
          value={avgMsgsPerConv}
        />
        <StatCard
          icon={<Clock size={20} />}
          label="Avg Duration"
          value={avgDuration != null ? `${avgDuration.toFixed(1)}m` : '—'}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Message volume over time */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Message Volume
          </h3>
          {volumeData.length === 0 ? (
            <p className="text-sm text-gray-500">
              No message data available yet.
            </p>
          ) : (
            <VolumeChart data={volumeData} />
          )}
        </div>

        {/* Common topics */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Common Topics
          </h3>
          {topTopics.length === 0 ? (
            <p className="text-sm text-gray-500">No topic data available.</p>
          ) : (
            <KeywordChart topics={topTopics} />
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="bg-gray-50 rounded-lg p-4 text-center">
      <div className="flex items-center justify-center gap-2 text-gray-600 mb-1">
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
    </div>
  );
}

function VolumeChart({
  data,
}: {
  data: Array<{ date: string; count: number }>;
}) {
  const maxCount = Math.max(...data.map((d) => d.count));
  return (
    <div className="flex items-end gap-2 h-44">
      {data.map((d) => {
        const height = maxCount ? Math.max((d.count / maxCount) * 100, 3) : 3;
        return (
          <div
            key={d.date}
            className="flex flex-col items-center justify-end flex-1"
          >
            <span className="text-xs text-gray-500 mb-1">{d.count}</span>
            <div
              className="w-full bg-primary-500 rounded-t transition-colors hover:bg-primary-600"
              style={{ height: `${height}%` }}
            />
            <span
              className="text-[9px] text-gray-400 mt-1 max-w-full truncate"
              style={{ transform: 'rotate(-45deg)', transformOrigin: 'top left' }}
            >
              {d.date}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function KeywordChart({
  topics,
}: {
  topics: Array<{ word: string; count: number }>;
}) {
  const maxCount = Math.max(...topics.map((t) => t.count));
  return (
    <div className="space-y-3">
      {topics.map((t) => (
        <div key={t.word} className="flex items-center gap-2">
          <span className="w-28 text-xs text-gray-600 truncate">
            {t.word}
          </span>
          <div className="flex-1 bg-gray-100 rounded h-5">
            <div
              className="bg-primary-600 h-5 rounded"
              style={{
                width: `${maxCount ? (t.count / maxCount) * 100 : 0}%`,
              }}
            />
          </div>
          <span className="text-xs text-gray-500 w-8 text-right">{t.count}</span>
        </div>
      ))}
    </div>
  );
}
