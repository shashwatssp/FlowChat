import {
  voiceStateReducer,
  INITIAL_VOICE_STATE,
  isValidTransition,
  getVoiceStateLabel,
  canUserStopRecording,
  isVoiceActive,
  type VoiceAction,
  type VoiceStateTransition,
} from '../voiceStateReducer';
import type { VoiceState } from '@/components/chat/VoiceStateIndicator';

describe('voiceStateReducer', () => {
  describe('initial state', () => {
    it('should start in idle state', () => {
      expect(INITIAL_VOICE_STATE.state).toBe('idle');
      expect(INITIAL_VOICE_STATE.context).toEqual({});
    });

    it('should return initial state for unknown action', () => {
      const result = voiceStateReducer(INITIAL_VOICE_STATE, {
        type: 'START_RECORDING',
      });
      // START_RECORDING is valid from idle, so it should transition
      expect(result.state).toBe('recording');
    });
  });

  // ─── Idle → Recording ────────────────────────────────────────────────
  describe('idle → recording (START_RECORDING)', () => {
    it('should transition from idle to recording', () => {
      const result = voiceStateReducer(INITIAL_VOICE_STATE, {
        type: 'START_RECORDING',
      });
      expect(result.state).toBe('recording');
    });

    it('should not transition when not in idle', () => {
      const recording: VoiceStateTransition = {
        state: 'recording',
        context: {},
      };
      const result = voiceStateReducer(recording, {
        type: 'START_RECORDING',
      });
      expect(result.state).toBe('recording');
    });
  });

  // ─── Recording → Idle (STOP_RECORDING) ───────────────────────────────
  describe('recording → idle (STOP_RECORDING)', () => {
    it('should transition from recording to idle', () => {
      const recording: VoiceStateTransition = {
        state: 'recording',
        context: {},
      };
      const result = voiceStateReducer(recording, {
        type: 'STOP_RECORDING',
      });
      expect(result.state).toBe('idle');
    });

    it('should not transition when not in recording', () => {
      const idle: VoiceStateTransition = {
        state: 'idle',
        context: {},
      };
      const result = voiceStateReducer(idle, {
        type: 'STOP_RECORDING',
      });
      expect(result.state).toBe('idle');
    });
  });

  // ─── Recording → Submitting (TRANSCRIPT_READY) ────────────────────────
  describe('recording → submitting (TRANSCRIPT_READY)', () => {
    it('should transition from recording to submitting with transcript', () => {
      const recording: VoiceStateTransition = {
        state: 'recording',
        context: {},
      };
      const result = voiceStateReducer(recording, {
        type: 'TRANSCRIPT_READY',
        transcript: 'Hello, how are you?',
      });
      expect(result.state).toBe('submitting');
      expect(result.context.transcript).toBe('Hello, how are you?');
      expect(result.context.error).toBeUndefined();
    });

    it('should not transition when not in recording', () => {
      const idle: VoiceStateTransition = {
        state: 'idle',
        context: {},
      };
      const result = voiceStateReducer(idle, {
        type: 'TRANSCRIPT_READY',
        transcript: 'test',
      });
      expect(result.state).toBe('idle');
    });
  });

  // ─── Submitting → Loading (SEND_START) ────────────────────────────────
  describe('submitting → loading (SEND_START)', () => {
    it('should transition from submitting to loading', () => {
      const submitting: VoiceStateTransition = {
        state: 'submitting',
        context: { transcript: 'Hello' },
      };
      const result = voiceStateReducer(submitting, {
        type: 'SEND_START',
      });
      expect(result.state).toBe('loading');
      // Context should preserve transcript
      expect(result.context.transcript).toBe('Hello');
      // Error should be cleared
      expect(result.context.error).toBeUndefined();
    });

    it('should transition from loading to loading (keep-alive)', () => {
      const loading: VoiceStateTransition = {
        state: 'loading',
        context: {},
      };
      const result = voiceStateReducer(loading, {
        type: 'SEND_START',
      });
      expect(result.state).toBe('loading');
    });

    it('should preserve existing context on keep-alive', () => {
      const loading: VoiceStateTransition = {
        state: 'loading',
        context: { transcript: 'existing', error: 'old error' },
      };
      const result = voiceStateReducer(loading, {
        type: 'SEND_START',
      });
      expect(result.state).toBe('loading');
      expect(result.context.transcript).toBe('existing');
      expect(result.context.error).toBeUndefined();
    });

    it('should not transition from recording to loading', () => {
      const recording: VoiceStateTransition = {
        state: 'recording',
        context: {},
      };
      const result = voiceStateReducer(recording, {
        type: 'SEND_START',
      });
      expect(result.state).toBe('recording');
    });
  });

  // ─── Loading → Speaking (TTS_START) ──────────────────────────────────
  describe('loading → speaking (TTS_START)', () => {
    it('should transition from loading to speaking', () => {
      const loading: VoiceStateTransition = {
        state: 'loading',
        context: {},
      };
      const result = voiceStateReducer(loading, {
        type: 'TTS_START',
      });
      expect(result.state).toBe('speaking');
    });

    it('should not transition from idle to speaking', () => {
      const result = voiceStateReducer(INITIAL_VOICE_STATE, {
        type: 'TTS_START',
      });
      expect(result.state).toBe('idle');
    });
  });

  // ─── Speaking → Idle (TTS_END) ───────────────────────────────────────
  describe('speaking → idle (TTS_END)', () => {
    it('should transition from speaking to idle', () => {
      const speaking: VoiceStateTransition = {
        state: 'speaking',
        context: {},
      };
      const result = voiceStateReducer(speaking, {
        type: 'TTS_END',
      });
      expect(result.state).toBe('idle');
    });

    it('should not transition from loading to idle via TTS_END', () => {
      const loading: VoiceStateTransition = {
        state: 'loading',
        context: {},
      };
      const result = voiceStateReducer(loading, {
        type: 'TTS_END',
      });
      expect(result.state).toBe('loading');
    });
  });

  // ─── Cancel / Reset / Error → Anytime to Idle ────────────────────────
  describe('universal transitions to idle', () => {
    const allStates: VoiceState[] = ['recording', 'submitting', 'loading', 'speaking'];

    allStates.forEach((fromState) => {
      it(`CANCEL should return from ${fromState} to idle`, () => {
        const state: VoiceStateTransition = {
          state: fromState,
          context: { transcript: 'test' },
        };
        const result = voiceStateReducer(state, { type: 'CANCEL' });
        expect(result.state).toBe('idle');
        expect(result.context).toEqual({});
      });

      it(`RESET should return from ${fromState} to idle`, () => {
        const state: VoiceStateTransition = {
          state: fromState,
          context: { transcript: 'test' },
        };
        const result = voiceStateReducer(state, { type: 'RESET' });
        expect(result.state).toBe('idle');
        expect(result.context).toEqual({});
      });

      it(`ERROR should return from ${fromState} to idle with error`, () => {
        const state: VoiceStateTransition = {
          state: fromState,
          context: { transcript: 'test' },
        };
        const result = voiceStateReducer(state, {
          type: 'ERROR',
          error: 'Network failure',
        });
        expect(result.state).toBe('idle');
        expect(result.context.error).toBe('Network failure');
      });
    });
  });

  // ─── SEND_END transitions ────────────────────────────────────────────
  describe('SEND_END', () => {
    it('should transition from loading to speaking', () => {
      const loading: VoiceStateTransition = {
        state: 'loading',
        context: {},
      };
      const result = voiceStateReducer(loading, { type: 'SEND_END' });
      expect(result.state).toBe('speaking');
    });

    it('should transition from speaking to idle', () => {
      const speaking: VoiceStateTransition = {
        state: 'speaking',
        context: {},
      };
      const result = voiceStateReducer(speaking, { type: 'SEND_END' });
      expect(result.state).toBe('idle');
    });

    it('should not change state from idle', () => {
      const result = voiceStateReducer(INITIAL_VOICE_STATE, { type: 'SEND_END' });
      expect(result.state).toBe('idle');
    });
  });

  // ─── Full lifecycle ──────────────────────────────────────────────────
  describe('full voice lifecycle', () => {
    it('should complete the full cycle: idle → recording → submitting → loading → speaking → idle', () => {
      let state: VoiceStateTransition = INITIAL_VOICE_STATE;

      // 1. Start recording
      state = voiceStateReducer(state, { type: 'START_RECORDING' });
      expect(state.state).toBe('recording');

      // 2. Transcript ready
      state = voiceStateReducer(state, {
        type: 'TRANSCRIPT_READY',
        transcript: 'Hello bot',
      });
      expect(state.state).toBe('submitting');
      expect(state.context.transcript).toBe('Hello bot');

      // 3. Send start
      state = voiceStateReducer(state, { type: 'SEND_START' });
      expect(state.state).toBe('loading');

      // 4. TTS start
      state = voiceStateReducer(state, { type: 'TTS_START' });
      expect(state.state).toBe('speaking');

      // 5. TTS end
      state = voiceStateReducer(state, { type: 'TTS_END' });
      expect(state.state).toBe('idle');
      expect(state.context).toEqual({});
    });

    it('should complete cycle with SEND_END instead of TTS_START', () => {
      let state: VoiceStateTransition = INITIAL_VOICE_STATE;

      state = voiceStateReducer(state, { type: 'START_RECORDING' });
      expect(state.state).toBe('recording');

      state = voiceStateReducer(state, {
        type: 'TRANSCRIPT_READY',
        transcript: 'Hello',
      });
      expect(state.state).toBe('submitting');

      state = voiceStateReducer(state, { type: 'SEND_START' });
      expect(state.state).toBe('loading');

      state = voiceStateReducer(state, { type: 'SEND_END' });
      expect(state.state).toBe('speaking');

      state = voiceStateReducer(state, { type: 'TTS_END' });
      expect(state.state).toBe('idle');
    });

    it('should handle cancel at any point', () => {
      let state: VoiceStateTransition = INITIAL_VOICE_STATE;

      state = voiceStateReducer(state, { type: 'START_RECORDING' });
      state = voiceStateReducer(state, { type: 'CANCEL' });
      expect(state.state).toBe('idle');

      // Restart and cancel during loading
      state = voiceStateReducer(state, { type: 'START_RECORDING' });
      state = voiceStateReducer(state, { type: 'TRANSCRIPT_READY', transcript: 'hi' });
      state = voiceStateReducer(state, { type: 'SEND_START' });
      expect(state.state).toBe('loading');

      state = voiceStateReducer(state, { type: 'CANCEL' });
      expect(state.state).toBe('idle');
    });
  });

  // ─── Error handling ──────────────────────────────────────────────────
  describe('error handling', () => {
    it('should preserve error in context', () => {
      const loading: VoiceStateTransition = {
        state: 'loading',
        context: { transcript: 'Hello' },
      };
      const result = voiceStateReducer(loading, {
        type: 'ERROR',
        error: 'Microphone not available',
      });
      expect(result.state).toBe('idle');
      expect(result.context.error).toBe('Microphone not available');
      // Transcript should be cleared on error
      expect(result.context.transcript).toBeUndefined();
    });

    it('should clear error when transitioning normally from error state', () => {
      const errorState: VoiceStateTransition = {
        state: 'idle',
        context: { error: 'Some error' },
      };
      const result = voiceStateReducer(errorState, {
        type: 'START_RECORDING',
      });
      expect(result.state).toBe('recording');
      expect(result.context.error).toBeUndefined();
    });
  });
});

