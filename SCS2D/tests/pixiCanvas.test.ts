import { describe, expect, it } from "vitest";
import { BitmapText, Container, Graphics } from "pixi.js";
import { capture, Snapshot } from "../sim/snapshot.js";
import { SCENES } from "../scenarios/scenes.js";
import { draw } from "../render/canvas2d.js";
import {
    arcSweep,
    clipPolyline,
    clipToConvex,
    convexHullOrder,
    dashed,
    parseColour,
    PixiCanvas,
    screenRect,
} from "../render/pixiCanvas.js";

const square = (x0: number, y0: number, x1: number, y1: number): number[] => [x0, y0, x1, y0, x1, y1, x0, y1];

describe("PixiCanvas geometry", () => {
    it("sweeps an arc the way a canvas does", () => {
        expect(arcSweep(0, Math.PI / 2, false)).toBeCloseTo(Math.PI / 2);
        expect(arcSweep(0, -Math.PI / 2, false)).toBeCloseTo((3 * Math.PI) / 2);
        expect(arcSweep(0, Math.PI / 2, true)).toBeCloseTo((-3 * Math.PI) / 2);
        expect(arcSweep(0, 2 * Math.PI, false)).toBeCloseTo(2 * Math.PI);
        expect(arcSweep(0, 0, false)).toBe(0);
    });

    it("cuts a polygon to a convex one, wound either way", () => {
        for (const clip of [square(0, 0, 10, 10), [0, 10, 10, 10, 10, 0, 0, 0]]) {
            const cut = clipToConvex(square(5, 5, 20, 20), convexHullOrder(clip))!;
            const xs = cut.filter((_, k) => k % 2 === 0);
            const ys = cut.filter((_, k) => k % 2 === 1);
            expect(Math.min(...xs)).toBeCloseTo(5);
            expect(Math.max(...xs)).toBeCloseTo(10);
            expect(Math.min(...ys)).toBeCloseTo(5);
            expect(Math.max(...ys)).toBeCloseTo(10);
        }
        expect(clipToConvex(square(20, 20, 30, 30), convexHullOrder(square(0, 0, 10, 10)))).toBeNull();
    });

    it("keeps a line's part inside a clip, or outside one", () => {
        const box = convexHullOrder(square(0, 0, 10, 10));
        expect(clipPolyline([-5, 5, 15, 5], [{ inside: true, polys: [box] }])).toEqual([[0, 5, 10, 5]]);
        expect(clipPolyline([-5, 5, 15, 5], [{ inside: false, polys: [box] }])).toEqual([
            [-5, 5, 0, 5],
            [10, 5, 15, 5],
        ]);
        // A run along several segments stays one piece, so its corners are joined.
        expect(clipPolyline([1, 1, 9, 1, 9, 9], [{ inside: true, polys: [box] }])).toEqual([[1, 1, 9, 1, 9, 9]]);
    });

    it("dashes a line", () => {
        expect(dashed([0, 0, 10, 0], [2, 3])).toEqual([
            [0, 0, 2, 0],
            [5, 0, 7, 0],
        ]);
    });

    it("reads colours as a canvas writes them", () => {
        expect(parseColour("#ff8000")).toEqual([0xff8000, 1]);
        expect(parseColour("#ffb2a888")[1]).toBeCloseTo(0x88 / 255);
        expect(parseColour("#abc")).toEqual([0xaabbcc, 1]);
        expect(parseColour("rgba(255, 0, 51, 0.5)")).toEqual([0xff0033, 0.5]);
        expect(parseColour("rgb(1,2,3)")).toEqual([0x010203, 1]);
    });

    it("knows a box on screen from any other shape", () => {
        expect(screenRect(square(1, 2, 11, 22))).toMatchObject({ x: 1, y: 2, width: 10, height: 20 });
        expect(screenRect([0, 0, 10, 1, 10, 10, 0, 10])).toBeNull();
    });

    it("cuts a gauge's fill to its rounded track whole, however rounding leaves the track's ends", () => {
        // A track rounded by half its height meets itself at each end, two corners
        // a hair apart once transformed; cutting along that hair once sliced a
        // wedge off the fill at a random angle.
        let seed = 1;
        const random = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
        const area = (p: number[]): number => {
            let a = 0;
            for (let k = 0; k < p.length; k += 2) a += p[k]! * p[(k + 3) % p.length]! - p[(k + 2) % p.length]! * p[k + 1]!;
            return Math.abs(a) / 2;
        };
        const context = new PixiCanvas();
        const path = (): number[] => (context as unknown as { path: { points: number[] }[] }).path[0]!.points;
        for (let n = 0; n < 5000; n++) {
            context.begin();
            context.setTransform(1, 0, 0, 1, 300 * random(), 200 * random());
            context.scale(3 + random() * 50, -(3 + random() * 50));
            context.rotate(random() * 7);
            const [x, y, length, bar] = [random() * 3 - 1.5, random() * 3 - 1.5, 0.5 + random() * 2, 0.05 + random() * 0.5];
            context.beginPath();
            context.roundRect(x, y, length, bar, bar / 2);
            const track = convexHullOrder(path());
            context.beginPath();
            context.rect(x, y, length, bar);
            const fill = clipToConvex(path(), track);
            expect(fill).not.toBeNull();
            expect(area(fill!) / area(track)).toBeCloseTo(1, 6);
        }
    });
});

describe("canvas2d.ts drawn through PixiCanvas", () => {
    // Fonts are a browser's; a test only needs somewhere to put the text.
    const context = new PixiCanvas(
        () => Object.assign(new Container(), { text: "", style: {}, anchor: { set() {} } }) as unknown as BitmapText,
    );
    const ctx = context as unknown as CanvasRenderingContext2D;

    for (const scene of SCENES) {
        it(`draws ${scene.name} without missing anything a canvas has`, () => {
            const battle = scene.create();
            for (let s = 0; s < 90; s++) battle.step();
            const view = capture(new Snapshot(), battle.world, battle.ships, battle.projectiles, battle.beams);
            const first = view.ships[0]!;
            for (const scale of [0.02, 0.6]) {
                context.begin();
                draw(ctx, view, { x: first.x, y: first.y, scale }, 800, 600, undefined, "trigger", false, first.body, [], null, true);
                context.end();
                const graphics = context.root.children.filter((child) => child instanceof Graphics);
                expect(graphics.length).toBeGreaterThan(0);
            }
        });
    }
});
