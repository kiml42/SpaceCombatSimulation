import { describe, expect, it, vi } from "vitest";
import { compileBlueprint, ROUND_WRECKAGE, throwWreckage, type Blueprint, type ProjectileSpec } from "../sim/index.js";
import { makeBattle } from "../scenarios/battle.js";
import { CORVETTE, TORPEDO } from "../scenarios/blueprints.js";

/** A Torpedo with its tanks dry, so it coasts rather than steering. */
const DRY: Blueprint = {
    ...TORPEDO,
    modules: TORPEDO.modules.map((m) => ("kind" in m && (m.kind === "tank" || m.kind === "core") ? { ...m, fill: 0 } : m)),
};

/** A still Corvette, and a dry Torpedo 60 m off its side closing at `speed`, committed so it meets the deck. */
function ram(speed: number) {
    const run = makeBattle({ seed: 1 }, (ships, world) => {
        const corvette = ships.spawn(world, { design: compileBlueprint(CORVETTE), x: 0, y: 0, angle: 0, team: 1 });
        const torpedo = ships.spawn(world, { design: compileBlueprint(DRY), x: 0, y: -60, angle: Math.PI / 2, vy: speed, team: 0 });
        return { corvette, torpedo };
    });
    const torpedoBody = run.world.bodies.indexOf(run.ships.body(run.torpedo));
    return { run, torpedoBody };
}

interface Fragment {
    readonly mass: number;
    /** Its velocity against the corvette's as it was thrown. */
    readonly vx: number;
    readonly vy: number;
    readonly owner: number;
}

/**
 * Step `run` until wreckage is thrown, or `limit` steps pass, keeping the torpedo committed; what was thrown in
 * that step, as it was thrown. Read as it is spawned: at speed it can strike, and stop, in the step it is thrown.
 */
function untilWreckage(run: ReturnType<typeof ram>["run"], limit = 120): Fragment[] {
    const thrown: Fragment[] = [];
    const bodies = run.world.bodies;
    const spawn = run.projectiles.spawn.bind(run.projectiles);
    vi.spyOn(run.projectiles, "spawn").mockImplementation((spec: ProjectileSpec) => {
        const c = bodies.indexOf(run.ships.body(run.corvette));
        if (spec.kind === ROUND_WRECKAGE) {
            thrown.push({ mass: spec.mass!, vx: spec.vx - bodies.vx[c]!, vy: spec.vy - bodies.vy[c]!, owner: spec.owner! });
        }
        return spawn(spec);
    });
    for (let t = 0; t < limit && thrown.length === 0; t++) {
        (run.ships.committed as number[])[1] = 1;
        run.step();
    }
    return thrown;
}

describe("a module shattered in a collision", () => {
    it("flies on as fragments of mixed sizes, still going into what it struck", () => {
        const { run, torpedoBody } = ram(300);
        const thrown = untilWreckage(run).filter((f) => f.owner === torpedoBody);
        expect(thrown.length).toBeGreaterThan(1);
        expect(new Set(thrown.map((f) => f.mass)).size).toBe(thrown.length);
        // Into the corvette's side, which is up the screen from where the torpedo came.
        for (const f of thrown) expect(f.vy).toBeGreaterThan(100);
    });

    it("carries no more energy against what it struck than the crush could not spend", () => {
        const { run, torpedoBody } = ram(300);
        const thrown = untilWreckage(run).filter((f) => f.owner === torpedoBody);
        const c = run.collisions.contacts;
        let spare = 0;
        for (let k = 0; k < c.count; k++) spare += c.a[k] === torpedoBody ? c.spareA[k]! : c.b[k] === torpedoBody ? c.spareB[k]! : 0;
        const energy = thrown.reduce((e, f) => e + 0.5 * f.mass * (f.vx ** 2 + f.vy ** 2), 0);
        expect(energy).toBeGreaterThan(0);
        expect(energy).toBeLessThanOrEqual(spare);
    });

    it("throws nothing from a blow too soft to shatter anything", () => {
        const { run } = ram(10);
        expect(untilWreckage(run, 600)).toHaveLength(0);
    });

    it("throws nothing from a module shattered by anything but a collision", () => {
        const { run, torpedoBody } = ram(0);
        const nose = 0;
        run.ships.damage.absorb(torpedoBody, nose, 10 * run.ships.damage.capacityOf(torpedoBody, nose));
        expect(throwWreckage(run.ships, run.world.bodies, run.projectiles, run.collisions.contacts, run.world.rng)).toBe(0);
    });
});
