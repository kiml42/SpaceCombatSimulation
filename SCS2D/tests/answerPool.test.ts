import { describe, expect, it } from "vitest";
import { Rng, serialiseFleet, shipFleet } from "../sim/index.js";
import { CORVETTE, GUNSHIP } from "../scenarios/blueprints.js";
import { DEFAULT_SKIRMISH_SETTINGS } from "../scenarios/skirmish.js";
import { jobHandler, searchLoop, searchPool, type JobMessage, type JobPort, type SearchInput } from "../host/answer.js";

/** A Gunship to beat, a Corvette to answer it, and a search small enough to fight a few generations of. */
const INPUT: SearchInput = {
    player: serialiseFleet(shipFleet(GUNSHIP)),
    enemy: serialiseFleet(shipFleet(CORVETTE)),
    won: 7,
    seed: 5,
    settings: { ...DEFAULT_SKIRMISH_SETTINGS, mutants: 3, seeds: 2, duration: 30 },
    budget: { metal: 1e9, fuel: 1e9, build: 1e9 },
    multiplier: 1,
};
const GENERATIONS = 3;

type Report = { generation: number; leading: boolean; best: unknown; found: unknown; wins: number };

/** The generations a search reports, fought here a slice at a time. */
function serial(): Report[] {
    const reports: Report[] = [];
    const step = searchLoop(INPUT, (wire) => reports.push(wire));
    while (reports.filter((r) => !r.leading).length < GENERATIONS && step());
    return reports.filter((r) => !r.leading).slice(0, GENERATIONS);
}

/** The same, dealt out to `workers` stand-in job workers whose results come back in a shuffled order. */
function pooled(workers: number, order: number): Report[] {
    const reports: Report[] = [];
    const pending: { port: JobPort; message: JobMessage }[] = [];
    const handlers = new Map<JobPort, ReturnType<typeof jobHandler>>();
    const ports: JobPort[] = [];
    for (let i = 0; i < workers; i++) {
        const port: JobPort = {
            onmessage: null,
            postMessage(message) {
                if ("setup" in message) handlers.get(port)!(message);
                else pending.push({ port, message });
            },
        };
        handlers.set(port, jobHandler());
        ports.push(port);
    }
    searchPool(INPUT, (wire) => reports.push(wire), ports);
    const rng = new Rng(order);
    while (pending.length > 0 && reports.filter((r) => !r.leading).length < GENERATIONS) {
        const { port, message } = pending.splice(rng.nextInt(pending.length), 1)[0]!;
        port.onmessage!({ data: handlers.get(port)!(message)! });
    }
    return reports.filter((r) => !r.leading).slice(0, GENERATIONS);
}

describe("the enemy's search dealt out to job workers", { timeout: 300_000 }, () => {
    it("comes out the same as fought in one, whatever order the results come back in", () => {
        const one = serial();
        // Several generations, or an answer before them.
        expect(one.length === GENERATIONS || one.at(-1)!.found !== null).toBe(true);
        for (const [workers, order] of [
            [1, 1],
            [3, 2],
            [7, 3],
        ] as const) {
            expect(JSON.stringify(pooled(workers, order))).toBe(JSON.stringify(one));
        }
    });
});
