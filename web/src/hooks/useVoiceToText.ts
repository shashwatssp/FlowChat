import { useState, useEffect, useCallback, useRef } from 'react';
import { useVoiceRecognition } from './useVoiceRecognition';

interface UseVoiceToTextProps {
  /** Optional field hint (kept for future LLM refinement if needed). */
  field?: string;
  /** Callback invoked with the raw STT transcript — placed directly into the field. */
  onChange: (text: string) => void;
}

/**
 * Voice-to-text hook.
 *
 * Wraps the browser STT hook (`useVoiceRecognition`) and places the raw final
 * transcript directly into the form field via `onChange`. No LLM processing
 * is applied — whatever the user speaks is captured verbatim so they can edit
 * and save it themselves.
 *
 * Lifecycle:
 *   1. `start()` → browser STT begins recording
 *   2. Final transcript arrives → `onChange(finalTranscript)` populates the field
 *
 * @returns `{ isRecording, isSupported, error, interimTranscript, start, stop }`
 */
export function useVoiceToText({ onChange }: UseVoiceToTextProps) {
  const stt = useVoiceRecognition();
  const [error, setError] = useState<string | null>(null);

  // Guard against processing the same final transcript twice.
  const processedRef = useRef<string>('');

  // When a *new* final transcript arrives, place it directly in the field.
  useEffect(() => {
    const finalText = stt.finalTranscript.trim();
    if (finalText && finalText !== processedRef.current) {
      processedRef.current = finalText;
      onChange(finalText);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stt.finalTranscript]);

  const start = useCallback(() => {
    setError(null);
    processedRef.current = '';
    // Clear any transcript left over from a previous recording session.
    stt.reset();
    stt.start();
  }, [stt]);

  const stop = useCallback(() => {
    stt.stop();
  }, [stt]);

  return {
    isRecording: stt.isRecording,
    isSupported: stt.isSupported,
    error: error || stt.error,
    interimTranscript: stt.interimTranscript,
    start,
    stop,
  };
}
