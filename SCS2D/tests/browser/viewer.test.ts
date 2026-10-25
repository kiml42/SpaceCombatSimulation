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
import { REFITTED } from '../../scenarios/mending.js';

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
 * Not part of `pnpm test`: they need a browser, and the unit suite has to stay
 * runnable from a cold checkout on any machine. `pnpm test:browser`.
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
  // Read in an animation frame, which runs after the viewer's own has drawn:
  // between frames a resize may have cleared the canvas and not yet redrawn it.
  return p.evaluate(
    () =>
      new Promise<number>((resolve) =>
        requestAnimationFrame(() => {
          const canvas = document.getElementById('view') as HTMLCanvasElement;
          const ctx = canvas.getContext('2d');
          if (ctx === null) return resolve(0);
          const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const seen = new Set<number>();
          for (let i = 0; i < data.length; i += 4) {
            seen.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!);
          }
          resolve(seen.size);
        }),
      ),
  );
}

beforeAll(async () => {
  // Build first, so these test what `pnpm build` actually produces rather
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

  it('winds back and on along the scrub bar, and a step back with the comma', async () => {
    await advanced(page, 60);
    await page.click('#play');
    await painted(page);
    const reached = await step(page);
    const scrubTo = async (value: number): Promise<void> => {
      await page.$eval(
        '#scrub',
        (input, v) => {
          (input as HTMLInputElement).value = String(v);
          input.dispatchEvent(new Event('input'));
        },
        value,
      );
      await painted(page);
    };

    // The bar lands on a checkpoint; the comma then steps back exactly.
    await scrubTo(20);
    const landed = await step(page);
    expect(landed).toBeLessThan(reached);
    expect(Number(await page.getAttribute('#scrub', 'max'))).toBe(reached);
    await scrubTo(reached);
    expect(await step(page)).toBe(reached);
    await page.keyboard.press(',');
    await painted(page);
    expect(await step(page)).toBe(reached - 1);

    await page.click('#play');
  });

  it('holds the battle while the scrub bar is held, and resumes on letting go', async () => {
    await advanced(page, 30);
    const box = (await page.locator('#scrub').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    expect(await page.textContent('#play')).toBe('Play');
    await painted(page);
    const held = await step(page);
    await page.waitForTimeout(200);
    expect(await step(page)).toBe(held);
    await page.mouse.up();
    expect(await page.textContent('#play')).toBe('Pause');
    expect(await advanced(page, held)).toBeGreaterThan(held);
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

  it('stays paused through a reset or a change of scene', async () => {
    await page.click('#play');
    expect(await page.textContent('#play')).toBe('Play');

    await page.click('#reset');
    await painted(page);
    const reset = await step(page);
    await page.waitForTimeout(200);
    expect(await step(page)).toBe(reset);

    await page.selectOption('#scene', { label: 'Duel' });
    await painted(page);
    expect(await step(page)).toBe(0);
    await page.waitForTimeout(200);
    expect(await step(page)).toBe(0);
    expect(await page.textContent('#play')).toBe('Play');

    await page.click('#play');
  });

  it('sets up a custom battle paused, live, and fights it without stopping at the end', async () => {
    expect(await page.isHidden('#custom')).toBe(true);
    await page.click('#customBattle');
    expect(await page.isVisible('#custom')).toBe(true);
    // Blank, held at the first step, and not ready to fight.
    expect(await page.locator('#fleetSlots .slot').count()).toBe(0);
    expect(await page.textContent('#play')).toBe('Play');
    expect(await page.isDisabled('#fight')).toBe(true);

    await page.click('#addFleet');
    // One side is enough to start.
    expect(await page.isDisabled('#fight')).toBe(false);
    // A single ship can be a side too.
    await page.locator('#fleetSlots select').first().selectOption('ship:Star Destroyer');
    // The table is redrawn on the next frame, so wait for it rather than racing it.
    await page.waitForFunction(() => /Star Destroyer.*1\/1 ships/.test(document.getElementById('sides')?.textContent ?? ''));
    await page.locator('#fleetSlots select').first().selectOption('fleet:Line of Battle');
    // Another side starts as a copy of the last, and its list makes it anything.
    await page.click('#addFleet');
    expect(await page.locator('#fleetSlots select').nth(1).inputValue()).toBe('fleet:Line of Battle');
    // A blueprint file is a side of one ship too.
    await page.setInputFiles('#fleetFile', {
      name: 'dinky.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(serialiseBlueprint(DINKY))),
    });
    await page.waitForFunction(() => document.querySelectorAll('#fleetSlots .slot').length === 3);
    expect(await page.locator('#fleetSlots select').nth(2).locator('option:checked').textContent()).toBe('Dinky (file)');
    await page.locator('#fleetSlots .slot').nth(2).locator('button').click();
    await page.locator('#fleetSlots .slot').nth(1).locator('button').click();
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
    await page.waitForFunction(() => document.querySelectorAll('#fleetSlots .slot').length === 2);
    expect(await page.locator('#fleetSlots select').nth(1).locator('option:checked').textContent()).toBe('Lone (file)');

    // Changing the setup rebuilds it where it stands, still paused at step 0.
    await page.fill('#battleRange', '1000');
    await page.waitForFunction(() => /range 1000 m/.test(document.getElementById('metrics')?.textContent ?? ''));
    expect(await step(page)).toBe(0);
    expect(await page.textContent('#play')).toBe('Play');
    await page.waitForFunction(() => /Lone.*1\/1 ships · 1 armed · 1 mobile/.test(document.getElementById('sides')?.textContent ?? ''));

    await page.click('#fight');
    await page.selectOption('#speed', '8');
    await page.waitForFunction(() => (document.getElementById('outcome')?.textContent ?? '') !== '', null, {
      timeout: 20_000,
    });
    expect(await page.textContent('#outcome')).toMatch(/^Line of Battle \(blue\) wins at/);
    // The battle goes on after it is decided.
    expect(await page.textContent('#play')).toBe('Pause');
    const decidedAt = await step(page);
    expect(await advanced(page, decidedAt)).toBeGreaterThan(decidedAt);
    await page.selectOption('#speed', '1');
  });

  it('copies a link that opens the same battle, paused at its start', async () => {
    await page.fill('#battleSeed', '4321');
    await page.dispatchEvent('#battleSeed', 'input');
    // The clipboard is stood in for, so the test reads what would have been copied.
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: (text: string) => (((window as unknown as { copied: string }).copied = text), Promise.resolve()) },
        configurable: true,
      });
    });
    await page.click('#linkBattle');
    await page.waitForFunction(() => typeof (window as unknown as { copied?: string }).copied === 'string');
    const href = await page.evaluate(() => (window as unknown as { copied: string }).copied);
    expect(href).toMatch(/index\.html#battle=[\w-]+$/);

    const opened = await browser.newPage({ viewport: { width: 1000, height: 620 } });
    const errors: string[] = [];
    opened.on('pageerror', (error) => errors.push(error.message));
    await opened.goto(href);
    await opened.waitForFunction(() => document.querySelectorAll('#fleetSlots .slot').length === 2);
    expect(await opened.isVisible('#custom')).toBe(true);
    expect(await opened.locator('#fleetSlots select').nth(1).locator('option:checked').textContent()).toBe('Lone (link)');
    expect(await opened.inputValue('#battleSeed')).toBe('4321');
    expect(await opened.inputValue('#battleRange')).toBe('1000');
    expect(await opened.textContent('#play')).toBe('Play');
    // The address is tidied, so a reload is the viewer and not the battle again.
    expect(new URL(opened.url()).hash).toBe('');
    expect(errors).toEqual([]);
    await opened.close();
  });

  it('zooms in under a pinch on a touch screen, and pans with it', async () => {
    const touch = await browser.newPage({ viewport: { width: 400, height: 800 }, hasTouch: true, isMobile: true });
    await touch.goto(pathToFileURL(page404).href);
    await touch.waitForFunction(() => /step \d+/.test(document.getElementById('readout')?.textContent ?? ''));
    await touch.click('#play');
    const grid = async (): Promise<number> => Number(/grid ([\d.]+)/.exec((await touch.textContent('#readout')) ?? '')![1]);
    await painted(touch);
    const before = await grid();

    // Two fingers drawn apart across the middle of the view, through the
    // browser's own touch input so the page sees real pointer events.
    const box = (await touch.locator('#view').boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const cdp = await touch.context().newCDPSession(touch);
    const fingers = (apart: number) => [
      { x: cx - apart, y: cy, id: 0 },
      { x: cx + apart, y: cy, id: 1 },
    ];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(40) });
    for (const apart of [60, 80, 100, 120, 140, 160]) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(apart) });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await painted(touch);
    // Four times as close: the grid drops a couple of its 1-2-5 steps, and
    // stays there, because a pinch hands the camera over just as a scroll does.
    expect(await grid()).toBeLessThan(before / 3);
    await touch.waitForTimeout(300);
    expect(await grid()).toBeLessThan(before / 3);
    await touch.close();
  });

  it('remembers the speed, the arcs and the shot colours for the next visit', async () => {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.selectOption('#speed', '4');
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+a');
    await page.keyboard.press('c');
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem('scs2d.view.viewer')))!)).toEqual({
      arcs: 'trigger',
      teamShots: true,
      strips: true,
      speed: 4,
    });

    // Coming back to the page is what the last visit left.
    await page.reload();
    await page.waitForFunction(() => /step \d+/.test(document.getElementById('readout')?.textContent ?? ''));
    expect(await page.inputValue('#speed')).toBe('4');
    // Pressed once more, the arcs go on round from where they were left, to none.
    await page.keyboard.press('Control+a');
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem('scs2d.view.viewer')))!).arcs).toBe('none');
  });

  it('shows a picked ship and its target close up when they are too small to read', async () => {
    await page.click('#reset');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    if ((await page.textContent('#play')) !== 'Play') await page.keyboard.press('Space');
    // Without the fleets down the edges, which are lit pixels of their own.
    await page.keyboard.press('t');
    await painted(page);
    const box = (await page.locator('#view').boundingBox())!;
    // The brightest pixel is on a ship.
    const at = await page.evaluate(() => {
      const canvas = document.getElementById('view') as HTMLCanvasElement;
      const { data, width } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
      let best = -1;
      let index = 0;
      for (let i = 0; i < data.length; i += 4) {
        const v = data[i]! + data[i + 1]! + data[i + 2]!;
        if (v > best) {
          best = v;
          index = i / 4;
        }
      }
      const ratio = canvas.width / canvas.getBoundingClientRect().width;
      return { x: (index % width) / ratio, y: Math.floor(index / width) / ratio };
    });
    await page.mouse.click(box.x + at.x, box.y + at.y);
    // Far enough out that both ships are specks.
    for (let i = 0; i < 12; i++) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, 400);
    }
    const lit = (): Promise<number> =>
      page.evaluate(() => {
        const canvas = document.getElementById('view') as HTMLCanvasElement;
        const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
        let count = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i]! + data[i + 1]! + data[i + 2]! > 200) count++;
        return count;
      });
    await painted(page);
    const picked = await lit();
    // Clicking a window frames its ship again: the view zooms back in on the pair.
    const grid = async (): Promise<number> => Number(/grid ([\d.]+) m/.exec((await page.textContent('#readout')) ?? '')?.[1] ?? NaN);
    const far = await grid();
    const window = await page.evaluate(() => {
      const canvas = document.getElementById('view') as HTMLCanvasElement;
      const { data, width } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
      // The first lit pixel, reading down, is the top of the upper window's frame: just inside its corner.
      let first = 0;
      while (first < data.length / 4 && data[first * 4]! + data[first * 4 + 1]! + data[first * 4 + 2]! <= 200) first++;
      const ratio = canvas.width / canvas.getBoundingClientRect().width;
      return { x: (first % width) / ratio + 20, y: Math.floor(first / width) / ratio + 20 };
    });
    await page.mouse.click(box.x + window.x, box.y + window.y);
    await page.waitForFunction(
      (was) => Number(/grid ([\d.]+) m/.exec(document.getElementById('readout')?.textContent ?? '')?.[1] ?? NaN) < was / 100,
      far,
    );
    await page.keyboard.press('Escape');
    for (let i = 0; i < 12; i++) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, 400);
    }
    await painted(page);
    const dropped = await lit();
    // Two windows of hull, frame and rings, against two specks.
    expect(picked).toBeGreaterThan(dropped * 4 + 500);
    await page.keyboard.press('t');
  });

  it('shows each side down the edges, hides them with T, and picks a ship from its tile', async () => {
    await page.selectOption('#scene', { label: 'Duel' });
    await page.click('#reset');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    if ((await page.textContent('#play')) !== 'Play') await page.keyboard.press('Space');
    await painted(page);
    /** How bright a box of the view is, CSS pixels from its top left. */
    const brightness = (x: number, y: number, w: number, h: number): Promise<number> =>
      page.evaluate(
        ([x, y, w, h]) => {
          const canvas = document.getElementById('view') as HTMLCanvasElement;
          const ratio = canvas.width / canvas.getBoundingClientRect().width;
          const { data } = canvas
            .getContext('2d')!
            .getImageData(
              Math.round(x! * ratio),
              Math.round(y! * ratio),
              Math.max(1, Math.round(w! * ratio)),
              Math.max(1, Math.round(h! * ratio)),
            );
          let sum = 0;
          for (let i = 0; i < data.length; i += 4) sum += data[i]! + data[i + 1]! + data[i + 2]!;
          return sum;
        },
        [x, y, w, h],
      );
    // The first tile of the left column: its frame down its left side.
    const frame = (): Promise<number> => brightness(5, 10, 3, 60);
    const shown = await frame();
    await page.keyboard.press('t');
    await painted(page);
    expect(await frame()).toBeLessThan(shown / 2);
    expect(JSON.parse((await page.evaluate(() => localStorage.getItem('scs2d.view.viewer')))!).strips).toBe(false);
    await page.keyboard.press('t');
    await painted(page);
    // Picked from its tile, the ship's frame is drawn brighter.
    const box = (await page.locator('#view').boundingBox())!;
    const before = await frame();
    await page.mouse.click(box.x + 40, box.y + 40);
    await painted(page);
    expect(await frame()).toBeGreaterThan(before * 1.2);
    await page.keyboard.press('Escape');
  });

  it('lists its keys in a table behind a button, which keeps them from the battle while open', async () => {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    expect(await page.textContent('footer')).toBe('Keys');
    await page.click('#keysButton');
    expect(await page.isVisible('#keyHelp')).toBe(true);
    const rows = await page.$$eval('#keyHelp tr', (trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent)));
    expect(rows).toEqual(
      expect.arrayContaining([
        ['Space', 'Pause, or play'],
        ['T', "Hide or show each side's ships down the edges"],
      ]),
    );
    // Space goes to the table, not the battle under it.
    const playing = await page.textContent('#play');
    await page.keyboard.press('Space');
    expect(await page.textContent('#play')).toBe(playing);
    await page.keyboard.press('Escape');
    expect(await page.isVisible('#keyHelp')).toBe(false);
    // And ? opens it again.
    await page.keyboard.press('?');
    expect(await page.isVisible('#keyHelp')).toBe(true);
    await page.keyboard.press('Escape');
  });

  it("writes the range to a picked ship's target on the line between them", async () => {
    await page.click('#reset');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    // Run long enough for the ships to have picked their targets, then hold.
    if ((await page.textContent('#play')) === 'Play') await page.keyboard.press('Space');
    await advanced(page, 60);
    await page.keyboard.press('Space');
    await painted(page);
    // Everything the view writes, from here on.
    await page.evaluate(() => {
      const written: string[] = [];
      (window as unknown as { written: string[] }).written = written;
      const fill = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (this: CanvasRenderingContext2D, text: string, x: number, y: number) {
        written.push(`${this.font}|${text}`);
        fill.call(this, text, x, y);
      };
    });
    // At the line's size, 12 px: a close-up writes the range too, smaller, under its target.
    const ranges = (): Promise<string[]> =>
      page.evaluate(() => (window as unknown as { written: string[] }).written.filter((text) => /^12px .*\|[\d.]+ k?m$/.test(text)));
    await painted(page);
    expect(await ranges()).toEqual([]);
    const box = (await page.locator('#view').boundingBox())!;
    const at = await page.evaluate(() => {
      const canvas = document.getElementById('view') as HTMLCanvasElement;
      const { data, width } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
      let best = -1;
      let index = 0;
      for (let i = 0; i < data.length; i += 4) {
        const v = data[i]! + data[i + 1]! + data[i + 2]!;
        if (v > best) {
          best = v;
          index = i / 4;
        }
      }
      const ratio = canvas.width / canvas.getBoundingClientRect().width;
      return { x: (index % width) / ratio, y: Math.floor(index / width) / ratio };
    });
    await page.mouse.click(box.x + at.x, box.y + at.y);
    await painted(page);
    expect((await ranges()).length).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
  });

  it('gives orders: picked out, right-clicked, armed, queued, taken back and stopped', async () => {
    await page.selectOption('#scene', { label: 'Duel' });
    // Far enough in that each ship has picked a fight, so framing a pick takes in all three.
    if ((await page.textContent('#play')) === 'Play') await page.click('#play');
    await advanced(page, 60);
    await page.click('#play');
    await painted(page);
    const canvas = (await page.locator('#view').boundingBox())!;
    // In the duel, ships 0 and 1 are a side and ship 2 the other.
    const at = async (ship: number): Promise<{ x: number; y: number }> => {
      const p = await page.evaluate(
        (i) => (window as unknown as { viewer: { screenOf(i: number): { x: number; y: number } } }).viewer.screenOf(i),
        ship,
      );
      return { x: canvas.x + p.x, y: canvas.y + p.y };
    };
    const orders = (): Promise<unknown[]> => page.evaluate(() => (window as unknown as { viewer: { orders: unknown[] } }).viewer.orders);
    const click = async (ship: number, options: { shift?: boolean; ctrl?: boolean; right?: boolean } = {}): Promise<void> => {
      const p = await at(ship);
      const held = options.shift ? 'Shift' : options.ctrl ? 'Control' : null;
      if (held !== null) await page.keyboard.down(held);
      await page.mouse.click(p.x, p.y, { button: options.right ? 'right' : 'left' });
      if (held !== null) await page.keyboard.up(held);
      // Past the double-click interval, so two clicks are never read as one, and
      // long enough for the camera to settle on what was picked.
      await page.waitForTimeout(1000);
      await painted(page);
    };

    expect(await page.isHidden('#orderBar')).toBe(true);
    await click(0);
    expect(await page.isVisible('#orderBar')).toBe(true);
    await click(1, { shift: true });
    await click(2, { right: true });
    expect(await orders()).toHaveLength(1);
    expect(JSON.stringify(await orders())).toContain('"ships":[0,1]');
    // The future is gone with it: the bar runs to here.
    expect(Number(await page.getAttribute('#scrub', 'max'))).toBe(await step(page));

    // Let go first each time, so no close-up of a picked ship is in the way.
    await page.keyboard.press('Escape');
    await click(0);
    expect(await page.locator('#queue li').count()).toBe(1);
    expect(await page.textContent('#queue')).toContain('attack');
    // Ctrl queues, by a right-click or an armed verb's click.
    await click(2, { ctrl: true, right: true });
    expect(await page.locator('#queue li').count()).toBe(2);
    await page.keyboard.press('Escape');
    await click(0);
    await page.locator('#queue li').nth(1).locator('button').click();
    await painted(page);
    await page.keyboard.press('r');
    await click(2, { ctrl: true });
    expect(await page.locator('#queue li').count()).toBe(2);
    expect(await page.textContent('#queue li:nth-child(2)')).toContain('ram');
    await page.locator('#queue li').first().locator('button').click();
    await painted(page);
    expect(await page.locator('#queue li').count()).toBe(1);
    await page.keyboard.press('s');
    await painted(page);
    expect(await page.locator('#queue li').count()).toBe(0);

    await page.keyboard.press('Escape');
    await click(1);
    await click(0, { right: true });
    expect(JSON.stringify((await orders()).at(-1))).toContain('"defend"');
    // A alone takes the picked ship's whole side.
    await page.keyboard.press('a');
    expect(await page.evaluate(() => (window as unknown as { viewer: { picked: number[] } }).viewer.picked)).toEqual([0, 1]);
    await page.keyboard.press('Escape');
    await painted(page);
    expect(await page.isHidden('#orderBar')).toBe(true);
  }, 60_000);

  it('shows what is in an asteroid picked out, and mines it on a right-click', async () => {
    await page.selectOption('#scene', { label: 'Mining' });
    if ((await page.textContent('#play')) === 'Pause') await page.click('#play');
    await painted(page);
    const canvas = (await page.locator('#view').boundingBox())!;
    // Ships 0 and 1 are the Salvagers; the asteroids come after them.
    const click = async (ship: number, right = false): Promise<void> => {
      const p = await page.evaluate(
        (i) => (window as unknown as { viewer: { screenOf(i: number): { x: number; y: number } } }).viewer.screenOf(i),
        ship,
      );
      await page.mouse.click(canvas.x + p.x, canvas.y + p.y, { button: right ? 'right' : 'left' });
      await page.waitForTimeout(1000);
      await painted(page);
    };
    expect(await page.isHidden('#asteroidCard')).toBe(true);
    await click(3);
    expect(await page.isVisible('#asteroidCard')).toBe(true);
    expect(await page.textContent('#asteroidCard')).toMatch(/rock [\d.,]+ t · ore [\d.,]+ t · ice [\d.,]+ t/);
    expect(await page.isHidden('#orderBar')).toBe(true);
    await page.keyboard.press('Escape');
    // Both Salvagers, framed with the asteroids between them.
    await page.keyboard.press('a');
    await page.waitForTimeout(1000);
    await painted(page);
    expect(await page.isHidden('#asteroidCard')).toBe(true);
    await click(3, true);
    const last = await page.evaluate(() => (window as unknown as { viewer: { orders: unknown[] } }).viewer.orders.at(-1));
    expect(last).toMatchObject({ command: { ships: [0, 1], order: { kind: 'scavenge', target: 3 } } });
    await page.keyboard.press('Escape');
  }, 60_000);

  it('docks anywhere with Enter, and tells doctrine from a panel beside the orders', async () => {
    await page.selectOption('#scene', { label: 'Duel' });
    if ((await page.textContent('#play')) === 'Play') await page.click('#play');
    await advanced(page, 60);
    await page.click('#play');
    await painted(page);
    const canvas = (await page.locator('#view').boundingBox())!;
    const p = await page.evaluate(() =>
      (window as unknown as { viewer: { screenOf(i: number): { x: number; y: number } } }).viewer.screenOf(0),
    );
    await page.mouse.click(canvas.x + p.x, canvas.y + p.y);
    await page.waitForTimeout(1000);
    await painted(page);
    const last = async (): Promise<string> =>
      JSON.stringify(await page.evaluate(() => (window as unknown as { viewer: { orders: unknown[] } }).viewer.orders.at(-1)));

    await page.keyboard.press('h');
    await painted(page);
    expect(await page.isVisible('#nearest')).toBe(true);
    await page.keyboard.press('Enter');
    await painted(page);
    expect(await last()).toContain('"kind":"dock","target":-1');
    expect(await page.isHidden('#nearest')).toBe(true);

    expect(await page.isHidden('#doctrinePanel')).toBe(true);
    await page.keyboard.press('p');
    await painted(page);
    expect(await page.isVisible('#doctrinePanel')).toBe(true);
    // What it is built to, on the order bar.
    expect(await page.isVisible('#remodelTo')).toBe(true);
    expect(((await page.locator('#remodelTo option:checked').textContent()) ?? '').length).toBeGreaterThan(0);
    // Under the editor's headings.
    expect(await page.textContent('#doctrinePanel h3')).toBe('Picking a fight and closing on it');
    const speed = page.locator('#doctrinePanel input[data-field="approachSpeed"]');
    await speed.fill('7');
    await speed.press('Tab');
    await painted(page);
    expect(await last()).toContain('"kind":"doctrine"');
    expect(await last()).toContain('"value":7');
    // Shown as told at once, with nothing else moving.
    expect(await page.locator('#doctrinePanel label.told').count()).toBe(1);
    await page.locator('#doctrinePanel .tabs button', { hasText: 'Main weapons' }).click();
    await painted(page);
    expect(await page.textContent('#doctrinePanel .tabs button.armed')).toBe('Main weapons');
    expect(await page.locator('#doctrinePanel input').count()).toBeGreaterThan(0);
    expect(await page.isVisible('#doctrinePanel button:has-text("Revert all")')).toBe(true);
    await page.keyboard.press('p');
    await painted(page);
    expect(await page.isHidden('#doctrinePanel')).toBe(true);
    await page.keyboard.press('Escape');
  }, 60_000);

  it('shows what a ship is built to, and remodels it only on Remodel', async () => {
    // Something in the library its refit would take, whatever the stock ships are: itself less its last module.
    const variant = { ...REFITTED, name: 'Refitted Rebuilder, trimmed', modules: REFITTED.modules.slice(0, -1) };
    await page.evaluate(
      ([key, text]) => window.localStorage.setItem(key!, text!),
      [`scs2d.blueprint.${variant.name}`, JSON.stringify(serialiseBlueprint(variant))],
    );
    await page.selectOption('#scene', { label: 'Refitting' });
    if ((await page.textContent('#play')) === 'Pause') await page.click('#play');
    await painted(page);
    // The scenario's one ship, by its side rather than by where it is drawn.
    const pick = async (): Promise<void> => {
      // Not into the drop-down, whose letters pick its options.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press('a');
      await painted(page);
      expect(await page.evaluate(() => (window as unknown as { viewer: { picked: number[] } }).viewer.picked)).toEqual([0]);
    };
    const orders = (): Promise<number> =>
      page.evaluate(() => (window as unknown as { viewer: { orders: unknown[] } }).viewer.orders.length);
    await pick();
    expect(await page.isEnabled('#remodelTo')).toBe(true);
    const built = await page.locator('#remodelTo option:checked').textContent();
    expect(await page.isEnabled('#remodel')).toBe(false);
    await page.selectOption('#remodelTo', { index: 1 });
    expect(await page.isEnabled('#remodel')).toBe(true);
    // Chosen but not given: let go and picked again, it shows what it is built to.
    const before = await orders();
    await page.keyboard.press('Escape');
    await painted(page);
    await pick();
    expect(await page.locator('#remodelTo option:checked').textContent()).toBe(built);
    expect(await orders()).toBe(before);
    await page.selectOption('#remodelTo', { index: 1 });
    await page.click('#remodel');
    await painted(page);
    expect(await orders()).toBe(before + 1);
    expect(await page.locator('#remodelTo option:checked').textContent()).not.toBe(built);
    await page.keyboard.press('Escape');
    await page.evaluate((key) => window.localStorage.removeItem(key), `scs2d.blueprint.${variant.name}`);
  }, 60_000);

  it('adds a chosen ship for a chosen side where it is pressed, as fast as it is dragged', async () => {
    await page.selectOption('#scene', { label: 'Duel' });
    if ((await page.textContent('#play')) === 'Pause') await page.click('#play');
    await painted(page);
    const viewer = (): Promise<{ count: number; placing: boolean; last: unknown }> =>
      page.evaluate(() => {
        const v = (
          window as unknown as { viewer: { battle: { ships: { count: number } }; placing: boolean; orders: { command: unknown }[] } }
        ).viewer;
        return { count: v.battle.ships.count, placing: v.placing, last: v.orders.at(-1)?.command };
      });
    const before = await viewer();
    // The ship first and the side after: the side is the one chosen by the time it is placed.
    await page.selectOption('#addSide', '0');
    await page.selectOption('#addShip', { label: 'Corvette' });
    expect((await viewer()).placing).toBe(true);
    await page.selectOption('#addSide', '1');
    // The list goes on showing what is being placed.
    expect(await page.locator('#addShip option:checked').textContent()).toBe('Corvette');
    const box = (await page.locator('#view').boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5, { steps: 4 });
    await page.mouse.up();
    await painted(page);
    const after = await viewer();
    expect(after.count).toBe(before.count + 1);
    expect(after.placing).toBe(false);
    expect(await page.inputValue('#addShip')).toBe('');
    // Dragged to the right, which is east in the battle: moving that way and facing it.
    expect(after.last).toMatchObject({ kind: 'spawn', team: 1, vy: 0, angle: 0 });
    expect((after.last as { vx: number }).vx).toBeGreaterThan(0);
    // Escape gives up a ship chosen but not yet placed.
    await page.selectOption('#addShip', { label: 'Corvette' });
    await page.keyboard.press('Escape');
    expect((await viewer()).placing).toBe(false);
    expect(await page.inputValue('#addShip')).toBe('');
  });

  it('reports no errors after all of that', () => {
    expect(problems).toEqual([]);
  });
});
