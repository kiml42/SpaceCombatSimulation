import { parseFleet, serialiseFleet, type Fleet } from '../sim/index.js';
import { EnemySearch } from '../evolution/answer.js';

/**
 * The skirmish enemy's search, run off the page: in a worker where there is
 * one, at full speed, and otherwise in slices on the page's own clock.
 */

/** The worker's bundle, put in at build time by `scripts/build.ts`. */
declare const __ANSWER_WORKER__: string;

export interface AnswerInput {
  player: Fleet;
  enemy: Fleet;
  /** The seed the player won the round on. */
  won: number;
  seed: number;
}

export interface AnswerProgress {
  generation: number;
  wins: number;
  /** Whether the best won on the seed the round was won on, under the search's rules. */
  onRound: boolean;
  /** How many times the enemy has been let grow by half as much again. */
  stretch: number;
  seeds: number;
  best: Fleet;
  found: Fleet | null;
}

/** What crosses to and from the worker: fleets as files. */
interface Wire {
  generation: number;
  wins: number;
  onRound: boolean;
  stretch: number;
  seeds: number;
  best: unknown;
  found: unknown;
}

/** Battle steps of work between looks. */
const SLICE = 2000;

/**
 * Run a search, telling `progress` after every generation and once more when
 * it is found. Returns a way to stop it.
 */
export function startAnswer(input: AnswerInput, progress: (now: AnswerProgress) => void): () => void {
  const received = (wire: Wire): void =>
    progress({
      generation: wire.generation,
      wins: wire.wins,
      onRound: wire.onRound,
      stretch: wire.stretch,
      seeds: wire.seeds,
      best: parseFleet(wire.best),
      found: wire.found === null ? null : parseFleet(wire.found),
    });
  const message = {
    player: serialiseFleet(input.player),
    enemy: serialiseFleet(input.enemy),
    won: input.won,
    seed: input.seed,
  };
  try {
    const url = URL.createObjectURL(new Blob([__ANSWER_WORKER__], { type: 'text/javascript' }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = (event: MessageEvent<Wire>) => received(event.data);
    worker.postMessage(message);
    return () => worker.terminate();
  } catch {
    // No worker to be had: the same search, a slice between frames.
    let stopped = false;
    const run = searchLoop(message, (wire) => received(wire));
    const tick = (): void => {
      if (stopped) return;
      if (run()) window.setTimeout(tick, 0);
    };
    window.setTimeout(tick, 0);
    return () => {
      stopped = true;
    };
  }
}

/**
 * One slice of the search at a time, as the worker and the fallback both run
 * it: each call does a slice and says whether there is more to do.
 */
export function searchLoop(
  input: { player: unknown; enemy: unknown; won: number; seed: number },
  post: (wire: Wire) => void,
): () => boolean {
  const search = new EnemySearch(parseFleet(input.player), parseFleet(input.enemy), input.won, input.seed);
  let seen = 0;
  return () => {
    const done = search.advance(SLICE);
    const now = search.progress;
    if (now.generation !== seen || done) {
      seen = now.generation;
      post({
        generation: now.generation,
        wins: now.best.wins,
        onRound: now.best.onRound,
        stretch: now.stretch,
        seeds: now.seeds,
        best: serialiseFleet(now.best.enemy),
        found: now.found === null ? null : serialiseFleet(now.found),
      });
    }
    return !done;
  };
}
