import { describe, expect, it } from "vitest";
import { Beams, capture, compileBlueprint, Projectiles, Ships, Snapshot, World, type ShipView } from "../sim/index.js";
import { BARE_TEAM } from "../render/teams.js";
import { CORVETTE } from "../scenarios/blueprints.js";
import { isFitted, paintedSide } from "../render/moduleFills.js";

describe("a module being fitted", () => {
    it("is unhurt but unfitted in a picture, and bare metal until its fittings are in", () => {
        const corvette = compileBlueprint(CORVETTE);
        const world = new World({ dt: 1 / 60, seed: 11 });
        const ships = new Ships();
        world.addForceProvider(ships.forceProvider());
        ships.spawn(world, { design: corvette, x: 0, y: 0, team: 1 });
        const body = world.bodies.indexOf(ships.body(0));
        const module = corvette.modules.findIndex((m) => m.stats.fittingMass > 0);
        ships.damage.unfit(body, module, corvette.modules[module]!.stats.fittingMass / 2);

        const view = capture(new Snapshot(), world, ships, new Projectiles(4), new Beams(4)).ships[0]!;
        expect(view.integrity[module]).toBe(1);
        expect(view.fitted![module]).toBeCloseTo(0.5, 9);
        expect(isFitted(view, module)).toBe(false);
        expect(paintedSide(view, module)).toBe(BARE_TEAM);
        const other = module === 0 ? 1 : 0;
        expect(isFitted(view, other)).toBe(true);
        expect(paintedSide(view, other)).toBe(1);
    });

    it("is bare metal while only its walls are up", () => {
        const view = {
            team: 0,
            fitted: [1, 1],
            currentStructure: { modules: [{}, { shell: { face: 0, share: 0.5 } }] },
        } as unknown as ShipView;
        expect(isFitted(view, 0)).toBe(true);
        expect(isFitted(view, 1)).toBe(false);
        expect(paintedSide(view, 1)).toBe(BARE_TEAM);
    });
});
