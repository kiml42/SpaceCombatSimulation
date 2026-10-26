/// <reference lib="dom" />

import { afterAll, beforeAll, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { Browser } from "playwright";
import { launchChromium } from "./launch.js";
import { serialiseBlueprint } from "../../sim/index.js";
import { CORVETTE } from "../../scenarios/blueprints.js";

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

it("routes by the hash from a file, and lists what browser storage holds", async () => {
    const page = await browser.newPage();
    const problems: string[] = [];
    page.on("pageerror", (error) => problems.push(error.message));
    await page.goto(pathToFileURL(appPage).href);

    const probe = JSON.stringify(serialiseBlueprint({ ...CORVETTE, name: "Probe" }));
    await page.evaluate((text) => localStorage.setItem("scs2d.blueprint.Probe", text), probe);

    await page.getByRole("link", { name: "Library" }).click();
    expect(new URL(page.url()).hash).toBe("#/library");
    const ships = page.getByRole("region", { name: "Ships" });
    await expect.poll(() => ships.textContent()).toContain("Probesaved");

    // The route survives a reload: it is in the address, not in memory.
    await page.reload();
    await page.getByRole("region", { name: "Ships" }).waitFor();
    await page.evaluate(() => localStorage.removeItem("scs2d.blueprint.Probe"));
    expect(problems).toEqual([]);
});

it("runs a battle on its route, and lets go of it on leaving", async () => {
    const page = await browser.newPage();
    const problems: string[] = [];
    page.on("pageerror", (error) => problems.push(error.message));
    page.on("console", (message) => {
        if (message.type() === "error" || message.type() === "warning") problems.push(message.text());
    });
    // Counted, to see the battle's clock stop when the route is left.
    await page.addInitScript(() => {
        const request = window.requestAnimationFrame.bind(window);
        Reflect.set(window, "framesAsked", 0);
        window.requestAnimationFrame = (callback) => {
            Reflect.set(window, "framesAsked", (Reflect.get(window, "framesAsked") as number) + 1);
            return request(callback);
        };
    });
    await page.goto(`${pathToFileURL(appPage).href}#/battle`);

    const readout = page.getByLabel("Battle time");
    const step = async (): Promise<number> => Number(/step (\d+)/.exec((await readout.textContent()) ?? "")?.[1] ?? -1);
    await expect.poll(step).toBeGreaterThan(30);
    const lit = await page.evaluate(() => {
        const canvas = document.querySelector("canvas")!;
        const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
        let count = 0;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i]! + pixels[i + 1]! + pixels[i + 2]! > 120) count++;
        return count;
    });
    expect(lit).toBeGreaterThan(500);

    await page.getByRole("button", { name: "Pause" }).click();
    // The readout is sampled, so it settles a sample after the battle stops.
    await page.waitForTimeout(300);
    const held = await step();
    await page.waitForTimeout(400);
    expect(await step()).toBe(held);
    await page.getByRole("button", { name: "Step" }).click();
    await expect.poll(step).toBe(held + 1);

    // Kept under the old viewer's own key.
    await page.getByRole("combobox", { name: "speed" }).selectOption("4");
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem("scs2d.view.viewer")))!)).toMatchObject({ speed: 4 });

    await page.getByRole("link", { name: "Library" }).click();
    await page.getByRole("region", { name: "Ships" }).waitFor();
    const before = (await page.evaluate(() => Reflect.get(window, "framesAsked"))) as number;
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => Reflect.get(window, "framesAsked"))).toBe(before);
    expect(await page.getByRole("toolbar").count()).toBe(0);

    await page.getByRole("link", { name: "Battle" }).click();
    expect(await page.getByRole("combobox", { name: "speed" }).inputValue()).toBe("4");
    await page.evaluate(() => localStorage.removeItem("scs2d.view.viewer"));
    expect(problems).toEqual([]);
});
