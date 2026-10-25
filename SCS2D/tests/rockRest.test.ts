import { describe, expect, it } from "vitest";
import { asteroidBlueprint, compileBlueprint, majorWell, NEUTRAL_TEAM, type Blueprint } from "../sim/index.js";
import { Rng } from "../sim/rng.js";
import { makeBattle } from "../scenarios/battle.js";

/** Rival Mines' first major: 250 m, ten corners round and three rings deep, turning slowly in a 0.5 m/s² well. */
const SPIN = 0.002;

/** `wreck` let go 25 m above the major's surface at `bearing`, turning with it. */
function dropped(wreck: Blueprint, bearing: number) {
    return makeBattle({ seed: 1, wells: [majorWell(250, 0.5)] }, (ships, world, wells) => {
        const shape = { radius: 250, kernel: true, ore: 0.35, ice: 0.25, corners: 10, rings: 3 };
        const major = ships.spawn(world, {
            design: compileBlueprint(asteroidBlueprint("Major", shape, new Rng(20261022))),
            rides: wells[0]!,
            team: NEUTRAL_TEAM,
            angularVel: SPIN,
        });
        const x = 275 * Math.cos(bearing);
        const y = 275 * Math.sin(bearing);
        return {
            major,
            wreck: ships.spawn(world, { design: compileBlueprint(wreck), x, y, vx: -SPIN * y, vy: SPIN * x, angle: bearing, team: 0 }),
        };
    });
}

/** Where the wreck is on the major, in its turning frame: how far out, the bearing, and how fast it slides across its surface. */
function onMajor(run: ReturnType<typeof dropped>) {
    const b = run.world.bodies;
    const w = b.indexOf(run.ships.body(run.wreck));
    const a = b.indexOf(run.ships.body(run.major));
    const dx = b.x[w]! - b.x[a]!;
    const dy = b.y[w]! - b.y[a]!;
    const r = Math.hypot(dx, dy);
    const vx = b.vx[w]! - (b.vx[a]! - b.angularVel[a]! * dy);
    const vy = b.vy[w]! - (b.vy[a]! + b.angularVel[a]! * dx);
    return { r, bearing: Math.atan2(dy, dx) - b.angle[a]!, sliding: (-vx * dy + vy * dx) / r };
}

describe("wreckage at rest on a major", () => {
    it("turns with it, rather than sliding to and fro across a facet", () => {
        const plate: Blueprint = {
            name: "Plate",
            modules: [
                { kind: "structure", x: 0, y: 0, length: 6, width: 3 },
                { kind: "core", x: 4, y: 0, length: 2, width: 2 },
            ],
        };
        const run = dropped(plate, 0.3);
        for (let t = 0; t < 60 * 60; t++) run.step();
        const settled = onMajor(run);
        let fastest = 0;
        // Frictionless, it swung across the facet at up to 1.2 m/s, two minutes a swing.
        for (let t = 0; t < 120 * 60; t++) {
            run.step();
            fastest = Math.max(fastest, Math.abs(onMajor(run).sliding));
        }
        expect(fastest).toBeLessThan(0.02);
        expect(Math.abs(onMajor(run).bearing - settled.bearing) * settled.r).toBeLessThan(0.5);
    });

    it("does not sink through rock when it is thinner than rock gives", () => {
        // 80 cm across, against a metre of give: it sank in whole and fell through every ring to the kernel.
        const bit: Blueprint = { name: "Bit", modules: [{ kind: "core", x: 0, y: 0, length: 0.8, width: 0.8 }] };
        const run = dropped(bit, 0.3);
        let deepest = Infinity;
        for (let t = 0; t < 300 * 60; t++) {
            run.step();
            if (t > 60 * 60) deepest = Math.min(deepest, onMajor(run).r);
        }
        // Resting on the outer ring's face, about 238 m out there.
        expect(deepest).toBeGreaterThan(236);
        expect(run.collisions.contacts.count).toBe(1);
        expect(run.collisions.contacts.depth[0]!).toBeLessThanOrEqual(0.45);
    });
});
