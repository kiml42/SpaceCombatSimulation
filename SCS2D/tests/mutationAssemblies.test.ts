import { describe, expect, it } from 'vitest';
import {
  blueprintFileProblem,
  blueprintProblem,
  expandBlueprint,
  isInstance,
  parseBlueprint,
  Rng,
  serialiseBlueprint,
  type Assembly,
  type AssemblyInstance,
  type Blueprint,
  type ModuleSpec,
  type Placement,
} from '../sim/index.js';
import { intoInstanceFrame, mutate, outOfInstanceFrame } from '../evolution/mutate.js';
import { BARE_CORE, CATAMARAN, CORVETTE, DINKY } from '../scenarios/blueprints.js';

/**
 * Breeding the *grouping* of a ship rather than its modules.
 *
 * An assembly is the one construction that says two things are the same part,
 * so a lineage that cannot reach one can never have a matching pair of
 * anything — only two things that happen to look alike and drift apart the
 * moment either is touched. What needs testing is in two halves: that the
 * frame arithmetic is the inverse of what `expandBlueprint` does, which
 * nothing else would tell you (a module moved silently is refused for
 * overlapping something, which says nothing about why), and that a lineage
 * actually arrives at grouped, repeated, mirrored parts rather than merely
 * being able to in principle.
 */

const CORE: ModuleSpec = { kind: 'core', x: 0, y: 0, length: 4, width: 4 };

/** A one-module assembly placed by one instance, expanded. */
function placed(spec: ModuleSpec, instance: AssemblyInstance): ModuleSpec {
  const assembly: Assembly = { modules: [spec] };
  const blueprint: Blueprint = {
    name: 'Frame',
    assemblies: { part: assembly },
    modules: [CORE, { ...instance, use: 'part' }],
  };
  return expandBlueprint(blueprint)[1]!;
}

/** The same module written straight into the layout, expanded. */
function loose(spec: ModuleSpec): ModuleSpec {
  return expandBlueprint({ name: 'Frame', modules: [CORE, spec] })[1]!;
}

const FRAMES: readonly AssemblyInstance[] = [
  { use: 'part', x: 0, y: 0 },
  { use: 'part', x: 7, y: -3 },
  { use: 'part', x: -2, y: 5, angle: Math.PI / 2 },
  { use: 'part', x: 4, y: 4, angle: -Math.PI / 3 },
  { use: 'part', x: 1, y: -6, mirror: true },
  { use: 'part', x: -5, y: 2, angle: Math.PI / 4, mirror: true },
];

const PARTS: readonly ModuleSpec[] = [
  { kind: 'structure', x: 2, y: 1, length: 2, width: 1 },
  { kind: 'turret', x: -3, y: 2, angle: Math.PI / 6, length: 1.5, width: 1 },
  { kind: 'thruster', x: 1, y: -2, angle: Math.PI, length: 1, width: 1 },
];

function near(a: number, b: number): void {
  expect(a).toBeCloseTo(b, 9);
}

describe('the frame a part is written in', () => {
  it('puts a module back where it was when it comes out of an instance', () => {
    // `outOfInstanceFrame` has to agree with `expandBlueprint` exactly, since
    // ungrouping claims to change nothing about the ship. Checked against the
    // expansion rather than against itself, because a consistent mistake in
    // both directions would round-trip perfectly and still move the module.
    for (const instance of FRAMES) {
      for (const part of PARTS) {
        const where = `${JSON.stringify(instance)} ${part.kind}`;
        const inside = placed(part, instance);
        const outside = loose(outOfInstanceFrame(part, instance));
        near(outside.x, inside.x);
        near(outside.y, inside.y);
        near(outside.angle ?? 0, inside.angle ?? 0);
        expect(outside.kind, where).toEqual(inside.kind);
      }
    }
  });

  it('puts a module where it already was when it goes into one', () => {
    // Absorbing claims the same of a part placed once: the module it takes in
    // does not move.
    for (const instance of FRAMES) {
      for (const part of PARTS) {
        const inside = placed(intoInstanceFrame(part, instance), instance);
        const outside = loose(part);
        near(inside.x, outside.x);
        near(inside.y, outside.y);
        near(inside.angle ?? 0, outside.angle ?? 0);
      }
    }
  });

  it('is its own inverse either way round', () => {
    for (const instance of FRAMES) {
      for (const part of PARTS) {
        const back = outOfInstanceFrame(intoInstanceFrame(part, instance), instance);
        near(back.x, part.x);
        near(back.y, part.y);
        near(back.angle ?? 0, part.angle ?? 0);
      }
    }
  });
});

/** Every instance in a layout, however deeply it is written. */
function instances(blueprint: Blueprint): AssemblyInstance[] {
  const out: AssemblyInstance[] = [];
  const walk = (placements: readonly Placement[]): void => {
    for (const placement of placements) {
      if (!isInstance(placement)) continue;
      out.push(placement);
      if (placement.extra !== undefined) walk(placement.extra);
    }
  };
  walk(blueprint.modules);
  for (const assembly of Object.values(blueprint.assemblies ?? {})) walk(assembly.modules);
  return out;
}

/** How many instances place each assembly. */
function uses(blueprint: Blueprint): Map<string, number> {
  const counts = new Map<string, number>();
  for (const instance of instances(blueprint)) {
    counts.set(instance.use, (counts.get(instance.use) ?? 0) + 1);
  }
  return counts;
}

