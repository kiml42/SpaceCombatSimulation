import { defineConfig } from 'vitest/config';

/**
 * The browser suite, kept separate so the default one stays runnable anywhere.
 * Timeouts are generous because the first run builds the bundle and launches
 * Chromium; the tests themselves take a couple of seconds.
 */
export default defineConfig({
  test: {
    include: ['tests/browser/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // One page shared across the file, so they must not run in parallel.
    fileParallelism: false,
  },
});
