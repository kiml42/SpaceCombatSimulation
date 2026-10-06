import { describe, expect, it } from 'vitest';
import { DINKY, GUNSHIP } from '../scenarios/blueprints.js';
import { rivalSettings, runCoevolution } from '../evolution/coevolution.js';
import { parseRunConfig, runConfigFileProblem, serialiseRunConfig } from '../evolution/configFile.js';
import { DEFAULT_RUN, type GenerationRecord, type RunConfig, type RunRecord } from '../evolution/run.js';
import { championGrid } from '../evolution/yardstick.js';

/** Small and short: what is under test is who fights whom and who breeds, not the fighting. */
const SETTINGS: Partial<RunConfig> = {
  seed: 7,
  generations: 3,
  population: 4,
  winners: 2,
  minMatches: 4,
  fleet: { maxShips: 1 },
  match: { duration: 8 },
};

const run = runCoevolution([DINKY], [GUNSHIP], SETTINGS, { hall: 2, hallShare: 0.25 });
const sideB = run.rival!.generations;

const ids = (generation: GenerationRecord): Set<number> => new Set(generation.individuals.map((i) => i.id));
const seeds = (generation: GenerationRecord): Set<number> => new Set(generation.matches.map((m) => m.seed));

describe('a co-evolution run', () => {
  it('breeds each side only from its own', () => {
    expect(run.generations).toHaveLength(3);
    expect(sideB).toHaveLength(3);
    for (const [side, founder] of [
      [run.generations, 'Dinky'],
      [sideB, 'Gunship'],
    ] as const) {
      for (const individual of side[0]!.individuals) expect(individual.blueprint!['name']).toBe(founder);
      for (let g = 1; g < side.length; g++) {
        const before = [...side.slice(0, g)].flatMap((generation) => [...ids(generation)]);
        for (const individual of side[g]!.individuals) {
          expect(individual.parent < 0 || before.includes(individual.parent) || before.includes(individual.id)).toBe(true);
        }
      }
    }
    // No id is on both sides.
    const a = run.generations.flatMap((generation) => [...ids(generation)]);
    const b = sideB.flatMap((generation) => [...ids(generation)]);
    expect(a.filter((id) => b.includes(id))).toEqual([]);
  });

  it('only ever fights one of A against one of B, with nothing to race to', () => {
    const a = new Set(run.generations.flatMap((generation) => [...ids(generation)]));
    const b = new Set(sideB.flatMap((generation) => [...ids(generation)]));
    for (const generation of [...run.generations, ...sideB]) {
      for (const match of generation.matches) {
        expect(match.competitors).toHaveLength(2);
        expect(a.has(match.competitors[0]!)).toBe(true);
        expect(b.has(match.competitors[1]!)).toBe(true);
        for (const score of match.scores) expect(score.race).toBe(0);
      }
      for (const individual of generation.individuals) expect(individual.matches).toBeGreaterThanOrEqual(4);
    }
  });

  it("spends a share of every individual's matches on the other side's hall, once there is one", () => {
    // In the first generation there is no hall, so every match is between the sides as they are.
    expect([...seeds(run.generations[0]!)]).toEqual([...seeds(sideB[0]!)]);
    for (let g = 1; g < 3; g++) {
      // A match against a champion is in the record of the side that was scored for it, and only that one.
      const theirs = seeds(sideB[g]!);
      const onlyA = [...seeds(run.generations[g]!)].filter((seed) => !theirs.has(seed));
      expect(onlyA).toHaveLength(SETTINGS.population!);
    }
  });

  it('gives side B its own settings where it has them', () => {
    const uneven = runCoevolution([DINKY], [DINKY], { ...SETTINGS, generations: 2 }, { rival: { population: 6, winners: 3 } });
    expect(uneven.generations.map((g) => g.individuals.length)).toEqual([4, 4]);
    expect(uneven.rival!.generations.map((g) => g.individuals.length)).toEqual([6, 6]);
  });

  it("takes side A's settings for side B, with side B's own laid over them entry by entry", () => {
    const a: RunConfig = {
      ...DEFAULT_RUN,
      population: 8,
      mutation: { structural: 0.3, kinds: { engine: 5, turret: 1 } as never, doctrine: { targeting: 2 } as never },
      fleet: { maxShips: 3, operators: { add: 2 } as never },
    };
    const b = rivalSettings(a, {
      winners: 3,
      mutation: { kinds: { turret: 0 } as never },
      fleet: { operators: { remove: 4 } as never },
    });
    expect(b.population).toBe(8);
    expect(b.winners).toBe(3);
    expect(b.mutation.structural).toBe(0.3);
    expect(b.mutation.kinds).toEqual({ engine: 5, turret: 0 });
    expect(b.mutation.doctrine).toEqual({ targeting: 2 });
    expect(b.fleet).toEqual({ maxShips: 3, operators: { add: 2, remove: 4 } });
    // Nothing set apart is side A exactly.
    expect(rivalSettings(a, {})).toEqual(a);
  });

  it('comes out the same from the same seed', () => {
    const again = runCoevolution([DINKY], [GUNSHIP], SETTINGS, { hall: 2, hallShare: 0.25 });
    expect(JSON.stringify(again)).toEqual(JSON.stringify(run));
  });
});

