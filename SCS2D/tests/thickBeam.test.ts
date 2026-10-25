import { describe, expect, it } from "vitest";
import {
    BeamHits,
    Beams,
    HULL_LAYER,
    Projectiles,
    Ships,
    SpatialGrid,
    WEAPONS_LAYER,
    World,
    compileBlueprint,
    type Blueprint,
} from "../sim/index.js";
import { TURRET_CORVETTE } from "./fixtures.js";

/** A thick hull beam fires a beam in each layer, each with half its power. */

const DT = 1 / 60;

function beamer(thick: boolean): Blueprint {
    return {
        name: "Beamer",
        modules: [
            { kind: "core", x: 0, y: 0, length: 1, width: 1 },
            { kind: "structure", x: 1, y: 0, length: 1, width: 10 },
            { kind: "hullBeam", x: 4.5, y: 2.5, angle: 0, length: 6, width: 4, thick },
            { kind: "generator", x: -2.5, y: 0, length: 4, width: 1 },
        ],
    };
}

/** The beams the ship has lit the first step it fires: their layers and power. */
function firstShot(thick: boolean): { layers: number; power: number }[] {
    const design = compileBlueprint(beamer(thick));
    const world = new World({ dt: DT, seed: 6 });
    const ships = new Ships();
    world.addForceProvider(ships.forceProvider());
    const beams = new Beams(16);
    const hits = new BeamHits();
    const grid = new SpatialGrid(64);
    const me = ships.spawn(world, { design, x: 0, y: 0, team: 0 });
    const foe = ships.spawn(world, { design: compileBlueprint(TURRET_CORVETTE), x: 850, y: 0, team: 1, invulnerable: true });
    ships.pushOrder(me, foe, 750, 950, 10);
    for (let s = 0; s < 30 / DT; s++) {
        ships.command(DT, world);
        grid.rebuild(world.bodies);
        beams.clear();
        hits.clear();
        ships.fire(world, new Projectiles(16), beams, grid, hits);
        const lit: { layers: number; power: number }[] = [];
        for (let i = 0; i < beams.highWater; i++)
            if (beams.alive[i] === 1 && beams.bounces[i] === 0) lit.push({ layers: beams.layers[i]!, power: beams.power[i]! });
        if (lit.length > 0) return lit;
    }
    return [];
}

describe("a thick hull beam", () => {
    it("fires a beam in each layer, with half its power each", () => {
        const power = compileBlueprint(beamer(true)).turrets[0]!.gun.beamPower;
        const lit = firstShot(true);
        expect(lit.map((b) => b.layers).sort()).toEqual([HULL_LAYER, WEAPONS_LAYER].sort());
        for (const beam of lit) expect(beam.power).toBeCloseTo(power / 2, 6);
    });

    it("where a thin one fires one, in the hull layer, with all of it", () => {
        const power = compileBlueprint(beamer(false)).turrets[0]!.gun.beamPower;
        expect(firstShot(false)).toEqual([{ layers: HULL_LAYER, power }]);
    });
});
