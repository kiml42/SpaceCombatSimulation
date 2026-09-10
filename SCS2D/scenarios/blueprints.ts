import { parseBlueprint, type Blueprint } from '../sim/index.js';
import corvetteFile from './corvette.json' with { type: 'json' };
import damagedCorvetteFile from './damaged-corvette.json' with { type: 'json' };
import gunshipFile from './gunship.json' with { type: 'json' };
import gunship2File from './gunship2.json' with { type: 'json' };
import fractalFile from './fractal.json' with { type: 'json' };

/**
 * The ship layouts that ship with the game, loaded from the same files the
 * editor writes.
 *
 * Two of them fight, which is the smallest number that can show a design
 * difference mattering: a light ship that accelerates hard and carries one
 * gun, and a heavy one that out-ranges and out-shoots it but takes a while to
 * point. The third is the first with pieces missing.
 *
 * Why each ship is drawn as it is now lives in the files themselves, in their
 * `notes`, rather than in comments here — so that editing a ship in a tool
 * cannot separate a layout from its reasoning.
 *
 * **Imported rather than read.** A JSON import is inlined by the bundler and
 * resolved by Node, so the browser and the test suite get the same ships by
 * the same route, with no fetch, no asynchrony and nothing to differ. Files a
 * player supplies are a different matter and go through `parseBlueprint` at
 * runtime — which is what these do too, so the built-in ships are held to
 * exactly the validation a stranger's file is.
 */

export const CORVETTE: Blueprint = parseBlueprint(corvetteFile);
export const DAMAGED_CORVETTE: Blueprint = parseBlueprint(damagedCorvetteFile);
export const GUNSHIP: Blueprint = parseBlueprint(gunshipFile);
export const GUNSHIP2: Blueprint = parseBlueprint(gunship2File);
export const FRACTAL: Blueprint = parseBlueprint(fractalFile);

export const BLUEPRINTS = { corvette: CORVETTE, gunship: GUNSHIP, gunship2: GUNSHIP2, damagedCorvette: DAMAGED_CORVETTE, fractal: FRACTAL } as const;

export type BlueprintName = keyof typeof BLUEPRINTS;
