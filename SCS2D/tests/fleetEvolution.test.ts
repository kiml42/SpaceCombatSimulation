import { describe, expect, it } from 'vitest';
import { compileBlueprint, fleetHulls, fleetMass, fleetReach, Rng, shipFleet, type Fleet } from '../sim/index.js';
import { isFleet, Match, runMatch } from '../evolution/match.js';
import { DEFAULT_FLEET_LIMITS, fleetFits, mutateFleet, type FleetOperator } from '../evolution/fleetMutate.js';
import { entrantOf, runEvolution } from '../evolution/run.js';
import { parseRunConfig, runConfigFileProblem, serialiseRunConfig } from '../evolution/configFile.js';
import { DEFAULT_RUN } from '../evolution/run.js';
import { BARE_CORE, CORVETTE, DINKY, GUNSHIP } from '../scenarios/blueprints.js';
import { LINE_OF_BATTLE } from '../scenarios/fleets.js';

/** Fleets as entrants, bred as fleets. */

const SHORT = { duration: 20 };

function only(operator: FleetOperator): Record<FleetOperator, number> {
  const weights = { design: 0, move: 0, add: 0, remove: 0, fork: 0, merge: 0 };
  weights[operator] = 1;
  return weights;
}

function pair(): Fleet {
  return {
    name: 'Pair',
    designs: { Dinky: DINKY },
    ships: [
      { design: 'Dinky', x: 0, y: -40 },
      { design: 'Dinky', x: 0, y: 40 },
    ],
  };
}

describe('a match of fleets', () => {
  it('scores a fleet of one exactly as the ship alone', () => {
    const ships = runMatch([CORVETTE, GUNSHIP, DINKY], { ...SHORT, seed: 3 });
    const fleets = runMatch([shipFleet(CORVETTE), GUNSHIP, shipFleet(DINKY)], { ...SHORT, seed: 3 });
    expect(JSON.stringify(fleets)).toEqual(JSON.stringify(ships));
  });

  it('fields every ship of every fleet, taking turns', () => {
    const match = new Match([pair(), CORVETTE], { seed: 1 });
    expect(match.battle.owners).toEqual([0, 1, 0]);
  });

  it('keeps survival a fraction however many ships a side has', () => {
    const result = runMatch([LINE_OF_BATTLE, pair()], { ...SHORT, seed: 2 });
    for (const score of result.scores) {
      expect(score.survival).toBeGreaterThanOrEqual(0);
      expect(score.survival).toBeLessThanOrEqual(1);
    }
  });

  it('scores survival as one fraction per fleet, not per ship', () => {
    const alone = runMatch([shipFleet(DINKY)], { ...SHORT, seed: 2 });
    const two = runMatch([pair()], { ...SHORT, seed: 2 });
    expect(alone.scores[0]!.survival).toBeCloseTo(1, 9);
    expect(two.scores[0]!.survival).toBeCloseTo(1, 9);
  });

  it('races by the nearest ship, so a straggler costs nothing', () => {
    const straggler: Fleet = {
      name: 'Straggler',
      designs: { Dinky: DINKY, Core: BARE_CORE },
      ships: [
        { design: 'Dinky', x: 0, y: 0 },
        { design: 'Core', x: -150, y: 0 },
      ],
    };
    const match = new Match([straggler, CORVETTE], { ...SHORT, seed: 2 });
    const { ships, world, slots, owners, marker } = match.battle;
    const nearest = (): number => {
      const goal = world.bodies.indexOf(ships.body(marker));
      let best = 0;
      slots.forEach((slot, k) => {
        if (owners[k] !== 0 || !ships.isAlive(slot) || !ships.hasControl(slot)) return;
        const body = world.bodies.indexOf(ships.body(slot));
        const d = Math.sqrt((world.bodies.x[body]! - world.bodies.x[goal]!) ** 2 + (world.bodies.y[body]! - world.bodies.y[goal]!) ** 2);
        best = Math.max(best, 500 / (500 + d));
      });
      return best;
    };
    const start = nearest();
    let sum = 0;
    let steps = 0;
    while (!match.done) {
      match.advance();
      steps++;
      const best = nearest();
      if (best > 0) sum += best - start;
    }
    expect(match.result().scores[0]!.race).toBeCloseTo(sum / steps, 6);
  });

  it('widens the ring rather than start two fleets on top of each other', () => {
    const wide: Fleet = { ...LINE_OF_BATTLE, ships: LINE_OF_BATTLE.ships.map((s) => ({ ...s, x: s.x * 3, y: s.y * 3 })) };
    const match = new Match([wide, wide, wide, wide], { seed: 4, radius: 100 });
    const { ships, world, owners, slots } = match.battle;
    const at = slots.map((slot) => {
      const body = world.bodies.indexOf(ships.body(slot));
      return { x: world.bodies.x[body]!, y: world.bodies.y[body]!, r: ships.design(slot).radius };
    });
    for (let i = 0; i < at.length; i++) {
      for (let k = i + 1; k < at.length; k++) {
        if (owners[i] === owners[k]) continue;
        const gap = Math.sqrt((at[i]!.x - at[k]!.x) ** 2 + (at[i]!.y - at[k]!.y) ** 2);
        expect(gap).toBeGreaterThan(at[i]!.r + at[k]!.r);
      }
    }
  });
});

