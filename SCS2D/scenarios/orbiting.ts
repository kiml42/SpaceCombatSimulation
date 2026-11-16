import {
    asteroidBlueprint,
    compileBlueprint,
    DEFAULT_DOCTRINE,
    majorWell,
    math,
    NEUTRAL_TEAM,
    wellPull,
    type Blueprint,
    type ShipDesign,
    type WellSpec,
} from "../sim/index.js";
import { Rng } from "../sim/rng.js";
import type { Battle } from "./types.js";
import { makeBattle } from "./battle.js";
import { CORVETTE, DINKY, GUNSHIP } from "./blueprints.js";

/**
 * Ships on one side, with nothing to fight and nobody to escort, round an
 * asteroid with a strong pull and low on fuel. Each should put itself into
 * orbit and coast, rather than burn to hover until its tanks run dry and it
 * falls; and escorts, where there are any, should hold station on it there.
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
    /** Ships that keep their own doctrine's escorting, starting round the first of the fleet. */
    readonly escorts?: { readonly blueprint: Blueprint; readonly count: number };
}

export interface OrbitingVariant extends OrbitingOptions {
    readonly name: string;
}

/**
 * The first is the golden: a few Corvettes from rest. The crowds start drifting
 * every way, so some go round against the rest and have to keep clear of them.
 * The Gunship's Dinkies cover it, as a Dinky covers anything twice its size.
 * Fuel is a few times what getting into orbit takes, and well under a minute of hovering.
 */
export const ORBITING_VARIANTS: readonly OrbitingVariant[] = [
    { name: "3 Corvettes", blueprint: CORVETTE, count: 3, fuel: 0.05 },
    { name: "60 Dinkies", blueprint: DINKY, count: 60, drift: 1, fuel: 0.25 },
    { name: "200 Dinkies", blueprint: DINKY, count: 200, drift: 1, fuel: 0.25 },
    { name: "Gunship escorted by 8 Dinkies", blueprint: GUNSHIP, count: 1, fuel: 0.25, escorts: { blueprint: DINKY, count: 8 } },
];

/** How far from the ship they cover escorts start, metres. */
const ESCORT_NEAREST = 60;
const ESCORT_FURTHEST = 150;

export type Orbiting = Battle & { readonly rock: number; readonly fleet: readonly number[]; readonly escorts: readonly number[] };

export function orbiting(
    seed = 20260905,
    { blueprint, count, drift = 0, fuel = 1, escorts }: OrbitingOptions = ORBITING_VARIANTS[0]!,
): Orbiting {
    return makeBattle({ seed, wells: [majorWell(ORBIT_ROCK_RADIUS, SURFACE_GRAVITY)] }, (ships, world, wells) => {
        const well = wells[0]!;
        const shape = { radius: ORBIT_ROCK_RADIUS, kernel: true, ore: 0, ice: 0, corners: 10, rings: 2, ragged: false };
        const rock = ships.spawn(world, {
            design: compileBlueprint(asteroidBlueprint("Asteroid", shape, new Rng(seed))),
            rides: well,
            team: NEUTRAL_TEAM,
            invulnerable: true,
        });
        const rng = new Rng(seed);
        const place = (design: ShipDesign, x: number, y: number, vx: number, vy: number): number => {
            const s = ships.spawn(world, { design, x, y, vx, vy, angle: rng.nextRange(0, 2 * math.PI), team: 0 });
            const b = world.bodies.indexOf(ships.body(s));
            for (let m = 0; m < design.modules.length; m++) ships.fuel.vent(b, m, ships.fuel.held(b, m) * (1 - fuel));
            return s;
        };
        const design = compileBlueprint(alone(blueprint));
        const fleet: number[] = [];
        for (let k = 0; k < count; k++) {
            const bearing = ((k + rng.nextRange(-0.3, 0.3)) * 2 * math.PI) / count;
            const r = NEAREST + (FURTHEST - NEAREST) * rng.nextFloat();
            const speed = drift * rng.nextFloat() * circularSpeed(well, r);
            const heading = rng.nextRange(0, 2 * math.PI);
            fleet.push(
                place(
                    design,
                    well.x + r * math.cos(bearing),
                    well.y + r * math.sin(bearing),
                    speed * math.cos(heading),
                    speed * math.sin(heading),
                ),
            );
        }
        const cover: number[] = [];
        if (escorts !== undefined) {
            const escortDesign = compileBlueprint(escorts.blueprint);
            const b = world.bodies;
            const lead = b.indexOf(ships.body(fleet[0]!));
            for (let k = 0; k < escorts.count; k++) {
                const bearing = (k * 2 * math.PI) / escorts.count;
                const r = ESCORT_NEAREST + (ESCORT_FURTHEST - ESCORT_NEAREST) * rng.nextFloat();
                cover.push(
                    place(escortDesign, b.x[lead]! + r * math.cos(bearing), b.y[lead]! + r * math.sin(bearing), b.vx[lead]!, b.vy[lead]!),
                );
            }
        }
        return { rock, fleet, escorts: cover };
    });
}

/** The speed of a circular orbit `r` metres from the middle of `well`, softening and all. */
export function circularSpeed(well: WellSpec, r: number): number {
    return math.sqrt(wellPull(well, well.x + r, well.y) * r * r);
}
