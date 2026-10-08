import { describe, expect, it } from 'vitest';
import { compileBlueprint, HULL_LAYER, landedIndex, type Blueprint } from '../sim/index.js';
import { CORVETTE } from '../scenarios/blueprints.js';
import { landOnSelf, previewSnapshot } from '../editor/preview.js';

/**
 * An engine pushing forward off the back of a hull, with a girder running aft
 * past its flame and a block hung from the girder across one edge of the
 * flame — the upper third of the nozzle, a metre out.
 */
const BLOCKED: Blueprint = {
  name: 'Blocked',
  modules: [
    { kind: 'engine', x: -5, y: 0, angle: Math.PI, length: 2, width: 4, thick: true },
    { kind: 'core', x: 0, y: 0, angle: 0, length: 10, width: 6 },
    { kind: 'structure', x: -20, y: 3.5, angle: 0, length: 50, width: 1 },
    { kind: 'structure', x: -9, y: 2, angle: 0, length: 2, width: 2 },
  ],
};

describe('the editor drawing an engine that fires into its own hull', () => {
  const design = compileBlueprint(BLOCKED);

  it('lights it at full throttle, and leaves every clear engine cold', () => {
    const view = previewSnapshot(design).ships[0]!;
    expect(design.engines[0]!.escaping).toBeLessThan(1);
    expect(view.throttles[0]).toBe(1);
    const corvette = previewSnapshot(compileBlueprint(CORVETTE)).ships[0]!;
    expect(corvette.throttles.every((throttle) => throttle === 0)).toBe(true);
  });

  it('says where its flame lands, for the renderer to cut it there and draw the burn', () => {
    const view = previewSnapshot(design).ships[0]!;
    // Only the third the block stands across lands.
    const thirds = [0, 1, 2].map((ray) => view.landed[landedIndex(design, 0, ray, HULL_LAYER)]!);
    expect(thirds.filter((share) => share > 0).length).toBe(1);
  });

  it('lands nothing for a ship whose engines are clear, however hard they burn', () => {
    const corvette = compileBlueprint(CORVETTE);
    const view = previewSnapshot(corvette).ships[0]!;
    view.throttles.fill(1);
    landOnSelf(view);
    expect(view.landed.every((share) => share === 0)).toBe(true);
  });
});