describe('breeding a fleet', () => {
  it('breeds the same fleet from the same seed', () => {
    const one = mutateFleet(LINE_OF_BATTLE, new Rng(7));
    const two = mutateFleet(LINE_OF_BATTLE, new Rng(7));
    expect(JSON.stringify(one)).toEqual(JSON.stringify(two));
  });

  it('makes a change with every operator, each within the limits', () => {
    const limits = { radius: 500, maxShips: 24, massBudget: Infinity };
    const parents: Record<FleetOperator, Fleet> = {
      design: LINE_OF_BATTLE,
      move: LINE_OF_BATTLE,
      add: pair(),
      remove: LINE_OF_BATTLE,
      fork: pair(),
      merge: LINE_OF_BATTLE,
    };
    for (const [operator, parent] of Object.entries(parents) as [FleetOperator, Fleet][]) {
      const child = mutateFleet(parent, new Rng(11), { ...limits, operators: only(operator) });
      expect(child.edits.length, operator).toBeGreaterThan(0);
      expect(fleetFits(child.fleet, limits), operator).toBe(true);
    }
  });

  it('never leaves the parent changed', () => {
    const before = JSON.stringify(LINE_OF_BATTLE);
    for (let seed = 0; seed < 20; seed++) mutateFleet(LINE_OF_BATTLE, new Rng(seed));
    expect(JSON.stringify(LINE_OF_BATTLE)).toEqual(before);
  });

  it('refuses what breaks a limit, and returns the parent', () => {
    const mass = fleetMass(fleetHulls(pair()));
    const parent = pair();
    const crowded = mutateFleet(parent, new Rng(3), { maxShips: 2, operators: only('add') });
    expect(crowded.edits).toEqual([]);
    expect(crowded.fleet).toBe(parent);
    const heavy = mutateFleet(pair(), new Rng(3), { massBudget: mass * 1.2, operators: only('add') });
    expect(heavy.edits).toEqual([]);
    const lone = shipFleet(DINKY);
    const cramped = mutateFleet(lone, new Rng(3), { radius: fleetReach(fleetHulls(lone)) + 1, operators: only('add') });
    expect(cramped.edits).toEqual([]);
  });

  it('keeps one entry, however often entries are taken out', () => {
    let fleet = LINE_OF_BATTLE;
    const rng = new Rng(5);
    for (let i = 0; i < 20; i++) fleet = mutateFleet(fleet, rng, { operators: only('remove') }).fleet;
    expect(fleet.ships).toHaveLength(1);
    expect(fleetFits(fleet, { radius: 500, maxShips: 24, massBudget: Infinity })).toBe(true);
  });

  it('merges back what it forked', () => {
    const forked = mutateFleet(pair(), new Rng(1), { operators: only('fork') }).fleet;
    expect(Object.keys(forked.designs)).toEqual(['Dinky', 'Dinky 2']);
    const merged = mutateFleet(forked, new Rng(1), { operators: only('merge') }).fleet;
    expect(Object.keys(merged.designs)).toHaveLength(1);
    expect(fleetHulls(merged)).toHaveLength(2);
  });
});

