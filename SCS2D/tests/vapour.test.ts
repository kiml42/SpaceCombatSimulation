import { describe, expect, it } from "vitest";
import { Beams, Projectiles, Ships, Snapshot, World, capture, compileBlueprint, type Blueprint, type Rng } from "../sim/index.js";
import { LEAK_LINGER, LEAK_SCRATCH_FADE } from "../sim/snapshot.js";
import { FILL_EVERY, FILL_KEPT, leakSpeed } from "../sim/fuel.js";
import {
    CLOUD_SEEN,
    eachCloudPuff,
    eachPuff,
    holeClosedAt,
    holeWidth,
    type Cloud,
    type Fills,
    type Hole,
    type Puff,
} from "../render/vapour.js";

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
            eachPuff(hole, 0, 0, 1, 0, age, { now: 1, offset: 0 }, puff, (p) => {
                least = Math.min(least, p.x);
            });
            return least;
        };
        // Open: some has only just left.
        expect(nearest(0.4)).toBeLessThan(1);
        // Shut a moment ago: what is left is all some way off.
        expect(nearest(shut + 0.1)).toBeGreaterThan(3);
    });
    it("goes on as it left once its tank runs dry, rather than drawing back or vanishing", () => {
        const hole: Hole = { opened: 0.1, closing: 0, floor: 0.1, patched: -1 };
        const age = 2;
        const dryAt = 1.8;
        const full: Fills = { now: 1, offset: 0, ring: new Array<number>(FILL_KEPT).fill(1) };
        const ring = new Array<number>(FILL_KEPT).fill(0);
        for (let n = 0; (n + 1) * FILL_EVERY <= dryAt + 1e-9; n++) ring[n] = 1;
        const dry: Fills = { now: 0, offset: 0, ring };
        const reach = (fills: Fills): [number, number] => {
            let least = Infinity;
            let most = -Infinity;
            const puff: Puff = { x: 0, y: 0, radius: 0, dirX: 1, dirY: 0, length: 0, alpha: 0 };
            eachPuff(hole, 0, 0, 1, 0, age, fills, puff, (p) => {
                least = Math.min(least, p.x);
                most = Math.max(most, p.x);
            });
            return [least, most];
        };
        const [fullLeast, fullMost] = reach(full);
        const [dryLeast, dryMost] = reach(dry);
        // What left while it was full is where it would have been anyway.
        expect(dryMost).toBeCloseTo(fullMost, 9);
        // Nothing new at the hole.
        expect(fullLeast).toBeLessThan(0.5);
        expect(dryLeast).toBeGreaterThan(1);
    });
});

describe("how thick a leak's vapour is", () => {
    const thickest = (hole: Hole, age: number, fills: Fills): number => {
        let most = 0;
        const puff: Puff = { x: 0, y: 0, radius: 0, dirX: 1, dirY: 0, length: 0, alpha: 0 };
        eachPuff(hole, 0, 0, 1, 0, age, fills, puff, (p) => {
            most = Math.max(most, p.alpha);
        });
        return most;
    };
    const open: Hole = { opened: 0.2, closing: 0, floor: 0.2, patched: -1 };

    it("thins as its tank empties, to nothing as it runs dry", () => {
        const full = thickest(open, 2, { now: 1, offset: 0 });
        const low = thickest(open, 2, { now: 0.01, offset: 0 });
        expect(low).toBeLessThan(full * 0.2);
    });

    it("fans out wider the slower it left, up to a limit", () => {
        const fanning = (fill: number): number => {
            let most = 0;
            const puff: Puff = { x: 0, y: 0, radius: 0, dirX: 1, dirY: 0, length: 0, alpha: 0 };
            // Out along x from the origin, so x is how far it has gone.
            eachPuff(open, 0, 0, 1, 0, 1, { now: fill, offset: 0 }, puff, (p) => {
                if (p.x > 0.5) most = Math.max(most, (p.radius - 0.1) / p.x);
            });
            return most;
        };
        expect(fanning(1)).toBeCloseTo(0.3, 6);
        // Half as fast, twice as wide a metre.
        expect(fanning(0.25)).toBeCloseTo(0.6, 6);
        expect(fanning(0.0001)).toBeCloseTo(0.9, 6);
    });

    it("thins as its hole pinches shut, though what leaves goes as fast", () => {
        const pinching: Hole = { opened: 0.2, closing: 0.1, floor: 0, patched: -1 };
        const shut = holeClosedAt(pinching);
        const wide = thickest(open, shut - 0.01, { now: 1, offset: 0 });
        expect(thickest(pinching, shut - 0.01, { now: 1, offset: 0 })).toBeLessThan(wide * 0.2);
    });
});

describe("a cloud of fuel let out at once", () => {
    const cloud = (age: number): Cloud => ({ x: 5, y: -3, age, fuel: 1000, fill: 0.5, size: 4, seed: 7 });
    const puffs = (age: number): Puff[] => {
        const seen: Puff[] = [];
        eachCloudPuff(cloud(age), { x: 0, y: 0, radius: 0, dirX: 1, dirY: 0, length: 0, alpha: 0 }, (p) => seen.push({ ...p }));
        return seen;
    };

    it("goes out every way from the module, none faster than its tank sends it", () => {
        const seen = puffs(0.5);
        expect(seen.length).toBeGreaterThan(8);
        const quarters = new Set(seen.map((p) => (p.x > 5 ? 1 : 0) + (p.y > -3 ? 2 : 0)));
        expect(quarters.size).toBe(4);
        for (const p of seen) expect(Math.hypot(p.x - 5, p.y + 3)).toBeLessThanOrEqual(2 + leakSpeed(0.5) * 0.5);
    });

    it("goes on spreading as fast, nothing in space to slow it, and fills in from the middle", () => {
        const far = (age: number): number => Math.max(...puffs(age).map((p) => Math.hypot(p.x - 5, p.y + 3)));
        // As far again from 1 s to 2 s as from 0 to 1 s, less where it started from.
        expect(far(2) - far(1)).toBeCloseTo(far(1) - 2, 0);
        // Its middle covered: some puff over the very centre.
        const seen = puffs(1);
        expect(seen.some((p) => Math.hypot(p.x - 5, p.y + 3) < p.radius / 2)).toBe(true);
    });

    it("spreads and thins as it goes, and is gone once seen long enough", () => {
        const early = puffs(0.1);
        const late = puffs(1);
        const spread = (seen: Puff[]): number => Math.max(...seen.map((p) => Math.hypot(p.x - 5, p.y + 3)));
        expect(spread(late)).toBeGreaterThan(spread(early));
        expect(late[0]!.alpha).toBeLessThan(early[0]!.alpha);
        expect(late[0]!.radius).toBeGreaterThan(0);
        expect(puffs(CLOUD_SEEN)).toEqual([]);
        expect(puffs(-0.1)).toEqual([]);
    });
});
