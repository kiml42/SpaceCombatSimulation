import { describe, expect, it } from 'vitest';
import { DINKY, GUNSHIP } from '../scenarios/blueprints.js';
import { Coevolution, DEFAULT_COEVOLUTION, rivalSettings, runCoevolution } from '../evolution/coevolution.js';
import { parseRunConfig, runConfigFileProblem, serialiseRunConfig } from '../evolution/configFile.js';
import { DEFAULT_RUN, type GenerationRecord, type RunConfig, type RunRecord } from '../evolution/run.js';
import { championGrid, GridMeasure } from '../evolution/yardstick.js';
import { NO_BUDGET } from '../sim/bill.js';

/** Small and short: what is under test is who fights whom and who breeds, not the fighting. */
const SETTINGS: Partial<RunConfig> = {
  seed: 7,
  generations: 5,
  population: 4,
  winners: 2,
  group: 1,
  minMatches: 2,
  fleet: { maxShips: 1 },
  match: { duration: 8, goal: null },
};
const ROUNDS = { hall: 2, phaseCap: 2 };

const run = runCoevolution([DINKY], [GUNSHIP], SETTINGS, ROUNDS);
const sideB = run.rival!.generations;

const ids = (generation: GenerationRecord): Set<number> => new Set(generation.individuals.map((i) => i.id));
const founders = (generations: readonly GenerationRecord[]): number[] =>
  generations[0]!.individuals.filter((i) => i.parent < 0).map((i) => i.id);

