import '@testing-library/jest-dom';

// Mock window.matchMedia for jsdom
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

// Mock SpeechRecognition and SpeechSynthesis for jsdom
const mockSpeechRecognition = jest.fn().mockImplementation(() => ({
  continuous: false,
  interimResults: false,
  lang: 'en-US',
  onresult: null,
  onerror: null,
  onend: null,
  start: jest.fn(),
  stop: jest.fn(),
  abort: jest.fn(),
}));

const mockSpeechSynthesisUtterance = jest.fn().mockImplementation((text: string) => ({
  text,
  lang: 'en-US',
  rate: 1,
  pitch: 1,
  volume: 1,
  onstart: null,
  onend: null,
  onerror: null,
  onpause: null,
  onresume: null,
  onboundary: null,
}));

const mockSpeechSynthesis = {
  speaking: false,
  paused: false,
  pending: false,
  speak: jest.fn(),
  cancel: jest.fn(),
  pause: jest.fn(),
  resume: jest.fn(),
  getVoices: jest.fn().mockReturnValue([]),
};

// @ts-ignore — extend Window with non-standard APIs
window.SpeechRecognition = mockSpeechRecognition;
// @ts-ignore
window.webkitSpeechRecognition = mockSpeechRecognition;
// @ts-ignore
window.SpeechSynthesisUtterance = mockSpeechSynthesisUtterance;
// @ts-ignore
window.speechSynthesis = mockSpeechSynthesis;
