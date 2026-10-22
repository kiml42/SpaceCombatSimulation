import { describe, expect, it } from 'vitest';
import {
  approachOf,
  approachTurn,
  compileBlueprint,
  compileDraft,
  padApproach,
  weldDesigns,
  type Blueprint,
  type ModuleSpec,
} from '../sim/index.js';

/** The way a fighter comes in to a pad, worked out once when its carrier is compiled. */

const PAD = 2;

/** A core, a tank astern and a pad on the bow, with `more` beside it. */
function carrier(...more: ModuleSpec[]): Blueprint {
  return {
    name: 'Carrier',
    modules: [
      { kind: 'core', x: 0, y: 0, length: 6, width: 6 },
      { kind: 'tank', x: -13, y: 0, length: 20, width: 10 },
      { kind: 'pad', x: 13, y: 0, length: 20, width: 20 },
      ...more,
    ],
  };
}

describe("a pad's approach", () => {
  it('is compiled with its carrier, and comes in over open space', () => {
    const design = compileBlueprint(carrier());
    expect(design.approaches?.map((a) => a.pad)).toEqual([PAD]);
    const approach = approachOf(design, PAD)!;
    // Over the bow, out of the hull's way, the whole run clear.
    expect(approach.angle).toBeCloseTo(0, 9);
    expect(approach.clear).toBe(Math.ceil(2 * design.radius));
    expect(approach.open).toBe(approach.clear);
    expect(approach).toEqual(padApproach(design, PAD));
  });

  it('turns from what is in the fighters’ layer', () => {
    // A turret off the bow stands in the way that side: held off on nothing, which a draft allows.
    const design = compileDraft(carrier({ kind: 'turret', x: 30, y: 0, length: 4, width: 4 }));
    const approach = approachOf(design, PAD)!;
    expect(Math.abs(Math.sin(approach.angle))).toBeCloseTo(1, 9);
    expect(approach.clear).toBe(Math.ceil(2 * design.radius));
  });

  it('turns with its pad when the carrier is welded into something else', () => {
    const design = compileBlueprint(carrier());
    const other = compileBlueprint({ name: 'Block', modules: [{ kind: 'core', x: 0, y: 0, length: 4, width: 4 }] });
    // The carrier welded on a quarter turn round, astern of the block.
    const welded = weldDesigns(other, design, -30, 0, Math.PI / 2, 0, 1, 4, null);
    const pad = welded.modules.findIndex((m) => m.spec.kind === 'pad');
    expect(approachOf(welded, pad)).toBe(approachOf(design, PAD));
    expect(approachTurn(welded, pad)).toBeCloseTo(Math.PI / 2, 9);
  });

  it('is absent from a ship with no pads', () => {
    expect(compileBlueprint({ name: 'Bare', modules: [{ kind: 'core', x: 0, y: 0, length: 6, width: 6 }] }).approaches).toBeUndefined();
  });
});
