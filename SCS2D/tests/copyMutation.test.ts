import { describe, expect, it } from "vitest";
import { mutate } from "../evolution/mutate.js";
import { Rng } from "../sim/rng.js";
import { compileBlueprint, type Blueprint } from "../sim/index.js";
import { BLUEPRINTS } from "../scenarios/blueprints.js";

/**
 * How many of a layout's engines have nothing of their own in their flame, near
 * enough: a sliver from positions rounded to a tenth of a millimetre is not a copy
 * stacked in front of one.
 */
function clear(blueprint: Blueprint): number {
    return compileBlueprint(blueprint).engines.filter((t) => (t.escaping ?? 1) > CLEAR).length;
}

const CLEAR = 0.999;

/**
 * Sensitive to what can mutate, as `mutation.test.ts` is: a new kind, knob or
 * switch changes the random numbers drawn for everything after it.
 */
describe("copying an engine", () => {
    // Over two minutes alone, so a loaded CI runner needs room beyond that.
    it("puts the copy beside it, firing the same way, so no clear flame is ever blocked by it", { timeout: 480_000 }, () => {
        // A copy bolted on pointing out of a face sat in its original's flame when
        // that face was the bell's: most copied engines stacked up end to end.
        let copies = 0;
        for (const name of ["corvette", "gunship", "beamCorvette", "catamaran", "torch"] as const) {
            // Enough seeds that the count does not hang on which kinds a run can draw.
            for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
                const rng = new Rng(seed * 7919 + name.length);
                let held: Blueprint = BLUEPRINTS[name];
                for (let g = 0; g < 300; g++) {
                    // Structure alone, so a copy is a child's only edit; no thrusters,
                    // whose flames a copy beside its original does not look out for.
                    const child = mutate(held, rng, {
                        thrusters: 0,
                        build: { move: 0, resize: 0, refit: 0, fittings: 0, tuning: 0, fighter: 0, shape: 0 },
                        doctrine: { targeting: 0, approach: 0, escort: 0, avoidance: 0, gunnery: 0 },
                    });
                    if (child.edits.length === 1 && /engine: copied onto/.test(child.edits[0]!)) {
                        copies++;
                        expect(clear(child.blueprint)).toBeGreaterThanOrEqual(clear(held));
                    }
                    held = child.blueprint;
                }
            }
        }
        expect(copies).toBeGreaterThan(5);
    });
});
