import { defineConfig } from 'vitest/config';

// Unit tests live beside the code in src/; e2e/ belongs to Playwright.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