// Each of these fights whole generations, so they are slow by nature; the
// default timeout is for tests that are quick by nature, and on a busy runner
// the longest of them was over it.
describe('a co-evolution run', { timeout: 60_000 }, () => {
  it('breeds each side only from its own', () => {
    expect(run.generations.length + sideB.length).toBe(5);
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

  it('breeds one side at a time, a round ending once its best usually wins or at the cap', () => {
    // Side A takes the even rounds and side B the odd ones.
    for (const generation of run.generations) expect(generation.round! % 2).toBe(0);
    for (const generation of sideB) expect(generation.round! % 2).toBe(1);
    const all = [...run.generations, ...sideB].sort((x, y) => x.round! - y.round!);
    const rounds = new Map<number, GenerationRecord[]>();
    for (const generation of all) rounds.set(generation.round!, [...(rounds.get(generation.round!) ?? []), generation]);
    const last = Math.max(...rounds.keys());
    for (const [round, generations] of rounds) {
      expect(generations.length).toBeLessThanOrEqual(ROUNDS.phaseCap);
      // Every round but the last ended: at the cap, or on a win.
      if (round === last) continue;
      const end = generations[generations.length - 1]!;
      expect(generations.length === ROUNDS.phaseCap || end.won! >= DEFAULT_COEVOLUTION.phaseWin).toBe(true);
      for (const early of generations.slice(0, -1)) expect(early.won!).toBeLessThan(DEFAULT_COEVOLUTION.phaseWin);
    }
  });

  it('races for the goal when the settings give one', () => {
    const racing = runCoevolution([DINKY], [GUNSHIP], { ...SETTINGS, generations: 1, match: { duration: 8 } }, ROUNDS);
    const raced = racing.generations[0]!.matches.filter((match) => match.drill === undefined).flatMap((match) => match.scores);
    expect(raced.some((score) => score.race !== 0)).toBe(true);
  });

  it('scores a bare-core drill for what it does to the core', () => {
    const drilled = runCoevolution([GUNSHIP], [DINKY], { ...SETTINGS, generations: 1, population: 2, match: { duration: 60, goal: null } }, {
      ...ROUNDS,
      shieldedDrills: 0,
      bareCoreDrills: 1,
    });
    const drills = drilled.generations[0]!.matches.filter((match) => match.drill === 'bareCore');
    expect(drills.length).toBeGreaterThan(0);
    for (const drill of drills) expect(drill.scores[drill.teams!.indexOf(0)]!.damage).toBeGreaterThan(0);
  });

  it("fights the other side's hall, its founders until it has champions, and drills, with nothing to race to", () => {
    const hallA = new Set([...founders(run.generations), ...run.generations.flatMap((generation) => [...ids(generation)])]);
    const hallB = new Set([...founders(sideB), ...sideB.flatMap((generation) => [...ids(generation)])]);
    for (const [generations, side, other] of [
      [run.generations, 0, hallB],
      [sideB, 1, hallA],
    ] as const) {
      for (const generation of generations) {
        const own = ids(generation);
        for (const match of generation.matches) {
          match.teams!.forEach((team, e) => {
            const id = match.competitors[e]!;
            if (team === side) expect(own.has(id)).toBe(true);
            else if (match.drill === 'bareCore') expect(id).toBe(-1);
            else expect(other.has(id)).toBe(true);
          });
          for (const score of match.scores) expect(score.race).toBe(0);
        }
        // Its matches, then a drill of each kind.
        for (const individual of generation.individuals) expect(individual.matches).toBe(SETTINGS.minMatches! + 2);
      }
    }
    // Side A's first round is against side B's founder.
    const opening = run.generations[0]!.matches.filter((match) => match.drill === undefined);
    for (const match of opening) expect(match.competitors[1]).toBe(founders(sideB)[0]);
  });

  it('shields the side being bred in a drill, and scores a drill only for what it did', () => {
    const shielded = run.generations.flatMap((generation) => generation.matches.filter((match) => match.drill === 'shielded'));
    expect(shielded.length).toBeGreaterThan(0);
    for (const match of shielded) {
      match.teams!.forEach((team, e) => {
        // Nothing it took landed: its hulls kept all they could absorb.
        if (team === 0) expect(match.scores[e]!.survival).toBeCloseTo(1, 9);
      });
    }
    const bare = run.generations.flatMap((generation) => generation.matches.filter((match) => match.drill === 'bareCore'));
    expect(bare.length).toBeGreaterThan(0);
  });

  it('gives side B its own settings where it has them', () => {
    const uneven = runCoevolution([DINKY], [DINKY], { ...SETTINGS, generations: 2 }, { ...ROUNDS, phaseCap: 1, rival: { population: 6, winners: 3 } });
    expect(uneven.generations.map((g) => g.individuals.length)).toEqual([4]);
    expect(uneven.rival!.generations.map((g) => g.individuals.length)).toEqual([6]);
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

  it('breeds side A throughout against a side B that does not evolve, in generations rather than rounds', () => {
    const fixed = runCoevolution([DINKY], [GUNSHIP], { ...SETTINGS, generations: 3 }, { ...ROUNDS, rivalEvolves: false });
    expect(fixed.rival!.generations).toEqual([]);
    expect(fixed.generations).toHaveLength(3);
    expect(fixed.generations[2]!.individuals.some((i) => i.parent >= 0)).toBe(true);
    for (const generation of fixed.generations) {
      expect(generation.round).toBeUndefined();
      for (const match of generation.matches) {
        if (match.drill !== 'bareCore') expect(match.competitors[1]).toBe(4);
      }
    }
  });

  it("fields each side's own number of entrants a match, as allies", () => {
    // Several of side A against one side B that does not evolve: a boss battle.
    const fixed = runCoevolution([DINKY], [GUNSHIP], { ...SETTINGS, group: 3, generations: 1 }, { rivalEvolves: false, rival: { group: 1 } });
    for (const match of fixed.generations[0]!.matches) expect(match.teams).toEqual([0, 0, 0, 1]);
    // Two a side, from a hall of one: the champion fields twice.
    const even = runCoevolution([DINKY], [GUNSHIP], { ...SETTINGS, group: 2, generations: 1 }, ROUNDS);
    for (const match of even.generations[0]!.matches) expect(match.teams).toEqual([0, 0, 1, 1]);
  });

  it('comes out the same from the same seed', () => {
    const again = runCoevolution([DINKY], [GUNSHIP], SETTINGS, ROUNDS);
    expect(JSON.stringify(again)).toEqual(JSON.stringify(run));
  });

  it('comes out the same fought a slice at a time, as the page fights it', () => {
    const live = new Coevolution([DINKY], [GUNSHIP], SETTINGS, ROUNDS);
    while (live.advance(97));
    expect(JSON.stringify(live.record())).toEqual(JSON.stringify(run));
  });
});

describe('a run-config file with versus', () => {
  const setup = {
    founders: ['Dinky'],
    versus: {
      founders: ['Gunship'],
      fleets: [],
      coevolution: {
        rival: { population: 6, group: 1, budget: NO_BUDGET },
        hall: 3,
        phaseWin: 0.75,
        phaseCap: 4,
        shieldedDrills: 2,
        bareCoreDrills: 0,
        rivalEvolves: true,
      },
    },
    config: DEFAULT_RUN,
  };

  it('round-trips side B, its hall and its own settings', () => {
    const file = JSON.parse(JSON.stringify(serialiseRunConfig(setup)));
    expect(file.versus).toEqual({
      founders: ['Gunship'],
      hall: 3,
      phaseWin: 0.75,
      phaseCap: 4,
      shieldedDrills: 2,
      bareCoreDrills: 0,
      population: 6,
      group: 1,
      budget: { metal: null, fuel: null, build: null },
    });
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

  it('refuses a side B with nothing to found it, or a hall or round that is not a count', () => {
    expect(runConfigFileProblem({ versus: {} })).toMatch(/at least one founder/);
    expect(runConfigFileProblem({ versus: { founders: ['Gunship'], group: 0 } })).toMatch(/versus\.group/);
    expect(runConfigFileProblem({ versus: { founders: ['Gunship'], hall: 1.5 } })).toMatch(/hall must be a whole number/);
    expect(runConfigFileProblem({ versus: { founders: ['Gunship'], phaseWin: 2 } })).toMatch(/phaseWin/);
    expect(runConfigFileProblem({ versus: { founders: ['Gunship'], phaseCap: 0 } })).toMatch(/phaseCap/);
    expect(runConfigFileProblem({ versus: { founders: ['Gunship'], shieldedDrills: -1 } })).toMatch(/shieldedDrills/);
    expect(runConfigFileProblem({ versus: { founders: ['Gunship'], bareCoreDrills: 0 } })).toBeNull();
  });
});

describe('the champion grid', () => {
  it("fights each side's champion of each round against the other's, the same way every time", { timeout: 60_000 }, () => {
    const grid = championGrid(run, { samples: 2, seeds: 1 });
    // A round's champion is its last generation's best, labelled by the round.
    for (const point of [...grid.rows, ...grid.columns]) expect(point.round).toBeDefined();
    expect(grid.rows.every((p) => p.round! % 2 === 0)).toBe(true);
    expect(grid.columns.every((p) => p.round! % 2 === 1)).toBe(true);
    expect(grid.cells).toHaveLength(grid.rows.length);
    for (const row of grid.cells) expect(row).toHaveLength(grid.columns.length);
    expect(grid.matches).toBe(grid.rows.length * grid.columns.length);
    expect(championGrid(run, { samples: 2, seeds: 1 })).toEqual(grid);
  });

  it('comes out the same fought a slice at a time, as the page fights it', { timeout: 60_000 }, () => {
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
    expect(championGrid(single).cells).toEqual([]);
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
