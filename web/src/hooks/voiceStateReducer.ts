import type { VoiceState } from '@/components/chat/VoiceStateIndicator';

export type { VoiceState } from '@/components/chat/VoiceStateIndicator';

/**
 * Context that accompanies a voice state transition.
 * - transcript: interim or final speech-to-text result
 * - error: error message if the state transition is due to an error
 */
export interface VoiceStateContext {
  transcript?: string;
  error?: string;
}

/**
 * Actions that drive the voice state machine.
 */
export type VoiceAction =
  | { type: 'START_RECORDING' }
  | { type: 'STOP_RECORDING' }
  | { type: 'TRANSCRIPT_READY'; transcript: string }
  | { type: 'SEND_START' }
  | { type: 'SEND_END' }
  | { type: 'TTS_START' }
  | { type: 'TTS_END' }
  | { type: 'CANCEL' }
  | { type: 'RESET' }
  | { type: 'ERROR'; error: string };

/**
 * A single transition result: the new state plus optional context.
 */
export interface VoiceStateTransition {
  state: VoiceState;
  context: VoiceStateContext;
}

/**
 * Initial state of the voice state machine.
 */
export const INITIAL_VOICE_STATE: VoiceStateTransition = {
  state: 'idle',
  context: {},
};

/**
 * Valid next states from each state, used for validation / testing.
 */
export const validTransitions: Record<VoiceState, VoiceAction['type'][]> = {
  idle: ['START_RECORDING', 'ERROR', 'RESET'],
  recording: ['STOP_RECORDING', 'TRANSCRIPT_READY', 'ERROR', 'CANCEL'],
  submitting: ['SEND_START', 'CANCEL', 'ERROR'],
  loading: ['SEND_END', 'TTS_START', 'CANCEL', 'ERROR'],
  speaking: ['TTS_END', 'CANCEL', 'ERROR'],
};

/**
 * Pure reducer that transitions voice state based on the current state and action.
 *
 * State lifecycle:
 *   idle → recording → submitting → loading → speaking → idle
 *   Any state can be cancelled (→ idle) or reset.
 *
 * @param current - The current voice state + context
 * @param action  - The action triggering the transition
 * @returns The new voice state + context
 */
export function voiceStateReducer(
  current: VoiceStateTransition,
  action: VoiceAction,
): VoiceStateTransition {
  switch (action.type) {
    case 'START_RECORDING':
      if (current.state === 'idle') {
        return { state: 'recording', context: {} };
      }
      return current;

    case 'STOP_RECORDING':
      if (current.state === 'recording') {
        return { state: 'idle', context: {} };
      }
      return current;

    case 'TRANSCRIPT_READY':
      if (current.state === 'recording') {
        return {
          state: 'submitting',
          context: { transcript: action.transcript, error: undefined },
        };
      }
      return current;

    case 'SEND_START':
      if (current.state === 'submitting' || current.state === 'loading') {
        return { state: 'loading', context: { ...current.context, error: undefined } };
      }
      return current;

    case 'SEND_END':
      if (current.state === 'loading') {
        return { state: 'speaking', context: { ...current.context, error: undefined } };
      }
      // Allow transitioning from loading directly to idle if TTS is disabled
      if (current.state === 'speaking') {
        return { state: 'idle', context: {} };
      }
      return current;

    case 'TTS_START':
      if (current.state === 'loading') {
        return { state: 'speaking', context: { ...current.context, error: undefined } };
      }
      return current;

    case 'TTS_END':
      if (current.state === 'speaking') {
        return { state: 'idle', context: {} };
      }
      return current;

    case 'CANCEL':
      return { state: 'idle', context: {} };

    case 'RESET':
      return { state: 'idle', context: {} };

    case 'ERROR':
      return { state: 'idle', context: { error: action.error } };

    default:
      return current;
  }
}

/**
 * Helper: check if a transition from currentState via actionType is valid.
 * Used in tests and can be used for debugging.
 */
export function isValidTransition(
  currentState: VoiceState,
  actionType: VoiceAction['type'],
): boolean {
  return validTransitions[currentState]?.includes(actionType) ?? false;
}

/**
 * Helper: get the display label for a voice state.
 */
export function getVoiceStateLabel(state: VoiceState): string {
  const labels: Record<VoiceState, string> = {
    idle: 'Ready',
    recording: 'Listening...',
    submitting: 'Sending...',
    loading: 'Thinking...',
    speaking: 'Speaking...',
  };
  return labels[state];
}

/**
 * Helper: determine if the voice input area should be interactive (mic clickable).
 * When true, the user can click the mic to stop recording.
 * When false, the UI should show other indicators.
 */
export function canUserStopRecording(state: VoiceState): boolean {
  return state === 'recording';
}

/**
 * Helper: determine if the voice input is currently active (anything other than idle).
 */
export function isVoiceActive(state: VoiceState): boolean {
  return state !== 'idle';
}
