'use client';

import { Database, FileText, Globe, Trash2, RefreshCw } from 'lucide-react';

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

interface KnowledgeSourceListProps {
  sources: KnowledgeSource[];
  loading?: boolean;
  onRefresh?: () => void;
  onDelete?: (id: string) => void;
}

export default function KnowledgeSourceList({
  sources,
  loading,
  onRefresh,
  onDelete,
}: KnowledgeSourceListProps) {
  const formatType = (type: string) => {
    switch (type) {
      case 'file_upload':
        return 'File Upload';
      case 'web_scraping':
        return 'Web Scraping';
      default:
        return type;
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'file_upload':
        return <FileText size={16} className="text-gray-400" />;
      case 'web_scraping':
        return <Globe size={16} className="text-gray-400" />;
      default:
        return <Database size={16} className="text-gray-400" />;
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-gray-500">
        Loading knowledge sources...
      </div>
    );
  }

  if (sources.length === 0) {
    return (
      <div className="p-8 text-center">
        <Database className="w-12 h-12 text-gray-300 mx-auto mb-3" />
        <p className="text-gray-500">No knowledge sources yet</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
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
          {sources.map((source) => (
            <tr key={source.id} className="border-b">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  {getTypeIcon(source.type)}
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
                {onDelete && (
                  <button
                    onClick={() => onDelete(source.id)}
                    className="text-red-500 hover:text-red-700"
                    title="Delete source"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
