import { describe, expect, it } from 'vitest';
import {
  assemblyProblem,
  blueprintProblem,
  compileBlueprint,
  expandBlueprint,
  math,
  type Blueprint,
} from '../sim/index.js';
import { CORVETTE, GUNSHIP } from '../scenarios/blueprints.js';

/**
 * Assemblies: groups of modules placed by reference, so that copies of a part
 * cannot drift apart.
 *
 * The property worth testing hardest is that expansion is *exact*. An assembly
 * is a way of writing a layout down, not a thing a ship has, so a layout
 * rewritten to use one has to compile to the same ship down to the last bit —
 * and the golden checksums say so for the real ships. What is left for here is
 * the arithmetic those ships happen not to exercise: nesting, cycles, rotated
 * instances, and the two floating-point traps in mirroring.
 */

const hull = { kind: 'structure', x: 0, y: 0, length: 20, width: 6 } as const;

function ship(blueprint: Omit<Blueprint, 'name'>): Blueprint {
  return { name: 'Test', ...blueprint };
}

describe('placing an assembly', () => {
  it('puts a copy where the instance says, in the instance frame', () => {
    const bp = ship({
      assemblies: { pod: { modules: [{ kind: 'structure', x: 1, y: 2, length: 2, width: 2 }] } },
      modules: [hull, { use: 'pod', x: 10, y: 20 }],
    });
    const [, pod] = expandBlueprint(bp);
    expect(pod).toMatchObject({ x: 11, y: 22 });
  });

  it('turns a copy, composing the instance angle with the module’s own', () => {
    const bp = ship({
      assemblies: { pod: { modules: [{ kind: 'structure', x: 2, y: 0, angle: math.HALF_PI, length: 2, width: 2 }] } },
      modules: [hull, { use: 'pod', x: 0, y: 0, angle: math.HALF_PI }],
    });
    const [, pod] = expandBlueprint(bp);
    // Rotated a quarter turn about the instance origin: (2, 0) becomes (0, 2).
    expect(pod!.x).toBeCloseTo(0, 12);
    expect(pod!.y).toBeCloseTo(2, 12);
    expect(pod!.angle).toBeCloseTo(math.PI, 12);
  });

  it('reflects a mirrored copy across the instance frame’s own axis', () => {
    const bp = ship({
      assemblies: { pod: { modules: [{ kind: 'thruster', x: 3, y: 4, angle: math.HALF_PI, length: 2, width: 2 }] } },
      modules: [hull, { use: 'pod', x: 0, y: 0, mirror: true }],
    });
    const [, pod] = expandBlueprint(bp);
    // Across the x-axis: y and the facing both negate, x is untouched.
    expect(pod).toMatchObject({ x: 3, y: -4, angle: -math.HALF_PI });
  });

  it('carries the module’s own values into every copy', () => {
    const bp = ship({
      assemblies: {
        gun: { modules: [{ kind: 'turret', x: 0, y: 4, length: 8, width: 6, barrels: 4, notes: 'why' }] },
      },
      modules: [hull, { use: 'gun', x: 0, y: 3 }, { use: 'gun', x: 0, y: -3, mirror: true }],
    });
    const copies = expandBlueprint(bp).filter((m) => m.kind === 'turret');
    expect(copies).toHaveLength(2);
    for (const copy of copies) {
      expect(copy.barrels).toBe(4);
      expect(copy.notes).toBe('why');
    }
  });
});

