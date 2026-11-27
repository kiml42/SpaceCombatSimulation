import { describe, expect, it } from "vitest";
import {
    engineGeometry,
    EXHAUST_VELOCITY,
    expansion,
    LEAST_THROAT_SHARE,
    MOST_THROAT_SHARE,
    moduleStats,
    NOZZLE_THROAT_FRACTION,
    NOZZLE_WALL_SLOPE,
    type ModuleSpec,
} from "../sim/index.js";

/** A big pumped engine, so neither its throat's size nor its feed decides anything here. */
const engine = (nozzle: number): ModuleSpec => ({ kind: "engine", x: 0, y: 0, length: 12, width: 3, nozzle });
const share = (nozzle: number): number => {
    const g = engineGeometry(engine(nozzle));
    return g.throatWidth / g.exitWidth;
};

describe("a bell's expansion", () => {
    it("speeds its gas the more the wider its exit over its throat, from sonic at the throat towards all of it", () => {
        // At the throat the gas is sonic: for 1.2, √(1/11) of what endless expansion would give it.
        expect(expansion(1)).toBeCloseTo(Math.sqrt(1 / 11), 9);
        let last = expansion(1);
        for (const ratio of [1.5, 2, 4, 8, 16, 100, 1000]) {
            const now = expansion(ratio);
            expect(now).toBeGreaterThan(last);
            expect(now).toBeLessThan(1);
            last = now;
        }
        // Diminishing: the first doubling is worth more than the next.
        expect(expansion(4) - expansion(2)).toBeLessThan(expansion(2) - expansion(1));
    });

    it("narrows its throat behind the same exit at its wall's slope, between a widest and a narrowest throat", () => {
        // No nozzle at all: the widest throat, a hole in a plate.
        expect(share(0)).toBeCloseTo(MOST_THROAT_SHARE, 9);
        // Along the slope between them.
        const n = 1;
        expect(share(n)).toBeCloseTo(1 - 2 * n * NOZZLE_WALL_SLOPE, 9);
        // A long bell flares more gently instead of narrowing further.
        expect(share(5)).toBeCloseTo(LEAST_THROAT_SHARE, 9);
        expect(engineGeometry(engine(5)).areaRatio).toBeCloseTo(1 / (LEAST_THROAT_SHARE * LEAST_THROAT_SHARE), 9);
    });

    it("trades flow for efficiency with length: a short bell pushes harder and wastes more, a long one the reverse", () => {
        const stats = [0.5, 1, 1.4].map((n) => moduleStats(engine(n)));
        for (let k = 1; k < stats.length; k++) {
            expect(stats[k]!.exhaustVelocity).toBeGreaterThan(stats[k - 1]!.exhaustVelocity);
            expect(stats[k]!.thrust).toBeLessThan(stats[k - 1]!.thrust);
        }
    });

    it("leaves an engine with the reference throat as fast as `EXHAUST_VELOCITY` makes it, aim and size aside", () => {
        // The length whose throat is the reference fraction, along the wall's slope.
        const n = (1 - NOZZLE_THROAT_FRACTION) / (2 * NOZZLE_WALL_SLOPE);
        const g = engineGeometry(engine(n));
        expect(g.throatWidth / g.exitWidth).toBeCloseTo(NOZZLE_THROAT_FRACTION, 9);
        const big = moduleStats(engine(n));
        // What the old law gave: no expansion term at all.
        expect(big.exhaustVelocity / (EXHAUST_VELOCITY * g.divergence)).toBeGreaterThan(0.85);
        expect(big.exhaustVelocity / (EXHAUST_VELOCITY * g.divergence)).toBeLessThanOrEqual(1);
    });
});
