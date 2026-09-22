import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { compileBlueprint, type Blueprint } from '../sim/index.js';
import { BLUEPRINTS, type BlueprintName } from '../scenarios/blueprints.js';
import { champion, matchCount, runEvolution, DEFAULT_RUN, type RunConfig } from '../evolution/run.js';

/**
 * Run an evolution headlessly and write what happened to a file.
 *
 * Headless because that is what makes a generation cheap: nothing here needs a
 * canvas, and a run of a few hundred matches takes seconds rather than the
 * hours the same battles would take to watch. What it writes is a run record —
 * every generation, every design in it, and every match with the seed it was
 * fought under, which is all it takes to watch any one of them again.
 */

interface Options {
  readonly from: readonly BlueprintName[];
  readonly out: string;
  readonly config: Partial<RunConfig>;
  readonly quiet: boolean;
}

function parse(argv: readonly string[]): Options {
  const from: BlueprintName[] = [];
  const config: Record<string, unknown> = {};
  const match: Record<string, unknown> = {};
  let out = 'runs/run.json';
  let quiet = false;
  let budget = 0;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const value = (): string => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${arg} wants a value`);
      return next;
    };
    switch (arg) {
      case '--from':
        for (const name of value().split(',')) {
          if (!(name in BLUEPRINTS)) {
            throw new Error(`no such ship: ${name}. Try ${Object.keys(BLUEPRINTS).join(', ')}`);
          }
          from.push(name as BlueprintName);
        }
        break;
      case '--out': out = value(); break;
      case '--seed': config['seed'] = Number(value()); break;
      case '--generations': config['generations'] = Number(value()); break;
      case '--population': config['population'] = Number(value()); break;
      case '--winners': config['winners'] = Number(value()); break;
      case '--group': config['group'] = Number(value()); break;
      case '--matches': config['minMatches'] = Number(value()); break;
      // As a multiple of what the ships it started from weigh, so the one
      // number means the same thing whatever a run is started from.
      case '--budget': budget = Number(value()); break;
      case '--duration': match['duration'] = Number(value()); break;
      case '--radius': match['radius'] = Number(value()); break;
      case '--quiet': quiet = true; break;
      default:
        throw new Error(`unknown argument ${arg}`);
    }
  }

  if (from.length === 0) from.push('corvette');
  if (Object.keys(match).length > 0) config['match'] = match;
  if (budget > 0) {
    let heaviest = 0;
    for (const name of from) heaviest = Math.max(heaviest, compileBlueprint(BLUEPRINTS[name]!).mass);
    config['massBudget'] = heaviest * budget;
  }
  return { from, out, config, quiet };
}

const options = parse(process.argv.slice(2));
const founders: Blueprint[] = options.from.map((name) => BLUEPRINTS[name]!);
const settings: RunConfig = { ...DEFAULT_RUN, ...options.config };

if (!options.quiet) {
  console.log(
    `${options.from.join(', ')} — ${settings.generations} generations of ` +
      `${settings.population}, ${settings.group} to a match, ${settings.minMatches} matches each`,
  );
}

const started = Date.now();
const run = runEvolution(founders, options.config, (generation) => {
  if (options.quiet) return;
  console.log(
    `gen ${String(generation.index).padStart(3)}  ` +
      `${String(generation.matches.length).padStart(3)} matches  ` +
      `mean ${generation.meanFitness.toFixed(3)}  best ${generation.bestFitness.toFixed(3)}  ` +
      `| survival ${generation.mean.survival.toFixed(2)}  ` +
      `damage ${generation.mean.damage.toFixed(3)}  race ${generation.mean.race.toFixed(2)}`,
  );
});
const spent = (Date.now() - started) / 1000;

mkdirSync(dirname(options.out), { recursive: true });
writeFileSync(options.out, `${JSON.stringify(run, null, 2)}\n`);

if (!options.quiet) {
  const best = champion(run);
  console.log(`\n${matchCount(run)} matches in ${spent.toFixed(1)}s → ${options.out}`);
  if (best !== null) {
    console.log(
      `champion: generation ${best.generation}, individual ${best.individual.id}, ` +
        `fitness ${best.individual.fitness.toFixed(3)} from ${best.individual.matches} matches, ` +
        `${(best.individual.mass / 1000).toFixed(1)} tonnes`,
    );
    console.log(
      `  survival ${best.individual.survival.toFixed(2)}  ` +
        `damage ${best.individual.damage.toFixed(2)}  race ${best.individual.race.toFixed(2)}`,
    );
    for (const edit of best.individual.edits) console.log(`  ${edit}`);
  }
}
