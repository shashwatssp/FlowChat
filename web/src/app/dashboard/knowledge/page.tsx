'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { botApi, knowledgeApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { Database, Upload, Globe, Trash2, RefreshCw, FileText } from 'lucide-react';

interface Bot {
  id: string;
  name: string;
  slug: string;
}

interface KnowledgeSource {
  id: string;
  bot_id: string;
  bot_name?: string;
  name: string;
  type: string;
  url: string;
  status: string;
  chunk_count: number;
  created_at: string;
}

export default function KnowledgePage() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBot, setSelectedBot] = useState<string>('all');
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
      const botsResponse = await botApi.list();
      setBots(botsResponse.data || []);

      let allSources: KnowledgeSource[] = [];
      for (const bot of botsResponse.data || []) {
        try {
          const response = await knowledgeApi.listSources(bot.id);
          const sourcesWithBot = (response.data || []).map((src: any) => ({
            ...src,
            bot_name: bot.name,
          }));
          allSources = [...allSources, ...sourcesWithBot];
        } catch {
          // Skip if API fails for a specific bot
        }
      }
      setSources(allSources);
    } catch (error: any) {
      if (error.response?.status === 401) {
        localStorage.removeItem('token');
        router.push('/login');
      } else {
        toast.error('Failed to load knowledge sources');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (sourceID: string) => {
    if (!confirm('Are you sure you want to delete this knowledge source?')) return;
    try {
      await knowledgeApi.deleteSource(sourceID);
      toast.success('Knowledge source deleted');
      setSources(sources.filter(s => s.id !== sourceID));
    } catch {
      toast.error('Failed to delete knowledge source');
    }
  };

  const filteredSources = selectedBot === 'all'
    ? sources
    : sources.filter(s => s.bot_id === selectedBot);

  const formatType = (type: string) => {
    switch (type) {
      case 'file_upload': return 'File Upload';
      case 'web_scraping': return 'Web Scraping';
      default: return type;
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
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Knowledge Sources</h1>
          <select
            value={selectedBot}
            onChange={(e) => setSelectedBot(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="all">All Bots</option>
            {bots.map(bot => (
              <option key={bot.id} value={bot.id}>{bot.name}</option>
            ))}
          </select>
        </div>

        {filteredSources.length === 0 ? (
          <div className="text-center py-16">
            <Database className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-xl font-medium text-gray-900 mb-2">No knowledge sources</h3>
            <p className="text-gray-600">
              Knowledge sources will appear here when you upload files or scrape websites.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full bg-white rounded-lg shadow-sm border">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Source</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Bot</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Chunks</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Created</th>
                  <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSources.map((source) => (
                  <tr key={source.id} className="border-b">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <FileText size={16} className="text-gray-400" />
                        <span className="text-sm text-gray-900 truncate max-w-xs">{source.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-600">{source.bot_name || 'Unknown'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-600">{formatType(source.type)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-600">{source.chunk_count || 0}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-500">
                        {new Date(source.created_at).toLocaleDateString()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleDelete(source.id)}
                        className="text-red-500 hover:text-red-700"
                        title="Delete source"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