describe('a run-config file with versus', () => {
  const setup = {
    founders: ['Dinky'],
    versus: {
      founders: ['Gunship'],
      fleets: [],
      coevolution: { rival: { population: 6, massBudget: Infinity }, hall: 3, hallShare: 0.5 },
    },
    config: DEFAULT_RUN,
  };

  it('round-trips side B, its hall and its own settings', () => {
    const file = JSON.parse(JSON.stringify(serialiseRunConfig(setup)));
    expect(file.versus).toEqual({ founders: ['Gunship'], hall: 3, hallShare: 0.5, population: 6, massBudget: null });
    expect(parseRunConfig(file).versus).toEqual(setup.versus);
    expect(parseRunConfig({ founders: ['Dinky'] }).versus).toBeNull();
  });

  it("keeps side B's own mutation weights, and only those it sets", () => {
    const own = {
      ...setup,
      versus: {
        ...setup.versus,
        coevolution: {
          ...setup.versus.coevolution,
          rival: { mutation: { structural: 0, kinds: { turret: 0 } as never, doctrine: { approach: 3 } as never } },
        },
      },
    };
    const file = JSON.parse(JSON.stringify(serialiseRunConfig(own)));
    expect(file.versus).toMatchObject({ structural: 0, kinds: { turret: 0 }, doctrine: { approach: 3 } });
    expect(file.versus.build).toBeUndefined();
    expect(parseRunConfig(file).versus!.coevolution.rival.mutation).toEqual(own.versus.coevolution.rival.mutation);
    expect(runConfigFileProblem({ versus: { founders: ['Gunship'], kinds: { turret: -1 } } })).toMatch(/versus\.kinds\.turret/);
  });

  it('refuses a side B with nothing to found it, a boss beside it, or a hall that is not a count', () => {
    expect(runConfigFileProblem({ versus: {} })).toMatch(/at least one founder/);
    expect(runConfigFileProblem({ versus: { founders: ['Gunship'] }, match: { boss: { ship: 'Corvette' } } })).toMatch(/no boss/);
    expect(runConfigFileProblem({ versus: { founders: ['Gunship'], hall: 1.5 } })).toMatch(/hall must be a whole number/);
    expect(runConfigFileProblem({ versus: { founders: ['Gunship'], hallShare: 2 } })).not.toBeNull();
  });
});

describe('the champion grid', () => {
  it("fights each side's champions against the other's, the same way every time", () => {
    const grid = championGrid(run, { samples: 2, seeds: 1 });
    expect(grid.generations).toEqual([0, 2]);
    expect(grid.cells).toHaveLength(2);
    for (const row of grid.cells) expect(row).toHaveLength(2);
    expect(grid.matches).toBe(4);
    expect(championGrid(run, { samples: 2, seeds: 1 })).toEqual(grid);
  });

  it('is empty for a run of one', () => {
    const single: RunRecord = { config: run.config, generations: run.generations };
    expect(championGrid(single).generations).toEqual([]);
  });
});
