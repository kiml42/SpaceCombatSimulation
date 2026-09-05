/// <reference lib="dom" />
// The callbacks handed to `page.evaluate` are serialised and run in the
// browser, so this one file needs DOM types even though it executes in Node.
// Scoped to the file rather than the project: a unit test that reached for
// `document` should still be a compile error.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { Browser, Page } from 'playwright';
import { launchChromium } from './launch.js';

/**
 * The viewer, driven in a real browser.
 *
 * These check the things types and unit tests cannot: that the page runs
 * without throwing, that the renderer actually puts pixels on the canvas, and
 * that the controls do what they say. A renderer can typecheck perfectly and
 * draw a black rectangle.
 *
 * What they deliberately do *not* check is that the simulation is right. The
 * viewer and the golden `duel` run the same code by construction — that is why
 * `scenarios/duel.ts` exists — so re-verifying the physics through a browser
 * would be slow and would prove nothing the checksum does not.
 *
 * Not part of `npm test`: they need a browser, and the unit suite has to stay
 * runnable from a cold checkout on any machine. `npm run test:browser`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const page404 = join(root, 'dist', 'index.html');

let browser: Browser;
let page: Page;
const problems: string[] = [];

/**
 * Wait for the page to paint.
 *
 * The readout is written inside the animation frame, so a control's effect is
 * visible on the *next* frame rather than on the click. That is correct — a
 * user sees the change when the page next draws — so the test waits for a
 * frame rather than the page reporting eagerly.
 */
async function painted(p: Page): Promise<void> {
  await p.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/** Steps reported by the page's readout. */
async function step(p: Page): Promise<number> {
  const text = (await p.textContent('#readout')) ?? '';
  const match = /step (\d+)/.exec(text);
  if (match === null) throw new Error(`no step in readout: ${JSON.stringify(text)}`);
  return Number(match[1]);
}

/** How many distinct colours the canvas is showing. Blank pages score 1. */
async function distinctColours(p: Page): Promise<number> {
  return p.evaluate(() => {
    const canvas = document.getElementById('view') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return 0;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 4) {
      seen.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!);
    }
    return seen.size;
  });
}

beforeAll(async () => {
  // Build first, so these test what `npm run build` actually produces rather
  // than a stale artefact someone forgot to regenerate.
  await promisify(execFile)('npx', ['tsx', join(root, 'scripts', 'build.ts')], { cwd: root });
  expect(existsSync(page404)).toBe(true);

  browser = await launchChromium();
  page = await browser.newPage({ viewport: { width: 1000, height: 620 } });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  await page.goto(pathToFileURL(page404).href);
  await page.waitForFunction(() => /step \d+/.test(document.getElementById('readout')?.textContent ?? ''));
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

describe('the viewer in a browser', () => {
  it('loads without errors', () => {
    expect(problems).toEqual([]);
  });

  it('draws something — hulls, barrels and a grid, not a blank field', async () => {
    // Background, grid, two hull colours, two trim colours and tracers. An
    // exact count would be brittle; a handful proves the scene is being drawn
    // rather than cleared and left.
    expect(await distinctColours(page)).toBeGreaterThan(4);
  });

  it('advances on its own', async () => {
    const before = await step(page);
    await page.waitForTimeout(400);
    expect(await step(page)).toBeGreaterThan(before);
  });

  it('pauses, and stays paused', async () => {
    await page.click('#play');
    await painted(page);
    const paused = await step(page);
    await page.waitForTimeout(300);
    expect(await step(page)).toBe(paused);
    expect(await page.textContent('#play')).toBe('Play');
  });

  it('single-steps by exactly one step while paused', async () => {
    const before = await step(page);
    await page.click('#step');
    await painted(page);
    expect(await step(page)).toBe(before + 1);
  });

  it('takes the keyboard shortcuts', async () => {
    const before = await step(page);
    await page.keyboard.press('.');
    await painted(page);
    expect(await step(page)).toBe(before + 1);

    await page.keyboard.press(' ');
    expect(await page.textContent('#play')).toBe('Pause');
    await page.waitForTimeout(200);
    expect(await step(page)).toBeGreaterThan(before + 1);
  });

  it('resets back to the start of the battle', async () => {
    await page.waitForTimeout(200);
    expect(await step(page)).toBeGreaterThan(0);
    await page.click('#reset');
    await painted(page);
    // The battle restarts and immediately runs the frame it is drawing, so
    // this is a "back to the beginning" check rather than an exact zero.
    expect(await step(page)).toBeLessThan(10);
  });

  it('reports no errors after all of that', () => {
    expect(problems).toEqual([]);
  });
});
