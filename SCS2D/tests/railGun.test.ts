import { describe, expect, it } from "vitest";
import {
    BeamHits,
    Beams,
    compileBlueprint,
    firingPeriod,
    HULL_CALIBRE_FRACTION,
    firesShells,
    hullMountGeometry,
    moduleProblem,
    railLength,
    RAIL_BANK_POWER_PER_VOLUME,
    railBankEnergy,
    RAIL_BANK_MASS_PER_VOLUME,
    moduleThickness,
    RAIL_SETBACK_CALIBRES,
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
    volleyCharge,
    type ModuleSpec,
} from "../sim/index.js";
import { CORVETTE } from "../scenarios/blueprints.js";

const DT = 1 / 60;

const hullGun = (over: Partial<ModuleSpec> = {}): ModuleSpec => ({ kind: "hullGun", x: 0, y: 0, angle: 0, length: 6, width: 4, ...over });
const railGun = (over: Partial<ModuleSpec> = {}): ModuleSpec => hullGun({ kind: "railGun", ...over });

/** The corvette with its hull guns swapped for rail guns. */
function railed(blueprint: Blueprint): Blueprint {
    return {
        ...blueprint,
        modules: blueprint.modules.map((p) => ("kind" in p && p.kind === "hullGun" ? { ...p, kind: "railGun" as const } : p)),
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
    it("throws solid shot twice as fast as powder from a barrel as long as its rails, on charge rather than fuel", () => {
        const spec = railGun({ barrelCalibres: 5 });
        const rail = moduleStats(spec).gun!;
        const { blockLength } = hullMountGeometry(spec);
        const run = railLength(rail.calibre, blockLength, rail.barrelLength);
        // Its rails run along its block, from two calibres in from the back, and on out past it.
        expect(run).toBeCloseTo(blockLength - RAIL_SETBACK_CALIBRES * rail.calibre + rail.barrelLength, 9);
        // A powder gun of the same bore whose barrel is that long, all of it out past its block.
        const width = rail.calibre / HULL_CALIBRE_FRACTION;
        const powder = moduleStats(hullGun({ fragments: 1, width, barrelCalibres: run / rail.calibre, length: blockLength + run })).gun!;
        expect(powder.calibre).toBeCloseTo(rail.calibre, 9);
        expect(rail.muzzleSpeed).toBeCloseTo(RAIL_SPEED * powder.muzzleSpeed, 6);
        expect(rail.burst).toBeNull();
        expect(rail.casing).toBe(rail.roundMass);
        expect(shotFuel(rail)).toBe(0);
        expect(shotCharge(rail)).toBeCloseTo(rail.muzzleEnergy / RAIL_EFFICIENCY, 3);
        expect(shotCharge(powder)).toBe(0);
    });

    it("may keep its rails on its block, and braces and weighs more what reaches beyond it", () => {
        expect(moduleProblem(railGun({ barrelCalibres: 0 }))).toBeNull();
        expect(moduleProblem(hullGun({ barrelCalibres: 0 }))).not.toBeNull();
        expect(moduleStats(railGun({ barrelCalibres: 0 })).gun!.muzzleSpeed).toBeGreaterThan(0);
        const rail = moduleStats(railGun({ barrelCalibres: 10, fragments: 1 }));
        const powder = moduleStats(hullGun({ barrelCalibres: 10, fragments: 1 }));
        expect(rail.gun!.braceLength).toBeCloseTo(rail.gun!.barrelLength, 9);
        expect(powder.gun!.braceLength).toBe(0);
        expect(rail.fittingMass).toBeGreaterThan(powder.fittingMass);
    });

    it("fires as fast as its block charges its bank, not as fast as it loads", () => {
        const spec = railGun({ length: 13, width: 4, barrelCalibres: 10 });
        const gun = moduleStats(spec).gun!;
        const { blockLength } = hullMountGeometry(spec);
        expect(gun.bankPower).toBeCloseTo(RAIL_BANK_POWER_PER_VOLUME * blockLength * spec.width * moduleThickness(spec), 3);
        expect(firingPeriod(gun)).toBeCloseTo(shotCharge(gun) / gun.bankPower, 9);
        expect(gun.cycleTime).toBeLessThan(firingPeriod(gun));
        // A powder gun of the same block loads far faster than the bank charges.
        expect(firingPeriod(moduleStats(hullGun({ length: 13, width: 4, barrelCalibres: 10 })).gun!)).toBeLessThan(firingPeriod(gun));
    });

    it("takes the bore whose full shot its bank holds, which more barrel narrows", () => {
        const at = (extension: number) => {
            const spec = railGun({ length: 10, width: 4, barrelCalibres: extension });
            return { gun: moduleStats(spec).gun!, spec };
        };
        const mid = at(20);
        const long = at(40);
        // Every joule of its bank, and no more.
        expect(shotCharge(mid.gun) / railBankEnergy(mid.spec, mid.gun.calibre)).toBeCloseTo(1, 6);
        expect(shotCharge(long.gun) / railBankEnergy(long.spec, long.gun.calibre)).toBeCloseTo(1, 6);
        // A longer gun throws a lighter shot faster, for much the same energy.
        expect(long.gun.calibre).toBeLessThan(mid.gun.calibre);
        expect(long.gun.muzzleSpeed).toBeGreaterThan(mid.gun.muzzleSpeed);
        expect(shotCharge(long.gun) / shotCharge(mid.gun)).toBeCloseTo(1, 1);
    });

    it("splits its bank between its rails, a round down each at once", () => {
        const one = moduleStats(railGun({ length: 10, width: 4, barrelCalibres: 9 })).gun!;
        const three = moduleStats(railGun({ length: 10, width: 4, barrels: 3, barrelCalibres: 9 })).gun!;
        expect(volleyCharge(three) / three.bankEnergy).toBeCloseTo(1, 6);
        expect(shotCharge(three)).toBeCloseTo(shotCharge(one) / 3, -8);
        expect(three.calibre).toBeLessThan(one.calibre);
        // The same energy a minute, as its block charges it.
        expect(three.muzzleEnergy / firingPeriod(three)).toBeCloseTo(one.muzzleEnergy / firingPeriod(one), -5);
    });

    it("weighs its bank on top of its rails", () => {
        const mass = (block: number) => moduleStats(railGun({ length: block, width: 4, barrelCalibres: 0 })).mass;
        expect(mass(7) - mass(6)).toBeGreaterThan(RAIL_BANK_MASS_PER_VOLUME * 4 * moduleThickness(railGun({ width: 4 })));
    });

    it("never fires shells, whatever its fuse says", () => {
        expect(firesShells(hullGun({ fragments: 12 }))).toBe(true);
        expect(firesShells(railGun({ fragments: 12 }))).toBe(false);
    });

    it("does not train, and carries no gear to", () => {
        expect(mountTraverse(hullGun())).toBeGreaterThan(0);
        expect(mountTraverse(railGun())).toBe(0);
        expect(moduleStats(railGun()).traverseMass).toBe(0);
    });

    it("reads a hull gun marked `rail`, as files briefly wrote one, as a rail gun", () => {
        const old = { formatVersion: 2, name: "Old", modules: [{ kind: "hullGun", x: 0, y: 0, length: 6, width: 4, rail: true }] };
        const spec = parseBlueprint(old).modules[0] as ModuleSpec;
        expect(spec.kind).toBe("railGun");
        expect("rail" in spec).toBe(false);
        expect(spec.unread).toBeUndefined();
    });

    it("is saved and read back as one", () => {
        const blueprint = railed(CORVETTE);
        const back = parseBlueprint(serialiseBlueprint(blueprint));
        const rails = back.modules.filter((p) => "kind" in p && p.kind === "railGun");
        expect(rails.length).toBeGreaterThan(0);
    });

    it("fires a round down every rail in the same step", () => {
        const three: Blueprint = {
            ...CORVETTE,
            modules: CORVETTE.modules.map((p) =>
                "kind" in p && p.kind === "hullGun" ? { ...p, kind: "railGun" as const, barrels: 3 } : p,
            ),
        };
        const world = new World({ dt: DT, seed: 3 });
        const ships = new Ships();
        world.addForceProvider(ships.forceProvider());
        const projectiles = new Projectiles(256);
        const grid = new SpatialGrid(64);
        const mine = ships.spawn(world, { design: compileBlueprint(three), x: 0, y: 0, team: 0 });
        const enemy = ships.spawn(world, { design: compileBlueprint(CORVETTE), x: 600, y: 0, team: 1 });
        ships.pushOrder(mine, enemy, 500, 700, 10);
        let first = 0;
        for (let i = 0; i < 20 / DT && first === 0; i++) {
            ships.command(DT, world);
            grid.rebuild(world.bodies);
            first = ships.fire(world, projectiles, new Beams(16), grid, new BeamHits()).projectilesFired;
        }
        expect(first).toBe(3);
    });

    it("reloads on power with its tanks dry, where a powder gun fires only the round it set out with", () => {
        const guns = compileBlueprint(CORVETTE).turrets.filter((t) => t.gun.roundMass > 0).length;
        expect(firingDry(CORVETTE, 120)).toBeLessThanOrEqual(guns);
        // A big rail gun reloads as fast as its batteries and generator deliver, far slower than its loader.
        expect(firingDry(railed(CORVETTE), 120)).toBeGreaterThan(guns);
    });
});
