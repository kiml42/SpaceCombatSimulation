import { describe, expect, it } from "vitest";
import { compileBlueprint, type Blueprint } from "../sim/index.js";
import { makeBattle } from "../scenarios/battle.js";
import type { Battle } from "../scenarios/types.js";
import { BARE_CORE, CORVETTE, DINKY } from "../scenarios/blueprints.js";
import { FACTORY } from "../scenarios/carrier.js";
import { QUARRY } from "./fixtures/quarry.js";

/** A fighter on a pad keeps its own body, pinned to the pad, and weighs on its carrier. */

/** A carrier whose bow pad sets out with a Dinky docked on it. */
const LADEN: Blueprint = {
    name: "Carrier",
    modules: [
        { kind: "core", x: 0, y: 0, length: 6, width: 6 },
        { kind: "tank", x: -13, y: 0, length: 20, width: 10 },
        { kind: "pad", x: 13, y: 0, length: 20, width: 20, craft: DINKY.name, docked: true },
    ],
    hangar: { [DINKY.name]: DINKY },
};

/** The laden carrier, moving, and something to fight `range` off: far enough by default that its fighter waits aboard. */
function scene(range = 5000): Battle & { c: number; f: number } {
    return makeBattle({ seed: 3 }, (ships, world) => {
        const c = ships.spawn(world, { design: compileBlueprint(LADEN), x: 0, y: 0, angle: 0, vx: 5, vy: -2, angularVel: 0.05 });
        ships.spawn(world, { design: QUARRY, x: range, y: 0, team: 1 });
        return { c, f: c + 1 };
    });
}

const index = (run: Battle, i: number): number => run.world.bodies.indexOf(run.ships.body(i));

describe("a fighter parked on a pad", () => {
    it("rides the pad on a body of its own, and the carrier carries its weight", () => {
        const run = scene();
        for (let s = 0; s < 120; s++) run.step();
        expect(run.ships.parkedCarrier(run.f)).toBe(run.c);
        const bodies = run.world.bodies;
        const cb = index(run, run.c);
        const fb = index(run, run.f);
        expect(fb).not.toBe(cb);
        // Turning with the carrier, and where it was put down on the pad.
        expect(bodies.angularVel[fb]).toBeCloseTo(bodies.angularVel[cb]!, 9);
        expect(bodies.angle[fb]).toBeCloseTo(bodies.angle[cb]!, 9);
        const carrier = compileBlueprint({ ...LADEN, modules: LADEN.modules.map((m) => ({ ...m, docked: false })) });
        expect(bodies.mass[cb]! - bodies.mass[fb]!).toBeCloseTo(carrier.mass, 6);
        expect(run.totalContacts).toBe(0);
    });

    it("leaves with its share of the momentum the two had between them", () => {
        const run = scene(1000);
        const bodies = run.world.bodies;
        let before = [0, 0];
        for (let s = 0; s < 600 && run.ships.parkedCarrier(run.f) === run.c; s++) {
            const cb = index(run, run.c);
            before = [bodies.mass[cb]! * bodies.vx[cb]!, bodies.mass[cb]! * bodies.vy[cb]!];
            run.step();
        }
        expect(run.ships.parkedCarrier(run.f)).toBe(-1);
        const cb = index(run, run.c);
        const fb = index(run, run.f);
        // Let go in the step just taken, before its engines could light.
        const px = bodies.mass[cb]! * bodies.vx[cb]! + bodies.mass[fb]! * bodies.vx[fb]!;
        const py = bodies.mass[cb]! * bodies.vy[cb]! + bodies.mass[fb]! * bodies.vy[fb]!;
        expect(px).toBeCloseTo(before[0]!, 3);
        expect(py).toBeCloseTo(before[1]!, 3);
    });

    it("is hit by rounds in the fighters’ layer, which pass over the deck", () => {
        const run = scene();
        run.step();
        const bodies = run.world.bodies;
        const fb = index(run, run.f);
        // In from beyond the bow, across the fighter's middle.
        run.projectiles.spawn({
            x: bodies.x[fb]! + 60,
            y: bodies.y[fb]!,
            vx: -900,
            vy: 0,
            width: 0.16,
            ttl: 5,
            mass: 5,
            weaponsLayer: true,
        });
        for (let s = 0; s < 30 && run.totalProjectileHits === 0; s++) run.step();
        const struck = Array.from(run.impacts.log.body.slice(0, run.impacts.log.count));
        expect(struck).toContain(index(run, run.f));
        expect(struck).not.toContain(index(run, run.c));
        expect(run.ships.parkedCarrier(run.f)).toBe(run.c);
    });
});

