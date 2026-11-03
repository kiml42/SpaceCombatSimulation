import { describe, expect, it } from "vitest";
import { EFFECTS_SCENES } from "../host/effectsScene.js";
import { Flashes } from "../render/flashes.js";
import { Snapshot } from "../sim/index.js";

/** The Effects route's scenes: pictures of a moment in a loop, the same every time that moment is drawn. */

describe("the effects scenes", () => {
    it("each frame something, at every moment of its loop", () => {
        const snapshot = new Snapshot();
        const flashes = new Flashes();
        for (const scene of EFFECTS_SCENES) {
            for (let t = 0; t < scene.loop; t += scene.loop / 7) {
                scene.build(t, snapshot, flashes);
                expect(snapshot.maxX, scene.name).toBeGreaterThan(snapshot.minX);
                expect(snapshot.maxY, scene.name).toBeGreaterThan(snapshot.minY);
                for (let i = 0; i < flashes.count; i++) expect(flashes.age[i]).toBeLessThan(flashes.lifetime[i]!);
            }
        }
    });

    it("draw a moment the same however it was reached", () => {
        const scene = EFFECTS_SCENES.find((each) => each.name === "Hits")!;
        const once = new Flashes();
        scene.build(0.2, new Snapshot(), once);
        const again = new Flashes();
        const snapshot = new Snapshot();
        scene.build(0.9, snapshot, again);
        scene.build(0.2, snapshot, again);
        expect(again.count).toBe(once.count);
        expect(Array.from(again.age.subarray(0, again.count))).toEqual(Array.from(once.age.subarray(0, once.count)));
    });

    it("show each flash only while it lasts", () => {
        const scene = EFFECTS_SCENES.find((each) => each.name === "Hits")!;
        const flashes = new Flashes();
        scene.build(0.05, new Snapshot(), flashes);
        expect(flashes.count).toBe(0);
        scene.build(0.15, new Snapshot(), flashes);
        expect(flashes.count).toBe(8);
    });
});
