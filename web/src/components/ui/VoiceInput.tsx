'use client';

import { useRef, useCallback } from 'react';
import { Mic, Square, MicOff } from 'lucide-react';
import { useVoiceToText } from '@/hooks/useVoiceToText';

interface VoiceInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Plain-language helper text shown below the field. */
  helperText?: string;
  /** Optional field hint (kept for future LLM refinement if needed). */
  field?: string;
  /** Render a textarea instead of a single-line input. */
  textarea?: boolean;
  /** Number of rows for textarea mode. */
  rows?: number;
  /** Mark the field as required. */
  required?: boolean;
  /** Extra className for the outer wrapper. */
  className?: string;
  /** Force the input element's maxLength. */
  maxLength?: number;
  /** Error message to display. */
  error?: string;
}

/**
 * Reusable input / textarea with a green voice-to-text mic button.
 *
 * Clicking the mic starts browser STT. When the final transcript arrives,
 * the raw text is placed directly into the input via `onChange` — no LLM
 * processing, so the user can hear exactly what was captured and then edit/
 * save it themselves.
 *
 * Mic button states:
 *   - Idle         → green mic, ready to record
 *   - Recording     → red stop icon, pulsing
 *   - Unsupported   → muted mic-off icon
 */
export default function VoiceInput({
  label,
  value,
  onChange,
  placeholder = '',
  helperText,
  field,
  textarea = false,
  rows = 3,
  required = false,
  className = '',
  maxLength,
  error,
}: VoiceInputProps) {
  const inputRef = useRef<any>(null);

  // Insert voice text at the current cursor position instead of replacing
  // the entire field value. Falls back to appending at the end when the
  // element or selection APIs are unavailable.
  const handleVoiceChange = useCallback(
    (text: string) => {
      const el = inputRef.current;
      if (el && typeof el.selectionStart === 'number') {
        const start = el.selectionStart;
        const end = el.selectionEnd ?? start;
        const newValue =
          value.slice(0, start) + text + value.slice(end);
        onChange(newValue);
        // Move cursor to just after the inserted text
        const cursorPos = start + text.length;
        requestAnimationFrame(() => {
          el.setSelectionRange(cursorPos, cursorPos);
        });
      } else {
        // Fallback: append with a space separator
        const separator = value && !value.endsWith(' ') ? ' ' : '';
        onChange(value + separator + text);
      }
    },
    [value, onChange],
  );

  const { isRecording, isSupported, error: voiceError, interimTranscript, start, stop } =
    useVoiceToText({ field, onChange: handleVoiceChange });

  const handleVoiceClick = () => {
    if (isRecording) {
      stop();
    } else if (isSupported) {
      start();
    }
  };

  const displayError = error || voiceError;
  const showRecordingHint = isRecording && interimTranscript;

  const sharedInputProps = {
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(e.target.value),
    placeholder: isRecording ? 'Listening...' : placeholder,
    maxLength,
  };

  return (
    <div className={`relative ${className}`}>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>

      <div className="relative flex items-end gap-2">
        {textarea ? (
          <textarea
            ref={inputRef}
            {...sharedInputProps}
            rows={rows}
            className={
              displayError
                ? 'w-full px-3 py-2 border border-red-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 resize-none'
                : 'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none'
            }
          />
        ) : (
          <input
            type="text"
            ref={inputRef}
            {...sharedInputProps}
            className={
              displayError
                ? 'w-full px-3 py-2 border border-red-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500'
                : 'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500'
            }
          />
        )}

        <button
          type="button"
          onClick={handleVoiceClick}
          disabled={!isSupported}
          className={`
            flex items-center justify-center w-10 h-10 rounded-lg transition-all flex-shrink-0
            ${
              !isSupported
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : isRecording
                  ? 'bg-red-500 text-white hover:bg-red-600 animate-pulse'
                  : 'bg-green-500 text-white hover:bg-green-600'
            }
          `}
          title={
            !isSupported
              ? 'Voice input not supported in this browser'
              : isRecording
                ? 'Stop recording'
                : 'Speak to fill this field'
          }
        >
          {!isSupported ? (
            <MicOff size={18} />
          ) : isRecording ? (
            <Square size={16} />
          ) : (
            <Mic size={18} />
          )}
        </button>
      </div>

      {isRecording && showRecordingHint && (
        <p className="text-xs text-gray-500 mt-1 italic">
          Listening: {showRecordingHint}
        </p>
      )}

      {helperText && !isRecording && (
        <p className="text-xs text-gray-500 mt-1">{helperText}</p>
      )}

      {displayError && (
        <p className="text-xs text-red-500 mt-1">{displayError}</p>
      )}
    </div>
  );
}
