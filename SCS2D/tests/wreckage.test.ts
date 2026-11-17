import { describe, expect, it, vi } from "vitest";
import {
    compileBlueprint,
    joints,
    Projectiles,
    ROUND_SHRAPNEL,
    ROUND_WRECKAGE,
    Ships,
    throwShrapnel,
    throwWreckage,
    World,
    type Blueprint,
    type ProjectileSpec,
} from "../sim/index.js";
import { makeBattle } from "../scenarios/battle.js";
import { CORVETTE, TORPEDO } from "../scenarios/blueprints.js";

/** A Torpedo with its tanks dry, so it coasts rather than steering. */
const DRY: Blueprint = {
    ...TORPEDO,
    modules: TORPEDO.modules.map((m) => ("kind" in m && (m.kind === "tank" || m.kind === "core") ? { ...m, fill: 0 } : m)),
};

/** The same, not a fighter: a hull it meets is met as hulls meet, rather than rammed as rounds. */
const HULL: Blueprint = { ...DRY, fighter: false };

/** A still Corvette, and a dry Torpedo (or `design`) 60 m off its side closing at `speed`. */
function ram(speed: number, design: Blueprint = DRY) {
    const run = makeBattle({ seed: 1 }, (ships, world) => {
        const corvette = ships.spawn(world, { design: compileBlueprint(CORVETTE), x: 0, y: 0, angle: 0, team: 1 });
        const torpedo = ships.spawn(world, { design: compileBlueprint(design), x: 0, y: -60, angle: Math.PI / 2, vy: speed, team: 0 });
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
        const { run, torpedoBody } = ram(300, HULL);
        const thrown = untilWreckage(run).filter((f) => f.owner === torpedoBody);
        expect(thrown.length).toBeGreaterThan(1);
        expect(new Set(thrown.map((f) => f.mass)).size).toBe(thrown.length);
        // Into the corvette's side, which is up the screen from where the torpedo came.
        for (const f of thrown) expect(f.vy).toBeGreaterThan(100);
    });

    it("carries no more energy against what it struck than the crush could not spend", () => {
        const { run, torpedoBody } = ram(300, HULL);
        const thrown = untilWreckage(run).filter((f) => f.owner === torpedoBody);
        const c = run.collisions.contacts;
        let spare = 0;
        for (let k = 0; k < c.count; k++) spare += c.a[k] === torpedoBody ? c.spareA[k]! : c.b[k] === torpedoBody ? c.spareB[k]! : 0;
        const energy = thrown.reduce((e, f) => e + 0.5 * f.mass * (f.vx ** 2 + f.vy ** 2), 0);
        expect(energy).toBeGreaterThan(0);
        expect(energy).toBeLessThanOrEqual(spare);
    });

    it("throws nothing from a blow too soft to shatter anything", () => {
        const { run } = ram(10, HULL);
        expect(untilWreckage(run, 600)).toHaveLength(0);
    });

    it("throws nothing from a module shattered by anything but a collision", () => {
        const { run, torpedoBody } = ram(0, HULL);
        const nose = 0;
        run.ships.damage.absorb(torpedoBody, nose, 10 * run.ships.damage.capacityOf(torpedoBody, nose));
        expect(throwWreckage(run.ships, run.world.bodies, run.projectiles, run.collisions.contacts, run.world.rng)).toBe(0);
    });
});

/** A core with a plate on its end under the 2 t a piece is kept at, under way and turning. */
const ARM = compileBlueprint({
    name: "Arm",
    modules: [
        { kind: "core", x: -4, y: 0, length: 4, width: 4 },
        { kind: "structure", x: -1.7, y: 0, length: 0.6, width: 0.6 },
    ],
});

