import { describe, expect, it } from 'vitest';
import { DEFAULT_BUILD_WEIGHTS, mutate } from '../evolution/mutate.js';
import { Rng } from '../sim/rng.js';
import {
  blueprintProblem,
  contactWidth,
  isTriangle,
  triangleOf,
  type Blueprint,
  type ModuleSpec,
  type Placement,
} from '../sim/index.js';
import { CATAMARAN, CORVETTE } from '../scenarios/blueprints.js';

/**
 * Whether a lineage can breed a shape.
 *
 * Structure and tanks may be triangles, and for a long time nothing in
 * evolution could make one, move a corner or square one off: every structural
 * operator is stated as a face — a size changes by moving one, a neighbour is
 * carried by one, a new module is berthed along one — and a triangle has none.
 * So a founder's wedges were inherited exactly and stepped over.
 *
 * Three draws give a lineage the shape without giving it the thing that kept
 * shape out: a corner moved *freely* swings both the edges that meet there and
 * unsticks whatever was welded along either, which is exactly what face-moving
 * was designed to avoid. Each of these moves at most one edge off its line.
 *
 * **Bred once and read many times.** The draws are rare by design, so seeing
 * all three takes a long line — and a line per assertion would cost minutes of
 * the suite for one question each.
 */

/** One generation: what changed, and the hull it left behind. */
interface Step {
  readonly edits: readonly string[];
  readonly before: readonly ModuleSpec[];
  readonly after: readonly ModuleSpec[];
}

/**
 * Every module written in a blueprint, the ship's own and every assembly's.
 *
 * Assemblies included because that is where half the shapes are: the Catamaran
 * keeps its hulls in one, and a draw that reshapes a module inside an assembly
 * reshapes it on every copy.
 */
const modulesOf = (blueprint: Blueprint): ModuleSpec[] => {
  const out: ModuleSpec[] = [];
  const isModule = (placement: Placement): placement is ModuleSpec => !('assembly' in placement);
  const take = (placements: readonly Placement[]): void => {
    for (const placement of placements) if (isModule(placement)) out.push(placement);
  };
  take(blueprint.modules ?? []);
  for (const assembly of Object.values(blueprint.assemblies ?? {})) take(assembly.modules);
  return out;
};

function breedLine(parent: Blueprint, seed: number, generations: number): Step[] {
  const rng = new Rng(seed);
  const steps: Step[] = [];
  let held = parent;
  for (let i = 0; i < generations; i++) {
    const before = modulesOf(held);
    const child = mutate(held, rng);
    steps.push({ edits: child.edits, before, after: modulesOf(child.blueprint) });
    // The layout rules decide whether a draw was any good, and a shape draw
    // must not be able to breed something they would refuse.
    expect(blueprintProblem(child.blueprint)).toBeNull();
    held = child.blueprint;
  }
  return steps;
}

const GENERATIONS = 600;
const corvette = breedLine(CORVETTE, 14, GENERATIONS);
const catamaran = breedLine(CATAMARAN, 14, GENERATIONS);
const both = [...corvette, ...catamaran];

const matching = (steps: readonly Step[], what: RegExp): Step[] =>
  steps.filter((step) => step.edits.some((edit) => what.test(edit)));

const ARRIVED = /added as a wedge/;
const CUT = /cut the .* corner off/;
const WALKED = /walked (out|back) along its edge/;

describe('breeding a shape', () => {
  it('reaches all three draws', () => {
    expect(matching(both, ARRIVED).length).toBeGreaterThan(0);
    expect(matching(both, CUT).length).toBeGreaterThan(0);
    expect(matching(both, WALKED).length).toBeGreaterThan(0);
  });

  it('grows triangles on a hull founded entirely on boxes', () => {
    // The Corvette is rectangles throughout, so every wedge in a descendant is
    // one the line drew rather than one it inherited.
    expect(modulesOf(CORVETTE).some(isTriangle)).toBe(false);
    expect(Math.max(...corvette.map((step) => step.after.filter(isTriangle).length))).toBeGreaterThan(0);
  });

  it('keeps a corner walk on one of the two edges that meet there', () => {
    // The property the whole thing rests on: one edge keeps its line exactly,
    // so whatever was welded along it is still welded along it. Checked as
    // geometry rather than by trusting the edit text — a corner that moved off
    // both its edges would still be reported as a walk.
    let walks = 0;
    for (const step of matching(both, WALKED)) {
      if (step.before.length !== step.after.length) continue;
      for (let m = 0; m < step.before.length; m++) {
        const was = triangleOf(step.before[m]!);
        const now = triangleOf(step.after[m]!);
        if (was === null || now === null) continue;
        if (was.every((v, k) => v === now[k])) continue;
        walks++;
        // Re-centring moves every stored corner, so the test is the shape
        // rather than the stored numbers: two of the three edges keep their
        // directions and only the third changes the way it points.
        expect(parallelEdges(was, now)).toBeGreaterThanOrEqual(1);
      }
    }
    expect(walks).toBeGreaterThan(0);
  });

  // Slow: six hundred generations, each compiled.
  it('keeps every module a box when shape is weighted out', { timeout: 30_000 }, () => {
    // The off switch a long run reaches for: a hull with wedges in it compiles
    // about half as dear again, so a run that does not want them should not
    // pay for them.
    const rng = new Rng(11);
    let held: Blueprint = CORVETTE;
    for (let i = 0; i < GENERATIONS; i++) {
      const child = mutate(held, rng, { build: { ...DEFAULT_BUILD_WEIGHTS, shape: 0 } });
      expect(child.edits.some((edit) => ARRIVED.test(edit) || CUT.test(edit) || WALKED.test(edit))).toBe(false);
      held = child.blueprint;
    }
    expect(modulesOf(held).some(isTriangle)).toBe(false);
  });

  it('only cuts a corner where nothing was welded, so every weld survives', () => {
    // What makes this the one free-form shape change a lineage may make: the
    // two faces that go are the two nothing was attached to, so the legs of
    // what is left are the faces that were holding the module on.
    let cuts = 0;
    for (const step of matching(both, CUT)) {
      // Only a generation whose *whole* change was the cut says anything about
      // the cut; anything else could have moved a weld on its own account.
      if (step.edits.length !== 1 || step.before.length !== step.after.length) continue;
      cuts++;
      expect(weldCount(step.after)).toBe(weldCount(step.before));
    }
    expect(cuts).toBeGreaterThan(0);
  });
});

/** How many pairs of modules are welded, which a corner cut must not change. */
function weldCount(modules: readonly ModuleSpec[]): number {
  let welds = 0;
  for (let a = 0; a < modules.length; a++) {
    for (let b = a + 1; b < modules.length; b++) {
      if (contactWidth(modules[a]!, modules[b]!) > 0) welds++;
    }
  }
  return welds;
}

/** How many of a triangle's three edges kept their direction through a change. */
function parallelEdges(was: readonly number[], now: readonly number[]): number {
  let same = 0;
  for (let e = 0; e < 3; e++) {
    const f = (e + 1) % 3;
    const ax = was[f * 2]! - was[e * 2]!;
    const ay = was[f * 2 + 1]! - was[e * 2 + 1]!;
    const bx = now[f * 2]! - now[e * 2]!;
    const by = now[f * 2 + 1]! - now[e * 2 + 1]!;
    const cross = ax * by - ay * bx;
    const scale = Math.sqrt(ax * ax + ay * ay) * Math.sqrt(bx * bx + by * by);
    if (scale > 0 && Math.abs(cross) / scale < 1e-9) same++;
  }
  return same;
}
