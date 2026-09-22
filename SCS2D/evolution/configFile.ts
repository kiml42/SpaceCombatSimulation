import { PI } from '../sim/math.js';
import type { ModuleKind } from '../sim/modules.js';
import { DEFAULT_MATCH, type GoalSpec, type MatchConfig, type ScoreWeights } from './match.js';
import { DEFAULT_KINDS, type KindWeights } from './mutate.js';
import { DEFAULT_RUN, type RunConfig } from './run.js';

/**
 * The run-config file: what a set of evolution settings looks like written
 * down, and how to get one back out of a file that arrived from somewhere
 * untrustworthy.
 *
 * It exists because settings are the experiment. A run is decided entirely by
 * its seed and its configuration, so those few numbers *are* the record of
 * what was tried — worth keeping beside a result, worth sending to somebody
 * with "try this", and worth getting back exactly rather than from memory and
 * a screenshot of a form.
 *
 * Parsing is pure, in the same shape as `sim/blueprintFile.ts` and for the
 * same reason: a value in, a value or a complaint out. Reading the file is the
 * host's business.
 *
 * Two things differ deliberately between the file and the run:
 *
 * - **Angles are degrees in the file**, as they are in a blueprint file, so
 *   what a person reads is `scatter: 180` rather than `3.141592653589793`.
 * - **No mass budget is `null`**, since JSON has no infinity and a file that
 *   said `massBudget: null` was going to be written by somebody sooner or
 *   later anyway.
 *
 * Every field is optional: what a file leaves out is whatever the defaults
 * say, so "the defaults but with beam turrets shut out" is three lines rather
 * than thirty.
 */

export const RUN_CONFIG_FORMAT_VERSION = 1;

/** A run's settings, and the ships it starts from, by name. */
export interface RunSetup {
  readonly founders: readonly string[];
  readonly config: RunConfig;
}

const FILE_KEYS: readonly string[] = [
  'formatVersion',
  'founders',
  'seed',
  'generations',
  'population',
  'winners',
  'group',
  'minMatches',
  'massBudget',
  'kinds',
  'match',
];

const MATCH_KEYS: readonly string[] = ['duration', 'radius', 'scatter', 'goal', 'weights'];
const GOAL_KEYS: readonly string[] = ['x', 'y', 'scale', 'size'];
const WEIGHT_KEYS: readonly (keyof ScoreWeights)[] = ['survival', 'damage', 'race'];
const KINDS: readonly ModuleKind[] = ['structure', 'core', 'thruster', 'turret', 'beamTurret'];

/** The settings a run is given, as the object a file holds. */
export function serialiseRunConfig(setup: RunSetup): Record<string, unknown> {
  const config = setup.config;
  const match: MatchConfig = { ...DEFAULT_MATCH, ...config.match };
  const kinds: KindWeights = { ...DEFAULT_KINDS, ...config.mutation.kinds };
  return {
    formatVersion: RUN_CONFIG_FORMAT_VERSION,
    founders: [...setup.founders],
    seed: config.seed,
    generations: config.generations,
    population: config.population,
    winners: config.winners,
    group: config.group,
    minMatches: config.minMatches,
    massBudget: Number.isFinite(config.massBudget) ? config.massBudget : null,
    kinds: { ...kinds },
    match: {
      duration: match.duration,
      radius: match.radius,
      scatter: (match.scatter * 180) / PI,
      goal: match.goal === null ? null : { ...match.goal },
      weights: { ...match.weights },
    },
  };
}

/** Whatever is wrong with a run-config file, or null if it is one. */
export function runConfigFileProblem(value: unknown): string | null {
  if (!isRecord(value)) return 'a run config must be an object';
  const extra = unknownKeys(value, FILE_KEYS);
  if (extra.length > 0) {
    return `unknown ${extra.length > 1 ? 'keys' : 'key'} ${extra.join(', ')}`;
  }

  const version = value['formatVersion'];
  if (version !== undefined && version !== RUN_CONFIG_FORMAT_VERSION) {
    return `formatVersion must be ${RUN_CONFIG_FORMAT_VERSION}, got ${JSON.stringify(version)}`;
  }

  const founders = value['founders'];
  if (founders !== undefined) {
    if (!Array.isArray(founders) || founders.some((name) => typeof name !== 'string')) {
      return 'founders must be a list of ship names';
    }
  }

  return (
    countProblem(value['generations'], 'generations') ??
    countProblem(value['population'], 'population') ??
    countProblem(value['winners'], 'winners') ??
    countProblem(value['group'], 'group') ??
    countProblem(value['minMatches'], 'minMatches') ??
    numberProblem(value['seed'], 'seed') ??
    budgetProblem(value['massBudget']) ??
    kindsProblem(value['kinds']) ??
    matchProblem(value['match'])
  );
}

/**
 * A file's settings, with everything it leaves out taken from the defaults.
 *
 * Throws on a file that is not one, so that a caller which has not checked
 * cannot quietly run something it invented — the check is
 * `runConfigFileProblem`, and it says what is wrong in a sentence.
 */
