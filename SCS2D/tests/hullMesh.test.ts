import { describe, expect, it } from "vitest";
import { capture, Snapshot } from "../sim/index.js";
import { duel } from "../scenarios/duel.js";
import { channelsOf, hullTriangles, Triangles, VERTEX_FLOATS } from "../render/hullMesh.js";

describe("hull triangles for WebGL", () => {
    it("fills every capital ship, each corner within its ship and relative to the camera", () => {
        const battle = duel();
        const view = capture(new Snapshot(), battle.world, battle.ships, battle.projectiles, battle.beams);
        const camera = { x: 500, y: -200, scale: 0.1 };
        const out = new Triangles();
        hullTriangles(view, camera, out);
        expect(out.count).toBeGreaterThan(0);
        expect(out.count % 3).toBe(0);
        for (let v = 0; v < out.count; v++) {
            const x = out.data[v * VERTEX_FLOATS]! + camera.x;
            const y = out.data[v * VERTEX_FLOATS + 1]! + camera.y;
            const near = view.ships
                .slice(0, view.shipCount)
                .some((ship) => Math.hypot(x - ship.x, y - ship.y) <= ship.currentStructure.radius + 1e-3);
            expect(near).toBe(true);
            const alpha = out.data[v * VERTEX_FLOATS + 5]!;
            expect(alpha).toBeGreaterThan(0);
            expect(alpha).toBeLessThanOrEqual(1);
        }
    });

    it("reads a colour written either way", () => {
        expect(channelsOf("#ff8000")).toEqual([1, 128 / 255, 0]);
        expect(channelsOf("rgb(255, 0, 51)")).toEqual([1, 0, 0.2]);
    });
});
