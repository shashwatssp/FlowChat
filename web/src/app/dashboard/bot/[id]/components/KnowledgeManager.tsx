'use client';

import { useState, useEffect } from 'react';
import { knowledgeApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { Upload, Globe, Database, Trash2, RefreshCw, FileText } from 'lucide-react';

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

interface KnowledgeManagerProps {
  botID: string;
}

export default function KnowledgeManager({ botID }: KnowledgeManagerProps) {
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showScrape, setShowScrape] = useState(false);

  // Upload form state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Scrape form state
  const [scrapeURL, setScrapeURL] = useState('');
  const [scrapeSitemap, setScrapeSitemap] = useState(false);

  useEffect(() => {
    fetchSources();
  }, [botID]);

  const fetchSources = async () => {
    setLoading(true);
    try {
      const response = await knowledgeApi.listSources(botID);
      setSources(response.data || []);
    } catch (error) {
      toast.error('Failed to load knowledge sources');
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);
    try {
      await knowledgeApi.uploadFile(botID, selectedFile);
      toast.success('File uploaded and processed successfully');
      setSelectedFile(null);
      setShowUpload(false);
      fetchSources();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to upload file');
    } finally {
      setUploading(false);
    }
  };

  const handleScrape = async () => {
    if (!scrapeURL) return;

    setScraping(true);
    try {
      await knowledgeApi.scrapeWebsite(botID, scrapeURL, scrapeSitemap);
      toast.success('Website scraped and processed successfully');
      setScrapeURL('');
      setShowScrape(false);
      fetchSources();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to scrape website');
    } finally {
      setScraping(false);
    }
  };

  const handleDelete = async (sourceID: string) => {
    if (!confirm('Are you sure you want to delete this knowledge source?')) return;

    try {
      await knowledgeApi.deleteSource(sourceID);
      toast.success('Knowledge source deleted');
      fetchSources();
    } catch (error) {
      toast.error('Failed to delete knowledge source');
    }
  };

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

  const totalChunks = sources.reduce((sum, s) => sum + (s.chunk_count || 0), 0);

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gray-50 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-primary-600">{sources.length}</div>
          <div className="text-sm text-gray-600">Knowledge Sources</div>
        </div>
        <div className="bg-gray-50 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-primary-600">{totalChunks}</div>
          <div className="text-sm text-gray-600">Total Chunks</div>
        </div>
        <div className="bg-gray-50 rounded-lg p-4 text-center">
          <RefreshCw
            size={24}
            className={`mx-auto text-gray-400 cursor-pointer hover:text-primary-600 ${loading ? 'animate-spin' : ''}`}
            onClick={fetchSources}
          />
          <div className="text-sm text-gray-600">Refresh</div>
        </div>
      </div>

      {/* Add Buttons */}
      <div className="flex gap-3">
        <button
          onClick={() => setShowUpload(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
        >
          <Upload size={16} />
          Upload File
        </button>
        <button
          onClick={() => setShowScrape(true)}
          className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
        >
          <Globe size={16} />
          Scrape Website
        </button>
      </div>

      {/* Upload Form */}
      {showUpload && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="text-lg font-medium text-gray-900 mb-3">Upload File</h3>
          <p className="text-sm text-gray-600 mb-3">
            Supported: .txt, .pdf, .docx, .md, .csv, .json (max 10MB)
          </p>
          <div className="space-y-3">
            <input
              type="file"
              accept=".txt,.pdf,.docx,.md,.csv,.json"
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              className="w-full text-sm text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary-600 file:text-white hover:file:bg-primary-700"
            />
            <div className="flex gap-3">
              <button
                onClick={handleUpload}
                disabled={uploading || !selectedFile}
                className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
              >
                {uploading ? 'Uploading...' : 'Upload & Process'}
              </button>
              <button
                onClick={() => {
                  setShowUpload(false);
                  setSelectedFile(null);
                }}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scrape Form */}
      {showScrape && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <h3 className="text-lg font-medium text-gray-900 mb-3">Scrape Website</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                URL
              </label>
              <input
                type="url"
                value={scrapeURL}
                onChange={(e) => setScrapeURL(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="https://example.com"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="sitemap"
                checked={scrapeSitemap}
                onChange={(e) => setScrapeSitemap(e.target.checked)}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <label htmlFor="sitemap" className="text-sm text-gray-700">
                Scrape sitemap (use sitemap.xml to discover all pages)
              </label>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleScrape}
                disabled={scraping || !scrapeURL}
                className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
              >
                {scraping ? 'Scraping...' : 'Scrape & Process'}
              </button>
              <button
                onClick={() => {
                  setShowScrape(false);
                  setScrapeURL('');
                  setScrapeSitemap(false);
                }}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sources List */}
      <div className="bg-white border rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading sources...</div>
        ) : sources.length === 0 ? (
          <div className="p-8 text-center">
            <Database className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No knowledge sources yet.</p>
            <p className="text-sm text-gray-400 mt-1">
              Upload a file or scrape a website to add knowledge.
            </p>
          </div>
        ) : (
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
                      <FileText size={16} className="text-gray-400" />
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
                    <span className="text-sm text-gray-500">
                      {new Date(source.created_at).toLocaleDateString()}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`inline-block px-2 py-1 text-xs rounded-full ${
                        source.status === 'processed'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-yellow-100 text-yellow-800'
                      }`}
                    >
                      {source.status}
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
        )}
      </div>
    </div>
  );
}
