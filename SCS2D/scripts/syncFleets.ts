import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBlueprint, serialiseBlueprint } from '../sim/index.js';

/**
 * Copy each stock blueprint into every stock fleet that embeds a design of the
 * same name, so editing `scenarios/blueprints/x-wing.json` updates the X Wings
 * in the fleets too. Designs are matched by name; a fleet design with no
 * blueprint of its name is left alone. Both sides are compared as parsed, so a
 * legacy spelling or key order alone is not a change, and what is written is
 * the canonical form the fleet editor would save. `npm run dev` runs this on
 * start and whenever a blueprint is saved.
 */

const here = dirname(fileURLToPath(import.meta.url));
export const BLUEPRINT_DIR = join(here, '..', 'scenarios', 'blueprints');
const FLEET_DIR = join(here, '..', 'scenarios', 'fleets');

type Json = Record<string, unknown>;

async function readJsonDir(dir: string): Promise<{ path: string; text: string; json: Json }[]> {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.json')).sort();
  return Promise.all(
    names.map(async (n) => {
      const path = join(dir, n);
      const text = await readFile(path, 'utf8');
      return { path, text, json: JSON.parse(text) as Json };
    }),
  );
}

/** Returns a line per design updated. */
export async function syncFleets(): Promise<string[]> {
  const blueprints = new Map<string, Json>();
  for (const { json } of await readJsonDir(BLUEPRINT_DIR)) {
    const canonical = serialiseBlueprint(parseBlueprint(json));
    blueprints.set(canonical['name'] as string, canonical);
  }

  const changes: string[] = [];
  for (const fleet of await readJsonDir(FLEET_DIR)) {
    const designs = fleet.json['designs'] as Record<string, Json>;
    const updated: string[] = [];
    for (const name of Object.keys(designs)) {
      const blueprint = blueprints.get(name);
      const current = JSON.stringify(serialiseBlueprint(parseBlueprint(designs[name])));
      if (blueprint && JSON.stringify(blueprint) !== current) {
        designs[name] = blueprint;
        updated.push(name);
      }
    }
    if (updated.length === 0) continue;

    const eol = fleet.text.endsWith('\n') ? '\n' : '';
    await writeFile(fleet.path, JSON.stringify(fleet.json, null, 2) + eol, 'utf8');
    const file = fleet.path.slice(FLEET_DIR.length + 1);
    changes.push(...updated.map((name) => `fleets/${file}: updated ${name}`));
  }
  return changes;
}

/** Sync, logging what changed; a malformed file mid-save is reported, not thrown. */
export async function syncFleetsAndLog(): Promise<void> {
  try {
    for (const line of await syncFleets()) console.log(line);
  } catch (e) {
    console.error(`fleet sync failed: ${(e as Error).message}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await syncFleetsAndLog();
