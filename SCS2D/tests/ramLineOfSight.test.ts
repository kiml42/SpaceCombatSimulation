import { expect, it } from "vitest";
import { asteroidBlueprint, compileBlueprint, DEFAULT_DOCTRINE, NEUTRAL_TEAM, type Blueprint, type ShipDesign } from "../sim/index.js";
import { Rng } from "../sim/rng.js";
import { makeBattle } from "../scenarios/battle.js";
import { GUNSHIP, TORPEDO } from "../scenarios/blueprints.js";
import { WHOLE_SHIP } from "../sim/ships.js";

function rock(): ShipDesign {
    return compileBlueprint(asteroidBlueprint("Rock", { radius: 250, kernel: false, ore: 0.35, ice: 0.25 }, new Rng(5)));
}

/** A torpedo launched at `vx` with `between` on the line to a gunship. */
function charge(between: ShipDesign, vx: number) {
    return makeBattle({ seed: 1 }, (ships, world) => {
        const obstacle = ships.spawn(world, { design: between, x: 0, y: 0, team: NEUTRAL_TEAM });
        const target = ships.spawn(world, { design: compileBlueprint(GUNSHIP), x: 1500, y: 0, team: 1 });
        const torpedo = ships.spawn(world, { design: compileBlueprint(TORPEDO), x: -3000, y: 0, angle: 0, vx, team: 0 });
        return { obstacle, target, torpedo };
    });
}

it.each([0, 300])("rams round a rock dead ahead rather than into it, launched at %i m/s", (vx) => {
    const run = charge(rock(), vx);
    const b = run.world.bodies;
    let closest = Infinity;
    for (let t = 0; t < 40 * 60; t++) {
        run.step();
        const tb = b.indexOf(run.ships.body(run.torpedo));
        const rb = b.indexOf(run.ships.body(run.obstacle));
        closest = Math.min(closest, Math.hypot(b.x[tb]! - b.x[rb]!, b.y[tb]! - b.y[rb]!) - b.radius[rb]!);
    }
    // It used to fly into it from here, and graze it by a few metres from further out.
    expect(closest).toBeGreaterThan(50);
});

it("does not speed up at a friend's hull in the way, unless it is a fighter, which flies over it", () => {
    const speed = (friend: boolean, fighter = false): number => {
        const run = makeBattle({ seed: 1 }, (ships, world) => {
            if (friend) ships.spawn(world, { design: compileBlueprint(GUNSHIP), x: 0, y: 0, team: 0 });
            ships.spawn(world, { design: compileBlueprint(GUNSHIP), x: 3000, y: 0, team: 1 });
            return {
                torpedo: ships.spawn(world, {
                    design: compileBlueprint({ ...TORPEDO, fighter }),
                    x: -3000,
                    y: 0,
                    angle: 0,
                    vx: 100,
                    team: 0,
                }),
            };
        });
        for (let t = 0; t < 5 * 60; t++) run.step();
        const tb = run.world.bodies.indexOf(run.ships.body(run.torpedo));
        return run.world.bodies.vx[tb]!;
    };
    expect(speed(false)).toBeGreaterThan(150);
    expect(speed(true)).toBeLessThan(110);
    expect(speed(true, true)).toBeGreaterThan(150);
});

/** The Torpedo, its doctrine's aim weights set to `weights` (core, engine, gun, structure), and its tanks to `fill`. */
function torpedoWith(weights: readonly [number, number, number, number], fill = 1): Blueprint {
    const [coreWeight, engineWeight, gunWeight, structureWeight] = weights;
    return {
        ...TORPEDO,
        doctrine: {
            approach: { ...DEFAULT_DOCTRINE.approach, ...TORPEDO.doctrine?.approach },
            targeting: {
                ...DEFAULT_DOCTRINE.targeting,
                ...TORPEDO.doctrine?.targeting,
                coreWeight,
                engineWeight,
                gunWeight,
                structureWeight,
            },
        },
        modules: TORPEDO.modules.map((m) => ("kind" in m && m.kind === "tank" ? { ...m, fill } : m)),
    };
}

/** A Torpedo built to `torpedo` 1500 m off a Gunship, closing on it. */
function rammingGunship(torpedo: Blueprint) {
    return makeBattle({ seed: 1 }, (ships, world) => {
        const target = ships.spawn(world, { design: compileBlueprint(GUNSHIP), x: 1500, y: 0, team: 1 });
        return { target, torpedo: ships.spawn(world, { design: compileBlueprint(torpedo), x: -1500, y: 0, angle: 0, team: 0 }) };
    });
}

it("rams the middle in the weapons layer, dropping to the hull layer only just before it strikes", () => {
    // No opinion about parts: the middle of the ship, which is deck.
    const run = rammingGunship(torpedoWith([0, 0, 0, 0]));
    const b = run.world.bodies;
    const window = compileBlueprint(TORPEDO).doctrine.approach.ramCommit;
    let ramming = false;
    let committedAt = Infinity;
    for (let t = 0; t < 60 * 60 && committedAt === Infinity; t++) {
        run.step();
        ramming ||= run.ships.isRamming(run.torpedo);
        if (!run.ships.isCommitted(run.torpedo)) continue;
        const [tb, gb] = [b.indexOf(run.ships.body(run.torpedo)), b.indexOf(run.ships.body(run.target))];
        const dx = b.x[gb]! - b.x[tb]!;
        const dy = b.y[gb]! - b.y[tb]!;
        const range = Math.hypot(dx, dy);
        const gap = range - b.radius[gb]! - b.radius[tb]!;
        const closing = ((b.vx[tb]! - b.vx[gb]!) * dx + (b.vy[tb]! - b.vy[gb]!) * dy) / range;
        committedAt = gap / closing;
    }
    expect(ramming).toBe(true);
    expect(committedAt).toBeLessThanOrEqual(window);
    expect(committedAt).toBeGreaterThan(window / 2);
});

it("rams a gun standing up out of the deck from the weapons layer, never dropping to the deck", () => {
    const run = rammingGunship(torpedoWith([0, 0, 100, 0]));
    let aimed = false;
    for (let t = 0; t < 60 * 60 && run.ships.isAlive(run.torpedo); t++) {
        run.step();
        if (!run.ships.isAlive(run.torpedo)) break;
        aimed ||= run.ships.ramPart[run.torpedo]! >= 0;
        expect(run.ships.isCommitted(run.torpedo)).toBe(false);
    }
    expect(aimed).toBe(true);
});

it("goes for the whole ship instead once too low on fuel to come round for a miss", () => {
    const part = (fill: number): number => {
        const run = rammingGunship(torpedoWith([0, 0, 100, 50], fill));
        for (let t = 0; t < 120; t++) run.step();
        return run.ships.ramPart[run.torpedo]!;
    };
    expect(part(1)).toBeGreaterThanOrEqual(0);
    expect(part(0.1)).toBe(WHOLE_SHIP);
});