export function parseRunConfig(value: unknown): RunSetup {
  const problem = runConfigFileProblem(value);
  if (problem !== null) throw new Error(`Invalid run config — ${problem}`);
  const file = value as Record<string, unknown>;
  const match = isRecord(file['match']) ? file['match'] : {};
  const budget = file['massBudget'];

  return {
    founders: (file['founders'] as string[] | undefined) ?? [],
    config: {
      seed: read(file['seed'], DEFAULT_RUN.seed),
      generations: read(file['generations'], DEFAULT_RUN.generations),
      population: read(file['population'], DEFAULT_RUN.population),
      winners: read(file['winners'], DEFAULT_RUN.winners),
      group: read(file['group'], DEFAULT_RUN.group),
      minMatches: read(file['minMatches'], DEFAULT_RUN.minMatches),
      massBudget: budget === undefined || budget === null ? Infinity : (budget as number),
      mutation: { kinds: { ...DEFAULT_KINDS, ...(file['kinds'] as Partial<KindWeights>) } },
      match: {
        duration: read(match['duration'], DEFAULT_MATCH.duration),
        radius: read(match['radius'], DEFAULT_MATCH.radius),
        scatter: (read(match['scatter'], (DEFAULT_MATCH.scatter * 180) / PI) / 180) * PI,
        goal:
          match['goal'] === undefined
            ? DEFAULT_MATCH.goal
            : match['goal'] === null
              ? null
              : ({ ...(match['goal'] as GoalSpec) } as GoalSpec),
        weights: { ...DEFAULT_MATCH.weights, ...(match['weights'] as Partial<ScoreWeights>) },
      },
    },
  };
}

function read(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unknownKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(value).filter((key) => !allowed.includes(key));
}

function numberProblem(value: unknown, what: string): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return `${what} must be a finite number, got ${JSON.stringify(value)}`;
  }
  return null;
}

/** A whole number of things, of which there has to be at least one. */
function countProblem(value: unknown, what: string): string | null {
  const problem = numberProblem(value, what);
  if (problem !== null) return problem;
  if (value !== undefined && (!Number.isInteger(value) || (value as number) < 1)) {
    return `${what} must be a whole number of at least one, got ${JSON.stringify(value)}`;
  }
  return null;
}

function budgetProblem(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const problem = numberProblem(value, 'massBudget');
  if (problem !== null) return problem;
  if ((value as number) <= 0) return `massBudget must be more than nothing, got ${JSON.stringify(value)}`;
  return null;
}

function kindsProblem(value: unknown): string | null {
  if (value === undefined) return null;
  if (!isRecord(value)) return 'kinds must be an object of weights, one per module kind';
  const extra = unknownKeys(value, KINDS);
  if (extra.length > 0) {
    return `kinds has unknown ${extra.length > 1 ? 'kinds' : 'kind'} ${extra.join(', ')} — try ${KINDS.join(', ')}`;
  }
  for (const kind of KINDS) {
    const problem = numberProblem(value[kind], `kinds.${kind}`);
    if (problem !== null) return problem;
    if (value[kind] !== undefined && (value[kind] as number) < 0) {
      return `kinds.${kind} must be zero or more, got ${JSON.stringify(value[kind])}`;
    }
  }
  return null;
}

function matchProblem(value: unknown): string | null {
  if (value === undefined) return null;
  if (!isRecord(value)) return 'match must be an object';
  const extra = unknownKeys(value, MATCH_KEYS);
  if (extra.length > 0) {
    return `match has unknown ${extra.length > 1 ? 'keys' : 'key'} ${extra.join(', ')}`;
  }
  const problem =
    numberProblem(value['duration'], 'match.duration') ??
    numberProblem(value['radius'], 'match.radius') ??
    numberProblem(value['scatter'], 'match.scatter');
  if (problem !== null) return problem;
  if (value['duration'] !== undefined && (value['duration'] as number) <= 0) {
    return 'match.duration must be more than nothing';
  }
  if (value['radius'] !== undefined && (value['radius'] as number) <= 0) {
    return 'match.radius must be more than nothing';
  }
  return goalProblem(value['goal']) ?? weightsProblem(value['weights']);
}

function goalProblem(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) return 'match.goal must be an object, or null for a match that is only a fight';
  const extra = unknownKeys(value, GOAL_KEYS);
  if (extra.length > 0) {
    return `match.goal has unknown ${extra.length > 1 ? 'keys' : 'key'} ${extra.join(', ')}`;
  }
  for (const key of GOAL_KEYS) {
    if (value[key] === undefined) return `match.goal is missing ${key}`;
    const problem = numberProblem(value[key], `match.goal.${key}`);
    if (problem !== null) return problem;
  }
  if ((value['scale'] as number) <= 0) return 'match.goal.scale must be more than nothing';
  if ((value['size'] as number) <= 0) return 'match.goal.size must be more than nothing';
  return null;
}

function weightsProblem(value: unknown): string | null {
  if (value === undefined) return null;
  if (!isRecord(value)) return 'match.weights must be an object';
  const extra = unknownKeys(value, WEIGHT_KEYS);
  if (extra.length > 0) {
    return `match.weights has unknown ${extra.length > 1 ? 'keys' : 'key'} ${extra.join(', ')}`;
  }
  for (const key of WEIGHT_KEYS) {
    const problem = numberProblem(value[key], `match.weights.${key}`);
    if (problem !== null) return problem;
  }
  return null;
}
