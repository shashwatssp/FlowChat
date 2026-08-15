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

  // Detect support once
  useEffect(() => {
    const SpeechRecognitionAPI =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    setIsSupported(!!SpeechRecognitionAPI);
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
      setError('Speech Recognition is not supported in this browser.');
      return;
    }

    const recognition: SpeechRecognitionInstance = new SpeechRecognitionAPI();
    // continuous=true lets the user take brief pauses while speaking
    // without the speech recognition stopping on the first silence.
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;

        if (result.isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }

      setInterimTranscript(interim);

      if (final) {
        setFinalTranscript((prev) => prev + final);
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

    recognition.start();
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
