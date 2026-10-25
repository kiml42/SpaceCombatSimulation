import { defineConfig } from "vitest/config";

/**
 * The default suite: everything that runs from a cold checkout with nothing
 * but `pnpm install`. Browser tests are excluded because they need a browser
 * installed — see `vitest.browser.config.ts` and `pnpm test:browser`.
 */
export default defineConfig({
    test: {
        exclude: ["**/node_modules/**", "tests/browser/**"],
        // Vitest's five seconds suits a unit test, not one that runs a battle or
        // breeds a population: dozens here take one to five seconds on a quiet
        // machine, so a CI runner half as fast failed whichever ran over. A test
        // that needs longer still says so itself.
        testTimeout: 60_000,
    },
});
