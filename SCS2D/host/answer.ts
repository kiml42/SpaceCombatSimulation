import { parseFleet, serialiseFleet, type Budget, type Fleet } from "../sim/index.js";
import { EnemySearch, JobRunner, type AnswerJob, type Drill, type JobResult, type Standing } from "../evolution/answer.js";
import type { SkirmishSettings } from "../scenarios/skirmish.js";

/**
 * The skirmish enemy's search, run off the page: in a worker where there is
 * one, at full speed, and otherwise in slices on the page's own clock. With
 * cores to spare, the worker deals each generation's matches out to job
 * workers, one a core, and the search comes out the same as fought in one.
 */

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
 * a way to stop it. `worker` starts `answerWorker.ts`, however the page
 * bundles it; without one, or if it will not start, the search runs on the
 * page's own clock.
 */
export function startAnswer(
    input: AnswerInput,
    progress: (now: AnswerProgress) => void,
    worker?: () => Worker,
    jobWorker?: () => Worker,
): () => void {
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
        if (worker === undefined) throw new Error("no worker");
        const started = worker();
        started.onmessage = (event: MessageEvent<Wire>) => received(event.data);
        const helpers = jobWorkers(jobWorker);
        const ports = helpers.map(({ port }) => port);
        started.postMessage({ ...message, ports }, ports);
        return () => {
            started.terminate();
            for (const { helper } of helpers) helper.terminate();
        };
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

/** The most job workers a search starts, whatever the machine has. */
const MOST_HELPERS = 16;

/**
 * A job worker a core, bar the one the page and the search's own worker
 * share, each joined to the search by a channel of its own; none on a machine
 * with too few cores to gain, or where one will not start.
 */
function jobWorkers(start: (() => Worker) | undefined): { helper: Worker; port: MessagePort }[] {
    const cores = typeof navigator === "undefined" ? 1 : (navigator.hardwareConcurrency ?? 1);
    const count = Math.min(MOST_HELPERS, cores - 1);
    if (start === undefined || count < 2) return [];
    const helpers: { helper: Worker; port: MessagePort }[] = [];
    try {
        for (let i = 0; i < count; i++) {
            const helper = start();
            const channel = new MessageChannel();
            helper.postMessage({ port: channel.port1 }, [channel.port1]);
            helpers.push({ helper, port: channel.port2 });
        }
    } catch {
        for (const { helper } of helpers) helper.terminate();
        return [];
    }
    return helpers;
}

/** What the page sends the search's worker. */
export interface SearchInput {
    player: unknown;
    enemy: unknown;
    won: number;
    seed: number;
    settings: SkirmishSettings;
    budget: Budget;
    multiplier: number;
}

function searchOf(input: SearchInput): EnemySearch {
    return new EnemySearch(
        parseFleet(input.player),
        parseFleet(input.enemy),
        input.won,
        input.seed,
        input.settings,
        input.budget,
        input.multiplier,
    );
}

/**
 * One slice of the search at a time, as the worker and the fallback both run
 * it: each call does a slice and says whether there is more to do.
 */
export function searchLoop(input: SearchInput, post: (wire: Wire) => void): () => boolean {
    const search = searchOf(input);
    const look = reporter(search, post);
    return () => {
        search.advance(SLICE);
        return look();
    };
}

/** What a job worker is sent: what every job is fought against, once, and then a job at a time. */
export type JobMessage =
    | { readonly setup: { readonly player: unknown; readonly wonSeed: number; readonly settings: SkirmishSettings } }
    | { readonly job: WireJob };
type WireJob =
    | { readonly kind: "match"; readonly enemy: unknown; readonly seed: number }
    | { readonly kind: "drill"; readonly enemy: unknown; readonly drill: Drill }
    | { readonly kind: "check"; readonly enemy: unknown };

/** Something to send a job worker messages and hear its results: a `MessagePort`, or a stand-in. */
export interface JobPort {
    postMessage(message: JobMessage): void;
    onmessage: ((event: { data: { result: JobResult } }) => void) | null;
}

/**
 * The search with its pieces fought by job workers, a piece each at a time,
 * reporting as `searchLoop` does whenever one comes back. Returns a way to
 * stop it; it stops by itself once there is an answer.
 */
export function searchPool(input: SearchInput, post: (wire: Wire) => void, ports: readonly JobPort[]): () => void {
    const search = searchOf(input);
    const look = reporter(search, post);
    const { player, wonSeed, settings } = search.setup;
    const free: JobPort[] = [];
    const out = new Map<JobPort, Parameters<EnemySearch["give"]>[0]>();
    let stopped = false;
    const pump = (): void => {
        if (stopped) return;
        while (free.length > 0) {
            const ticket = search.take();
            if (ticket === null) break;
            const port = free.pop()!;
            out.set(port, ticket);
            port.postMessage({ job: { ...ticket.job, enemy: serialiseFleet(ticket.job.enemy) } as WireJob });
        }
        if (!look()) stopped = true;
    };
    for (const port of ports) {
        port.onmessage = (event) => {
            const ticket = out.get(port);
            out.delete(port);
            free.push(port);
            if (ticket !== undefined) search.give(ticket, event.data.result);
            pump();
        };
        port.postMessage({ setup: { player: serialiseFleet(player), wonSeed, settings } });
        free.push(port);
    }
    pump();
    return () => {
        stopped = true;
    };
}

/** A job worker's side: what to answer each message with, if anything. */
export function jobHandler(): (message: JobMessage) => { result: JobResult } | null {
    let setup: { player: Fleet; wonSeed: number; settings: SkirmishSettings } | null = null;
    return (message) => {
        if ("setup" in message) {
            setup = { ...message.setup, player: parseFleet(message.setup.player) };
            return null;
        }
        if (setup === null) return null;
        const job = { ...message.job, enemy: parseFleet(message.job.enemy) } as AnswerJob;
        return { result: new JobRunner(job, setup.player, setup.settings, setup.wonSeed).finish() };
    };
}

/**
 * Report the search as it goes: after every generation, whenever a new enemy
 * leads one that has run long, and once more when it is found. Each call
 * looks, and says whether there is more to do.
 */
function reporter(search: EnemySearch, post: (wire: Wire) => void): () => boolean {
    let seen = 0;
    let started = performance.now();
    let led: Standing | null = null;
    return () => {
        const now = search.progress;
        const done = now.found !== null;
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
