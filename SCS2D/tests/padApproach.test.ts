import { describe, expect, it } from 'vitest';
import {
  approachesOf,
  approachTurn,
  compileBlueprint,
  compileDraft,
  padApproaches,
  weldDesigns,
  type Blueprint,
  type ModuleSpec,
  type PadApproach,
} from '../sim/index.js';
import { STAR_DESTROYER } from '../scenarios/blueprints.js';

/** The ways a fighter can come in to a pad, worked out once when its carrier is compiled. */

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

/** The ways' angles in eighths of a turn, 0 to 7. */
const eighths = (ways: readonly PadApproach[]): number[] =>
  ways.map((w) => ((Math.round((w.angle * 4) / Math.PI) % 8) + 8) % 8).sort((a, b) => a - b);

describe("a pad's ways in", () => {
  it('are compiled with its carrier: every side and corner clear of the fighters’ layer', () => {
    const design = compileBlueprint(carrier());
    const ways = approachesOf(design, PAD);
    expect(ways).toEqual(padApproaches(design, PAD));
    expect(design.approaches).toEqual(ways);
    // Nothing on this carrier stands up into the fighters' layer.
    expect(eighths(ways)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    for (const way of ways) expect(way.clear).toBe(Math.ceil(2 * design.radius));
  });

  it('leave out a way something in the fighters’ layer stands in', () => {
    // A turret off the bow, held off on nothing, which a draft allows.
    const design = compileDraft(carrier({ kind: 'turret', x: 30, y: 0, length: 4, width: 4 }));
    const ways = eighths(approachesOf(design, PAD));
    expect(ways).not.toContain(0);
    expect(ways).toContain(2);
    expect(ways).toContain(6);
  });

  it('are the one longest run when none is clear', () => {
    // Turrets all round.
    const ring: ModuleSpec[] = [
      { kind: 'turret', x: 30, y: 0, length: 4, width: 4 },
      { kind: 'turret', x: -30, y: 0, length: 4, width: 40 },
      { kind: 'turret', x: 13, y: 20, length: 40, width: 4 },
      { kind: 'turret', x: 13, y: -20, length: 40, width: 4 },
    ];
    const design = compileDraft(carrier(...ring));
    const ways = approachesOf(design, PAD);
    expect(ways).toHaveLength(1);
    expect(ways[0]!.clear).toBeLessThan(Math.ceil(2 * design.radius));
  });

  it("are the Star Destroyer's three outboard sides and the two corners between them", () => {
    const design = compileBlueprint(STAR_DESTROYER);
    const pads = design.modules.flatMap((m, i) => (m.spec.kind === 'pad' ? [i] : []));
    expect(pads.length).toBeGreaterThan(0);
    for (const pad of pads) {
      // Away from the centre line, whichever side of it the pad is.
      const outboard = design.modules[pad]!.spec.y < 0 ? 6 : 2;
      expect(eighths(approachesOf(design, pad))).toEqual([0, outboard - 1, outboard, outboard + 1, 4].sort((a, b) => a - b));
    }
  });

  it('turn with their pad when the carrier is welded into something else', () => {
    const design = compileBlueprint(carrier());
    const other = compileBlueprint({ name: 'Block', modules: [{ kind: 'core', x: 0, y: 0, length: 4, width: 4 }] });
    // The carrier welded on a quarter turn round, astern of the block.
    const welded = weldDesigns(other, design, -30, 0, Math.PI / 2, 0, 1, 4, null);
    const pad = welded.modules.findIndex((m) => m.spec.kind === 'pad');
    expect(approachesOf(welded, pad)).toEqual(approachesOf(design, PAD));
    expect(approachTurn(welded, pad)).toBeCloseTo(Math.PI / 2, 9);
  });

  it('are absent from a ship with no pads', () => {
    expect(compileBlueprint({ name: 'Bare', modules: [{ kind: 'core', x: 0, y: 0, length: 6, width: 6 }] }).approaches).toBeUndefined();
  });
});
