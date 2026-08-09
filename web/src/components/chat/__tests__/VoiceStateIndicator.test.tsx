import { render, screen } from '@testing-library/react';
import VoiceStateIndicator, { VoiceState } from '@/components/chat/VoiceStateIndicator';

describe('VoiceStateIndicator', () => {
  const allStates: VoiceState[] = ['idle', 'recording', 'submitting', 'loading', 'speaking'];
  const stateLabels: Record<VoiceState, string> = {
    idle: 'Voice input ready',
    recording: 'Listening...',
    submitting: 'Sending...',
    loading: 'Thinking...',
    speaking: 'Speaking...',
  };
  const stateColors: Record<VoiceState, string> = {
    idle: 'bg-gray-100',
    recording: 'bg-red-500',
    submitting: 'bg-primary-600',
    loading: 'bg-primary-100',
    speaking: 'bg-blue-500',
  };

  describe('rendering by state', () => {
    allStates.forEach((state) => {
      it(`should render correct label for ${state}`, () => {
        render(<VoiceStateIndicator state={state} />);
        expect(screen.getByText(stateLabels[state])).toBeInTheDocument();
      });

      it(`should render correct background color for ${state}`, () => {
        const { container } = render(<VoiceStateIndicator state={state} />);
        const circle = container.querySelector('.rounded-full');
        expect(circle).toHaveClass(stateColors[state]);
      });

      it(`should have role=status for ${state}`, () => {
        render(<VoiceStateIndicator state={state} />);
        expect(screen.getByRole('status')).toBeInTheDocument();
      });
    });

    it('should set aria-live to "off" when idle', () => {
      render(<VoiceStateIndicator state="idle" />);
      expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'off');
    });

    it('should set aria-live to "polite" when active', () => {
      render(<VoiceStateIndicator state="recording" />);
      expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    });
  });

  describe('transcript display', () => {
    it('should show transcript when recording and showTranscript is true', () => {
      render(
        <VoiceStateIndicator
          state="recording"
          transcript="Hello there"
          showTranscript={true}
        />,
      );
      expect(screen.getByText('Hello there')).toBeInTheDocument();
    });

    it('should not show transcript when showTranscript is false', () => {
      render(
        <VoiceStateIndicator
          state="recording"
          transcript="Hello there"
          showTranscript={false}
        />,
      );
      expect(screen.queryByText('Hello there')).not.toBeInTheDocument();
    });

    it('should not show transcript when not recording', () => {
      render(
        <VoiceStateIndicator
          state="loading"
          transcript="Hello there"
          showTranscript={true}
        />,
      );
      expect(screen.queryByText('Hello there')).not.toBeInTheDocument();
    });

    it('should not render transcript span when transcript is empty', () => {
      const { container } = render(
        <VoiceStateIndicator
          state="recording"
          transcript=""
          showTranscript={true}
        />,
      );
      const transcriptSpan = container.querySelector('.text-gray-600.italic');
      expect(transcriptSpan).not.toBeInTheDocument();
    });
  });

  describe('sizing', () => {
    it('should apply small size by default', () => {
      const { container } = render(<VoiceStateIndicator state="idle" size="sm" />);
      const circle = container.querySelector('.rounded-full');
      expect(circle).toHaveClass('w-8', 'h-8');
    });

    it('should apply medium size', () => {
      const { container } = render(<VoiceStateIndicator state="idle" size="md" />);
      const circle = container.querySelector('.rounded-full');
      expect(circle).toHaveClass('w-10', 'h-10');
    });

    it('should apply large size', () => {
      const { container } = render(<VoiceStateIndicator state="idle" size="lg" />);
      const circle = container.querySelector('.rounded-full');
      expect(circle).toHaveClass('w-12', 'h-12');
    });

    it('should default to md size when not specified', () => {
      const { container } = render(<VoiceStateIndicator state="idle" />);
      const circle = container.querySelector('.rounded-full');
      expect(circle).toHaveClass('w-10', 'h-10');
    });
  });

  describe('custom className', () => {
    it('should merge custom className into root element', () => {
      render(<VoiceStateIndicator state="idle" className="my-custom-class" />);
      const root = screen.getByRole('status');
      expect(root).toHaveClass('my-custom-class');
      expect(root).toHaveClass('flex', 'items-center', 'gap-2');
    });
  });

  describe('state-specific visual elements', () => {
    it('should render waveform during recording', () => {
      const { container } = render(<VoiceStateIndicator state="recording" />);
      const waveform = container.querySelector('.flex.items-end.gap-0\\.5');
      expect(waveform).toBeInTheDocument();
    });

    it('should render ring during recording', () => {
      const { container } = render(<VoiceStateIndicator state="recording" />);
      const circle = container.querySelector('.rounded-full');
      expect(circle).toHaveClass('ring-2', 'ring-red-200', 'ring-offset-2');
    });

    it('should render bouncing dot during loading', () => {
      const { container } = render(<VoiceStateIndicator state="loading" />);
      const bounceDot = container.querySelector('.animate-bounce');
      expect(bounceDot).toBeInTheDocument();
      expect(bounceDot).toHaveClass('w-2', 'h-2', 'bg-primary-600', 'rounded-full');
    });

    it('should render ring during speaking', () => {
      const { container } = render(<VoiceStateIndicator state="speaking" />);
      const circle = container.querySelector('.rounded-full');
      expect(circle).toHaveClass('ring-2', 'ring-blue-200', 'ring-offset-2');
    });

    it('should render waveform during speaking', () => {
      const { container } = render(<VoiceStateIndicator state="speaking" />);
      const waveform = container.querySelector('.flex.items-end.gap-0\\.5');
      expect(waveform).toBeInTheDocument();
    });
  });

  describe('state persistence', () => {
    it('should update label when state changes', () => {
      const { rerender } = render(<VoiceStateIndicator state="idle" />);
      expect(screen.getByText('Voice input ready')).toBeInTheDocument();

      rerender(<VoiceStateIndicator state="recording" />);
      expect(screen.getByText('Listening...')).toBeInTheDocument();
      expect(screen.queryByText('Voice input ready')).not.toBeInTheDocument();

      rerender(<VoiceStateIndicator state="loading" />);
      expect(screen.getByText('Thinking...')).toBeInTheDocument();
      expect(screen.queryByText('Listening...')).not.toBeInTheDocument();
    });
  });
});
