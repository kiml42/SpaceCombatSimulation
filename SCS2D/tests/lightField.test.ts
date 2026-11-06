import { describe, expect, it } from "vitest";
import { Lights } from "../render/glows.js";
import { FIGHTER_SHADOW_M, THICK_SHADOW_M } from "../render/light.js";
import { LIGHT_HEADROOM, LIGHT_REACH, LIGHT_RISE, LightField, lightReach, shine } from "../render/lightField.js";

/** Lights recorded straight in canvas pixels. */
const IDENTITY = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
/** A view 800 by 600 at a pixel to the metre, centred on the world's origin, so canvas (400, 300) is (0, 0) and up is up. */
const CAMERA = { x: 0, y: 0, scale: 1 };

const fieldOf = (lights: Lights, camera = CAMERA): LightField => {
    const field = new LightField();
    field.set(lights, camera, 800, 600);
    return field;
};
const light = { r: 0, g: 0, b: 0 };
/** How a sum of light lights a surface, as the filter eases it. */
const eased = (sum: number): number => 1 - Math.exp(-Math.min(LIGHT_HEADROOM, sum));
const at = (field: LightField, x: number, y: number, surface = 0): [number, number, number] => {
    field.at(x, y, light, surface);
    return [light.r, light.g, light.b];
};
/** How much of a light of glow `radius` and `brightness` reaches the deck straight under it: it stands a share of its glow's radius up. */
const under = (radius: number, brightness: number): number =>
    brightness * shine(0, 0, 0, 0, radius * lightReach(brightness), false, radius * LIGHT_RISE);

describe("the light at a point", () => {
    it("is a light's full colour at its middle, fading to nothing as far out as it reaches", () => {
        const lights = new Lights();
        lights.point(IDENTITY, 400, 300, 5, "#ff8000", 0.5);
        const field = fieldOf(lights);
        expect(at(field, 0, 0)).toEqual([eased(under(5, 0.5)), eased(under(5, 0.5) * (128 / 255)), 0]);
        // Nearly all of it: a light stands only its glow's radius up.
        expect(under(5, 0.5)).toBeGreaterThan(0.49);
        const reach = 5 * lightReach(0.5);
        expect(at(field, reach / 2, 0)[0]).toBeGreaterThan(0);
        expect(at(field, reach / 2, 0)[0]).toBeLessThan(eased(under(5, 0.5)));
        expect(field.at(reach, 0, light)).toBe(false);
        expect(field.at(0, -reach - 1, light)).toBe(false);
    });

    it("is put back in the world through the camera the lights were seen through", () => {
        const lights = new Lights();
        // A pixel to the right of the middle and two up, at two pixels to the metre.
        lights.point(IDENTITY, 402, 296, 1, "#ffffff", 1);
        const field = fieldOf(lights, { x: 10, y: 20, scale: 2 });
        // A pixel's glow, half a metre up.
        expect(at(field, 11, 22)[0]).toBeCloseTo(eased(under(0.5, 1)), 12);
        // Reaching half as many metres as pixels.
        expect(field.at(11 + LIGHT_REACH / 2, 22, light)).toBe(false);
    });

    it("is as bright all along a line, and round its ends", () => {
        const lights = new Lights();
        lights.line(IDENTITY, 380, 300, 420, 300, 4, "#ffffff", 1);
        const field = fieldOf(lights);
        expect(at(field, -20, 0)[0]).toBeCloseTo(eased(under(4, 1)), 12);
        expect(at(field, 0, 0)[0]).toBeCloseTo(eased(under(4, 1)), 12);
        expect(at(field, 0, 6)[0]).toBeCloseTo(at(field, 26, 0)[0], 9);
    });

    it("is brightest at a cone's root, fading to its tip and gone past it, with a little behind its root", () => {
        const lights = new Lights();
        lights.coneOf(IDENTITY, 400, 300, 500, 300, 5, "#ffffff", 1);
        const field = fieldOf(lights);
        const along = [0, 25, 50, 75].map((x) => at(field, x, 0)[0]);
        for (let k = 1; k < along.length; k++) expect(along[k]).toBeLessThan(along[k - 1]!);
        expect(field.at(101, 0, light)).toBe(false);
        expect(at(field, -2, 0)[0]).toBeGreaterThan(0);
        expect(field.at(-5 * LIGHT_REACH, 0, light)).toBe(false);
    });

    it("adds lights together, easing towards full and clipped where the buffer would clip them", () => {
        const two = new Lights();
        two.point(IDENTITY, 400, 300, 5, "#ffffff", 0.7);
        two.point(IDENTITY, 400, 300, 5, "#ffffff", 0.7);
        expect(at(fieldOf(two), 0, 0)[0]).toBeCloseTo(eased(2 * under(5, 0.7)), 12);
        const many = new Lights();
        for (let k = 0; k < 2 * LIGHT_HEADROOM; k++) many.point(IDENTITY, 400, 300, 5, "#ffffff", 1);
        expect(at(fieldOf(many), 0, 0)[0]).toBeCloseTo(eased(LIGHT_HEADROOM), 12);
        expect(at(fieldOf(many), 0, 0)[0]).toBeLessThan(1);
    });
});

