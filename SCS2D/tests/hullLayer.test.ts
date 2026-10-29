import { describe, expect, it } from "vitest";
import type { Graphics } from "pixi.js";
import { capture, Snapshot } from "../sim/index.js";
import { duel } from "../scenarios/duel.js";
import { HullLayer } from "../render/hullLayer.js";

describe("the Pixi hull layer", () => {
    const battle = duel();
    const view = capture(new Snapshot(), battle.world, battle.ships, battle.projectiles, battle.beams);
    // Far enough out to see every ship.
    const camera = { x: 500, y: -200, scale: 0.001 };
    const shown = (layer: HullLayer): Graphics[] => (layer.container.children as Graphics[]).filter((g) => g.visible);

    it("places a fill for every capital module drawn, each within its ship and relative to the camera", () => {
        const layer = new HullLayer();
        layer.update(view, camera, 1000, 1000);
        let modules = 0;
        for (const ship of view.ships.slice(0, view.shipCount)) {
            if (!ship.currentStructure.fighter) modules += ship.currentStructure.modules.length;
        }
        const fills = shown(layer);
        expect(fills.length).toBe(modules);
        for (const g of fills) {
            const x = g.position.x + camera.x;
            const y = g.position.y + camera.y;
            const near = view.ships
                .slice(0, view.shipCount)
                .some((ship) => Math.hypot(x - ship.x, y - ship.y) <= ship.currentStructure.radius + 1e-3);
            expect(near).toBe(true);
            expect(g.alpha).toBeGreaterThan(0);
            expect(g.alpha).toBeLessThanOrEqual(1);
        }
    });

    it("shares one context between modules of the same spec and side", () => {
        const layer = new HullLayer();
        layer.update(view, camera, 1000, 1000);
        const fills = shown(layer);
        const contexts = new Set(fills.map((g) => g.context));
        expect(contexts.size).toBeLessThan(fills.length);
        // And keeps them from frame to frame.
        const before = fills.map((g) => g.context);
        layer.update(view, camera, 1000, 1000);
        expect(shown(layer).map((g) => g.context)).toEqual(before);
    });

    it("hides what is off screen, and reuses its fills when it comes back", () => {
        const layer = new HullLayer();
        layer.update(view, camera, 1000, 1000);
        const count = layer.container.children.length;
        layer.update(view, { x: 1e9, y: 1e9, scale: 1 }, 1000, 1000);
        expect(shown(layer).length).toBe(0);
        layer.update(view, camera, 1000, 1000);
        expect(layer.container.children.length).toBe(count);
    });
});
