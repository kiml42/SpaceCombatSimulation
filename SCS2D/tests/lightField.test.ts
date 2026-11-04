import { describe, expect, it } from "vitest";
import { Lights } from "../render/glows.js";
import { LIGHT_REACH, LightField } from "../render/lightField.js";

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
const at = (field: LightField, x: number, y: number): [number, number, number] => {
    field.at(x, y, light);
    return [light.r, light.g, light.b];
};

describe("the light at a point", () => {
    it("is a light's full colour at its middle, fading to nothing as far out as it reaches", () => {
        const lights = new Lights();
        lights.point(IDENTITY, 400, 300, 5, "#ff8000", 0.5);
        const field = fieldOf(lights);
        expect(at(field, 0, 0)).toEqual([0.5, 0.5 * (128 / 255), 0]);
        const reach = 5 * LIGHT_REACH;
        expect(at(field, reach / 2, 0)[0]).toBeGreaterThan(0);
        expect(at(field, reach / 2, 0)[0]).toBeLessThan(0.5);
        expect(field.at(reach, 0, light)).toBe(false);
        expect(field.at(0, -reach - 1, light)).toBe(false);
    });

    it("is put back in the world through the camera the lights were seen through", () => {
        const lights = new Lights();
        // A pixel to the right of the middle and two up, at two pixels to the metre.
        lights.point(IDENTITY, 402, 296, 1, "#ffffff", 1);
        const field = fieldOf(lights, { x: 10, y: 20, scale: 2 });
        expect(at(field, 11, 22)).toEqual([1, 1, 1]);
        // Reaching half as many metres as pixels.
        expect(field.at(11 + LIGHT_REACH / 2, 22, light)).toBe(false);
    });

    it("is as bright all along a line, and round its ends", () => {
        const lights = new Lights();
        lights.line(IDENTITY, 380, 300, 420, 300, 4, "#ffffff", 1);
        const field = fieldOf(lights);
        expect(at(field, -20, 0)).toEqual([1, 1, 1]);
        expect(at(field, 0, 0)).toEqual([1, 1, 1]);
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

    it("adds lights together, but no brighter than white", () => {
        const lights = new Lights();
        lights.point(IDENTITY, 400, 300, 5, "#ffffff", 0.7);
        lights.point(IDENTITY, 400, 300, 5, "#ffffff", 0.7);
        expect(at(fieldOf(lights), 0, 0)).toEqual([1, 1, 1]);
    });
});
