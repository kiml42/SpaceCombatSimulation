import { describe, expect, it } from "vitest";
import { Beams, Projectiles, Ships, Snapshot, World, capture, compileBlueprint, type Blueprint, type Rng } from "../sim/index.js";
import { LEAK_LINGER, LEAK_SCRATCH_FADE } from "../sim/snapshot.js";
import { eachPuff, holeClosedAt, holeWidth, type Hole, type Puff } from "../render/vapour.js";

/** A core and a lined tank ahead of it. */
const DRUM: Blueprint = {
    name: "Drum",
    modules: [
        { kind: "core", x: 0, y: 0, length: 2, width: 2 },
        { kind: "tank", x: 4, y: 0, length: 6, width: 4, sealing: 0.01 },
    ],
};
const TANK = 1;
const always = { nextFloat: () => 0 } as unknown as Rng;

function holed(width: number): { world: World; ships: Ships; body: number; step: () => void } {
    const design = compileBlueprint(DRUM);
    const world = new World({ dt: 1 / 60, seed: 2 });
    const ships = new Ships();
    world.addForceProvider(ships.forceProvider());
    const ship = ships.spawn(world, { design, x: 0, y: 0, team: 0 });
    const body = world.bodies.indexOf(ships.body(ship));
    const tank = design.modules[TANK]!;
    ships.holed(body, TANK, 1, tank.x + tank.spec.length / 2, 0, 1, 0, width, always);
    return {
        world,
        ships,
        body,
        step: () => {
            ships.command(1 / 60, world);
            world.step();
        },
    };
}

describe("a leak's vapour", () => {
    it("knows how wide its hole was at any age, as the sim narrowed it, through its lining and its patch", () => {
        const s = holed(0.2);
        const leak = (): ReturnType<Ships["fuel"]["leaksOf"]>[number] => s.ships.fuel.leaksOf(s.body)[0]!;
        const hole = (): Hole => ({
            opened: leak().opened,
            closing: leak().liningClosing,
            floor: leak().liningFloor,
            patched: leak().patched,
        });
        for (let i = 0; i < 90; i++) s.step();
        expect(holeWidth(hole(), leak().age)).toBeCloseTo(leak().width, 9);
        s.ships.fuel.seal(s.body, TANK);
        for (let i = 0; i < 30; i++) s.step();
        expect(holeWidth(hole(), leak().age)).toBeCloseTo(leak().width, 9);
        for (let i = 0; i < 120; i++) s.step();
        expect(leak().width).toBe(0);
        expect(holeWidth(hole(), leak().age)).toBe(0);
        expect(leak().closed).toBeGreaterThan(leak().patched);
    });

    it("is still pictured a while after its hole has closed, so what it let out drifts off", () => {
        const s = holed(0.1);
        for (let i = 0; i < 10; i++) s.step();
        s.ships.fuel.seal(s.body, TANK);
        while (s.ships.fuel.leaksOf(s.body)[0]!.width > 0) s.step();
        const view = (): Snapshot["ships"][number] => capture(new Snapshot(), s.world, s.ships, new Projectiles(), new Beams()).ships[0]!;
        expect(view().leakX).toHaveLength(1);
        for (let i = 0; i < LEAK_LINGER * 60 + 1; i++) s.step();
        // Still pictured for its scratches, but done venting.
        const leak = s.ships.fuel.leaksOf(s.body)[0]!;
        expect(leak.age - leak.closed).toBeGreaterThan(LEAK_LINGER);
    });

    it("is pictured for good once its lining has sealed it, and until its scratches fade once patched", () => {
        const s = holed(0.005);
        const view = (): Snapshot["ships"][number] => capture(new Snapshot(), s.world, s.ships, new Projectiles(), new Beams()).ships[0]!;
        for (let i = 0; i < 600; i++) s.step();
        expect(s.ships.fuel.leaksOf(s.body)[0]!.width).toBe(0);
        expect(s.ships.fuel.leaksOf(s.body)[0]!.patched).toBeLessThan(0);
        expect(view().leakX).toHaveLength(1);
        expect(view().leakClosed![0]).toBeGreaterThanOrEqual(0);
        expect(view().leakModule![0]).toBe(TANK);
        s.ships.fuel.seal(s.body, TANK);
        for (let i = 0; i < LEAK_SCRATCH_FADE * 60 - 10; i++) s.step();
        expect(view().leakX).toHaveLength(1);
        for (let i = 0; i < 20; i++) s.step();
        expect(view().leakX).toHaveLength(0);
    });

    it("closes when the sim says it does", () => {
        const sealed: Hole = { opened: 0.01, closing: 0.002, floor: 0, patched: -1 };
        expect(holeClosedAt(sealed)).toBeCloseTo(5, 9);
        const stuck: Hole = { opened: 0.4, closing: 0.01, floor: 0.2, patched: -1 };
        expect(holeClosedAt(stuck)).toBeLessThan(0);
        const patched: Hole = { ...stuck, patched: 30 };
        expect(holeClosedAt(patched)).toBeCloseTo(30 + 0.2 / 0.2, 9);
        expect(holeWidth(patched, holeClosedAt(patched))).toBeCloseTo(0, 9);
    });

    it("sends out nothing once its hole has closed, while what already left goes on", () => {
        const hole: Hole = { opened: 0.1, closing: 0, floor: 0.1, patched: 0.5 };
        const shut = 0.5 + 0.1 / 0.2;
        const nearest = (age: number): number => {
            let least = Infinity;
            const puff: Puff = { x: 0, y: 0, radius: 0, dirX: 1, dirY: 0, length: 0, alpha: 0 };
            eachPuff(hole, 0, 0, 1, 0, age, 1, 49, puff, (p) => {
                least = Math.min(least, p.x);
            });
            return least;
        };
        // Open: some has only just left.
        expect(nearest(0.4)).toBeLessThan(1);
        // Shut a moment ago: what is left is all some way off.
        expect(nearest(shut + 0.1)).toBeGreaterThan(3);
    });
});
