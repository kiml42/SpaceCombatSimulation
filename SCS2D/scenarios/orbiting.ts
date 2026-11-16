import {
    asteroidBlueprint,
    compileBlueprint,
    DEFAULT_DOCTRINE,
    majorWell,
    math,
    NEUTRAL_TEAM,
    wellPull,
    type Blueprint,
    type WellSpec,
} from "../sim/index.js";
import { Rng } from "../sim/rng.js";
import type { Battle } from "./types.js";
import { makeBattle } from "./battle.js";
import { CORVETTE, DINKY } from "./blueprints.js";

/**
 * Ships on one side, with nothing to fight and nobody to escort, round an
 * asteroid with a strong pull and low on fuel. Each should put itself into
 * orbit and coast, rather than burn to hover until its tanks run dry and it falls.
 */

/** The rock's radius, metres, and its pull at the surface, m/s². */
export const ORBIT_ROCK_RADIUS = 200;
const SURFACE_GRAVITY = 3;
/** How far from the rock's middle the ships start, metres. */
const NEAREST = 450;
const FURTHEST = 900;

/** A blueprint with no wish to escort anyone, so each ship is left to itself. */
function alone(blueprint: Blueprint): Blueprint {
    const doctrine = blueprint.doctrine ?? DEFAULT_DOCTRINE;
    return { ...blueprint, doctrine: { ...doctrine, targeting: { ...doctrine.targeting, escortWeight: 0 } } };
}

export interface OrbitingOptions {
    readonly blueprint: Blueprint;
    readonly count: number;
    /** How fast each starts moving, in a direction of its own, as a share of the circular speed where it starts. */
    readonly drift?: number;
    /** The share of its tanks each starts with. */
    readonly fuel?: number;
}

export interface OrbitingVariant extends OrbitingOptions {
    readonly name: string;
}

/**
 * The first is the golden: a few Corvettes from rest. The crowds start drifting
 * every way, so some go round against the rest and have to keep clear of them.
 * Fuel is a few times what getting into orbit takes, and well under a minute of hovering.
 */
export const ORBITING_VARIANTS: readonly OrbitingVariant[] = [
    { name: "3 Corvettes", blueprint: CORVETTE, count: 3, fuel: 0.05 },
    { name: "60 Dinkies", blueprint: DINKY, count: 60, drift: 1, fuel: 0.25 },
    { name: "200 Dinkies", blueprint: DINKY, count: 200, drift: 1, fuel: 0.25 },
];

export type Orbiting = Battle & { readonly rock: number; readonly fleet: readonly number[] };

export function orbiting(seed = 20260905, { blueprint, count, drift = 0, fuel = 1 }: OrbitingOptions = ORBITING_VARIANTS[0]!): Orbiting {
    return makeBattle({ seed, wells: [majorWell(ORBIT_ROCK_RADIUS, SURFACE_GRAVITY)] }, (ships, world, wells) => {
        const well = wells[0]!;
        const shape = { radius: ORBIT_ROCK_RADIUS, kernel: true, ore: 0, ice: 0, corners: 10, rings: 2, ragged: false };
        const rock = ships.spawn(world, {
            design: compileBlueprint(asteroidBlueprint("Asteroid", shape, new Rng(seed))),
            rides: well,
            team: NEUTRAL_TEAM,
            invulnerable: true,
        });
        const design = compileBlueprint(alone(blueprint));
        const rng = new Rng(seed);
        const fleet: number[] = [];
        for (let k = 0; k < count; k++) {
            const bearing = ((k + rng.nextRange(-0.3, 0.3)) * 2 * math.PI) / count;
            const r = NEAREST + (FURTHEST - NEAREST) * rng.nextFloat();
            const speed = drift * rng.nextFloat() * circularSpeed(well, r);
            const heading = rng.nextRange(0, 2 * math.PI);
            const s = ships.spawn(world, {
                design,
                x: well.x + r * math.cos(bearing),
                y: well.y + r * math.sin(bearing),
                vx: speed * math.cos(heading),
                vy: speed * math.sin(heading),
                angle: rng.nextRange(0, 2 * math.PI),
                team: 0,
            });
            const b = world.bodies.indexOf(ships.body(s));
            for (let m = 0; m < design.modules.length; m++) ships.fuel.vent(b, m, ships.fuel.held(b, m) * (1 - fuel));
            fleet.push(s);
        }
        return { rock, fleet };
    });
}

/** The speed of a circular orbit `r` metres from the middle of `well`, softening and all. */
export function circularSpeed(well: WellSpec, r: number): number {
    return math.sqrt(wellPull(well, well.x + r, well.y) * r * r);
}