/** Breed a line, every generation structural, reporting what it ever reached. */
function lineage(parent: Blueprint, seed: number, generations: number) {
  const rng = new Rng(seed);
  let held = parent;
  const seen = {
    grouped: false,
    repeated: false,
    manyModules: false,
    mirrored: false,
    shrank: false,
  };
  let most = Object.keys(parent.assemblies ?? {}).length;
  for (let i = 0; i < generations; i++) {
    held = mutate(held, rng, { structural: 1 }).blueprint;
    expect(blueprintProblem(held), `generation ${i}`).toBeNull();
    const names = Object.keys(held.assemblies ?? {});
    if (names.length > 0) seen.grouped = true;
    if (names.length < most) seen.shrank = true;
    most = Math.max(most, names.length);
    for (const count of uses(held).values()) if (count > 1) seen.repeated = true;
    for (const assembly of Object.values(held.assemblies ?? {})) {
      if (assembly.modules.length > 1) seen.manyModules = true;
    }
    for (const instance of instances(held)) if (instance.mirror === true) seen.mirrored = true;
  }
  return { held, seen };
}

/** Children drawn from one fixed parent, so nothing drifts between them. */
function children(parent: Blueprint, seed: number, count: number): string[] {
  const rng = new Rng(seed);
  const edits: string[] = [];
  for (let i = 0; i < count; i++) {
    edits.push(...mutate(parent, rng, { structural: 1 }).edits);
  }
  return edits;
}

describe('growing a part that is placed more than once', () => {
  // Twelve hundred mutants, which is a second or two here and over five on a
  // slow runner — the default timeout is for tests that are quick by nature.
  it('puts a new module on one, where absorbing never can', { timeout: 30_000 }, () => {
    // **The two ways of growing a part are not interchangeable.** Absorbing
    // moves a module that is already on the ship, so where it sits is where
    // it has to fit — beside the one instance it was next to, and inside
    // every other instance, which is usually somebody else's hull. A new
    // module has no such history and goes where there is room.
    //
    // Drawn from one fixed parent rather than down a lineage, so the two
    // counts are about the operators rather than about where a line happened
    // to wander.
    for (const [name, parent] of [
      ['catamaran', CATAMARAN],
      ['corvette', CORVETTE],
    ] as const) {
      const shared = new Set(
        [...uses(parent)].filter(([, count]) => count > 1).map(([used]) => used),
      );
      expect(shared.size, `${name} places a part more than once`).toBeGreaterThan(0);

      let added = 0;
      let absorbed = 0;
      for (const edit of children(parent, 101, 600)) {
        const arrival = /^(\S+?)\[\d+\] \S+: a \w+ added to/.exec(edit);
        if (arrival !== null && shared.has(arrival[1]!)) added++;
        const taken = /taken into (\S+)/.exec(edit);
        if (taken !== null && shared.has(taken[1]!)) absorbed++;
      }
      expect(added, `${name}: new modules onto a shared part`).toBeGreaterThan(10);
      // Not asserted to be zero — it is only very unlikely, and a test that
      // says "never" about a draw is a test waiting to fail on a lucky seed.
      expect(absorbed, `${name}: modules absorbed into a shared part`).toBeLessThan(added / 10);
    }
  });
});

describe('breeding the grouping', () => {
  it('reaches parts, repeats them, grows them and turns them over', () => {
    // One lineage from a bare core, which starts with no assemblies at all, so
    // every one of these is something the operators built rather than
    // something the founder was handed.
    const { seen } = lineage(BARE_CORE, 3, 400);
    expect(seen.grouped, 'made a part').toBe(true);
    expect(seen.repeated, 'placed a part more than once').toBe(true);
    expect(seen.manyModules, 'grew a part past one module').toBe(true);
    expect(seen.mirrored, 'turned a part over').toBe(true);
  });

  // Fourteen lineages of three hundred generations, and the ships they breed
  // grow as they go, so this is seconds of work rather than milliseconds — the
  // default timeout is for tests that are quick by nature.
  it('takes structure back as well as adding it', { timeout: 30_000 }, () => {
    // The inverses matter more than they look: an operator set that can only
    // add assemblies is a ratchet, and a lineage that groups the wrong things
    // has no way down from it.
    for (const [name, founder] of [
      ['corvette', CORVETTE],
      ['dinky', DINKY],
    ] as const) {
      const { seen } = lineage(founder, 7, 300);
      expect(seen.shrank, `${name} let a part go`).toBe(true);
    }
  });

  it('keeps every generation a ship, and a file the parser accepts', () => {
    // The catamaran is the founder with assemblies already, so these operators
    // are working on a grouping somebody else wrote rather than their own.
    const rng = new Rng(11);
    let held: Blueprint = CATAMARAN;
    for (let i = 0; i < 200; i++) {
      held = mutate(held, rng, { structural: 1 }).blueprint;
      const file = serialiseBlueprint(held);
      expect(blueprintFileProblem(file), `generation ${i}`).toBeNull();
      expect(JSON.stringify(serialiseBlueprint(parseBlueprint(file)))).toEqual(JSON.stringify(file));
    }
  });

  it('never leaves a definition nothing places', () => {
    // A part no instance uses is dead weight in the file that every later
    // generation still walks past, and an operator picking one to grow or
    // place would be working on something the ship does not have.
    const rng = new Rng(13);
    let held: Blueprint = DINKY;
    for (let i = 0; i < 300; i++) {
      held = mutate(held, rng, { structural: 1 }).blueprint;
      const placing = uses(held);
      for (const name of Object.keys(held.assemblies ?? {})) {
        expect(placing.get(name) ?? 0, `generation ${i}: ${name}`).toBeGreaterThan(0);
      }
    }
  });
});
