'use client';

import { useRef, useEffect } from 'react';
import { Send, Mic, Square, Volume2 } from 'lucide-react';
import VoiceStateIndicator, { type VoiceState } from './VoiceStateIndicator';

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  /** Whether voice mode (TTS) is currently enabled for auto-speaking responses. */
  voiceMode?: boolean;
  /** Toggle voice mode on/off. */
  onVoiceModeToggle?: () => void;
  onVoiceInput?: (text: string) => void;
  disabled?: boolean;
  isStreaming?: boolean;
  isVoiceRecording?: boolean;
  onVoiceStart?: () => void;
  onVoiceEnd?: () => void;
  placeholder?: string;
  /**
   * Full voice state for the VoiceStateIndicator component.
   * Falls back to deriving from isVoiceRecording if not provided.
   */
  voiceState?: VoiceState;
  /** Interim transcript shown during recording. */
  voiceTranscript?: string;
  /** Whether the stop button should appear (for TTS / speaking stop). */
  onStopVoice?: () => void;
}

export default function ChatInput({
  value,
  onChange,
  onSend,
  onStop,
  voiceMode = false,
  onVoiceModeToggle,
  onVoiceInput,
  disabled,
  isStreaming,
  isVoiceRecording,
  onVoiceStart,
  onVoiceEnd,
  placeholder = 'Type your message...',
  voiceState,
  voiceTranscript = '',
  onStopVoice,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = 'auto';
      const scrollHeight = ta.scrollHeight;
      // Flush with the send / voice buttons (h-12 = 48px) so the input box
      // never sits higher than them.
      ta.style.height = Math.min(Math.max(scrollHeight, 48), 120) + 'px';
    }
  }, [value]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isStreaming) return;
      onSend();
    }
  };

  const isDisabled = disabled || !!isStreaming;

  // ─── Voice state management ────────────────────────────────────────────
  // Derive voice state: prefer the explicit voiceState prop,
  // otherwise fall back to isVoiceRecording boolean
  const derivedVoiceState: VoiceState =
    voiceState ?? (isVoiceRecording ? 'recording' : 'idle');

  const isRecording = derivedVoiceState === 'recording';
  const isSubmitting = derivedVoiceState === 'submitting';
  const isLoadingVoice = derivedVoiceState === 'loading';
  const isSpeaking = derivedVoiceState === 'speaking';
  const isVoiceActive = derivedVoiceState !== 'idle';

  // Use provided transcript
  const transcript = voiceTranscript;

  // Determine what to show in the action buttons area
  const showStopButton = isStreaming || isLoadingVoice || isSpeaking;
  const showVoiceButton =
    !!onVoiceStart &&
    derivedVoiceState !== 'loading' &&
    derivedVoiceState !== 'speaking';

  const handleVoiceClick = () => {
    if (derivedVoiceState === 'recording') {
      onVoiceEnd?.();
    } else if (derivedVoiceState === 'speaking' && onStopVoice) {
      onStopVoice?.();
    } else if (derivedVoiceState === 'idle' && onVoiceStart) {
      onVoiceStart?.();
    }
  };

  return (
    <div className="border-t bg-white p-4">
      <div className="container mx-auto">
        <div className="flex gap-3 items-end">

          <div className="flex-1 min-w-0 relative">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={isRecording ? 'Listening...' : placeholder}
              className="w-full px-4 py-2.5 min-h-12 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none transition-all"
              rows={1}
              maxLength={2000}
              disabled={isDisabled}
            />
            {isRecording && (
              <div className="absolute right-3 bottom-3">
                <span className="inline-block w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
              </div>
            )}

            {isVoiceActive && (
              <VoiceStateIndicator
                state={derivedVoiceState}
                transcript={transcript}
                showTranscript={true}
                size="sm"
                className="mt-2"
              />
            )}
          </div>

          {showStopButton ? (
            <button
              onClick={onStop}
              className="flex items-center justify-center w-12 h-12 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors flex-shrink-0"
              title="Stop generating"
            >
              <Square size={20} />
            </button>
          ) : (
            <>
              {showVoiceButton && (
                <button
                  onClick={handleVoiceClick}
                  disabled={isDisabled}
                  className={`flex items-center justify-center w-12 h-12 rounded-lg transition-colors flex-shrink-0 ${
                    isRecording
                      ? 'bg-red-500 text-white hover:bg-red-600 animate-pulse'
                      : isSpeaking
                        ? 'bg-blue-500 text-white hover:bg-blue-600 animate-pulse'
                        : 'text-gray-500 border border-gray-300 hover:bg-gray-50'
                  }`}
                  title={
                    isRecording
                      ? 'Stop recording'
                      : isSpeaking
                        ? 'Stop speaking'
                        : 'Voice input'
                  }
                >
                  {isRecording ? <Square size={20} /> : <Mic size={20} />}
                </button>
              )}
              {derivedVoiceState === 'idle' && (
                <>
                  {onVoiceModeToggle && (
                    <button
                      onClick={onVoiceModeToggle}
                      className={`hidden sm:flex items-center justify-center w-12 h-12 rounded-lg transition-colors flex-shrink-0 ${voiceMode ? 'bg-blue-500 text-white hover:bg-blue-600' : 'text-gray-500 border border-gray-300 hover:bg-gray-50'}`}
                      title={voiceMode ? 'Disable voice mode' : 'Enable voice mode (auto-TTS)'}
                    >
                      <Volume2 size={20} />
                    </button>
                  )}
                  <button
                    onClick={onSend}
                    disabled={!value.trim() || isDisabled}
                    className="flex items-center justify-center w-12 h-12 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                    title="Send message"
                  >
                    <Send size={20} />
                  </button>
                </>
              )}
            </>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-2 text-center">
          Powered by FlowChat
        </p>
      </div>
    </div>
  );
}
