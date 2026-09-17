import { parseBlueprint, type Blueprint } from '../sim/index.js';
import corvetteFile from './corvette.json' with { type: 'json' };
import beamCorvetteFile from './beam-corvette.json' with { type: 'json' };
import damagedCorvetteFile from './damaged-corvette.json' with { type: 'json' };
import gunshipFile from './gunship.json' with { type: 'json' };
import gunship2File from './gunship2.json' with { type: 'json' };
import flatGunshipFile from './flat-gunship.json' with { type: 'json' };
import flatGunshipGroupedFile from './flat-gunship-grouped.json' with { type: 'json' };
import beamGunshipFile from './beam-gunship.json' with { type: 'json' };
import fractalFile from './fractal.json' with { type: 'json' };
import dinkyFile from './dinky.json' with { type: 'json' };

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
 * Two of them are not drawn at all. The flat gunships are the gunship with its
 * assemblies expanded away, written by `scripts/flatten.ts`, and they exist so
 * that `ordering.ts` can fly three ships that are identical in every respect
 * but the order their modules are listed in.
 *
 * **Imported rather than read.** A JSON import is inlined by the bundler and
 * resolved by Node, so the browser and the test suite get the same ships by
 * the same route, with no fetch, no asynchrony and nothing to differ. Files a
 * player supplies are a different matter and go through `parseBlueprint` at
 * runtime — which is what these do too, so the built-in ships are held to
 * exactly the validation a stranger's file is.
 */

export const CORVETTE: Blueprint = parseBlueprint(corvetteFile);
export const BEAM_CORVETTE: Blueprint = parseBlueprint(beamCorvetteFile);
export const DAMAGED_CORVETTE: Blueprint = parseBlueprint(damagedCorvetteFile);
export const GUNSHIP: Blueprint = parseBlueprint(gunshipFile);
export const GUNSHIP2: Blueprint = parseBlueprint(gunship2File);
export const FLAT_GUNSHIP: Blueprint = parseBlueprint(flatGunshipFile);
export const FLAT_GUNSHIP_GROUPED: Blueprint = parseBlueprint(flatGunshipGroupedFile);
export const BEAM_GUNSHIP: Blueprint = parseBlueprint(beamGunshipFile);
export const FRACTAL: Blueprint = parseBlueprint(fractalFile);
export const DINKY: Blueprint = parseBlueprint(dinkyFile);

export const BLUEPRINTS = { corvette: CORVETTE, beamCorvette: BEAM_CORVETTE, gunship: GUNSHIP, gunship2: GUNSHIP2, beamGunship: BEAM_GUNSHIP, damagedCorvette: DAMAGED_CORVETTE, fractal: FRACTAL, flatGunship: FLAT_GUNSHIP, dinky: DINKY, flatGunshipGrouped: FLAT_GUNSHIP_GROUPED } as const;

export type BlueprintName = keyof typeof BLUEPRINTS;
