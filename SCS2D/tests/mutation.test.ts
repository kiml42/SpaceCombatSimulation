import { describe, expect, it } from 'vitest';
import {
  blueprintFileProblem,
  blueprintProblem,
  compileDraft,
  expandBlueprint,
  parseBlueprint,
  Rng,
  serialiseBlueprint,
  type Blueprint,
} from '../sim/index.js';
import { DEFAULT_KINDS, DEFAULT_LIMITS, mutate } from '../evolution/mutate.js';
import { CATAMARAN, CORVETTE, DINKY, GUNSHIP } from '../scenarios/blueprints.js';

/**
 * How one blueprint becomes another.
 *
 * Two things are being checked, and the second is the one that needs a test
 * rather than a type. That a child is a *ship* is a property of every draw and
 * is stated as one. That the operator does not quietly *bias* what it breeds
 * is only visible over a lineage: an operator that removes more than it adds
 * produces valid ships all the way down to a hull with nothing on it, and
 * every individual draw looks fine while it happens.
 */

/**
 * Edits that change how many modules a ship has.
 *
 * Named rather than written out at each use because the list has to be kept
 * in step with the operators: an edit that moves modules and is not matched
 * here reads as a generation that changed nothing, which is a test that
 * quietly stops checking what it was written for.
 */
const STRUCTURAL = /removed|added|copied|taken into|instance placed|instance dropped/;

const FLEET: readonly (readonly [string, Blueprint])[] = [
  ['corvette', CORVETTE],
  ['gunship', GUNSHIP],
  ['dinky', DINKY],
  ['catamaran', CATAMARAN],
];

/** Breed one blueprint down a line, returning every generation. */
function lineage(parent: Blueprint, seed: number, generations: number, massBudget: number): Blueprint[] {
  const rng = new Rng(seed);
  const out: Blueprint[] = [];
  let held = parent;
  for (let i = 0; i < generations; i++) {
    held = mutate(held, rng, { massBudget }).blueprint;
    out.push(held);
  }
  return out;
}

