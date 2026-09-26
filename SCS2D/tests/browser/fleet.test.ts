/// <reference lib="dom" />

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { Browser, Page } from 'playwright';
import { launchChromium } from './launch.js';

/**
 * The fleet editor, driven in a real browser: the wiring between the page and
 * `FleetDocument`, whose arithmetic `tests/fleetEditor.test.ts` checks.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const fleetPage = join(root, 'dist', 'fleet.html');

let browser: Browser;
let page: Page;
const problems: string[] = [];

async function canvasCentre(p: Page): Promise<{ x: number; y: number }> {
  const box = await p.locator('#view').boundingBox();
  if (box === null) throw new Error('the canvas has no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const shipCount = async (p: Page): Promise<string> =>
  (await p.locator('#stats tr').first().textContent()) ?? '';

beforeAll(async () => {
  if (process.platform === 'win32') {
    await promisify(execFile)('cmd.exe', ['/c', 'npx', 'tsx', join(root, 'scripts', 'build.ts')], { cwd: root });
  } else {
    await promisify(execFile)('npx', ['tsx', join(root, 'scripts', 'build.ts')], { cwd: root });
  }
  expect(existsSync(fleetPage)).toBe(true);

  browser = await launchChromium();
  page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  await page.goto(pathToFileURL(fleetPage).href);
  await page.waitForFunction(() => (document.getElementById('stats')?.textContent ?? '').includes('dry mass'));
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

describe('the fleet editor in a browser', () => {
  it('opens the stock fleet without errors', async () => {
    expect(problems).toEqual([]);
    expect(await page.inputValue('#fleetName')).toBe('Line of Battle');
    expect(await shipCount(page)).toBe('ships5');
    expect(await page.textContent('#problems')).toBe('None.');
  });

  it('selects the ship under the pointer and moves it by dragging', async () => {
    // The gunship stands at the fleet's origin, in the middle of the fitted view.
    const centre = await canvasCentre(page);
    await page.mouse.click(centre.x, centre.y);
    expect(await page.textContent('#selectionTitle')).toBe('Ship: Gunship');
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x - 60, centre.y, { steps: 5 });
    await page.mouse.up();
    expect(Number(await page.inputValue('#entryX'))).toBeLessThan(0);
    await page.click('#undo');
    expect(await page.inputValue('#entryX')).toBe('0');
  });

  it('adds a ship from the library and lists it overlapping', async () => {
    await page.selectOption('#addDesign', { label: 'Dinky' });
    await page.click('#addShip');
    expect(await shipCount(page)).toBe('ships6');
    expect(await page.textContent('#problems')).toMatch(/Gunship#1 and Dinky#\d overlap at the start/);
  });

  it('lays a selected ship out in a row', async () => {
    await page.fill('#entryX', '-300');
    await page.dispatchEvent('#entryX', 'change');
    await page.fill('#repeatCount', '4');
    await page.click('#repeatEntry');
    expect(await shipCount(page)).toBe('ships9');
    expect(await page.textContent('#selectionTitle')).toBe('4 selected');
    await page.click('#deleteEntry');
    expect(await shipCount(page)).toBe('ships5');
  });

  it('offers to update a design that differs from the library copy', async () => {
    await page.evaluate(() => {
      localStorage.setItem(
        'scs2d.blueprint.Dinky',
        JSON.stringify({ formatVersion: 1, name: 'Dinky', modules: [{ kind: 'core', x: 0, y: 0, length: 2, width: 2 }] }),
      );
    });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    expect(await page.textContent('#problems')).toMatch(/Dinky differs from the library's Dinky/);
    await page.click('button[data-refresh="Dinky"]');
    expect(await page.textContent('#problems')).not.toMatch(/differs/);
    await page.click('#undo');
    expect(await page.textContent('#problems')).toMatch(/differs/);
    await page.evaluate(() => localStorage.clear());
  });

  it('saves a fleet to browser storage as a fleet file', async () => {
    await page.fill('#fleetName', 'Saved Fleet');
    await page.dispatchEvent('#fleetName', 'change');
    await page.click('#saveFleet');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('scs2d.fleet.Saved Fleet') ?? 'null'));
    expect(saved?.formatVersion).toBe(1);
    expect(saved?.ships).toHaveLength(4);
    expect(problems).toEqual([]);
  });
});
