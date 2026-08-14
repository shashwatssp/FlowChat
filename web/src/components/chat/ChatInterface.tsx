'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  chatApi,
  parseStream,
  type Source,
  calendarApi,
  type BookAppointmentPayload,
} from '@/lib/api';
import type { ChatMessage } from '@/types/chat';
import { Calendar, Clock, X } from 'lucide-react';
import ChatInput from './ChatInput';
import MessageList from './MessageList';
import { useVoiceState } from '@/hooks/useVoiceState';
import toast from 'react-hot-toast';

interface Props {
  botSlug: string;
  botID: string;
}

const STORAGE_KEY_PREFIX = 'flowchat_chat_';

// Mirrors the backend's bookingIntentRegex (handlers/chat.go). The booking form
// is shown ONLY when the *user* is asking to schedule an appointment — never
// when the assistant merely mentions words like "slot"/"available" in an
// ordinary reply (which previously made the form pop up for every question).
const bookingIntentRegex =
  /\b(appointment|meeting|reservation|schedule|booking)\b|\bbook\s+(?:an?)\s+(?:appointment|meeting|slot|time|visit|date)\b/i;

const isBookingIntent = (text: string): boolean => bookingIntentRegex.test(text);

// Maps the conflicts array returned by POST /appointments (HTTP 409) to a
// coarse reason so the UI can surface a precise message to the user.
function getBookingConflictReason(conflicts: unknown): 'rule' | 'taken' | null {
  if (!Array.isArray(conflicts)) return null;
  for (const c of conflicts) {
    if (typeof c === 'string') {
      if (c.startsWith('rule')) return 'rule';
      if (c.startsWith('appointment') || c.startsWith('hold')) return 'taken';
    } else if (c && typeof c === 'object') {
      const t = (c as { type?: string }).type;
      if (t === 'rule') return 'rule';
      if (t === 'appointment' || t === 'hold') return 'taken';
    }
  }
  return null;
}