describe('mirroring, and the two ways floating point spoils it', () => {
  // Both of these were found by the golden checksums rather than by reasoning,
  // and both would have been invisible in any test written with `toBeCloseTo`.

  it('reflects a module facing aft onto exactly the same angle, not its negative', () => {
    // PI and -PI are the same direction and different numbers: `sin(-PI)` is
    // -1.2e-16 where `sin(PI)` is +1.2e-16. Left alone, a reflected aft
    // thruster would compile a hair differently from its unreflected twin.
    const bp = ship({
      assemblies: { aft: { modules: [{ kind: 'thruster', x: 0, y: 0, angle: math.PI, length: 2, width: 2 }] } },
      modules: [hull, { use: 'aft', x: 11, y: 2 }, { use: 'aft', x: 11, y: -2, mirror: true }],
    });
    const [, port, starboard] = expandBlueprint(bp);
    expect(starboard!.angle).toBe(math.PI);
    expect(starboard!.angle).toBe(port!.angle);
  });

  it('reflects a module facing forward onto positive zero, not negative zero', () => {
    // `-0 === 0` is true and their bits differ, which nothing notices except a
    // checksum taken over raw doubles — so it would surface as a golden test
    // failing for no reason anybody could see in the ship.
    const bp = ship({
      assemblies: { fwd: { modules: [{ kind: 'thruster', x: 0, y: 0, angle: 0, length: 2, width: 2 }] } },
      modules: [hull, { use: 'fwd', x: -11, y: 2 }, { use: 'fwd', x: -11, y: -2, mirror: true }],
    });
    const [, , starboard] = expandBlueprint(bp);
    expect(Object.is(starboard!.angle, -0)).toBe(false);
    expect(Object.is(starboard!.y, -0)).toBe(false);
  });
});

describe('nesting', () => {
  it('places an assembly that contains another one', () => {
    const bp = ship({
      assemblies: {
        boss: { modules: [{ kind: 'structure', x: 1, y: 0, length: 2, width: 2 }] },
        wing: { modules: [{ use: 'boss', x: 0, y: 1 }, { kind: 'structure', x: 0, y: 3, length: 2, width: 2 }] },
      },
      modules: [hull, { use: 'wing', x: 10, y: 10 }],
    });
    const [, boss, tip] = expandBlueprint(bp);
    expect(boss).toMatchObject({ x: 11, y: 11 });
    expect(tip).toMatchObject({ x: 10, y: 13 });
  });

  it('carries a mirror down through the nesting', () => {
    // What makes a whole mirrored side expressible: reflecting the outer
    // instance has to reflect everything inside it, including the placement of
    // an inner assembly and the facings within that.
    const bp = ship({
      assemblies: {
        boss: { modules: [{ kind: 'thruster', x: 0, y: 1, angle: math.HALF_PI, length: 2, width: 2 }] },
        wing: { modules: [{ use: 'boss', x: 0, y: 4 }] },
      },
      modules: [hull, { use: 'wing', x: 0, y: 0 }, { use: 'wing', x: 0, y: 0, mirror: true }],
    });
    const [, port, starboard] = expandBlueprint(bp);
    expect(port).toMatchObject({ y: 5, angle: math.HALF_PI });
    expect(starboard).toMatchObject({ y: -5, angle: -math.HALF_PI });
  });

  it('mirroring twice is not mirroring at all', () => {
    const bp = ship({
      assemblies: {
        boss: { modules: [{ kind: 'thruster', x: 0, y: 1, angle: math.HALF_PI, length: 2, width: 2 }] },
        wing: { modules: [{ use: 'boss', x: 0, y: 4, mirror: true }] },
      },
      modules: [hull, { use: 'wing', x: 0, y: 0, mirror: true }],
    });
    const [, only] = expandBlueprint(bp);
    expect(only).toMatchObject({ y: -3, angle: math.HALF_PI });
  });
});

