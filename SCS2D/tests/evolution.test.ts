import { describe, expect, it } from 'vitest';
import { blueprintProblem, parseBlueprint, Rng, type Blueprint } from '../sim/index.js';
import { blank, breed, Generation, fitness } from '../evolution/generation.js';
import { runMatch } from '../evolution/match.js';
import { champion, Run, runEvolution, seedPopulation, DEFAULT_RUN } from '../evolution/run.js';
import { CORVETTE, DINKY } from '../scenarios/blueprints.js';

/**
 * A generation, and a run of them.
 *
 * What is worth testing here is not that a run improves — that is the
 * simulation's business and a noisy sample of it — but that the machinery
 * around the improving is honest: that every design gets the same hearing,
 * that a run is reproducible from its seed, and that what it writes down is
 * enough to watch any match in it again. A run whose record cannot be replayed
 * is a run nobody can check.
 */

function population(count: number): Generation {
  const individuals = [];
  for (let i = 0; i < count; i++) individuals.push(blank(i, CORVETTE, -1, []));
  return new Generation(0, individuals);
}

/** Fight nothing; just say who scored what, so selection can be tested alone. */
function award(generation: Generation, competitors: readonly number[], totals: readonly number[]): void {
  generation.record(competitors, {
    seed: 0,
    elapsed: 1,
    steps: 1,
    ending: 'timeout',
    scores: totals.map((total) => ({
      survival: 0,
      damage: 0,
      race: 0,
      total,
      lifetime: 1,
      taken: 0,
    })),
  });
}

describe('a generation', () => {
  it('gives every design the same number of matches', () => {
    const generation = population(7);
    const rng = new Rng(5);
    for (let match = 0; match < 14; match++) {
      const competitors = generation.pickCompetitors(rng, 3);
      award(generation, competitors, [1, 1, 1]);
    }
    const played = generation.individuals.map((individual) => individual.matches);
    expect(Math.max(...played) - Math.min(...played)).toBeLessThanOrEqual(1);
  });

  it('would rather draw a stranger than a rematch', () => {
    // A design that has only ever met one opponent has been measured against
    // that opponent rather than against its generation, and no number of
    // rematches fixes it.
    const generation = population(6);
    const rng = new Rng(9);
    for (let match = 0; match < 10; match++) {
      const competitors = generation.pickCompetitors(rng, 2);
      award(generation, competitors, [1, 1]);
    }
    const pairs = generation.individuals.map((individual) => individual.met.size);
    // Ten two-ship matches among six is twenty seats: everyone should have met
    // several different opponents rather than the same one repeatedly.
    expect(Math.min(...pairs)).toBeGreaterThan(1);
  });

  it('ranks by the average rather than the total', () => {
    // Otherwise whoever happened to be drawn most often wins, which measures
    // the draw and not the design.
    const generation = population(2);
    award(generation, [0, 1], [10, 4]);
    award(generation, [0, 1], [10, 4]);
    award(generation, [1, 0], [4, 10]);
    expect(fitness(generation.individuals[0]!)).toBeCloseTo(10, 10);
    expect(fitness(generation.individuals[1]!)).toBeCloseTo(4, 10);
  });

  it('breeds from the winners and keeps them', () => {
    const generation = population(6);
    for (let i = 0; i < 6; i++) award(generation, [i], [i]);

    let next = 100;
    const bred = breed(generation, new Rng(3), { population: 6, winners: 2, limits: {} }, () => next++);
    expect(bred.index).toEqual(1);
    expect(bred.individuals.length).toEqual(6);

    // The winners carry over as they were, so a design that won on a lucky
    // draw has to win again rather than being taken on trust.
    const carried = bred.individuals.filter((individual) => individual.id < 100);
    expect(carried.length).toEqual(2);
    for (const individual of carried) expect(individual.matches).toEqual(0);

    // Everyone else is a child of one of them, and is a ship.
    for (const individual of bred.individuals) {
      if (individual.id < 100) continue;
      expect(carried.some((winner) => winner.id === individual.parent)).toBe(true);
      expect(individual.edits.length).toBeGreaterThan(0);
      expect(blueprintProblem(individual.blueprint)).toBeNull();
    }
  });

  it('does not always take the top of the table', () => {
    // A match is a noisy sample, so selection is weighted rather than
    // elitist: the best usually breeds, and the worst is never impossible.
    const generation = population(5);
    for (let i = 0; i < 5; i++) award(generation, [i], [i]);
    const rng = new Rng(11);
    let bestChosen = 0;
    let worstChosen = 0;
    for (let draw = 0; draw < 200; draw++) {
      const winners = generation.winners(rng, 2).map((individual) => individual.id);
      if (winners.includes(4)) bestChosen++;
      if (winners.includes(0)) worstChosen++;
    }
    expect(bestChosen).toBeGreaterThan(worstChosen);
    expect(worstChosen).toBeGreaterThan(0);
  });
});

