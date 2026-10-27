import { parseBlueprint, parseFleet, serialiseBlueprint, serialiseFleet } from "../sim/index.js";
import { Coevolution, DEFAULT_COEVOLUTION, type CoevolutionConfig } from "../evolution/coevolution.js";
import type { Individual } from "../evolution/generation.js";
import { isFleet, type Entrant } from "../evolution/match.js";
import { DEFAULT_RUN, Run, type GenerationRecord, type MatchRecord, type RunConfig, type RunRecord } from "../evolution/run.js";

/**
 * An evolution run, fought off the page: in a worker where there is one, so it
 * goes on at full speed while the tab is hidden, and otherwise in slices on
 * the page's own timers. The page holds a `LiveRun`, a copy built from what the
 * run sends, and fights any match it wants to show again from the record:
 * a match is decided by its seed, so the copy is the match that was fought.
 */

/** A design as it crosses to and from the worker: as a file holds it. */
export type Design = { readonly blueprint: Record<string, unknown> } | { readonly fleet: Record<string, unknown> };

export function designOf(entrant: Entrant): Design {
    return isFleet(entrant) ? { fleet: serialiseFleet(entrant) } : { blueprint: serialiseBlueprint(entrant) };
}

export function entrantOfDesign(design: Design): Entrant {
    return "fleet" in design ? parseFleet(design.fleet) : parseBlueprint(design.blueprint);
}

/** What starts a run: its founders, side B's for a co-evolution run, and its settings. */
export interface RunStart {
    readonly founders: readonly Design[];
    readonly rivals: readonly Design[];
    readonly config: Partial<RunConfig>;
    /** Null for a run of one side. */
    readonly coevolution: Partial<CoevolutionConfig> | null;
}

/** An individual of the generation being fought, with what it has scored so far. */
export type LiveIndividual = Pick<
    Individual,
    "id" | "parent" | "edits" | "matches" | "score" | "survival" | "functional" | "damage" | "disabling" | "race" | "entrant"
>;
type WireIndividual = Omit<LiveIndividual, "entrant"> & { readonly design: Design };
type WireChampion = { readonly id: number; readonly design: Design };

/** What the run sends: the generations closed since it last did, and everything live as it stands. */
export interface RunWire {
    readonly generations: readonly GenerationRecord[];
    readonly rivalGenerations: readonly GenerationRecord[];
    readonly living: readonly WireIndividual[];
    readonly played: readonly MatchRecord[];
    readonly turn: 0 | 1;
    readonly round: number;
    readonly progress: number;
    readonly done: boolean;
    /** Each side's hall, in a co-evolution run. */
    readonly halls: readonly [readonly WireChampion[], readonly WireChampion[]] | null;
}

/** How long a slice of the run is, ms, between looks for a message. */
const SLICE_MS = 50;
/** The least time between two sends of the same generation, ms: the page samples five times a second. */
const SEND_MS = 100;

/**
 * The run, a slice at a time, as the worker and the fallback both fight it:
 * each call fights a slice and says whether there is more to fight. It sends
 * once to begin with, whenever a generation closes or the run ends, and
 * otherwise at most every `SEND_MS` while matches are being played.
 */
export function runLoop(start: RunStart, send: (wire: RunWire) => void): () => boolean {
    const founders = start.founders.map(entrantOfDesign);
    const run =
        start.coevolution === null
            ? new Run(founders, start.config)
            : new Coevolution(founders, start.rivals.map(entrantOfDesign), start.config, start.coevolution);
    const rivalGenerations = (): readonly GenerationRecord[] => (run instanceof Coevolution ? run.rivalGenerations : []);
    // An individual's design never changes and its id never repeats, so each is written once.
    const designs = new Map<number, Design>();
    const design = (id: number, entrant: Entrant): Design => {
        let held = designs.get(id);
        if (held === undefined) {
            held = designOf(entrant);
            designs.set(id, held);
        }
        return held;
    };
    let sentA = 0;
    let sentB = 0;
    let sentPlayed = -1;
    let sentAt = -Infinity;
    const post = (): void => {
        const a = run.generations;
        const b = rivalGenerations();
        send({
            generations: a.slice(sentA),
            rivalGenerations: b.slice(sentB),
            living: run.living.individuals.map(({ entrant, met: _met, ...rest }) => ({ ...rest, design: design(rest.id, entrant) })),
            played: [...run.played],
            turn: run instanceof Coevolution ? run.turn : 0,
            round: run instanceof Coevolution ? run.round : 0,
            progress: run.progress,
            done: run.done,
            halls:
                run instanceof Coevolution
                    ? [
                          run.hall(0).map(({ id, entrant }) => ({ id, design: design(id, entrant) })),
                          run.hall(1).map(({ id, entrant }) => ({ id, design: design(id, entrant) })),
                      ]
                    : null,
        });
        sentA = a.length;
        sentB = b.length;
        sentPlayed = run.played.length;
        sentAt = performance.now();
    };
    post();
    return () => {
        const until = performance.now() + SLICE_MS;
        // In small steps, so one long match cannot hold the slice.
        while (performance.now() < until && run.advance(240)) {
            // Fighting.
        }
        const closed = run.generations.length !== sentA || rivalGenerations().length !== sentB;
        const moved = run.played.length !== sentPlayed;
        if (closed || run.done || (moved && performance.now() - sentAt >= SEND_MS)) post();
        return !run.done;
    };
}

