'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { knowledgeApi } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  Database,
  FileText,
  Globe,
  Mic,
  RefreshCw,
  Trash2,
} from 'lucide-react';

interface KnowledgeSource {
  id: string;
  bot_id: string;
  name: string;
  type: string;
  url: string;
  status: string;
  chunk_count: number;
  created_at: string;
}

interface DocumentManagementTableProps {
  botID: string;
  /** Incremented by the parent (e.g. after an upload) to trigger a refetch. */
  refreshTrigger?: number;
}

function formatType(type: string) {
  switch (type) {
    case 'file_upload':
      return 'File Upload';
    case 'web_scraping':
      return 'Web Scraping';
    case 'voice_to_text':
      return 'Voice Recording';
    default:
      return type || '—';
  }
}

function getTypeIcon(type: string) {
  switch (type) {
    case 'file_upload':
      return <FileText size={16} className="text-gray-400" />;
    case 'web_scraping':
      return <Globe size={16} className="text-gray-400" />;
    case 'voice_to_text':
      return <Mic size={16} className="text-gray-400" />;
    default:
      return <Database size={16} className="text-gray-400" />;
  }
}

function StatusBadge({ status }: { status: string }) {
  let cls = 'bg-yellow-100 text-yellow-800';
  const normalized = (status || '').toLowerCase();
  if (
    normalized === 'processed' ||
    normalized === 'ready' ||
    normalized === 'complete' ||
    normalized === 'success'
  ) {
    cls = 'bg-green-100 text-green-800';
  } else if (normalized === 'failed' || normalized === 'error') {
    cls = 'bg-red-100 text-red-800';
  }
  return (
    <span className={`inline-block px-2 py-1 text-xs rounded-full ${cls}`}>
      {status || '—'}
    </span>
  );
}

/**
 * Document management table.
 *
 * Self-contained: fetches its own knowledge sources for a bot and renders a
 * table with chunk counts, status, and row actions. Supports the full set of
 * training-data actions: list documents, chunk count, re-index, delete.
 */
export default function DocumentManagementTable({
  botID,
  refreshTrigger = 0,
}: DocumentManagementTableProps) {
  const router = useRouter();
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [reindexing, setReindexing] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const token =
      typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token) {
      router.push('/login');
      return;
    }
    loadSources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botID, refreshTrigger, router]);

  const loadSources = async () => {
    setLoading(true);
    try {
      const response = await knowledgeApi.listSources(botID);
      setSources(response.data || []);
    } catch (error: any) {
      if (error.response?.status === 401) {
        localStorage.removeItem('token');
        router.push('/login');
      } else {
        toast.error('Failed to load documents');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (source: KnowledgeSource) => {
    if (!confirm(`Delete "${source.name}"? This cannot be undone.`)) return;
    try {
      await knowledgeApi.deleteSource(source.id);
      setSources((prev) => prev.filter((s) => s.id !== source.id));
      toast.success('Document deleted');
    } catch {
      toast.error('Failed to delete document');
    }
  };

  const handleReindex = async (source: KnowledgeSource) => {
    setReindexing((prev) => ({ ...prev, [source.id]: true }));
    try {
      await knowledgeApi.reindex(source.id);
      toast.success(`"${source.name}" indexed successfully`);
      // Optimistically flip the status while the backend re-processes.
      setSources((prev) =>
        prev.map((s) =>
          s.id === source.id ? { ...s, status: 'indexing' } : s
        )
      );
      loadSources();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to re-index document');
    } finally {
      setReindexing((prev) => ({ ...prev, [source.id]: false }));
    }
  };

  const totalChunks = sources.reduce((sum, s) => sum + (s.chunk_count || 0), 0);

  return (
    <div className="space-y-4">
      {/* Summary + refresh */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="bg-gray-50 rounded-lg px-3 py-2">
            <span className="text-sm text-gray-600">Documents: </span>
            <span className="font-medium text-gray-900">{sources.length}</span>
          </div>
          <div className="bg-gray-50 rounded-lg px-3 py-2">
            <span className="text-sm text-gray-600">Chunks: </span>
            <span className="font-medium text-gray-900">{totalChunks}</span>
          </div>
        </div>
        <button
          onClick={loadSources}
          disabled={loading}
          className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Table */}
      <div className="bg-white border rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">
            Loading documents...
          </div>
        ) : sources.length === 0 ? (
          <div className="p-8 text-center">
            <Database className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No documents yet.</p>
            <p className="text-sm text-gray-400 mt-1">
              Upload a file or scrape a website to add knowledge.
            </p>
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="sm:hidden space-y-3">
              {sources.map((source) => (
                <div
                  key={source.id}
                  className="bg-white rounded-lg shadow-sm border p-4 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {getTypeIcon(source.type)}
                      <span className="text-sm font-medium text-gray-900 truncate">
                        {source.name}
                      </span>
                    </div>
                    <StatusBadge status={source.status} />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-gray-500">Type:</span>{" "}
                      <span className="text-gray-600">{formatType(source.type)}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Chunks:</span>{" "}
                      <span className="text-gray-600">{source.chunk_count || 0}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Created:</span>{" "}
                      <span className="text-gray-600">
                        {new Date(source.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => handleReindex(source)}
                      disabled={reindexing[source.id]}
                      className="flex-1 p-2 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
                      title="Re-index"
                    >
                      <RefreshCw size={14} className="mx-auto mb-1" />
                      Re-index
                    </button>
                    <button
                      onClick={() => handleDelete(source)}
                      className="flex-1 p-2 text-sm text-red-600 border border-red-200 rounded-md hover:bg-red-50"
                      title="Delete"
                    >
                      <Trash2 size={14} className="mx-auto mb-1" />
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                  Source
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                  Type
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                  Chunks
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                  Status
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                  Created
                </th>
                <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {sources.map((source) => (
                <tr key={source.id} className="border-b">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {getTypeIcon(source.type)}
                      <span className="text-sm text-gray-900 truncate max-w-xs">
                        {source.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-gray-600">
                      {formatType(source.type)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-gray-600">
                      {source.chunk_count || 0}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={source.status} />
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-gray-500">
                      {new Date(source.created_at).toLocaleDateString()}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => handleReindex(source)}
                        disabled={reindexing[source.id]}
                        className="p-1 text-gray-500 hover:text-primary-600 rounded hover:bg-gray-100 disabled:opacity-50"
                        title="Re-index"
                      >
                        <RefreshCw size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(source)}
                        className="p-1 text-gray-500 hover:text-red-600 rounded hover:bg-gray-50"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
