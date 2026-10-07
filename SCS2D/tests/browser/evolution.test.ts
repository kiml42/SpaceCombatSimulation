/// <reference lib="dom" />
// The callbacks handed to `page.evaluate` are serialised and run in the
// browser, so this file needs DOM types even though it executes in Node.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { Browser, Page } from 'playwright';
import { launchChromium } from './launch.js';

/**
 * The evolution page, driven in a real browser.
 *
 * What is being checked is that a run actually runs *on a page*: that the
 * work is sliced finely enough for the frame loop to keep going, that the
 * chart and the tables fill in as generations close, and that a match can be
 * fought again from what was recorded. None of that is reachable from a unit
 * test — the run loop and the replay are wiring, and wiring typechecks
 * perfectly while being connected to nothing.
 *
 * Not part of `npm test`: it needs a browser. `npm run test:browser`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const evolutionPage = join(root, 'dist', 'evolution.html');

let browser: Browser;
let page: Page;
const problems: string[] = [];

/** How many rows a table body is showing. */
async function rows(p: Page, id: string): Promise<number> {
  return p.evaluate((of) => document.getElementById(of)?.childElementCount ?? 0, id);
}

/**
 * Pixels on a canvas by hue band, for telling the sides apart.
 *
 * By hue rather than by the exact colour, because a ship far enough away to
 * be drawn as an icon is faded into the background and a hull is shaded — so
 * what survives of a side's palette on screen is which way round the wheel it
 * was, which is also the only thing a person is reading it for.
 */
async function hues(p: Page, id: string): Promise<Record<string, number>> {
  return p.evaluate((of) => {
    const bands: Record<string, number> = { red: 0, green: 0, blue: 0, magenta: 0 };
    const canvas = document.getElementById(of) as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return bands;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const high = Math.max(r, g, b);
      const low = Math.min(r, g, b);
      // Enough colour in it to be a side rather than the grey furniture.
      if (high - low < 30 || high < 40) continue;
      let hue: number;
      if (high === r) hue = (60 * ((g - b) / (high - low)) + 360) % 360;
      else if (high === g) hue = 60 * (2 + (b - r) / (high - low));
      else hue = 60 * (4 + (r - g) / (high - low));
      if (hue < 20 || hue > 340) bands['red']!++;
      else if (hue > 90 && hue < 170) bands['green']!++;
      else if (hue > 190 && hue < 265) bands['blue']!++;
      else if (hue > 280 && hue < 330) bands['magenta']!++;
    }
    return bands;
  }, id);
}

/** How many distinct colours a canvas is showing. Blank ones score 1. */
async function distinctColours(p: Page, id: string): Promise<number> {
  return p.evaluate((of) => {
    const canvas = document.getElementById(of) as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return 0;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 4) {
      seen.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!);
    }
    return seen.size;
  }, id);
}

/** Go to the screen the settings are on, if it is not already showing. */
async function toSetup(p: Page): Promise<void> {
  if (!(await p.isVisible('#setupScreen'))) await p.click('#toSetup');
}

/** Set a numeric field and tell the page it changed. */
async function set(p: Page, id: string, value: string): Promise<void> {
  await toSetup(p);
  await p.fill(`#${id}`, value);
  await p.dispatchEvent(`#${id}`, 'change');
}

/** Pick in one of the setup screen's lists. */
async function choose(p: Page, selector: string, values: Parameters<Page['selectOption']>[1]): Promise<void> {
  await toSetup(p);
  await p.selectOption(selector, values);
}

/** Press one of the setup screen's buttons. */
async function press(p: Page, selector: string): Promise<void> {
  await toSetup(p);
  await p.click(selector);
}

beforeAll(async () => {
  if (process.platform === 'win32') {
    await promisify(execFile)('cmd.exe', ['/c', 'npx', 'tsx', join(root, 'scripts', 'build.ts')], { cwd: root });
  } else {
    await promisify(execFile)('npx', ['tsx', join(root, 'scripts', 'build.ts')], { cwd: root });
  }
  expect(existsSync(evolutionPage)).toBe(true);

  browser = await launchChromium();
  page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  await page.goto(pathToFileURL(evolutionPage).href);
  await page.waitForSelector('#start');

  // A run small enough to finish inside a test: two short matches' worth of
  // ships, two generations, and as much of each frame as the page will spend.
  await choose(page, '#founders', ['Dinky']);
  // Kept a run of ships; the fleet test lets them grow.
  await set(page, 'fleetShips', '1');
  await set(page, 'generations', '2');
  await set(page, 'population', '4');
  await set(page, 'winners', '2');
  await set(page, 'group', '4');
  await set(page, 'minMatches', '1');
  await set(page, 'duration', '10');
  await set(page, 'effort', '100');
}, 180_000);

