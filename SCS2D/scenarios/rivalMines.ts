import {
    asteroidBlueprint,
    circularSpeed,
    compileBlueprint,
    majorWell,
    math,
    NEUTRAL_TEAM,
    type Blueprint,
    type Rails,
    type ShipDesign,
    type WellSpec,
} from "../sim/index.js";
import { Rng } from "../sim/rng.js";
import type { Battle } from "./types.js";
import { makeBattle } from "./battle.js";
import { DINKY, REPLICATOR, SALVAGER } from "./blueprints.js";

/**
 * A Salvager that builds its own escort: its one main split in two, either
 * side of a pad astern, which keeps two Dinkies it builds from what it mines.
 * Anchored jaws first, the pad faces away from the rock, so the way in is clear.
 */
export const PROSPECTOR: Blueprint = {
    name: "Prospector",
    notes: "A Salvager that builds its own escort: what it mines goes into the Dinkies its pad astern lays down.",
    ...(SALVAGER.doctrine === undefined ? {} : { doctrine: SALVAGER.doctrine }),
    modules: [
        // Its holds sent out with enough for its first Dinky, before its first load of ore comes in.
        ...SALVAGER.modules!.filter((m) => !("kind" in m && m.kind === "engine" && m.angle === math.PI)).map((m) =>
            "kind" in m && m.kind === "hold" ? { ...m, fill: 0.05 } : m,
        ),
        { kind: "engine", x: -8.5, y: 3.5, angle: math.PI, length: 1, width: 1, nozzle: 0.5 },
        { kind: "engine", x: -8.5, y: -3.5, angle: math.PI, length: 1, width: 1, nozzle: 0.5 },
        { kind: "pad", x: -10.75, y: 0, length: 4.5, width: 4, craft: DINKY.name, keep: 2 },
    ],
    hangar: { [DINKY.name]: DINKY },
};

/** Each major's radius, metres, and its pull at the surface, m/s². */
const MAJOR_RADIUS = 250;
const SURFACE_GRAVITY = 0.5;

/** Two majors, each pulling as a map's would. */
export const RIVAL_WELLS: readonly WellSpec[] = [majorWell(MAJOR_RADIUS, SURFACE_GRAVITY), majorWell(MAJOR_RADIUS, SURFACE_GRAVITY)];

/** 3,200 m apart at the start, at their furthest, closing to 800 m half an orbit later. */
export const RIVAL_RAILS: Rails = {
    root: { pair: [{ well: 0 }, { well: 1 }], orbit: { a: 2000, e: 0.6, periapsis: 0, phase: math.PI } },
};

/** How far out round its major each side's outpost starts, metres. */
const OUTPOST_ORBIT = 600;

/** Both majors as many corners round and rings deep, so neither is the rougher to mine. */
const MAJOR_CORNERS = 10;
const MAJOR_RINGS = 3;

/**
 * Two rival mining outposts, a Replicator on each of a pair of majors on an
 * eccentric mutual orbit, with no minors, which the majors pass too close for
 * any orbit round one to last: each anchors to its own major, mines it, and
 * builds copies of itself from what it mines.
 */
export function rivalMines(seed = 20260905): Battle & { readonly miners: readonly number[]; readonly asteroids: readonly number[] } {
    return makeBattle({ seed, wells: RIVAL_WELLS, rails: RIVAL_RAILS, projectiles: 64, beams: 16 }, (ships, world, wells) => {
        // The asteroids are drawn from a stream of their own, so the battle's seed changes only what happens.
        const rng = new Rng(20261022);
        const asteroids: number[] = [];
        const miners: number[] = [];
        const replicator = compileBlueprint(REPLICATOR);
        /** Something spawned on a circular orbit `d` out round major `k`, at `bearing`, anticlockwise. */
        const orbiting = (k: number, d: number, bearing: number) => {
            const well = wells[k]!;
            const speed = circularSpeed(well.gm, d);
            return {
                x: well.x + d * math.cos(bearing),
                y: well.y + d * math.sin(bearing),
                vx: (well.vx ?? 0) - speed * math.sin(bearing),
                vy: (well.vy ?? 0) + speed * math.cos(bearing),
            };
        };
        const spawn = (design: ShipDesign, k: number, d: number, bearing: number, team: number): number =>
            ships.spawn(world, { design, ...orbiting(k, d, bearing), angle: bearing + math.HALF_PI, team });

        for (let k = 0; k < 2; k++) {
            // Each outpost on the far side of its major from the other.
            const outpost = k === 0 ? math.PI : 0;
            const shape = { radius: MAJOR_RADIUS, kernel: true, ore: 0.35, ice: 0.25, corners: MAJOR_CORNERS, rings: MAJOR_RINGS };
            const major = asteroidBlueprint(`Asteroid ${k + 1}`, shape, rng);
            asteroids.push(
                ships.spawn(world, {
                    design: compileBlueprint(major),
                    rides: wells[k]!,
                    team: NEUTRAL_TEAM,
                    angularVel: k === 0 ? 0.002 : -0.002,
                }),
            );
            miners.push(spawn(replicator, k, OUTPOST_ORBIT, outpost, k));
        }
        return { miners, asteroids };
    });
}
