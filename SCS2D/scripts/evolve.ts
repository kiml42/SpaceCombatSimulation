import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  blueprintWarnings,
  compileBlueprint,
  fleetHulls,
  fleetMass,
  fleetWarnings,
  parseBlueprint,
  parseFleet,
  type Blueprint,
  type Fleet,
} from '../sim/index.js';
import { BLUEPRINTS } from '../scenarios/blueprints.js';
import { FLEETS } from '../scenarios/fleets.js';
import { finalist, matchCount, Run, DEFAULT_RUN, type RunConfig } from '../evolution/run.js';
import type { Entrant } from '../evolution/match.js';
import { DEFAULT_BUILD_WEIGHTS, DEFAULT_DOCTRINE_WEIGHTS, DEFAULT_KINDS } from '../evolution/mutate.js';
import { parseRunConfig, runConfigWarnings, serialiseRunConfig, type BossName } from '../evolution/configFile.js';
import type { ModuleKind } from '../sim/modules.js';

/**
 * Run an evolution headlessly and write what happened to a file.
 *
 * Headless because that is what makes a generation cheap: nothing here needs a
 * canvas, and a run of a few hundred matches takes seconds rather than the
 * hours the same battles would take to watch. What it writes is a run record —
 * every generation, every design in it, and every match with the seed it was
 * fought under, which is all it takes to watch any one of them again. It is
 * rewritten as each generation finishes, so a run stopped part way still
 * leaves every generation it finished.
 */

interface Options {
  /** Ship founders, by the name a config file would give them. */
  readonly from: readonly { name: string; blueprint: Blueprint }[];
  /** Fleet founders, by the name a config file would give them. Any makes it a run of fleets. */
  readonly fleets: readonly { name: string; fleet: Fleet }[];
  /** What every entrant fights together, by the name a config file gives it, or null. */
  readonly boss: BossName | null;
  readonly out: string;
  /** Where to write the settings this run was given, or '' for nowhere. */
  readonly saveConfig: string;
  /** The settings' name, from a `--config` file, kept when they are saved again. */
  readonly name: string | undefined;
  readonly config: Partial<RunConfig>;
  readonly quiet: boolean;
}

/** Say what a file carried that nothing reads, and carry on: it is not a reason to stop. */
function warnUnread(file: string, warnings: readonly string[]): void {
  for (const warning of warnings) process.stderr.write(`warning: ${file}: ${warning}\n`);
}

/**
 * A ship by stock name or key, or read from a blueprint file, with the name a
 * config file records it by: a stock ship's own, or a file's path, so that
 * the config can find it again.
 */
function shipFrom(name: string): { name: string; blueprint: Blueprint } {
  for (const [key, blueprint] of Object.entries(BLUEPRINTS)) {
    if (blueprint.name === name || key === name) return { name: blueprint.name, blueprint };
  }
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(name, 'utf8'));
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') throw error;
    throw new Error(
      `no such ship or blueprint file: ${name}. A ship saved in the editor lives in a browser rather ` +
        `than here — export it from there as a file. The stock ships are ${Object.keys(BLUEPRINTS).join(', ')}`,
    );
  }
  const blueprint = parseBlueprint(value);
  warnUnread(name, blueprintWarnings(blueprint));
  return { name, blueprint };
}

/**
 * A fleet by stock name, or read from a fleet file. A file is recorded in a
 * saved config by its fleet's name, which only a stock fleet can be found by
 * again.
 */
function fleetFrom(name: string): Fleet {
  const stock = FLEETS[name];
  if (stock !== undefined) return stock;
  try {
    const fleet = parseFleet(JSON.parse(readFileSync(name, 'utf8')));
    warnUnread(name, fleetWarnings(fleet));
    return fleet;
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') throw error;
    throw new Error(`no such fleet or fleet file: ${name}. The stock fleets are ${Object.keys(FLEETS).join(', ')}`);
  }
}

/** A boss by stock ship, stock fleet or file, and the name a config file will give it. */
function bossFrom(name: string): { boss: Entrant; named: BossName } {
  for (const [key, blueprint] of Object.entries(BLUEPRINTS)) {
    if (blueprint.name === name || key === name) return { boss: blueprint, named: { kind: 'ship', name: blueprint.name } };
  }
  const stock = FLEETS[name];
  if (stock !== undefined) return { boss: stock, named: { kind: 'fleet', name } };
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(name, 'utf8'));
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') throw error;
    throw new Error(`no such ship, fleet or file for a boss: ${name}`);
  }
  if (typeof value === 'object' && value !== null && 'designs' in value) {
    const fleet = parseFleet(value);
    warnUnread(name, fleetWarnings(fleet));
    return { boss: fleet, named: { kind: 'fleet', name: fleet.name } };
  }
  const blueprint = parseBlueprint(value);
  warnUnread(name, blueprintWarnings(blueprint));
  return { boss: blueprint, named: { kind: 'ship', name: blueprint.name } };
}

