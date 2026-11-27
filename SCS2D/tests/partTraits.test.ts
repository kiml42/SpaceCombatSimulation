import { describe, expect, it } from "vitest";
import { compileBlueprint, DEFAULT_DOCTRINE, Ships, World, type Blueprint, type DesignTurret, type Targeting } from "../sim/index.js";
import { BOTH_LAYERS } from "../sim/hull.js";
import { aimModule } from "../sim/shipAim.js";

/** Two turrets 15 m apart off a spine, the first `size` m across. */
function pair(size = 4): Blueprint {
    return {
        name: "Pair",
        modules: [
            { kind: "core", x: 0, y: 0, length: 3, width: 3 },
            { kind: "structure", x: 14.25, y: 0, length: 25.5, width: 4 },
            { kind: "turret", x: 5, y: 2 + size / 2, length: size, width: size, barrels: 1 },
            { kind: "turret", x: 20, y: 4, length: 4, width: 4, barrels: 1 },
        ],
    };
}
const [FIRST, SECOND] = [2, 3];

const SHOOTER: Blueprint = {
    name: "Shooter",
    modules: [
        { kind: "core", x: 0, y: 0, length: 3, width: 3 },
        { kind: "turret", x: 3, y: 0, length: 3, width: 3, barrels: 1 },
    ],
};

const GUNS = { coreWeight: 0, engineWeight: 0, gunWeight: 100, structureWeight: 0, clusterWeight: 0 };

/**
 * The module the shooter's turret picks on the pair, 300 m off its side and
 * nearest its second turret, after `setUp` has had its way with the target.
 */
function pick(
    targeting: Partial<Targeting>,
    target: Blueprint = pair(),
    setUp: (ships: Ships, world: World, target: number) => void = () => {},
): number {
    const world = new World({ dt: 1 / 60, seed: 1 });
    const ships = new Ships();
    const shooterDesign = compileBlueprint(SHOOTER);
    const mount = { ...shooterDesign.turrets[0]!, targeting: { ...DEFAULT_DOCTRINE.targeting, ...GUNS, ...targeting } };
    (shooterDesign.turrets as DesignTurret[])[0] = mount;
    const shooter = ships.spawn(world, { design: shooterDesign, x: 40, y: 300, angle: 0, team: 0 });
    const t = ships.spawn(world, { design: compileBlueprint(target), x: 0, y: 0, angle: 0, team: 1 });
    ships.bodyStore = world.bodies;
    setUp(ships, world, t);
    return aimModule(ships, world.bodies, shooter, mount, BOTH_LAYERS, t, 40, 300);
}

describe("a mount ranking parts of one kind", () => {
    it("by kind alone, takes the nearest", () => {
        expect(pick({})).toBe(SECOND);
        expect(pick({}, pair(6))).toBe(SECOND);
    });

    it("takes the bigger part by largePartWeight", () => {
        expect(pick({ largePartWeight: 100 }, pair(6))).toBe(FIRST);
        expect(pick({ largePartWeight: -100 }, pair(6))).toBe(SECOND);
    });

    it("takes the longer-ranged gun by longRangeWeight", () => {
        const longer = (ships: Ships, _world: World, t: number) => {
            const turrets = ships.designs[t]!.turrets as DesignTurret[];
            const first = turrets.findIndex((mount) => mount.module === FIRST);
            turrets[first] = { ...turrets[first]!, reach: 2 * turrets[first]!.reach };
        };
        expect(pick({}, pair(), longer)).toBe(SECOND);
        expect(pick({ longRangeWeight: 100 }, pair(), longer)).toBe(FIRST);
    });

    it("takes the gun pointed at it by pointedWeight", () => {
        const aimed = (ships: Ships, _world: World, t: number) => {
            const turrets = ships.designs[t]!.turrets;
            for (let m = 0; m < turrets.length; m++) {
                // Towards the shooter, off the target's side, or away from it.
                ships.turrets.bearing[ships.turretIndex[t]![m]!] = turrets[m]!.module === FIRST ? Math.PI / 2 : -Math.PI / 2;
            }
        };
        expect(pick({}, pair(), aimed)).toBe(SECOND);
        expect(pick({ pointedWeight: 100 }, pair(), aimed)).toBe(FIRST);
    });

    it("takes the part with least left to take by weakPartWeight", () => {
        const hurt = (ships: Ships, world: World, t: number) => {
            const tb = world.bodies.indexOf(ships.bodyIds[t]!);
            ships.damage.absorb(tb, FIRST, 0.6 * ships.damage.capacityOf(tb, FIRST));
        };
        expect(pick({}, pair(), hurt)).toBe(SECOND);
        expect(pick({ weakPartWeight: 100 }, pair(), hurt)).toBe(FIRST);
    });

    it("never takes a part its kind refuses, however it ranks", () => {
        expect(pick({ gunWeight: 0, coreWeight: 100, largePartWeight: 1000 }, pair(6))).toBe(0);
    });
});
