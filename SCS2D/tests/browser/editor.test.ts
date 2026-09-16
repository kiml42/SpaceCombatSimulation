/// <reference lib="dom" />
// The callbacks handed to `page.evaluate` are serialised and run in the
// browser, so this file needs DOM types even though it executes in Node.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { Browser, Page } from 'playwright';
import { launchChromium } from './launch.js';

/**
 * The blueprint editor, driven in a real browser.
 *
 * What the unit tests cannot reach: that the page runs, that the canvas is
 * drawn on, and that a pointer landing on a module selects and moves the right
 * thing. The arithmetic behind all of that is checked in `tests/editor.test.ts`
 * without a browser, so what is left here is the wiring — which is exactly the
 * part that typechecks perfectly while being connected to nothing.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const editorPage = join(root, 'dist', 'editor.html');

let browser: Browser;
let page: Page;
const problems: string[] = [];

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

/** The middle of the canvas, where a framed ship's hull sits. */
async function canvasCentre(p: Page): Promise<{ x: number; y: number }> {
  const box = await p.locator('#view').boundingBox();
  if (box === null) throw new Error('the canvas has no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

beforeAll(async () => {
  // Build first, so these test what `npm run build` actually produces rather
  // than a stale artefact someone forgot to regenerate.
  if (process.platform === 'win32') {
    await promisify(execFile)('cmd.exe', ['/c', 'npx', 'tsx', join(root, 'scripts', 'build.ts')], { cwd: root });
  } else {
    await promisify(execFile)('npx', ['tsx', join(root, 'scripts', 'build.ts')], { cwd: root });
  }
  expect(existsSync(editorPage)).toBe(true);

  browser = await launchChromium();
  page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  await page.goto(pathToFileURL(editorPage).href);
  try {
    await page.waitForFunction(() => (document.getElementById('stats')?.textContent ?? '').includes('Dry mass'));
  } catch (timeout) {
    if (problems.length > 0) throw new Error(`the page did not start:\n${problems.join('\n')}`);
    throw timeout;
  }
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

describe('the editor in a browser', () => {
  it('loads without errors', () => {
    expect(problems).toEqual([]);
  });

  it('draws the ship through the battle renderer', async () => {
    // Background, grid, hull, trim, the firing-arc wash and the overlay's own
    // marks. An exact count would be brittle; a handful proves a scene is
    // being drawn rather than cleared and left.
    expect(await distinctColours(page)).toBeGreaterThan(4);
  });

  it('shows what the layout works out to, and that it would fly', async () => {
    const stats = (await page.textContent('#stats')) ?? '';
    expect(stats).toMatch(/Dry mass/);
    // The holding curve is measured through the allocator, so its appearance
    // is also the check that the allocator ran without throwing on load.
    expect(stats).toMatch(/Heading cost/);
    expect(await page.textContent('#problems')).toMatch(/No problems/);
  });

  it('selects the module under the pointer', async () => {
    const centre = await canvasCentre(page);
    await page.mouse.click(centre.x, centre.y);
    expect(await page.isVisible('#properties')).toBe(true);
    expect(await page.textContent('#propKind')).toBe('structure');
  });

  it('moves the selected module when it is dragged, and undoes it', async () => {
    const centre = await canvasCentre(page);
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x + 60, centre.y, { steps: 6 });
    await page.mouse.up();

    const moved = Number(await page.inputValue('#propX'));
    expect(moved).not.toBe(0);

    await page.click('#undo');
    expect(Number(await page.inputValue('#propX'))).toBe(0);
  });

  it('shows the module that was clicked, not the one that was left behind', async () => {
    // Edit a field and click straight onto another module. A canvas cannot take
    // focus, so without a deliberate blur the edited box stays focused, is held
    // back from every refresh, and goes on showing the old module's value.
    const centre = await canvasCentre(page);
    await page.mouse.click(centre.x, centre.y);
    expect(await page.textContent('#propKind')).toBe('structure');
    const hull = await page.inputValue('#propLength');

    await page.fill('#propLength', '18');
    // The bow turret, off to the right of the hull along the ship's +x.
    await page.mouse.click(centre.x + 168, centre.y);
    expect(await page.textContent('#propKind')).toBe('turret');
    expect(await page.inputValue('#propLength')).not.toBe('18');

    await page.click('#undo');
    await page.mouse.click(centre.x, centre.y);
    expect(await page.inputValue('#propLength')).toBe(hull);
  });

  it('does not resize the ship picker while the name is typed', async () => {
    const width = async (): Promise<number> => (await page.locator('#ship').boundingBox())!.width;
    const before = await width();
    await page.fill('#shipName', 'A name considerably longer than Corvette');
    expect(await width()).toBe(before);
    await page.fill('#shipName', 'Corvette');
    expect(await width()).toBe(before);
  });

  it('duplicates a module into a shared part, and moves one copy at a time', async () => {
    const centre = await canvasCentre(page);
    await page.mouse.click(centre.x + 168, centre.y);
    expect(await page.textContent('#propKind')).toBe('turret');

    await page.click('#propDuplicate');
    expect(await page.textContent('#linked')).toMatch(/drawn 2 times/);
    // The panel shows where *this copy* is, not where the shared module sits
    // inside its assembly, which is the origin.
    expect(await page.inputValue('#propX')).not.toBe('0');

    const before = await page.inputValue('#propY');
    // The middle of the new copy rather than its edge. Where a module lands on
    // screen depends on how the camera framed the ship, which depends on the
    // canvas size, which depends on how many lines the hint below it wraps to —
    // so an offset that only just lands on the module is one an unrelated
    // change to the page can push off it.
    await page.mouse.move(centre.x + 168, centre.y - 64);
    await page.mouse.down();
    await page.mouse.move(centre.x + 250, centre.y - 130, { steps: 6 });
    await page.mouse.up();
    expect(await page.inputValue('#propY')).not.toBe(before);
    // Still two, still linked: moving a copy is not unlinking it.
    expect(await page.textContent('#linked')).toMatch(/drawn 2 times/);
  });

  it('unlinks a shared part, leaving the ship as it was', async () => {
    await page.selectOption('#ship', 'Corvette');
    // Made shared here rather than hunting for one of the corvette's own by
    // pixel: where a given module lands on screen depends on how the camera
    // framed the ship, which depends on the viewport.
    const centre = await canvasCentre(page);
    await page.mouse.click(centre.x, centre.y);
    await page.click('#propDuplicate');
    expect(await page.textContent('#linked')).toMatch(/drawn 2 times/);
    const mass = (await page.textContent('#stats'))?.match(/[\d,.]+ t/)?.[0];

    await page.click('#propUnlink');
    // Unlinking is exact: the same modules in the same places, no longer the
    // same part.
    expect((await page.textContent('#stats'))?.match(/[\d,.]+ t/)?.[0]).toBe(mass);
    await page.mouse.click(centre.x, centre.y);
    expect(await page.isVisible('#linked')).toBe(false);
    expect(await page.isDisabled('#propUnlink')).toBe(true);
  });

  it('shows the selected module’s own figures', async () => {
    await page.selectOption('#ship', 'Corvette');
    const centre = await canvasCentre(page);
    await page.mouse.click(centre.x + 168, centre.y);
    const module = (await page.textContent('#moduleStats')) ?? '';
    expect(module).toMatch(/Mass/);
    expect(module).toMatch(/Hit points/);
    expect(module).toMatch(/Gun/);
    // A structure module has no gun and no thrust of its own.
    await page.mouse.click(centre.x, centre.y);
    expect(await page.textContent('#moduleStats')).not.toMatch(/Gun/);
  });

  it('burns a selected engine, and lets it die down again', async () => {
    // How much warm colour is on the canvas. Exhaust is the only large warm
    // thing the page draws — the hull and its trim are neutral greys, whose
    // red and blue match — so counting pixels where red runs well ahead of
    // blue measures the plume. The selection outline is warm too, which is why
    // this is compared against itself rather than against a fixed number.
    const warmth = async (): Promise<number> =>
      page.evaluate(() => {
        const canvas = document.getElementById('view') as HTMLCanvasElement;
        const ctx = canvas.getContext('2d');
        if (ctx === null) return 0;
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let warm = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i]! > 120 && data[i]! - data[i + 2]! > 35) warm++;
        }
        return warm;
      });

    // Added rather than hunted for by pixel: where a given module lands on
    // screen depends on how the camera framed the ship. A new module is
    // selected the moment it is placed, which is the state under test.
    await page.click('#newShip');
    await page.click('[data-add="thruster"]');
    expect(await page.textContent('#propKind')).toBe('thruster');
    const cold = await warmth();

    await page.waitForTimeout(1200);
    const burning = await warmth();
    expect(burning).toBeGreaterThan(cold * 2);

    // Deselecting winds it down rather than cutting it.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
    expect(await warmth()).toBeLessThan(burning / 2);
  });

  it('groups two modules, places the group again, and mirrors the copy', async () => {
    // The whole reason grouping exists, driven the way a person would: this is
    // what replaces a mirrored editing mode, so symmetry is structural rather
    // than something the editor has to keep in step.
    await page.selectOption('#ship', 'Corvette');
    const centre = await canvasCentre(page);

    await page.mouse.click(centre.x + 168, centre.y);
    expect(await page.textContent('#propKind')).toBe('turret');
    await page.keyboard.down('Shift');
    await page.mouse.click(centre.x, centre.y);
    await page.keyboard.up('Shift');
    expect(await page.isHidden('#groupSelection')).toBe(false);
    expect(await page.textContent('#groupCount')).toMatch(/2 modules picked/);

    await page.click('#propGroup');
    // The module panel gives way to the group's own, which edits a pose and
    // not a size.
    expect(await page.isHidden('#properties')).toBe(true);
    expect(await page.isHidden('#groupPanel')).toBe(false);
    expect(await page.textContent('#groupOf')).toMatch(/2 modules/);

    await page.click('#groupDuplicate');
    await page.check('#groupMirror');
    // Still on the new copy's panel: an edit made from a panel must not
    // dismiss the panel that made it.
    expect(await page.isHidden('#groupPanel')).toBe(false);
    expect(await page.isChecked('#groupMirror')).toBe(true);

    // And the ship now has two of everything that was grouped: clicking where
    // the original's turret is picks a group rather than nothing.
    await page.mouse.click(centre.x + 168, centre.y);
    expect(await page.isHidden('#groupPanel')).toBe(false);
  });

  it('picks the whole group first, and the module inside it on a second click', async () => {
    // A group is a part, so clicking it selects the part. Reaching what is
    // inside is deliberate rather than accidental: click it again, once the
    // group it belongs to is already the selection.
    await page.selectOption('#ship', 'Corvette');
    const centre = await canvasCentre(page);
    await page.mouse.click(centre.x + 168, centre.y);
    await page.keyboard.down('Shift');
    await page.mouse.click(centre.x, centre.y);
    await page.keyboard.up('Shift');
    await page.click('#propGroup');
    await page.keyboard.press('Escape');

    await page.mouse.click(centre.x + 168, centre.y);
    expect(await page.isHidden('#groupPanel')).toBe(false);
    expect(await page.isHidden('#properties')).toBe(true);

    await page.mouse.click(centre.x + 168, centre.y);
    expect(await page.isHidden('#groupPanel')).toBe(true);
    expect(await page.textContent('#propKind')).toBe('turret');
  });

  it('drags a selected group as one part', async () => {
    // Dragging has to move what is selected. Drilling into the group on the
    // press would have moved one module out of it instead, which is both the
    // wrong thing and hard to notice until the ship is wrong.
    await page.selectOption('#ship', 'Corvette');
    const centre = await canvasCentre(page);
    await page.mouse.click(centre.x + 168, centre.y);
    await page.keyboard.down('Shift');
    await page.mouse.click(centre.x, centre.y);
    await page.keyboard.up('Shift');
    await page.click('#propGroup');

    const before = Number(await page.inputValue('#groupX'));
    await page.mouse.move(centre.x + 168, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x + 228, centre.y - 40, { steps: 8 });
    await page.mouse.up();
    // Still the group's panel, and the group is where it was dragged to.
    expect(await page.isHidden('#groupPanel')).toBe(false);
    expect(Number(await page.inputValue('#groupX'))).not.toBe(before);
  });

  it('adds a loose module to a group that is already placed', async () => {
    await page.selectOption('#ship', 'Corvette');
    const centre = await canvasCentre(page);
    await page.mouse.click(centre.x + 168, centre.y);
    await page.keyboard.down('Shift');
    await page.mouse.click(centre.x, centre.y);
    await page.keyboard.up('Shift');
    await page.click('#propGroup');
    expect(await page.textContent('#groupOf')).toMatch(/2 modules/);

    // A module outside the group: the corvette's aft thruster, well behind the
    // hull along the ship's -x.
    await page.keyboard.down('Shift');
    await page.mouse.click(centre.x - 200, centre.y);
    await page.keyboard.up('Shift');
    expect(await page.isDisabled('#propAddToGroup')).toBe(false);

    await page.click('#propAddToGroup');
    // The group gained it, and the selection is the group rather than whatever
    // slid into the module's place in the list.
    expect(await page.isHidden('#groupPanel')).toBe(false);
    expect(await page.textContent('#groupOf')).toMatch(/3 modules/);
  });

  it('reaches a group from a module inside it', async () => {
    await page.selectOption('#ship', 'Gunship');
    const centre = await canvasCentre(page);
    // The gunship's lateral thrusters are one thruster placed eight times, so
    // any of them is inside an assembly.
    await page.mouse.click(centre.x, centre.y);
    const inGroup = (await page.isDisabled('#propSelectGroup')) === false;
    if (!inGroup) return; // whichever module the camera put under the centre
    await page.click('#propSelectGroup');
    expect(await page.isHidden('#groupPanel')).toBe(false);
  });

  it('shows what a selected group weighs, and what all its copies weigh', async () => {
    await page.selectOption('#ship', 'Corvette');
    const centre = await canvasCentre(page);
    await page.mouse.click(centre.x + 168, centre.y);
    await page.keyboard.down('Shift');
    await page.mouse.click(centre.x, centre.y);
    await page.keyboard.up('Shift');
    await page.click('#propGroup');

    const one = (await page.textContent('#groupStats')) ?? '';
    expect(one).toMatch(/Mass/);
    // One copy, so there is nothing to total.
    expect(one).not.toMatch(/copies/);

    await page.click('#groupDuplicate');
    const two = (await page.textContent('#groupStats')) ?? '';
    expect(two).toMatch(/All 2 copies/);
  });

  it('renames a group, and keeps the ship it names', async () => {
    await page.selectOption('#ship', 'Corvette');
    const centre = await canvasCentre(page);
    await page.mouse.click(centre.x + 168, centre.y);
    await page.keyboard.down('Shift');
    await page.mouse.click(centre.x, centre.y);
    await page.keyboard.up('Shift');
    await page.click('#propGroup');
    const mass = (await page.textContent('#stats'))?.match(/[\d,.]+ t/)?.[0];

    await page.fill('#groupName', 'bow mount');
    // The rename reaches the instance as well as the definition — a `use` left
    // pointing at the old name would place nothing, so the ship standing still
    // is the check that both halves happened.
    expect((await page.textContent('#stats'))?.match(/[\d,.]+ t/)?.[0]).toBe(mass);
    expect(await page.textContent('#problems')).toMatch(/No problems/);

    // Still the group's own panel, holding what was typed.
    expect(await page.isHidden('#groupPanel')).toBe(false);
    expect(await page.inputValue('#groupName')).toBe('bow mount');
  });

  it('steps size by the same amount every time the arrow is pressed', async () => {
    // A number input's steps are counted from its minimum, so a minimum off
    // the step grid puts every arrow press off it too — 8 became 8.1 and then
    // moved in halves.
    await page.selectOption('#ship', 'Corvette');
    const centre = await canvasCentre(page);
    await page.mouse.click(centre.x, centre.y);
    await page.fill('#propLength', '8');
    const steps: number[] = [];
    for (let i = 0; i < 3; i++) {
      await page.locator('#propLength').press('ArrowUp');
      steps.push(Number(await page.inputValue('#propLength')));
    }
    expect(steps).toEqual([8.5, 9, 9.5]);
  });

  it('adds a module, and says what is now wrong with the layout', async () => {
    await page.selectOption('#ship', 'Corvette');
    await page.click('[data-add="turret"]');
    // The new module lands at the middle of the view, which is inside the
    // hull — so the layout is invalid, and saving it is refused until it is not.
    expect(await page.isDisabled('#saveShip')).toBe(true);
    expect(await page.textContent('#problems')).toMatch(/problem/);

    await page.click('#undo');
    expect(await page.isDisabled('#saveShip')).toBe(false);
  });
});
