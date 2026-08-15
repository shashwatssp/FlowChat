import { Mic, Send, Bot, Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type VoiceState = 'idle' | 'recording' | 'submitting' | 'loading' | 'speaking';

interface VoiceStateIndicatorProps {
  state: VoiceState;
  transcript?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  showTranscript?: boolean;
  showLabel?: boolean;
}

const stateConfig: Record<VoiceState, {
  icon: React.ReactNode;
  label: string;
  color: string;
  bgColor: string;
  animate?: boolean;
}> = {
  idle: {
    icon: <Mic className="w-full h-full text-gray-500" />,
    label: 'Voice input ready',
    color: 'text-gray-500',
    bgColor: 'bg-gray-100',
  },
  recording: {
    icon: <Mic className="w-full h-full text-white" />,
    label: 'Listening...',
    color: 'text-white',
    bgColor: 'bg-red-500',
    animate: true,
  },
  submitting: {
    icon: <Send className="w-full h-full text-white animate-pulse" />,
    label: 'Sending...',
    color: 'text-white',
    bgColor: 'bg-primary-600',
    animate: true,
  },
  loading: {
    icon: <Bot className="w-full h-full text-primary-600" />,
    label: 'Thinking...',
    color: 'text-primary-600',
    bgColor: 'bg-primary-100',
    animate: true,
  },
  speaking: {
    icon: <Volume2 className="w-full h-full text-white" />,
    label: 'Speaking...',
    color: 'text-white',
    bgColor: 'bg-blue-500',
    animate: true,
  },
};

const sizeConfig = {
  sm: { container: 'w-8 h-8', label: 'text-xs' },
  md: { container: 'w-10 h-10', label: 'text-sm' },
  lg: { container: 'w-12 h-12', label: 'text-base' },
};

const Waveform: React.FC<{ className?: string; active?: boolean }> = ({
  className,
  active,
}) => {
  const bars = Array.from({ length: 5 }, (_, i) => i);
  return (
    <div
      className={cn(
        'flex items-end gap-0.5 h-full',
        className,
      )}
      aria-hidden="true"
    >
      {bars.map((i) => (
        <div
          key={i}
          className={cn(
            'w-0.5 rounded-full bg-white transition-all duration-300',
            active ? 'animate-pulse' : 'opacity-30',
          )}
          style={{
            animationDelay: `${i * 0.1}s`,
            height: active ? `${Math.random() * 100 + 30}%` : '30%',
          }}
        />
      ))}
    </div>
  );
};

export default function VoiceStateIndicator({
  state,
  transcript = '',
  className,
  size = 'md',
  showTranscript = false,
  showLabel = true,
}: VoiceStateIndicatorProps) {
  const cfg = stateConfig[state];
  const sz = sizeConfig[size];

  return (
    <div
      className={cn(
        'flex items-center gap-2',
        className,
      )}
      role="status"
      aria-live={state === 'idle' ? 'off' : 'polite'}
    >
      <div
        className={cn(
          sz.container,
          'rounded-full flex items-center justify-center transition-all duration-200',
          cfg.bgColor,
          cfg.color,
          state === 'recording' && 'ring-2 ring-red-200 ring-offset-2',
          state === 'speaking' && 'ring-2 ring-blue-200 ring-offset-2',
        )}
      >
        {state === 'recording' ? (
          <div className="relative flex items-center justify-center w-full h-full">
            <Waveform active={true} />
          </div>
        ) : state === 'speaking' ? (
          <div className="relative flex items-center justify-center w-full h-full">
            <Waveform active={true} className="absolute inset-0" />
            {cfg.icon}
          </div>
        ) : state === 'loading' ? (
          <div className="relative flex items-center justify-center w-full h-full">
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-2 h-2 bg-primary-600 rounded-full animate-bounce"></div>
            </div>
            {cfg.icon}
          </div>
        ) : (
          cfg.icon
        )}
      </div>

      {showTranscript && transcript && state === 'recording' && (
        <span
          className={cn(
            'text-gray-600 italic transition-opacity duration-200',
            sz.label,
          )}
        >
          {transcript}
        </span>
      )}

      {showLabel && (
        <span
          className={cn(
            'font-medium transition-colors duration-200',
            sz.label,
            cfg.color,
          )}
        >
          {cfg.label}
        </span>
      )}
    </div>
  );
}
