import type { Battle } from "./types.js";
import { LIGHTS, lit } from "./lights.js";
import { duel } from "./duel.js";
import { railDuel } from "./railDuel.js";
import { lanceDuel } from "./lanceDuel.js";
import { armour, ARMOUR_ATTACKERS, ARMOUR_LEVELS } from "./armour.js";
import { beamDuel } from "./beamDuel.js";
import { swarm } from "./swarm.js";
import { torpedoes } from "./torpedoes.js";
import { torpedoBoat } from "./torpedoBoat.js";
import { DISARMERS, disarm } from "./disarm.js";
import { BEAM_GUNSHIP, GUN_PLATFORM, KKV, SHAPED_TORPEDO, TORPEDO } from "./blueprints.js";
import { starWars } from "./starWars.js";
import { standoff } from "./standoff.js";
import { column } from "./column.js";
import { split } from "./split.js";
import { crash } from "./crash.js";
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
import { CRIPPLINGS, crippledLanding } from "./crippledLanding.js";
import { ROCK_CRIPPLINGS, rockLanding } from "./rockLanding.js";
import { ORBITING_VARIANTS, orbiting } from "./orbiting.js";

/** The seed every scene is built from, so a scene looks the same each time it is opened. */
export const SCENE_SEED = 20260905;

export interface Scene {
    readonly name: string;
    /** The versions of this scene a viewer can pick between, by name; `create` takes the index of one. */
    readonly variants?: readonly string[];
    create(variant?: number): Battle;
}

