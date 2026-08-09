const nextJest = require('next/jest');

/** @type {import('jest').Config} */
const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load `next.config.js` and
  // `SWC` config for tests
  dir: './',
});

/**
 * Jest configuration for FlowChat voice state tests.
 * Uses next/jest to handle Next.js / SWC / TypeScript transpilation.
 */
const config = {
  setupFilesAfterEnv: ['<rootDir>/src/setupTests.ts'],
  testEnvironment: 'jsdom',
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/.next/', '<rootDir>/out/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  collectCoverageFrom: [
    'src/hooks/voiceStateReducer.ts',
    'src/hooks/useVoiceState.ts',
    'src/components/chat/VoiceStateIndicator.tsx',
    'src/components/chat/ChatInput.tsx',
  ],
};

module.exports = createJestConfig(config);
