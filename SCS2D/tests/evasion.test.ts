import { describe, expect, it } from "vitest";
import { compileBlueprint, DEFAULT_DOCTRINE, type Blueprint } from "../sim/index.js";
import { makeBattle } from "../scenarios/battle.js";
import { GUNSHIP } from "../scenarios/blueprints.js";

/** A Gunship evading at up to `evasion` m/s, to points `evasionRadii` round, `range` from another that shoots at it. */
function scene(evasion: number, range = 2000, evasionRadii = 1, seed = 3) {
    const evading: Blueprint = {
        ...GUNSHIP,
        doctrine: {
            targeting: { ...DEFAULT_DOCTRINE.targeting, ...GUNSHIP.doctrine?.targeting },
            approach: { ...DEFAULT_DOCTRINE.approach, ...GUNSHIP.doctrine?.approach, evasion, evasionRadii },
        },
    };
    return makeBattle({ seed }, (ships, world) => {
        const c = ships.spawn(world, { design: compileBlueprint(evading), x: 0, y: 0, team: 0 });
        const d = ships.spawn(world, { design: compileBlueprint(GUNSHIP), x: range, y: 0, angle: Math.PI, team: 1 });
        return { c, d };
    });
}

describe("evasive manoeuvres", () => {
    it("flies straight with no evasion", () => {
        const run = scene(0);
        const ships = run.ships as unknown as { evadeX: readonly number[]; evadeSpeed: readonly number[] };
        for (let s = 0; s < 10 * 60; s++) {
            run.step();
            expect(ships.evadeSpeed[run.c]).toBe(0);
            expect(Number.isNaN(ships.evadeX[run.c]!)).toBe(true);
        }
    });

    it("evades to points round the gun aimed at it, either side, at its range from it", () => {
        // A seed in which it lives long enough to draw several.
        const run = scene(30, 2000, 1, 1);
        const ships = run.ships as unknown as {
            evadeX: readonly number[];
            evadeY: readonly number[];
            evadeArc: readonly number[];
            evadeSpeed: readonly number[];
        };
        const bodies = run.world.bodies;
        const sides = new Set<number>();
        let seen = 0;
        for (let s = 0; s < 60 * 60; s++) {
            run.step();
            const x = ships.evadeX[run.c]!;
            if (Number.isNaN(x)) continue;
            seen++;
            const b = bodies.indexOf(run.ships.body(run.c));
            const e = bodies.indexOf(run.ships.body(run.d));
            const range = Math.hypot(bodies.x[b]! - bodies.x[e]!, bodies.y[b]! - bodies.y[e]!);
            const pointRange = Math.hypot(x - bodies.x[e]!, ships.evadeY[run.c]! - bodies.y[e]!);
            // Drawn before the step moved them both.
            expect(Math.abs(pointRange - range)).toBeLessThan(2);
            // Drawn no further round than one and a half of its radii, and no faster than its evasion.
            expect(Math.abs(ships.evadeArc[run.c]!)).toBeLessThanOrEqual(1.5 * bodies.radius[b]!);
            expect(Math.abs(ships.evadeSpeed[run.c]!)).toBeLessThanOrEqual(30);
            // Which way round from the line of fire it lies.
            sides.add(
                Math.sign(
                    (bodies.x[b]! - bodies.x[e]!) * (ships.evadeY[run.c]! - bodies.y[e]!) -
                        (bodies.y[b]! - bodies.y[e]!) * (x - bodies.x[e]!),
                ),
            );
        }
        expect(seen).toBeGreaterThan(0);
        expect(sides.has(1) && sides.has(-1)).toBe(true);
    });

    it("evades a quarter of its radii round at least, whatever its doctrine says", () => {
        const run = scene(30, 2000, 0, 1);
        const arcs = (run.ships as unknown as { evadeArc: readonly number[] }).evadeArc;
        const radius = run.world.bodies.radius[run.world.bodies.indexOf(run.ships.body(run.c))]!;
        let drawn = 0;
        for (let s = 0; s < 20 * 60; s++) {
            run.step();
            if (arcs[run.c] === 0) continue;
            drawn++;
            // Half to one and a half of the quarter.
            expect(Math.abs(arcs[run.c]!)).toBeGreaterThanOrEqual(0.125 * radius);
            expect(Math.abs(arcs[run.c]!)).toBeLessThanOrEqual(0.375 * radius);
        }
        expect(drawn).toBeGreaterThan(0);
    });
});
