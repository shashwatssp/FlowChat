import { useReducer, useCallback, useEffect } from 'react';
import {
  voiceStateReducer,
  INITIAL_VOICE_STATE,
  type VoiceAction,
  type VoiceStateTransition,
} from './voiceStateReducer';
import { useVoiceRecognition } from './useVoiceRecognition';
import { useSpeechSynthesis } from './useSpeechSynthesis';
import type { VoiceState } from '@/components/chat/VoiceStateIndicator';
export type { VoiceState };

/**
 * Options for the useVoiceState hook.
 */
export interface UseVoiceStateOptions {
  /** Whether TTS output is enabled. When false, the state goes loading → idle. */
  enableTTS?: boolean;
  /** The text to speak via TTS. When this changes and the hook is in 'speaking' mode, it will be spoken. */
  ttsText?: string;
}

/**
 * A single hook that manages the entire voice state lifecycle:
 *
 *   idle → recording → submitting → loading → speaking → idle
 *
 * It wraps the Web Speech API hooks (useVoiceRecognition for STT,
 * useSpeechSynthesis for TTS) and the pure voiceStateReducer state machine.
 *
 * @returns The current voice state, context, and control functions.
 */
export function useVoiceState(options?: UseVoiceStateOptions) {
  const { enableTTS = true, ttsText } = options || {};

  const [voiceState, dispatch] = useReducer(voiceStateReducer, INITIAL_VOICE_STATE);

  const stt = useVoiceRecognition();
  const tts = useSpeechSynthesis();

  const state: VoiceState = voiceState.state;
  const transcript = voiceState.context.transcript ?? stt.transcript;
  const error = voiceState.context.error ?? stt.error ?? tts.error;

  // ─── When STT finishes (recording stopped), capture what was said ───────────
  // Fires both for the natural recognition-end and for an explicit user
  // "done"/stop click. We combine final + interim results because some
  // browsers don't flush interim results as 'final' on stop().
  useEffect(() => {
    if (!stt.isRecording && state === 'recording') {
      const fullTranscript = (stt.finalTranscript + stt.interimTranscript).trim();
      if (fullTranscript) {
        dispatch({ type: 'TRANSCRIPT_READY', transcript: fullTranscript });
      } else {
        // Stopped without saying anything meaningful — go back to idle.
        dispatch({ type: 'CANCEL' });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stt.isRecording, stt.finalTranscript, stt.interimTranscript, state]);

  // ─── When TTS starts (from external trigger), transition to 'speaking' ────
  useEffect(() => {
    if (tts.isSpeaking && state === 'loading') {
      dispatch({ type: 'TTS_START' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tts.isSpeaking, state]);

  // ─── When TTS ends, transition back to idle ───────────────────────────────
  useEffect(() => {
    if (!tts.isSpeaking && state === 'speaking') {
      dispatch({ type: 'TTS_END' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tts.isSpeaking, state]);

  // ─── When loading ends without TTS, go to idle ───────────────────────────
  useEffect(() => {
    if (!stt.isRecording && !stt.isListening && !tts.isSpeaking &&
        (state === 'submitting' || state === 'loading')) {
      // If TTS is not enabled, the caller should dispatch SEND_END.
      // If enabled, the TTS hooks above handle the transition.
      if (!enableTTS) {
        dispatch({ type: 'CANCEL' });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stt.isRecording, stt.isListening, tts.isSpeaking, state, enableTTS]);

  // ─── Handle errors from STT or TTS ────────────────────────────────────────
  useEffect(() => {
    if (stt.error || tts.error) {
      dispatch({ type: 'ERROR', error: stt.error || tts.error || 'Unknown error' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stt.error, tts.error]);

  // ─── Speak text when ttsText changes and we're in 'speaking' state ──────
  useEffect(() => {
    if (ttsText && enableTTS && state === 'speaking') {
      tts.speak(ttsText);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsText, state, enableTTS]);

  // ─── Control functions ────────────────────────────────────────────────────

  const startRecording = useCallback(() => {
    if (state !== 'idle') return;
    dispatch({ type: 'START_RECORDING' });
    // Start every session with a clean transcript slate so speech captured in a
    // previous turn isn't concatenated onto the current one.
    stt.reset();
    stt.start();
  }, [state, stt]);

  const stopRecording = useCallback(() => {
    if (state === 'recording') {
      // Stop the browser STT but DO NOT immediately transition to 'idle'.
      // Doing so would clear the transcript before the final recognition
      // results could be read, which dropped the spoken text and left the
      // input box empty after the user clicked "done". Instead we let the
      // transcript-effect above capture the final transcript and transition
      // to 'submitting' (-> the input field), or cancel to 'idle' if nothing
      // was captured.
      stt.stop();
    }
  }, [state, stt]);

  const toggleRecording = useCallback(() => {
    if (state === 'recording') {
      stopRecording();
    } else if (state === 'idle') {
      startRecording();
    }
    // Ignore toggle in other states
  }, [state, startRecording, stopRecording]);

  const sendVoiceInput = useCallback(() => {
    const finalText = stt.finalTranscript.trim();
    if (finalText && (state === 'recording' || state === 'submitting')) {
      dispatch({ type: 'TRANSCRIPT_READY', transcript: finalText });
    }
    dispatch({ type: 'SEND_START' });
  }, [state, stt.finalTranscript]);

  const startStreaming = useCallback(() => {
    dispatch({ type: 'SEND_START' });
  }, []);

  const endStreaming = useCallback(() => {
    if (enableTTS) {
      dispatch({ type: 'SEND_END' });
    } else {
      dispatch({ type: 'CANCEL' });
    }
  }, [enableTTS]);

  const startTTS = useCallback(() => {
    if (enableTTS) {
      dispatch({ type: 'TTS_START' });
    }
  }, [enableTTS]);

  const speakTTS = useCallback(
    (text: string) => {
      if (enableTTS && tts.isSupported) {
        tts.speak(text);
      }
    },
    [enableTTS, tts.isSupported, tts],
  );

  const stopTTS = useCallback(() => {
    tts.stop();
    dispatch({ type: 'TTS_END' });
  }, [tts]);

  const cancel = useCallback(() => {
    stt.abort();
    tts.stop();
    dispatch({ type: 'CANCEL' });
  }, [stt, tts]);

  const reset = useCallback(() => {
    stt.abort();
    tts.stop();
    dispatch({ type: 'RESET' });
    stt.reset();
  }, [stt, tts]);

  return {
    // State
    voiceState: state,
    voiceStateTransition: voiceState as VoiceStateTransition,
    transcript,
    interimTranscript: stt.interimTranscript,
    finalTranscript: stt.finalTranscript,
    error,

    // Feature support
    isVoiceSupported: stt.isSupported,
    isTTSSupported: tts.isSupported,

    // Convenience flags
    isRecording: state === 'recording',
    isSubmitting: state === 'submitting',
    isLoading: state === 'loading',
    isSpeaking: state === 'speaking',
    isVoiceActive: state !== 'idle',

    // Control functions
    startRecording,
    stopRecording,
    toggleRecording,
    sendVoiceInput,
    startStreaming,
    endStreaming,
    startTTS,
    speakTTS,
    stopTTS,
    cancel,
    reset,
  };
}
