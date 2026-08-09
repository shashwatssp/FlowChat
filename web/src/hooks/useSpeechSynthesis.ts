import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Speech synthesis hook using the browser Web Speech API.
 *
 * Provides text-to-speech output with pause/stop controls.
 *
 * State lifecycle: idle → speaking → (utterance events fire) → idle
 */
export function useSpeechSynthesis() {
  const [isSupported, setIsSupported] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const pendingTextRef = useRef<string | null>(null);

  // Detect support once
  useEffect(() => {
    setIsSupported('speechSynthesis' in window);
  }, []);

  // Check if speech synthesis is still active (handles external cancellation)
  useEffect(() => {
    if (!isSpeaking) return;
    if (error) return;

    const check = () => {
      if (!window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
        if (isSpeaking) {
          setIsSpeaking(false);
          setIsPaused(false);
        }
      }
    };

    const interval = setInterval(check, 500);
    return () => clearInterval(interval);
  }, [isSpeaking, error]);

  const speak = useCallback(
    (text: string, options?: { rate?: number; pitch?: number; volume?: number }) => {
      setError(null);

      // Stop any ongoing speech first
      if (isSpeaking) {
        window.speechSynthesis.cancel();
      }

      if (!('speechSynthesis' in window)) {
        setError('Speech Synthesis is not supported in this browser.');
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = navigator.language || 'en-US';
      utterance.rate = options?.rate ?? 1;
      utterance.pitch = options?.pitch ?? 1;
      utterance.volume = options?.volume ?? 1;

      utterance.onstart = () => {
        setIsSpeaking(true);
        setIsPaused(false);
      };

      utterance.onend = () => {
        setIsSpeaking(false);
        setIsPaused(false);
        utteranceRef.current = null;

        // If there's pending text, speak it
        if (pendingTextRef.current) {
          const pending = pendingTextRef.current;
          pendingTextRef.current = null;
          speak(pending, options); // eslint-disable-line react-hooks/rules-of-hooks
        }
      };

      utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
        setError(event.error || 'Speech synthesis error');
        setIsSpeaking(false);
        setIsPaused(false);
        utteranceRef.current = null;
      };

      utteranceRef.current = utterance;
      pendingTextRef.current = null;

      window.speechSynthesis.speak(utterance);
    },
    [isSpeaking],
  );

  const stop = useCallback(() => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
    setIsPaused(false);
    utteranceRef.current = null;
  }, []);

  const pause = useCallback(() => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.pause();
      setIsPaused(true);
    }
  }, []);

  const resume = useCallback(() => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.resume();
      setIsPaused(false);
    }
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  return {
    isSupported,
    isSpeaking,
    isPaused,
    error,
    speak,
    stop,
    pause,
    resume,
  };
}