/** The battles a viewer offers, by name, in the order it lists them, each in a light of its own. */
export const SCENES: readonly Scene[] = [
    { name: "Duel", create: () => lit(duel(SCENE_SEED), LIGHTS.daylight) },
    { name: "Beam Duel", create: () => lit(beamDuel(SCENE_SEED), LIGHTS.eclipse) },
    { name: "Rail Duel", create: () => lit(railDuel(SCENE_SEED), LIGHTS.blueGiant) },
    { name: "Lance Duel", create: () => lit(lanceDuel(SCENE_SEED), LIGHTS.redDwarf) },
    {
        name: "Armour",
        // Each attacker against the Gun Platform's plating, at each reinforcement from none to extreme.
        variants: ARMOUR_ATTACKERS.flatMap(([name]) => ARMOUR_LEVELS.map((level) => `${name}, reinforced ${level}`)),
        create: (variant = 0) =>
            lit(
                armour(
                    SCENE_SEED,
                    (variant - (variant % ARMOUR_LEVELS.length)) / ARMOUR_LEVELS.length,
                    ARMOUR_LEVELS[variant % ARMOUR_LEVELS.length]!,
                ),
                LIGHTS.daylight,
            ),
    },
    { name: "Star Wars", create: () => lit(starWars(SCENE_SEED), LIGHTS.noon) },
    {
        name: "Swarm",
        variants: ["20 fighters", "300 fighters"],
        create: (variant = 0) => (variant === 1 ? lit(swarm(SCENE_SEED, 300), LIGHTS.redDwarf) : lit(swarm(SCENE_SEED), LIGHTS.dusk)),
    },
    {
        name: "Torpedoes",
        // Each torpedo against the Beam Gunship, as in a real battle, then against the Gun Platform, whose guns
        // cannot follow them, to see what each does when it gets there.
        variants: [
            "KKVs, Beam Gunship",
            "Torpedoes, Beam Gunship",
            "Shaped Torpedoes, Beam Gunship",
            "KKVs, Gun Platform",
            "Torpedoes, Gun Platform",
            "Shaped Torpedoes, Gun Platform",
        ],
        create: (variant = 0) =>
            lit(
                torpedoes(SCENE_SEED, undefined, variant < 3 ? BEAM_GUNSHIP : GUN_PLATFORM, [KKV, TORPEDO, SHAPED_TORPEDO][variant % 3]),
                LIGHTS.violet,
            ),
    },
    {
        name: "Torpedo Boat",
        variants: ["KKVs", "Torpedoes"],
        create: (variant = 0) => lit(torpedoBoat(SCENE_SEED, variant === 1 ? TORPEDO : undefined), LIGHTS.dusk),
    },
    {
        name: "Disarm",
        variants: DISARMERS.map((d) => d.name),
        create: (variant = 0) => lit(disarm(SCENE_SEED, DISARMERS[variant]!.blueprint, DISARMERS[variant]!.count), LIGHTS.noon),
    },
    { name: "Standoff", create: () => lit(standoff(SCENE_SEED), LIGHTS.ice) },
    { name: "Line Ahead", create: () => lit(column(SCENE_SEED), LIGHTS.gold) },
    { name: "Split", create: () => lit(split(SCENE_SEED), LIGHTS.nebula) },
    { name: "Crash", create: () => lit(crash(SCENE_SEED), LIGHTS.daylight) },
    { name: "Torch Run", create: () => lit(torchRun(SCENE_SEED), LIGHTS.eclipse) },
    { name: "Binary", create: () => lit(binary(SCENE_SEED), LIGHTS.blueGiant) },
    { name: "Kernels", create: () => lit(kernels(SCENE_SEED), LIGHTS.violet) },
    { name: "Asteroid Field", create: () => lit(asteroidField(SCENE_SEED), LIGHTS.dusk) },
    { name: "Mining", create: () => lit(mining(SCENE_SEED), LIGHTS.gold) },
    { name: "Rival Mines", create: () => lit(rivalMines(SCENE_SEED), LIGHTS.ice) },
    { name: "Hooked", create: () => lit(hooked(SCENE_SEED), LIGHTS.nebula) },
    { name: "Broadside", create: () => lit(broadside(SCENE_SEED), LIGHTS.eclipse) },
    { name: "Salvage Run", create: () => lit(salvageRun(SCENE_SEED), LIGHTS.redDwarf) },
    { name: "Mending", create: () => lit(mending(SCENE_SEED), LIGHTS.noon) },
    { name: "Refitting", create: () => lit(refitting(SCENE_SEED), LIGHTS.daylight) },
    { name: "Catamaran Refits", create: () => lit(catamaranRefits(SCENE_SEED), LIGHTS.ice) },
    { name: "Scavenge", create: () => lit(scavenge(SCENE_SEED), LIGHTS.dusk) },
    { name: "Pad Rebuild", create: () => lit(padRebuild(SCENE_SEED), LIGHTS.noon) },
    { name: "Factory", create: () => lit(factory(SCENE_SEED), LIGHTS.daylight) },
    { name: "Shipyard", create: () => lit(shipyard(SCENE_SEED), LIGHTS.gold) },
    { name: "Rearm", create: () => lit(rearm(SCENE_SEED), LIGHTS.violet) },
    { name: "Tanker", create: () => lit(tanker(SCENE_SEED), LIGHTS.blueGiant) },
    { name: "Beam Carrier", create: () => lit(beamCarrier(SCENE_SEED), LIGHTS.nebula) },
    { name: "Passes", create: () => lit(passes(SCENE_SEED), LIGHTS.dusk) },
    { name: "Circling", create: () => lit(circling(SCENE_SEED), LIGHTS.ice) },
    {
        name: "Crippled Landing",
        variants: CRIPPLINGS.map((crippling) => crippling.name),
        create: (variant = 0) => lit(crippledLanding(SCENE_SEED, CRIPPLINGS[variant]), LIGHTS.gold),
    },
    {
        name: "Rock Landing",
        variants: ROCK_CRIPPLINGS.map((crippling) => crippling.name),
        create: (variant = 0) => lit(rockLanding(SCENE_SEED, ROCK_CRIPPLINGS[variant]), LIGHTS.daylight),
    },
    {
        name: "Orbiting",
        variants: ORBITING_VARIANTS.map((v) => v.name),
        create: (variant = 0) => lit(orbiting(SCENE_SEED, ORBITING_VARIANTS[variant]), LIGHTS.dusk),
    },
];
