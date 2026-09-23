import { readFileSync } from 'node:fs';
import { parseBlueprint, type Blueprint } from '../sim/index.js';
import { BLUEPRINTS } from '../scenarios/blueprints.js';
import { latest, measure, trend } from '../evolution/yardstick.js';
import type { RunRecord } from '../evolution/run.js';

/**
 * Measure a finished run against a ship that does not evolve.
 *
 * Takes a run record and an opponent, and prints how each generation did
 * against it. Nothing about the run is re-run: the record holds every design
 * it ever bred, so a measurement is a fresh set of matches against designs
 * that already exist, and the same run can be measured again against a
 * different opponent whenever the question changes.
 */

function parse(argv: readonly string[]): { run: string; against: string } {
  let run = 'runs/run.json';
  let against = 'latest';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = argv[++i];
    if (next === undefined) throw new Error(`${arg} wants a value`);
    if (arg === '--run') run = next;
    else if (arg === '--against') against = next;
    else throw new Error(`unknown argument ${arg}`);
  }
  return { run, against };
}

const options = parse(process.argv.slice(2));
const record = JSON.parse(readFileSync(options.run, 'utf8')) as RunRecord;

let benchmark: Blueprint | null;
if (options.against === 'latest') {
  benchmark = latest(record);
} else if (options.against === 'founder') {
  // Whatever the run started from, which is the first individual of the first
  // generation — the population is seeded with the founders before anything
  // is bred from them.
  const first = record.generations[0]?.individuals[0];
  benchmark = first === undefined ? null : parseBlueprint(first.blueprint);
} else if (options.against in BLUEPRINTS) {
  benchmark = BLUEPRINTS[options.against as keyof typeof BLUEPRINTS];
} else {
  benchmark = parseBlueprint(JSON.parse(readFileSync(options.against, 'utf8')));
}

if (benchmark === null) throw new Error(`nothing to measure against in ${options.run}`);

const report = measure(record, benchmark);
console.log(`${record.generations.length} generations against ${options.against} — ${report.matches} matches\n`);
console.log('  gen   mean   best  it scored   beat it');
for (const point of report.points) {
  console.log(
    `  ${String(point.generation).padStart(3)}  ${point.mean.toFixed(3)}  ${point.best.toFixed(3)}` +
      `      ${point.against.toFixed(3)}     ${String(point.wins).padStart(2)}/${point.individuals}`,
  );
}
const moved = trend(report);
console.log(
  `\nfirst ${moved.first.toFixed(3)} → last ${moved.last.toFixed(3)} ` +
    `(${moved.gain >= 0 ? '+' : ''}${moved.gain.toFixed(3)})`,
);
