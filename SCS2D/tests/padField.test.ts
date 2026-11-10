import { describe, expect, it } from "vitest";
import { compileBlueprint } from "../sim/index.js";
import { capture, Snapshot } from "../sim/snapshot.js";
import { makeBattle } from "../scenarios/battle.js";
import { DINKY } from "../scenarios/blueprints.js";
import { padCarrier } from "../scenarios/crippledLanding.js";

/** A fighter making for a carrier's pad, set just over it, drifting and spinning, with nothing else about. */
function overThePad(spin: number, drift: number) {
    // Short of fuel, so it makes for the pad.
    const doctrine = compileBlueprint(DINKY).doctrine;
    const design = compileBlueprint({ ...DINKY, doctrine: { ...doctrine, approach: { ...doctrine.approach, refuelBelow: 1.01 } } });
    const carrier = compileBlueprint(padCarrier(10, 10));
    return makeBattle({ seed: 1 }, (ships, world) => {
        const c = ships.spawn(world, { design: carrier, x: 0, y: 0, angle: 0, team: 0 });
        const pad = carrier.modules.findIndex((m) => m.spec.kind === "pad");
        const at = carrier.modules[pad]!;
        const f = ships.spawn(world, { design, x: at.x + 1, y: at.y - 1, angle: 0.4, angularVel: spin, vx: drift, team: 0 });
        return { c, f };
    });
}

describe("a pad's field", () => {
    it("takes hold of a fighter over its pad, stops it spinning and drifting, and sets it down", () => {
        const run = overThePad(3, 1.5);
        let held = false;
        for (let t = 0; t < 60 * 60 && run.ships.parkedCarrier(run.f) !== run.c; t++) {
            run.step();
            held ||= run.ships.padHeld[run.f] === 1;
        }
        expect(held).toBe(true);
        expect(run.ships.parkedCarrier(run.f)).toBe(run.c);
        // Lowered all the way down once its shadow next comes to be drawn.
        run.step();
        expect(run.ships.lowered[run.f]).toBe(1);
    });

    it("pushes the carrier back as hard as it pushes the fighter, so their momentum is kept", () => {
        const run = overThePad(3, 1.5);
        const bodies = run.world.bodies;
        const fb = bodies.indexOf(run.ships.body(run.f));
        const cb = bodies.indexOf(run.ships.body(run.c));
        // The field alone: the fighter's pilot lets go once held, and the carrier has nothing to do.
        // Steps well into a hold: a step's first half is pushed by the last one's forces, which held a pilot still flying.
        let checked = 0;
        let heldFor = 0;
        for (let t = 0; t < 600 && run.ships.parkedCarrier(run.f) < 0; t++) {
            const px = bodies.mass[fb]! * bodies.vx[fb]! + bodies.mass[cb]! * bodies.vx[cb]!;
            const py = bodies.mass[fb]! * bodies.vy[fb]! + bodies.mass[cb]! * bodies.vy[cb]!;
            run.step();
            heldFor = run.ships.padHeld[run.f] === 1 ? heldFor + 1 : 0;
            if (heldFor < 3 || run.ships.parkedCarrier(run.f) >= 0) continue;
            const qx = bodies.mass[fb]! * bodies.vx[fb]! + bodies.mass[cb]! * bodies.vx[cb]!;
            const qy = bodies.mass[fb]! * bodies.vy[fb]! + bodies.mass[cb]! * bodies.vy[cb]!;
            expect(Math.abs(qx - px)).toBeLessThan(1e-6 * bodies.mass[cb]!);
            expect(Math.abs(qy - py)).toBeLessThan(1e-6 * bodies.mass[cb]!);
            checked++;
        }
        expect(checked).toBeGreaterThan(10);
    });

    it("costs the carrier charge, drawn by the pad", () => {
        const run = overThePad(3, 1.5);
        const cb = run.world.bodies.indexOf(run.ships.body(run.c));
        const pad = run.ships.designs[run.c]!.modules.findIndex((m) => m.spec.kind === "pad");
        let drawn = 0;
        const draw = run.ships.power.draw.bind(run.ships.power);
        run.ships.power.draw = (b: number, user: number, joules: number): number => {
            const got = draw(b, user, joules);
            if (b === cb && user === pad) drawn += got;
            return got;
        };
        for (let t = 0; t < 120; t++) run.step();
        expect(run.ships.padHeld[run.f]).toBe(1);
        expect(drawn).toBeGreaterThan(0);
    });

    it("shows on its carrier's view, for the pad's lights, while it holds a fighter", () => {
        const run = overThePad(3, 1.5);
        const pad = run.ships.designs[run.c]!.modules.findIndex((m) => m.spec.kind === "pad");
        const view = new Snapshot();
        let lit = 0;
        for (let t = 0; t < 120; t++) {
            run.step();
            capture(view, run.world, run.ships, run.projectiles, run.beams);
            const carrier = view.ships.slice(0, view.shipCount).find((s) => s.ship === run.c)!;
            expect(carrier.padField).toBeDefined();
            if (run.ships.padHeld[run.f] === 1) {
                expect(carrier.padField![pad]).toBeGreaterThan(0);
                lit++;
            } else expect(carrier.padField![pad]).toBe(0);
        }
        expect(lit).toBeGreaterThan(0);
    });
});
