import { describe, expect, it } from "vitest";
import { LIGHTS, lightOf, roundLight, startLighting, wander } from "../scenarios/lights.js";
import { Rng } from "../sim/index.js";
import { SCENES } from "../scenarios/scenes.js";
import { shadowTint, type Light } from "../render/light.js";

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

    it("starts a skirmish's wandering light as the light its first round's seed draws", () => {
        for (let seed = 0; seed < 16; seed++) {
            const drawn = roundLight(seed);
            const start = lightOf(startLighting(seed));
            expect(start.colour).toBe(drawn.colour);
            expect(start.from).toBe(drawn.from);
            // In shadow, as dark and as tinted as it was.
            const [r, g, b] = shadowTint(start);
            for (const k of [r, g, b]) expect(k).toBeCloseTo(drawn.ambient, 1);
        }
    });

    it("wanders the light a step at a time, the sun never below a tenth nor overhead or on the horizon, the ambient down to black", () => {
        const draw = new Rng(5);
        let lighting = startLighting(5);
        const seen = { dark: false, black: false, hues: new Set<number>() };
        for (let k = 0; k < 400; k++) {
            const next = wander(lighting, draw);
            expect(next.brightness).toBeGreaterThanOrEqual(0.1);
            expect(next.brightness).toBeLessThanOrEqual(1);
            expect(next.slant).toBeGreaterThanOrEqual(0.4);
            expect(next.slant).toBeLessThanOrEqual(1.4);
            expect(next.ambient).toBeGreaterThanOrEqual(0);
            expect(next.ambient).toBeLessThanOrEqual(0.8);
            for (const hue of [next.hue, next.ambientHue]) {
                expect(hue).toBeGreaterThanOrEqual(0);
                expect(hue).toBeLessThan(6);
            }
            // A step, not a jump.
            expect(Math.abs(next.brightness - lighting.brightness)).toBeLessThanOrEqual(0.15 + 1e-9);
            valid(lightOf(next));
            seen.dark ||= next.brightness < 0.2;
            seen.black ||= next.ambient < 0.02;
            seen.hues.add(Math.floor(next.ambientHue));
            lighting = next;
        }
        expect(seen.dark).toBe(true);
        expect(seen.black).toBe(true);
        expect(seen.hues.size).toBe(6);
    });

    it("tints a shadow by the ambient light over the sun's, never brighter than the light beside it", () => {
        // No ambient colour of its own: the ambient share of the sun, as before.
        expect(shadowTint({ from: 0, colour: "#ffd0a0", ambient: 0.4 })).toEqual([0.4, 0.4, 0.4]);
        // A blue glow in the shadows of a white sun.
        const [r, g, b] = shadowTint({ from: 0, colour: "#ffffff", ambient: 0.5, ambientColour: "#0000ff" });
        expect([r, g]).toEqual([0, 0]);
        expect(b).toBeCloseTo(0.5);
        // Brighter in shadow than the sun is in that channel: no brighter than lit.
        expect(shadowTint({ from: 0, colour: "#200000", ambient: 1, ambientColour: "#ffffff" })[0]).toBe(1);
    });
});
