import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

/**
 * Launch Chromium, preferring the one Playwright installed for itself.
 *
 * The fallback exists because a machine may already carry a Chromium that
 * Playwright did not put there — a preinstalled one in a container image, say —
 * whose build number will not match what this version of Playwright expects.
 * Rather than fail, look for any Chromium under `PLAYWRIGHT_BROWSERS_PATH` and
 * use it: these tests drive the DOM and read pixels, neither of which is
 * sensitive to the exact build.
 *
 * If neither is available the error says how to fix it, because a browser test
 * that skips itself when it cannot find a browser is a test that silently
 * stops running.
 */
export async function launchChromium(): Promise<Browser> {
    try {
        return await chromium.launch();
    } catch (bundled) {
        const found = findInstalledChromium();
        if (found === null) {
            throw new Error(
                `no Chromium available — run \`pnpm exec playwright install chromium\`.\n` +
                    `Playwright's own launch failed with: ${(bundled as Error).message}`,
                { cause: bundled },
            );
        }
        return await chromium.launch({ executablePath: found });
    }
}

/** A Chromium under `PLAYWRIGHT_BROWSERS_PATH` that Playwright did not install for itself, or null. */
export function findInstalledChromium(): string | null {
    const root = process.env["PLAYWRIGHT_BROWSERS_PATH"];
    if (root === undefined || !existsSync(root)) return null;

    for (const entry of readdirSync(root)) {
        if (!entry.startsWith("chromium-")) continue;
        for (const folder of ["chrome-linux64", "chrome-linux"]) {
            const candidate = join(root, entry, folder, "chrome");
            if (existsSync(candidate)) return candidate;
        }
    }
    return null;
}

/**
 * Draw battles with Canvas2D rather than WebGL, for a page whose tests read
 * the battle's pixels or text off the view's 2D context, or are about the UI
 * rather than the drawing: without a GPU, WebGL is drawn in software and is
 * slow to start. The tests for WebGL itself leave it out.
 */
export async function drawIn2D(page: Page): Promise<void> {
    await page.addInitScript(() => window.localStorage.setItem("scs2d.draw", "canvas2d"));
}