/** What the page can do to a run once started. */
export interface RunControl {
    setPaused(paused: boolean): void;
    stop(): void;
}

/** A message the page sends the worker. */
export type RunMessage = { readonly start: RunStart } | { readonly paused: boolean };

/**
 * Fight a run, telling `received` what it sends. `worker` starts
 * `evolutionWorker.ts`, however the page bundles it; without one, or if it will
 * not start, the run is fought on the page's own timers, and stops with them.
 */
export function startRun(start: RunStart, received: (wire: RunWire) => void, worker?: () => Worker): RunControl {
    try {
        if (worker === undefined) throw new Error("no worker");
        const started = worker();
        started.onmessage = (event: MessageEvent<RunWire>) => received(event.data);
        const message: RunMessage = { start };
        started.postMessage(message);
        return {
            setPaused: (paused) => started.postMessage({ paused } satisfies RunMessage),
            stop: () => started.terminate(),
        };
    } catch {
        return sliced(runLoop(start, received), (tick) => window.setTimeout(tick, 0));
    }
}

/** A loop fought a slice per `later`, which can be paused and stopped: the worker's and the fallback's. */
export function sliced(step: () => boolean, later: (tick: () => void) => void): RunControl {
    let paused = false;
    let stopped = false;
    let waiting = false;
    const tick = (): void => {
        waiting = false;
        if (stopped || paused) return;
        if (step()) schedule();
    };
    const schedule = (): void => {
        if (waiting) return;
        waiting = true;
        later(tick);
    };
    schedule();
    return {
        setPaused: (next) => {
            paused = next;
            if (!paused && !stopped) schedule();
        },
        stop: () => {
            stopped = true;
        },
    };
}

type Champion = { readonly id: number; readonly entrant: Entrant };

/**
 * A run being fought elsewhere, as the page reads it: the same surface as a
 * `RecordedRun`, built up from what the run sends. Its generation lists are
 * the ones `record()` hands out, so a measurement started part way through
 * carries on into the generations closed after it.
 */
export class LiveRun {
    readonly config: RunConfig;
    /** Side B's settings in a co-evolution run, or null for a run of one. */
    readonly coevolution: CoevolutionConfig | null;
    readonly generations: GenerationRecord[] = [];
    readonly rivalGenerations: GenerationRecord[] = [];
    living: readonly LiveIndividual[] = [];
    played: readonly MatchRecord[] = [];
    turn: 0 | 1 = 0;
    round = 0;
    progress = 0;
    done = false;
    private halls: readonly [readonly Champion[], readonly Champion[]] = [[], []];
    // Parsed once each, as the run wrote them once each.
    private readonly entrants = new Map<number, Entrant>();

    constructor(config: Partial<RunConfig>, coevolution: Partial<CoevolutionConfig> | null) {
        this.config = { ...DEFAULT_RUN, ...config };
        this.coevolution = coevolution === null ? null : { ...DEFAULT_COEVOLUTION, ...coevolution };
    }

    get alternates(): boolean {
        return this.coevolution?.rivalEvolves ?? false;
    }

    hall(side: 0 | 1): readonly Champion[] {
        return this.halls[side];
    }

    /** Take in what the run sent. */
    apply(wire: RunWire): void {
        this.generations.push(...wire.generations);
        this.rivalGenerations.push(...wire.rivalGenerations);
        this.living = wire.living.map(({ design, ...rest }) => ({ ...rest, entrant: this.entrant(rest.id, design) }));
        this.played = wire.played;
        this.turn = wire.turn;
        this.round = wire.round;
        this.progress = wire.progress;
        this.done = wire.done;
        if (wire.halls !== null) {
            const [a, b] = wire.halls;
            const of = (side: readonly WireChampion[]): Champion[] =>
                side.map(({ id, design }) => ({ id, entrant: this.entrant(id, design) }));
            this.halls = [of(a), of(b)];
        }
    }

    record(): RunRecord {
        return {
            config: this.config,
            generations: this.generations,
            ...(this.coevolution === null ? {} : { rival: { config: this.coevolution, generations: this.rivalGenerations } }),
        };
    }

    private entrant(id: number, design: Design): Entrant {
        let held = this.entrants.get(id);
        if (held === undefined) {
            held = entrantOfDesign(design);
            this.entrants.set(id, held);
        }
        return held;
    }
}
