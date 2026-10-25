import { describe, expect, it } from "vitest";
import { compileBlueprint, joints } from "../sim/index.js";
import { cuts } from "../sim/connectivity.js";
import { CATAMARAN } from "../scenarios/blueprints.js";
import { split } from "../scenarios/split.js";

/**
 * A ship cut in half, and both halves flying on.
 *
 * What makes a piece a ship is a working core (DESIGN.md §4), so a hull built
 * with one in each half survives being cut between them as two ships. This is
 * that claim, end to end: the Catamaran, a bare core sent through its bridge,
 * and two craft afterwards where there was one.
 */

const catamaran = compileBlueprint(CATAMARAN);

describe("the Catamaran", () => {
    it("is two ships joined by the weakest welds on it", () => {
        expect(catamaran.cores.length).toBe(2);
        expect(catamaran.turrets.length).toBe(2);

        // The bridge is the line the ship is meant to come apart on, so nothing on
        // it may be as strong as what holds a hull together.
        const welds = joints(catamaran);
        const bridge = welds.filter((j) => {
            const a = catamaran.modules[j.a]!;
            const b = catamaran.modules[j.b]!;
            // The bridge runs core to core; a hull's other structure mounts its engines.
            const link = (m: typeof a): boolean =>
                m.spec.kind === "structure" && Math.abs(m.x - catamaran.modules[catamaran.cores[0]!]!.x) < 0.5;
            return link(a) || link(b);
        });
        expect(bridge.length).toBeGreaterThan(3);

        // Against the welds a hull hangs anything from: one with a second load
        // path beside it, as an engine welded along its block to a girder and by
        // its back to a tank, parts nothing by letting go.
        const holding = cuts(catamaran);
        const weakestHull = Math.min(...welds.filter((j, k) => !bridge.includes(j) && holding[k] !== null).map((j) => j.strength));
        const strongestBridge = Math.max(...bridge.map((j) => j.strength));
        expect(strongestBridge).toBeLessThan(weakestHull);
    });
});

