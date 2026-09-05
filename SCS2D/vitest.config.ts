import { defineConfig } from 'vitest/config';

/**
 * The default suite: everything that runs from a cold checkout with nothing
 * but `npm ci`. Browser tests are excluded because they need a browser
 * installed — see `vitest.browser.config.ts` and `npm run test:browser`.
 */
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', 'tests/browser/**'],
  },
});
