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
import { serialiseBlueprint } from '../../sim/index.js';
import { DINKY } from '../../scenarios/blueprints.js';

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

/**
 * Wait for the battle to advance past `from` steps, and say how far it got.
 *
 * **Counting frames is not counting steps**, and the difference is the whole
 * of why this exists. The wall clock lives in the host and the simulation
 * takes a fixed step, so a frame owes a step only once enough real time has
 * passed for one — and the time that passed while a scene was being built is
 * deliberately dropped rather than run off in a burst, so the first frame
 * after a reset owes nothing at all. That leaves the second frame owing a
 * step only if the interval reached the timestep, and at 60 Hz those are the
 * same sixteen milliseconds: the race goes either way, and a test that waited
 * two frames and demanded a step failed about one run in six.
 */
async function advanced(p: Page, from = 0): Promise<number> {
  await p.waitForFunction(
    (had) => {
      const text = document.getElementById('readout')?.textContent ?? '';
      const match = /step (\d+)/.exec(text);
      return match !== null && Number(match[1]) > had;
    },
    from,
    { timeout: 10_000 },
  );
  return step(p);
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
  if (process.platform === 'win32') {
    await promisify(execFile)('cmd.exe', ['/c', 'npx', 'tsx', join(root, 'scripts', 'build.ts')], { cwd: root });
  } else {
    await promisify(execFile)('npx', ['tsx', join(root, 'scripts', 'build.ts')], { cwd: root });
  }
  expect(existsSync(page404)).toBe(true);

  browser = await launchChromium();
  page = await browser.newPage({ viewport: { width: 1000, height: 620 } });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  await page.goto(pathToFileURL(page404).href);
  try {
    await page.waitForFunction(() => /step \d+/.test(document.getElementById('readout')?.textContent ?? ''));
  } catch (timeout) {
    // A page that threw on load never writes a readout, so the wait expires
    // and reports only that it expired. The reason was captured the moment it
    // happened; without this, every startup failure looks the same and says
    // nothing — which is worse than a red test, because it sends you looking
    // in the wrong place.
    if (problems.length > 0) {
      throw new Error(`the page did not start:\n${problems.join('\n')}`);
    }
    throw timeout;
  }
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

  it('lists every scene by name, and plays the one that is picked', async () => {
    // A dropdown rather than a button that cycles: the list is long enough
    // that finding a scene by pressing "next" repeatedly is a poor way in.
    const names = await page.$$eval('#scene option', (o) => o.map((n) => n.textContent));
    expect(names.length).toBeGreaterThan(5);
    expect(names).toContain('Standoff');

    await page.selectOption('#scene', { label: 'Standoff' });
    await painted(page);
    // The standoff's two lines start exactly a kilometre apart, which no
    // other scene does — so this says the page is running the scene that was
    // picked rather than merely showing its name in the box.
    const metrics = (await page.textContent('#metrics')) ?? '';
    const range = Number(/range (\d+)/.exec(metrics)?.[1] ?? 0);
    expect(range).toBeGreaterThan(900);
    expect(range).toBeLessThan(1100);
    expect(await advanced(page)).toBeGreaterThan(0);
  });

  it('fights a custom battle between fleets and says who won', async () => {
    expect(await page.isHidden('#custom')).toBe(true);
    await page.selectOption('#scene', { label: 'Custom battle' });
    expect(await page.isVisible('#custom')).toBe(true);
    expect(await page.locator('#fleetSlots .slot').count()).toBe(2);

    // A lone fighter from a file against the stock line: decided in seconds.
    const lone = {
      formatVersion: 1,
      name: 'Lone',
      designs: { Dinky: serialiseBlueprint(DINKY) },
      ships: [{ design: 'Dinky', x: 0, y: 0 }],
    };
    await page.setInputFiles('#fleetFile', {
      name: 'lone.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(lone)),
    });
    await page.waitForFunction(() => document.querySelectorAll('#fleetSlots .slot').length === 3);
    await page.locator('#fleetSlots .slot').nth(1).locator('button').click();
    expect(await page.locator('#fleetSlots select').nth(1).inputValue()).toBe('Lone (file)');

    await page.fill('#battleRange', '1000');
    await page.click('#fight');
    await page.fill('#speed', '8');
    await page.dispatchEvent('#speed', 'input');
    await page.waitForFunction(() => (document.getElementById('outcome')?.textContent ?? '') !== '', null, {
      timeout: 20_000,
    });
    expect(await page.textContent('#outcome')).toMatch(/^Line of Battle \(blue\) wins at/);
    expect(await page.textContent('#sides')).toMatch(/Lone.*\/1 ships · 0 armed/);
    // Deciding it pauses the battle.
    expect(await page.textContent('#play')).toBe('Play');
    await page.fill('#speed', '1');
    await page.dispatchEvent('#speed', 'input');
  });

  it('reports no errors after all of that', () => {
    expect(problems).toEqual([]);
  });
});