export default function ChatInterface({ botSlug, botID }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [conversationId, setConversationId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [voiceMode, setVoiceMode] = useState(false);

  const [showBookingForm, setShowBookingForm] = useState(false);
  const [bookingName, setBookingName] = useState('');
  const [bookingPhone, setBookingPhone] = useState('');
  const [availableSlots, setAvailableSlots] = useState<Array<{ start_time: string; end_time: string }>>([]);  
  const [selectedSlot, setSelectedSlot] = useState<{ start_time: string; end_time: string } | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [bookingLoading, setBookingLoading] = useState(false);

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
      // Show the booking form only when the user is genuinely requesting to
      // schedule (mirrors the backend booking-intent regex). A non-booking
      // follow-up message hides the form again.
      const isBooking = !!botID && isBookingIntent(textToSend);
      setShowBookingForm(isBooking);
      if (!isBooking) {
        setAvailableSlots([]);
        setSelectedSlot(null);
      }
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

  // When speech recognition produces a final transcript, type it into the
  // input field (like typed text) instead of auto-sending. The user must press
  // send (or Enter) to submit — voice input only fills the field.
  useEffect(() => {
    if (voice.voiceState === 'submitting' && voice.transcript && !isStreaming) {
      setInput(voice.transcript);
      voice.cancel();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.voiceState, voice.transcript, isStreaming]);

  // ─── Fetch available slots when the booking form appears ───────────────────
  useEffect(() => {
    if (!showBookingForm || !botID) return;
    let cancelled = false;
    const fetchSlots = async () => {
      setSlotsLoading(true);
      setSlotsError(null);
      setSelectedSlot(null);
      try {
        const today = new Date().toISOString().split('T')[0];
        const nextWeek = new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000,
        ).toISOString().split('T')[0];
        const res = await calendarApi.getAvailableSlots(
          botID, today, nextWeek,
        );
        if (!cancelled) {
          setAvailableSlots(res.data.slots || []);
        }
      } catch (err: any) {
        if (!cancelled) {
          setSlotsError(
            err.response?.data?.error || 'Failed to load available slots',
          );
          setAvailableSlots([]);
        }
      } finally {
        if (!cancelled) setSlotsLoading(false);
      }
    };
    fetchSlots();
    return () => { cancelled = true; };
  }, [showBookingForm, botID]);

  const handleBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlot || !bookingName.trim() || !bookingPhone.trim() || !botID) return;
    setBookingLoading(true);
    try {
      const payload: BookAppointmentPayload = {
        customer_name: bookingName.trim(),
        customer_phone: bookingPhone.trim(),
        start_time: selectedSlot.start_time,
        end_time: selectedSlot.end_time,
      };
      await calendarApi.bookAppointment(botID, payload);
      const slotStart = new Date(selectedSlot!.start_time);
      const slotEnd = new Date(selectedSlot!.end_time);
      const timeStr = `${slotStart.toLocaleString([], { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} - ${slotEnd.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      const successMsg = `Your appointment has been booked for ${timeStr}. Looking forward to seeing you.`;
      toast.success(successMsg);
      setMessages((prev) => [
        ...prev,
        {
          id: `booked_${Date.now()}`,
          role: 'assistant',
          content: successMsg,
          status: 'sent',
          createdAt: Date.now(),
        },
      ]);
      setShowBookingForm(false);
      setBookingName('');
      setBookingPhone('');
      setSelectedSlot(null);
      setAvailableSlots([]);
    } catch (error: any) {
      const status = error.response?.status;
      if (status === 409) {
        const conflicts = error.response?.data?.conflicts;
        const reason = getBookingConflictReason(conflicts);
        if (reason === 'rule') {
          toast.error('That time is outside your working hours. Please choose another available slot.');
        } else {
          toast.error('That time slot was just booked by someone else. Please choose another time.');
        }
      } else {
        toast.error(error.response?.data?.error || 'Failed to book appointment');
      }
    } finally {
      setBookingLoading(false);
    }
  };

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

      {showBookingForm && (
        <div className="border-t bg-gray-50 p-4">
          <div className="container mx-auto max-w-2xl">
            <div className="flex items-center gap-2 mb-3">
              <Calendar size={16} className="text-primary-600" />
              <h3 className="text-sm font-medium text-gray-700">Book an Appointment</h3>
              <button
                onClick={() => {
                  setShowBookingForm(false);
                  setSelectedSlot(null);
                  setAvailableSlots([]);
                }}
                className="ml-auto text-xs text-gray-400 hover:text-gray-600"
                title="Dismiss"
              >
                <X size={14} />
              </button>
            </div>
            <form onSubmit={handleBookingSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                value={bookingName}
                onChange={(e) => setBookingName(e.target.value)}
                placeholder="Your name"
                required
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <input
                type="tel"
                value={bookingPhone}
                onChange={(e) => setBookingPhone(e.target.value)}
                placeholder="Phone number"
                required
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              {slotsLoading ? (
                <div className="col-span-2 py-6 text-center text-gray-500">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-400 mx-auto mb-2"></div>
                  <p>Loading available slots...</p>
                </div>
              ) : slotsError ? (
                <div className="col-span-2 py-4 text-center text-red-500">
                  {slotsError}
                </div>
              ) : availableSlots.length === 0 ? (
                <div className="col-span-2 py-4 text-center text-gray-500">
                  No slots available in the next 7 days.
                </div>
              ) : (
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-700 mb-2">
                    Choose an available time slot
                  </label>
                  <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                    {availableSlots.map((slot) => {
                      const start = new Date(slot.start_time);
                      const end = new Date(slot.end_time);
                      const isSelected = selectedSlot?.start_time === slot.start_time;
                      return (
                        <button
                          key={slot.start_time}
                          type="button"
                          onClick={() => setSelectedSlot(slot)}
                          className={`w-full text-left px-3 py-2.5 rounded-lg border text-sm transition-all ${isSelected ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:bg-blue-50'}`}
                        >
                          <div className="font-medium">
                            {start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            {' – '}
                            {end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                          <div className="text-xs opacity-75 mt-0.5">
                            {start.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={bookingLoading || !selectedSlot}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
                >
                  {bookingLoading ? 'Booking...' : !selectedSlot ? 'Select a slot' : 'Confirm Booking'}
                </button>
              </div>
            </form>
            <p className="text-xs text-gray-500 mt-2">
              We will use your name and phone to confirm the appointment.
            </p>
          </div>
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
