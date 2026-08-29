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
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      let newFinal = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;

        if (result.isFinal) {
          // Only commit final results whose index is STRICTLY greater
          // than the highest one we already appended. This is the
          // mobile-Chrome dedup fix: a final result at index N can be
          // re-fired by the browser; we ignore it the second time.
          if (i > lastFinalIndexRef.current) {
            const sep = newFinal && !newFinal.endsWith(' ') && !transcript.startsWith(' ') ? ' ' : '';
            newFinal += sep + transcript;
            lastFinalIndexRef.current = i;
          }
        } else {
          interim += transcript;
        }
      }

      setInterimTranscript(interim);

      if (newFinal) {
        setFinalTranscript((prev) => {
          const trimmedPrev = prev.trimEnd();
          if (!trimmedPrev) return newFinal.trim();
          const sep = newFinal.startsWith(' ') || trimmedPrev.endsWith(' ') ? '' : ' ';
          return trimmedPrev + sep + newFinal.trim();
        });
        setInterimTranscript('');
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
