'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  Bot,
  User,
  Copy,
  Check,
  RefreshCw,
  Share2,
  ExternalLink,
} from 'lucide-react';
import { ChatMessage as ChatMessageType, Source } from '@/types/chat';

interface Props {
  message: ChatMessageType;
  isStreaming: boolean;
  onRetry: () => void;
  onRegenerate: () => void;
  onCopy: () => void;
  onSendFeedback: (helpful: boolean) => void;
  onSourceClick: (source: Source) => void;
}

export default function ChatMessage({
  message,
  isStreaming,
  onRetry,
  onRegenerate,
  onCopy,
  onSendFeedback,
  onSourceClick,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [showSources, setShowSources] = useState(false);

  const isUser = message.role === 'user';
  const isError = message.status === 'error';
  const isAssistant = message.role === 'assistant';
  const isStreamingThis = isStreaming && isAssistant && message.status === 'streaming';

  const handleCopy = () => {
    setCopied(true);
    onCopy();
    setTimeout(() => setCopied(false), 2000);
  };

  const getAvatar = () => {
    if (isUser) {
      return (
        <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center flex-shrink-0">
          <User className="w-5 h-5 text-gray-600" />
        </div>
      );
    }
    return (
      <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
        <Bot className="w-5 h-5 text-primary-600" />
      </div>
    );
  };

  const getBubbleClasses = () => {
    if (isUser) {
      return 'bg-primary-600 text-white';
    }
    if (isError) {
      return 'bg-red-50 border border-red-200 text-red-900';
    }
    return 'bg-white border border-gray-200';
  };

  const renderContent = () => {
    if (isError) {
      return (
        <div className="flex flex-col gap-2">
          <p className="font-medium">Something went wrong</p>
          {message.error && (
            <p className="text-sm text-red-700 break-words">
              {message.error}
            </p>
          )}
          <button
            onClick={onRetry}
            className="self-start px-3 py-1.5 bg-red-600 text-white rounded-md text-sm hover:bg-red-700 transition-colors flex items-center gap-1"
          >
            <RefreshCw size={14} />
            Retry
          </button>
        </div>
      );
    }

    return (
      <>
        <div className={isUser ? 'prose prose-sm prose-invert max-w-none' : 'prose max-w-none'}>
          {message.content ? (
            <ReactMarkdown
              components={{
                a: ({ node, ...props }) => (
                  <a
                    {...props}
                    className={isUser ? 'text-blue-200 underline' : 'text-primary-600 underline'}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                ),
                p: ({ node, ...props }) => <p {...props} className="mb-2 last:mb-0" />,
                ul: ({ node, ...props }) => <ul {...props} className="ml-4 mb-2" />,
                ol: ({ node, ...props }) => <ol {...props} className="ml-4 mb-2" />,
              }}
            >
              {message.content}
            </ReactMarkdown>
          ) : (isStreamingThis ? (
            <span className="text-gray-400 italic">Thinking...</span>
          ) : (
            <span className="text-gray-400 italic">No response</span>
          ))}
        </div>

        {message.sources && message.sources.length > 0 && (
          <div className="mt-3 space-y-2">
            <button
              onClick={() => setShowSources(!showSources)}
              className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
            >
              <Share2 size={12} />
              {showSources ? 'Hide' : 'Show'} sources ({message.sources.length})
            </button>
            {showSources && (
              <div className="space-y-2">
                {message.sources.map((source, idx) => (
                  <div
                    key={source.name + idx}
                    className="text-xs bg-gray-50 border border-gray-100 rounded-md p-2 cursor-pointer hover:bg-gray-100 transition-colors"
                    onClick={() => onSourceClick(source)}
                  >
                    <div className="flex justify-between items-start gap-2">
                      <span className="font-medium text-gray-700 truncate">
                        {source.name || `Source ${idx + 1}`}
                      </span>
                      {source.url && (
                        <ExternalLink size={10} className="text-gray-400 flex-shrink-0" />
                      )}
                    </div>
                    <p className="text-gray-500 mt-1 line-clamp-2">
                      {source.content?.substring(0, 100)}
                      {source.content && source.content.length > 100 && '...'}
                    </p>
                    <div className="flex justify-between mt-1">
                      <span className="text-gray-400">
                        Score: {source.score.toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </>
    );
  };

  const renderActions = () => {
    if (isError) {
      return null;
    }

    const actions: { icon: React.ReactNode; label: string; onClick: () => void }[] = [];

    if (!isUser) {
      actions.push({
        icon: <RefreshCw size={14} />,
        label: 'Regenerate',
        onClick: onRegenerate,
      });
    }

    actions.push({
      icon: copied ? <Check size={14} /> : <Copy size={14} />,
      label: copied ? 'Copied' : 'Copy',
      onClick: handleCopy,
    });

    return (
      <div className={`flex items-center gap-1 transition-opacity opacity-70 sm:opacity-0 sm:group-hover:opacity-100 ${
        isUser ? 'opacity-100' : ''
      }`}>
        {actions.map((action) => (
          <button
            key={action.label}
            onClick={action.onClick}
            title={action.label}
            className={`p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors`}
          >
            {action.icon}
          </button>
        ))}
      </div>
    );
  };

  return (
    <div
      className={`group flex gap-3 ${
        isUser ? 'justify-end' : 'justify-start'
      }`}
    >
      {!isUser && getAvatar()}

      <div className="max-w-[85%] sm:max-w-[75%] flex flex-col gap-1">
        <div
          className={`relative px-4 py-3 rounded-lg transition-all ${getBubbleClasses()}`}
        >
          {renderContent()}
          {renderActions()}
        </div>

        {/* Feedback buttons for assistant messages */}
        {!isUser && !isError && message.content && !isStreamingThis && (
          <div className="flex gap-1 mt-1 transition-opacity opacity-70 sm:opacity-0 sm:group-hover:opacity-100">
            <button
              onClick={() => onSendFeedback(true)}
              className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
              title="Helpful"
            >
              👍
            </button>
            <button
              onClick={() => onSendFeedback(false)}
              className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
              title="Not helpful"
            >
              👎
            </button>
          </div>
        )}
      </div>

      {isUser && getAvatar()}
    </div>
  );
}
