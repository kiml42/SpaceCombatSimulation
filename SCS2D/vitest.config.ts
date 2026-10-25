import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

/**
 * The default suite: everything that runs from a cold checkout with nothing
 * but `pnpm install`. Browser tests are excluded because they need a browser
 * installed — see `vitest.browser.config.ts` and `pnpm test:browser`.
 */
export default defineConfig({
    test: {
        projects: [
            {
                test: {
                    name: "unit",
                    include: ["tests/**/*.test.ts"],
                    exclude: ["**/node_modules/**", "tests/browser/**"],
                    // Vitest's five seconds suits a unit test, not one that runs a battle or
                    // breeds a population: dozens here take one to five seconds on a quiet
                    // machine, so a CI runner half as fast failed whichever ran over. A test
                    // that needs longer still says so itself.
                    testTimeout: 60_000,
                },
            },
            {
                resolve: { alias: { "~": root } },
                // No Linaria plugin: with NODE_ENV "test" its runtime renders unstyled components, which
                // is all a query by role or text needs. Styles are the stories' to check, in a real browser.
                plugins: [react()],
                test: {
                    name: "components",
                    include: ["{app,ui,features}/**/*.test.{ts,tsx}"],
                    environment: "happy-dom",
                    env: { NODE_ENV: "test" },
                    setupFiles: ["tests/components.setup.ts"],
                },
            },
        ],
    },
});
