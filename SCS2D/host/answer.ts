import { parseFleet, serialiseFleet, type Budget, type Fleet } from "../sim/index.js";
import { EnemySearch, type Standing } from "../evolution/answer.js";
import type { SkirmishSettings } from "../scenarios/skirmish.js";

/**
 * The skirmish enemy's search, run off the page: in a worker where there is
 * one, at full speed, and otherwise in slices on the page's own clock.
 */

/** The worker's bundle, put in at build time by `scripts/build.ts`. */
declare const __ANSWER_WORKER__: string;

export interface AnswerInput {
    player: Fleet;
    enemy: Fleet;
    /** The next round's seed, which the answer must win on. */
    won: number;
    seed: number;
    /** What the skirmish is played under. */
    settings: SkirmishSettings;
    /** The player's budget, and the multiple of it the enemy's starts at. */
    budget: Budget;
    multiplier: number;
}

export interface AnswerProgress {
    generation: number;
    /**
     * Whether `best` is only leading the generation still being fought, rather
     * than the best of one finished: shown, but not kept.
     */
    leading: boolean;
    wins: number;
    /** Whether the best won on the next round's seed. */
    onRound: boolean;
    /** The enemy's budget as a multiple of the player's. */
    multiplier: number;
    seeds: number;
    best: Fleet;
    found: Fleet | null;
}

/** What crosses to and from the worker: fleets as files. */
interface Wire {
    generation: number;
    leading: boolean;
    wins: number;
    onRound: boolean;
    multiplier: number;
    seeds: number;
    best: unknown;
    found: unknown;
}

/** Battle steps of work between looks. */
const SLICE = 2000;
/** How long a generation runs, ms, before the enemy leading it is shown. */
const LEAD_AFTER = 5000;

/**
 * Run a search, telling `progress` after every generation, whenever a new
 * enemy leads one that has run long, and once more when it is found. Returns
 * a way to stop it.
 */
export function startAnswer(input: AnswerInput, progress: (now: AnswerProgress) => void): () => void {
    const received = (wire: Wire): void =>
        progress({
            generation: wire.generation,
            leading: wire.leading,
            wins: wire.wins,
            onRound: wire.onRound,
            multiplier: wire.multiplier,
            seeds: wire.seeds,
            best: parseFleet(wire.best),
            found: wire.found === null ? null : parseFleet(wire.found),
        });
    const message = {
        player: serialiseFleet(input.player),
        enemy: serialiseFleet(input.enemy),
        won: input.won,
        seed: input.seed,
        settings: input.settings,
        budget: input.budget,
        multiplier: input.multiplier,
    };
    try {
        const url = URL.createObjectURL(new Blob([__ANSWER_WORKER__], { type: "text/javascript" }));
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
    input: {
        player: unknown;
        enemy: unknown;
        won: number;
        seed: number;
        settings: SkirmishSettings;
        budget: Budget;
        multiplier: number;
    },
    post: (wire: Wire) => void,
): () => boolean {
    const search = new EnemySearch(
        parseFleet(input.player),
        parseFleet(input.enemy),
        input.won,
        input.seed,
        input.settings,
        input.budget,
        input.multiplier,
    );
    let seen = 0;
    let started = performance.now();
    let led: Standing | null = null;
    return () => {
        const done = search.advance(SLICE);
        const now = search.progress;
        if (now.generation !== seen || done) {
            seen = now.generation;
            started = performance.now();
            led = null;
            post({
                generation: now.generation,
                leading: false,
                wins: now.best.wins,
                onRound: now.best.onRound,
                multiplier: now.multiplier,
                seeds: now.seeds,
                best: serialiseFleet(now.best.enemy),
                found: now.found === null ? null : serialiseFleet(now.found),
            });
        } else if (performance.now() - started >= LEAD_AFTER) {
            const leader = search.leader;
            if (leader !== null && leader !== led) {
                led = leader;
                post({
                    generation: now.generation + 1,
                    leading: true,
                    wins: leader.wins,
                    onRound: leader.onRound,
                    multiplier: now.multiplier,
                    seeds: now.seeds,
                    best: serialiseFleet(leader.enemy),
                    found: null,
                });
            }
        }
        return !done;
    };
}
