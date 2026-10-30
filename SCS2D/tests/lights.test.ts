import { describe, expect, it } from "vitest";
import { LIGHTS, roundLight } from "../scenarios/lights.js";
import { SCENES } from "../scenarios/scenes.js";
import type { Light } from "../render/light.js";

const channels = (colour: string): number[] => [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16));

/** Pale enough that a side's colours still read under it. */
const pale = (light: Light): void => {
    expect(light.colour).toMatch(/^#[0-9a-f]{6}$/);
    for (const c of channels(light.colour)) expect(c).toBeGreaterThanOrEqual(0xa0);
    expect(light.ambient).toBeGreaterThan(0.3);
    expect(light.ambient).toBeLessThan(0.75);
};

describe("battle lights", () => {
    it("sees each scene in a light of its own, the scenes together showing the range", () => {
        const seen = SCENES.map((scene) => scene.create().light);
        for (const light of seen) {
            expect(light).toBeDefined();
            pale(light!);
        }
        expect(new Set(seen).size).toBe(Object.keys(LIGHTS).length);
    });

    it("draws a skirmish round's light from its seed: the same each time, pale, and different round to round", () => {
        expect(roundLight(1234)).toEqual(roundLight(1234));
        const drawn = Array.from({ length: 64 }, (_, seed) => roundLight(seed));
        for (const light of drawn) {
            pale(light);
            expect(light.from).toBeGreaterThanOrEqual(0);
            expect(light.from).toBeLessThan(2 * Math.PI);
        }
        expect(new Set(drawn.map((light) => light.colour)).size).toBeGreaterThan(32);
        // From every quarter.
        expect(new Set(drawn.map((light) => Math.floor(light.from / (Math.PI / 2)))).size).toBe(4);
    });
});