describe('extras: how one copy differs from another', () => {
  // Purely additive, so an instance never overrides a value and "linked"
  // keeps meaning "identical" about everything the assembly defines.

  const wing = { modules: [{ kind: 'structure', x: 0, y: 2, length: 2, width: 4 } as const] };

  it('places an extra in the same frame as the assembly’s own modules', () => {
    const bp = ship({
      assemblies: { wing },
      modules: [
        hull,
        { use: 'wing', x: 10, y: 0, extra: [{ kind: 'structure', x: 0, y: 5, length: 2, width: 2 }] },
      ],
    });
    const [, own, added] = expandBlueprint(bp);
    expect(own).toMatchObject({ x: 10, y: 2 });
    expect(added).toMatchObject({ x: 10, y: 5 });
  });

  it('reflects an extra along with the copy that carries it', () => {
    // The reason an extra is not simply a module placed in the parent: its
    // coordinates are written once, in the assembly's frame, and mean the same
    // thing on either beam.
    const extra = [{ kind: 'thruster', x: 0, y: 5, angle: math.HALF_PI, length: 2, width: 2 } as const];
    const bp = ship({
      assemblies: { wing },
      modules: [
        hull,
        { use: 'wing', x: 10, y: 0, extra },
        { use: 'wing', x: -10, y: 0, mirror: true, extra },
      ],
    });
    const expanded = expandBlueprint(bp);
    expect(expanded[2]).toMatchObject({ y: 5, angle: math.HALF_PI });
    expect(expanded[4]).toMatchObject({ y: -5, angle: -math.HALF_PI });
  });

  it('gives one copy something the others do not have', () => {
    // Placed clear of the hull, since the expanded modules face the overlap
    // rule exactly as hand-placed ones do.
    const bp = ship({
      assemblies: { wing },
      modules: [
        hull,
        { use: 'wing', x: 12, y: 0 },
        { use: 'wing', x: -12, y: 0, extra: [{ kind: 'structure', x: 0, y: 5, length: 2, width: 2 }] },
      ],
    });
    expect(expandBlueprint(bp)).toHaveLength(4);
    expect(blueprintProblem(bp)).toBeNull();
  });

  it('lets an extra be an assembly instance of its own', () => {
    const bp = ship({
      assemblies: {
        wing,
        pod: { modules: [{ kind: 'structure', x: 0, y: 1, length: 2, width: 2 }] },
      },
      modules: [hull, { use: 'wing', x: 10, y: 0, extra: [{ use: 'pod', x: 0, y: 6 }] }],
    });
    const [, , pod] = expandBlueprint(bp);
    expect(pod).toMatchObject({ x: 10, y: 7 });
  });

  it('places extras after what the assembly defines, which is what unlinking costs', () => {
    // Unlinking a part hands every instance its own copy, and a copy lands at
    // the end of the instance's block rather than where the definition had it.
    // The geometry is untouched and the *order* is not, which for thrusters
    // and turrets means a slightly different ship — so the editor has to say
    // so rather than present unlinking as free.
    const linked = ship({
      assemblies: { pair: { modules: [
        { kind: 'thruster', x: 0, y: 1, angle: 0, length: 2, width: 2 },
        { kind: 'thruster', x: 0, y: -1, angle: 0, length: 2, width: 2 },
      ] } },
      modules: [hull, { use: 'pair', x: -11, y: 0 }],
    });
    // The same ship after unlinking the first of the pair.
    const unlinked = ship({
      assemblies: { pair: { modules: [
        { kind: 'thruster', x: 0, y: -1, angle: 0, length: 2, width: 2 },
      ] } },
      modules: [
        hull,
        { use: 'pair', x: -11, y: 0, extra: [{ kind: 'thruster', x: 0, y: 1, angle: 0, length: 2, width: 2 }] },
      ],
    });

    const before = expandBlueprint(linked);
    const after = expandBlueprint(unlinked);
    const key = (m: { y: number }) => m.y;
    expect(after.map(key).sort()).toEqual(before.map(key).sort());
    expect(after.map(key)).not.toEqual(before.map(key));
  });

  it('catches a dangling reference inside an extra', () => {
    const bp = ship({
      assemblies: { wing },
      modules: [hull, { use: 'wing', x: 10, y: 0, extra: [{ use: 'ghost', x: 0, y: 0 }] }],
    });
    expect(assemblyProblem(bp)).toMatch(/no assembly named ghost/);
  });

  it('catches a cycle that runs through an extra', () => {
    // An extra belongs to the instance, not to the assembly it places, so the
    // cycle here is a -> b -> a by way of b's extra rather than its modules.
    const bp = ship({
      assemblies: {
        a: { modules: [{ use: 'b', x: 1, y: 0, extra: [{ use: 'a', x: 1, y: 0 }] }] },
        b: { modules: [{ kind: 'structure', x: 0, y: 0, length: 2, width: 2 }] },
      },
      modules: [hull, { use: 'a', x: 10, y: 0 }],
    });
    expect(assemblyProblem(bp)).toMatch(/contains itself/);
  });

  it('does not mistake an extra placing the assembly it sits in for a cycle', () => {
    // `wing` carrying an extra `wing` is finite: the extra belongs to this
    // instance, not to the definition, so it expands once and stops.
    const bp = ship({
      assemblies: { wing },
      modules: [hull, { use: 'wing', x: 10, y: 0, extra: [{ use: 'wing', x: 0, y: 8 }] }],
    });
    expect(assemblyProblem(bp)).toBeNull();
    expect(expandBlueprint(bp)).toHaveLength(3);
  });
});

