/// <reference lib="dom" />
// The callbacks handed to `page.evaluate` are serialised and run in the
// browser, so this file needs DOM types even though it executes in Node.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

/** Set a numeric field and tell the page it changed. */
async function set(p: Page, id: string, value: string): Promise<void> {
  await p.fill(`#${id}`, value);
  await p.dispatchEvent(`#${id}`, 'change');
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
  await page.selectOption('#founders', ['Dinky']);
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
  it('loads without errors', () => {
    expect(problems).toEqual([]);
  });

  it('fights a run and finishes it, without the page going away', async () => {
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
  }, 180_000);

  it('draws the run as lines rather than an empty box', async () => {
    expect(await distinctColours(page, 'chart')).toBeGreaterThan(4);
  });

  it('lists what it bred, and what each generation fought', async () => {
    expect(await rows(page, 'ships')).toBe(4);
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
    expect(problems).toEqual([]);
  }, 60_000);

  it('writes its settings to a file and reads them back', async () => {
    // The settings are the experiment, so what matters is that the file is a
    // faithful copy of the form and that reading one puts the form back where
    // it was — including the founders, which live in a list rather than a box.
    await set(page, 'seed', '4242');
    await set(page, 'kindTurret', '0');
    const saving = page.waitForEvent('download');
    await page.click('#exportConfig');
    const written = await (await saving).path();
    const file = JSON.parse(await readFile(written, 'utf8')) as Record<string, unknown>;
    expect(file['seed']).toEqual(4242);
    expect((file['kinds'] as Record<string, number>)['turret']).toEqual(0);
    expect(file['founders']).toEqual(['Dinky']);

    // Changed underneath, then read back: the import has to put every one of
    // these back rather than only the boxes somebody remembered to wire up.
    await set(page, 'seed', '1');
    await set(page, 'kindTurret', '9');
    await page.selectOption('#founders', ['Corvette']);
    await page.setInputFiles('#importConfigFile', written);
    await page.waitForFunction(() => document.getElementById('readout')?.textContent?.includes('read from a file') === true);
    expect(await page.inputValue('#seed')).toEqual('4242');
    expect(await page.inputValue('#kindTurret')).toEqual('0');
    expect(await page.evaluate(() =>
      [...(document.getElementById('founders') as HTMLSelectElement).selectedOptions].map((o) => o.value),
    )).toEqual(['Dinky']);
    expect(problems).toEqual([]);
  }, 60_000);

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

  it('shows the generation as ships rather than as a battle', async () => {
    // A run fights hundreds of times faster than real time, so a window on
    // the match in progress is a picture of nothing, refreshed. What the
    // space is for is the population: one tile per design, best first.
    await page.selectOption('#mode', 'fleet');
    await page.waitForTimeout(300);
    const tiles = await page.$$('#fleet figure');
    expect(tiles.length).toBe(4);
    const first = (await page.textContent('#fleet figure:first-child figcaption')) ?? '';
    expect(first).toMatch(/^1\. #\d/);
    // Drawn, rather than an empty box with a caption under it.
    const colours = await page.evaluate(() => {
      const canvas = document.querySelector('#fleet figure canvas') as HTMLCanvasElement;
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

  it('puts on another battle when one finishes', async () => {
    // A sample rather than a record: whole battles, one after another, which
    // is the thing watching the run live could never be.
    await page.selectOption('#mode', 'battle');
    await page.click('#matches tr');
    const progress = async (): Promise<number> =>
      Number(/(\d+)%/.exec((await page.textContent('#watching')) ?? '')?.[1] ?? -1);
    await page.waitForFunction(
      () => /9\d%|100%/.test(document.getElementById('watching')?.textContent ?? ''),
      undefined,
      { timeout: 60_000 },
    );
    // Back to the start of another one rather than sitting on the last frame
    // of that one for ever.
    await page.waitForFunction(
      () => {
        const at = /(\d+)%/.exec(document.getElementById('watching')?.textContent ?? '');
        return at !== null && Number(at[1]) < 50;
      },
      undefined,
      { timeout: 60_000 },
    );
    expect(await progress()).toBeLessThan(50);
    expect(problems).toEqual([]);
  }, 120_000);

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
    // while the thing under test has not happened yet.
    await page.waitForFunction(
      () => /beat it/.test(document.getElementById('yardstickLine')?.textContent ?? ''),
      undefined,
      { timeout: 120_000 },
    );
    expect(await page.getAttribute('#measure', 'disabled')).toBeNull();
    const line = (await page.textContent('#yardstickLine')) ?? '';
    expect(line).toMatch(/generation 1 scored -?\d/);
    expect(line).toMatch(/beat it/);
    expect(problems).toEqual([]);
  }, 180_000);

  it('hands the best of it to the editor', async () => {
    await page.click('#saveChampion');
    expect(await page.textContent('#championLine')).toMatch(/saved as/);
    const saved = await page.evaluate(() =>
      Object.keys(window.localStorage).filter((key) => key.startsWith('scs2d.blueprint.')),
    );
    expect(saved.length).toBeGreaterThan(0);
  });
});
