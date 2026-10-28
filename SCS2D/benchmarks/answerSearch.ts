/**
 * Replay one round's enemy search from an exported skirmish, headlessly, and
 * say how it went generation by generation: the best enemy's wins, its fleet's
 * mass, and whether it answered. Not part of the game: a tool for measuring a
 * change to the search or to breeding before it is played.
 *
 *   pnpm exec tsx benchmarks/answerSearch.ts <file.skirmish.json> --round 4
 *       [--seeds 1,2,3] [--generations 15] [--workers 4] [--label name]
 *       [--settings '{"breeding":{"opSteal":0.5}}'] [--file-breeding] [--fresh]
 *
 * The search is fought as the page fights it, by `searchPool` with a job worker
 * a core. Breeding uses the code's defaults unless `--file-breeding`, so a
 * change to a default is what is measured; `--settings` is merged over the
 * skirmish's settings after that. Each seed's run is written a line a
 * generation to `benchmarks/results/<label>-r<round>-s<seed>.jsonl`, with its
 * best fleet beside it, and a run already finished is skipped unless `--fresh`.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Worker } from "node:worker_threads";
import { searchPool, type JobPort } from "../host/answer.js";
import { DEFAULT_SKIRMISH_SETTINGS, parseSkirmish } from "../scenarios/skirmish.js";
import { fleetHulls, fleetMass, parseFleet } from "../sim/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
        round: { type: "string" },
        seeds: { type: "string", default: "1,2,3" },
        generations: { type: "string", default: "15" },
        workers: { type: "string", default: String(Math.min(4, Math.max(1, availableParallelism() - 1))) },
        label: { type: "string", default: "run" },
        settings: { type: "string", default: "{}" },
        "file-breeding": { type: "boolean", default: false },
        fresh: { type: "boolean", default: false },
        out: { type: "string", default: join(here, "results") },
    },
});
const path = positionals[0];
if (path === undefined || values.round === undefined) {
    console.error("usage: answerSearch.ts <file.skirmish.json> --round <n> [options]; see the comment at the top");
    process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- an exported file, read as it was written
const file = JSON.parse(readFileSync(path, "utf8")) as any;
const round = Number(values.round);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rows = file.history.rows as any[];
const tried = rows.find((row) => row.kind === "try" && row.round === round);
const searched = rows.find((row) => row.kind === "search" && row.round === round);
if (tried === undefined || searched === undefined) {
    console.error(`round ${round} was not won and searched in ${path}`);
    process.exit(1);
}
const skirmish = parseSkirmish(file.skirmish);
const settings = {
    ...DEFAULT_SKIRMISH_SETTINGS,
    ...skirmish.settings,
    ...(values["file-breeding"] ? {} : { breeding: {} }),
    ...JSON.parse(values.settings),
};
const generations = Number(values.generations);
mkdirSync(values.out, { recursive: true });

for (const seed of values.seeds.split(",").map(Number)) {
    const name = join(values.out, `${values.label}-r${round}-s${seed}`);
    if (!values.fresh && finished(`${name}.jsonl`)) {
        console.log(`${values.label} seed ${seed}: already run`);
        continue;
    }
    writeFileSync(`${name}.jsonl`, "");
    await run(seed, name);
}

/** Whether a run's file ends in an answer or its last generation. */
function finished(at: string): boolean {
    if (!existsSync(at)) return false;
    const last = readFileSync(at, "utf8").trim().split("\n").pop();
    if (last === undefined || last === "") return false;
    const line = JSON.parse(last) as { found?: boolean; generation?: number };
    return line.found === true || line.generation === generations;
}

async function run(seed: number, name: string): Promise<void> {
    const workers = [...Array(Number(values.workers))].map(() => new Worker(join(here, "answerJobWorker.mjs")));
    const ports = workers.map((worker): JobPort => {
        const port: JobPort = { onmessage: null, postMessage: (message) => worker.postMessage(message) };
        worker.on("message", (data) => {
            if (data.crash !== undefined) {
                writeFileSync(`${name}-crash.json`, JSON.stringify(data, null, 1));
                console.error(`seed ${seed}: a job crashed, written to ${name}-crash.json`);
                process.exit(2);
            }
            port.onmessage?.({ data });
        });
        return port;
    });
    const started = performance.now();
    const input = {
        player: file.history.fleets[searched.player],
        enemy: file.history.fleets[tried.enemy],
        won: searched.seed,
        seed,
        settings,
        budget: skirmish.budget,
        multiplier: 1,
    };
    await new Promise<void>((resolve) => {
        searchPool(
            input,
            (wire) => {
                if (wire.leading) return;
                const best = wire.best as { ships: unknown[] };
                const line = {
                    label: values.label,
                    round,
                    seed,
                    generation: wire.generation,
                    secs: Math.round((performance.now() - started) / 1000),
                    wins: wire.wins,
                    tonnes: Math.round(fleetMass(fleetHulls(parseFleet(best))) / 1000),
                    ships: best.ships.length,
                    found: wire.found !== null,
                };
                appendFileSync(`${name}.jsonl`, `${JSON.stringify(line)}\n`);
                console.log(JSON.stringify(line));
                writeFileSync(`${name}-best.json`, JSON.stringify(wire.found ?? wire.best));
                if (wire.found !== null || wire.generation >= generations) resolve();
            },
            ports,
        );
    });
    await Promise.all(workers.map((worker) => worker.terminate()));
}
