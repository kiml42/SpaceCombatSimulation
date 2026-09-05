import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';

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
        `no Chromium available — run \`npx playwright install chromium\`.\n` +
          `Playwright's own launch failed with: ${(bundled as Error).message}`,
      );
    }
    return await chromium.launch({ executablePath: found });
  }
}

function findInstalledChromium(): string | null {
  const root = process.env['PLAYWRIGHT_BROWSERS_PATH'];
  if (root === undefined || !existsSync(root)) return null;

  for (const entry of readdirSync(root)) {
    if (!entry.startsWith('chromium-')) continue;
    const candidate = join(root, entry, 'chrome-linux', 'chrome');
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
