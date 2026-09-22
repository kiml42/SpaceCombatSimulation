import { describe, expect, it } from 'vitest';
import { compileBlueprint } from '../sim/index.js';
import { DEFAULT_MATCH, hullCapacity, runMatch } from '../evolution/match.js';
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
        expect(score.race, where).toBeGreaterThanOrEqual(0);
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
    // The match stops when one entrant is left, and what is left of it is
    // credited to whoever is still standing. Without that, killing everything
    // in ten seconds of a two-minute match scores a twelfth of what failing
    // to land a shot for two minutes scores.
    const result = runMatch([GUNSHIP, DINKY], { seed: 11 });
    expect(result.ending).toEqual('decided');
    expect(result.elapsed).toBeLessThan(DEFAULT_MATCH.duration);
    const winner = result.scores.reduce((best, score) => (score.total > best.total ? score : best));
    expect(winner.survival).toEqual(1);
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

  it('scores a whole match held on the goal as one', () => {
    // One entrant, nobody to fight, and the goal sitting exactly where it
    // starts: it holds its position for the whole match, so the race
    // component is the most it can be. The plainest statement of what the
    // proximity integral means.
    const result = runMatch([CORVETTE], {
      seed: 17,
      duration: 20,
      goal: { x: DEFAULT_MATCH.radius, y: 0, reach: 500, size: 12 },
    });
    expect(result.ending).toEqual('timeout');
    expect(result.scores[0]!.race).toBeGreaterThan(0.97);
    expect(result.scores[0]!.survival).toEqual(1);
  });

  it('scores nothing for a goal it is nowhere near', () => {
    const result = runMatch([CORVETTE], {
      seed: 17,
      duration: 20,
      goal: { x: 100_000, y: 0, reach: 500, size: 12 },
    });
    expect(result.scores[0]!.race).toEqual(0);
  });

  it('is reached by a ship whose doctrine says to go to it', () => {
    // The goal is a hull on the neutral side, so going to it is *escorting*
    // it: what a ship does about the objective comes out of its doctrine like
    // everything else it does, and is weighed against the fight rather than
    // scripted. A design with nothing to say about escorting never leaves the
    // ring it started on, and scores whatever the ring is worth — which is
    // half, the goal reaching twice as far as the ring is wide, and is the
    // same half for everyone, so what selection sees is the difference.
    const alone = runMatch([CORVETTE], { seed: 23, duration: 60 });
    const going = runMatch([escorting(CORVETTE, 200)], { seed: 23, duration: 60 });
    expect(alone.scores[0]!.race).toBeCloseTo(0.5, 2);
    expect(going.scores[0]!.race).toBeGreaterThan(0.8);
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