describe('a run', () => {
  const settings = {
    seed: 3,
    population: 6,
    winners: 2,
    group: 3,
    minMatches: 2,
    generations: 3,
    match: { duration: 30 },
  };

  it('seeds a population from what it was given', () => {
    const rng = new Rng(1);
    const seeded = seedPopulation([CORVETTE, DINKY], rng, { ...DEFAULT_RUN, population: 5 });
    expect(seeded.individuals.length).toEqual(5);
    // The founders go in as they are, so a run always contains what it was
    // asked about rather than only things bred from it.
    expect(seeded.individuals[0]!.blueprint).toBe(CORVETTE);
    expect(seeded.individuals[1]!.blueprint).toBe(DINKY);
    for (const individual of seeded.individuals) {
      expect(blueprintProblem(individual.blueprint)).toBeNull();
    }
  });

  it('runs the same run twice from one seed', () => {
    const one = runEvolution([CORVETTE], settings);
    const two = runEvolution([CORVETTE], settings);
    expect(JSON.stringify(one)).toEqual(JSON.stringify(two));
  });

  it('gives every design its matches before moving on', () => {
    const run = runEvolution([CORVETTE], settings);
    expect(run.generations.length).toEqual(3);
    for (const generation of run.generations) {
      expect(generation.matches.length).toBeGreaterThan(0);
      for (const individual of generation.individuals) {
        expect(individual.matches).toBeGreaterThanOrEqual(settings.minMatches);
      }
    }
  });

  it('writes down enough to fight any match again', () => {
    // The point of recording a seed rather than a transcript. A sample of a
    // run is watched by fighting it a second time, which only works if the
    // record is complete and the simulation is exact — and if either stops
    // being true, this is where it shows.
    const run = runEvolution([CORVETTE], settings);
    for (const generation of run.generations) {
      const byId = new Map(generation.individuals.map((individual) => [individual.id, individual]));
      for (const match of generation.matches) {
        const entrants: Blueprint[] = match.competitors.map((id) =>
          parseBlueprint(byId.get(id)!.blueprint),
        );
        const again = runMatch(entrants, { ...settings.match, seed: match.seed });
        expect(again.ending).toEqual(match.ending);
        expect(again.scores).toEqual(match.scores);
      }
    }
  });

  it('fights the same run in slices as it does in one go', () => {
    // A page steps a run a few thousand steps at a time and a CLI fights it
    // flat out; if those two diverge, what is watched is not what was
    // recorded, and the replay the record promises is worthless.
    const whole = runEvolution([CORVETTE], settings);
    const stepped = new Run([CORVETTE], settings);
    let slices = 0;
    while (stepped.advance(97)) slices++;
    expect(slices).toBeGreaterThan(10);
    expect(JSON.stringify(stepped.record())).toEqual(JSON.stringify(whole));
  });

  it('never goes backwards while it runs', () => {
    const run = new Run([CORVETTE], settings);
    let seen = 0;
    while (run.advance(500)) {
      expect(run.progress).toBeGreaterThanOrEqual(seen);
      expect(run.progress).toBeLessThanOrEqual(1);
      seen = run.progress;
    }
    expect(run.progress).toEqual(1);
    expect(run.done).toBe(true);
  });

  it('names a champion that actually fought', () => {
    const run = runEvolution([CORVETTE], settings);
    const best = champion(run)!;
    expect(best.individual.matches).toBeGreaterThan(0);
    for (const generation of run.generations) {
      for (const individual of generation.individuals) {
        if (individual.matches > 0) {
          expect(individual.fitness).toBeLessThanOrEqual(best.individual.fitness);
        }
      }
    }
  });
});
