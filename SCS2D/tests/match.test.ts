import { describe, expect, it } from 'vitest';
import { compileBlueprint } from '../sim/index.js';
import { DEFAULT_MATCH, hullCapacity, Match, runMatch } from '../evolution/match.js';
import { BEAM_CORVETTE, CORVETTE, DINKY, GUNSHIP } from '../scenarios/blueprints.js';
import type { Blueprint } from '../sim/index.js';

/**
 * A match, and what it is worth.
 *
 * The scoring is the part that needs testing rather than the fighting, which
 * the golden scenarios already pin. What is easy to get wrong here is not
 * whether a number comes out but whether it *means* anything: a score that
 * quietly rewards losing slowly, or one that pays a gun for firing into a
 * hull it has already killed, is a fitness function that will be optimised
 * against and nothing will look broken while it happens.
 */

const FLEET = [CORVETTE, GUNSHIP, DINKY, BEAM_CORVETTE];

function escorting(blueprint: Blueprint, escortWeight: number): Blueprint {
  const doctrine = blueprint.doctrine!;
  return {
    ...blueprint,
    doctrine: {
      targeting: { ...doctrine.targeting, escortWeight },
      approach: { ...doctrine.approach },
    },
  };
}

describe('match', () => {
  it('fights the same match twice from one seed', () => {
    const one = runMatch(FLEET, { seed: 5 });
    const two = runMatch(FLEET, { seed: 5 });
    expect(JSON.stringify(one)).toEqual(JSON.stringify(two));
  });

  it('fights a different match from a different seed', () => {
    const one = runMatch(FLEET, { seed: 5 });
    const two = runMatch(FLEET, { seed: 6 });
    expect(JSON.stringify(one)).not.toEqual(JSON.stringify(two));
  });

  it('keeps every part of a score inside what it is a fraction of', () => {
    for (const seed of [1, 2, 3]) {
      const result = runMatch(FLEET, { seed });
      for (const [i, score] of result.scores.entries()) {
        const where = `seed ${seed}, entrant ${i}`;
        expect(score.survival, where).toBeGreaterThanOrEqual(0);
        expect(score.survival, where).toBeLessThanOrEqual(1);
        expect(score.damage, where).toBeGreaterThanOrEqual(0);
        expect(score.damage, where).toBeLessThanOrEqual(1);
        // Signed: ground gained on the goal, so losing ground is negative.
        expect(score.race, where).toBeGreaterThanOrEqual(-1);
        expect(score.race, where).toBeLessThanOrEqual(1);
        expect(score.taken, where).toBeGreaterThanOrEqual(0);
        expect(score.taken, where).toBeLessThanOrEqual(1);
        expect(score.total, where).toBeCloseTo(score.survival + score.damage + score.race, 10);
      }
    }
  });

  it('weighs the three parts as it is told to', () => {
    const weights = { survival: 3, damage: 0, race: 0.5 };
    const result = runMatch(FLEET, { seed: 7, weights });
    for (const score of result.scores) {
      expect(score.total).toBeCloseTo(score.survival * 3 + score.race * 0.5, 10);
    }
  });

  it('pays a decisive win as well as a stalemate', () => {
    // With the goal not counting, the match stops when one entrant is left,
    // and what is left of it is credited to whoever is still standing.
    // Without that, killing everything in ten seconds of a two-minute match
    // scores a twelfth of what failing to land a shot for two minutes scores.
    const weights = { survival: 1, damage: 1, race: 0 };
    const result = runMatch([GUNSHIP, DINKY], { seed: 11, weights });
    expect(result.ending).toEqual('decided');
    expect(result.elapsed).toBeLessThan(DEFAULT_MATCH.duration);
    const winner = result.scores.reduce((best, score) => (score.total > best.total ? score : best));
    expect(winner.survival).toEqual(1);
  });

  it('plays on after the last kill while the goal still counts', () => {
    // The survivor still has the goal to fly: stopping would score it as
    // though it stayed wherever the last kill left it.
    const result = runMatch([GUNSHIP, DINKY], { seed: 11 });
    expect(result.ending).toEqual('decided');
    expect(result.elapsed).toBeCloseTo(DEFAULT_MATCH.duration, 9);
    const early = runMatch([GUNSHIP, DINKY], { seed: 11, weights: { survival: 1, damage: 1, race: 0 } });
    // The same fight up to the kill, then flown rather than frozen.
    const winner = result.scores.findIndex((score) => score.survival === 1);
    expect(winner).toBeGreaterThanOrEqual(0);
    expect(result.scores[winner]!.race).not.toBeCloseTo(early.scores[winner]!.race, 6);
  });

  it('makes the goal a ghost when told it is not solid', () => {
    const ghostOf = (solid: boolean | undefined): number => {
      const goal = { ...DEFAULT_MATCH.goal!, ...(solid === undefined ? {} : { solid }) };
      const { battle } = new Match([CORVETTE, DINKY], { seed: 3, goal });
      return battle.world.bodies.ghost[battle.world.bodies.indexOf(battle.ships.body(battle.marker))]!;
    };
    expect(ghostOf(undefined)).toBe(0);
    expect(ghostOf(true)).toBe(0);
    expect(ghostOf(false)).toBe(1);
  });

  it('flies a lone ship to the clock, as a test of piloting alone', () => {
    const result = runMatch([CORVETTE], { seed: 5, duration: 20 });
    expect(result.ending).toEqual('timeout');
    expect(result.elapsed).toBeCloseTo(20, 9);
    expect(result.scores).toHaveLength(1);
    expect(result.scores[0]!.damage).toEqual(0);
  });

  it('credits damage to whoever did it', () => {
    // The capital out-shoots the fighter by a wide margin, so a scorer that
    // could not tell who fired — one crediting everyone for damage taken by
    // anyone — would not separate these two.
    const result = runMatch([GUNSHIP, DINKY], { seed: 11 });
    const [gunship, dinky] = result.scores;
    expect(gunship!.damage).toBeGreaterThan(dinky!.damage);
    expect(gunship!.taken).toBeLessThan(dinky!.taken);
  });

  it('scores nothing for a goal it is not told to hold', () => {
    const result = runMatch(FLEET, { seed: 13, goal: null });
    for (const score of result.scores) expect(score.race).toEqual(0);
  });

  it('scores nothing for holding a position, however good it is', () => {
    // A craft that starts on the goal and stays there has gained nothing, and
    // nor has one that starts far off and stays there. The quantity is ground
    // *gained*: what a design is credited with is what it did, not where it
    // happened to be put.
    const onIt = runMatch([CORVETTE], {
      seed: 17,
      duration: 20,
      goal: { x: DEFAULT_MATCH.radius, y: 0, scale: 500, size: 12 },
    });
    const milesOff = runMatch([CORVETTE], {
      seed: 17,
      duration: 20,
      goal: { x: 100_000, y: 0, scale: 500, size: 12 },
    });
    expect(onIt.scores[0]!.race).toBeCloseTo(0, 2);
    expect(milesOff.scores[0]!.race).toBeCloseTo(0, 6);
  });

  it('pays for ground gained at any distance, and charges for ground lost', () => {
    // **The falloff has no end to it, and neither has the credit for closing.**
    // A goal that stopped counting past some distance would leave everything
    // beyond it flat, and a flat region is one selection cannot see across.
    // Measured by moving the goal itself rather than the ship: a craft holding
    // station while the goal is placed nearer or further is the same craft
    // doing the same thing, so what changes is only how much of the field it
    // has gained or lost.
    // A craft that will actually go, so there is ground to gain: one with no
    // doctrine about the objective holds its position and scores nothing at
    // any distance, which is the previous test.
    const closing = (metres: number): number =>
      runMatch([escorting(CORVETTE, 200)], {
        seed: 17,
        duration: 30,
        goal: { x: DEFAULT_MATCH.radius + metres, y: 0, scale: 500, size: 12 },
      }).scores[0]!.race;
    // Every distance pays, including one far outside anything the falloff
    // would once have reached — there is no range at which closing stops
    // counting, and so no plateau for a search to be stranded on.
    for (const metres of [200, 2_000, 20_000]) {
      expect(closing(metres), `${metres} m`).toBeGreaterThan(0);
    }
    expect(closing(200)).toBeGreaterThan(closing(20_000));
  });

  it('is reached by a ship whose doctrine says to go to it', () => {
    // The goal is a hull on the neutral side, so going to it is *escorting*
    // it: what a ship does about the objective comes out of its doctrine like
    // everything else it does, and is weighed against the fight rather than
    // scripted. A design with nothing to say about escorting never leaves the
    // ring it started on, and so gains no ground and scores nothing at all —
    // where one that goes to the goal is credited with the whole of the
    // distance it closed.
    const alone = runMatch([CORVETTE], { seed: 23, duration: 60 });
    const going = runMatch([escorting(CORVETTE, 200)], { seed: 23, duration: 60 });
    expect(alone.scores[0]!.race).toBeCloseTo(0, 2);
    expect(going.scores[0]!.race).toBeGreaterThan(0.25);
  });

  it('measures a hull by what it can absorb', () => {
    // Damage is a fraction of this rather than a count of joules, which is
    // what makes one weight mean the same thing to a fighter and a capital.
    expect(hullCapacity(compileBlueprint(GUNSHIP))).toBeGreaterThan(
      hullCapacity(compileBlueprint(DINKY)) * 10,
    );
  });

  it('runs a match far faster than the battle it simulates', () => {
    // Evolution is the reason the simulation is headless at all: a generation
    // is hundreds of these. This is a floor, not a benchmark — it fails if
    // something makes a match slower than the battle it is simulating.
    const started = Date.now();
    const result = runMatch(FLEET, { seed: 19 });
    const spent = (Date.now() - started) / 1000;
    expect(spent).toBeLessThan(result.elapsed);
  });
});
