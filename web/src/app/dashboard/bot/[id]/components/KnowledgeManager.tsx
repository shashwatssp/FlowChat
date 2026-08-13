'use client';

import { useState } from 'react';
import { knowledgeApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { Upload, Globe, Save, Sparkles } from 'lucide-react';
import VoiceInput from '@/components/ui/VoiceInput';
import DocumentManagementTable from '@/components/dashboard/DocumentManagementTable';

interface KnowledgeManagerProps {
  botID: string;
}

/**
 * Bot knowledge tab.
 *
 * Handles adding training data (file uploads + website scraping) and delegates
 * the document listing/chunk-count/re-index/delete table to the reusable
 * `<DocumentManagementTable />` component. The `refreshTrigger` is bumped after
 * a successful upload/scrape so the table re-fetches its source list.
 */
export default function KnowledgeManager({ botID }: KnowledgeManagerProps) {
  const [uploading, setUploading] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showScrape, setShowScrape] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [scrapeURL, setScrapeURL] = useState('');
  const [scrapeSitemap, setScrapeSitemap] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Voice-to-knowledge state
  const [voiceText, setVoiceText] = useState('');
  const [refiningVoice, setRefiningVoice] = useState(false);
  const [savingVoice, setSavingVoice] = useState(false);
  const [showVoiceKnowledge, setShowVoiceKnowledge] = useState(false);

  const handleUpload = async () => {
    if (!selectedFile) return;
    setUploading(true);
    try {
      await knowledgeApi.uploadFile(botID, selectedFile);
      toast.success('File uploaded and processed successfully');
      setSelectedFile(null);
      setShowUpload(false);
      setRefreshKey((k) => k + 1);
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
      setScrapeSitemap(false);
      setRefreshKey((k) => k + 1);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to scrape website');
    } finally {
      setScraping(false);
    }
  };

  const handleRefineVoice = async () => {
    if (!voiceText.trim()) return;
    setRefiningVoice(true);
    try {
      const refined = await knowledgeApi.refineVoice(voiceText, 'message');
      setVoiceText(refined);
      toast.success('Voice text refined with AI');
    } catch {
      toast('Voice text kept as-is (refinement failed)');
    }
    setRefiningVoice(false);
  };

  const handleSaveVoiceText = async () => {
    if (!voiceText.trim()) {
      toast('No text to save. Speak or type something first.');
      return;
    }
    setSavingVoice(true);
    try {
      const resp = await knowledgeApi.saveText(botID, voiceText.trim());
      const chunks = (resp.data as any)?.chunks;
      toast.success(
        chunks && chunks > 1
          ? `Voice transcript saved — ${chunks} chunks indexed!`
          : 'Voice transcript saved to knowledge base!',
      );
      setVoiceText('');
      setShowVoiceKnowledge(false);
      setRefreshKey((k) => k + 1);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to save voice transcript');
    } finally {
      setSavingVoice(false);
    }
  };

  return (
    <div className="space-y-6">
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
            Supported: .txt, .pdf, .docx, .md, .csv, .json, .tex, .latex (max 10MB)
          </p>
          <div className="space-y-3">
            <input
              type="file"
              accept=".txt,.pdf,.docx,.md,.csv,.json,.tex,.latex"
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

      {/* Voice-to-Knowledge Section */}
      <div className="border border-purple-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-medium text-gray-900">Voice to Knowledge</h3>
          <button
            onClick={() => setShowVoiceKnowledge(!showVoiceKnowledge)}
            className="text-sm text-primary-600 hover:text-primary-700 font-medium"
          >
            {showVoiceKnowledge ? 'Hide' : 'Show'}
          </button>
        </div>
        <p className="text-sm text-gray-600 mb-3">
          Speak into the mic to convert speech to text. Edit the text as needed, refine with AI,
          then save — it becomes embedded knowledge the bot can answer from.
        </p>
        {showVoiceKnowledge && (
          <div className="space-y-4">
            <VoiceInput
              label="Voice Transcript"
              value={voiceText}
              onChange={setVoiceText}
              placeholder="Click the mic and speak… your text will appear here. You can also type or edit directly."
              field="message"
              textarea
              rows={4}
              helperText="Voice text is inserted at the cursor position. Keep speaking to build up your content."
            />
            <div className="flex gap-3">
              <button
                onClick={handleRefineVoice}
                disabled={refiningVoice || !voiceText.trim()}
                className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50"
              >
                <Sparkles size={16} />
                {refiningVoice ? 'Refining…' : 'Refine with AI'}
              </button>
              <button
                onClick={handleSaveVoiceText}
                disabled={savingVoice || !voiceText.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
              >
                <Save size={16} />
                {savingVoice ? 'Saving…' : 'Save to Knowledge Base'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Scrape Form */}
      {showScrape && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <h3 className="text-lg font-medium text-gray-900 mb-3">Scrape Website</h3>
          <div className="space-y-3">
            <VoiceInput
              label="Website URL"
              value={scrapeURL}
              onChange={setScrapeURL}
              placeholder="https://example.com"
              field="website_url"
            />
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

      {/* Documents table (list / chunk count / re-index / delete) */}
      <DocumentManagementTable botID={botID} refreshTrigger={refreshKey} />
    </div>
  );
}