describe('helper functions', () => {
  describe('isValidTransition', () => {
    it('should return true for valid transitions', () => {
      expect(isValidTransition('idle', 'START_RECORDING')).toBe(true);
      expect(isValidTransition('recording', 'TRANSCRIPT_READY')).toBe(true);
      expect(isValidTransition('submitting', 'SEND_START')).toBe(true);
      expect(isValidTransition('loading', 'TTS_START')).toBe(true);
      expect(isValidTransition('speaking', 'TTS_END')).toBe(true);
    });

    it('should return false for invalid transitions', () => {
      expect(isValidTransition('idle', 'TRANSCRIPT_READY')).toBe(false);
      expect(isValidTransition('recording', 'TTS_END')).toBe(false);
      expect(isValidTransition('loading', 'STOP_RECORDING')).toBe(false);
    });

    it('should return true for universal actions', () => {
      expect(isValidTransition('recording', 'CANCEL')).toBe(true);
      expect(isValidTransition('loading', 'CANCEL')).toBe(true);
      expect(isValidTransition('speaking', 'ERROR')).toBe(true);
    });
  });

  describe('getVoiceStateLabel', () => {
    it('should return correct labels for all states', () => {
      expect(getVoiceStateLabel('idle')).toBe('Ready');
      expect(getVoiceStateLabel('recording')).toBe('Listening...');
      expect(getVoiceStateLabel('submitting')).toBe('Sending...');
      expect(getVoiceStateLabel('loading')).toBe('Thinking...');
      expect(getVoiceStateLabel('speaking')).toBe('Speaking...');
    });
  });

  describe('canUserStopRecording', () => {
    it('should only be true for recording state', () => {
      expect(canUserStopRecording('recording')).toBe(true);
      expect(canUserStopRecording('idle')).toBe(false);
      expect(canUserStopRecording('loading')).toBe(false);
      expect(canUserStopRecording('speaking')).toBe(false);
      expect(canUserStopRecording('submitting')).toBe(false);
    });
  });

  describe('isVoiceActive', () => {
    it('should be true for all states except idle', () => {
      expect(isVoiceActive('idle')).toBe(false);
      expect(isVoiceActive('recording')).toBe(true);
      expect(isVoiceActive('submitting')).toBe(true);
      expect(isVoiceActive('loading')).toBe(true);
      expect(isVoiceActive('speaking')).toBe(true);
    });
  });
});
