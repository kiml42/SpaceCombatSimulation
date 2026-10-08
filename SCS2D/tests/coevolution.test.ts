import { describe, expect, it } from 'vitest';
import { DINKY, GUNSHIP } from '../scenarios/blueprints.js';
import { rivalSettings, runCoevolution } from '../evolution/coevolution.js';
import { parseRunConfig, runConfigFileProblem, serialiseRunConfig } from '../evolution/configFile.js';
import { DEFAULT_RUN, type GenerationRecord, type RunConfig, type RunRecord } from '../evolution/run.js';
import { championGrid, GridMeasure } from '../evolution/yardstick.js';

/** Small and short: what is under test is who fights whom and who breeds, not the fighting. */
const SETTINGS: Partial<RunConfig> = {
  seed: 7,
  generations: 3,
  population: 4,
  winners: 2,
  group: 1,
  minMatches: 4,
  fleet: { maxShips: 1 },
  match: { duration: 8 },
};

const run = runCoevolution([DINKY], [GUNSHIP], SETTINGS, { hall: 2, hallShare: 0.25 });
const sideB = run.rival!.generations;

const ids = (generation: GenerationRecord): Set<number> => new Set(generation.individuals.map((i) => i.id));
const seeds = (generation: GenerationRecord): Set<number> => new Set(generation.matches.map((m) => m.seed));

// Each of these fights whole generations, so they are slow by nature; the
// default timeout is for tests that are quick by nature, and on a busy runner
// the longest of them was over it.
describe('a co-evolution run', { timeout: 30_000 }, () => {
  it('breeds each side only from its own', () => {
    expect(run.generations).toHaveLength(3);
    expect(sideB).toHaveLength(3);
    for (const [side, founder] of [
      [run.generations, 'Dinky'],
      [sideB, 'Gunship'],
    ] as const) {
      // A first generation is one breeding from its founder, so its name is the
      // founder's or a letter away from it, as a name drifts.
      for (const individual of side[0]!.individuals) {
        expect(oneLetterFrom(individual.blueprint!['name'] as string, founder), individual.blueprint!['name'] as string).toBe(true);
      }
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

  it('keeps a side B that does not evolve as its founders, and breeds side A against it', () => {
    const fixed = runCoevolution([DINKY], [GUNSHIP], SETTINGS, { rivalEvolves: false, hall: 2 });
    for (const generation of fixed.rival!.generations) {
      expect(generation.individuals.map((i) => [i.id, i.parent, i.edits.length])).toEqual([[4, -1, 0]]);
    }
    expect(fixed.generations[2]!.individuals.some((i) => i.parent >= 0)).toBe(true);
    for (const generation of fixed.generations) {
      for (const individual of generation.individuals) expect(individual.matches).toBeGreaterThanOrEqual(4);
    }
    // It plays no champions of side A's: every match it is in, side A was scored for too.
    for (let g = 0; g < 3; g++) {
      const a = seeds(fixed.generations[g]!);
      for (const seed of seeds(fixed.rival!.generations[g]!)) expect(a.has(seed)).toBe(true);
    }
  });

  it("fields each side's own number of entrants a match, as allies, and credits them against the other side", () => {
    // Several of side A against one side B that does not evolve: a boss battle.
    const fixed = runCoevolution([DINKY], [GUNSHIP], { ...SETTINGS, group: 3, generations: 2 }, { rivalEvolves: false, rival: { group: 1 } });
    const b = fixed.rival!.generations[0]!.individuals[0]!.id;
    for (const generation of fixed.generations) {
      for (const match of generation.matches) {
        expect(match.teams).toEqual([0, 0, 0, 1]);
        expect(match.competitors[3]).toBe(b);
      }
      for (const individual of generation.individuals) expect(individual.matches).toBeGreaterThanOrEqual(4);
    }
    // Two a side, with both halls in play.
    const even = runCoevolution([DINKY], [GUNSHIP], { ...SETTINGS, group: 2 }, { hall: 2 });
    for (const generation of [...even.generations, ...even.rival!.generations]) {
      for (const match of generation.matches) {
        expect(match.teams).toEqual([0, 0, 1, 1]);
        expect(new Set(match.competitors.slice(0, 2)).size + new Set(match.competitors.slice(2)).size).toBeGreaterThanOrEqual(3);
      }
    }
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
      coevolution: { rival: { population: 6, group: 1, massBudget: Infinity }, hall: 3, hallShare: 0.5, rivalEvolves: true },
    },
    config: DEFAULT_RUN,
  };

  it('round-trips side B, its hall and its own settings', () => {
    const file = JSON.parse(JSON.stringify(serialiseRunConfig(setup)));
    expect(file.versus).toEqual({ founders: ['Gunship'], hall: 3, hallShare: 0.5, population: 6, group: 1, massBudget: null });
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
    expect(file.versus.evolves).toBeUndefined();
    const fixed = parseRunConfig({ versus: { founders: ['Gunship'], evolves: false } });
    expect(fixed.versus!.coevolution.rivalEvolves).toBe(false);
    expect(serialiseRunConfig(fixed).versus).toMatchObject({ evolves: false });
    expect(runConfigFileProblem({ versus: { founders: ['Gunship'], kinds: { turret: -1 } } })).toMatch(/versus\.kinds\.turret/);
  });

  it('refuses a side B with nothing to found it, or a hall that is not a count', () => {
    expect(runConfigFileProblem({ versus: {} })).toMatch(/at least one founder/);
    expect(runConfigFileProblem({ versus: { founders: ['Gunship'], group: 0 } })).toMatch(/versus\.group/);
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

  it('comes out the same fought a slice at a time, as the page fights it', () => {
    const measure = new GridMeasure(run, { samples: 2, seeds: 1 });
    let progress = measure.progress;
    while (measure.advance(37)) {
      expect(measure.progress).toBeGreaterThanOrEqual(progress);
      progress = measure.progress;
    }
    expect(measure.progress).toBe(1);
    expect(measure.report()).toEqual(championGrid(run, { samples: 2, seeds: 1 }));
  });

  it('is empty for a run of one', () => {
    const single: RunRecord = { config: run.config, generations: run.generations };
    expect(championGrid(single).generations).toEqual([]);
  });
});

/** Whether one name is the other, or the other with one letter changed, added or taken away. */
function oneLetterFrom(name: string, from: string): boolean {
  if (name === from) return true;
  if (Math.abs(name.length - from.length) > 1) return false;
  let i = 0;
  while (i < name.length && i < from.length && name[i] === from[i]) i++;
  // The rest must match once the one letter that differs is stepped over on whichever side has it.
  return (
    name.slice(i + 1) === from.slice(i + 1) || name.slice(i + 1) === from.slice(i) || name.slice(i) === from.slice(i + 1)
  );
}
