/**
 * Runs the golden scenarios and writes their checksums into tests/golden.test.ts.
 *
 *   pnpm golden               every scenario
 *   pnpm golden split duel    only those
 *
 * Above each checksum it records how that battle came out and its time per step,
 * as the baseline the next run is reported against. Those are rewritten only with
 * a checksum that moved, or where there are none yet, so a run that changes
 * nothing changes nothing: timings differ from run to run and machine to machine.
 *
 * Run it after a deliberate change to the simulation, and read what it reports
 * before committing: never take a new checksum without understanding what moved.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { formatChecksum } from "../sim/checksum.js";
import { SCENARIOS, type ScenarioName } from "../tests/fixtures/scenarios.js";

const FILE = fileURLToPath(new URL("../tests/golden.test.ts", import.meta.url));
const OPEN = "const GOLDEN: Record<ScenarioName, string> = {\n";
const CLOSE = "\n};";

interface Entry {
    checksum: string;
    /** How the battle came out, as `Battle.describe` says it. */
    outcome?: string | undefined;
    /** Microseconds a step. */
    perStep?: number | undefined;
}

/** What tests/golden.test.ts records now, by scenario. */
function recorded(source: string): Map<string, Entry> {
    const start = source.indexOf(OPEN);
    const end = source.indexOf(CLOSE, start);
    if (start < 0 || end < 0) throw new Error(`no GOLDEN block in ${FILE}`);
    const entries = new Map<string, Entry>();
    let outcome: string | undefined;
    let perStep: number | undefined;
    for (const line of source.slice(start + OPEN.length, end).split("\n")) {
        const comment = /^\s*\/\/ (.*?) · ([\d.]+) µs\/step$/.exec(line);
        if (comment !== null) {
            outcome = comment[1];
            perStep = Number(comment[2]);
            continue;
        }
        const entry = /^\s*(\w+): "([0-9a-f]+)",$/.exec(line);
        if (entry === null) continue;
        entries.set(entry[1]!, { checksum: entry[2]!, outcome, perStep });
        outcome = undefined;
        perStep = undefined;
    }
    return entries;
}

function written(source: string, entries: Map<string, Entry>): string {
    const lines: string[] = [];
    for (const name of Object.keys(SCENARIOS)) {
        const entry = entries.get(name);
        if (entry === undefined) continue;
        if (entry.outcome !== undefined && entry.perStep !== undefined) {
            lines.push(`    // ${entry.outcome} · ${entry.perStep.toFixed(1)} µs/step`);
        }
        lines.push(`    ${name}: "${entry.checksum}",`);
    }
    const start = source.indexOf(OPEN) + OPEN.length;
    return source.slice(0, start) + lines.join("\n") + source.slice(source.indexOf(CLOSE, start));
}

const asked = process.argv.slice(2);
for (const name of asked) {
    if (!(name in SCENARIOS)) throw new Error(`no scenario "${name}"; there are ${Object.keys(SCENARIOS).join(", ")}`);
}
const names = (asked.length > 0 ? asked : Object.keys(SCENARIOS)) as ScenarioName[];

const source = readFileSync(FILE, "utf8");
const entries = recorded(source);
let moved = 0;
for (const name of names) {
    const scenario = SCENARIOS[name];
    const run = scenario.build();
    const started = process.hrtime.bigint();
    for (let i = 0; i < scenario.steps; i++) run.step();
    const perStep = Number(process.hrtime.bigint() - started) / 1e3 / scenario.steps;
    const checksum = formatChecksum(run.checksum());
    const outcome = run.describe();

    const was = entries.get(name);
    const same = was?.checksum === checksum;
    if (!same) moved++;
    const baseline = was?.perStep;
    const timing =
        baseline === undefined
            ? `${perStep.toFixed(1)} µs/step`
            : `${perStep.toFixed(1)} µs/step (baseline ${baseline.toFixed(1)}, ${perStep >= baseline ? "+" : ""}${(((perStep - baseline) / baseline) * 100).toFixed(0)}%)`;
    console.log(`${name.padEnd(16)} ${checksum} ${same ? "unchanged" : `was ${was?.checksum ?? "none"}`}  ${timing}`);
    console.log(`${"".padEnd(16)} ${outcome}`);
    if (!same && was?.outcome !== undefined && was.outcome !== outcome) console.log(`${"".padEnd(16)} was ${was.outcome}`);

    // A moved checksum takes the outcome and timing it moved with; an unmoved one keeps its baseline.
    if (!same || was?.outcome === undefined) entries.set(name, { checksum, outcome, perStep });
}

writeFileSync(FILE, written(source, entries));
console.log(`\n${moved} of ${names.length} moved; ${FILE} updated.`);
