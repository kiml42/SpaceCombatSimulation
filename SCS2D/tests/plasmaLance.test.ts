import { describe, expect, it } from "vitest";
import {
    BeamHits,
    Beams,
    BEAM_PLASMA,
    compileBlueprint,
    LANCE_LEAK,
    LANCE_REACH_PER_METRE,
    LANCE_WORTH,
    moduleStats,
    mountTraverse,
    parseBlueprint,
    Projectiles,
    serialiseBlueprint,
    Ships,
    shotCharge,
    shotFuel,
    SpatialGrid,
    World,
    type Blueprint,
    type ModuleSpec,
} from "../sim/index.js";
import { Bodies } from "../sim/bodies.js";
import { reachAgainst } from "../sim/blueprint.js";
import { NO_OWNER } from "../sim/projectiles.js";
import { TurretState } from "../sim/turrets.js";
import { CORVETTE } from "../scenarios/blueprints.js";

const DT = 1 / 60;

const lance = (over: Partial<ModuleSpec> = {}): ModuleSpec => ({
    kind: "hullBeam",
    plasma: true,
    x: 0,
    y: 0,
    angle: 0,
    length: 6,
    width: 2,
    ...over,
});

/** The corvette with its hull gun made a lance, kept ready or not. */
function lanced(ready: boolean): Blueprint {
    return {
        ...CORVETTE,
        modules: CORVETTE.modules.map((p) =>
            "kind" in p && p.kind === "hullGun" ? { ...p, kind: "hullBeam", plasma: true, ...(ready ? { ready: true } : {}) } : p,
        ),
    };
}

/** A pulse along +x from the origin reaching `reach`, at a body at `x`: the share of it that lands. */
function landed(x: number, reach: number): number {
    const bodies = new Bodies();
    bodies.create({ x, y: 0, radius: 5, mass: 1, inertia: 1 });
    const grid = new SpatialGrid(64);
    grid.rebuild(bodies);
    const hits = new BeamHits();
    new Beams(16).fireFrom(NO_OWNER, 0, 0, 1, 0, 0.5, 1000, BEAM_PLASMA, bodies, grid, hits, undefined, -1, undefined, reach);
    return hits.count === 0 ? 0 : hits.share[0]!;
}

/** Fuel a lanced corvette spends in `seconds` alone, with nothing to shoot at. */
function idleFuel(ready: boolean, seconds: number): { spent: number; pulse: number } {
    const design = compileBlueprint(lanced(ready));
    const world = new World({ dt: DT, seed: 2 });
    const ships = new Ships();
    world.addForceProvider(ships.forceProvider());
    const ship = ships.spawn(world, { design, x: 0, y: 0 });
    const b = world.bodies.indexOf(ships.body(ship));
    for (let i = 0; i < seconds / DT; i++) ships.command(DT, world);
    return { spent: ships.fuel.spentMass(b), pulse: shotFuel(design.turrets[0]!.gun) };
}

describe("a plasma lance", () => {
    it("hits harder on more fuel the wider it is, and reaches further on more power the longer it is", () => {
        const base = moduleStats(lance()).gun!;
        const wide = moduleStats(lance({ width: 4 })).gun!;
        const long = moduleStats(lance({ length: 12 })).gun!;
        expect(wide.beamPower).toBeGreaterThan(base.beamPower);
        expect(shotFuel(wide)).toBeGreaterThan(shotFuel(base));
        expect(wide.jetThrust).toBeGreaterThan(base.jetThrust);
        expect(long.plasmaReach - base.plasmaReach).toBeCloseTo(LANCE_REACH_PER_METRE * 6, 9);
        expect(shotCharge(long)).toBeGreaterThan(shotCharge(base));
        expect(shotFuel(long)).toBeCloseTo(shotFuel(base), 9);
    });

    it("does not train, and is worth firing only well inside its reach", () => {
        expect(mountTraverse(lance())).toBe(0);
        const gun = moduleStats(lance()).gun!;
        expect(reachAgainst(gun, 10)).toBeCloseTo(gun.plasmaReach * LANCE_WORTH, 9);
    });

    it("falls off along its reach, to nothing at the end of it", () => {
        const near = landed(100, 400);
        const far = landed(300, 400);
        expect(near).toBeGreaterThan(far);
        expect(near).toBeCloseTo(1 - 95 / 400, 2);
        expect(far).toBeCloseTo(1 - 295 / 400, 2);
        expect(landed(500, 400)).toBe(0);
    });

    it("is saved and read back, ready or not", () => {
        for (const ready of [true, false]) {
            const back = compileBlueprint(parseBlueprint(serialiseBlueprint(lanced(ready))));
            const spec = back.modules[back.turrets[0]!.module]!.spec;
            expect(spec.plasma).toBe(true);
            expect(spec.ready === true).toBe(ready);
        }
    });

    it("sets out charged when kept ready, and uncharged when it charges on target", () => {
        for (const ready of [true, false]) {
            const world = new World({ dt: DT, seed: 2 });
            const ships = new Ships();
            const ship = ships.spawn(world, { design: compileBlueprint(lanced(ready)), x: 0, y: 0 });
            expect(ships.turretStates[ship]![0]).toBe(ready ? TurretState.Idle : TurretState.Reloading);
        }
    });

    it("fires on what is in reach dead ahead, and is pushed back by its jet while it burns", () => {
        const design = compileBlueprint(lanced(true));
        const world = new World({ dt: DT, seed: 3 });
        const ships = new Ships();
        const ship = ships.spawn(world, { design, x: 0, y: 0, team: 0 });
        ships.spawn(world, { design: compileBlueprint(CORVETTE), x: 60, y: 0, team: 1 });
        const b = world.bodies.indexOf(ships.body(ship));
        const grid = new SpatialGrid(64);
        ships.command(DT, world);
        grid.rebuild(world.bodies);
        const before = world.bodies.vx[b]!;
        const fired = ships.fire(world, new Projectiles(16), new Beams(16), grid, new BeamHits());
        expect(fired.beamsFired).toBe(1);
        // The world never stepped, so the jet is all that moved it.
        const kick = (design.turrets[0]!.gun.jetThrust * DT) / world.bodies.mass[b]!;
        expect(world.bodies.vx[b]! - before).toBeCloseTo(-kick, 9);
    });

    it("leaks fuel while it is kept charged, and none while it waits for a target", () => {
        const ready = idleFuel(true, 10);
        expect(ready.spent).toBeGreaterThan(LANCE_LEAK * ready.pulse * 10 * 0.9);
        expect(idleFuel(false, 10).spent).toBeLessThan(ready.spent * 0.1);
    });
});
