import type { Battle } from "./types.js";
import { duel } from "./duel.js";
import { beamDuel } from "./beamDuel.js";
import { swarm } from "./swarm.js";
import { torpedoes } from "./torpedoes.js";
import { starWars } from "./starWars.js";
import { standoff } from "./standoff.js";
import { column } from "./column.js";
import { split } from "./split.js";
import { torchRun } from "./torchRun.js";
import { binary } from "./binary.js";
import { kernels } from "./kernels.js";
import { asteroidField } from "./asteroidField.js";
import { mining } from "./mining.js";
import { rivalMines } from "./rivalMines.js";
import { broadside } from "./broadside.js";
import { hooked } from "./hooked.js";
import { salvageRun } from "./salvage.js";
import { catamaranRefits, mending, refitting } from "./mending.js";
import { scavenge } from "./scavenge.js";
import { factory, padRebuild } from "./carrier.js";
import { shipyard } from "./shipyard.js";
import { beamCarrier } from "./beamCarrier.js";
import { circling, passes } from "./passes.js";
import { rearm } from "./rearm.js";
import { tanker } from "./tanker.js";

/** The seed every scene is built from, so a scene looks the same each time it is opened. */
export const SCENE_SEED = 20260905;

export interface Scene {
    readonly name: string;
    create(): Battle;
}

/** The battles a viewer offers, by name, in the order it lists them. */
export const SCENES: readonly Scene[] = [
    { name: "Duel", create: () => duel(SCENE_SEED) },
    { name: "Beam Duel", create: () => beamDuel(SCENE_SEED) },
    { name: "Star Wars", create: () => starWars(SCENE_SEED) },
    { name: "Swarm", create: () => swarm(SCENE_SEED) },
    { name: "Super Swarm", create: () => swarm(SCENE_SEED, 300) },
    { name: "Torpedoes", create: () => torpedoes(SCENE_SEED) },
    { name: "Standoff", create: () => standoff(SCENE_SEED) },
    { name: "Line Ahead", create: () => column(SCENE_SEED) },
    { name: "Split", create: () => split(SCENE_SEED) },
    { name: "Torch Run", create: () => torchRun(SCENE_SEED) },
    { name: "Binary", create: () => binary(SCENE_SEED) },
    { name: "Kernels", create: () => kernels(SCENE_SEED) },
    { name: "Asteroid Field", create: () => asteroidField(SCENE_SEED) },
    { name: "Mining", create: () => mining(SCENE_SEED) },
    { name: "Rival Mines", create: () => rivalMines(SCENE_SEED) },
    { name: "Hooked", create: () => hooked(SCENE_SEED) },
    { name: "Broadside", create: () => broadside(SCENE_SEED) },
    { name: "Salvage Run", create: () => salvageRun(SCENE_SEED) },
    { name: "Mending", create: () => mending(SCENE_SEED) },
    { name: "Refitting", create: () => refitting(SCENE_SEED) },
    { name: "Catamaran Refits", create: () => catamaranRefits(SCENE_SEED) },
    { name: "Scavenge", create: () => scavenge(SCENE_SEED) },
    { name: "Pad Rebuild", create: () => padRebuild(SCENE_SEED) },
    { name: "Factory", create: () => factory(SCENE_SEED) },
    { name: "Shipyard", create: () => shipyard(SCENE_SEED) },
    { name: "Rearm", create: () => rearm(SCENE_SEED) },
    { name: "Tanker", create: () => tanker(SCENE_SEED) },
    { name: "Beam Carrier", create: () => beamCarrier(SCENE_SEED) },
    { name: "Passes", create: () => passes(SCENE_SEED) },
    { name: "Circling", create: () => circling(SCENE_SEED) },
];
