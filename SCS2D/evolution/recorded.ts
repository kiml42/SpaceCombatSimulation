import { DEFAULT_COEVOLUTION, type CoevolutionConfig } from './coevolution.js';
import type { Entrant } from './match.js';
import { DEFAULT_RUN, entrantOf, type GenerationRecord, type MatchRecord, type RunRecord } from './run.js';

/**
 * A run read back from the file `npm run evolve` writes, shown as a finished
 * run: the same surface a page reads from a `Run` or a `Coevolution`, with
 * nothing left to fight.
 */
export class RecordedRun {
  readonly config: RunRecord['config'];
  /** Side B's settings in a co-evolution run, or null for a run of one. */
  readonly coevolution: CoevolutionConfig | null;
  readonly generations: readonly GenerationRecord[];
  readonly rivalGenerations: readonly GenerationRecord[];
  readonly done = true;
  readonly played: readonly MatchRecord[] = [];
  private readonly halls: readonly [Hall, Hall];

  constructor(record: RunRecord) {
    this.config = { ...DEFAULT_RUN, ...record.config };
    this.coevolution = record.rival === undefined ? null : { ...DEFAULT_COEVOLUTION, ...record.rival.config };
    this.generations = record.generations;
    this.rivalGenerations = record.rival?.generations ?? [];
    const hall = Math.max(1, this.coevolution?.hall ?? 1);
    this.halls = [foundersOf(this.generations, hall), foundersOf(this.rivalGenerations, hall)];
  }

  /** How much of what it was set to fight it fought: less than all of it if it was stopped. */
  get progress(): number {
    const fought = this.generations.length + this.rivalGenerations.length;
    return this.config.generations > 0 ? Math.min(1, fought / this.config.generations) : 1;
  }

  get alternates(): boolean {
    return this.coevolution?.rivalEvolves ?? false;
  }

  /** The side bred last. */
  get turn(): 0 | 1 {
    return (this.rivalGenerations.at(-1)?.round ?? -1) > (this.generations.at(-1)?.round ?? -1) ? 1 : 0;
  }

  /** The round bred last. */
  get round(): number {
    return Math.max(this.generations.at(-1)?.round ?? 0, this.rivalGenerations.at(-1)?.round ?? 0);
  }

  /**
   * A side's founders, as a live run's hall starts out: all a page needs a
   * hall for once a run is over is a side that was never bred. A side B that
   * did not evolve is not in the record at all, so its hall is empty.
   */
  hall(side: 0 | 1): Hall {
    return this.halls[side];
  }

  advance(): boolean {
    return false;
  }

  record(): RunRecord {
    return {
      config: this.config,
      generations: this.generations,
      ...(this.coevolution === null ? {} : { rival: { config: this.coevolution, generations: this.rivalGenerations } }),
    };
  }
}

type Hall = readonly { id: number; entrant: Entrant }[];

/** The unbred designs a side's first generation was seeded with: its founders. */
function foundersOf(generations: readonly GenerationRecord[], most: number): Hall {
  return (generations[0]?.individuals ?? [])
    .filter((individual) => individual.parent < 0)
    .slice(0, most)
    .map((individual) => ({ id: individual.id, entrant: entrantOf(individual) }));
}

/**
 * A run file, checked as far as a page needs to trust it: a settings file or
 * a design file opened by mistake is said to be one, rather than shown as an
 * empty run.
 */
export function parseRunRecord(value: unknown): RunRecord {
  const record = value as Partial<RunRecord> | null;
  if (record === null || typeof record !== 'object' || !Array.isArray(record.generations) || typeof record.config !== 'object') {
    throw new Error('not a run file: it has no generations. A run file is what `npm run evolve` writes, as x.run.json');
  }
  const sides = [record.generations, ...(record.rival === undefined ? [] : [record.rival.generations])];
  for (const generations of sides) {
    if (!Array.isArray(generations)) throw new Error("not a run file: side B's generations are not a list");
    for (const generation of generations as GenerationRecord[]) {
      if (!Array.isArray(generation.individuals) || !Array.isArray(generation.matches)) {
        throw new Error(`generation ${generation.index} has no individuals or matches`);
      }
      for (const individual of generation.individuals) {
        if (individual.blueprint === undefined && individual.fleet === undefined) {
          throw new Error(`individual ${individual.id} records no design, so the run cannot be shown or fought again`);
        }
      }
    }
  }
  return record as RunRecord;
}

/**
 * How many matches each design won, of those it fought that counted: a drill
 * against a bare core or with shields up is practice, and is left out.
 */
export function winsIn(matches: readonly MatchRecord[]): Map<number, { won: number; fought: number }> {
  const tally = new Map<number, { won: number; fought: number }>();
  for (const match of matches) {
    if (match.drill !== undefined) continue;
    // With sides, a design whose side won won, whether or not its own ships lasted.
    const teams = match.teams;
    const won = new Set((match.ending === 'decided' ? (match.winners ?? []) : []).map((at) => teams?.[at] ?? at));
    const counted = new Set<number>();
    match.competitors.forEach((id, at) => {
      if (id < 0 || counted.has(id)) return;
      counted.add(id);
      const each = tally.get(id) ?? { won: 0, fought: 0 };
      each.fought++;
      if (won.has(teams?.[at] ?? at)) each.won++;
      tally.set(id, each);
    });
  }
  return tally;
}
