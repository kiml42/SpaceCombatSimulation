/// <reference lib="dom" />

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { Browser, Page } from "playwright";
import { drawIn2D, launchChromium } from "./launch.js";
import { shipFleet, type Blueprint } from "../../sim/index.js";
import { BARE_CORE, CORVETTE, GUNSHIP } from "../../scenarios/blueprints.js";
import { HISTORY_STORAGE_KEY } from "../../scenarios/history.js";
import { DEFAULT_SKIRMISH_SETTINGS, newSkirmish, won, type Skirmish } from "../../scenarios/skirmish.js";
import { DEFAULT_KINDS } from "../../evolution/mutate.js";
import { designRoute, fleetRoute, skirmishRoute } from "../../editor/handoff.js";

/**
 * The skirmish loop in a real browser: choosing an enemy and a fleet, fighting,
 * and the round trip through the fleet editor. Whether a battle is decided
 * right is `tests/skirmish.test.ts`'s.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const appPage = join(root, "dist", "index.html");
/** The skirmish route, carrying a skirmish to take up if given one. */
const skirmishPage = (skirmish?: Skirmish): string =>
    `${pathToFileURL(appPage).href}#${skirmish === undefined ? "/skirmish" : skirmishRoute(skirmish)}`;

let browser: Browser;
let page: Page;
const problems: string[] = [];

beforeAll(async () => {
    if (process.platform === "win32") {
        await promisify(execFile)("cmd.exe", ["/c", "npx", "vite", "build"], { cwd: root });
    } else {
        await promisify(execFile)("npx", ["vite", "build"], { cwd: root });
    }
    expect(existsSync(appPage)).toBe(true);

    browser = await launchChromium();
    page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
    await drawIn2D(page);
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
        if (message.type() === "error") problems.push(`console: ${message.text()}`);
    });
    page.on("dialog", (dialog) => void dialog.accept());
    await page.goto(skirmishPage());
}, 120_000);

afterAll(async () => {
    await browser?.close();
});