afterAll(async () => {
  await browser?.close();
});

describe('the evolution page in a browser', () => {
  // The run's screen whenever there is a run, as there is after Start; a test
  // that changes the settings goes to them through `set`, `choose` and `press`.
  beforeEach(async () => {
    if ((await page.isEnabled('#toRun')) && !(await page.isVisible('#results'))) await page.click('#toRun');
  });

  it('loads without errors', () => {
    expect(problems).toEqual([]);
  });

  it('previews the founders, and the first match paused at its start, before a run', async () => {
    await page.selectOption('#mode', 'fleet');
    await page.waitForFunction(() => document.querySelectorAll('#fleet tbody tr').length === 1);
    expect(await page.textContent('#fleet tbody td.who b')).toBe('Dinky');
    // Named for what it is made of, which for a ship founder is itself.
    expect(await page.textContent('#fleet tbody td.made .of')).toBe('Dinky');
    // Nothing has been scored yet, so the figures are dashes.
    expect(await page.textContent('#fleet tbody td.score')).toBe('');
    await page.selectOption('#mode', 'battle');
    await page.waitForFunction(() => /unmutated/.test(document.getElementById('watching')?.textContent ?? ''));
    // Polled: the label and the picture are drawn on different beats, so the label can come first.
    await expect.poll(() => distinctColours(page, 'view')).toBeGreaterThan(2);
    await page.selectOption('#mode', 'fleet');
    expect(problems).toEqual([]);
  });

  it('fights a run and finishes it, without the page going away', async () => {
    // Started with a battle showing, which has nothing to show until the
    // first match is over and must then put it on.
    await page.selectOption('#mode', 'battle');
    await page.click('#start');
    // The frame loop is what advances the run, so a page that blocked would
    // fail here rather than merely being slow: `waitForFunction` is polled
    // through the same event loop the run is being sliced into.
    await page.waitForFunction(
      () => document.getElementById('state')?.textContent === 'finished',
      undefined,
      { timeout: 120_000 },
    );
    expect(problems).toEqual([]);
    expect(await page.textContent('#readout')).toMatch(/matches fought/);
    await page.waitForFunction(() => /\d+%|over/.test(document.getElementById('watching')?.textContent ?? ''));
  }, 180_000);

  it('draws the run as lines rather than an empty box', async () => {
    expect(await distinctColours(page, 'chart')).toBeGreaterThan(4);
    // And what each generation weighed, under it.
    expect(await distinctColours(page, 'massChart')).toBeGreaterThan(2);
  });

  it('lists what it bred, and what each generation fought', async () => {
    // Every combatant and everything known about it is a row of the
    // combatants table: the sidebar no longer carries a copy of the figures.
    await page.selectOption('#mode', 'fleet');
    await page.waitForFunction(() => document.querySelectorAll('#fleet tbody tr').length === 4);
    expect(await page.locator('#fleet tbody tr.champion').count()).toBe(1);
    // Score, its five parts, and the tonnage, all on the row.
    const best = page.locator('#fleet tbody tr').first();
    expect(await best.locator('td.score').textContent()).toMatch(/^\d\.\d{3}$/);
    expect(await best.locator('td.part .hull, td.part .func, td.part .dmg, td.part .dis, td.part .grnd').count()).toBe(5);
    expect(await best.locator('td.mass').textContent()).toMatch(/^\d+\.\d$/);
    // And what was done to make it, which used to be a line in the sidebar.
    expect((await best.locator('td.done').textContent())?.length).toBeGreaterThan(0);
    expect(await rows(page, 'matches')).toBeGreaterThan(0);
    expect(await page.textContent('#championLine')).toMatch(/best of generation \d/);
  });

  it('fights a recorded match again, and draws it', async () => {
    // Clicking a match is a request to watch one, so it switches the panel
    // over from the ships to the battle.
    await page.click('#matches tr');
    expect(await page.inputValue('#mode')).toBe('battle');
    await page.waitForFunction(() => /\d+%/.test(document.getElementById('watching')?.textContent ?? ''));
    await page.waitForTimeout(500);
    expect(await distinctColours(page, 'view')).toBeGreaterThan(3);
    // A replay is the page's own clock, so it pauses and single-steps like
    // the viewer does.
    await page.click('#play');
    expect(await page.textContent('#play')).toBe('Play');
    // The readout is sampled a few times a second rather than every frame, so
    // what it says is read after the next sample rather than on the click.
    await page.waitForTimeout(300);
    const held = await page.textContent('#watching');
    await page.waitForTimeout(400);
    expect(await page.textContent('#watching')).toBe(held);
    // Each side's score so far, named by the individual flying it.
    expect(await page.isHidden('#battleScores')).toBe(false);
    const sides = await page.$$eval('#battleScores tr td:first-child', (cells) => cells.map((cell) => cell.textContent));
    const clicked = ((await page.textContent('#matches tr.watched td:nth-child(2)')) ?? '').split(' ');
    expect(sides).toEqual(clicked.map((id) => `#${id}`));
    expect(problems).toEqual([]);
  }, 60_000);

  it('writes its settings to a file and reads them back', async () => {
    // The settings are the experiment, so what matters is that the file is a
    // faithful copy of the form and that reading one puts the form back where
    // it was — including the founders, which live in a list rather than a box.
    await set(page, 'seed', '4242');
    await set(page, 'kindTurret', '0');
    const saving = page.waitForEvent('download');
    await press(page, '#exportConfig');
    const written = await (await saving).path();
    const file = JSON.parse(await readFile(written, 'utf8')) as Record<string, unknown>;
    expect(file['seed']).toEqual(4242);
    expect((file['kinds'] as Record<string, number>)['turret']).toEqual(0);
    expect(file['founders']).toEqual(['Dinky']);

    // Changed underneath, then read back: the import has to put every one of
    // these back rather than only the boxes somebody remembered to wire up.
    await set(page, 'seed', '1');
    await set(page, 'kindTurret', '9');
    await choose(page, '#founders', ['Corvette']);
    await page.setInputFiles('#importConfigFile', written);
    await page.waitForFunction(() => document.getElementById('readout')?.textContent?.includes('read from a file') === true);
    expect(await page.inputValue('#seed')).toEqual('4242');
    expect(await page.inputValue('#kindTurret')).toEqual('0');
    expect(await page.evaluate(() =>
      [...(document.getElementById('founders') as HTMLSelectElement).selectedOptions].map((o) => o.value),
    )).toEqual(['ship:Dinky']);
    expect(problems).toEqual([]);
  }, 60_000);

  it('folds a section away, and writes the doctrine weights with the rest', async () => {
    await toSetup(page);
    await page.click('details[data-key="therun"] > summary');
    expect(await page.isVisible('#generations')).toBe(false);
    await page.click('details[data-key="therun"] > summary');
    expect(await page.isVisible('#generations')).toBe(true);

    await set(page, 'doctrineApproach', '0');
    const saving = page.waitForEvent('download');
    await press(page, '#exportConfig');
    const file = JSON.parse(await readFile(await (await saving).path(), 'utf8')) as Record<string, unknown>;
    expect(file['doctrine']).toEqual({ targeting: 1, approach: 0, escort: 1, avoidance: 1, gunnery: 1 });
    await set(page, 'doctrineApproach', '1');
    expect(problems).toEqual([]);
  });

  it('names the exported file after the settings, and keeps the build weights', async () => {
    await set(page, 'configName', 'Star Wars tuning');
    await set(page, 'structural', '0');
    await set(page, 'buildMove', '0');
    // The shape weight is the switch a run uses to keep every module a box, so
    // it has to survive the round trip like any other.
    await set(page, 'buildShape', '0');
    const saving = page.waitForEvent('download');
    await press(page, '#exportConfig');
    const download = await saving;
    expect(download.suggestedFilename()).toEqual('Star_Wars_tuning.json');
    const written = await download.path();
    const file = JSON.parse(await readFile(written, 'utf8')) as Record<string, unknown>;
    expect(file['name']).toEqual('Star Wars tuning');
    expect(file['structural']).toEqual(0);
    expect((file['build'] as Record<string, number>)['move']).toEqual(0);
    expect((file['build'] as Record<string, number>)['shape']).toEqual(0);

    await set(page, 'configName', '');
    await set(page, 'structural', '0.3');
    await set(page, 'buildMove', '1');
    await set(page, 'buildShape', '1');
    await page.setInputFiles('#importConfigFile', written);
    await page.waitForFunction(() => (document.getElementById('configName') as HTMLInputElement).value !== '');
    expect(await page.inputValue('#configName')).toEqual('Star Wars tuning');
    expect(await page.inputValue('#structural')).toEqual('0');
    expect(await page.inputValue('#buildMove')).toEqual('0');
    expect(await page.inputValue('#buildShape')).toEqual('0');
    await set(page, 'configName', '');
    await set(page, 'structural', '0.3');
    await set(page, 'buildMove', '1');
    await set(page, 'buildShape', '1');
    expect(problems).toEqual([]);
  });

  it('draws a third and fourth side in colours of their own', async () => {
    // A match is a free-for-all, so four entrants are four sides — and two of
    // them are sides the renderer only ever had to draw once evolution
    // existed. Checked by hue rather than by counting colours, because a
    // fourth palette that was quietly the neutral grey would raise a count by
    // nothing anyone would notice.
    await page.click('#fit');
    await page.waitForTimeout(400);
    const bands = await hues(page, 'view');
    for (const band of ['red', 'green', 'blue', 'magenta']) {
      expect(bands[band], `${band} in ${JSON.stringify(bands)}`).toBeGreaterThan(0);
    }
  }, 60_000);

  it('reads a generation off the chart, and selects it when clicked', async () => {
    // The chart is the only place a run's whole history is visible, so it is
    // the natural way in to a generation — pointing at one says what it
    // scored, and clicking it takes the rest of the page there.
    const box = await page.locator('#chart').boundingBox();
    if (box === null) throw new Error('no chart on the page');
    // Well inside the plot, whose left edge is the y-axis labels' width in.
    await page.mouse.move(box.x + box.width * 0.85, box.y + box.height / 2);
    await page.waitForFunction(() => document.getElementById('chartTip')?.hidden === false);
    expect(await page.textContent('#chartTip')).toMatch(/^generation \d+$/);
    // The legend gains a reading per line while a generation is under it.
    expect(await page.$$eval('#legend b', (all) => all.length)).toBeGreaterThan(0);

    const named = /generation (\d+)/.exec((await page.textContent('#chartTip')) ?? '');
    await page.mouse.click(box.x + box.width * 0.85, box.y + box.height / 2);
    await page.waitForTimeout(300);
    expect(await page.textContent('#shownGeneration')).toBe(named?.[1]);
    // Pinned to that generation now, so the way back to the newest is offered.
    expect(await page.getAttribute('#latest', 'disabled')).toBeNull();

    // And nothing under the pointer once it leaves.
    await page.mouse.move(box.x + box.width / 2, box.y - 40);
    await page.waitForFunction(() => document.getElementById('chartTip')?.hidden === true);
    expect(problems).toEqual([]);
  }, 60_000);

  it('seeks through the generations while the pointer is held down', async () => {
    // Dragging across the chart is meant to read as the ships changing over
    // the run, so the panel has to follow the pointer rather than wait for it
    // to be let go.
    const box = await page.locator('#chart').boundingBox();
    if (box === null) throw new Error('no chart on the page');
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.9, y);
    await page.mouse.down();
    await page.waitForTimeout(200);
    const late = await page.textContent('#shownGeneration');

    // Still held, dragged back to the start of the run.
    await page.mouse.move(box.x + box.width * 0.2, y, { steps: 8 });
    await page.waitForTimeout(200);
    const early = await page.textContent('#shownGeneration');
    expect(Number(early)).toBeLessThan(Number(late));

    // Past the left-hand end, which means the first generation rather than
    // the seek stopping where the canvas does.
    await page.mouse.move(box.x - 200, y, { steps: 4 });
    await page.waitForTimeout(200);
    expect(await page.textContent('#shownGeneration')).toBe('1');
    await page.mouse.up();

    // Let go, and the panel stays where it was left.
    await page.waitForTimeout(200);
    expect(await page.textContent('#shownGeneration')).toBe('1');

    // "Latest" is the way back to the newest generation, and to following it.
    await page.click('#latest');
    await page.waitForTimeout(300);
    expect(await page.textContent('#shownGeneration')).not.toBe('1');
    // Following the newest again, so there is nowhere to go back to.
    expect(await page.getAttribute('#latest', 'disabled')).not.toBeNull();
    expect(problems).toEqual([]);
  }, 60_000);

  it('shows the generation as ships rather than as a battle', async () => {
    // A run fights hundreds of times faster than real time, so a window on
    // the match in progress is a picture of nothing, refreshed. What the
    // space is for is the population: one tile per design, best first.
    await page.selectOption('#mode', 'fleet');
    await page.waitForTimeout(300);
    const rows = await page.$$('#fleet tbody tr');
    expect(rows.length).toBe(4);
    const first = (await page.textContent('#fleet tbody td.who')) ?? '';
    expect(first).toMatch(/^1\. #\d/);
    // Drawn, rather than an empty box with a name under it.
    const colours = await page.evaluate(() => {
      const canvas = document.querySelector('#fleet .kind canvas') as HTMLCanvasElement;
      const ctx = canvas.getContext('2d');
      if (ctx === null) return 0;
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const seen = new Set<number>();
      for (let i = 0; i < data.length; i += 4) {
        seen.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!);
      }
      return seen.size;
    });
    expect(colours).toBeGreaterThan(2);
    expect(problems).toEqual([]);
  }, 60_000);

  it('follows a battle with the newest one, and holds when there is none newer', async () => {
    // A sample rather than a record: whole battles, each the latest the run
    // has fought when the one before it ends, whichever generation is on show.
    const box = await page.locator('#chart').boundingBox();
    if (box === null) throw new Error('no chart on the page');
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.2, y);
    await page.mouse.down();
    await page.mouse.move(box.x - 200, y, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    expect(await page.textContent('#shownGeneration')).toBe('1');

    await page.selectOption('#mode', 'battle');
    // The list names a match's competitors by id, and the label joins them with "v".
    const clicked = ((await page.textContent('#matches tr td:nth-child(2)')) ?? '').split(' ').join(' v ');
    await page.click('#matches tr');
    const who = async (): Promise<string> =>
      ((await page.textContent('#watching')) ?? '').split(' · ')[0] ?? '';
    await page.waitForFunction(
      (name) => (document.getElementById('watching')?.textContent ?? '').startsWith(name),
      clicked,
    );
    const first = await who();
    // Generation one's match plays out, and the run's newest follows it.
    await page.waitForFunction(
      (was) => {
        const text = document.getElementById('watching')?.textContent ?? '';
        return text.split(' · ')[0] !== was;
      },
      first,
      { timeout: 90_000 },
    );
    const newest = await who();
    // Which, once it is over, is watched to its end and left there: nothing
    // newer has finished, and replaying the same one again shows nothing new.
    await page.waitForFunction(
      () => /over/.test(document.getElementById('watching')?.textContent ?? ''),
      undefined,
      { timeout: 90_000 },
    );
    await page.waitForTimeout(500);
    expect(await who()).toBe(newest);
    expect(await page.textContent('#watching')).toMatch(/over/);

    await page.click('#latest');
    expect(problems).toEqual([]);
  }, 200_000);

  it('measures every generation against one fixed ship', async () => {
    // The one number on the page that means the same thing at both ends of a
    // run: fitness is scored against the rest of the generation, so it says
    // nothing across generations, and a population that learns to fly before
    // it learns to shoot scores superbly until guns appear and less
    // afterwards while getting better.
    await page.selectOption('#benchmark', 'Dinky');
    await page.click('#measure');
    // Waited on the line rather than the button, because the line is what
    // this asserts about — and a wait on something else is a wait that passes
    // while the thing under test has not happened yet. It says "beat it"
    // while still measuring too, so the wait is for it to stop saying so.
    await page.waitForFunction(
      () => {
        const text = document.getElementById('yardstickLine')?.textContent ?? '';
        return /beat it/.test(text) && !/measuring/.test(text);
      },
      undefined,
      { timeout: 120_000 },
    );
    expect(await page.getAttribute('#measure', 'disabled')).toBeNull();
    const line = (await page.textContent('#yardstickLine')) ?? '';
    expect(line).toMatch(/generation 1 scored -?\d/);
    expect(line).toMatch(/beat it/);
    expect(problems).toEqual([]);
  }, 180_000);

  it('remembers a measurement, and gives it again without fighting it again', async () => {
    const before = await page.textContent('#yardstickLine');
    await page.click('#measure');
    // Every generation is already measured against this opponent, so it is
    // over at the next frame rather than after another minute of battles.
    await page.waitForFunction(() => document.getElementById('measure')?.hasAttribute('disabled') === false, undefined, {
      timeout: 5_000,
    });
    expect(await page.textContent('#yardstickLine')).toBe(before);
    expect(problems).toEqual([]);
  });

  it('shows a design fighting the yardstick, as the measurement fought it', async () => {
    await page.click('#watchYardstick');
    expect(await page.inputValue('#mode')).toBe('battle');
    await page.waitForFunction(() => / v Dinky · \d+%/.test(document.getElementById('watching')?.textContent ?? ''));
    const sides = await page.$$eval('#battleScores tr td:first-child', (cells) => cells.map((cell) => cell.textContent));
    expect(sides).toHaveLength(2);
    expect(sides[0]).toMatch(/^#\d+$/);
    expect(sides[1]).toBe('Dinky');
    // Back to the ships, so the tests after this find the page as they expect.
    await page.selectOption('#mode', 'fleet');
    expect(problems).toEqual([]);
  }, 60_000);

  it('hands the best of it to the editor', async () => {
    await page.click('#saveChampion');
    expect(await page.textContent('#championLine')).toMatch(/saved as/);
    const saved = await page.evaluate(() =>
      Object.keys(window.localStorage).filter((key) => key.startsWith('scs2d.blueprint.')),
    );
    expect(saved.length).toBeGreaterThan(0);
  });
  it('draws every ship in a generation at one scale, so sizes compare', async () => {
    // A Dinky and a corvette in one generation: fitted each to its own tile
    // they would fill it alike, and at one scale the corvette is far bigger.
    if (await page.isEnabled('#stop')) await page.click('#stop');
    await choose(page, '#founders', ['Dinky', 'Corvette']);
    await set(page, 'generations', '1');
    await page.click('#start');
    await page.selectOption('#mode', 'fleet');
    await page.waitForFunction(() => document.querySelectorAll('#fleet tbody tr').length >= 2);
    // Long enough for the shared scale to settle.
    await page.waitForTimeout(1500);
    const widths = await page.evaluate(() =>
      [...document.querySelectorAll('#fleet .kind canvas')].map((node) => {
        const canvas = node as HTMLCanvasElement;
        const ctx = canvas.getContext('2d');
        if (ctx === null) return 0;
        const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        // The ship is whatever differs from the corner's background.
        const bg = [data[0], data[1], data[2]];
        let lo = width;
        let hi = -1;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const d = Math.abs(data[i]! - bg[0]!) + Math.abs(data[i + 1]! - bg[1]!) + Math.abs(data[i + 2]! - bg[2]!);
            if (d > 60) {
              lo = Math.min(lo, x);
              hi = Math.max(hi, x);
            }
          }
        }
        return hi - lo;
      }),
    );
    expect(Math.min(...widths)).toBeGreaterThan(0);
    expect(Math.max(...widths) / Math.min(...widths)).toBeGreaterThan(2);
    expect(problems).toEqual([]);
  }, 60_000);

  it('draws the whole fleet beside its kinds, on a scale of its own', async () => {
    // Two scales, each shared across the rows: formations compare with
    // formations and hulls with hulls. One scale for both would put a
    // formation a kilometre across and a hull ten metres long on the same
    // ruler, and whichever it suited the other would be a dot or a smear.
    await page.waitForFunction(() => document.querySelectorAll('#fleet tbody tr').length >= 2);
    await page.waitForTimeout(1500);
    const drawn = await page.evaluate(() => {
      const ink = (node: Element): number => {
        const canvas = node as HTMLCanvasElement;
        const ctx = canvas.getContext('2d');
        if (ctx === null) return 0;
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const bg = [data[0], data[1], data[2]];
        let lit = 0;
        for (let i = 0; i < data.length; i += 4) {
          const d =
            Math.abs(data[i]! - bg[0]!) + Math.abs(data[i + 1]! - bg[1]!) + Math.abs(data[i + 2]! - bg[2]!);
          if (d > 60) lit++;
        }
        return lit;
      };
      const rows = [...document.querySelectorAll('#fleet tbody tr')];
      return {
        rows: rows.length,
        formations: rows.map((tr) => tr.querySelectorAll('td.formation canvas').length),
        litFormations: rows.filter((tr) => ink(tr.querySelector('td.formation canvas')!) > 0).length,
      };
    });
    // One per row, and every one of them actually drawn.
    expect(drawn.formations.every((n) => n === 1)).toBe(true);
    expect(drawn.litFormations).toBe(drawn.rows);
    expect(problems).toEqual([]);
  }, 60_000);
  it('skips a match nobody wants to watch, and puts another on', async () => {
    // Most of what a run fights is not worth watching — two ships that
    // cannot steer drifting apart until the clock runs out — and the page
    // otherwise had no way out of one but to sit through it.
    if (await page.isEnabled('#stop')) await page.click('#stop');
    await choose(page, '#founders', ['Dinky']);
    await set(page, 'group', '2');
    await set(page, 'minMatches', '2');
    await set(page, 'generations', '1');
    await page.click('#start');
    await page.waitForFunction(() => document.querySelectorAll('#matches tr').length > 1);
    await page.selectOption('#mode', 'battle');
    await page.click('#matches tr');
    const who = async (): Promise<string> =>
      ((await page.textContent('#watching')) ?? '').split(' \u00b7 ')[0] ?? '';
    await page.waitForFunction(() => /%/.test(document.getElementById('watching')?.textContent ?? ''));
    const first = await who();

    await page.click('#skip');
    await page.waitForFunction(
      (was) => (document.getElementById('watching')?.textContent ?? '').split(' \u00b7 ')[0] !== was,
      first,
      { timeout: 30_000 },
    );
    expect(await who()).not.toBe(first);
    await set(page, 'group', '4');
    await set(page, 'minMatches', '1');
    expect(problems).toEqual([]);
  }, 60_000);

  it('drives a battle from the keyboard, as the viewer does', async () => {
    // The same keys as the viewer page, because it is the same battle in the
    // same canvas — and single-stepping is the only way to read a fight
    // closely. The page is mostly a form, so they are off while a box has
    // the focus.
    if (await page.isEnabled('#stop')) await page.click('#stop');
    await choose(page, '#founders', ['Dinky']);
    await set(page, 'generations', '1');
    await page.click('#start');
    await page.waitForFunction(() => document.querySelectorAll('#matches tr').length > 0);
    await page.selectOption('#mode', 'battle');
    await page.click('#matches tr');
    await page.waitForFunction(() => /%/.test(document.getElementById('watching')?.textContent ?? ''));

    // A number box has the focus, so the keys belong to it rather than to
    // the battle: the full stop is part of a figure somebody is typing.
    await toSetup(page);
    await page.focus('#duration');
    await page.keyboard.press('Space');
    expect(await page.textContent('#play')).toBe('Pause');
    await page.click('#toRun');
    await page.locator('#view').click({ position: { x: 5, y: 5 } });

    // Space pauses, and the battle stops where it was.
    await page.keyboard.press('Space');
    expect(await page.textContent('#play')).toBe('Play');
    await page.waitForTimeout(300);
    const held = await page.textContent('#watching');
    await page.waitForTimeout(400);
    expect(await page.textContent('#watching')).toBe(held);

    // A full stop advances it one step, which is a step of simulation
    // rather than a frame — so it is read off the progress the label gives.
    const progress = async (): Promise<number> =>
      Number(/(\d+)%/.exec((await page.textContent('#watching')) ?? '')?.[1] ?? '-1');
    const before = await progress();
    for (let i = 0; i < 200; i++) await page.keyboard.press('.');
    await page.waitForTimeout(300);
    expect(await progress()).toBeGreaterThan(before);
    expect(await page.textContent('#play')).toBe('Play');

    // And space again sets it going.
    await page.keyboard.press('Space');
    expect(await page.textContent('#play')).toBe('Pause');
    expect(problems).toEqual([]);
  }, 60_000);

  it('replays a match of one ship', async () => {
    if (await page.isEnabled('#stop')) await page.click('#stop');
    await choose(page, '#founders', ['Dinky']);
    await set(page, 'group', '1');
    await set(page, 'generations', '1');
    await page.click('#start');
    await page.waitForFunction(() => document.querySelectorAll('#matches tr').length > 0);
    await page.selectOption('#mode', 'battle');
    await page.click('#matches tr');
    // A match being watched says who is in it and how far through it is.
    await page.waitForFunction(() => /%/.test(document.getElementById('watching')?.textContent ?? ''));
    expect(await page.textContent('#watching')).not.toMatch(/pick a match/);
    await set(page, 'group', '4');
    expect(problems).toEqual([]);
  }, 60_000);

  it('runs from a fleet, with its limits, and replays a match of fleets', async () => {
    if (await page.isEnabled('#stop')) await page.click('#stop');
    // A ship limited to one ship stays a ship; allowed more, it may grow into a fleet.
    await choose(page, '#founders', ['Dinky']);
    expect(await page.isVisible('#fleetRadius')).toBe(false);
    expect(await page.isVisible('#opAdd')).toBe(false);
    await set(page, 'fleetShips', '2');
    expect(await page.isVisible('#opAdd')).toBe(true);
    await set(page, 'fleetShips', '1');
    // So does picking a fleet, whatever the limit.
    await choose(page, '#founders', [{ label: 'Line of Battle' }]);
    expect(await page.isVisible('#fleetRadius')).toBe(true);
    expect(await page.isVisible('#opAdd')).toBe(true);
    await set(page, 'fleetRadius', '400');
    await set(page, 'fleetShips', '8');
    await set(page, 'opAdd', '3');
    await set(page, 'group', '2');
    await set(page, 'generations', '1');

    const saving = page.waitForEvent('download');
    await press(page, '#exportConfig');
    const file = JSON.parse(await readFile(await (await saving).path(), 'utf8')) as Record<string, unknown>;
    expect(file['fleets']).toEqual(['Line of Battle']);
    expect(file['fleet']).toMatchObject({ radius: 400, maxShips: 8, operators: { add: 3 } });

    await page.click('#start');
    await page.selectOption('#mode', 'fleet');
    // The composition, which is what a fleet run is shown by: several kinds
    // of ship on one row, rather than one picture of the whole fleet.
    await page.waitForFunction(
      () => [...document.querySelectorAll('#fleet tbody tr')].some((tr) => tr.querySelectorAll('.kind').length > 1),
    );
    await page.waitForFunction(() => document.querySelectorAll('#matches tr').length > 0, undefined, { timeout: 60_000 });
    await page.selectOption('#mode', 'battle');
    await page.click('#matches tr');
    await page.waitForFunction(() => /%/.test(document.getElementById('watching')?.textContent ?? ''));
    await set(page, 'group', '4');
    expect(problems).toEqual([]);
  }, 120_000);
  it('co-evolves two lineages against each other, and shows both', async () => {
    if (await page.isEnabled('#stop')) await page.click('#stop');
    await choose(page, '#founders', ['Dinky']);
    await set(page, 'fleetShips', '1');
    await set(page, 'generations', '2');
    await set(page, 'population', '4');
    await set(page, 'minMatches', '2');
    await set(page, 'group', '2');
    await choose(page, '#versus', ['Dinky']);
    // No goal, scored against a moving opponent: what does not apply goes.
    expect(await page.isVisible('#goal')).toBe(false);
    // Side B has a column of settings of its own, starting as a copy of side A's.
    expect(await page.isVisible('#b_population')).toBe(true);
    expect(await page.inputValue('#b_population')).toBe('4');
    await set(page, 'b_population', '6');
    // Two of side A against one of side B each match.
    expect(await page.inputValue('#b_group')).toBe('2');
    await set(page, 'b_group', '1');

    const saving = page.waitForEvent('download');
    await press(page, '#exportConfig');
    const file = JSON.parse(await readFile(await (await saving).path(), 'utf8')) as Record<string, unknown>;
    expect(file['versus']).toMatchObject({ founders: ['Dinky'], population: 6, group: 1 });

    // Side B fixed is side A bred against an opponent that does not change.
    await toSetup(page);
    await page.uncheck('#rivalEvolves');
    const fixing = page.waitForEvent('download');
    await press(page, '#exportConfig');
    const fixed = JSON.parse(await readFile(await (await fixing).path(), 'utf8')) as Record<string, unknown>;
    expect(fixed['versus']).toMatchObject({ evolves: false });
    await page.check('#rivalEvolves');

    await page.click('#start');
    await page.waitForFunction(
      () => document.getElementById('state')?.textContent === 'finished',
      undefined,
      { timeout: 120_000 },
    );
    // On the run screen: the score chart is not drawn for a run scored against a moving opponent.
    expect(await page.isVisible('#setupScreen')).toBe(false);
    expect(await page.isVisible('#chart')).toBe(false);
    expect(await page.isVisible('#legend')).toBe(false);
    await page.selectOption('#mode', 'fleet');
    const sides = await page.$$eval('#fleet tbody td.who .side', (tags) => tags.map((tag) => tag.textContent?.trim()));
    expect(sides.filter((side) => side === 'A')).toHaveLength(4);
    expect(sides.filter((side) => side === 'B')).toHaveLength(6);
    // A's table on the left, B's on the right, and every row one height whatever is in it.
    const tables = await page.$$eval('#fleet table', (all) =>
      all.map((table) => ({
        left: table.getBoundingClientRect().left,
        side: table.querySelector('td.who .side')?.textContent?.trim(),
      })),
    );
    expect(tables.map((table) => table.side)).toEqual(['A', 'B']);
    expect(tables[1]!.left).toBeGreaterThan(tables[0]!.left);
    const heights = await page.$$eval('#fleet tbody tr', (rows) => rows.map((tr) => tr.getBoundingClientRect().height));
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1.5);
    expect(await distinctColours(page, 'massChart')).toBeGreaterThan(2);
    expect(await page.textContent('#championLine')).toMatch(/A #\d+.*B #\d+/);
    // Measured as a grid of each side's champions against the other's.
    await page.click('#measure');
    await page.waitForFunction(() => /matches, \d+ a cell/.test(document.getElementById('yardstickLine')?.textContent ?? ''), undefined, {
      timeout: 60_000,
    });
    expect(await page.isVisible('#grid')).toBe(true);
    expect(await page.$$eval('#grid td', (cells) => cells.map((td) => td.textContent))).toEqual(
      expect.arrayContaining([expect.stringMatching(/^\d\/3$/)]),
    );
    expect(await page.locator('#grid td').count()).toBe(4);

    await page.selectOption('#mode', 'battle');
    // Two of A against one of B, each side by its letter, and who won it if it was decided.
    expect(await page.textContent('#matches tr')).toMatch(/^1A \d+ \d+ v B \d+(decided|A won|B won|annihilated|timeout)/);
    const endings = await page.$$eval('#matches tr td:nth-child(3)', (cells) => cells.map((td) => td.textContent));
    expect(endings.every((text) => text === 'A won' || text === 'B won' || text === 'annihilated' || text === 'timeout')).toBe(true);
    await page.click('#matches tr');
    await page.waitForFunction(() => /%/.test(document.getElementById('watching')?.textContent ?? ''));

    await press(page, '#clearVersus');
    expect(await page.isVisible('#b_population')).toBe(false);
    await page.click('#toRun');
    expect(await page.isVisible('#chart')).toBe(true);
    expect(await page.isVisible('#legend')).toBe(true);
    expect(problems).toEqual([]);
  }, 180_000);
});
