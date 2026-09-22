import { describe, expect, it } from 'vitest';
import {
  blueprintFaults,
  blueprintProblem,
  blueprintProblems,
  compileBlueprint,
  compileDraft,
  expandBlueprint,
  expandWithOrigins,
  isInstance,
  math,
  placementAt,
  samePlacement,
  type Blueprint,
  type ModuleSpec,
} from '../sim/index.js';
import { CORVETTE, GUNSHIP } from '../scenarios/blueprints.js';

/**
 * Provenance: which placement each expanded module came from.
 *
 * The flat list a ship is built from has thrown away how it was written, and
 * an editor needs that back — "the eighth module" is not something a player
 * can edit when seven of the eight are copies of one thruster. The property
 * that matters is that the answer is *exactly* the placement, since every
 * edit an editor makes is applied through it.
 */

// The core, so a fixture is a ship and its faults are the ones under test.
const hull: ModuleSpec = { kind: 'core', x: 0, y: 0, length: 20, width: 6 };

function ship(blueprint: Omit<Blueprint, 'name'>): Blueprint {
  return { name: 'Test', ...blueprint };
}

describe('expandWithOrigins', () => {
  it('expands identically to expandBlueprint', () => {
    for (const blueprint of [CORVETTE, GUNSHIP]) {
      expect(expandWithOrigins(blueprint).modules).toEqual(expandBlueprint(blueprint));
    }
  });

  it('gives one origin per module', () => {
    const { modules, origins } = expandWithOrigins(CORVETTE);
    expect(origins).toHaveLength(modules.length);
  });

  it('leads back to the placement that wrote each module', () => {
    const { modules, origins } = expandWithOrigins(CORVETTE);
    for (let i = 0; i < modules.length; i++) {
      const placement = placementAt(CORVETTE, origins[i]!.path);
      expect(placement).not.toBeNull();
      expect(isInstance(placement!)).toBe(false);
      // The placement keeps the size it was written at; only its position and
      // facing are moved by the frame it is placed in.
      expect((placement as ModuleSpec).kind).toBe(modules[i]!.kind);
      expect((placement as ModuleSpec).length).toBe(modules[i]!.length);
    }
  });

  it('gives every copy of a shared part the same placement', () => {
    // The corvette places `wingBox` four times: two per side, mirrored.
    const { origins } = expandWithOrigins(CORVETTE);
    const wings = origins.filter((origin) => {
      const placement = placementAt(CORVETTE, origin.path);
      return placement !== null && !isInstance(placement) && placement.length === 4 && placement.width === 3;
    });
    expect(wings.length).toBe(4);
    for (const wing of wings) expect(samePlacement(wing.path, wings[0]!.path)).toBe(true);
  });

  it('distinguishes two placements that happen to be identical', () => {
    const bp = ship({
      modules: [
        hull,
        { kind: 'thruster', x: -11, y: 2, angle: 0, length: 2, width: 2 },
        { kind: 'thruster', x: -11, y: -2, angle: 0, length: 2, width: 2 },
      ],
    });
    const { origins } = expandWithOrigins(bp);
    expect(samePlacement(origins[1]!.path, origins[2]!.path)).toBe(false);
  });

  it('records the frame a placement was made in', () => {
    const bp = ship({
      assemblies: { pod: { modules: [{ kind: 'structure', x: 1, y: 2, length: 2, width: 2 }] } },
      modules: [hull, { use: 'pod', x: 10, y: 0, angle: math.HALF_PI }, { use: 'pod', x: 10, y: 0, mirror: true }],
    });
    const { origins } = expandWithOrigins(bp);
    expect(origins[0]).toMatchObject({ rotation: 0, mirrored: false });
    expect(origins[1]!.rotation).toBeCloseTo(math.HALF_PI, 12);
    expect(origins[2]).toMatchObject({ rotation: 0, mirrored: true });
  });

  it('tells the copies of a repeated instance apart while naming one placement', () => {
    const bp = ship({
      assemblies: { bay: { modules: [{ kind: 'structure', x: 0, y: 0, length: 2, width: 2 }] } },
      modules: [hull, { use: 'bay', x: 0, y: 5, repeat: 3, step: { x: 3, y: 0 } }],
    });
    const { modules, origins } = expandWithOrigins(bp);
    expect(modules).toHaveLength(4);
    const copies = origins.slice(1);
    expect(copies.map((o) => o.path[0]!.copy)).toEqual([0, 1, 2]);
    for (const copy of copies) expect(samePlacement(copy.path, copies[0]!.path)).toBe(true);
  });

  it('separates an instance’s extras from the assembly’s own modules', () => {
    const bp = ship({
      assemblies: { pod: { modules: [{ kind: 'structure', x: 0, y: 0, length: 2, width: 2 }] } },
      modules: [
        hull,
        {
          use: 'pod',
          x: 0,
          y: 5,
          extra: [{ kind: 'structure', x: 0, y: 3, length: 2, width: 2 }],
        },
      ],
    });
    const { origins } = expandWithOrigins(bp);
    expect(origins[1]!.path[0]!.into).toBe('assembly');
    expect(origins[2]!.path[0]!.into).toBe('extra');
    expect(samePlacement(origins[1]!.path, origins[2]!.path)).toBe(false);
  });

  it('returns null for a path that no longer leads anywhere', () => {
    expect(placementAt(CORVETTE, [{ index: 99, copy: 0 }])).toBeNull();
  });
});

