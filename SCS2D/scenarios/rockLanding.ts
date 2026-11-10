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
        const shape = { radius: ROCK_RADIUS, kernel: true, ore: 0.35, ice: 0.25, corners: 10, rings: 3 };
        const rockDesign = compileBlueprint(asteroidBlueprint("Asteroid", shape, new Rng(20261022)));
        // Unbreakable, so its Replicators keep hold with no robots to mine it, and nothing the fighters hit chips it.
        const rock = ships.spawn(world, { design: rockDesign, rides: well, team: NEUTRAL_TEAM, invulnerable: true });
        const rb = bodies.indexOf(ships.body(rock));

        // How far out the rock's surface is along `bearing`, from its middle: stepping in until inside one of its modules.
        const corners: number[] = [];
        const solid = (x: number, y: number): boolean =>
            rockDesign.modules.some((m) => {
                const count = moduleOutline(m.spec, corners);
                // Its outline is in the blueprint's frame, `x`, `y` from the middle of its mass.
                return insideOutline(corners, count, x + rockDesign.centreOfMassX, y + rockDesign.centreOfMassY);
            });
        const surface = (bearing: number): number => {
            const a = bearing - bodies.angle[rb]!;
            let r = 2 * ROCK_RADIUS;
            while (r > 0 && !solid(r * math.cos(a), r * math.sin(a))) r -= 0.25;
            return r;
        };

        const outpost = compileBlueprint(OUTPOST);
        const claw = outpost.modules.findIndex((m) => m.spec.kind === "claw");
        const jaws = outpost.modules[claw]!;
        // Its claws' tips, ahead of its middle: bow down on the rock, they meet the surface.
        const tip = jaws.x + jaws.spec.length / 2;
        const outposts: number[] = [];
        for (let k = 0; k < OUTPOSTS; k++) {
            const bearing = (k * 2 * math.PI) / OUTPOSTS;
            const ux = math.cos(bearing);
            const uy = math.sin(bearing);
            const gx = bodies.x[rb]! + ux * surface(bearing);
            const gy = bodies.y[rb]! + uy * surface(bearing);
            const o = ships.spawn(world, { design: outpost, x: gx + ux * tip, y: gy + uy * tip, angle: bearing + math.PI, team: 0 });
            moor(ships, bodies, o, rock, claw, gx, gy);
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