describe("a piece broken off too small to keep", () => {
    /** The arm with its plate's weld cut and severed, and what it threw; with the world's momentum before and after. */
    const breakOff = () => {
        const world = new World({ dt: 1 / 60, seed: 3 });
        const ships = new Ships();
        const ship = ships.spawn(world, { design: ARM, x: 0, y: 0, vx: 50, vy: -20, angularVel: 0.5, team: 0 });
        const body = world.bodies.indexOf(ships.body(ship));
        const momentum = (projectiles?: Projectiles): { x: number; y: number } => {
            const b = world.bodies;
            let x = ships.discardedPx;
            let y = ships.discardedPy;
            for (let i = 0; i < b.highWater; i++) {
                if (b.alive[i] === 0) continue;
                x += b.mass[i]! * b.vx[i]!;
                y += b.mass[i]! * b.vy[i]!;
            }
            for (let i = 0; projectiles !== undefined && i < projectiles.highWater; i++) {
                if (projectiles.alive[i] === 0) continue;
                x += projectiles.mass[i]! * projectiles.vx[i]!;
                y += projectiles.mass[i]! * projectiles.vy[i]!;
            }
            return { x, y };
        };
        const before = momentum();
        const all = joints(ships.currentStructure(ship));
        ships.damage.cutWeld(body, 0, all[0]!.width);
        ships.sever(world);
        const projectiles = new Projectiles(16);
        const thrown = throwShrapnel(ships, projectiles);
        return { ships, body, projectiles, thrown, before, after: momentum(projectiles) };
    };

    it("flies on as shrapnel, through the hull it came off", () => {
        const { projectiles, thrown, body } = breakOff();
        expect(thrown).toBe(1);
        const i = Array.from({ length: projectiles.highWater }, (_, k) => k).find((k) => projectiles.alive[k] === 1)!;
        expect(projectiles.kind[i]).toBe(ROUND_SHRAPNEL);
        expect(projectiles.owner[i]).toBe(body);
        expect(projectiles.mass[i]).toBeGreaterThan(0);
    });

    it("keeps the momentum it broke off with, and is not counted discarded as well", () => {
        const { before, after, ships } = breakOff();
        expect(after.x).toBeCloseTo(before.x, 6);
        expect(after.y).toBeCloseTo(before.y, 6);
        expect(ships.discarded).toBeCloseTo(0, 6);
    });

    it("is thrown once", () => {
        const { ships, projectiles } = breakOff();
        expect(throwShrapnel(ships, projectiles)).toBe(0);
    });
});

describe("a fighter committed to a ram, meeting a hull hard", () => {
    /** Step `run` until the torpedo is spent, or `limit` steps pass, keeping it committed; the rounds it became. */
    const untilSpent = (run: ReturnType<typeof ram>["run"], limit = 120): ProjectileSpec[] => {
        const rounds: ProjectileSpec[] = [];
        const spawn = run.projectiles.spawn.bind(run.projectiles);
        vi.spyOn(run.projectiles, "spawn").mockImplementation((spec: ProjectileSpec) => {
            if (spec.kind === ROUND_WRECKAGE && spec.owner === undefined) rounds.push(spec);
            return spawn(spec);
        });
        for (let t = 0; t < limit && rounds.length === 0; t++) {
            if (run.ships.isAlive(run.torpedo)) (run.ships.committed as number[])[run.torpedo] = 1;
            run.step();
        }
        return rounds;
    };

    it("is spent on it as rounds that carry its mass and momentum, credited to it", () => {
        const { run, torpedoBody } = ram(150);
        const mass = run.world.bodies.mass[torpedoBody]!;
        const rounds = untilSpent(run);
        expect(run.ships.isAlive(run.torpedo)).toBe(false);
        expect(rounds.length).toBe(compileBlueprint(DRY).modules.length);
        expect(rounds.reduce((m, r) => m + r.mass!, 0)).toBeCloseTo(mass, 6);
        // Still going into the corvette's side, which is up the screen.
        expect(rounds.reduce((p, r) => p + r.mass! * r.vy, 0) / mass).toBeGreaterThan(140);
        for (const r of rounds) expect(r.ship).toBe(run.torpedo);
    });

    it("deals what its rounds do to its own account, though it is gone", () => {
        const { run } = ram(150);
        untilSpent(run);
        let dealt = 0;
        for (let t = 0; t < 30; t++) {
            run.step();
            for (let h = 0; h < run.credit.count; h++)
                if (run.ships.attackerOf(run.credit, h) === run.torpedo) dealt += run.credit.energy[h]!;
        }
        expect(dealt).toBeGreaterThan(0);
    });

    it("is not spent by a slow contact", () => {
        const { run } = ram(10);
        expect(untilSpent(run, 600)).toHaveLength(0);
        expect(run.ships.isAlive(run.torpedo)).toBe(true);
    });

    it("is not spent unless committed", () => {
        const { run } = ram(150);
        for (let t = 0; t < 120; t++) run.step();
        expect(run.ships.isAlive(run.torpedo)).toBe(true);
    });
});