describe("the skirmish in a browser", () => {
    it("opens on choosing an enemy, without errors", async () => {
        expect(await page.isVisible("#setupScreen")).toBe(true);
        expect(await page.isVisible("#round")).toBe(false);
        expect(await page.textContent("#enemyBill")).toContain("metal");
        expect(problems).toEqual([]);
    });

    it("will not fight with a fleet over budget", async () => {
        await page.selectOption("#enemy", "ship:Bare Core");
        await page.selectOption("#startFleet", "ship:Gunship");
        await page.click("#start");
        expect(await page.isVisible("#round")).toBe(true);
        expect(await page.isDisabled("#play")).toBe(true);
        expect(await page.isDisabled("#fight")).toBe(true);
        expect(await page.getAttribute("#editFleet", "data-variant")).toBe("primary");
        expect(await page.textContent("#fleetNote")).toContain("over budget");
        expect(await page.locator("#budget tr.over").count()).toBeGreaterThan(0);
        await page.click("#abandon");
        expect(await page.isVisible("#setupScreen")).toBe(true);
    });

    it("fights over the enemy's cost with a budget raised to fit, and matches the enemy again", async () => {
        await page.selectOption("#enemy", "ship:Bare Core");
        await page.selectOption("#startFleet", "ship:Gunship");
        const matched = await page.inputValue("#metalBudget");
        for (const id of ["metalBudget", "fuelBudget", "buildBudget"]) await page.fill(`#${id}`, "100000");
        await page.click("#start");
        expect(await page.isDisabled("#play")).toBe(false);
        const kept = await page.evaluate(() => JSON.parse(window.localStorage.getItem("scs2d.skirmish")!));
        expect(kept.budget.metal).toBe(100_000_000);
        await page.click("#abandon");
        // A box set by hand stays when the enemy changes; one left alone follows it.
        await page.fill("#metalBudget", "1");
        const fuel = await page.inputValue("#fuelBudget");
        await page.fill("#fuelBudget", "");
        await page.selectOption("#enemy", "ship:Gunship");
        expect(await page.inputValue("#metalBudget")).toBe("1");
        expect(await page.inputValue("#fuelBudget")).not.toBe(fuel);
        expect(await page.inputValue("#fuelBudget")).not.toBe("");
        await page.selectOption("#enemy", "ship:Bare Core");
        expect(await page.inputValue("#metalBudget")).toBe("1");
        await page.click("#matchEnemy");
        expect(await page.inputValue("#metalBudget")).toBe(matched);
        expect(problems).toEqual([]);
    });

    it("keeps the settings chosen with the skirmish, and puts them back to their defaults", async () => {
        const set = async (id: string, value: string): Promise<void> => {
            await page.fill(`#${id}`, value);
            await page.dispatchEvent(`#${id}`, "change");
        };
        await set("quietTime", "45");
        await set("mutants", "2");
        await set("kindTank", "7");
        await set("maxShips", "3");
        await set("gapSpread", "1000");
        await page.selectOption("#enemy", "ship:Gunship");
        await page.selectOption("#startFleet", "ship:Gunship");
        await page.click("#start");
        const kept = await page.evaluate(() => JSON.parse(window.localStorage.getItem("scs2d.skirmish")!));
        expect(kept.settings.quietTime).toBe(45);
        expect(kept.settings.mutants).toBe(2);
        expect(kept.settings.breeding.kindTank).toBe(7);
        expect(kept.settings.maxShips).toBe(3);
        expect(kept.settings.gapSpread).toBe(1000);
        // Remembered for the next one, until reset.
        await page.click("#abandon");
        expect(await page.inputValue("#quietTime")).toBe("45");
        await page.click("#resetSettings");
        expect(await page.inputValue("#quietTime")).toBe(String(DEFAULT_SKIRMISH_SETTINGS.quietTime));
        expect(await page.inputValue("#mutants")).toBe(String(DEFAULT_SKIRMISH_SETTINGS.mutants));
        expect(await page.inputValue("#kindTank")).toBe(String(DEFAULT_KINDS.tank));
        expect(await page.inputValue("#maxShips")).toBe("20");
        expect(await page.inputValue("#radius")).toBe("500");
        expect(await page.inputValue("#gapSpread")).toBe("0");
        expect(problems).toEqual([]);
    });

    it("fights a round with a fleet that fits", async () => {
        await page.selectOption("#enemy", "ship:Gunship");
        await page.selectOption("#startFleet", "ship:Gunship");
        await page.click("#start");
        expect(await page.isDisabled("#play")).toBe(false);
        expect(await page.textContent("#roundTitle")).toBe("Round 1");
        expect(await page.getAttribute("#fight", "data-variant")).toBe("primary");
        expect(await page.getAttribute("#editFleet", "data-variant")).not.toBe("primary");
        await page.click("#fight");
        // It waits on the battle; pausing is the header's.
        expect(await page.textContent("#fight")).toBe("Fighting…");
        expect(await page.isDisabled("#fight")).toBe(true);
        expect(await page.textContent("#play")).toBe("Pause");
        // Paused once it has moved, or there is nothing yet to resume.
        await page.waitForFunction(() => /t [1-9]/.test(document.getElementById("readout")?.textContent ?? ""));
        await page.click("#play");
        expect(await page.textContent("#fight")).toBe("Resume");
        expect(await page.isDisabled("#fight")).toBe(false);
        await page.click("#fight");
        await page.waitForFunction(() => /t [1-9]/.test(document.getElementById("readout")?.textContent ?? ""));
        expect(await page.textContent("#sides")).toContain("You");
        expect(problems).toEqual([]);
    });

    it("takes orders for your ships alone, and winds back", async () => {
        // The round from the last test, paused part way.
        if ((await page.textContent("#play")) === "Pause") await page.click("#play");
        const canvas = (await page.locator("#view").boundingBox())!;
        type Viewer = { screenOf(i: number): { x: number; y: number }; orders: unknown[] };
        const click = async (ship: number, button: "left" | "right" = "left"): Promise<void> => {
            const p = await page.evaluate((i) => (window as unknown as { viewer: Viewer }).viewer.screenOf(i), ship);
            await page.mouse.click(canvas.x + p.x, canvas.y + p.y, { button });
            await page.waitForTimeout(600);
        };
        const orders = (): Promise<unknown[]> => page.evaluate(() => (window as unknown as { viewer: Viewer }).viewer.orders);
        // Ship 0 is yours, ship 1 the enemy's.
        await click(0);
        expect(await page.isVisible("#orderBar")).toBe(true);
        await click(1, "right");
        expect(await orders()).toHaveLength(1);
        await page.keyboard.press("Escape");
        await click(1);
        expect(await page.isHidden("#orderBar")).toBe(true);
        expect(Number(await page.getAttribute("#scrub", "max"))).toBeGreaterThan(0);
        await page.keyboard.press("Escape");
        expect(problems).toEqual([]);
    });

    it("goes to the fleet editor with the budget, and back to the round", async () => {
        await page.click("#editFleet");
        await page.waitForURL(/index\.html#\/fleet\?skirmish=/);
        await page.waitForSelector("#fleetName");
        expect(await page.isVisible("#skirmish")).toBe(true);
        expect(await page.textContent("#skirmishTitle")).toBe("Skirmish — round 1");
        expect(await page.textContent("#skirmishBudget")).toContain("metal");
        expect(await page.inputValue("#fleetName")).toBe("Gunship");
        expect(await page.isVisible("#battleLink")).toBe(false);
        await page.click("#backToSkirmish");
        await page.waitForURL(/#\/skirmish/);
        await page.waitForSelector("#round");
        expect(await page.textContent("#playerName")).toBe("Gunship");
        // Leaving the editor by a link saved the fleet.
        expect(await page.evaluate(() => window.localStorage.getItem("scs2d.fleet.Gunship") !== null)).toBe(true);
        expect(problems).toEqual([]);
    });

    it("opens a ship of the fleet in the ship editor, and takes it back renamed", async () => {
        await page.click("#editFleet");
        await page.waitForURL(/index\.html#\/fleet\?skirmish=/);
        // The fleet route's own box: the address changes before the route on it is drawn.
        await page.waitForSelector("#fleetName");
        // The lone gunship stands at the fleet's origin, in the middle of the view.
        const box = (await page.locator("#view").boundingBox())!;
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        expect(await page.textContent("#selectionTitle")).toBe("Ship: Gunship");
        await page.click("#editDesign");
        await page.waitForURL(/#\/ship\?design=/);
        await page.waitForSelector("#shipName");
        expect(await page.isVisible("#backToFleet")).toBe(true);
        expect(await page.isVisible("#battleLink")).toBe(false);
        expect(await page.textContent("#inFleetTitle")).toBe("Skirmish — round 1");
        expect(await page.textContent("#inFleetBudget")).toContain("metal");
        await page.fill("#shipName", "Gunship Mk II");
        await page.click("#backToFleet");
        await page.waitForURL(/index\.html#\/fleet\?skirmish=/);
        await page.waitForSelector("#fleetName");
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        expect(await page.textContent("#selectionTitle")).toBe("Ship: Gunship Mk II");
        expect(await page.isVisible("#skirmish")).toBe(true);
        expect(problems).toEqual([]);
    });

    it("opens a design that would not fly in the ship editor without throwing", async () => {
        const adrift: Blueprint = {
            ...GUNSHIP,
            name: "Adrift",
            modules: [...GUNSHIP.modules, { kind: "engine", x: 0, y: 200, length: 3, width: 3 }],
        };
        const route = designRoute({
            fleet: shipFleet(adrift),
            design: "Adrift",
            skirmish: newSkirmish(shipFleet(GUNSHIP), shipFleet(GUNSHIP), 3),
        });
        await page.goto(`${pathToFileURL(join(root, "dist", "index.html")).href}#${route}`);
        await page.waitForSelector("#backToFleet");
        expect(await page.textContent("#inFleetNote")).toBe("Priced once the fleet would fly.");
        expect(await page.textContent("#inFleetBudget")).toBe("");
        // It cannot go back to the fleet, or into a battle, until it would fly.
        expect(await page.getAttribute("#backToFleet", "aria-disabled")).toBe("true");
        // Pressed anyway, it says why and stays.
        await page.click("#backToFleet", { force: true });
        expect(page.url()).toContain("#/ship?design=");
        expect(problems).toEqual([]);
    });

    it("keeps a fleet with ships on top of each other out of battle", async () => {
        const stacked = {
            ...shipFleet(GUNSHIP),
            ships: [
                { design: "Gunship", x: 0, y: 0 },
                { design: "Gunship", x: 0, y: 0 },
            ],
        };
        const skirmish = { ...newSkirmish(stacked, stacked, 3), player: stacked };
        await page.goto(`${pathToFileURL(join(root, "dist", "index.html")).href}#${fleetRoute(skirmish.player, skirmish)}`);
        await page.waitForSelector("#backToSkirmish");
        expect(await page.textContent("#skirmishNote")).toBe("Fix the problems listed to fight.");
        expect(await page.getAttribute("#backToSkirmish", "aria-disabled")).toBe("true");
        // Pressed anyway, it says why and stays.
        await page.click("#backToSkirmish", { force: true });
        expect(page.url()).toContain("#/fleet?skirmish=");
        expect(problems).toEqual([]);
    });

    it("makes editing the fleet the thing to do next once a round is lost", async () => {
        // A bare core cannot fire back, so it is out once the quiet time has passed.
        const skirmish = newSkirmish(shipFleet(GUNSHIP), shipFleet(BARE_CORE), 7, undefined, { metal: 1e9, fuel: 1e9, build: 1e9 });
        await page.goto(skirmishPage(skirmish));
        await page.waitForSelector("#round");
        await page.selectOption("#speed", "16");
        await page.click("#fight");
        await page.waitForSelector("#outcome.lost", { timeout: 60_000 });
        // The corner of the battle says when and why.
        expect(await page.isVisible("#decided.lost")).toBe(true);
        expect(await page.textContent("#decidedTitle")).toMatch(/^Defeat at \d+ s$/);
        expect(await page.textContent("#decidedReason")).toBe("Your fleet has nothing left to fight with.");
        expect(await page.getAttribute("#editFleet", "data-variant")).toBe("primary");
        expect(await page.isVisible("#fight")).toBe(false);

        // Exported, the skirmish carries what it would take to ask why the round went as it did.
        const saving = page.waitForEvent("download");
        await page.click("#exportSkirmish");
        const download = await saving;
        expect(download.suggestedFilename()).toBe("skirmish-round-1.skirmish.json");
        const file = JSON.parse(await readFile(await download.path(), "utf8")) as {
            setup: Record<string, unknown>;
            skirmish: { round: number; enemy: unknown; player: unknown } | null;
            history: { rows: unknown[] };
        };
        expect(file.skirmish?.round).toBe(1);
        expect(file.skirmish?.enemy).toBeDefined();
        expect(file.skirmish?.player).toBeDefined();
        expect(file.history.rows.length).toBeGreaterThan(0);
        expect(Object.keys(file.setup).length).toBeGreaterThan(0);

        // Named, it names its file.
        await page.fill("#skirmishName", "Bare core test");
        await page.press("#skirmishName", "Enter");
        const savingNamed = page.waitForEvent("download");
        await page.click("#exportSkirmish");
        expect((await savingNamed).suggestedFilename()).toBe("Bare-core-test-round-1.skirmish.json");

        // And read back after giving the skirmish up, it is the same round with the same history.
        await page.click("#abandon");
        await page.waitForSelector("#round", { state: "hidden" });
        await page.setInputFiles("#importSkirmishFile", await download.path());
        await page.waitForSelector("#round");
        // The try the lost round counted comes back with it.
        expect(await page.textContent("#roundTitle")).toBe("Round 1 · try 2");
        const back = JSON.parse((await page.evaluate(() => localStorage.getItem("scs2d.skirmish.history")))!) as { rows: unknown[] };
        expect(back.rows).toHaveLength(file.history.rows.length);
        expect(problems).toEqual([]);
        // Away, so the next skirmish handed over in an address loads afresh rather than as a change of hash.
        await page.goto("about:blank");
    }, 90_000);

    it("watches the enemy evolve an answer to a round won, and goes on to the next round", async () => {
        // The player's Corvette beats the same Corvette on seed 25, and a mirror is answered in a generation or two.
        const skirmish = won(newSkirmish(shipFleet(CORVETTE), shipFleet(CORVETTE), 25));
        await page.goto(skirmishPage(skirmish));
        await page.waitForSelector("#answering");
        // With cores to spare, the search deals its matches out to job workers beside its own.
        if ((await page.evaluate(() => navigator.hardwareConcurrency)) >= 3) expect(page.workers().length).toBeGreaterThan(2);
        // Opened on the round being answered, not the one already won: said once the view is up, which can be after.
        await page.waitForFunction(() => document.getElementById("outcome")?.textContent !== "");
        expect(await page.textContent("#outcome")).toBe("The enemy as it stands against your fleet, evolving an answer.");
        expect(await page.isVisible("#editFleet")).toBe(false);
        expect(await page.isVisible("#fight")).toBe(false);
        // Spinning while it searches, and only then.
        expect(
            await page.evaluate(
                () => (document.getElementById("answerSpinner") !== null) === (document.getElementById("answered") === null),
            ),
        ).toBe(true);
        // The search goes on while the player looks at another route, and is there to come back to: a
        // generation is kept in the history as it finishes, so one finished while away shows it went on.
        const history = (): Promise<string | null> => page.evaluate((key) => localStorage.getItem(key), HISTORY_STORAGE_KEY);
        const before = await history();
        await page.getByRole("link", { name: "Library" }).click();
        await page.waitForSelector("section[aria-label='Ships']");
        await page.waitForFunction(([key, was]) => localStorage.getItem(key!) !== was, [HISTORY_STORAGE_KEY, before] as const, {
            timeout: 60_000,
        });
        await page.getByRole("link", { name: "Skirmish", exact: true }).click();
        await page.waitForSelector("#answering, #answered");
        expect(await page.textContent("#answerProgress")).not.toMatch(/fighting the first generation/);
        await page.waitForSelector("#answered", { timeout: 90_000 });
        expect(await page.isVisible("#answerSpinner")).toBe(false);
        expect(await page.textContent("#answerProgress")).toMatch(/^Found in generation \d+/);
        // The answer heads the timeline, the enemy's losses before it folded away.
        const first = page.locator("#timeline > .match").first();
        expect(await first.locator(".match-head span").textContent()).toBe("Round 1 · the enemy's answer");
        // Only the player's side is stamped.
        expect(await first.locator(".stamp").allTextContents()).toEqual(["DEFEAT"]);
        expect(await page.locator("#timeline canvas").count()).toBeGreaterThan(0);
        await first.locator(".match-head button").click();
        expect(await page.isVisible("#replaying")).toBe(true);
        // A match played again winds back, though no orders were given in it.
        await page.waitForFunction(() => Number((document.getElementById("scrub") as HTMLInputElement).max) > 120);
        // Paused, since at the speed an earlier test left it the match would run back past where it was sent.
        if ((await page.textContent("#play")) === "Pause") await page.click("#play");
        await page.$eval("#scrub", (input) => {
            // Through the input's own setter, which React does not watch, so the event reads as a change.
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "0");
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await page.waitForFunction(
            () => {
                const scrub = document.getElementById("scrub") as HTMLInputElement;
                return Number(scrub.value) < Number(scrub.max) / 2;
            },
            undefined,
            { timeout: 5_000 },
        );
        await page.click("#backToRound");
        expect(await page.isVisible("#replaying")).toBe(false);
        await page.click("#nextRound");
        expect(await page.textContent("#roundTitle")).toBe("Round 2");
        expect(await page.textContent("#multiplier")).toMatch(/^Playing against a [\d.]+× enemy/);
        expect(await page.isVisible("#answering")).toBe(false);
        expect(await page.isVisible("#editFleet")).toBe(true);
        expect(await page.getAttribute("#fight", "data-variant")).toBe("primary");
        expect(problems).toEqual([]);
    }, 120_000);
});
