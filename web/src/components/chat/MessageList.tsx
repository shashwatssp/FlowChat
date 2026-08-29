'use client';

import React, { useEffect, useRef, useState } from 'react';
import ChatMessage from './ChatMessage';
import type { ChatMessage as ChatMessageType, Source } from '@/types/chat';

interface Props {
  messages: ChatMessageType[];
  isLoading: boolean;
  isStreaming: boolean;
  isTyping: boolean;
  onRetry: (messageId: string) => void;
  onRegenerate: (messageId: string) => void;
  onCopy: (content: string) => void;
  onSendFeedback: (messageId: string, helpful: boolean) => void;
  onSourceClick: (source: Source) => void;
  /** Optional bot display name — used to personalize the empty state greeting. */
  emptyStateBotName?: string;
}

// Error boundary component
class ErrorBoundary extends React.Component<{ children: React.ReactNode; fallback: React.ReactNode }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode; fallback: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

const EmptyState = ({ botName }: { botName?: string }) => (
  <div className="flex flex-col items-center justify-center h-full text-center px-4">
    <div className="w-24 h-24 mb-4 opacity-30">
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full text-gray-400">
        <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6 22 12 22Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" strokeLinejoin="round"/>
        <path d="M9.09 9C9.32374 8.33667 9.78932 7.76128 10.4 7.29711C11.0107 6.83294 11.7289 6.50793 12.4722 6.37354C13.2154 6.23915 13.9513 6.30488 14.6018 6.55913C15.2524 6.81338 15.7931 7.24519 16.1614 7.79305C16.5296 8.34091 16.7129 8.98412 16.7 9.64817C16.687 10.3122 16.4762 10.9605 16.0924 11.5178C15.7086 12.0752 15.1669 12.5252 14.5144 12.8214C13.862 13.1176 13.1254 13.2527 12.4061 13.2126C11.6869 13.1725 11.0135 12.9577 10.475 12.5917C9.93647 12.2258 9.55309 11.7199 9.3697 11.1199C9.18631 10.52 9.09593 9.84457 9.09999 9.17017V9Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" strokeLinejoin="round" transform="translate(0 1) scale(0.95)"/>
        <circle cx="16.5" cy="9.5" r="1.5" fill="currentColor"/>
      </svg>
    </div>
    <h3 className="text-lg font-medium text-gray-900 mb-2">Start a conversation</h3>
    <p className="text-sm text-gray-500 max-w-sm">
      {botName ? (
        <>
          Ask me anything about <span className="font-medium text-gray-900">{botName}</span>. I&rsquo;ll answer from what the owner has shared.
        </>
      ) : (
        'How can I help you today?'
      )}
    </p>
  </div>
);

export default function MessageList({
  messages,
  isLoading,
  isStreaming,
  isTyping,
  onRetry,
  onRegenerate,
  onCopy,
  onSendFeedback,
  onSourceClick,
  emptyStateBotName,
}: Props) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollLock, setScrollLock] = useState(false);

  // Detect if user has manually scrolled up (scroll-lock)
  const handleScroll = () => {
    const container = containerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const isAtBottom = scrollHeight - scrollTop <= clientHeight + 50;
    if (!isAtBottom && !scrollLock) {
      setScrollLock(true);
    } else if (isAtBottom && scrollLock) {
      setScrollLock(false);
    }
  };

  // Auto-scroll only when not locked or when streaming (new content arriving)
  useEffect(() => {
    if (scrollLock && !isTyping) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping, scrollLock]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setScrollLock(false);
  };

  return (
    <ErrorBoundary fallback={<div className="p-4 text-center text-gray-500">Something went wrong loading messages</div>}>
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
        onScroll={handleScroll}
      >
        {messages.length === 0 && !isLoading && !isStreaming ? (
          <div className="h-full">
            <EmptyState botName={emptyStateBotName} />
          </div>
        ) : (
          <div className="space-y-4 p-4">
            {messages.map((message) => (
              <ChatMessage
                key={message.id}
                message={message}
                isStreaming={isStreaming}
                onRetry={() => onRetry(message.id)}
                onRegenerate={() => onRegenerate(message.id)}
                onCopy={() => onCopy(message.content)}
                onSendFeedback={(helpful) => onSendFeedback(message.id, helpful)}
                onSourceClick={onSourceClick}
              />
            ))}

            <div
              ref={messagesEndRef}
              className="h-px w-full"
            />
          </div>
        )}

        {/* Scroll-to-bottom button when locked */}
        {scrollLock && (
          <button
            onClick={scrollToBottom}
            className="fixed bottom-32 sm:bottom-24 right-4 sm:right-6 z-10 w-10 h-10 bg-primary-600 text-white rounded-full shadow-lg hover:bg-primary-700 transition-colors flex items-center justify-center"
            title="Scroll to bottom"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </button>
        )}
      </div>
    </ErrorBoundary>
  );
}
