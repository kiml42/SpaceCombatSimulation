import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { defineConfig } from "vitest/config";
import { findInstalledChromium } from "./tests/browser/launch";

const root = fileURLToPath(new URL(".", import.meta.url));

// As `launchChromium` does: Playwright's own Chromium, or failing that one already on the machine.
const executablePath = existsSync(chromium.executablePath()) ? undefined : (findInstalledChromium() ?? undefined);

/**
 * The browser suite, kept separate so the default one stays runnable anywhere.
 * `pages` drives the built pages from Node; `storybook` renders every story in
 * Chromium, running its `play` function and an accessibility check.
 */
export default defineConfig({
    test: {
        projects: [
            {
                test: {
                    name: "pages",
                    include: ["tests/browser/**/*.test.ts"],
                    // Generous, because the first run builds the bundle and launches
                    // Chromium; the tests themselves take a couple of seconds.
                    testTimeout: 30_000,
                    hookTimeout: 120_000,
                    // One page shared across the file, so they must not run in parallel.
                    fileParallelism: false,
                },
            },
            {
                resolve: { alias: { "~": root } },
                plugins: [storybookTest({ configDir: ".storybook" })],
                test: {
                    name: "storybook",
                    setupFiles: [".storybook/vitest.setup.ts"],
                    browser: {
                        enabled: true,
                        headless: true,
                        provider: playwright(executablePath === undefined ? {} : { launchOptions: { executablePath } }),
                        instances: [{ browser: "chromium" }],
                    },
                },
            },
        ],
    },
});
