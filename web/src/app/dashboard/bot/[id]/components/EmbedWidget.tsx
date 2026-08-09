'use client';

import { useState, useEffect } from 'react';
import { botApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { Copy, Check, ExternalLink, Globe } from 'lucide-react';

interface EmbedWidgetProps {
  botID: string;
  botName: string;
  botSlug: string;
}

export default function EmbedWidget({ botID, botName, botSlug }: EmbedWidgetProps) {
  const [copied, setCopied] = useState(false);
  const [widgetScript, setWidgetScript] = useState('');
  const [loading, setLoading] = useState(true);

  // Build the embed snippet using the CDN-hosted widget script.
  // The widget endpoint at /api/v1/widget/:botID returns inline JS that
  // dynamically loads the widget from a CDN, so we provide a script tag
  // that loads that endpoint and a container div.
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';
  const embedSnippet = `<script src="${API_URL}/widget/${botID}"></script>\n<div id="flowchat-widget"></div>`;

  useEffect(() => {
    const fetchWidget = async () => {
      try {
        const response = await botApi.getWidget(botID);
        setWidgetScript(response.data);
      } catch (error) {
        // Endpoint returns JS as text; if it fails we still have the
        // generated embed snippet to show.
        console.error('Failed to fetch widget script:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchWidget();
  }, [botID]);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(embedSnippet);
      setCopied(true);
      toast.success('Embed code copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy code');
    }
  };

  const chatURL = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/chat/${botSlug}`;

  return (
    <div className="space-y-6">
      {/* Embed Code Section */}
      <div className="space-y-3">
        <h3 className="text-lg font-medium text-gray-900">Website Embed</h3>
        <p className="text-sm text-gray-600">
          Paste this code snippet into any website to embed your bot "
          {botName}".
        </p>

        <div className="relative">
          <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 text-sm overflow-x-auto">
            <code>{embedSnippet}</code>
          </pre>
          <button
            onClick={copyToClipboard}
            className="absolute top-2 right-2 flex items-center gap-1 px-3 py-1 text-xs text-gray-300 hover:text-white hover:bg-gray-700 rounded transition-colors"
            title="Copy to clipboard"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Chat Link Section */}
      <div className="space-y-3 pt-6 border-t">
        <h3 className="text-lg font-medium text-gray-900">Shareable Chat Link</h3>
        <p className="text-sm text-gray-600">
          Share this direct link to let users chat with your bot:
        </p>

        <div className="flex items-center gap-2">
          <input
            type="text"
            readOnly
            value={chatURL}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-sm text-gray-700"
          />
          <button
            onClick={() => navigator.clipboard.writeText(chatURL).then(() => toast.success('Link copied!'))}
            className="flex items-center gap-1 px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
            title="Copy link"
          >
            <Copy size={14} />
            Copy
          </button>
          <a
            href={chatURL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 px-3 py-2 text-sm text-primary-600 border border-primary-300 rounded-md hover:bg-primary-50"
            title="Open chat link"
          >
            <ExternalLink size={14} />
            Open
          </a>
        </div>
      </div>

      {/* Preview */}
      <div className="space-y-3 pt-6 border-t">
        <h3 className="text-lg font-medium text-gray-900">Preview</h3>
        <p className="text-sm text-gray-600">
          Your bot can be embedded on any page using the snippet above.
          The widget loads asynchronously and won't block page rendering.
        </p>
        <div className="bg-white border rounded-lg p-4 flex items-center gap-3">
          <Globe size={20} className="text-gray-400 flex-shrink-0" />
          <span className="text-sm text-gray-600">
            The widget will appear as a chat bubble overlay on your website.
          </span>
        </div>
      </div>
    </div>
  );
}
