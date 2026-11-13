import { describe, expect, it } from "vitest";
import { compileBlueprint } from "../sim/index.js";
import { CORVETTE } from "../scenarios/blueprints.js";
import { envelopes, holdingAt, holdingThrottles, pointedThrust } from "../editor/stats.js";
import { envelopeBearingAt, overEnvelope } from "../editor/overlay.js";

describe("the throttles behind a point on the envelope", () => {
    const corvette = compileBlueprint(CORVETTE);

    /** What the throttles push the ship with: force, and torque about the centre of mass. */
    function wrench(throttles: Float64Array): { fx: number; fy: number; torque: number } {
        let fx = 0;
        let fy = 0;
        let torque = 0;
        corvette.engines.forEach((engine, t) => {
            const f = engine.maxThrust * (throttles[t] ?? 0);
            fx += engine.dirX * f;
            fy += engine.dirY * f;
            torque += engine.x * engine.dirY * f - engine.y * engine.dirX * f;
        });
        return { fx, fy, torque };
    }

    it("pushes the way asked, as hard as the holding curve says, without turning", () => {
        const curve = envelopes(corvette, 8);
        for (let i = 0; i < 8; i++) {
            const angle = (2 * Math.PI * i) / 8;
            const { fx, fy, torque } = wrench(holdingThrottles(corvette, angle));
            const force = Math.hypot(fx, fy);
            expect(force / corvette.mass).toBeCloseTo(curve.holding[i]!, 1);
            if (force > 0) {
                expect(Math.abs(Math.atan2(fy, fx) - Math.atan2(Math.sin(angle), Math.cos(angle))) % (2 * Math.PI)).toBeLessThan(0.05);
                expect(Math.abs(torque) / (force * corvette.radius)).toBeLessThan(0.02);
            }
        }
    });

    it("burns as hard as the point asks, up to what holds the heading", () => {
        const curve = envelopes(corvette, 64);
        const peak = Math.max(...curve.free);
        const angle = Math.PI / 3;
        const holding = holdingAt(curve, angle);
        // A quarter of the way out asks for a quarter of the free curve's peak.
        const gentle = pointedThrust(curve, angle, 0.25);
        expect(gentle.acceleration).toBeCloseTo(Math.min(0.25 * peak, holding), 9);
        // At or past the rim, as much as holds the heading, and no more.
        expect(pointedThrust(curve, angle, 1).acceleration).toBeCloseTo(holding, 9);
        expect(pointedThrust(curve, angle, 3).share).toBe(1);
        // The throttles scaled by the share push that much, still without turning.
        const full = holdingThrottles(corvette, angle);
        const { fx, fy, torque } = wrench(full.map((t) => t * gentle.share));
        const fullForce = Math.hypot(wrench(full).fx, wrench(full).fy);
        expect(Math.hypot(fx, fy) / fullForce).toBeCloseTo(gentle.share, 9);
        expect(Math.abs(torque) / (fullForce * corvette.radius)).toBeLessThan(0.02);
    });

    it("is read off the widget only where the widget is", () => {
        // The rosette sits in the bottom right, 54 px across its radius.
        const cx = 1000 - 54 - 16;
        const cy = 600 - 54 - 16 - 18;
        expect(envelopeBearingAt(1000, 600, cx + 30, cy)).toBeCloseTo(0, 9);
        expect(envelopeBearingAt(1000, 600, cx, cy - 30)).toBeCloseTo(Math.PI / 2, 9);
        expect(envelopeBearingAt(1000, 600, 100, 100)).toBeNull();
    });

    it("grows while pointed at, from its corner, and stays grown until the pointer leaves the larger one", () => {
        // At rest the rosette's centre is 70 px in from the right; grown to 160 px, 176.
        const small = { x: 1000 - 54 - 16, y: 600 - 54 - 16 - 18 };
        const large = { x: 1000 - 160 - 16, y: 600 - 160 - 16 - 18 };
        expect(overEnvelope(1000, 600, small.x, small.y)).toBe(true);
        // A point on the large one but off the small one keeps it large, and only then.
        const between = { x: large.x - 100, y: large.y };
        expect(overEnvelope(1000, 600, between.x, between.y, false)).toBe(false);
        expect(overEnvelope(1000, 600, between.x, between.y, true)).toBe(true);
        expect(envelopeBearingAt(1000, 600, large.x + 100, large.y, true)).toBeCloseTo(0, 9);
        // Grown, it is held by its whole window, which covers the small disc it
        // grew from: a pointer on the small one's bottom-right edge keeps it grown.
        expect(overEnvelope(1000, 600, small.x + 38, small.y + 38, true)).toBe(true);
        // On a canvas too small for it, it grows only as far as there is room:
        // here half of 260 less its margins, caption and pointed-at value, 96 px,
        // centred at (188, 130), in a window reaching 8 px beyond that.
        expect(overEnvelope(300, 260, 188, 130 + 95, true)).toBe(true);
        expect(overEnvelope(300, 260, 188 - 96 - 7, 130, true)).toBe(true);
        expect(overEnvelope(300, 260, 188 - 96 - 9, 130, true)).toBe(false);
    });
});