describe("a ship cut in half", () => {
    /** The scenario up to a given second, and what is flying at that point. */
    function at(seconds: number): { live: number[]; run: ReturnType<typeof split> } {
        const run = split();
        for (let i = 0; i < Math.round(seconds * 60); i++) run.step();
        const live: number[] = [];
        for (let s = 0; s < run.ships.highWater; s++) {
            if (run.ships.isAlive(s) && !run.ships.isDerelict(s)) live.push(s);
        }
        return { live, run };
    }

    const halves = (run: ReturnType<typeof split>, live: readonly number[]): number[] =>
        live.filter((s) => run.ships.currentStructure(s).name === catamaran.name);

    it("is one ship before the ram and two after it", () => {
        const before = at(2);
        expect(halves(before.run, before.live).length).toBe(1);
        expect(before.run.totalSevered).toBe(0);

        const after = at(8);
        const pieces = halves(after.run, after.live);
        expect(pieces.length).toBe(2);
        // Each named for the core it is flown from, by the name painted on it at launch.
        const whole = halves(before.run, before.live)[0]!;
        expect(before.run.ships.nameOf(whole)).toBe("1");
        const painted: (string | null)[] = [];
        before.run.ships.coreNames(whole, painted);
        expect(painted).toEqual(["1.1", "1.2"]);
        expect(pieces.map((p) => after.run.ships.nameOf(p)).sort()).toEqual(["1.1", "1.2"]);
        for (const piece of pieces) {
            after.run.ships.coreNames(piece, painted);
            expect(painted).toEqual([after.run.ships.nameOf(piece)]);
        }

        // Both are ships rather than wreckage, and each is a hull's worth of one:
        // a core to fly it, a gun to fight it, and engines to move it.
        for (const piece of pieces) {
            const design = after.run.ships.currentStructure(piece);
            expect(design.cores.length).toBe(1);
            expect(design.turrets.length).toBe(1);
            expect(design.engines.length).toBeGreaterThan(0);
            expect(after.run.ships.isDisarmed(piece)).toBe(false);
            expect(design.mass).toBeGreaterThan(catamaran.mass * 0.4);
        }
    });

    it("sends both halves after the enemy nobody told them about, and mostly leaves the wreck", () => {
        // The point of the scenario: a piece with a working core picks the
        // corvette still worth fighting, and both pick the same one without being
        // ordered to.
        //
        // **What is never a target is a hull with no working core**, since no shot
        // will ever remove one from the battle. The rammer is not one of those —
        // a bare core, disarmed and engineless but with its core intact, so it is
        // harmless and still finishable, and a mount that takes
        // it is not wasting its rounds. It is merely spending them on the wrong
        // thing while a live corvette is about, which is what the preferences for
        // what can still shoot and still run are there to say — and at very short
        // range proximity outweighs them, so this asks for the large majority
        // rather than for perfection.
        //
        // A single instant is the wrong thing to assert on either way: a mount
        // tracking a far target loses and regains bearing as its ship holds
        // station, so this samples a window. Thirty-five seconds of it: a half has
        // little to brake with facing forwards, and the reach it has to close into
        // is measured against the corvette it is chasing — 949 m, not the larger
        // figure its own doctrine nominates — so it takes a while to get there.
        const { run, live } = at(25);
        expect(halves(run, live).length).toBe(2);
        // A half the corvette has already disarmed has nothing to lock on with.
        const pieces = halves(run, live).filter((s) => run.ships.currentStructure(s).turrets.length > 0);
        expect(pieces.length).toBeGreaterThan(0);

        const corvette = live.find((s) => run.ships.currentStructure(s).name === "Corvette")!;
        const lockedOn = new Set<number>();
        let onTheLiveOne = 0;
        let onAnything = 0;
        // Until the corvette is beaten: on the step it goes down, a turret still
        // holds it, and drops it on the next.
        for (let i = 0; i < Math.round(35 * 60); i++) {
            run.step();
            if (run.ships.isDisabled(corvette)) break;
            for (const piece of pieces) {
                // A half can lose its gun to the corvette while this runs.
                if (run.ships.currentStructure(piece).turrets.length === 0) continue;
                const target = run.ships.targetOfTurret(run.world.bodies, piece, 0);
                if (target < 0) continue;
                // Never a hulk: nothing controls one and there is nothing to finish.
                expect(run.ships.hasControl(target)).toBe(true);
                expect(run.ships.currentStructure(target).name).toBe("Corvette");
                onAnything++;
                if (!run.ships.isDisabled(target)) {
                    onTheLiveOne++;
                    lockedOn.add(piece);
                }
            }
        }
        for (const piece of pieces) {
            expect(lockedOn.has(piece)).toBe(true);
            expect(run.ships.orderCount(piece)).toBe(0);
        }
        expect(onTheLiveOne).toBeGreaterThan(onAnything * 0.7);
    });

    it("keeps both halves from turning into each other", () => {
        // Cut apart they lie hull to hull, and each turns to bring its gun on the
        // corvette: the shortest way round swings one's bow into the other's stern.
        const run = split();
        let touched = -1;
        for (let step = 0; step < 20 * 60 && touched < 0; step++) {
            run.step();
            const live = [...Array(run.ships.highWater).keys()].filter((s) => run.ships.isAlive(s) && !run.ships.isDerelict(s));
            const pieces = halves(run, live);
            if (pieces.length !== 2) continue;
            const [a, b] = pieces.map((p) => run.world.bodies.indexOf(run.ships.body(p)));
            const c = run.collisions.contacts;
            for (let k = 0; k < c.count; k++) if ((c.a[k] === a && c.b[k] === b) || (c.a[k] === b && c.b[k] === a)) touched = step;
        }
        expect(touched).toBe(-1);
    });
});
