import { describe, expect, it } from "vitest";
import { rivalMines } from "../scenarios/rivalMines.js";

describe("rival mines", () => {
    it("starts each outpost clear of every asteroid", () => {
        const run = rivalMines();
        const b = run.world.bodies;
        for (const i of run.miners) {
            const mb = b.indexOf(run.ships.body(i));
            for (const a of run.asteroids) {
                const ab = b.indexOf(run.ships.body(a));
                expect(Math.hypot(b.x[mb]! - b.x[ab]!, b.y[mb]! - b.y[ab]!)).toBeGreaterThan(b.radius[mb]! + b.radius[ab]!);
            }
        }
    });

    it("has each Replicator anchor to its own major and build a copy of itself there", () => {
        const run = rivalMines();
        const majors = [run.asteroids[0]!, run.asteroids[1]!];
        for (let t = 0; t < 240 * 60; t++) run.step();
        run.miners.forEach((i, k) => {
            expect(run.ships.isMoored(i)).toBe(true);
            expect(run.ships.parkedCarrier(i)).toBe(majors[k]);
            expect(run.ships.body(i)).not.toBe(run.ships.body(run.miners[1 - k]!));
        });
        // A copy on each side's slipway, on the rock with its builder.
        const copies = [];
        for (let i = 0; i < run.ships.count; i++) if (run.ships.isAlive(i) && run.ships.isPrinting(i)) copies.push(i);
        expect(new Set(copies.map((i) => run.ships.teamOf(i)))).toEqual(new Set([0, 1]));
        for (const i of copies) expect(run.ships.body(i)).toBe(run.ships.body(run.miners[run.ships.teamOf(i)]!));
        const b = run.world.bodies;
        for (let k = 0; k < b.highWater; k++) expect(Number.isFinite(b.vx[k]!)).toBe(true);
    });

    it("keeps hold of its rock while it builds, an enemy fighter in reach or not", () => {
        const run = rivalMines();
        const moored = run.miners.map(() => false);
        for (let t = 0; t < 400 * 60; t++) {
            run.step();
            run.miners.forEach((i, k) => {
                const now = run.ships.isMoored(i);
                // A Dinky of Blue's comes in reach of Red's rock at about 333 s.
                if (moored[k]) expect(now).toBe(true);
                moored[k] = now;
            });
        }
        expect(moored).toEqual([true, true]);
    }, 300_000);

    it("never leaves a fighter trying to land for minutes on end close by its carrier", () => {
        const run = rivalMines();
        const ships = run.ships;
        const pads = (run.ships as unknown as { landingPad: number[] }).landingPad;
        const since = new Map<number, number>();
        let longest = 0;
        const b = run.world.bodies;
        const near = (p: number, q: number) => Math.hypot(b.x[p]! - b.x[q]!, b.y[p]! - b.y[q]!) < 60;
        for (let t = 0; t < 480 * 60; t++) {
            run.step();
            for (let i = 0; i < ships.count; i++) {
                const landing = ships.isAlive(i) && ships.hasControl(i) && ships.parkedCarrier(i) < 0 && pads[i]! >= 0;
                const at = (s: number) => b.indexOf(ships.body(s));
                const trying = landing && run.miners.some((m) => ships.body(m) !== ships.body(i) && near(at(m), at(i)));
                if (!trying) since.delete(i);
                else if (!since.has(i)) since.set(i, t);
                else longest = Math.max(longest, t - since.get(i)!);
            }
        }
        // One was held there from about 200 s to the end, beside its pad over the hull, then overshooting it.
        expect(longest / 60).toBeLessThan(90);
    }, 300_000);

    it("lands a fighter that can still turn both ways to refill while a copy is on its slipway, rather than shying from it", () => {
        // Whether a fighter has any turn both ways left is the luck of the dogfight, and one without it does not try (`pickPad`).
        const run = rivalMines();
        const ships = run.ships;
        const pads = (ships as unknown as { landingPad: number[] }).landingPad;
        const layout = (i: number) => (ships as unknown as { layoutOf(i: number): { maxTorque(sense: number): number } }).layoutOf(i);
        const turns = (i: number) => layout(i).maxTorque(1) > 0 && layout(i).maxTorque(-1) > 0;
        const copyOnSlipway = () =>
            Array.from({ length: ships.highWater }, (_, i) => i).some((i) => ships.isAlive(i) && ships.isPrinting(i));
        // Each fighter making for a pad, from when it set out.
        const making = new Map<number, number>();
        const landed = new Set<number>();
        for (let t = 0; t < 420 * 60; t++) {
            run.step();
            if (t < 200 * 60) continue;
            expect(copyOnSlipway()).toBe(true);
            for (let i = 0; i < ships.highWater; i++) {
                if (!ships.isAlive(i) || !ships.currentStructure(i).fighter) continue;
                if (run.miners.includes(ships.parkedCarrier(i))) {
                    if (making.delete(i)) landed.add(i);
                } else if (pads[i]! >= 0 && ships.hasControl(i) && turns(i)) {
                    if (!making.has(i)) making.set(i, t);
                    expect((t - making.get(i)!) / 60).toBeLessThan(90);
                } else making.delete(i);
            }
        }
        expect(landed.size).toBeGreaterThan(0);
    }, 300_000);
});