describe('mutation', () => {
  it('breeds only ships that can be built', () => {
    for (const [name, parent] of FLEET) {
      const rng = new Rng(11);
      for (let i = 0; i < 200; i++) {
        const child = mutate(parent, rng);
        expect(blueprintProblem(child.blueprint), `${name} child ${i}`).toBeNull();
      }
    }
  });

  it('leaves the parent alone', () => {
    const before = JSON.stringify(serialiseBlueprint(CORVETTE));
    const rng = new Rng(3);
    for (let i = 0; i < 50; i++) mutate(CORVETTE, rng);
    expect(JSON.stringify(serialiseBlueprint(CORVETTE))).toEqual(before);
  });

  it('breeds the same children from the same seed', () => {
    const one = lineage(GUNSHIP, 5, 20, Infinity);
    const two = lineage(GUNSHIP, 5, 20, Infinity);
    expect(one.map((bp) => JSON.stringify(serialiseBlueprint(bp)))).toEqual(
      two.map((bp) => JSON.stringify(serialiseBlueprint(bp))),
    );
  });

  it('breeds different children from different seeds', () => {
    const one = JSON.stringify(serialiseBlueprint(lineage(GUNSHIP, 5, 20, Infinity)[19]!));
    const two = JSON.stringify(serialiseBlueprint(lineage(GUNSHIP, 6, 20, Infinity)[19]!));
    expect(one).not.toEqual(two);
  });

  it('always changes something', () => {
    const rng = new Rng(19);
    for (const [name, parent] of FLEET) {
      const before = JSON.stringify(serialiseBlueprint(parent));
      for (let i = 0; i < 100; i++) {
        const child = mutate(parent, rng);
        expect(child.edits.length, `${name} child ${i}`).toBeGreaterThan(0);
        expect(JSON.stringify(serialiseBlueprint(child.blueprint))).not.toEqual(before);
      }
    }
  });

  it('writes a child to a file the parser accepts', () => {
    // A mutant that cannot be saved cannot be replayed, inspected in the
    // editor, or carried between a run and the page that shows it.
    const rng = new Rng(23);
    for (let i = 0; i < 100; i++) {
      const child = mutate(CATAMARAN, rng).blueprint;
      const file = serialiseBlueprint(child);
      expect(blueprintFileProblem(file), `child ${i}`).toBeNull();
      expect(JSON.stringify(serialiseBlueprint(parseBlueprint(file)))).toEqual(JSON.stringify(file));
    }
  });

  it('keeps a child within one generation of its parent', () => {
    const rng = new Rng(29);
    for (const [name, parent] of FLEET) {
      const was = expandBlueprint(parent).length;
      for (let i = 0; i < 200; i++) {
        const child = mutate(parent, rng);
        // At most one structural edit and `numbers` changes to numbers, which
        // is the bounded edit distance DESIGN.md §7 asks for.
        expect(child.edits.length, `${name} child ${i}`).toBeLessThanOrEqual(
          DEFAULT_LIMITS.numbers + 1,
        );
        const structural = child.edits.filter((edit) => STRUCTURAL.test(edit));
        expect(structural.length, `${name} child ${i}: ${child.edits.join(' | ')}`).toBeLessThanOrEqual(1);
        // A module added inside an assembly arrives once per copy of it, so
        // the expanded count moves by more than one — but only ever by whole
        // copies of one module. Everything else leaves the ship the size it
        // was, the edits to the *grouping* included: making a part of a module
        // and dissolving one back into the layout change what a later
        // generation can do rather than anything about the ship itself.
        const now = expandBlueprint(child.blueprint).length;
        if (structural.length === 0) expect(now, `${name} child ${i}`).toEqual(was);
      }
    }
  });

  it('never breeds a child over the mass budget', () => {
    const budget = compileDraft(CORVETTE).mass * 1.1;
    for (const child of lineage(CORVETTE, 31, 100, budget)) {
      expect(compileDraft(child).mass).toBeLessThanOrEqual(budget);
    }
  });

  it('adds as much as it takes away', { timeout: 30_000 }, () => {
    // The operator is neutral about how big a ship is; selection is what
    // decides that. An imbalance here is invisible in any one child and
    // fatal over a run — a lineage that loses a module every time it gains
    // one ends up as a hull that cannot shoot, whatever the fitness says.
    const rng = new Rng(37);
    let added = 0;
    let removed = 0;
    let held: Blueprint = GUNSHIP;
    const budget = compileDraft(GUNSHIP).mass * 2;
    for (let i = 0; i < 800; i++) {
      const child = mutate(held, rng, { massBudget: budget });
      held = child.blueprint;
      for (const edit of child.edits) {
        if (/removed/.test(edit)) removed++;
        else if (/added|copied/.test(edit)) added++;
      }
    }
    expect(added).toBeGreaterThan(20);
    expect(removed).toBeGreaterThan(20);
    expect(added / removed).toBeGreaterThan(0.6);
    expect(added / removed).toBeLessThan(1.6);
  });

  it('delivers the structural generations it draws', { timeout: 30_000 }, () => {
    // Structural edits are refused far more often than changes to a number,
    // so a candidate that bundled the two would deliver them at a fraction of
    // the rate asked for. Set to always, most generations must carry one —
    // the rest are draws for a module that will not fit anywhere or cannot be
    // spared, which fall back to breeding a change to the numbers rather than
    // to a copy of the parent.
    //
    // Over several lines rather than one, because how often that happens
    // depends a great deal on the shape a line has wandered into: single
    // lines measured between half and six-sevenths, and a threshold pinned to
    // whichever one was run first is a test that fails on a change that did
    // nothing.
    const budget = compileDraft(CORVETTE).mass * 2;
    let structural = 0;
    let generations = 0;
    for (const seed of [41, 42, 43]) {
      const rng = new Rng(seed);
      let held: Blueprint = CORVETTE;
      for (let i = 0; i < 200; i++) {
        const child = mutate(held, rng, { structural: 1, massBudget: budget });
        held = child.blueprint;
        generations++;
        if (child.edits.some((edit) => /removed|added|copied/.test(edit))) structural++;
      }
    }
    expect(structural).toBeGreaterThan(generations / 2);
  });

  it('brings a weight back from zero', () => {
    // A doctrine number is perturbed by a fraction of the default's own value
    // rather than of what is held, so nothing that has reached zero is stuck
    // there. Scaling by the held value alone makes zero absorbing, and
    // "ignore this entirely" has to be a decision a lineage can reverse.
    const parent: Blueprint = {
      ...CORVETTE,
      doctrine: {
        targeting: { ...CORVETTE.doctrine!.targeting, gunWeight: 0 },
        approach: { ...CORVETTE.doctrine!.approach },
      },
    };
    const rng = new Rng(43);
    let moved = false;
    let held = parent;
    for (let i = 0; i < 200 && !moved; i++) {
      held = mutate(held, rng).blueprint;
      if (held.doctrine!.targeting.gunWeight !== 0) moved = true;
    }
    expect(moved).toBe(true);
  });

  it('finds a weight whose own default is zero', () => {
    // Scaling by the field's default is what lets a weight come back from
    // zero — except where the default is zero too, which is a field nothing
    // can ever reach: every draw is a fraction of nothing, rounds to no
    // change, and is refused. `escortWeight` is the one that has it today, and
    // a population that cannot find it can never be interested in an
    // objective, whatever the match is scoring.
    const rng = new Rng(53);
    let held = CORVETTE;
    let moved = false;
    for (let i = 0; i < 200 && !moved; i++) {
      held = mutate(held, rng).blueprint;
      if ((held.doctrine?.targeting.escortWeight ?? 0) !== 0) moved = true;
    }
    expect(moved).toBe(true);
  });

  it('builds only the kinds it is told to', { timeout: 30_000 }, () => {
    // The weights are what a run says it is interested in, and they have to
    // hold for a module *refitted* as well as one added — a run told to breed
    // engines that went on turning its engines into gun mounts half the time
    // would be answering a question nobody asked.
    const rng = new Rng(59);
    let held: Blueprint = CORVETTE;
    let added = 0;
    let refitted = 0;
    for (let i = 0; i < 400; i++) {
      const child = mutate(held, rng, {
        structural: 1,
        kinds: { thruster: 1, structure: 0, turret: 0, beamTurret: 0, core: 0 },
      });
      held = child.blueprint;
      for (const edit of child.edits) {
        const arrival = /a (\w+) added to/.exec(edit);
        if (arrival !== null) {
          expect(arrival[1], edit).toEqual('thruster');
          added++;
        }
        const change = /refitted as (\w+)/.exec(edit);
        if (change !== null) {
          expect(change[1], edit).toEqual('thruster');
          refitted++;
        }
      }
    }
    expect(added).toBeGreaterThan(0);
    expect(refitted).toBeGreaterThan(0);
  });

  it('refits a module into an engine without moving it', { timeout: 30_000 }, () => {
    // A thruster's position is where it is *attached* rather than the middle
    // of its box, so a refit that kept the coordinates would slide the module
    // half its own length into its neighbour and be refused every time —
    // closing the one route a lineage has to a large engine, since everything
    // added arrives half a metre square.
    const rng = new Rng(61);
    let held: Blueprint = CORVETTE;
    let engines = 0;
    for (let i = 0; i < 400 && engines < 5; i++) {
      const child = mutate(held, rng, { structural: 0, kinds: DEFAULT_KINDS });
      held = child.blueprint;
      if (child.edits.some((edit) => /refitted as thruster/.test(edit))) engines++;
    }
    expect(engines).toBeGreaterThan(0);
  });

  it('keeps breeding when no kind is allowed at all', () => {
    // Every weight zero is a thing a form can be set to, and it means "add
    // nothing new": the numbers still move, and a module can still be taken
    // off or copied, so a lineage carries on rather than stalling.
    const rng = new Rng(67);
    let held: Blueprint = CORVETTE;
    for (let i = 0; i < 50; i++) {
      const child = mutate(held, rng, {
        kinds: { thruster: 0, structure: 0, turret: 0, beamTurret: 0, core: 0 },
      });
      expect(child.edits.length, `child ${i}`).toBeGreaterThan(0);
      expect(child.edits.some((edit) => /added to/.test(edit))).toBe(false);
      expect(child.edits.some((edit) => /refitted as/.test(edit))).toBe(false);
      expect(blueprintProblem(child.blueprint), `child ${i}`).toBeNull();
      held = child.blueprint;
    }
  });

  it('gives up rather than breeding something invalid', () => {
    // A layout with nowhere to go: one core on its own, with no budget for
    // anything. Every candidate is over it, so the parent comes back with
    // nothing claimed to have been done to it.
    const alone: Blueprint = {
      name: 'Core',
      modules: [{ kind: 'core', x: 0, y: 0, length: 4, width: 4 }],
    };
    const child = mutate(alone, new Rng(47), { massBudget: 1 });
    expect(child.edits).toEqual([]);
    expect(child.blueprint).toBe(alone);
  });
});