describe("a light above the deck", () => {
    /** A fighter's plume, a glow two metres round, flying a fighter's height over the deck at the origin. */
    const plume = (): LightField => {
        const lights = new Lights();
        lights.point(IDENTITY, 400, 300, 2, "#ffffff", 1, FIGHTER_SHADOW_M);
        return fieldOf(lights);
    };

    it("lights the hull below it more than a fighter flying level with it, which it only grazes", () => {
        const field = plume();
        for (const off of [2, 4, 6]) {
            const deck = at(field, off, 0, 0)[0];
            const fighter = at(field, off, 0, FIGHTER_SHADOW_M)[0];
            expect(deck).toBeGreaterThan(0);
            expect(fighter).toBeLessThan(deck);
        }
    });

    it("lights the thin hull it flies over more than a thick module's top beside it, which it strikes more glancingly", () => {
        const field = plume();
        const under = at(field, 0, 0, 0)[0];
        for (const off of [4, 6]) expect(at(field, off, 0, THICK_SHADOW_M)[0]).toBeLessThan(under);
        // Nearer its height, a thick top falls off faster than the deck further out.
        const ratio = (off: number): number => at(field, off, 0, THICK_SHADOW_M)[0] / at(field, off, 0, 0)[0];
        expect(ratio(6)).toBeLessThan(ratio(4));
        expect(ratio(4)).toBeLessThan(ratio(2));
    });

    it("is as thick as a flame: halfway up the hull, a capital ship's plume lights by the share of it above", () => {
        const lights = new Lights();
        // On the deck, 1.8 m round: from the deck up to 1.44 m.
        lights.point(IDENTITY, 400, 300, 1.8, "#ffffff", 1);
        const field = fieldOf(lights);
        const top = 2 * 1.8 * LIGHT_RISE;
        for (const off of [1, 3]) {
            const middle = at(field, off, 0, THICK_SHADOW_M / 2)[0];
            expect(middle).toBeGreaterThan(0);
            expect(middle).toBeLessThan(at(field, off, 0, 0)[0]);
        }
        expect(field.at(0, 0, light, top)).toBe(false);
        expect(field.at(0, 0, light, THICK_SHADOW_M)).toBe(false);
        // Nearly to its top, only a sliver of it is above.
        expect(at(field, 1, 0, top - 0.01)[0]).toBeLessThan(at(field, 1, 0, THICK_SHADOW_M / 2)[0] / 10);
    });

    it("lights nothing above its top", () => {
        const lights = new Lights();
        // On the deck, a metre round: 0.8 m thick, under a flying fighter's height.
        lights.point(IDENTITY, 400, 300, 1, "#ffffff", 1);
        expect(fieldOf(lights).at(0, 0, light, FIGHTER_SHADOW_M)).toBe(false);
        expect(fieldOf(lights).at(0, 0, light, 0)).toBe(true);
    });

    it("takes the height of its layer through the transform it was recorded in, as its glow's size", () => {
        const lights = new Lights();
        // Two pixels to the metre: a fighter's height is twice as many pixels.
        lights.point({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 }, 200, 150, 1, "#ffffff", 1, FIGHTER_SHADOW_M);
        expect(lights.height[0]).toBe(2 * FIGHTER_SHADOW_M);
    });
});

describe("how far a light reaches", () => {
    it("is further the brighter it is, as the square root, up to a most", () => {
        expect(lightReach(1)).toBe(LIGHT_REACH);
        expect(lightReach(4)).toBe(2 * LIGHT_REACH);
        expect(lightReach(0.25)).toBe(LIGHT_REACH / 2);
        expect(lightReach(1000)).toBe(lightReach(16));
        const dim = new Lights();
        dim.point(IDENTITY, 400, 300, 1, "#ffffff", 0.25);
        const bright = new Lights();
        bright.point(IDENTITY, 400, 300, 1, "#ffffff", 4);
        const between = LIGHT_REACH;
        expect(fieldOf(dim).at(between, 0, light)).toBe(false);
        expect(fieldOf(bright).at(between, 0, light)).toBe(true);
    });

    it("is nothing for a glow that lights nothing round it", () => {
        const lights = new Lights();
        lights.line(IDENTITY, 400, 300, 400, 300, 5, "#ffffff", 1, false, false, true);
        expect(fieldOf(lights).count).toBe(0);
    });
});
