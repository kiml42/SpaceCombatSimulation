import { describe, expect, it } from "vitest";
import { compileBlueprint, DEFAULT_DOCTRINE, Ships, World, type Blueprint, type DesignTurret, type Targeting } from "../sim/index.js";
import { BOTH_LAYERS } from "../sim/hull.js";
import { aimModule } from "../sim/shipAim.js";

/** A core with turrets along a spine at `xs`, 4 m off it, and an engine just past the last. */
function row(name: string, xs: readonly number[]): Blueprint {
    const last = xs[xs.length - 1]!;
    return {
        name,
        modules: [
            { kind: "core", x: 0, y: 0, length: 3, width: 3 },
            { kind: "structure", x: (1.5 + last + 5) / 2, y: 0, length: last + 3.5, width: 4 },
            ...xs.map((x) => ({ kind: "turret" as const, x, y: 4, length: 4, width: 4, barrels: 1 })),
            { kind: "engine", x: last + 3.5, y: 3.5, length: 1.5, width: 3 },
        ],
    };
}
/** Three turrets 5 m apart: a miss at one lands on the next. */
const BANK = row("Bank", [10, 15, 20]);
/** Two turrets 15 m apart: a miss at one lands on nothing of the other. */
const PAIR = row("Pair", [5, 20]);
const [FIRST, SECOND, THIRD] = [2, 3, 4];

const SHOOTER: Blueprint = {
    name: "Shooter",
    modules: [
        { kind: "core", x: 0, y: 0, length: 3, width: 3 },
        { kind: "turret", x: 3, y: 0, length: 3, width: 3, barrels: 1 },
    ],
};

/**
 * The module the shooter's turret picks on `design`, 300 m off its side and nearest its last turret;
 * holding `held` of it already, if given.
 */
function pick(targeting: Partial<Targeting>, design = BANK, held?: number): number {
    const world = new World({ dt: 1 / 60, seed: 1 });
    const ships = new Ships();
    const shooterDesign = compileBlueprint(SHOOTER);
    const mount = { ...shooterDesign.turrets[0]!, targeting: { ...DEFAULT_DOCTRINE.targeting, ...targeting } };
    (shooterDesign.turrets as DesignTurret[])[0] = mount;
    const shooter = ships.spawn(world, { design: shooterDesign, x: 40, y: 300, angle: 0, team: 0 });
    const target = ships.spawn(world, { design: compileBlueprint(design), x: 0, y: 0, angle: 0, team: 1 });
    ships.bodyStore = world.bodies;
    if (held !== undefined) {
        ships.turretTarget[shooter]![0] = target;
        ships.turretAimModule[shooter]![0] = held;
    }
    return aimModule(ships, world.bodies, shooter, mount, BOTH_LAYERS, target, 40, 300);
}

const GUNS = { coreWeight: 0, engineWeight: 0, gunWeight: 100, structureWeight: 0 };

describe("a mount that counts what lies around a part", () => {
    it("by the part alone, takes the nearest of equals", () => {
        expect(pick({ ...GUNS, clusterWeight: 0 })).toBe(THIRD);
    });

    it("takes the middle of a bank, where a miss lands on the next one", () => {
        expect(pick({ ...GUNS, clusterWeight: 100 })).toBe(SECOND);
    });

    it("keeps the part it holds over one only a little better", () => {
        expect(pick({ ...GUNS, clusterWeight: 50 })).toBe(SECOND);
        expect(pick({ ...GUNS, clusterWeight: 50 }, BANK, THIRD)).toBe(THIRD);
        // But not over one much better.
        expect(pick({ ...GUNS, clusterWeight: 200 }, BANK, THIRD)).toBe(SECOND);
    });

    it("keeps off a part beside something it would rather not hit", () => {
        const spare = { ...GUNS, engineWeight: -100 };
        expect(pick({ ...spare, clusterWeight: 0 }, PAIR)).toBe(SECOND);
        expect(pick({ ...spare, clusterWeight: 100 }, PAIR)).toBe(FIRST);
        // The engine, not counting neighbours as such, is what moved it.
        expect(pick({ ...GUNS, clusterWeight: 100 }, PAIR)).toBe(SECOND);
    });
});
