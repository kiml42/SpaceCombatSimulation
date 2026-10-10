import { parseBlueprint, type Blueprint } from '../sim/index.js';
import corvetteFile from './blueprints/corvette.json' with { type: 'json' };
import beamCorvetteFile from './blueprints/beam-corvette.json' with { type: 'json' };
import gunshipFile from './blueprints/gunship.json' with { type: 'json' };
import beamGunshipFile from './blueprints/beam-gunship.json' with { type: 'json' };
import fractalFile from './blueprints/fractal.json' with { type: 'json' };
import dinkyFile from './blueprints/dinky.json' with { type: 'json' };
import catamaranFile from './blueprints/catamaran.json' with { type: 'json' };
import bareCoreFile from './blueprints/bare-core.json' with { type: 'json' };
import torchFile from './blueprints/torch.json' with { type: 'json' };
import laserFrigateFile from './blueprints/laser-frigate.json' with { type: 'json' };
import broadsideFile from './blueprints/broadside.json' with { type: 'json' };
import torpedoFile from './blueprints/torpedo.json' with { type: 'json' };
import scavengerFile from './blueprints/scavenger.json' with { type: 'json' };
import tankerFile from './blueprints/tanker.json' with { type: 'json' };
import beamCarrierFile from './blueprints/beam-carrier.json' with { type: 'json' };

// --- Star Wars ---
import xWingFile from './blueprints/x-wing.json' with { type: 'json' };
import aWingFile from './blueprints/a-wing.json' with { type: 'json' };
import yWingFile from './blueprints/y-wing.json' with { type: 'json' };
import ghostFile from './blueprints/ghost.json' with { type: 'json' };
import tieFile from './blueprints/tie-fighter.json' with { type: 'json' };
import starDestroyerFile from './blueprints/star-destroyer.json' with { type: 'json' };


/**
 * The ship layouts that ship with the game, loaded from the same files the
 * editor writes.
 *
 * Two of them fight, which is the smallest number that can show a design
 * difference mattering: a light ship that accelerates hard and carries one
 * gun, and a heavy one that out-ranges and out-shoots it but takes a while to
 * point.
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
export const BEAM_CORVETTE: Blueprint = parseBlueprint(beamCorvetteFile);
export const GUNSHIP: Blueprint = parseBlueprint(gunshipFile);
export const BEAM_GUNSHIP: Blueprint = parseBlueprint(beamGunshipFile);
export const FRACTAL: Blueprint = parseBlueprint(fractalFile);
export const DINKY: Blueprint = parseBlueprint(dinkyFile);
export const CATAMARAN: Blueprint = parseBlueprint(catamaranFile);
export const BARE_CORE: Blueprint = parseBlueprint(bareCoreFile);
export const TORCH: Blueprint = parseBlueprint(torchFile);
export const LASER_FRIGATE: Blueprint = parseBlueprint(laserFrigateFile);
export const TORPEDO: Blueprint = parseBlueprint(torpedoFile);
export const BROADSIDE: Blueprint = parseBlueprint(broadsideFile);
export const SCAVENGER: Blueprint = parseBlueprint(scavengerFile);
export const TANKER: Blueprint = parseBlueprint(tankerFile);
export const BEAM_CARRIER: Blueprint = parseBlueprint(beamCarrierFile);

export const X_WING: Blueprint = parseBlueprint(xWingFile);
export const A_WING: Blueprint = parseBlueprint(aWingFile);
export const Y_WING: Blueprint = parseBlueprint(yWingFile);
export const GHOST: Blueprint = parseBlueprint(ghostFile);
export const TIE: Blueprint = parseBlueprint(tieFile);
export const STAR_DESTROYER: Blueprint = parseBlueprint(starDestroyerFile);

export const BLUEPRINTS = {
    corvette: CORVETTE,
    beamCorvette: BEAM_CORVETTE,
    gunship: GUNSHIP,
    beamGunship: BEAM_GUNSHIP,
    fractal: FRACTAL,
    dinky: DINKY,
    catamaran: CATAMARAN,
    bareCore: BARE_CORE,
    torch: TORCH,
    laserFrigate: LASER_FRIGATE,
    torpedo: TORPEDO,
    broadside: BROADSIDE,
    scavenger: SCAVENGER,
    tanker: TANKER,
    beamCarrier: BEAM_CARRIER,

    xWing: X_WING,
    aWing: A_WING,
    yWing: Y_WING,
    ghost: GHOST,
    tie: TIE,
    starDestroyer: STAR_DESTROYER,
} as const;

export type BlueprintName = keyof typeof BLUEPRINTS;