describe("a pad building a fighter", () => {
    it("builds it on its own body, leaving its carrier as it was", () => {
        const run = makeBattle({ seed: 5 }, (ships, world) => {
            const c = ships.spawn(world, {
                design: compileBlueprint({ ...FACTORY, modules: FACTORY.modules.map((m, i) => (i === 2 ? { ...m, keep: 1 } : m)) }),
                x: 0,
                y: 0,
            });
            ships.spawn(world, { design: compileBlueprint(BARE_CORE), x: 5000, y: 0, team: 1 });
            return { c };
        });
        const hull = run.ships.currentStructure(run.c);
        let f = -1;
        for (let s = 0; s < 300 * 60 && (f < 0 || run.ships.isUnfinished(f)); s++) {
            run.step();
            if (f < 0 && run.ships.highWater > 2) f = 2;
            expect(run.ships.currentStructure(run.c)).toBe(hull);
        }
        expect(f).toBeGreaterThanOrEqual(0);
        expect(run.ships.isUnfinished(f)).toBe(false);
        expect(run.ships.parkedCarrier(f)).toBe(run.c);
        expect(run.ships.currentStructure(f).modules.length).toBe(compileBlueprint(DINKY).modules.length);
    });
});

describe("a fighter parked on a pad, met", () => {
    /** The laden carrier at rest, and a Dinky drifting in at `speed` along its bow, nobody flying either. */
    function drift(speed: number): Battle & { c: number; f: number; g: number } {
        return makeBattle({ seed: 3, pilots: false }, (ships, world) => {
            const c = ships.spawn(world, { design: compileBlueprint(LADEN), x: 0, y: 0, angle: 0 });
            const g = ships.spawn(world, { design: compileBlueprint(DINKY), x: 40, y: 0, angle: 0, vx: -speed });
            return { c, f: c + 1, g };
        });
    }

    it("meets a fighter drifting into it, and its carrier takes the blow", () => {
        const run = drift(3);
        const bodies = run.world.bodies;
        for (let s = 0; s < 20 * 60 && run.totalContacts === 0; s++) run.step();
        expect(run.totalContacts).toBeGreaterThan(0);
        const contacts = run.collisions.contacts;
        const met = [contacts.a[0], contacts.b[0]];
        expect(met).toContain(index(run, run.f));
        expect(met).toContain(index(run, run.g));
        run.step();
        // Pushed back along the line it came in on, still pinned to its pad.
        expect(bodies.vx[index(run, run.c)]).toBeLessThan(0);
        expect(run.ships.parkedCarrier(run.f)).toBe(run.c);
        expect(bodies.vx[index(run, run.g)]).toBeGreaterThan(-3);
    });
});

describe("a fighter built on a pad, under threat", () => {
    /** A Factory building one wary Dinky, an armed Corvette in reach, nobody flying; and the share of fuel it left with. */
    function leaves(launchFuel: number, factoryFuel = 1): number {
        const doctrine = compileBlueprint(DINKY).doctrine;
        const wary = { ...DINKY, doctrine: { ...doctrine, approach: { ...doctrine.approach, dockDanger: 1, launchFuel } } };
        const factory = compileBlueprint({
            ...FACTORY,
            modules: FACTORY.modules.map((m, i) => (i === 2 ? { ...m, keep: 1 } : m)),
            hangar: { [DINKY.name]: wary },
        });
        const run = makeBattle({ seed: 5, pilots: false }, (ships, world) => {
            const c = ships.spawn(world, { design: factory, x: 0, y: 0 });
            const b = world.bodies.indexOf(ships.body(c));
            for (let m = 0; m < factory.modules.length; m++) ships.fuel.vent(b, m, ships.fuel.held(b, m) * (1 - factoryFuel));
            ships.spawn(world, { design: compileBlueprint(CORVETTE), x: 400, y: 0, team: 1 });
            return { c };
        });
        let f = -1;
        for (let s = 0; s < 300 * 60 && (f < 0 || run.ships.parkedCarrier(f) === run.c); s++) {
            run.step();
            if (f < 0 && run.ships.highWater > 2) f = 2;
        }
        expect(f).toBeGreaterThanOrEqual(0);
        expect(run.ships.parkedCarrier(f)).toBe(-1);
        const fb = index(run, f);
        const core = run.ships.currentStructure(f).cores[0]!;
        const held = run.ships.fuel.pieceHeld(fb, core);
        return held / (held + run.ships.fuel.pieceRoom(fb, core));
    }

    it("is filled before it leaves", () => {
        expect(leaves(1)).toBeGreaterThan(0.99);
    });

    it("leaves with what its doctrine asks for", () => {
        const share = leaves(0.5);
        expect(share).toBeGreaterThanOrEqual(0.5);
        expect(share).toBeLessThan(0.6);
    });

    it("leaves with what it has once the carrier has none to spare", () => {
        expect(leaves(1, 0)).toBeLessThan(0.01);
    });
});
