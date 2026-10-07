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
import { ROTATE_ARM_PX } from '../../editor/handles.js';
import { EditorDocument } from '../../editor/document.js';
import { previewSnapshot } from '../../editor/preview.js';
import { frame, type Camera } from '../../render/camera.js';
import { CORVETTE } from '../../scenarios/blueprints.js';
import { parseBlueprint, type Blueprint } from '../../sim/index.js';

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

/** How many pixels on the canvas are the fault mark's red. */
async function redPixels(p: Page): Promise<number> {
  return p.evaluate(() => {
    const canvas = document.getElementById('view') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return 0;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let red = 0;
    // Strongly red and not much else: the page is otherwise greys, a gold
    // selection and a blue-green set of overlay marks.
    for (let i = 0; i < data.length; i += 4) {
      if (data[i]! > 170 && data[i + 1]! < 120 && data[i + 2]! < 120) red++;
    }
    return red;
  });
}

/**
 * Open a ship and snap the view to it. Switching ships eases the scale over a
 * few frames, and a test that clicks at a worked-out point cannot wait for it.
 * The list is left first, since F in a focused list picks an entry by letter.
 */
async function openShip(p: Page, name: string): Promise<void> {
  await p.selectOption('#ship', name);
  await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await p.keyboard.press('f');
}

