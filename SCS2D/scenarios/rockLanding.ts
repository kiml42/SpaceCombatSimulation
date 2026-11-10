import { asteroidBlueprint, circularSpeed, compileBlueprint, majorWell, math, NEUTRAL_TEAM, type Blueprint } from "../sim/index.js";
import { moor } from "../sim/shipForage.js";
import { moduleOutline } from "../sim/modules.js";
import { insideOutline } from "../sim/shape.js";
import { Rng } from "../sim/rng.js";
import type { Battle } from "./types.js";
import { makeBattle } from "./battle.js";
import { REPLICATOR } from "./blueprints.js";
import { CRIPPLINGS, cripple, crippledDesign, editModules, emptyPads, type Crippling } from "./crippledLanding.js";

/**
 * Fighters coming home to carriers moored round one asteroid, under its pull:
 * Replicators anchored by their claws to different sides of the same rock,
 * as Rival Mines leaves them, and a Dinky Raider low on fuel for each pad,
 * damaged as the variant says.
 */

/** The rock's radius, metres, and its pull at the surface, m/s², as Rival Mines' majors. */
const ROCK_RADIUS = 250;
const SURFACE_GRAVITY = 0.5;
/** How many Replicators are moored round it, evenly. */
const OUTPOSTS = 4;
/** How far out each fighter starts, on a circular orbit, metres. */
const START = 700;
/**
 * A Replicator doing nothing but take fighters in: its pads empty and building
 * nothing, its slipway building nothing, and its robot bays plain structure of
 * the same size, so no robots mine the rock or tend the hull. All three cost
 * time every step and change the scene as it goes, and none bears on landing.
 */
const OUTPOST: Blueprint = editModules(emptyPads(REPLICATOR), ({ robotsPerBerth: _, ...m }) =>
    m.kind === "slipway" ? { ...m, keep: 0 } : m.kind === "robotBay" ? { ...m, kind: "structure" } : m,
);

/** The Raider cripplings, and one undamaged to compare them with: the fighter a Replicator builds. */
export const ROCK_CRIPPLINGS: readonly Crippling[] = [
    { ...CRIPPLINGS[0]!, name: "Raider, undamaged", lost: [] },
    ...CRIPPLINGS.filter((c) => c.fighter === CRIPPLINGS[0]!.fighter),
];

export type RockLanding = Battle & { readonly rock: number; readonly outposts: readonly number[]; readonly fighters: readonly number[] };

export function rockLanding(seed = 20260905, crippling: Crippling = ROCK_CRIPPLINGS[0]!): RockLanding {
    return makeBattle({ seed, wells: [majorWell(ROCK_RADIUS, SURFACE_GRAVITY)] }, (ships, world, wells) => {
        const well = wells[0]!;
        const bodies = world.bodies;
        const shape = { radius: ROCK_RADIUS, kernel: true, ore: 0.35, ice: 0.25, corners: 12, rings: 3, ragged: false };
        const rockDesign = compileBlueprint(asteroidBlueprint("Asteroid", shape, new Rng(20261022)));
        // Unbreakable, so its Replicators keep hold with no robots to mine it, and nothing the fighters hit chips it.
        const rock = ships.spawn(world, { design: rockDesign, rides: well, team: NEUTRAL_TEAM, invulnerable: true });
        const rb = bodies.indexOf(ships.body(rock));

        // Whether a point of the rock's frame, from the middle of its mass, is inside one of its modules.
        const corners: number[] = [];
        const solid = (x: number, y: number): boolean =>
            rockDesign.modules.some((m) => {
                const count = moduleOutline(m.spec, corners);
                // Its outline is in the blueprint's frame.
                return insideOutline(corners, count, x + rockDesign.centreOfMassX, y + rockDesign.centreOfMassY);
            });
        /** How far out the rock's surface is along `bearing`, `across` to its left: stepping in until inside it, or 0 for a line that misses it. */
        const surface = (bearing: number, across: number): number => {
            const a = bearing - bodies.angle[rb]!;
            const ux = math.cos(a);
            const uy = math.sin(a);
            const inside = (r: number): boolean => solid(r * ux - across * uy, r * uy + across * ux);
            // In from beyond its furthest reach a metre at a time, then back out to the nearest centimetre or so.
            let r = 1.5 * ROCK_RADIUS;
            while (r > 0 && !inside(r)) r -= 1;
            if (r <= 0) return 0;
            for (let step = 0.5; step > 0.01; step /= 2) if (inside(r + step)) r += step;
            return r;
        };

        const outpost = compileBlueprint(OUTPOST);
        const claw = outpost.modules.findIndex((m) => m.spec.kind === "claw");
        // Its outline, every metre or so along each module's edges, in its own frame from the middle of its mass, bow along +x.
        const hull: number[] = [];
        for (const m of outpost.modules) {
            const count = moduleOutline(m.spec, corners);
            for (let c = 0; c < count; c++) {
                const ax = corners[c * 2]! - outpost.centreOfMassX;
                const ay = corners[c * 2 + 1]! - outpost.centreOfMassY;
                const bx = corners[((c + 1) % count) * 2]! - outpost.centreOfMassX;
                const by = corners[((c + 1) % count) * 2 + 1]! - outpost.centreOfMassY;
                const steps = math.max(1, math.ceil(math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay))));
                for (let t = 0; t < steps; t++) hull.push(ax + ((bx - ax) * t) / steps, ay + ((by - ay) * t) / steps);
            }
        }
        const outposts: number[] = [];
        for (let k = 0; k < OUTPOSTS; k++) {
            const bearing = (k * 2 * math.PI) / OUTPOSTS;
            const ux = math.cos(bearing);
            const uy = math.sin(bearing);
            // Bow down on the rock, as near as it comes with nothing of it inside the rock: each point of its hull is
            // `along` further out than its middle and `across` to the left looking out.
            const angle = bearing + math.PI;
            const c = math.cos(angle);
            const sn = math.sin(angle);
            let out = 0;
            for (let h = 0; h < hull.length; h += 2) {
                const wx = hull[h]! * c - hull[h + 1]! * sn;
                const wy = hull[h]! * sn + hull[h + 1]! * c;
                out = math.max(out, surface(bearing, -wx * uy + wy * ux) - (wx * ux + wy * uy));
            }
            const o = ships.spawn(world, { design: outpost, x: bodies.x[rb]! + ux * out, y: bodies.y[rb]! + uy * out, angle, team: 0 });
            // Its claw grips the rock where its line meets the surface.
            const grip = surface(bearing, 0);
            moor(ships, bodies, o, rock, claw, bodies.x[rb]! + ux * grip, bodies.y[rb]! + uy * grip);
            outposts.push(o);
        }

        // A fighter for every pad, each coming in from its own place round the rock.
        const fighter = crippledDesign(crippling);
        const fighters: number[] = [];
        const count = OUTPOSTS * outpost.modules.filter((m) => m.spec.kind === "pad").length;
        for (let k = 0; k < count; k++) {
            const bearing = ((k + 0.5) * 2 * math.PI) / count;
            const speed = circularSpeed(well.gm, START);
            const f = ships.spawn(world, {
                design: fighter,
                x: well.x + START * math.cos(bearing),
                y: well.y + START * math.sin(bearing),
                vx: -speed * math.sin(bearing),
                vy: speed * math.cos(bearing),
                angle: bearing + math.HALF_PI,
                team: 0,
            });
            cripple(ships, world, f, crippling);
            fighters.push(f);
        }
        return { rock, outposts, fighters };
    });
}
