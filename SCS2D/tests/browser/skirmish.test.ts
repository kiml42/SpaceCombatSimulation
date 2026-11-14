/// <reference lib="dom" />

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { Browser, Page } from "playwright";
import { launchChromium } from "./launch.js";
import { shipFleet, type Blueprint } from "../../sim/index.js";
import { BARE_CORE, CORVETTE, GUNSHIP } from "../../scenarios/blueprints.js";
import { HISTORY_STORAGE_KEY } from "../../scenarios/history.js";
import { DEFAULT_SKIRMISH_SETTINGS, newSkirmish, parseSkirmish, won, type Skirmish } from "../../scenarios/skirmish.js";
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
/** A round won, its next round's place already picked: the enemy answers at once. */
const answering = (skirmish: Skirmish): Skirmish => {
    const { ways: _ways, ...rest } = won(skirmish);
    return rest;
};

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

/** Open the setup screen's Customise and Advanced settings, where the enemy, the budget and the settings are. */
async function advanced(): Promise<void> {
    for (const id of ["#advanced", "#evolutionSettings"]) {
        if (!(await page.$eval(id, (details) => (details as HTMLDetailsElement).open))) await page.click(`${id} > summary`);
    }
}

/** Start the skirmish set up, which goes to the fleet editor, and come back to its round with this ship for a fleet. */
async function startWith(ship: Blueprint): Promise<void> {
    await page.click("#start");
    await page.waitForURL(/#\/fleet/);
    await page.waitForSelector("#fleetName");
    // How to build a fleet opens by itself the first time (checked where the fleet editor is).
    if (await page.isVisible("#fleetHelp")) await page.click("#fleetHelpClose");
    const kept = parseSkirmish(JSON.parse((await page.evaluate(() => localStorage.getItem("scs2d.skirmish")))!));
    await page.goto(skirmishPage({ ...kept, player: shipFleet(ship) }));
    await page.waitForSelector("#round");
}

describe("the skirmish in a browser", () => {
    it("opens on choosing an enemy, without errors", async () => {
        expect(await page.isVisible("#setupScreen")).toBe(true);
        // How a skirmish works, by itself the first time, then behind ? and its key.
        expect(await page.isVisible("#skirmishHelp")).toBe(true);
        await page.click("#skirmishHelpClose");
        expect(await page.isVisible("#skirmishHelp")).toBe(false);
        await page.click("#helpOpen");
        expect(await page.isVisible("#skirmishHelp")).toBe(true);
        await page.keyboard.press("Escape");
        expect(await page.isVisible("#skirmishHelp")).toBe(false);
        await page.keyboard.press("?");
        expect(await page.isVisible("#skirmishHelp")).toBe(true);
        await page.keyboard.press("Escape");
        expect(await page.evaluate(() => localStorage.getItem("scs2d.help.skirmish"))).toBe("seen");
        // A first skirmish is against one corvette: a gunship is too much to begin with.
        expect(await page.inputValue("#enemyPreset")).toBe("One small ship");
        expect(await page.inputValue("#enemy")).toBe("ship:Corvette");
        expect(await page.isVisible("#round")).toBe(false);
        expect(await page.textContent("#enemyBill")).toContain("metal");
        // No battle controls until there is a round; import sits under Start.
        expect(await page.locator("#play").count()).toBe(0);
        expect(await page.isVisible("#importSkirmish")).toBe(true);
        expect(problems).toEqual([]);
    });

    it("will not fight with a fleet over budget", async () => {
        await advanced();
        await page.selectOption("#enemy", "ship:Bare Core");
        await startWith(GUNSHIP);
        expect(await page.isVisible("#round")).toBe(true);
        expect(await page.isDisabled("#play")).toBe(true);
        expect(await page.isDisabled("#fight")).toBe(true);
        expect(await page.getAttribute("#editFleet", "data-variant")).toBe("primary");
        expect(await page.textContent("#fleetNote")).toContain("over budget");
        expect(await page.locator("#budget tr.over").count()).toBeGreaterThan(0);
        await page.click("#abandon");
        await page.click("#abandonConfirm");
        expect(await page.isVisible("#setupScreen")).toBe(true);
    });

    it("fights over the enemy's cost with a budget raised to fit, and matches the enemy again", async () => {
        await advanced();
        await page.selectOption("#enemy", "ship:Bare Core");
        const matched = await page.inputValue("#metalBudget");
        for (const id of ["metalBudget", "fuelBudget", "buildBudget"]) await page.fill(`#${id}`, "100000");
        await startWith(GUNSHIP);
        expect(await page.isDisabled("#play")).toBe(false);
        const kept = await page.evaluate(() => JSON.parse(window.localStorage.getItem("scs2d.skirmish")!));
        expect(kept.budget.metal).toBe(100_000_000);
        await page.click("#abandon");
        await page.click("#abandonConfirm");
        await advanced();
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
        await advanced();
        await set("quietTime", "45");
        await set("mutants", "2");
        await set("kindTank", "7");
        await set("maxShips", "5");
        await set("gapSpread", "1000");
        await page.selectOption("#enemy", "ship:Gunship");
        await startWith(GUNSHIP);
        const kept = await page.evaluate(() => JSON.parse(window.localStorage.getItem("scs2d.skirmish")!));
        expect(kept.settings.quietTime).toBe(45);
        expect(kept.settings.mutants).toBe(2);
        expect(kept.settings.breeding.kindTank).toBe(7);
        expect(kept.settings.maxShips).toBe(5);
        expect(kept.settings.gapSpread).toBe(1000);
        // Remembered for the next one, until a preset puts them back.
        await page.click("#abandon");
        await page.click("#abandonConfirm");
        await advanced();
        expect(await page.inputValue("#quietTime")).toBe("45");
        expect(await page.inputValue("#battlefieldPreset")).toBe("");
        await page.selectOption("#battlefieldPreset", "Open space");
        expect(await page.inputValue("#quietTime")).toBe(String(DEFAULT_SKIRMISH_SETTINGS.quietTime));
        expect(await page.inputValue("#mutants")).toBe(String(DEFAULT_SKIRMISH_SETTINGS.mutants));
        expect(await page.inputValue("#kindTank")).toBe(String(DEFAULT_KINDS.tank));
        expect(await page.inputValue("#gapSpread")).toBe("0");
        // The battlefield leaves the enemy's settings; the enemy's preset puts those back.
        expect(await page.inputValue("#maxShips")).toBe("5");
        await page.selectOption("#enemyPreset", "Bare core");
        expect(await page.inputValue("#maxShips")).toBe("3");
        expect(await page.inputValue("#radius")).toBe("500");
        expect(problems).toEqual([]);
    });

    it("sets up the enemy and the battlefield from the presets, each leaving the other's settings", async () => {
        await advanced();
        await page.selectOption("#enemyPreset", "One big ship");
        expect(await page.inputValue("#enemy")).toBe("ship:Gunship");
        expect(await page.inputValue("#maxShips")).toBe("1");
        await page.selectOption("#battlefieldPreset", "Small universe");
        expect(await page.inputValue("#gap")).toBe("800");
        expect(await page.inputValue("#timeCap")).toBe("400");
        expect(await page.inputValue("#maxShips")).toBe("1");
        expect(await page.inputValue("#enemyPreset")).toBe("One big ship");
        expect(await page.inputValue("#battlefieldPreset")).toBe("Small universe");
        expect(await page.getAttribute("#skirmishNameNew", "placeholder")).toBe("One big ship in a small universe");
        // Tinkering makes either custom; putting it back makes it the preset again.
        await page.fill("#gap", "900");
        await page.dispatchEvent("#gap", "change");
        expect(await page.inputValue("#battlefieldPreset")).toBe("");
        await page.fill("#gap", "800");
        await page.dispatchEvent("#gap", "change");
        expect(await page.inputValue("#battlefieldPreset")).toBe("Small universe");
        await page.selectOption("#enemy", "ship:Bare Core");
        expect(await page.inputValue("#enemyPreset")).toBe("");
        expect(await page.textContent("#enemyHint")).toBe("Against Bare Core, 1 ship a side at most");
        // An enemy fielding more than the limit keeps them; the player is held to it.
        await page.selectOption("#enemy", "fleet:Line of Battle");
        expect(await page.textContent("#enemyHint")).toBe("Against Line of Battle, which keeps its 5 ships; you may field 1");
        expect(problems).toEqual([]);
    });

    it("fights a round with a fleet that fits", async () => {
        await advanced();
        await page.selectOption("#enemy", "ship:Gunship");
        await startWith(GUNSHIP);
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
        await page.evaluate(() => localStorage.removeItem("scs2d.help.fleet"));
        await page.click("#editFleet");
        await page.waitForURL(/index\.html#\/fleet\?skirmish=/);
        await page.waitForSelector("#fleetName");
        // How to build a fleet, by itself the first time; Escape closes it without opening the menu.
        expect(await page.isVisible("#fleetHelp")).toBe(true);
        expect(await page.textContent("#fleetHelp")).toContain("inside the dashed circle");
        await page.keyboard.press("Escape");
        expect(await page.isVisible("#fleetHelp")).toBe(false);
        expect(await page.isVisible("#menuTitle")).toBe(false);
        expect(await page.evaluate(() => localStorage.getItem("scs2d.help.fleet"))).toBe("seen");
        // ? brings it back, beside the menu button and on its key.
        await page.click("#helpOpen");
        expect(await page.isVisible("#fleetHelp")).toBe(true);
        await page.click("#fleetHelpClose");
        await page.keyboard.press("?");
        expect(await page.isVisible("#fleetHelp")).toBe(true);
        await page.click("#fleetHelpClose");
        expect(await page.isVisible("#skirmish")).toBe(true);
        expect(await page.textContent("#skirmishTitle")).toBe("Skirmish — round 1");
        expect(await page.textContent("#skirmishBudget")).toContain("metal");
        expect(await page.inputValue("#fleetName")).toBe("Gunship");
        expect(await page.isVisible("#battleLink")).toBe(false);
        // A saved fleet is loaded from the menu here, not opened from the bar.
        expect(await page.locator("#fleet").count()).toBe(0);
        await page.click("#menuButton");
        expect(await page.isVisible("#loadFleet")).toBe(true);
        expect(await page.isVisible("#saveFleet")).toBe(true);
        expect(await page.locator("#newFleet").count()).toBe(0);
        await page.click("#resume");
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
        // The budget the fleet editor shows, without the enemy's column, which a design does not change.
        expect(await page.textContent("#skirmishBudget")).toContain("metal");
        expect(await page.textContent("#skirmishBudget")).not.toContain("Enemy");
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
        // Priced as it stands, so the figures move as it is built.
        expect(await page.textContent("#skirmishBudget")).toMatch(/metal\s*[1-9]/);
        expect(await page.textContent("#skirmishNote")).toBe("Fix the problems listed to fight.");
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
        await page.click("#menuButton");
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
        await page.click("#menuButton");
        await page.click("#exportSkirmish");
        expect((await savingNamed).suggestedFilename()).toBe("Bare-core-test-round-1.skirmish.json");

        // And read back after giving the skirmish up, it is the same round with the same history.
        await page.click("#abandon");
        await page.click("#abandonConfirm");
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

    it("gives the history the battle's room while the search is not watched", async () => {
        // Bare cores take a long while to answer a Gunship, so the search is still going throughout.
        const skirmish = answering(newSkirmish(shipFleet(BARE_CORE), shipFleet(GUNSHIP), 25));
        await page.goto(skirmishPage(skirmish));
        await page.waitForSelector("#answering");
        expect(await page.isVisible("#wideHistory")).toBe(false);
        expect(await page.isVisible("#history")).toBe(true);

        await page.click("#watchAnswer");
        expect(await page.isVisible("#wideHistory")).toBe(true);
        expect(await page.isVisible("#history")).toBe(false);
        expect(await page.locator("#wideHistory #timeline.wide").count()).toBe(1);

        await page.click("#watchAnswer");
        expect(await page.isVisible("#wideHistory")).toBe(false);
        expect(await page.isVisible("#history #timeline")).toBe(true);
        expect(problems).toEqual([]);
        await page.goto("about:blank");
    }, 60_000);

    it("watches the enemy evolve an answer to a round won, and goes on to the next round", async () => {
        // The player's Corvette beats the same Corvette on seed 25, and a mirror is answered in a generation or two.
        const skirmish = answering(newSkirmish(shipFleet(CORVETTE), shipFleet(CORVETTE), 25));
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
        await page.getByRole("button", { name: "Menu" }).click();
        await page.getByRole("button", { name: "Main menu" }).click();
        await page.getByRole("navigation", { name: "More" }).getByRole("link", { name: "Library" }).click();
        await page.waitForSelector("section[aria-label='Ships']");
        await page.waitForFunction(([key, was]) => localStorage.getItem(key!) !== was, [HISTORY_STORAGE_KEY, before] as const, {
            timeout: 180_000,
        });
        // The library's menu button goes straight back.
        await page.getByRole("button", { name: "Menu" }).click();
        await page.getByRole("link", { name: /^Continue/ }).click();
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
        expect(await page.isVisible("#enemyCards")).toBe(true);
        expect(await page.isVisible("#answering")).toBe(false);
        expect(await page.isVisible("#editFleet")).toBe(true);
        expect(await page.getAttribute("#fight", "data-variant")).toBe("primary");
        expect(problems).toEqual([]);
    }, 360_000);
});
