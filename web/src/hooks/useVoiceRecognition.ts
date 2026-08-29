import { useState, useRef, useCallback, useEffect } from 'react';

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  [index: number]: SpeechRecognitionResult;
  length: number;
}

interface SpeechRecognitionResult {
  [index: number]: SpeechRecognitionAlternative;
  length: number;
  isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent {
  error: string;
  message?: string;
}

/**
 * mergeFinal folds a new final transcript into the previous one without
 * duplicating content. Mobile Chrome re-emits the same recogniser output
 * under different result indexes, so an index-based cursor keeps letting
 * duplicates through ("how are you how are you how are you"). The
 * string-level rules below stop that:
 *
 *   - prev ends with curr     → identical re-emit, drop.
 *   - curr starts with prev   → browser extended the recognised text,
 *                               REPLACE prev with curr.
 *   - curr ends with prev     → curr is a redundant prefix, drop.
 *   - suffix/prefix overlap   → merge tail ("tell me" + "me about" →
 *                               "tell me about").
 *   - otherwise               → space-separate.
 */
function mergeFinal(prev: string, curr: string): string {
  const p = prev.trimEnd();
  if (!p) return curr;
  if (p === curr) return prev;
  if (p.endsWith(curr)) return prev;
  if (curr.startsWith(p)) return curr;
  if (curr.endsWith(p)) return prev;
  const overlap = longestSuffixPrefixOverlap(p, curr);
  if (overlap > 0) return p + curr.slice(overlap);
  return p + ' ' + curr;
}

function longestSuffixPrefixOverlap(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  for (let k = max; k > 0; k--) {
    if (a.slice(a.length - k) === b.slice(0, k)) return k;
  }
  return 0;
}

/**
 * Voice recognition hook using the browser Web Speech API.
 *
 * Provides speech-to-text transcription with real-time interim results
 * and a final transcript when speech ends.
 *
 * State lifecycle: idle → recording → (interim results fire) → final result → idle
 */
export function useVoiceRecognition() {
  const [isSupported, setIsSupported] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  // Mobile Chrome re-delivers the same `isFinal: true` result across
  // multiple onresult events, which causes the same words to be appended
  // again ("how are you you you"). Track the highest final index we have
  // already committed and ignore anything at-or-before it.
  const lastFinalIndexRef = useRef<number>(-1);

  // Detect support AND a secure context. Web Speech only works on
  // https://, localhost, or 127.0.0.1; on http://<lan-ip> from a phone
  // Chrome silently refuses to start the recognizer.
  useEffect(() => {
    const SpeechRecognitionAPI =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    const onSecureHost =
      typeof window !== 'undefined' &&
      (window.isSecureContext === true ||
        location.hostname === 'localhost' ||
        location.hostname === '127.0.0.1' ||
        location.protocol === 'https:');
    setIsSupported(!!SpeechRecognitionAPI && onSecureHost);
  }, []);

  /** Reset state back to idle */
  const reset = useCallback(() => {
    setInterimTranscript('');
    setFinalTranscript('');
    setError(null);
    setIsRecording(false);
    setIsListening(false);
  }, []);

  const start = useCallback(() => {
    setError(null);

    const SpeechRecognitionAPI =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      setError('Speech Recognition is not supported in this browser. Try recent Chrome or Edge, or type your message instead.');
      return;
    }

    // Pre-flight: Web Speech ONLY works in a secure context. An
    // http://<lan-ip> page from a phone (e.g. http://192.168.x.y:3000)
    // looks secure to the page itself, but Chrome refuses to start the
    // recognizer with a vague 'service-not-allowed'. Surface that
    // explicitly instead of letting the click silently break.
    if (typeof window !== 'undefined' &&
        !window.isSecureContext &&
        location.hostname !== 'localhost' &&
        location.hostname !== '127.0.0.1' &&
        location.protocol !== 'https:') {
      setError(
        'Voice input needs HTTPS or localhost. ' +
        'On a phone, open https://' + location.hostname +
        (location.port ? ':' + location.port : '') +
        ' (accept the self-signed warning), or use http://localhost:3000 from a desktop.',
      );
      return;
    }

    // Reset the dedup cursor so a new utterance session starts fresh.
    lastFinalIndexRef.current = -1;

    let recognition: SpeechRecognitionInstance;
    try {
      recognition = new SpeechRecognitionAPI();
    } catch (e: any) {
      setError(
        'Microphone could not start: ' +
        (e?.message ?? e?.name ?? 'unsupported context') +
        '. Voice requires HTTPS or localhost — try typing your message.',
      );
      setIsRecording(false);
      setIsListening(false);
      return;
    }
    // A chat composer captures one utterance per tap. Mobile Chrome can
    // re-emit cumulative finals in continuous mode, so single-result mode
    // avoids duplicate final phrases at the source.
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const result = event.results[event.results.length - 1];
      if (!result) return;
      const transcript = result[0].transcript.trim();
      if (!transcript) return;
      if (result.isFinal) {
        setFinalTranscript((prev) => mergeFinal(prev, transcript));
        setInterimTranscript('');
      } else {
        setInterimTranscript(transcript);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'no-speech') {
        // Not really an error — just means they stopped speaking
        // The onend handler will fire and reset state
      } else {
        setError(event.error || 'Microphone error');
      }
      setIsRecording(false);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
      setIsListening(false);
    };

    try {
      recognition.start();
    } catch (e: any) {
      setError(
        'Microphone could not start: ' +
        (e?.message ?? e?.name ?? 'permission denied') +
        '. Voice requires HTTPS or localhost — try typing your message.',
      );
      setIsRecording(false);
      setIsListening(false);
      recognitionRef.current = null;
      return;
    }
    setIsRecording(true);
    setIsListening(true);
    recognitionRef.current = recognition;
  }, []);

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
  }, []);

  const abort = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }
    reset();
  }, [reset]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  // Combined transcript for display
  const transcript = finalTranscript + interimTranscript;

  return {
    isSupported,
    isRecording,
    isListening,
    interimTranscript,
    finalTranscript,
    transcript,
    error,
    start,
    stop,
    abort,
    reset,
  };
}