/** The middle of the canvas, where a framed ship's centre of mass sits. */
async function canvasCentre(p: Page): Promise<{ x: number; y: number }> {
  const box = await p.locator('#view').boundingBox();
  if (box === null) throw new Error('the canvas has no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Where a point of the stock corvette's blueprint lands on screen once it is
 * framed, worked out the way the page fits its view. The fit centres on the
 * centre of mass, so the core is not at the middle of the canvas.
 */
async function onCorvette(p: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = await p.locator('#view').boundingBox();
  const size = await p.evaluate(() => {
    const canvas = document.getElementById('view') as HTMLCanvasElement;
    return { width: canvas.width, height: canvas.height };
  });
  if (box === null) throw new Error('the canvas has no box');
  const design = new EditorDocument(CORVETTE).view.design;
  if (design === null) throw new Error('the corvette does not compile');
  const camera: Camera = { x: 0, y: 0, scale: 1 };
  frame(camera, previewSnapshot(design), size.width, size.height, 1);
  const cssPerPx = box.width / size.width;
  return {
    x: box.x + (size.width / 2 + (x - camera.x) * camera.scale) * cssPerPx,
    y: box.y + (size.height / 2 - (y - camera.y) * camera.scale) * cssPerPx,
  };
}

/** A plate to shape, with a core beside it to hang it from. */
const PLATE: Blueprint = {
  name: 'Plate',
  modules: [
    { kind: 'core', x: -4, y: 0, length: 4, width: 4 },
    { kind: 'structure', x: 0, y: 0, length: 4, width: 4 },
  ],
};

/**
 * A hull whose faces are off the grid, with a plate adrift of it and one
 * turned to an angle no increment offers.
 *
 * Its faces are at 2.3 and 6.3, which no grid the editor offers has a line on,
 * so a plate that comes to rest flush with one got there by landing on the
 * layout rather than by rounding. Written as a file, where angles are in
 * degrees, since that is how a ship reaches the editor.
 */
const SNAPPING_FILE = {
  formatVersion: 1,
  name: 'Snapping',
  modules: [
    { kind: 'structure', x: -3.7, y: 0, length: 4, width: 4, angle: 20 },
    { kind: 'core', x: 0.3, y: 0, length: 4, width: 4 },
    { kind: 'structure', x: 4.3, y: 0, length: 4, width: 4 },
    { kind: 'structure', x: 12, y: 0, length: 4, width: 4 },
  ],
};
const SNAPPING: Blueprint = parseBlueprint(SNAPPING_FILE);

/**
 * Where a blueprint's own coordinates land on screen once the page has framed
 * it, and how many pixels a metre is worth there.
 */
async function framing(
  p: Page,
  blueprint: Blueprint,
): Promise<{ at: (x: number, y: number) => { x: number; y: number }; scale: number }> {
  const box = await p.locator('#view').boundingBox();
  const size = await p.evaluate(() => {
    const canvas = document.getElementById('view') as HTMLCanvasElement;
    return { width: canvas.width, height: canvas.height };
  });
  if (box === null) throw new Error('the canvas has no box');
  const design = new EditorDocument(blueprint).view.design;
  if (design === null) throw new Error(`${blueprint.name} does not compile`);
  const camera: Camera = { x: 0, y: 0, scale: 1 };
  frame(camera, previewSnapshot(design), size.width, size.height, 1);
  const cssPerPx = box.width / size.width;
  return {
    at: (x, y) => ({
      x: box.x + (size.width / 2 + (x - camera.x) * camera.scale) * cssPerPx,
      y: box.y + (size.height / 2 - (y - camera.y) * camera.scale) * cssPerPx,
    }),
    scale: camera.scale * cssPerPx,
  };
}

/** Put a ship's file in the library and open it. */
async function openWritten(p: Page, name: string, file: unknown): Promise<void> {
  await p.evaluate(
    ([ship, written]) => window.localStorage.setItem(`scs2d.blueprint.${ship}`, written as string),
    [name, JSON.stringify(file)],
  );
  await p.reload();
  await openShip(p, name);
  await p.keyboard.press('f');
}

/** The corvette's core, amidships at its origin. */
const corvetteCore = (p: Page) => onCorvette(p, 0, 0);
/** The corvette's bow gun, at the middle of its box. */
const corvetteGun = (p: Page) => onCorvette(p, 13, 0);

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
    await page.waitForFunction(() => (document.getElementById('stats')?.textContent ?? '').includes('Endurance'));
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

  it('cycles through three sets of arcs on A, and back', async () => {
    const picture = (): Promise<string> =>
      page.evaluate(
        () =>
          new Promise<string>((done) =>
            requestAnimationFrame(() => done((document.getElementById('view') as HTMLCanvasElement).toDataURL())),
          ),
      );
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const seen: string[] = [await picture()];
    for (let k = 0; k < 3; k++) {
      await page.keyboard.press('a');
      seen.push(await picture());
    }
    expect(new Set(seen.slice(0, 3)).size).toBe(3);
    expect(seen[3]).toBe(seen[0]);
  });

  it('shows what the layout works out to, and that it would fly', async () => {
    const stats = (await page.textContent('#stats')) ?? '';
    expect(stats).toMatch(/Mass[\d.,]+ t, [\d.,]+ t of it fuel/);
    expect(stats).toMatch(/Endurance[\d,]+ s flat out, [\d,]+ m\/s of Δv/);
    // The holding curve is measured through the allocator, so its appearance
    // is also the check that the allocator ran without throwing on load.
    expect(stats).toMatch(/Heading cost/);
    expect(stats).toMatch(/Closes to\s*\d[\d,]*–\d[\d,]* m/);
    expect(await page.textContent('#problems')).toMatch(/No problems/);
  });

  it('selects the module under the pointer', async () => {
    const core = await corvetteCore(page);
    await page.mouse.click(core.x, core.y);
    expect(await page.isVisible('#properties')).toBe(true);
    expect(await page.inputValue('#propKind')).toBe('core');
  });

  it('keeps the selection while panning, and clears it on a click in empty space', async () => {
    const centre = await canvasCentre(page);
    const core = await corvetteCore(page);
    await page.mouse.click(core.x, core.y);
    const empty = { x: centre.x - 400, y: centre.y - 250 };
    await page.mouse.move(empty.x, empty.y);
    await page.mouse.down();
    await page.mouse.move(empty.x + 60, empty.y + 40, { steps: 6 });
    await page.mouse.up();
    expect(await page.isVisible('#properties')).toBe(true);
    expect(await page.inputValue('#propKind')).toBe('core');

    await page.mouse.click(empty.x, empty.y);
    expect(await page.isVisible('#properties')).toBe(false);

    await page.keyboard.press('f');
    await page.mouse.click(core.x, core.y);
  });

  it('moves the selected module when it is dragged, and undoes it', async () => {
    const core = await corvetteCore(page);
    await page.mouse.move(core.x, core.y);
    await page.mouse.down();
    await page.mouse.move(core.x + 60, core.y, { steps: 6 });
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
    await openShip(page, 'Corvette');
    const core = await corvetteCore(page);
    await page.mouse.click(core.x, core.y);
    expect(await page.inputValue('#propKind')).toBe('core');
    const hull = await page.inputValue('#propLength');

    await page.fill('#propLength', '18');
    // The bow gun, well forward of the core along the ship's +x.
    const gun = await corvetteGun(page);
    await page.mouse.click(gun.x, gun.y);
    expect(await page.inputValue('#propKind')).toBe('hullGun');
    expect(await page.inputValue('#propLength')).not.toBe('18');

    await page.click('#undo');
    await page.mouse.click(core.x, core.y);
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
    await openShip(page, 'Corvette');
    const centre = await canvasCentre(page);
    await page.mouse.click(centre.x + 168, centre.y);
    expect(await page.inputValue('#propKind')).toBe('hullGun');

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

  it('takes a shared part out of its assembly, leaving the ship as it was', async () => {
    await openShip(page, 'Corvette');
    // Made shared here rather than hunting for one of the corvette's own by
    // pixel: where a given module lands on screen depends on how the camera
    // framed the ship, which depends on the viewport.
    const centre = await canvasCentre(page);
    await page.mouse.click(centre.x, centre.y);
    await page.click('#propDuplicate');
    expect(await page.textContent('#linked')).toMatch(/drawn 2 times/);
    const mass = (await page.textContent('#stats'))?.match(/[\d,.]+ t/)?.[0];

    await page.click('#propTakeOut');
    // Exact: the same modules in the same places, no longer the same part.
    expect((await page.textContent('#stats'))?.match(/[\d,.]+ t/)?.[0]).toBe(mass);
    await page.mouse.click(centre.x, centre.y);
    expect(await page.isVisible('#linked')).toBe(false);
    expect(await page.isDisabled('#propTakeOut')).toBe(true);
  });

  it('shows the selected module’s own figures', async () => {
    await openShip(page, 'Corvette');
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

  it('lets a core be thick, which costs it wall', async () => {
    await openShip(page, 'Corvette');
    const core = await corvetteCore(page);
    await page.mouse.click(core.x, core.y);
    expect(await page.inputValue('#propKind')).toBe('core');
    expect(await page.isVisible('#thickRow')).toBe(true);
    const mass = (await page.textContent('#stats'))?.match(/[\d,.]+ t/)?.[0];
    await page.check('#propThick');
    expect(await page.isChecked('#propThick')).toBe(true);
    expect((await page.textContent('#stats'))?.match(/[\d,.]+ t/)?.[0]).not.toBe(mass);
  });

  it('marks a ship a fighter, which rules out turrets and thick modules', async () => {
    await page.click('#newShip');
    await page.click('[data-add="structure"]');
    expect(await page.isDisabled('#propThick')).toBe(false);
    await page.check('#shipFighter');
    expect(await page.isDisabled('[data-add="turret"]')).toBe(true);
    expect(await page.isDisabled('[data-add="beamTurret"]')).toBe(true);
    expect(await page.isDisabled('#propThick')).toBe(true);
    await page.uncheck('#shipFighter');
    expect(await page.isDisabled('[data-add="turret"]')).toBe(false);
  });

  it('offers a shell on a gun and not on a beam', async () => {
    await page.click('#newShip');
    await page.click('[data-add="turret"]');
    expect(await page.isVisible('#shellRow')).toBe(true);
    expect(Number(await page.inputValue('#propFuse'))).toBeCloseTo(0.02, 9);
    expect(Number(await page.inputValue('#propFragments'))).toBe(8);
    // One fragment is solid shot, with no burst to time or size.
    await page.fill('#propFragments', '1');
    await page.dispatchEvent('#propFragments', 'change');
    expect(await page.isDisabled('#propFuse')).toBe(true);
    expect(await page.isDisabled('#propBurstSpeed')).toBe(true);
    await page.click('[data-add="beamTurret"]');
    expect(await page.isVisible('#shellRow')).toBe(false);
  });

  it('lets an engine be thick only once its nozzle is wider than a deck', async () => {
    await page.click('#newShip');
    await page.click('[data-add="engine"]');
    // The default is a deck wide, so already as deep as it is wide.
    expect(await page.isDisabled('#propThick')).toBe(true);
    expect(await page.getAttribute('#propThick', 'title')).toMatch(/Too narrow/);
    await page.fill('#propWidth', '6');
    await page.dispatchEvent('#propWidth', 'change');
    expect(await page.isDisabled('#propThick')).toBe(false);
    await page.check('#propThick');
    expect(await page.isChecked('#propThick')).toBe(true);
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
    await page.click('[data-add="engine"]');
    expect(await page.inputValue('#propKind')).toBe('engine');
    // Facing aft along its bell, so it pushes the ship forward.
    expect(await page.inputValue('#propAngle')).toBe('180');
    const cold = await warmth();

    await page.waitForTimeout(1200);
    const burning = await warmth();
    expect(burning).toBeGreaterThan(cold * 2);

    // Deselecting winds it down rather than cutting it.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
    expect(await warmth()).toBeLessThan(burning / 2);
  });

  it('swaps a module for another kind, keeping the way it faces', async () => {
    await page.click('#newShip');
    await page.click('[data-add="hullGun"]');
    expect(await page.inputValue('#propAngle')).toBe('0');
    await page.selectOption('#propKind', 'engine');
    expect(await page.inputValue('#propKind')).toBe('engine');
    // Its bell where the barrel was.
    expect(await page.inputValue('#propAngle')).toBe('0');
    await page.click('#undo');
    expect(await page.inputValue('#propKind')).toBe('hullGun');
  });

  it('makes an assembly of two modules, places it again, and mirrors the copy', async () => {
    // The whole reason assembling exists, driven the way a person would: this is
    // what replaces a mirrored editing mode, so symmetry is structural rather
    // than something the editor has to keep in step.
    await openShip(page, 'Corvette');
    const centre = await canvasCentre(page);

    await page.mouse.click(centre.x + 168, centre.y);
    expect(await page.inputValue('#propKind')).toBe('hullGun');
    await page.keyboard.down('Shift');
    await page.mouse.click(centre.x, centre.y);
    await page.keyboard.up('Shift');
    expect(await page.isHidden('#assemblySelection')).toBe(false);
    expect(await page.textContent('#assemblyCount')).toMatch(/2 picked/);

    await page.click('#propAssembly');
    // The module panel gives way to the assembly's own, which edits a pose and
    // not a size.
    expect(await page.isHidden('#properties')).toBe(true);
    expect(await page.isHidden('#assemblyPanel')).toBe(false);
    expect(await page.textContent('#assemblyOf')).toMatch(/2 modules/);

    await page.click('#assemblyDuplicate');
    await page.check('#assemblyMirror');
    // Still on the new copy's panel: an edit made from a panel must not
    // dismiss the panel that made it.
    expect(await page.isHidden('#assemblyPanel')).toBe(false);
    expect(await page.isChecked('#assemblyMirror')).toBe(true);

    // And the ship now has two of everything that was assembled: clicking where
    // the original's gun is picks an assembly rather than nothing.
    await page.mouse.click(centre.x + 168, centre.y);
    expect(await page.isHidden('#assemblyPanel')).toBe(false);
  });

  it('dissolves an assembly back into its modules, leaving them picked', async () => {
    await openShip(page, 'Corvette');
    const centre = await canvasCentre(page);
    await page.mouse.click(centre.x + 168, centre.y);
    await page.keyboard.down('Shift');
    await page.mouse.click(centre.x, centre.y);
    await page.keyboard.up('Shift');
    await page.click('#propAssembly');
    expect(await page.isHidden('#assemblyPanel')).toBe(false);

    await page.click('#assemblyDissolve');
    expect(await page.isHidden('#assemblyPanel')).toBe(true);
    expect(await page.textContent('#assemblyCount')).toMatch(/2 picked/);
    // Picked, and so ready to be assembled again.
    expect(await page.isDisabled('#propAssembly')).toBe(false);
    await page.click('#undo');
  });

  it('nests one assembly in another, and adds an assembly to one that is placed', async () => {
    await openShip(page, 'Corvette');
    const centre = await canvasCentre(page);
    const shiftClick = async (x: number, y: number) => {
      await page.keyboard.down('Shift');
      await page.mouse.click(x, y);
      await page.keyboard.up('Shift');
    };
    // The bow gun and the hull behind it into one assembly, then placed a second time.
    await page.mouse.click(centre.x + 168, centre.y);
    await shiftClick(centre.x, centre.y);
    await page.click('#propAssembly');
    const first = await page.inputValue('#assemblyName');
    await page.click('#assemblyDuplicate');
    const second = await page.inputValue('#assemblyName');
    expect(second).toBe(first);

    // The copy is selected; picking the original after it offers both.
    await shiftClick(centre.x + 168, centre.y);
    expect(await page.isDisabled('#propAssembly')).toBe(false);
    expect(await page.textContent('#propAddToAssembly')).toBe(`Add to ${first}`);
    // Two copies of one assembly: adding one into the other would nest it in itself.
    expect(await page.isDisabled('#propAddToAssembly')).toBe(true);
    expect(await page.getAttribute('#propAddToAssembly', 'title')).toMatch(/inside itself/);

    await page.click('#propAssembly');
    expect(await page.textContent('#assemblyOf')).toMatch(/^2 assemblies/);
    await page.click('#undo');
  });

  it('adds a new module into the selected assembly', async () => {
    await openShip(page, 'Corvette');
    const centre = await canvasCentre(page);
    await page.mouse.click(centre.x + 168, centre.y);
    await page.keyboard.down('Shift');
    await page.mouse.click(centre.x, centre.y);
    await page.keyboard.up('Shift');
    await page.click('#propAssembly');
    const name = await page.inputValue('#assemblyName');
    expect(await page.textContent('#addHeading')).toBe(`Add a module to ${name}`);

    await page.click('[data-add="engine"]');
    expect(await page.inputValue('#propKind')).toBe('engine');
    // At the assembly's own origin, which is the first module picked.
    expect(await page.inputValue('#propX')).toBe('0');
    expect(await page.inputValue('#propY')).toBe('0');
    await page.click('#propSelectAssembly');
    expect(await page.textContent('#assemblyOf')).toMatch(/^3 modules/);
    await page.click('#undo');
    expect(await page.textContent('#assemblyOf')).toMatch(/^2 modules/);
  });

  it('deletes a selected assembly with the Delete key', async () => {
    await openShip(page, 'Corvette');
    const centre = await canvasCentre(page);
    await page.mouse.click(centre.x + 168, centre.y);
    await page.keyboard.down('Shift');
    await page.mouse.click(centre.x, centre.y);
    await page.keyboard.up('Shift');
    await page.click('#propAssembly');
    expect(await page.isHidden('#assemblyPanel')).toBe(false);
    await page.keyboard.press('Delete');
    expect(await page.isHidden('#assemblyPanel')).toBe(true);
    // Gone from the ship: where its gun was is empty space now.
    await page.mouse.click(centre.x + 168, centre.y);
    expect(await page.isHidden('#assemblyPanel')).toBe(true);
    expect(await page.isHidden('#properties')).toBe(true);
    await page.click('#undo');
    await page.mouse.click(centre.x + 168, centre.y);
    expect(await page.isHidden('#assemblyPanel')).toBe(false);
  });

  it('picks the whole assembly first, and the module inside it on a second click', async () => {
    // An assembly is a part, so clicking it selects the part. Reaching what is
    // inside is deliberate rather than accidental: click it again, once the
    // assembly it belongs to is already the selection.
    await openShip(page, 'Corvette');
    const centre = await canvasCentre(page);
    await page.mouse.click(centre.x + 168, centre.y);
    await page.keyboard.down('Shift');
    await page.mouse.click(centre.x, centre.y);
    await page.keyboard.up('Shift');
    await page.click('#propAssembly');
    await page.keyboard.press('Escape');

    await page.mouse.click(centre.x + 168, centre.y);
    expect(await page.isHidden('#assemblyPanel')).toBe(false);
    expect(await page.isHidden('#properties')).toBe(true);

    await page.mouse.click(centre.x + 168, centre.y);
    expect(await page.isHidden('#assemblyPanel')).toBe(true);
    expect(await page.inputValue('#propKind')).toBe('hullGun');
  });

  it('drags a selected assembly as one part', async () => {
    // Dragging has to move what is selected. Drilling into the assembly on the
    // press would have moved one module out of it instead, which is both the
    // wrong thing and hard to notice until the ship is wrong.
    await openShip(page, 'Corvette');
    const centre = await canvasCentre(page);
    await page.mouse.click(centre.x + 168, centre.y);
    await page.keyboard.down('Shift');
    await page.mouse.click(centre.x, centre.y);
    await page.keyboard.up('Shift');
    await page.click('#propAssembly');

    const before = Number(await page.inputValue('#assemblyX'));
    await page.mouse.move(centre.x + 168, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x + 228, centre.y - 40, { steps: 8 });
    await page.mouse.up();
    // Still the assembly's panel, and the assembly is where it was dragged to.
    expect(await page.isHidden('#assemblyPanel')).toBe(false);
    expect(Number(await page.inputValue('#assemblyX'))).not.toBe(before);
  });

  it('adds a loose module to an assembly that is already placed', async () => {
    await openShip(page, 'Corvette');
    const centre = await canvasCentre(page);
    await page.mouse.click(centre.x + 168, centre.y);
    await page.keyboard.down('Shift');
    await page.mouse.click(centre.x, centre.y);
    await page.keyboard.up('Shift');
    await page.click('#propAssembly');
    expect(await page.textContent('#assemblyOf')).toMatch(/2 modules/);

    // A module outside the assembly: the corvette's main engine, aft of the
    // core along the ship's -x.
    const engine = await onCorvette(page, -9, 0);
    await page.keyboard.down('Shift');
    await page.mouse.click(engine.x, engine.y);
    await page.keyboard.up('Shift');
    expect(await page.isDisabled('#propAddToAssembly')).toBe(false);

    await page.click('#propAddToAssembly');
    // The assembly gained it, and the selection is the assembly rather than whatever
    // slid into the module's place in the list.
    expect(await page.isHidden('#assemblyPanel')).toBe(false);
    expect(await page.textContent('#assemblyOf')).toMatch(/3 modules/);
  });

  it('reaches an assembly from a module inside it', async () => {
    await openShip(page, 'Gunship');
    const centre = await canvasCentre(page);
    // The gunship's engines are all placed through assemblies, so any of
    // them is inside one.
    await page.mouse.click(centre.x, centre.y);
    const inAssembly = (await page.isDisabled('#propSelectAssembly')) === false;
    if (!inAssembly) return; // whichever module the camera put under the centre
    await page.click('#propSelectAssembly');
    expect(await page.isHidden('#assemblyPanel')).toBe(false);
  });

  it('shows what a selected assembly weighs, and what all its copies weigh', async () => {
    await openShip(page, 'Corvette');
    const centre = await canvasCentre(page);
    await page.mouse.click(centre.x + 168, centre.y);
    await page.keyboard.down('Shift');
    await page.mouse.click(centre.x, centre.y);
    await page.keyboard.up('Shift');
    await page.click('#propAssembly');

    const one = (await page.textContent('#assemblyStats')) ?? '';
    expect(one).toMatch(/Mass/);
    // One copy, so there is nothing to total.
    expect(one).not.toMatch(/copies/);

    await page.click('#assemblyDuplicate');
    const two = (await page.textContent('#assemblyStats')) ?? '';
    expect(two).toMatch(/All 2 copies/);
  });

  it('renames an assembly, and keeps the ship it names', async () => {
    await openShip(page, 'Corvette');
    const centre = await canvasCentre(page);
    await page.mouse.click(centre.x + 168, centre.y);
    await page.keyboard.down('Shift');
    await page.mouse.click(centre.x, centre.y);
    await page.keyboard.up('Shift');
    await page.click('#propAssembly');
    const mass = (await page.textContent('#stats'))?.match(/[\d,.]+ t/)?.[0];

    await page.fill('#assemblyName', 'bow mount');
    // The rename reaches the instance as well as the definition — a `use` left
    // pointing at the old name would place nothing, so the ship standing still
    // is the check that both halves happened.
    expect((await page.textContent('#stats'))?.match(/[\d,.]+ t/)?.[0]).toBe(mass);
    expect(await page.textContent('#problems')).toMatch(/No problems/);

    // Still the assembly's own panel, holding what was typed.
    expect(await page.isHidden('#assemblyPanel')).toBe(false);
    expect(await page.inputValue('#assemblyName')).toBe('bow mount');
  });

  it('steps size by the same amount every time the arrow is pressed', async () => {
    // A number input's steps are counted from its minimum, so a minimum off
    // the step grid puts every arrow press off it too — 8 became 8.1 and then
    // moved in halves.
    await openShip(page, 'Corvette');
    const centre = await canvasCentre(page);
    await page.mouse.click(centre.x, centre.y);
    await page.fill('#propLength', '8');
    // Whatever the grid is worth at this zoom: the box's arrows and a drag on
    // the canvas are two ways of saying the same thing, so the box follows it.
    const step = Number(await page.getAttribute('#propLength', 'step'));
    expect(step).toBeGreaterThan(0);
    const steps: number[] = [];
    for (let i = 0; i < 3; i++) {
      await page.locator('#propLength').press('ArrowUp');
      steps.push(Number(await page.inputValue('#propLength')));
    }
    expect(steps).toEqual([8 + step, 8 + step * 2, 8 + step * 3]);
  });

  it('snaps at a step that suits the ship on screen, not a fixed half metre', async () => {
    // The whole point: the two ends of the fleet are three orders of magnitude
    // apart, so one step cannot serve both.
    // The camera eases onto a newly opened ship rather than jumping, so the
    // step is still the last ship's for a few frames — wait for it to settle.
    // The step changes in jumps, so it can read the same twice mid-ease:
    // settled means unchanged for a whole second.
    const stepFitTo = async (ship: string): Promise<number> => {
      await page.selectOption('#ship', ship);
      const centre = await canvasCentre(page);
      await page.mouse.click(centre.x, centre.y);
      const step = async (): Promise<number> =>
        Number(await page.getAttribute('#propLength', 'step'));
      let settled = await step();
      let unchanged = 0;
      for (let i = 0; i < 100 && unchanged < 20; i++) {
        await page.waitForTimeout(50);
        const now = await step();
        unchanged = now === settled ? unchanged + 1 : 0;
        settled = now;
      }
      return settled;
    };
    const dinky = await stepFitTo('Dinky');
    const destroyer = await stepFitTo('Star Destroyer');
    expect(dinky).toBeLessThan(1);
    expect(destroyer).toBeGreaterThan(1);
    expect(destroyer / dinky).toBeGreaterThan(50);
  });

  it('draws a module that broke a rule in red, and clears the mark when it is fixed', async () => {
    await openShip(page, 'Corvette');
    expect(await redPixels(page)).toBe(0);

    // The bow gun, dragged clear of the ship: attached to nothing.
    const centre = await canvasCentre(page);
    await page.mouse.move(centre.x + 168, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x + 168, centre.y - 220, { steps: 8 });
    await page.mouse.up();
    expect(await page.textContent('#problems')).toMatch(/touches nothing/);
    expect(await redPixels(page)).toBeGreaterThan(0);

    await page.click('#undo');
    expect(await page.textContent('#problems')).toMatch(/No problems/);
    expect(await redPixels(page)).toBe(0);
  });

  it('offers barrels on a gun and not on a hull', async () => {
    // A rule of the page's own outranks the browser's for [hidden], so a row
    // laid out by this stylesheet stays on screen when hidden unless the
    // stylesheet says otherwise. Checked here because nothing else would
    // notice: the panel simply offers a field that means nothing.
    await openShip(page, 'Corvette');
    const core = await corvetteCore(page);
    await page.mouse.click(core.x, core.y);
    expect(await page.inputValue('#propKind')).toBe('core');
    expect(await page.isHidden('#barrelsRow')).toBe(true);

    const gun = await corvetteGun(page);
    await page.mouse.click(gun.x, gun.y);
    expect(await page.inputValue('#propKind')).toBe('hullGun');
    expect(await page.isHidden('#barrelsRow')).toBe(false);
    expect(await page.textContent('#barrelsLabel')).toBe('barrels');
  });

  it('offers barrels on a beam mount too, and charges for them', async () => {
    // A beam is worse for having several — the aperture is divided between
    // them and only one fires at a time — which is a reason to say what it
    // costs rather than a reason to hide the field.
    await page.click('#newShip');
    await page.click('[data-add="beamTurret"]');
    expect(await page.inputValue('#propKind')).toBe('beamTurret');
    expect(await page.isHidden('#barrelsRow')).toBe(false);
    // A beam has no barrel: what it has is the aperture the light leaves by.
    expect(await page.textContent('#barrelsLabel')).toBe('emitters');

    // Off the Gun row by name: the panel's other rows carry millimetres too,
    // and the first of them is the thickness of the walls.
    const bore = async (): Promise<number> => {
      const stats = (await page.textContent('#moduleStats')) ?? '';
      return Number(/Gun\s*(\d+) mm/.exec(stats)?.[1] ?? 0);
    };
    const one = await bore();
    expect(one).toBeGreaterThan(0);

    await page.fill('#propBarrels', '4');
    await page.dispatchEvent('#propBarrels', 'input');
    expect(await page.textContent('#moduleStats')).toMatch(/×4/);
    // Four apertures share the one the mount had, so each is half as wide.
    expect(await bore()).toBeLessThan(one);
  });

  it('keeps doctrine shut and out of the way until it is asked for', async () => {
    // The feature is meant to be ignorable: a ship can be drawn without this
    // section ever being opened, and what it says while shut is which
    // archetype is deciding rather than a number anyone has to read.
    await openShip(page, 'Corvette');
    const core = await corvetteCore(page);
    await page.mouse.click(core.x, core.y);
    expect(await page.inputValue('#propKind')).toBe('core');
    // A core is asked what its ship does; it is not asked what it shoots at.
    expect(await page.isHidden('#mountDoctrine')).toBe(true);
    expect(await page.isHidden('#shipDoctrine')).toBe(false);
    expect(await page.isHidden('#shipDoctrineFields')).toBe(true);

    const gun = await corvetteGun(page);
    await page.mouse.click(gun.x, gun.y);
    expect(await page.inputValue('#propKind')).toBe('hullGun');
    expect(await page.isHidden('#shipDoctrine')).toBe(true);
    // The corvette's gun states three preferences of its own.
    expect(await page.textContent('#mountDoctrineSummary')).toBe('hull gun, 3 changes');
    // Shut, so none of its thirteen boxes is between anyone and the layout.
    expect(await page.isHidden('#mountDoctrineFields')).toBe(true);
  });

  it('states a gun’s preference, and takes it back out of the ship', async () => {
    await openShip(page, 'Corvette');
    const gun = await corvetteGun(page);
    await page.mouse.click(gun.x, gun.y);
    await page.click('#mountDoctrine > summary');
    expect(await page.isHidden('#mountDoctrineFields')).toBe(false);

    // Empty over a placeholder of what happens anyway, which is how a box
    // says "the archetype decides this" rather than "zero".
    const box = page.locator('#doctrine-mount-focusWeight');
    expect(await box.inputValue()).toBe('');
    expect(await box.getAttribute('placeholder')).toBe('300');

    await box.fill('0');
    await page.dispatchEvent('#doctrine-mount-focusWeight', 'input');
    // On top of the three the corvette's gun already states.
    expect(await page.textContent('#mountDoctrineSummary')).toBe('hull gun, 4 changes');

    // Clearing it takes the statement back out rather than writing a zero, so
    // the gun goes back to only what its file says.
    await box.fill('');
    await page.dispatchEvent('#doctrine-mount-focusWeight', 'input');
    expect(await page.textContent('#mountDoctrineSummary')).toBe('hull gun, 3 changes');
  });

  it('edits the ship’s own doctrine from its core', async () => {
    await openShip(page, 'Corvette');
    const core = await corvetteCore(page);
    await page.mouse.click(core.x, core.y);
    await page.click('#shipDoctrine > summary');
    // The Corvette already says nine things — among them that it fights above
    // its weight — so the count is what the file states rather than nothing.
    expect(await page.textContent('#shipDoctrineSummary')).toBe('9 changes');
    expect(await page.locator('#doctrine-targeting-preferredMass').inputValue()).toBe('3');

    // One the file leaves to the archetype.
    const box = page.locator('#doctrine-approach-brake');
    expect(await box.inputValue()).toBe('');
    await box.fill('0.9');
    await page.dispatchEvent('#doctrine-approach-brake', 'input');
    expect(await page.textContent('#shipDoctrineSummary')).toBe('10 changes');

    await page.click('#shipDoctrineReset');
    expect(await page.textContent('#shipDoctrineSummary')).toBe('default');
    expect(await box.inputValue()).toBe('');
  });

  it('sizes a module about its middle when Shift is held', async () => {
    await page.click('#newShip');
    await page.click('[data-add="structure"]');
    await page.keyboard.press('f');
    const centre = await canvasCentre(page);
    await page.keyboard.down('Alt');
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x + 200, centre.y, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    const scale = 200 / Number(await page.inputValue('#propX'));
    await page.click('#undo');

    const width = Number(await page.inputValue('#propWidth'));
    // The +y edge, dragged a metre out with Shift: both edges move, the middle stays.
    const edge = { x: centre.x, y: centre.y - (width / 2) * scale };
    await page.mouse.move(edge.x, edge.y);
    await page.keyboard.down('Shift');
    await page.mouse.down();
    await page.mouse.move(edge.x, edge.y - 1 * scale, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    expect(Number(await page.inputValue('#propWidth'))).toBe(width + 2);
    expect(await page.inputValue('#propY')).toBe('0');
    await page.click('#undo');
    expect(Number(await page.inputValue('#propWidth'))).toBe(width);
  });

  it('sizes a module by a corner or an edge and turns it by its knob', async () => {
    // A ship of one module, so the camera's fit puts that module's centre at
    // the middle of the canvas and its handles can be worked out rather than
    // aimed at. Pixels per metre is measured here rather than assumed, since it
    // comes from a fit that depends on the canvas size.
    await page.click('#newShip');
    await page.click('[data-add="structure"]');
    await page.keyboard.press('f');
    const centre = await canvasCentre(page);

    // Alt to escape the grid: a measuring drag that snapped would put the
    // error in the scale into every drag worked out from it, and how far out
    // that lands depends on the canvas size.
    await page.keyboard.down('Alt');
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x + 200, centre.y, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    const scale = 200 / Number(await page.inputValue('#propX'));
    await page.click('#undo');
    expect(await page.inputValue('#propX')).toBe('0');

    const length = Number(await page.inputValue('#propLength'));
    const width = Number(await page.inputValue('#propWidth'));
    // The corner at +x/+y; screen y grows downward where the world's grows up.
    const corner = { x: centre.x + (length / 2) * scale, y: centre.y - (width / 2) * scale };
    await page.mouse.move(corner.x, corner.y);
    await page.mouse.down();
    await page.mouse.move(corner.x + 2 * scale, corner.y - 1 * scale, { steps: 6 });
    await page.mouse.up();
    // The opposite corner stays put, so the middle moves half as far as the
    // corner did.
    expect(Number(await page.inputValue('#propLength'))).toBe(length + 2);
    expect(Number(await page.inputValue('#propWidth'))).toBe(width + 1);
    expect(await page.inputValue('#propX')).toBe('1');
    expect(await page.inputValue('#propY')).toBe('0.5');
    await page.click('#undo');

    // The -x edge, dragged three metres out and wandering across as it goes:
    // only the length changes, and the +x edge stays where it was.
    const edge = { x: centre.x - (length / 2) * scale, y: centre.y };
    await page.mouse.move(edge.x, edge.y);
    await page.mouse.down();
    await page.mouse.move(edge.x - 3 * scale, edge.y + 2 * scale, { steps: 6 });
    await page.mouse.up();
    expect(Number(await page.inputValue('#propLength'))).toBe(length + 3);
    expect(Number(await page.inputValue('#propWidth'))).toBe(width);
    expect(await page.inputValue('#propX')).toBe('-1.5');
    expect(await page.inputValue('#propY')).toBe('0');
    await page.click('#undo');

    const knob = { x: centre.x + (length / 2) * scale + ROTATE_ARM_PX, y: centre.y };
    await page.mouse.move(knob.x, knob.y);
    await page.mouse.down();
    await page.mouse.move(centre.x, centre.y - 6 * scale, { steps: 6 });
    await page.mouse.up();
    expect(await page.inputValue('#propAngle')).toBe('90');

    // One drag, one undo: a turn is one action to the player however many
    // blueprints it took.
    await page.click('#undo');
    expect(await page.inputValue('#propAngle')).toBe('0');
    expect(Number(await page.inputValue('#propLength'))).toBe(length);
  });

  it('turns a selected assembly by its knob, about its origin', async () => {
    await page.click('#newShip');
    await page.click('[data-add="structure"]');
    await page.click('#propDuplicate');
    await page.click('#propSelectAssembly');
    expect(await page.inputValue('#assemblyAngle')).toBe('0');
    const x = await page.inputValue('#assemblyX');
    const y = await page.inputValue('#assemblyY');
    await page.keyboard.press('f');

    // Found by colour, since the camera refits: the knob is the far end of a
    // gold arm drawn out from the assembly's origin.
    const arm = await page.evaluate(() => {
      const canvas = document.getElementById('view') as HTMLCanvasElement;
      const { data, width, height } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
      let far = { x: -1, y: -1 };
      const gold: { x: number; y: number }[] = [];
      for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
          const k = (py * width + px) * 4;
          if (Math.abs(data[k]! - 233) + Math.abs(data[k + 1]! - 192) + Math.abs(data[k + 2]! - 95) > 30) continue;
          gold.push({ x: px, y: py });
          if (px > far.x) far = { x: px, y: py };
        }
      }
      const row = gold.filter((p) => Math.abs(p.y - far.y) <= 1);
      const near = Math.min(...row.map((p) => p.x));
      const rect = canvas.getBoundingClientRect();
      const toCss = rect.width / canvas.width;
      return {
        knob: { x: rect.left + (far.x - 4) * toCss, y: rect.top + far.y * toCss },
        pivot: { x: rect.left + near * toCss, y: rect.top + far.y * toCss },
      };
    });
    await page.mouse.move(arm.knob.x, arm.knob.y);
    await page.mouse.down();
    await page.mouse.move(arm.pivot.x, arm.pivot.y - 150, { steps: 8 });
    await page.mouse.up();
    expect(await page.inputValue('#assemblyAngle')).toBe('90');
    // Turned about its origin, which has not moved.
    expect(await page.inputValue('#assemblyX')).toBe(x);
    expect(await page.inputValue('#assemblyY')).toBe(y);

    await page.click('#undo');
    expect(await page.inputValue('#assemblyAngle')).toBe('0');
  });

  it('sets a hull gun\'s barrel in calibres by dragging the split between it and the block', async () => {
    await page.click('#newShip');
    await page.click('[data-add="hullGun"]');
    expect(Number(await page.inputValue('#propBarrelCalibres'))).toBe(10);
    expect(await page.textContent('#barrelMetres')).toBe('= 4.00 m');
    // Half barrel, so the split is in the middle, where a new module is drawn.
    const centre = await canvasCentre(page);
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x + 40, centre.y + 30, { steps: 6 });
    await page.mouse.up();
    // Towards the muzzle is less barrel, in whole calibres, and the gun has not moved.
    const shorter = Number(await page.inputValue('#propBarrelCalibres'));
    expect(shorter).toBeLessThan(10);
    expect(shorter).toBeGreaterThan(0);
    expect(Number.isInteger(shorter)).toBe(true);
    expect(await page.inputValue('#propX')).toBe('0');
    expect(await page.inputValue('#propY')).toBe('0');
    await page.click('#undo');
    expect(Number(await page.inputValue('#propBarrelCalibres'))).toBe(10);
    // A bell is an engine's alone now.
    expect(await page.isHidden('#nozzleRow')).toBe(true);
  });

  it('repeats an assembly, and takes the step away when it drops back to one', async () => {
    await openShip(page, 'Corvette');
    const centre = await canvasCentre(page);
    // The hull, made into a shared part so that there is an assembly to place in a
    // row, and then selected as the assembly rather than as the module.
    await page.mouse.click(centre.x, centre.y);
    await page.click('#propDuplicate');
    await page.click('#propSelectAssembly');
    expect(await page.inputValue('#assemblyRepeat')).toBe('1');
    // A step means nothing with one copy, so its boxes are not offered.
    expect(await page.isHidden('#assemblyStepRow')).toBe(true);

    await page.fill('#assemblyRepeat', '3');
    expect(await page.isHidden('#assemblyStepRow')).toBe(false);
    // Seeded from the assembly's own length, so the copies land beyond each other
    // rather than all on the first.
    expect(Number(await page.inputValue('#assemblyStepX'))).toBeGreaterThan(0);
    expect((await page.textContent('#stats')) ?? '').toMatch(/Modules/);

    await page.fill('#assemblyRepeat', '1');
    expect(await page.isHidden('#assemblyStepRow')).toBe(true);
    await page.click('#undo');
  });

  it('duplicates a ship under a counted name, leaving the original alone', async () => {
    await openShip(page, 'Corvette');
    await page.click('#duplicateShip');
    expect(await page.inputValue('#shipName')).toBe('Corvette 2');
    // Unsaved until the player says so, like a new ship.
    expect(await page.textContent('#ship')).toMatch(/Corvette 2 \(unsaved\)/);
    await page.click('#saveShip');
    await page.click('#duplicateShip');
    expect(await page.inputValue('#shipName')).toBe('Corvette 3');

    // The one it was copied from is untouched and still opens.
    await openShip(page, 'Corvette');
    expect(await page.inputValue('#shipName')).toBe('Corvette');
    await page.evaluate(() => window.localStorage.removeItem('scs2d.blueprint.Corvette 2'));
    await page.reload();
  });

  it('keeps the shipped ship openable after one is saved over its name', async () => {
    await openShip(page, 'Corvette');
    await page.fill('#shipNotes', 'mine now');
    await page.click('#saveShip');
    expect(await page.textContent('#ship')).toMatch(/Corvette \(stock\)/);

    // The name opens the player's copy, and the shipped hull is still there
    // to start from rather than buried under it.
    await openShip(page, 'stock:Corvette');
    expect(await page.inputValue('#shipNotes')).not.toBe('mine now');
    await openShip(page, 'Corvette');
    expect(await page.inputValue('#shipNotes')).toBe('mine now');

    await page.evaluate(() => window.localStorage.removeItem('scs2d.blueprint.Corvette'));
    await page.reload();
    expect(await page.textContent('#ship')).not.toMatch(/\(stock\)/);
  });

  it('clears the editor when a ship is deleted, and gives it back on undo', async () => {
    await openShip(page, 'Corvette');
    await page.click('#duplicateShip');
    await page.click('#saveShip');
    const name = await page.inputValue('#shipName');
    const ship = (await page.textContent('#stats')) ?? '';

    page.once('dialog', (dialog) => void dialog.accept());
    await page.click('#deleteShip');
    // Blank, and gone from the library: what is drawn and what the library
    // holds never disagree.
    expect(await page.inputValue('#shipName')).toMatch(/^New ship/);
    expect(await page.textContent('#ship')).not.toMatch(new RegExp(`${name}`));

    // The way back is the way back from any other edit, and the ship can be
    // saved again from there.
    await page.click('#undo');
    expect(await page.inputValue('#shipName')).toBe(name);
    expect(await page.textContent('#stats')).toBe(ship);
    await page.click('#saveShip');
    expect(await page.textContent('#ship')).toMatch(new RegExp(`${name}`));

    page.once('dialog', (dialog) => void dialog.accept());
    await page.click('#deleteShip');
    await page.reload();
  });

  it('adds a module, and says what is now wrong with the layout', async () => {
    await openShip(page, 'Corvette');
    await page.click('[data-add="turret"]');
    // The new module lands at the middle of the view, which is inside the
    // hull — so the layout is invalid and the panel says so. It is still a
    // layout that can be saved and opened again: work in progress is the
    // normal state of one, and a ship that cannot be reopened cannot be fixed.
    expect(await page.textContent('#problems')).toMatch(/problem/);
    expect(await page.isDisabled('#saveShip')).toBe(false);

    await page.click('#undo');
    expect(await page.textContent('#problems')).toMatch(/would fly/);
  });

  it('pushes a neighbour with an edge, and moves the face two modules share', async () => {
    // Two equal blocks side by side, so the fit centres the canvas on the face
    // between them at x = 0.
    await page.evaluate(() => {
      const pair = {
        formatVersion: 1,
        name: 'Pair',
        modules: [
          { kind: 'structure', x: -2, y: 0, length: 4, width: 4 },
          { kind: 'structure', x: 2, y: 0, length: 4, width: 4 },
        ],
      };
      window.localStorage.setItem('scs2d.blueprint.Pair', JSON.stringify(pair));
    });
    await page.reload();
    await openShip(page, 'Pair');
    await page.keyboard.press('f');
    const centre = await canvasCentre(page);

    // Pixels per metre, from an unsnapped drag of the left block.
    await page.keyboard.down('Alt');
    await page.mouse.move(centre.x - 20, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x - 20 + 100, centre.y, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    const scale = 100 / (Number(await page.inputValue('#propX')) + 2);
    await page.click('#undo');
    const xOf = async (worldX: number) => {
      await page.mouse.click(centre.x + worldX * scale, centre.y + 1.5 * scale);
      return [Number(await page.inputValue('#propX')), Number(await page.inputValue('#propLength'))];
    };

    // The left block's +x edge, at the middle, dragged a metre right: the
    // right block goes with it.
    const edge = async (modifier: boolean) => {
      await page.mouse.click(centre.x - 2 * scale, centre.y);
      if (modifier) await page.keyboard.down('Control');
      await page.mouse.move(centre.x, centre.y);
      await page.mouse.down();
      await page.mouse.move(centre.x + scale, centre.y, { steps: 4 });
      await page.mouse.up();
      if (modifier) await page.keyboard.up('Control');
    };
    await edge(false);
    expect(await xOf(-2)).toEqual([-1.5, 5]);
    expect(await xOf(3)).toEqual([3, 4]);
    await page.click('#undo');
    // With Ctrl, the left block grows into the right one alone.
    await edge(true);
    expect(await xOf(3.5)).toEqual([2, 4]);
    expect(await page.textContent('#problems')).toMatch(/overlap/);
    await page.click('#undo');

    // Both selected: the bar on the face between them moves it, one block
    // growing as the other shrinks.
    await page.mouse.click(centre.x - 2 * scale, centre.y);
    await page.keyboard.down('Shift');
    await page.mouse.click(centre.x + 2 * scale, centre.y);
    await page.keyboard.up('Shift');
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x + scale, centre.y, { steps: 4 });
    await page.mouse.up();
    expect(await xOf(-2)).toEqual([-1.5, 5]);
    expect(await xOf(3)).toEqual([2.5, 3]);
    // One drag, one undo.
    await page.click('#undo');
    expect(await xOf(2)).toEqual([2, 4]);
    await page.evaluate(() => window.localStorage.removeItem('scs2d.blueprint.Pair'));
  });

  it('shapes a module into a wedge, and drags one corner of it', async () => {
    // One block on its own, so the fit centres the canvas on its middle.
    await page.evaluate((written) => {
      window.localStorage.setItem('scs2d.blueprint.Plate', written);
    }, JSON.stringify({ formatVersion: 1, ...PLATE }));
    await page.reload();
    await openShip(page, 'Plate');
    await page.keyboard.press('f');
    // Where a point of the layout lands once it is framed, worked out the way
    // the page fits its view: the fit centres on the centre of mass, which a
    // core beside a plate is not in the middle of.
    const box = await page.locator('#view').boundingBox();
    const size = await page.evaluate(() => {
      const canvas = document.getElementById('view') as HTMLCanvasElement;
      return { width: canvas.width, height: canvas.height };
    });
    if (box === null) throw new Error('the canvas has no box');
    const design = new EditorDocument(PLATE).view.design;
    if (design === null) throw new Error('the plate does not compile');
    const camera: Camera = { x: 0, y: 0, scale: 1 };
    frame(camera, previewSnapshot(design), size.width, size.height, 1);
    const cssPerPx = box.width / size.width;
    const scale = camera.scale * cssPerPx;
    const at = (x: number, y: number) => ({
      x: box.x + (size.width / 2 + (x - camera.x) * camera.scale) * cssPerPx,
      y: box.y + (size.height / 2 - (y - camera.y) * camera.scale) * cssPerPx,
    });
    const centre = at(0, 0);

    // The plate becomes the wedge filling its own box: the position moves onto
    // the corners' own middle, and the box round them is the one it had.
    await page.mouse.click(centre.x, centre.y);
    expect(await page.locator('#shapeRow').isHidden()).toBe(false);
    await page.check('#propShape');
    expect(Number(await page.inputValue('#propX'))).toBeCloseTo(-2 / 3, 3);
    expect(Number(await page.inputValue('#propLength'))).toBe(4);
    expect(Number(await page.inputValue('#propWidth'))).toBe(4);

    // Clicking the bow corner of that box misses it: the wedge is not there.
    await page.mouse.click(centre.x + 1.8 * scale, centre.y - 1.8 * scale);
    expect(await page.locator('#properties').isHidden()).toBe(true);

    // The nose, at x = 2, dragged two metres forward. The stern stays put, so
    // the module grows along its length alone.
    await page.mouse.click(centre.x, centre.y);
    await page.mouse.move(centre.x + 2 * scale, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x + 4 * scale, centre.y, { steps: 4 });
    await page.mouse.up();
    expect(Number(await page.inputValue('#propLength'))).toBe(6);
    expect(Number(await page.inputValue('#propWidth'))).toBe(4);
    expect(await page.textContent('#problems')).not.toMatch(/overlap/);

    // Squared off again, it is the box its corners fitted, where that box was.
    await page.uncheck('#propShape');
    expect(Number(await page.inputValue('#propLength'))).toBe(6);
    expect(Number(await page.inputValue('#propX'))).toBeCloseTo(1, 3);
    await page.evaluate(() => window.localStorage.removeItem('scs2d.blueprint.Plate'));
  });

  it('lands a dragged module flush against what is already there', async () => {
    await openWritten(page, 'Snapping', SNAPPING_FILE);
    const { at } = await framing(page, SNAPPING);
    // The adrift plate, dragged most of the way onto the hull's bow face at
    // 6.3 but deliberately not all of it, and not by a whole grid step.
    const flush = 8.3;
    await page.mouse.move(at(12, 0).x, at(12, 0).y);
    await page.mouse.down();
    await page.mouse.move(at(flush + 0.12, 0).x, at(flush + 0.12, 0).y, { steps: 6 });
    await page.mouse.up();
    expect(Number(await page.inputValue('#propX'))).toBeCloseTo(flush, 6);

    // Alt escapes it, as it escapes the grid: the drag then means what it says.
    await page.keyboard.down('Alt');
    await page.mouse.move(at(flush, 0).x, at(flush, 0).y);
    await page.mouse.down();
    await page.mouse.move(at(flush + 0.12, 0).x, at(flush + 0.12, 0).y, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    const escaped = Number(await page.inputValue('#propX'));
    expect(escaped).toBeGreaterThan(flush + 0.05);
  });

  it('turns a module onto an angle the design is already drawn at', async () => {
    await openWritten(page, 'Snapping', SNAPPING_FILE);
    const { at, scale } = await framing(page, SNAPPING);
    // The adrift plate, taken by its knob and swung towards 19° and then 23°:
    // both nearer the 20° the turned plate is drawn at than any multiple of 15.
    const middle = at(12, 0);
    await page.mouse.click(middle.x, middle.y);
    const arm = 2 * scale + ROTATE_ARM_PX;
    const swing = async (degrees: number): Promise<number> => {
      const radians = (degrees * Math.PI) / 180;
      await page.mouse.move(middle.x + arm, middle.y);
      await page.mouse.down();
      await page.mouse.move(middle.x + arm * Math.cos(radians), middle.y - arm * Math.sin(radians), { steps: 6 });
      await page.mouse.up();
      const turned = Number(await page.inputValue('#propAngle'));
      await page.click('#undo');
      return turned;
    };
    expect(await swing(19)).toBeCloseTo(20, 6);
    expect(await swing(23)).toBeCloseTo(20, 6);
    // And a swing near no drawn angle still lands on the increments.
    expect(await swing(44)).toBeCloseTo(45, 6);
  });

  it('eases to a different ship’s scale, so switching shows which is bigger', async () => {
    // Pixels bright enough to be hull, which the grid and the background are not.
    const hull = (): Promise<number> =>
      page.evaluate(() => {
        const canvas = document.getElementById('view') as HTMLCanvasElement;
        const ctx = canvas.getContext('2d');
        if (ctx === null) return 0;
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let n = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i]! + data[i + 1]! + data[i + 2]! > 450) n++;
        }
        return n;
      });
    await openShip(page, 'Corvette');
    await page.waitForTimeout(100);
    await page.selectOption('#ship', 'Dinky');
    // The Dinky first appears at the corvette's scale, and grows into frame.
    const early = await hull();
    await page.waitForTimeout(1500);
    const late = await hull();
    expect(early).toBeGreaterThan(0);
    expect(late / early).toBeGreaterThan(2);
    await openShip(page, 'Corvette');
  });

  it('opens a saved ship that breaks the design rules, rather than refusing it', async () => {
    // The layout a player left half-finished, or one an older version of the
    // format wrote: it has to come back up with its faults named, since the
    // editor is the only place they can be put right.
    await page.evaluate(() => {
      const broken = {
        formatVersion: 1,
        name: 'Adrift',
        modules: [
          { kind: 'core', x: 0, y: 0, length: 4, width: 4 },
          { kind: 'engine', x: -20, y: 0, angle: 0, length: 3, width: 3 },
        ],
      };
      window.localStorage.setItem('scs2d.blueprint.Adrift', JSON.stringify(broken));
    });
    await page.reload();
    await openShip(page, 'Adrift');
    expect(await page.textContent('#problems')).toMatch(/touches nothing/);
    // Drawn, not merely complained about: the ship is on the canvas to drag.
    expect(await page.textContent('#stats')).toMatch(/Modules/);
    await page.evaluate(() => window.localStorage.removeItem('scs2d.blueprint.Adrift'));
  });

  it('imports a ship with a key it does not read, says so, and saves the key back', async () => {
    // A hand-edited file with a typo opens rather than being refused.
    const typo = {
      formatVersion: 1,
      name: 'Typo',
      colour: 'red',
      modules: [
        { kind: 'core', x: 0, y: 0, length: 4, width: 4 },
        { kind: 'turret', x: 3, y: 0, length: 2, width: 2, barrel: 8 },
      ],
    };
    await page.setInputFiles('#importShip', {
      name: 'typo.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(typo)),
    });
    await page.waitForFunction(() => /Kept as written/.test(document.getElementById('problems')?.textContent ?? ''));
    const problems = (await page.textContent('#problems')) ?? '';
    expect(problems).toMatch(/colour/);
    expect(problems).toMatch(/modules\[1\][^]*barrel/);
    await page.click('#saveShip');
    const saved = await page.evaluate(() => window.localStorage.getItem('scs2d.blueprint.Typo'));
    expect(JSON.parse(saved!)).toMatchObject({ colour: 'red', modules: [{}, { barrel: 8 }] });
    await page.evaluate(() => window.localStorage.removeItem('scs2d.blueprint.Typo'));
  });

  it('hands the ship being edited to a custom battle as a fleet of one', async () => {
    await openShip(page, 'Corvette');
    await page.click('#battleLink');
    await page.waitForFunction(() => document.getElementById('custom')?.hidden === false);
    expect(await page.locator('#fleetSlots select option:checked').first().textContent()).toBe(
      'Corvette (from the editor)',
    );
    await page.waitForFunction(() => /Corvette.*1\/1 ships/.test(document.getElementById('sides')?.textContent ?? ''));
    await page.goBack();
  });
});
