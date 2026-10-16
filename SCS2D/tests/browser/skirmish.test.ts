/// <reference lib="dom" />

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { Browser, Page } from 'playwright';
import { launchChromium } from './launch.js';
import { shipFleet, type Blueprint } from '../../sim/index.js';
import { CORVETTE, GUNSHIP } from '../../scenarios/blueprints.js';
import { DEFAULT_SKIRMISH_SETTINGS, newSkirmish, skirmishFragment, won } from '../../scenarios/skirmish.js';
import { DEFAULT_KINDS } from '../../evolution/mutate.js';
import { designHref } from '../../editor/handoff.js';

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
    expect(await page.isVisible('#setupScreen')).toBe(true);
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
    expect(await page.isVisible('#setupScreen')).toBe(true);
  });

  it('fights over the enemy\'s cost with a budget raised to fit, and matches the enemy again', async () => {
    await page.selectOption('#enemy', 'ship:Bare Core');
    await page.selectOption('#startFleet', 'ship:Gunship');
    const matched = await page.inputValue('#metalBudget');
    for (const id of ['metalBudget', 'fuelBudget', 'buildBudget']) await page.fill(`#${id}`, '100000');
    await page.click('#start');
    expect(await page.isDisabled('#play')).toBe(false);
    const kept = await page.evaluate(() => JSON.parse(window.localStorage.getItem('scs2d.skirmish')!));
    expect(kept.budget.metal).toBe(100_000_000);
    await page.click('#abandon');
    await page.fill('#metalBudget', '1');
    await page.click('#matchEnemy');
    expect(await page.inputValue('#metalBudget')).toBe(matched);
    expect(problems).toEqual([]);
  });

  it('keeps the settings chosen with the skirmish, and puts them back to their defaults', async () => {
    const set = async (id: string, value: string): Promise<void> => {
      await page.fill(`#${id}`, value);
      await page.dispatchEvent(`#${id}`, 'change');
    };
    await set('quietTime', '45');
    await set('mutants', '2');
    await set('kindTank', '7');
    await set('maxShips', '3');
    await set('gapSpread', '1000');
    await page.selectOption('#enemy', 'ship:Gunship');
    await page.selectOption('#startFleet', 'ship:Gunship');
    await page.click('#start');
    const kept = await page.evaluate(() => JSON.parse(window.localStorage.getItem('scs2d.skirmish')!));
    expect(kept.settings.quietTime).toBe(45);
    expect(kept.settings.mutants).toBe(2);
    expect(kept.settings.breeding.kindTank).toBe(7);
    expect(kept.settings.maxShips).toBe(3);
    expect(kept.settings.gapSpread).toBe(1000);
    // Remembered for the next one, until reset.
    await page.click('#abandon');
    expect(await page.inputValue('#quietTime')).toBe('45');
    await page.click('#resetSettings');
    expect(await page.inputValue('#quietTime')).toBe(String(DEFAULT_SKIRMISH_SETTINGS.quietTime));
    expect(await page.inputValue('#mutants')).toBe(String(DEFAULT_SKIRMISH_SETTINGS.mutants));
    expect(await page.inputValue('#kindTank')).toBe(String(DEFAULT_KINDS.tank));
    expect(await page.inputValue('#maxShips')).toBe('20');
    expect(await page.inputValue('#radius')).toBe('500');
    expect(await page.inputValue('#gapSpread')).toBe('0');
    expect(problems).toEqual([]);
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
    expect(await page.isVisible('#battleLink')).toBe(false);
    await page.click('#backToSkirmish');
    await page.waitForURL(/skirmish\.html/);
    await page.waitForSelector('#round:not([hidden])');
    expect(await page.textContent('#playerName')).toBe('Gunship');
    // Leaving the editor by a link saved the fleet.
    expect(await page.evaluate(() => window.localStorage.getItem('scs2d.fleet.Gunship') !== null)).toBe(true);
    expect(problems).toEqual([]);
  });

  it('opens a ship of the fleet in the ship editor, and takes it back renamed', async () => {
    await page.click('#editFleet');
    await page.waitForURL(/fleet\.html#skirmish=/);
    // The lone gunship stands at the fleet's origin, in the middle of the view.
    const box = (await page.locator('#view').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    expect(await page.textContent('#selectionTitle')).toBe('Ship: Gunship');
    await page.click('#editDesign');
    await page.waitForURL(/editor\.html#design=/);
    expect(await page.isVisible('#backToFleet')).toBe(true);
    expect(await page.isVisible('#battleLink')).toBe(false);
    expect(await page.textContent('#inFleetTitle')).toBe('Skirmish — round 1');
    expect(await page.textContent('#inFleetBudget')).toContain('metal');
    await page.fill('#shipName', 'Gunship Mk II');
    await page.click('#backToFleet');
    await page.waitForURL(/fleet\.html#skirmish=/);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    expect(await page.textContent('#selectionTitle')).toBe('Ship: Gunship Mk II');
    expect(await page.isVisible('#skirmish')).toBe(true);
    expect(problems).toEqual([]);
  });

  it('opens a design that would not fly in the ship editor without throwing', async () => {
    const adrift: Blueprint = { ...GUNSHIP, name: 'Adrift', modules: [...GUNSHIP.modules, { kind: 'engine', x: 0, y: 200, length: 3, width: 3 }] };
    const href = designHref({ fleet: shipFleet(adrift), design: 'Adrift', skirmish: newSkirmish(shipFleet(GUNSHIP), shipFleet(GUNSHIP), 3) });
    await page.goto(pathToFileURL(join(root, 'dist', 'editor.html')).href + href.slice('editor.html'.length));
    await page.waitForSelector('#backToFleet:not([hidden])');
    expect(await page.textContent('#inFleetNote')).toBe('Priced once the fleet would fly.');
    expect(await page.textContent('#inFleetBudget')).toBe('');
    // It cannot go back to the fleet, or into a battle, until it would fly.
    expect(await page.getAttribute('#backToFleet', 'class')).toContain('blocked');
    await page.click('#backToFleet');
    expect(page.url()).toContain('editor.html#design=');
    expect(problems).toEqual([]);
  });

  it('keeps a fleet with ships on top of each other out of battle', async () => {
    const stacked = { ...shipFleet(GUNSHIP), ships: [{ design: 'Gunship', x: 0, y: 0 }, { design: 'Gunship', x: 0, y: 0 }] };
    const skirmish = { ...newSkirmish(stacked, stacked, 3), player: stacked };
    await page.goto(pathToFileURL(join(root, 'dist', 'fleet.html')).href + skirmishFragment(skirmish));
    await page.waitForSelector('#backToSkirmish:not([hidden])');
    expect(await page.textContent('#skirmishNote')).toBe('Fix the problems listed to fight.');
    expect(await page.getAttribute('#backToSkirmish', 'class')).toContain('blocked');
    await page.click('#backToSkirmish');
    expect(page.url()).toContain('fleet.html#skirmish=');
    expect(problems).toEqual([]);
  });

  it('watches the enemy evolve an answer to a round won, and goes on to the next round', async () => {
    // The player's Corvette beats the same Corvette on seed 25, and a mirror is answered in a generation or two.
    const skirmish = won(newSkirmish(shipFleet(CORVETTE), shipFleet(CORVETTE), 25));
    await page.goto(pathToFileURL(skirmishPage).href + skirmishFragment(skirmish));
    await page.waitForSelector('#answering:not([hidden])');
    expect(await page.isVisible('#editFleet')).toBe(false);
    await page.waitForSelector('#answered:not([hidden])', { timeout: 90_000 });
    expect(await page.textContent('#answerProgress')).toMatch(/^Found in generation \d+/);
    // The answer heads the timeline, the enemy's losses before it folded away.
    const first = page.locator('#timeline > .match').first();
    expect(await first.locator('.matchHead span').textContent()).toBe("Round 1 · the enemy's answer");
    expect(await first.locator('.stamp').allTextContents()).toEqual(['BEATEN', 'WON']);
    expect(await page.locator('#timeline canvas').count()).toBeGreaterThan(0);
    await first.locator('.matchHead button').click();
    expect(await page.isVisible('#replaying')).toBe(true);
    await page.click('#backToRound');
    expect(await page.isVisible('#replaying')).toBe(false);
    await page.click('#nextRound');
    expect(await page.textContent('#roundTitle')).toBe('Round 2');
    expect(await page.isVisible('#answering')).toBe(false);
    expect(await page.isVisible('#editFleet')).toBe(true);
    expect(problems).toEqual([]);
  }, 120_000);
});