function parse(argv: readonly string[]): Options {
  const from: { name: string; blueprint: Blueprint }[] = [];
  const fleets: { name: string; fleet: Fleet }[] = [];
  let boss: BossName | null = null;
  // Whatever a `--config` file said, which every flag then overrides: a saved
  // experiment with one number changed is the commonest thing to want, and
  // having to edit the file to get it would mean editing the record of what
  // was run in order to run something else.
  let config: Record<string, unknown> = {};
  const match: Record<string, unknown> = {};
  const fleet: Record<string, unknown> = {};
  const kinds: Partial<Record<ModuleKind, number>> = {};
  const doctrine: Record<string, number> = {};
  const build: Record<string, number> = {};
  let structural: number | undefined;
  let name: string | undefined;
  let out = 'runs/run.json';
  let saveConfig = '';
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
      // Stock ships or blueprint files, comma-separated.
      case '--from':
        for (const name of value().split(',')) from.push(shipFrom(name));
        break;
      case '--fleet': {
        const fleet = fleetFrom(value());
        fleets.push({ name: fleet.name, fleet });
        break;
      }
      // How far from its origin a fleet may spread, and how many ships it may field.
      case '--deploy': fleet['radius'] = Number(value()); break;
      case '--ships': fleet['maxShips'] = Number(value()); break;
      // A ship or fleet every entrant fights together.
      case '--boss': {
        const found = bossFrom(value());
        match['boss'] = found.boss;
        boss = found.named;
        break;
      }
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
      // Each entrant's starting speed towards the middle, and to its left, m/s.
      case '--closing': match['closingSpeed'] = Number(value()); break;
      case '--crossing': match['crossingSpeed'] = Number(value()); break;
      // A weight per module kind, as `engine=5,turret=0` — only the kinds
      // named are changed, the rest keeping their defaults.
      case '--kinds':
        for (const pair of value().split(',')) {
          const [kind, weight] = pair.split('=');
          if (kind === undefined || !(kind in DEFAULT_KINDS)) {
            throw new Error(`no such module kind: ${kind}. Try ${Object.keys(DEFAULT_KINDS).join(', ')}`);
          }
          const number = Number(weight);
          if (!Number.isFinite(number) || number < 0) {
            throw new Error(`${kind} wants a weight of zero or more, not ${weight}`);
          }
          kinds[kind as ModuleKind] = number;
        }
        break;
      // How often doctrine numbers change, as `targeting=0,approach=2`.
      case '--doctrine':
        for (const pair of value().split(',')) {
          const [part, weight] = pair.split('=');
          if (part === undefined || !(part in DEFAULT_DOCTRINE_WEIGHTS)) {
            throw new Error(`no such doctrine part: ${part}. Try ${Object.keys(DEFAULT_DOCTRINE_WEIGHTS).join(', ')}`);
          }
          const number = Number(weight);
          if (!Number.isFinite(number) || number < 0) throw new Error(`${part} wants a weight of zero or more, not ${weight}`);
          doctrine[part] = number;
        }
        break;
      // How often each sort of build number changes, as `move=0,hidden=2`.
      case '--build':
        for (const pair of value().split(',')) {
          const [part, weight] = pair.split('=');
          if (part === undefined || !(part in DEFAULT_BUILD_WEIGHTS)) {
            throw new Error(`no such build part: ${part}. Try ${Object.keys(DEFAULT_BUILD_WEIGHTS).join(', ')}`);
          }
          const number = Number(weight);
          if (!Number.isFinite(number) || number < 0) throw new Error(`${part} wants a weight of zero or more, not ${weight}`);
          build[part] = number;
        }
        break;
      // Chance a generation also adds, removes or regroups modules, 0 to 1.
      case '--structural': {
        const raw = value();
        structural = Number(raw);
        if (!Number.isFinite(structural) || structural < 0 || structural > 1) {
          throw new Error(`--structural wants a chance between 0 and 1, not ${raw}`);
        }
        break;
      }
      // Settings written by the evolution page, or by `--save-config`.
      case '--config': {
        const path = value();
        const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
        const setup = parseRunConfig(raw);
        name = setup.name;
        warnUnread(path, runConfigWarnings(raw));
        for (const name of setup.founders) from.push(shipFrom(name));
        for (const name of setup.fleets ?? []) fleets.push({ name, fleet: fleetFrom(name) });
        config = { ...setup.config };
        if (setup.boss != null) {
          const found = bossFrom(setup.boss.name);
          config['match'] = { ...setup.config.match, boss: found.boss };
          boss = found.named;
        }
        break;
      }
      case '--save-config': saveConfig = value(); break;
      case '--quiet': quiet = true; break;
      default:
        throw new Error(`unknown argument ${arg}`);
    }
  }

  if (from.length === 0 && fleets.length === 0) from.push(shipFrom('corvette'));
  if (Object.keys(match).length > 0) {
    config['match'] = { ...(config['match'] as object | undefined), ...match };
  }
  if (Object.keys(fleet).length > 0) {
    config['fleet'] = { ...(config['fleet'] as object | undefined), ...fleet };
  }
  if (
    Object.keys(kinds).length > 0 ||
    Object.keys(doctrine).length > 0 ||
    Object.keys(build).length > 0 ||
    structural !== undefined
  ) {
    const held = config['mutation'] as { kinds?: object; doctrine?: object; build?: object } | undefined;
    config['mutation'] = {
      ...held,
      ...(structural === undefined ? {} : { structural }),
      kinds: { ...held?.kinds, ...kinds },
      doctrine: { ...held?.doctrine, ...doctrine },
      build: { ...held?.build, ...build },
    };
  }
  if (budget > 0) {
    let heaviest = 0;
    for (const { blueprint } of from) heaviest = Math.max(heaviest, compileBlueprint(blueprint).mass);
    for (const { fleet } of fleets) heaviest = Math.max(heaviest, fleetMass(fleetHulls(fleet)));
    config['massBudget'] = heaviest * budget;
  }
  return { from, fleets, boss, out, saveConfig, name, config, quiet };
}

