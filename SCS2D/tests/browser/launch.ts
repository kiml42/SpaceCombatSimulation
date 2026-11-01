import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Locator } from "playwright";

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

/** A picture's pixels, RGBA, a row at a time from the top. */
export interface Pixels {
    readonly data: Uint8Array;
    readonly width: number;
    readonly height: number;
}

/**
 * What `target` shows on screen, as pixels: a screenshot, so what Pixi draws
 * under a canvas is in it with whatever is drawn over it, which reading a
 * canvas's own context would miss.
 */
export async function shownPixels(target: Locator): Promise<Pixels> {
    const png = (await target.screenshot()).toString("base64");
    const decoded = await target.page().evaluate(async (from) => {
        const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${from}`)).blob());
        const canvas = new OffscreenCanvas(image.width, image.height);
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(image, 0, 0);
        const { data } = ctx.getImageData(0, 0, image.width, image.height);
        let text = "";
        for (let i = 0; i < data.length; i += 0x8000) text += String.fromCharCode(...data.subarray(i, i + 0x8000));
        return { rgba: btoa(text), width: image.width, height: image.height };
    }, png);
    return { data: new Uint8Array(Buffer.from(decoded.rgba, "base64")), width: decoded.width, height: decoded.height };
}

/** Whether a console message is the GPU driver's own note, as drawing WebGL in software gives, rather than the page's. */
export function driverNote(text: string): boolean {
    return text.includes("GL Driver Message") || text.includes("GPU stall");
}
