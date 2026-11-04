import { describe, expect, it } from "vitest";
import { Lights } from "../render/glows.js";

/** Lights are kept in canvas pixels, recorded under whatever transform their pass was drawing in. */

describe("the lights a scene gives off", () => {
    it("are put in canvas pixels through the transform they were drawn under", () => {
        const lights = new Lights();
        // Turned a quarter, scaled by 2 and moved, as a pass drawing in a module's frame would be.
        lights.line({ a: 0, b: 2, c: -2, d: 0, e: 10, f: 20 }, 1, 0, 3, 0, 0.5, "#ffffff", 0.8);
        expect(lights.count).toBe(1);
        expect([lights.x0[0], lights.y0[0], lights.x1[0], lights.y1[0]]).toEqual([10, 22, 10, 26]);
        expect(lights.radius[0]).toBe(1);
        expect(lights.brightness[0]).toBe(0.8);
    });

    it("keep a point as a line with both ends together", () => {
        const lights = new Lights();
        lights.point({ a: 1, b: 0, c: 0, d: -1, e: 0, f: 0 }, 3, 4, 2, "#ffffff", 1);
        expect([lights.x0[0], lights.y0[0], lights.x1[0], lights.y1[0]]).toEqual([3, -4, 3, -4]);
    });

    it("can be taken on by another list, as they are, past its first room", () => {
        const m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
        const from = new Lights();
        for (let k = 0; k < 40; k++) from.point(m, k, 0, 1, "#ff8000", 0.5);
        from.coneOf(m, 0, 0, 5, 0, 2, "#ffffff", 1);
        const into = new Lights();
        into.add(from);
        into.add(from);
        expect(into.count).toBe(82);
        expect([into.x0[41 + 3], into.colour[41 + 3], into.cone[81]]).toEqual([3, "#ff8000", 1]);
        // Light that is not seen stays unseen.
        from.line(m, 0, 0, -5, 0, 2, "#ffffff", 1, false, true);
        into.clear();
        into.add(from);
        expect([into.unseen[0], into.unseen[41]]).toEqual([0, 1]);
        // A glow that lights nothing stays lightless.
        from.line(m, 0, 0, 5, 0, 2, "#ffffff", 1, false, false, true);
        into.clear();
        into.add(from);
        expect([into.lightless[41], into.lightless[42]]).toEqual([0, 1]);
    });

    it("leave out a light with nothing to show", () => {
        const lights = new Lights();
        const m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
        lights.point(m, 0, 0, 1, "#ffffff", 0);
        lights.point(m, 0, 0, 0, "#ffffff", 1);
        expect(lights.count).toBe(0);
    });

    it("hold as many as a frame gives off, and start afresh when cleared", () => {
        const lights = new Lights();
        const m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
        for (let k = 0; k < 200; k++) lights.point(m, k, 0, 1, "#ffffff", 1);
        expect(lights.count).toBe(200);
        expect(lights.x0[199]).toBe(199);
        lights.clear();
        expect(lights.count).toBe(0);
    });
});