describe('a run of fleets', () => {
  const settings = { seed: 2, generations: 2, population: 4, winners: 2, group: 2, minMatches: 1, match: SHORT };

  it('records each individual as a fleet, with its whole mass', () => {
    const run = runEvolution([pair()], settings);
    for (const generation of run.generations) {
      for (const individual of generation.individuals) {
        const fleet = entrantOf(individual);
        expect(isFleet(fleet)).toBe(true);
        expect(individual.blueprint).toBeUndefined();
        expect(individual.mass).toBeCloseTo(fleetMass(fleetHulls(fleet as Fleet)));
      }
    }
    const bred = run.generations.flatMap((g) => g.individuals).filter((i) => i.parent >= 0);
    expect(bred.some((i) => i.edits.length > 0)).toBe(true);
  });

  it('takes a ship among fleet founders as a fleet of one', () => {
    const run = runEvolution([pair(), CORVETTE], { ...settings, generations: 1 });
    const founder = run.generations[0]!.individuals.find((i) => i.id === 1)!;
    const fleet = entrantOf(founder) as Fleet;
    expect(fleet.ships).toHaveLength(1);
    expect(fleetMass(fleetHulls(fleet))).toBeCloseTo(compileBlueprint(CORVETTE).mass);
  });

  it('lets a ship founder grow into a fleet', () => {
    const run = runEvolution([DINKY], { ...settings, generations: 3 });
    for (const generation of run.generations) {
      for (const individual of generation.individuals) expect(isFleet(entrantOf(individual))).toBe(true);
    }
  });

  it('stays a run of ships when a ship may not grow', () => {
    const run = runEvolution([DINKY], { ...settings, generations: 1, fleet: { maxShips: 1 } });
    for (const individual of run.generations[0]!.individuals) {
      expect(individual.fleet).toBeUndefined();
      expect(isFleet(entrantOf(individual))).toBe(false);
    }
  });
});

describe('a run-config file with fleets', () => {
  it('round-trips the fleets and their limits', () => {
    const setup = {
      founders: ['Corvette'],
      fleets: ['Line of Battle'],
      config: { ...DEFAULT_RUN, fleet: { radius: 300, maxShips: 8, operators: { ...DEFAULT_FLEET_LIMITS.operators, add: 3 } } },
    };
    const read = parseRunConfig(JSON.parse(JSON.stringify(serialiseRunConfig(setup))));
    expect(read.fleets).toEqual(['Line of Battle']);
    expect(read.config.fleet).toEqual(setup.config.fleet);
  });

  it('refuses a change it has never heard of', () => {
    expect(runConfigFileProblem({ fleet: { operators: { teleport: 1 } } })).toMatch(/teleport/);
    expect(runConfigFileProblem({ fleet: { operators: { add: -1 } } })).toMatch(/zero or more/);
  });

  it('writes the fleet limits for a run of ships, which may grow into fleets', () => {
    const file = serialiseRunConfig({ founders: ['Corvette'], config: DEFAULT_RUN });
    expect(file['fleets']).toBeUndefined();
    expect(file['fleet']).toMatchObject({ maxShips: DEFAULT_FLEET_LIMITS.maxShips });
  });

  it('reads a file from before fleets as a run of ships', () => {
    expect(parseRunConfig({ founders: ['Corvette'] }).config.fleet.maxShips).toEqual(1);
    expect(parseRunConfig({ founders: ['Corvette'], fleet: {} }).config.fleet.maxShips).toEqual(DEFAULT_FLEET_LIMITS.maxShips);
  });
});
