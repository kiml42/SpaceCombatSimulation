import { describe, expect, it } from "vitest";
import { compileBlueprint, Ships, World, type ShipDesign } from "../sim/index.js";

/**
 * A module taking far more than breaks it in a single step is shattered: gone
 * from its hull, its mass discarded and broken into debris.
 */

/** A core and two plates in a row along x: the middle plate holds the far one on. */
const ROW = compileBlueprint({
    name: "Row",
    modules: [
        { kind: "core", x: -4, y: 0, length: 4, width: 4 },
        { kind: "structure", x: 0, y: 0, length: 4, width: 4 },
        { kind: "structure", x: 4, y: 0, length: 4, width: 4 },
    ],
});
/** The module at `x` along the row, from its blueprint. */
const at = (design: ShipDesign, x: number): number =>
    design.modules.findIndex((m) => Math.abs(m.x - design.modules[0]!.x - (x + 4)) < 1e-6);

function scene(design: ShipDesign = ROW) {
    const world = new World({ dt: 1 / 60, seed: 3 });
    const ships = new Ships();
    const ship = ships.spawn(world, { design, x: 0, y: 0, vx: 10, vy: -4, angularVel: 0.3, team: 1 });
    const body = world.bodies.indexOf(ships.body(ship));
    return { world, ships, ship, body };
}

/** The world's momentum along x, with what it has discarded. */
function momentumX(s: ReturnType<typeof scene>): number {
    const b = s.world.bodies;
    let p = s.ships.discardedPx;
    for (let i = 0; i < b.highWater; i++) if (b.alive[i] === 1) p += b.mass[i]! * b.vx[i]!;
    return p;
}

describe("shattering", () => {
    it("takes a module gone from its hull when it takes three times what breaks it in one step, as debris", () => {
        const s = scene();
        s.ships.debris.watched = true;
        const end = at(ROW, 4);
        s.ships.damage.absorb(s.body, end, 3.5 * s.ships.damage.capacityOf(s.body, end));
        s.ships.sever(s.world);
        expect(s.ships.currentStructure(s.ship).modules.length).toBe(2);
        expect(s.ships.discarded).toBeGreaterThan(0);
        expect(s.ships.debris.count).toBeGreaterThan(0);
    });

    it("breaks it into debris where it was, inside its outline", () => {
        const s = scene();
        s.ships.debris.watched = true;
        const end = at(ROW, 4);
        const m = ROW.modules[end]!;
        const b = s.world.bodies;
        // At spawn the hull is unturned, so the module is its place on the hull along.
        const cx = b.x[s.body]! + m.x;
        const cy = b.y[s.body]! + m.y;
        s.ships.damage.absorb(s.body, end, 3.5 * s.ships.damage.capacityOf(s.body, end));
        s.ships.sever(s.world);
        const debris = s.ships.debris;
        expect(debris.count).toBeGreaterThan(0);
        for (let i = 0; i < debris.count; i++) {
            // Blown apart, so hot, and in its side's paint.
            expect(debris.heat(i)).toBe(1);
            expect(debris.paint[i]).toBe(1);
            expect(Math.abs(debris.x[i]! - cx)).toBeLessThanOrEqual(2 + 1e-9);
            expect(Math.abs(debris.y[i]! - cy)).toBeLessThanOrEqual(2 + 1e-9);
        }
    });

    it("throws its bits along the line of the blow that shattered it", () => {
        const s = scene();
        s.ships.debris.watched = true;
        const end = at(ROW, 4);
        const m = ROW.modules[end]!;
        const joules = 3.5 * s.ships.damage.capacityOf(s.body, end);
        s.ships.damage.absorb(s.body, end, joules);
        // On its outer face, driving in along -x.
        s.ships.damage.struck(s.body, end, m.x + 2, m.y, -1, 0, joules);
        s.ships.sever(s.world);
        const b = s.world.bodies;
        const debris = s.ships.debris;
        let along = 0;
        let across = 0;
        for (let i = 0; i < debris.count; i++) {
            along += Math.abs(debris.vx[i]! - b.vx[s.body]!);
            across += Math.abs(debris.vy[i]! - b.vy[s.body]!);
        }
        expect(along / debris.count).toBeGreaterThan(5);
        expect(along).toBeGreaterThan(1.5 * across);
    });

    it("keeps one that took as much over several steps, broken but still there", () => {
        const s = scene();
        const end = at(ROW, 4);
        const capacity = s.ships.damage.capacityOf(s.body, end);
        for (let k = 0; k < 4; k++) {
            s.ships.damage.absorb(s.body, end, capacity);
            s.ships.sever(s.world);
        }
        expect(s.ships.currentStructure(s.ship).modules.length).toBe(3);
        expect(s.ships.damage.spent(s.body, end)).toBe(true);
    });

    it("cuts a hull in two where the module it shatters was all that held it together", () => {
        const s = scene();
        const middle = at(ROW, 0);
        s.ships.damage.absorb(s.body, middle, 4 * s.ships.damage.capacityOf(s.body, middle));
        const pieces = s.ships.sever(s.world);
        expect(pieces).toBe(1);
        expect(s.ships.currentStructure(s.ship).modules.length).toBe(1);
        expect(s.ships.currentStructure(s.ship + 1).modules.length).toBe(1);
    });

    it("conserves momentum, counting what it discards", () => {
        const s = scene();
        const before = momentumX(s);
        const middle = at(ROW, 0);
        s.ships.damage.absorb(s.body, middle, 4 * s.ships.damage.capacityOf(s.body, middle));
        s.ships.sever(s.world);
        expect(momentumX(s)).toBeCloseTo(before, 6);
    });

    it("takes a ship of one module away altogether", () => {
        const lone = compileBlueprint({ name: "Lone", modules: [{ kind: "core", x: 0, y: 0, length: 2, width: 2 }] });
        const s = scene(lone);
        s.ships.damage.absorb(s.body, 0, 4 * s.ships.damage.capacityOf(s.body, 0));
        s.ships.sever(s.world);
        expect(s.ships.isAlive(s.ship)).toBe(false);
        expect(s.world.bodies.isAlive(s.ships.body(s.ship))).toBe(false);
        expect(s.ships.discarded).toBeGreaterThan(0);
    });
});
