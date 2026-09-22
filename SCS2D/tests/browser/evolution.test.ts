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
  await set(page, 'group', '2');
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
    expect(await page.textContent('#championLine')).toMatch(/generation \d/);
  });

  it('fights a recorded match again, and draws it', async () => {
    await page.click('#matches tr');
    await page.waitForFunction(() => /replaying/.test(document.getElementById('watching')?.textContent ?? ''));
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

  it('hands the best of it to the editor', async () => {
    await page.click('#saveChampion');
    expect(await page.textContent('#championLine')).toMatch(/saved as/);
    const saved = await page.evaluate(() =>
      Object.keys(window.localStorage).filter((key) => key.startsWith('scs2d.blueprint.')),
    );
    expect(saved.length).toBeGreaterThan(0);
  });
});
