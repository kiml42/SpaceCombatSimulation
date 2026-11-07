import { describe, expect, it } from "vitest";
import {
    BeamHits,
    Beams,
    compileBlueprint,
    firesShells,
    moduleStats,
    mountTraverse,
    parseBlueprint,
    Projectiles,
    RAIL_EFFICIENCY,
    RAIL_SPEED,
    serialiseBlueprint,
    Ships,
    shotCharge,
    shotFuel,
    SpatialGrid,
    World,
    type Blueprint,
    type ModuleSpec,
} from "../sim/index.js";
import { CORVETTE } from "../scenarios/blueprints.js";

const DT = 1 / 60;

const hullGun = (over: Partial<ModuleSpec> = {}): ModuleSpec => ({ kind: "hullGun", x: 0, y: 0, angle: 0, length: 6, width: 4, ...over });

/** The corvette with its hull guns made rail guns. */
function railed(blueprint: Blueprint): Blueprint {
    return {
        ...blueprint,
        modules: blueprint.modules.map((p) => ("kind" in p && p.kind === "hullGun" ? { ...p, rail: true } : p)),
    };
}

/** Rounds a corvette fires on a target dead ahead for `seconds`, its tanks drained first. */
function firingDry(blueprint: Blueprint, seconds: number): number {
    const design = compileBlueprint(blueprint);
    const world = new World({ dt: DT, seed: 3 });
    const ships = new Ships();
    world.addForceProvider(ships.forceProvider());
    const projectiles = new Projectiles(256);
    const beams = new Beams(16);
    const beamHits = new BeamHits();
    const grid = new SpatialGrid(64);
    const mine = ships.spawn(world, { design, x: 0, y: 0, team: 0 });
    const enemy = ships.spawn(world, { design: compileBlueprint(CORVETTE), x: 600, y: 0, team: 1 });
    ships.pushOrder(mine, enemy, 500, 700, 10);
    const body = world.bodies.indexOf(ships.body(mine));
    ships.fuel.drain(body, design.cores[0]!, ships.fuel.left(body));
    let rounds = 0;
    for (let i = 0; i < seconds / DT; i++) {
        ships.command(DT, world);
        grid.rebuild(world.bodies);
        rounds += ships.fire(world, projectiles, beams, grid, beamHits).projectilesFired;
    }
    return rounds;
}

describe("a rail gun", () => {
    it("throws solid shot twice as fast as powder from the same barrel, on charge rather than fuel", () => {
        const powder = moduleStats(hullGun({ fragments: 1 })).gun!;
        const rail = moduleStats(hullGun({ rail: true })).gun!;
        expect(rail.roundMass).toBe(powder.roundMass);
        expect(rail.muzzleSpeed).toBeCloseTo(RAIL_SPEED * powder.muzzleSpeed, 9);
        expect(rail.burst).toBeNull();
        expect(rail.casing).toBe(rail.roundMass);
        expect(shotFuel(rail)).toBe(0);
        expect(shotCharge(rail)).toBeCloseTo(rail.muzzleEnergy / RAIL_EFFICIENCY, 3);
        expect(shotCharge(powder)).toBe(0);
    });

    it("never fires shells, whatever its fuse says", () => {
        expect(firesShells(hullGun({ fragments: 12 }))).toBe(true);
        expect(firesShells(hullGun({ rail: true, fragments: 12 }))).toBe(false);
    });

    it("does not train, and carries no gear to", () => {
        expect(mountTraverse(hullGun())).toBeGreaterThan(0);
        expect(mountTraverse(hullGun({ rail: true }))).toBe(0);
        expect(moduleStats(hullGun({ rail: true })).traverseMass).toBe(0);
    });

    it("is saved and read back as one", () => {
        const blueprint = railed(CORVETTE);
        const back = parseBlueprint(serialiseBlueprint(blueprint));
        const rails = back.modules.filter((p) => "kind" in p && p.kind === "hullGun" && p.rail === true);
        expect(rails.length).toBeGreaterThan(0);
    });

    it("reloads on power with its tanks dry, where a powder gun fires only the round it set out with", () => {
        const guns = compileBlueprint(CORVETTE).turrets.filter((t) => t.gun.roundMass > 0).length;
        expect(firingDry(CORVETTE, 60)).toBeLessThanOrEqual(guns);
        // A big rail gun reloads as fast as its batteries can deliver, far slower than its loader.
        expect(firingDry(railed(CORVETTE), 60)).toBeGreaterThan(guns);
    });
});
