import { describe, expect, it } from "vitest";
import { Allocation, compileBlueprint } from "../sim/index.js";
import { CORVETTE, STAR_DESTROYER, Y_WING } from "../scenarios/blueprints.js";
import { burnFigures, burnThrottles, envelopes, holdingAt, holdingThrottles, inUnits, pointedThrust } from "../editor/stats.js";
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

    it("burns the share of what holds the heading that the point is of the way out", () => {
        const curve = envelopes(corvette, 64);
        const angle = Math.PI / 3;
        const holding = holdingAt(curve, angle);
        // A quarter of the way out asks for a quarter of what that direction has,
        // however weak it is beside the rosette's peak.
        const gentle = pointedThrust(curve, angle, 0.25);
        expect(gentle.share).toBe(0.25);
        expect(gentle.acceleration).toBeCloseTo(0.25 * holding, 9);
        const astern = pointedThrust(curve, Math.PI, 0.5);
        expect(astern.acceleration).toBeCloseTo(0.5 * holdingAt(curve, Math.PI), 9);
        // At or past the rim, as much as holds the heading, and no more.
        expect(pointedThrust(curve, angle, 1).acceleration).toBeCloseTo(holding, 9);
        expect(pointedThrust(curve, angle, 3).share).toBe(1);
        // The throttles burned for it push that much, still without turning.
        const { fx, fy, torque } = wrench(burnThrottles(corvette, angle, gentle.acceleration, gentle.holding));
        const force = Math.hypot(fx, fy);
        expect(force / corvette.mass).toBeCloseTo(gentle.acceleration, 6);
        expect(Math.abs(torque) / (force * corvette.radius)).toBeLessThan(1e-6);
    });

    it("burns below the most that holds the heading as the battle allocates it, not the full burn scaled down", () => {
        // A Y-Wing going sideways: one side engine ahead of its centre of mass and one behind.
        const ywing = compileBlueprint(Y_WING);
        const curve = envelopes(ywing, 64);
        const angle = Math.PI / 2;
        const part = pointedThrust(curve, angle, 0.28);
        const burned = burnThrottles(ywing, angle, part.acceleration, part.holding);
        const battle = new Float64Array(ywing.engines.length);
        const force = part.acceleration * ywing.mass;
        ywing.engineLayout.allocate(0, force, 0, battle, new Allocation());
        battle.forEach((t, i) => expect(burned[i]).toBeCloseTo(t, 12));
        const scaled = holdingThrottles(ywing, angle).map((t) => t * part.share);
        expect(Array.from(burned)).not.toEqual(Array.from(scaled));
        // At the rim it is the full holding burn.
        expect(Array.from(burnThrottles(ywing, angle, part.holding, part.holding))).toEqual(Array.from(holdingThrottles(ywing, angle)));
    });

    it("costs a burn at its engines' own specific impulse, and lasts twice as long at half throttle", () => {
        const full = holdingThrottles(corvette, 0);
        const flat = burnFigures(corvette, full);
        const half = burnFigures(
            corvette,
            full.map((t) => t / 2),
        );
        expect(flat.isp).toBeGreaterThan(0);
        expect(half.isp).toBeCloseTo(flat.isp, 9);
        expect(half.endurance).toBeCloseTo(flat.endurance * 2, 6);
        expect(burnFigures(corvette, new Float64Array(corvette.engines.length)).endurance).toBe(Infinity);
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
        // Grown, it moves in by the extra width its window has either side, 40 px.
        const large = { x: 1000 - 160 - 16 - 40, y: 600 - 160 - 16 - 18 };
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
        // here half of 260 less its margins, caption and pointed-at value, 75 px,
        // centred at (169, 151), in a window reaching 8 px beyond that, and 40 more either side.
        expect(overEnvelope(300, 260, 169, 151 + 74, true)).toBe(true);
        expect(overEnvelope(300, 260, 169 - 75 - 40 - 7, 151, true)).toBe(true);
        expect(overEnvelope(300, 260, 169 - 75 - 40 - 9, 151, true)).toBe(false);
    });
});

describe("an acceleration as it is read out", () => {
    it("takes the metric prefix that puts the largest figure between 1 and 1000", () => {
        expect(inUnits([11.94], "m/s²")).toBe("11.9 m/s²");
        expect(inUnits([2.6], "m/s²")).toBe("2.60 m/s²");
        expect(inUnits([0.0031, 0.012], "m/s²")).toBe("3.1/12.0 mm/s²");
        expect(inUnits([0.00042], "m/s²")).toBe("420 µm/s²");
        expect(inUnits([1500], "m/s²")).toBe("1.50 km/s²");
        expect(inUnits([0], "m/s²")).toBe("0 m/s²");
    });

    it("reads the Star Destroyer's push astern in a fraction of a metre, not as nought", () => {
        const curve = envelopes(compileBlueprint(STAR_DESTROYER), 64);
        const astern = curve.holding[32]!;
        expect(astern).toBeGreaterThan(0);
        expect(astern).toBeLessThan(1);
        expect(inUnits([astern], "m/s²")).toMatch(new RegExp("^[1-9][0-9.]* (m|µ)m/s²$"));
    });
});