describe('blueprintProblems', () => {
  it('reports every problem, not only the first', () => {
    const bp = ship({
      modules: [
        hull,
        { kind: 'structure', x: 1, y: 0, length: 20, width: 6 },
        { kind: 'structure', x: 2, y: 0, length: 20, width: 6 },
      ],
    });
    // Three mutually overlapping hulls is three complaints, not one.
    expect(blueprintProblems(bp)).toHaveLength(3);
  });

  it('agrees with blueprintProblem about the first of them', () => {
    const bp = ship({ modules: [hull, { kind: 'structure', x: 1, y: 0, length: 20, width: 6 }] });
    expect(blueprintProblem(bp)).toBe(blueprintProblems(bp)[0]);
    expect(blueprintProblem(CORVETTE)).toBeNull();
    expect(blueprintProblems(CORVETTE)).toEqual([]);
  });

  it('stops at a structural fault, which leaves nothing to expand', () => {
    const bp = ship({ modules: [hull, { use: 'missing', x: 0, y: 0 }] });
    expect(blueprintProblems(bp)).toHaveLength(1);
  });
});

describe('blueprintFaults', () => {
  // The messages are the same; what a bare list of sentences cannot give an
  // editor is *which* modules to draw in red, and these are indices into the
  // expansion — the same list `expandWithOrigins` gives places in the layout
  // for, so a fault leads all the way back to what a player would edit.
  it('names the modules each problem is about', () => {
    const bp = ship({
      modules: [hull, { kind: 'structure', x: 8, y: 0, length: 20, width: 6 }],
    });
    expect(blueprintFaults(bp)).toEqual([
      { message: expect.stringMatching(/modules 0 and 1 overlap/), modules: [0, 1] },
    ]);
  });

  it('names none for a complaint about the layout as a whole', () => {
    expect(blueprintFaults(ship({ modules: [] }))).toEqual([
      { message: expect.stringMatching(/at least one module/), modules: [] },
    ]);
  });

  it('says the same things blueprintProblems does', () => {
    const bp = ship({ modules: [hull, { kind: 'structure', x: 40, y: 0, length: 4, width: 4 }] });
    expect(blueprintFaults(bp).map((fault) => fault.message)).toEqual(blueprintProblems(bp));
  });
});

describe('compileDraft', () => {
  it('compiles a layout a battle would refuse', () => {
    const bp = ship({ modules: [hull, { kind: 'structure', x: 1, y: 0, length: 20, width: 6 }] });
    expect(() => compileBlueprint(bp)).toThrow();
    // Dragging a module through another is how you get it past, so the editor
    // has to be able to measure the layout while it is happening.
    expect(compileDraft(bp).modules).toHaveLength(2);
  });

  it('compiles a valid layout to exactly what compileBlueprint does', () => {
    expect(compileDraft(CORVETTE)).toEqual(compileBlueprint(CORVETTE));
  });

  it('leaves out a module it cannot measure, and keeps the rest of the ship', () => {
    // A size typed down to zero on the way to typing a smaller one. The ship
    // around it must go on being drawn: losing the whole layout because one
    // field is momentarily empty is the worst moment to lose it.
    const bp = ship({
      modules: [hull, { kind: 'structure', x: 14, y: 0, length: 0, width: 4 }],
    });
    const design = compileDraft(bp);
    expect(design.modules).toHaveLength(1);
    expect(design.modules[0]!.spec.length).toBe(20);
    // Still a problem, and still reported — just not a reason to stop drawing.
    expect(blueprintProblems(bp).some((p) => /positive/.test(p))).toBe(true);
    expect(() => compileBlueprint(bp)).toThrow();
  });

  it('keeps a turret pointing at its own module when an earlier one is left out', () => {
    const bp = ship({
      modules: [
        { kind: 'structure', x: 0, y: 0, length: 0, width: 4 },
        hull,
        { kind: 'turret', x: 12, y: 0, length: 4, width: 4, barrels: 1 },
      ],
    });
    const design = compileDraft(bp);
    expect(design.modules).toHaveLength(2);
    expect(design.turrets).toHaveLength(1);
    expect(design.modules[design.turrets[0]!.module]!.spec.kind).toBe('turret');
  });

  it('refuses a layout with nothing left to measure', () => {
    expect(() => compileDraft(ship({ modules: [] }))).toThrow(/at least one module/);
    expect(() =>
      compileDraft(ship({ modules: [{ kind: 'structure', x: 0, y: 0, length: 0, width: 4 }] })),
    ).toThrow(/can be measured/);
  });
});