describe('rejecting a layout that cannot be resolved', () => {
  it('names an assembly that is referred to and not defined', () => {
    const bp = ship({ modules: [hull, { use: 'ghost', x: 0, y: 0 }] });
    expect(assemblyProblem(bp)).toMatch(/no assembly named ghost/);
    expect(blueprintProblem(bp)).toMatch(/no assembly named ghost/);
  });

  it('catches an assembly that contains itself', () => {
    const bp = ship({
      assemblies: { loop: { modules: [{ use: 'loop', x: 1, y: 0 }] } },
      modules: [hull, { use: 'loop', x: 0, y: 0 }],
    });
    expect(assemblyProblem(bp)).toMatch(/contains itself/);
    // Reported rather than hung on or overflowed, which is the whole point of
    // checking before expanding.
    expect(() => compileBlueprint(bp)).toThrow(/contains itself/);
  });

  it('catches a longer cycle and names the path round it', () => {
    const bp = ship({
      assemblies: {
        a: { modules: [{ use: 'b', x: 1, y: 0 }] },
        b: { modules: [{ use: 'a', x: 1, y: 0 }] },
      },
      modules: [hull, { use: 'a', x: 0, y: 0 }],
    });
    expect(assemblyProblem(bp)).toMatch(/a -> b -> a/);
  });

  it('rejects an assembly with nothing in it', () => {
    const bp = ship({ assemblies: { hollow: { modules: [] } }, modules: [hull] });
    expect(assemblyProblem(bp)).toMatch(/assembly hollow is empty/);
  });

  it('holds expanded modules to every rule an inline one has to meet', () => {
    // Expansion happens before validation, so a copy overlapping another copy
    // is caught exactly as two hand-placed modules would be — the rules are
    // stated once, about the ship that gets built.
    const bp = ship({
      assemblies: { box: { modules: [{ kind: 'structure', x: 0, y: 0, length: 4, width: 4 }] } },
      modules: [{ use: 'box', x: 0, y: 0 }, { use: 'box', x: 1, y: 0 }],
    });
    expect(blueprintProblem(bp)).toMatch(/overlap/);
  });

  it('checks a thruster’s attachment after reflection, not before', () => {
    // A mirrored thruster's facing flips, so whether it has structure to push
    // against is a question about the copy rather than about the definition.
    const engine = { kind: 'thruster', x: 0, y: 0, angle: 0, length: 2, width: 4 } as const;
    const good = ship({
      assemblies: { e: { modules: [engine] } },
      modules: [hull, { use: 'e', x: -11, y: 0 }],
    });
    expect(blueprintProblem(good)).toBeNull();

    // Same definition, placed the other side of the hull, where pushing +x
    // means pushing away from it.
    const bad = ship({
      assemblies: { e: { modules: [engine] } },
      modules: [hull, { use: 'e', x: 11, y: 0 }],
    });
    expect(blueprintProblem(bad)).toMatch(/no structure to push against/);
  });
});

describe('the ships that ship with the game', () => {
  it('build their symmetric parts from shared assemblies', () => {
    // The motivating case: eight lateral thrusters described once, so making
    // them all bigger is one edit and there is no state in which seven are.
    expect(Object.keys(GUNSHIP.assemblies ?? {})).toContain('lateral');
    expect(Object.keys(CORVETTE.assemblies ?? {})).toContain('wingBox');
    expect(expandBlueprint(GUNSHIP)).toHaveLength(18);
    expect(expandBlueprint(CORVETTE)).toHaveLength(13);
  });

  it('still compile to a ship, with every mirrored copy accounted for', () => {
    const design = compileBlueprint(GUNSHIP);
    expect(design.thrusters).toHaveLength(8);
    expect(design.turrets).toHaveLength(3);
    // Symmetric about the spine, so the centre of mass sits on it. This is
    // what would break first if a reflection were subtly wrong.
    expect(design.centreOfMassY).toBe(0);
  });
});
