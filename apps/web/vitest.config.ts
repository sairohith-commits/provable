import { defineConfig } from 'vitest/config';

// Unit tests for the PURE view-helpers (persona ordering, needs-attention ranking,
// two-marker ladder math). The live-crossing UI is covered separately by Playwright (e2e/).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
