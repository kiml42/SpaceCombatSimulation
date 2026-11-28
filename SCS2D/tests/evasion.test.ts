import { describe, expect, it } from "vitest";
import { compileBlueprint, DEFAULT_DOCTRINE, type Blueprint } from "../sim/index.js";
import { makeBattle } from "../scenarios/battle.js";
import { GUNSHIP } from "../scenarios/blueprints.js";

/** A Gunship jinking at `evasion` m/s, or evading to points `evasionRadii` round, `range` from another that shoots at it. */
function scene(evasion: number, range = 2000, evasionRadii = 0, seed = 3) {
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

/** Each step's jink of the evading Gunship, for `seconds`. */
function jinks(evasion: number, seconds: number): number[] {
    const run = scene(evasion);
    const jink = (run.ships as unknown as { jink: readonly number[] }).jink;
    const out: number[] = [];
    for (let s = 0; s < seconds * 60; s++) {
        run.step();
        out.push(jink[run.c]!);
    }
    return out;
}

describe("evasive manoeuvres", () => {
    it("jinks either way, up to its evasion, and changes its jink from time to time", () => {
        const seen = jinks(30, 40).filter((v) => v !== 0);
        expect(seen.length).toBeGreaterThan(0);
        for (const v of seen) expect(Math.abs(v)).toBeLessThanOrEqual(30);
        expect(new Set(seen).size).toBeGreaterThan(1);
        expect(seen.some((v) => v > 0) && seen.some((v) => v < 0)).toBe(true);
        // Held a while rather than redrawn every step.
        expect(new Set(seen).size).toBeLessThan(seen.length / 10);
    });

    it("flies straight with no evasion", () => {
        expect(jinks(0, 10).every((v) => v === 0)).toBe(true);
    });

    it("evades to points round the gun aimed at it, either side, at its range from it", () => {
        // A seed in which it lives long enough to draw several.
        const run = scene(30, 2000, 1, 1);
        const ships = run.ships as unknown as {
            evadeX: readonly number[];
            evadeY: readonly number[];
            evadeArc: readonly number[];
            jink: readonly number[];
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
            expect(Math.abs(ships.jink[run.c]!)).toBeLessThanOrEqual(30);
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

    it("draws no evasion point while jinking at a speed", () => {
        const run = scene(30);
        const evadeX = (run.ships as unknown as { evadeX: readonly number[] }).evadeX;
        for (let s = 0; s < 20 * 60; s++) {
            run.step();
            expect(Number.isNaN(evadeX[run.c]!)).toBe(true);
        }
    });
});
