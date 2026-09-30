import { describe, expect, it } from 'vitest';
import { expandFleet } from '../sim/index.js';
import { Match, runMatch } from '../evolution/match.js';
import { runEvolution } from '../evolution/run.js';
import { parseRunConfig, serialiseRunConfig } from '../evolution/configFile.js';
import { DEFAULT_RUN } from '../evolution/run.js';
import { BARE_CORE, CORVETTE, DINKY, GUNSHIP } from '../scenarios/blueprints.js';
import { LINE_OF_BATTLE } from '../scenarios/fleets.js';

/** Every entrant on one side against a boss that does not evolve. */

/** A match in which, every step, entrant 0 is credited with a huge hit on entrant 1. */
function withFriendlyFire(boss: typeof GUNSHIP | null): Match {
  const match = new Match([GUNSHIP, GUNSHIP], { seed: 1, duration: 1, boss });
  const { battle } = match;
  const bodyOf = (k: number): number => battle.world.bodies.indexOf(battle.ships.body(battle.slots[k]!));
  const [a, b] = [battle.owners.indexOf(0), battle.owners.indexOf(1)];
  const step = battle.step.bind(battle);
  battle.step = () => {
    step();
    battle.credit.push(bodyOf(a), bodyOf(b), 1e15);
  };
  return match;
}

describe('a boss battle', () => {
  it('puts every entrant on one side, and the boss at the middle on the other', () => {
    const match = new Match([CORVETTE, DINKY, CORVETTE], { seed: 2, boss: LINE_OF_BATTLE });
    const { ships, slots, owners, world, marker } = match.battle;
    expect(marker).toBe(-1);
    const bossShips = slots.filter((_, k) => owners[k] === 3);
    expect(bossShips).toHaveLength(expandFleet(LINE_OF_BATTLE).length);
    slots.forEach((slot, k) => expect(ships.teamOf(slot)).toBe(owners[k] === 3 ? 1 : 0));
    // Its origin at the middle of the ring: the fleet spreads round it.
    let x = 0;
    let y = 0;
    for (const slot of bossShips) {
      const body = world.bodies.indexOf(ships.body(slot));
      x += world.bodies.x[body]!;
      y += world.bodies.y[body]!;
    }
    expect(Math.sqrt(x * x + y * y) / bossShips.length).toBeLessThan(200);
  });

  it('pays nothing for hitting another entrant', () => {
    const free = withFriendlyFire(null);
    while (!free.done) free.advance();
    expect(free.result().scores[0]!.damage).toBe(1);

    const together = withFriendlyFire(BARE_CORE);
    while (!together.done) together.advance();
    const [shooter] = together.result().scores;
    expect(shooter!.damage).toBe(0);
    expect(shooter!.disabling).toBe(0);
  });

  it('is decided once the boss can no longer fight', () => {
    const result = runMatch([GUNSHIP, GUNSHIP, GUNSHIP], { seed: 4, boss: CORVETTE, weights: { ...runWeights } });
    expect(result.ending).toBe('decided');
    expect(Math.max(...result.scores.map((score) => score.damage))).toBeGreaterThan(0);
    expect(result.scores).toHaveLength(3);
  });

  it('breeds against the boss, and records it for replays', () => {
    const run = runEvolution([DINKY], {
      seed: 2,
      generations: 1,
      population: 4,
      group: 2,
      minMatches: 1,
      fleet: { maxShips: 1 },
      match: { duration: 10, boss: GUNSHIP },
    });
    expect(run.config.match.boss).toBe(GUNSHIP);
    expect(run.generations[0]!.matches.length).toBeGreaterThan(0);
  });

  it('names its boss in a config file', () => {
    const setup = { founders: ['Dinky'], boss: { kind: 'fleet' as const, name: 'Line of Battle' }, config: DEFAULT_RUN };
    const file = serialiseRunConfig(setup);
    expect((file['match'] as Record<string, unknown>)['boss']).toEqual({ fleet: 'Line of Battle' });
    expect(parseRunConfig(JSON.parse(JSON.stringify(file))).boss).toEqual(setup.boss);
    expect(parseRunConfig({ founders: ['Dinky'] }).boss).toBeNull();
  });
});

const runWeights = { survival: 1, functional: 1, damage: 1, disabling: 1, race: 0 };
