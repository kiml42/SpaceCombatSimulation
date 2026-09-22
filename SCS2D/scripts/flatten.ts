import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandBlueprint, serialiseBlueprint, parseBlueprint } from '../sim/index.js';
import type { Blueprint, ModuleSpec } from '../sim/index.js';
import { BLUEPRINTS, type BlueprintName } from '../scenarios/blueprints.js';

/**
 * Write a blueprint out with its assemblies expanded away: the same modules,
 * in the same places, as one flat list.
 *
 *   npx tsx scripts/flatten.ts gunship scenarios/flat-gunship.json
 *   npx tsx scripts/flatten.ts gunship scenarios/flat-gunship-grouped.json --order=kind
 *
 * A flat copy compiles to the same ship, so the only thing it can differ in is
 * module order — which is what `scenarios/ordering.ts` measures. Generated
 * rather than hand-drawn so a copy cannot drift from its original; notes
 * already in the output file are kept, since why a layout is as it is belongs
 * with the layout.
 */

const ORDERS = {
  /** Exactly what expansion produces: depth-first through the assemblies. */
  expansion: (modules: readonly ModuleSpec[]): readonly ModuleSpec[] => modules,
  /** All the structure, then all the thrusters, then the guns. Stable, so the
   * only change is which kinds come first. */
  kind: (modules: readonly ModuleSpec[]): readonly ModuleSpec[] => {
    const rank = ['structure', 'core', 'thruster', 'turret', 'beamTurret'];
    return [...modules].sort((a, b) => rank.indexOf(a.kind) - rank.indexOf(b.kind));
  },
} as const;

type OrderName = keyof typeof ORDERS;

function usage(problem: string): never {
  console.error(`${problem}
usage: npx tsx scripts/flatten.ts <blueprint> <output.json> [--order=expansion|kind] [--name=...]
  blueprint  one of: ${Object.keys(BLUEPRINTS).join(', ')}
  --order    expansion (default) or kind`);
  process.exit(1);
}

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const flag = (name: string): string | undefined => {
  const found = args.find((a) => a.startsWith(`--${name}=`));
  return found?.slice(name.length + 3);
};

const [source, output] = positional;
if (source === undefined || output === undefined) usage('need a blueprint and an output path');
if (!(source in BLUEPRINTS)) usage(`no built-in blueprint named ${source}`);

const orderName = (flag('order') ?? 'expansion') as OrderName;
if (!(orderName in ORDERS)) usage(`no ordering named ${orderName}`);

const blueprint = BLUEPRINTS[source as BlueprintName];
const modules = ORDERS[orderName](expandBlueprint(blueprint));

const here = dirname(fileURLToPath(import.meta.url));
const path = join(here, '..', output);

const existingNotes = existsSync(path)
  ? (JSON.parse(readFileSync(path, 'utf8')) as { notes?: string }).notes
  : undefined;

const flat: Blueprint = {
  name: flag('name') ?? `Flat ${blueprint.name}`,
  modules: modules.map((m) => ({ ...m })),
};
if (existingNotes !== undefined) flat.notes = existingNotes;

const file = serialiseBlueprint(flat);
// The same validation a stranger's file gets, so a broken one is caught here.
parseBlueprint(JSON.parse(JSON.stringify(file)));
writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);

console.log(
  `${output}: ${modules.length} modules from ${blueprint.name}, ${orderName} order` +
    `${existingNotes === undefined ? '' : ', notes kept'}`,
);
