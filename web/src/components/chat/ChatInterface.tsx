'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { chatApi, parseStream, type Source } from '@/lib/api';
import type { ChatMessage } from '@/types/chat';
import ChatInput from './ChatInput';
import MessageList from './MessageList';
import { useVoiceState } from '@/hooks/useVoiceState';
import toast from 'react-hot-toast';

interface Props {
  botSlug: string;
}

const STORAGE_KEY_PREFIX = 'flowchat_chat_';

export default function ChatInterface({ botSlug }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [conversationId, setConversationId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [voiceMode, setVoiceMode] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);

  // ─── Load persisted conversation from localStorage on mount ──────────────
  const storageKey = `${STORAGE_KEY_PREFIX}${botSlug}`;
  const storageConvIdKey = `${storageKey}_conv_id`;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setMessages(parsed);
        }
        const savedConvId = localStorage.getItem(storageConvIdKey);
        if (savedConvId) setConversationId(savedConvId);
      }
    } catch {
      // ignore corrupt localStorage
    }
  }, [botSlug, storageKey, storageConvIdKey]);

  // ─── Persist messages to localStorage ────────────────────────────────────
  useEffect(() => {
    if (messages.length > 0) {
      localStorage.setItem(storageKey, JSON.stringify(messages));
    }
  }, [messages, storageKey]);

  useEffect(() => {
    if (conversationId) {
      localStorage.setItem(storageConvIdKey, conversationId);
    }
  }, [conversationId, storageConvIdKey]);

  // ─── Voice state management ──────────────────────────────────────────────
  const voice = useVoiceState({ enableTTS: voiceMode });

  // ─── Handle send with streaming ──────────────────────────────────────────
  const handleSend = useCallback(
    async (message?: string) => {
      const textToSend = message ? message.trim() : input.trim();
      if (!textToSend || isStreaming) return;

      const userMessage: ChatMessage = {
        id: `user_${Date.now()}`,
        role: 'user',
        content: textToSend,
        status: 'sending',
        createdAt: Date.now(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setInput('');
      voice.startStreaming();
      setIsTyping(true);
    setError(null);

    // Assistant placeholder that we'll stream into
    const assistantId = `assistant_${Date.now()}`;
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      status: 'streaming',
      createdAt: Date.now(),
    };

    setMessages((prev) => [...prev, assistantMessage]);
    setIsStreaming(true);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    let fullContent = '';
    const streamedSources: Source[] = [];

    try {
      const response = await chatApi.chatStream(
        botSlug,
        userMessage.content,
        conversationId,
        abortController.signal,
      );

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API error: ${response.status} ${response.statusText} — ${errText}`);
      }

      let gotFirstChunk = false;
      for await (const event of parseStream(response)) {
        if (event.content) {
          fullContent += event.content;
          if (!gotFirstChunk) {
            gotFirstChunk = true;
            setIsTyping(false);
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: fullContent } : m,
            ),
          );
        }
        // Reasoning chunks are parsed by parseSSESLines and forwarded
        // from the backend. They are captured but not displayed in the
        // main chat UI. Could be shown in an expandable "reasoning" section.
        // if (event.reasoning) { ... optionally display reasoning ... }
        if (event.conversation_id && !conversationId) {
          setConversationId(event.conversation_id);
        }
        if (event.sources) {
          streamedSources.push(...event.sources);
        }
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: fullContent,
                status: 'sent',
                sources: streamedSources.length > 0 ? streamedSources : undefined,
              }
            : m,
        ),
      );

      // Update user message status to sent
      setMessages((prev) =>
        prev.map((m) => (m.id === userMessage.id ? { ...m, status: 'sent' } : m)),
      );

      // Start TTS if the assistant produced a response
      if (fullContent && voiceMode && voice.isTTSSupported) {
        voice.speakTTS(fullContent);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // User stopped generation
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, status: 'sent' as const, content: fullContent }
              : m,
          ),
        );
        toast('Response stopped', { icon: '⏹️' });
      } else {
        const msg = err.message || 'Failed to send message';
        setError(msg);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, status: 'error' as const, error: msg, content: '' }
              : m,
          ),
        );
        setMessages((prev) =>
          prev.map((m) => (m.id === userMessage.id ? { ...m, status: 'sent' as const } : m)),
        );
        toast.error(msg);
      }
    } finally {
      setIsStreaming(false);
      setIsTyping(false);
      abortControllerRef.current = null;
    }
  }, [input, isStreaming, botSlug, conversationId, voice, voiceMode]);

  // ─── Handle stop ──────────────────────────────────────────────────────────
  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  // ─── Handle retry ─────────────────────────────────────────────────────────
  const handleRetry = useCallback((messageId: string) => {
    const msg = messages.find((m) => m.id === messageId);
    if (!msg || msg.role !== 'assistant') return;

    const msgIndex = messages.findIndex((m) => m.id === messageId);
    if (msgIndex <= 0) return;
    const userMsg = messages[msgIndex - 1];

    setMessages(messages.slice(0, msgIndex - 1));
    setInput(userMsg?.content || '');
    setTimeout(() => {
      void handleSend();
    }, 100);
  }, [messages, handleSend]);

  // ─── Handle regenerate ────────────────────────────────────────────────────
  const handleRegenerate = useCallback((messageId: string) => {
    const msg = messages.find((m) => m.id === messageId);
    if (!msg || msg.role !== 'assistant') return;

    const msgIndex = messages.findIndex((m) => m.id === messageId);
    if (msgIndex <= 0) return;
    const userMsg = messages[msgIndex - 1];

    setMessages(messages.slice(0, msgIndex));
    setInput(userMsg.content);
    setTimeout(() => {
      void handleSend();
    }, 100);
  }, [messages, handleSend]);

  // ─── Handle copy ──────────────────────────────────────────────────────────
  const handleCopy = useCallback(async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Failed to copy');
    }
  }, []);

  // ─── Handle feedback ──────────────────────────────────────────────────────
  const handleSendFeedback = useCallback((messageId: string, helpful: boolean) => {
    toast(`${helpful ? '👍 Thanks for the feedback!' : 'Sorry to hear that. We will improve.'}`, { duration: 2000 });
  }, []);

  // ─── Handle source click ─────────────────────────────────────────────────
  const handleSourceClick = useCallback((source: Source) => {
    if (source.url) {
      window.open(source.url, '_blank', 'noopener,noreferrer');
    } else {
      toast(`Source: ${source.name || 'Unknown'}\nScore: ${source.score.toFixed(2)}`, { duration: 4000 });
    }
  }, []);

  // Auto-send when voice transcript is ready (state === 'submitting')
  useEffect(() => {
    if (voice.voiceState === 'submitting' && voice.transcript) {
      voice.startStreaming();
      void handleSend(voice.transcript.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.voiceState, voice.transcript]);

  const handleSendClick = () => {
    void handleSend();
  };

  return (
<div className="flex flex-col h-[calc(100dvh-4rem)]">
      <MessageList
        messages={messages}
        isLoading={false}
        isStreaming={isStreaming}
        isTyping={isTyping}
        onRetry={handleRetry}
        onRegenerate={handleRegenerate}
        onCopy={handleCopy}
        onSendFeedback={handleSendFeedback}
        onSourceClick={handleSourceClick}
      />

      {error && !isStreaming && messages.length === 0 && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 mx-4 mt-2 rounded-lg text-sm">
          <p className="font-medium">Connection error</p>
          <p>{error}</p>
        </div>
      )}

      <ChatInput
        value={input}
        onChange={setInput}
        onSend={handleSendClick}
        onStop={handleStop}
        onVoiceStart={voice.startRecording}
        onVoiceEnd={voice.stopRecording}
        onStopVoice={voice.stopTTS}
        voiceMode={voiceMode}
        onVoiceModeToggle={() => setVoiceMode((v) => !v)}
        disabled={false}
        isStreaming={isStreaming}
        isVoiceRecording={voice.isRecording}
        voiceState={voice.voiceState}
        voiceTranscript={voice.interimTranscript}
      />
    </div>
  );
}
