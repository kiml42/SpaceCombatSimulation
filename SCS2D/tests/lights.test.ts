import { describe, expect, it } from "vitest";
import { LIGHTS, roundLight } from "../scenarios/lights.js";
import { SCENES } from "../scenarios/scenes.js";
import type { Light } from "../render/light.js";

/** Drawable: how dark or tinted is left to taste, down to black shadows. */
const valid = (light: Light): void => {
    expect(light.colour).toMatch(/^#[0-9a-f]{6}$/);
    expect(light.ambient).toBeGreaterThanOrEqual(0);
    expect(light.ambient).toBeLessThanOrEqual(1);
};

describe("battle lights", () => {
    it("sees each scene in a light of its own, the scenes together showing the range", () => {
        const seen = SCENES.map((scene) => scene.create().light);
        for (const light of seen) {
            expect(light).toBeDefined();
            valid(light!);
        }
        expect(new Set(seen).size).toBe(Object.keys(LIGHTS).length);
    });

    it("draws a skirmish round's light from its seed: the same each time, and different round to round", () => {
        expect(roundLight(1234)).toEqual(roundLight(1234));
        const drawn = Array.from({ length: 64 }, (_, seed) => roundLight(seed));
        for (const light of drawn) {
            valid(light);
            expect(light.from).toBeGreaterThanOrEqual(0);
            expect(light.from).toBeLessThan(2 * Math.PI);
        }
        expect(new Set(drawn.map((light) => light.colour)).size).toBeGreaterThan(32);
        // More often dark than soft.
        expect(drawn.filter((light) => light.ambient < 0.3).length).toBeGreaterThan(drawn.length / 2);
        // From every quarter.
        expect(new Set(drawn.map((light) => Math.floor(light.from / (Math.PI / 2)))).size).toBe(4);
    });
});
