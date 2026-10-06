import { readFileSync } from 'node:fs';
import { parseBlueprint, parseFleet } from '../sim/index.js';
import type { Entrant } from '../evolution/match.js';
import { BLUEPRINTS } from '../scenarios/blueprints.js';
import { championGrid, latest, measure, trend } from '../evolution/yardstick.js';
import { entrantOf, type RunRecord } from '../evolution/run.js';

/**
 * Measure a finished run against a ship that does not evolve.
 *
 * Takes a run record and an opponent, and prints how each generation did
 * against it. Nothing about the run is re-run: the record holds every design
 * it ever bred, so a measurement is a fresh set of matches against designs
 * that already exist, and the same run can be measured again against a
 * different opponent whenever the question changes.
 *
 * A co-evolution run is measured as a grid instead, each side's champions
 * against the other's (`championGrid`), unless `--against` names something
 * to measure side A against.
 */

interface Options {
  readonly run: string;
  readonly against: string | null;
  readonly samples: number | undefined;
  readonly seeds: number | undefined;
}

function parse(argv: readonly string[]): Options {
  let run = 'runs/run.json';
  let against: string | null = null;
  let samples: number | undefined;
  let seeds: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = argv[++i];
    if (next === undefined) throw new Error(`${arg} wants a value`);
    if (arg === '--run') run = next;
    else if (arg === '--against') against = next;
    // A co-evolution grid's generations per side, and matches per cell.
    else if (arg === '--samples') samples = Number(next);
    else if (arg === '--seeds') seeds = Number(next);
    else throw new Error(`unknown argument ${arg}`);
  }
  return { run, against, samples, seeds };
}

const options = parse(process.argv.slice(2));
const record = JSON.parse(readFileSync(options.run, 'utf8')) as RunRecord;

if (record.rival !== undefined && options.against === null) {
  const grid = championGrid(record, {
    ...(options.samples === undefined ? {} : { samples: options.samples }),
    ...(options.seeds === undefined ? {} : { seeds: options.seeds }),
  });
  console.log(
    `side A's champions (rows) against side B's (columns), ${grid.seeds} seeds a cell — ${grid.matches} matches\n` +
      `each cell is A's score less B's: above nought, A came off better\n`,
  );
  console.log(`  A \\ B ${grid.generations.map((g) => String(g).padStart(7)).join('')}`);
  grid.cells.forEach((row, r) => {
    console.log(
      `  ${String(grid.generations[r]).padStart(5)} ${row.map((cell) => cell.margin.toFixed(2).padStart(7)).join('')}`,
    );
  });
  console.log(
    `\nAn arms race reads as rows rising down the grid (A's later champions beating B's) and columns falling\n` +
      `across it (B's later champions beating A's). A grid flat both ways is two lineages going round in circles.`,
  );
  process.exit(0);
}
const against = options.against ?? 'latest';

let benchmark: Entrant | null;
if (against === 'latest') {
  benchmark = latest(record);
} else if (against === 'founder') {
  // Whatever the run started from, which is the first individual of the first
  // generation — the population is seeded with the founders before anything
  // is bred from them.
  const first = record.generations[0]?.individuals[0];
  benchmark = first === undefined ? null : entrantOf(first);
} else if (against in BLUEPRINTS) {
  benchmark = BLUEPRINTS[against as keyof typeof BLUEPRINTS];
} else {
  // A fleet file or a blueprint file, told apart by what it carries.
  const file: unknown = JSON.parse(readFileSync(against, 'utf8'));
  benchmark = typeof file === 'object' && file !== null && 'designs' in file ? parseFleet(file) : parseBlueprint(file);
}

if (benchmark === null) throw new Error(`nothing to measure against in ${options.run}`);

const report = measure(record, benchmark);
console.log(`${record.generations.length} generations against ${against} — ${report.matches} matches\n`);
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
