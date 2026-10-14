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
 * The skirmish loop in a real browser: choosing an enemy and a fleet, fighting,
 * and the round trip through the fleet editor. Whether a battle is decided
 * right is `tests/skirmish.test.ts`'s.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const skirmishPage = join(root, 'dist', 'skirmish.html');

let browser: Browser;
let page: Page;
const problems: string[] = [];

beforeAll(async () => {
  if (process.platform === 'win32') {
    await promisify(execFile)('cmd.exe', ['/c', 'npx', 'tsx', join(root, 'scripts', 'build.ts')], { cwd: root });
  } else {
    await promisify(execFile)('npx', ['tsx', join(root, 'scripts', 'build.ts')], { cwd: root });
  }
  expect(existsSync(skirmishPage)).toBe(true);

  browser = await launchChromium();
  page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto(pathToFileURL(skirmishPage).href);
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

describe('the skirmish in a browser', () => {
  it('opens on choosing an enemy, without errors', async () => {
    expect(await page.isVisible('#setup')).toBe(true);
    expect(await page.isVisible('#round')).toBe(false);
    expect(await page.textContent('#enemyBill')).toContain('metal');
    expect(problems).toEqual([]);
  });

  it('will not fight with a fleet over budget', async () => {
    await page.selectOption('#enemy', 'ship:Bare Core');
    await page.selectOption('#startFleet', 'ship:Gunship');
    await page.click('#start');
    expect(await page.isVisible('#round')).toBe(true);
    expect(await page.isDisabled('#play')).toBe(true);
    expect(await page.textContent('#fleetNote')).toContain('over budget');
    expect(await page.locator('#budget tr.over').count()).toBeGreaterThan(0);
    await page.click('#abandon');
    expect(await page.isVisible('#setup')).toBe(true);
  });

  it('fights a round with a fleet that fits', async () => {
    await page.selectOption('#enemy', 'ship:Gunship');
    await page.selectOption('#startFleet', 'ship:Gunship');
    await page.click('#start');
    expect(await page.isDisabled('#play')).toBe(false);
    expect(await page.textContent('#roundTitle')).toBe('Round 1');
    await page.click('#play');
    await page.waitForFunction(() => /t [1-9]/.test(document.getElementById('readout')?.textContent ?? ''));
    expect(await page.textContent('#sides')).toContain('You');
    expect(problems).toEqual([]);
  });

  it('goes to the fleet editor with the budget, and back to the round', async () => {
    await page.click('#editFleet');
    await page.waitForURL(/fleet\.html#skirmish=/);
    expect(await page.isVisible('#skirmish')).toBe(true);
    expect(await page.textContent('#skirmishTitle')).toBe('Skirmish — round 1');
    expect(await page.textContent('#skirmishBudget')).toContain('metal');
    expect(await page.inputValue('#fleetName')).toBe('Gunship');
    await page.click('#backToSkirmish');
    await page.waitForURL(/skirmish\.html/);
    await page.waitForSelector('#round:not([hidden])');
    expect(await page.textContent('#playerName')).toBe('Gunship');
    expect(problems).toEqual([]);
  });
});
