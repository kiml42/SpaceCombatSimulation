/// <reference lib="dom" />

import { afterAll, beforeAll, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { Browser } from "playwright";
import { launchChromium } from "./launch.js";

/**
 * The React app as built, opened from disk: browsers will not load a module
 * script from `file://`, so this is what fails if the app ever stops being
 * one self-contained file.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const appPage = join(root, "dist", "app.html");

let browser: Browser;

beforeAll(async () => {
    if (process.platform === "win32") {
        await promisify(execFile)("cmd.exe", ["/c", "npx", "vite", "build"], { cwd: root });
    } else {
        await promisify(execFile)("npx", ["vite", "build"], { cwd: root });
    }
    expect(existsSync(appPage)).toBe(true);
    browser = await launchChromium();
});

afterAll(async () => {
    await browser?.close();
});

it("renders from a file, with its styles, and links to the old pages", async () => {
    const page = await browser.newPage();
    const problems: string[] = [];
    page.on("pageerror", (error) => problems.push(error.message));
    page.on("console", (message) => {
        if (message.type() === "error") problems.push(message.text());
    });
    await page.goto(pathToFileURL(appPage).href);

    const heading = page.getByRole("heading", { name: "Space Combat Simulation" });
    await heading.waitFor();
    // Styled by the tokens and by Linaria, so neither was dropped from the one file.
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(11, 15, 22)");
    expect(await heading.evaluate((element) => getComputedStyle(element).fontWeight)).toBe("600");
    expect(await page.getByRole("link", { name: "Ship editor" }).getAttribute("href")).toBe("editor.html");
    expect(problems).toEqual([]);
});