const options = parse(process.argv.slice(2));
const founders: Entrant[] = [
  ...options.from.map(({ blueprint }) => blueprint),
  ...options.fleets.map(({ fleet }) => fleet),
];
const settings: RunConfig = { ...DEFAULT_RUN, ...options.config };

if (!options.quiet) {
  console.log(
    `${[...options.from, ...options.fleets].map(({ name }) => name).join(', ')} — ${settings.generations} generations of ` +
      `${settings.population}, ${settings.group} to a match, ${settings.minMatches} matches each` +
      (options.boss === null ? '' : `, all against ${options.boss.name}`),
  );
}

if (options.saveConfig !== '') {
  mkdirSync(dirname(options.saveConfig), { recursive: true });
  writeFileSync(
    options.saveConfig,
    `${JSON.stringify(
      serialiseRunConfig({
        ...(options.name === undefined ? {} : { name: options.name }),
        founders: options.from.map(({ name }) => name),
        fleets: options.fleets.map(({ name }) => name),
        boss: options.boss,
        config: settings,
      }),
      null,
      2,
    )}\n`,
  );
  if (!options.quiet) console.log(`settings → ${options.saveConfig}`);
}

const started = Date.now();
mkdirSync(dirname(options.out), { recursive: true });
// Beside it and then over it, so a run stopped mid-write keeps the last whole one.
const writeRun = (): void => {
  writeFileSync(`${options.out}.part`, `${JSON.stringify(runner.record(), null, 2)}\n`);
  renameSync(`${options.out}.part`, options.out);
};
const runner: Run = new Run(founders, options.config, (generation) => {
  writeRun();
  if (options.quiet) return;
  console.log(
    `gen ${String(generation.index).padStart(3)}  ` +
      `${String(generation.matches.length).padStart(3)} matches  ` +
      `mean ${generation.meanFitness.toFixed(3)}  best ${generation.bestFitness.toFixed(3)}  ` +
      `| hull ${generation.mean.survival.toFixed(2)}  function ${generation.mean.functional.toFixed(2)}  ` +
      `damage ${generation.mean.damage.toFixed(3)}  disabling ${generation.mean.disabling.toFixed(3)}  ` +
      `race ${generation.mean.race.toFixed(2)}`,
  );
});
const run = runner.finish();
const spent = (Date.now() - started) / 1000;
writeRun();

if (!options.quiet) {
  const best = finalist(run);
  console.log(`\n${matchCount(run)} matches in ${spent.toFixed(1)}s → ${options.out}`);
  if (best !== null) {
    console.log(
      `arrived at: generation ${best.generation}, individual ${best.individual.id}, ` +
        `fitness ${best.individual.fitness.toFixed(3)} from ${best.individual.matches} matches, ` +
        `${(best.individual.mass / 1000).toFixed(1)} tonnes`,
    );
    console.log(
      `  hull ${best.individual.survival.toFixed(2)}  function ${(best.individual.functional ?? 0).toFixed(2)}  ` +
        `disabling ${(best.individual.disabling ?? 0).toFixed(2)}  ` +
        `damage ${best.individual.damage.toFixed(2)}  race ${best.individual.race.toFixed(2)}`,
    );
    for (const edit of best.individual.edits) console.log(`  ${edit}`);
    // Said out loud because the number above invites exactly the wrong
    // reading: a fitness is a score against that generation's opponents, so
    // it cannot be compared with one from another generation.
    console.log(
      `\n  Fitness is scored against the rest of the generation, so these numbers do not\n` +
        `  compare across generations. For that, run: npm run yardstick -- --run ${options.out}`,
    );
  }
}
