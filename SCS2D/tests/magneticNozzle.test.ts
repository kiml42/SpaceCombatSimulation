import { describe, expect, it } from "vitest";
import {
    compileBlueprint,
    engineGeometry,
    MAGNETIC_POWER_PER_EXIT_AREA,
    moduleStats,
    parseBlueprint,
    serialiseBlueprint,
    Ships,
    World,
    type Blueprint,
    type ModuleSpec,
} from "../sim/index.js";
import { burn } from "../sim/shipFlight.js";
import { DINKY, X_WING } from "../scenarios/blueprints.js";

const DT = 1 / 60;

/** A stubby engine: a short bell, so a lot of its jet goes sideways. */
const stubby = (over: Partial<ModuleSpec> = {}): ModuleSpec => ({ kind: "engine", x: 0, y: 0, length: 3, width: 3, nozzle: 0.2, ...over });

/** Every engine given a magnetic nozzle. */
function magnetised(blueprint: Blueprint): Blueprint {
    const visit = (list: Blueprint["modules"]): Blueprint["modules"] =>
        list.map((p) => ("kind" in p && p.kind === "engine" ? { ...p, magnetic: true } : p));
    const assemblies =
        blueprint.assemblies === undefined
            ? undefined
            : Object.fromEntries(Object.entries(blueprint.assemblies).map(([k, a]) => [k, { ...a, modules: visit(a.modules) }]));
    return { ...blueprint, modules: visit(blueprint.modules), ...(assemblies === undefined ? {} : { assemblies }) };
}

/** Each engine's throttle after one burn at full throttle, its ship's power opened as a step opens it. */
function burnt(blueprint: Blueprint): number[] {
    const design = compileBlueprint(blueprint);
    const world = new World({ dt: DT, seed: 1 });
    const ships = new Ships();
    const ship = ships.spawn(world, { design, x: 0, y: 0 });
    const b = world.bodies.indexOf(ships.body(ship));
    ships.power.open(b, DT, ships.damage);
    // One engine at a time, so a fighter's core powers the ring it has to.
    const out: number[] = [];
    for (let t = 0; t < design.engines.length; t++) {
        ships.throttles[ship]!.fill(0);
        ships.throttles[ship]![t] = 1;
        burn(ships, DT, world.bodies, ship);
        out.push(ships.throttles[ship]![t]!);
    }
    return out;
}

describe("a magnetic nozzle", () => {
    it("aims a stubby engine's whole jet, for more thrust and efficiency from the same fuel, and draws power for it", () => {
        const plain = moduleStats(stubby());
        const magnetic = moduleStats(stubby({ magnetic: true }));
        expect(magnetic.thrust).toBeGreaterThan(plain.thrust * 1.1);
        expect(magnetic.exhaustVelocity).toBeGreaterThan(plain.exhaustVelocity * 1.1);
        expect(magnetic.thrust / magnetic.exhaustVelocity).toBeCloseTo(plain.thrust / plain.exhaustVelocity, 6);
        const geometry = engineGeometry(stubby({ magnetic: true }));
        expect(magnetic.ringPower).toBeCloseTo(
            MAGNETIC_POWER_PER_EXIT_AREA * geometry.nozzles * geometry.exitWidth * geometry.exitHeight,
            3,
        );
        expect(magnetic.mass).toBeGreaterThan(plain.mass);
        expect(plain.ringPower).toBe(0);
    });

    it("takes the end of the bell, so unpowered it aims a little worse than the plain bell", () => {
        const plain = engineGeometry(stubby());
        const magnetic = engineGeometry(stubby({ magnetic: true }));
        expect(magnetic.divergence).toBe(1);
        expect(magnetic.bellLength).toBeLessThan(plain.nozzleLength);
        expect(magnetic.bellDivergence).toBeLessThan(plain.divergence);
    });

    it("is saved and read back", () => {
        const back = parseBlueprint(serialiseBlueprint(magnetised(DINKY)));
        expect(compileBlueprint(back).modules.some((m) => m.spec.magnetic === true)).toBe(true);
    });

    it("pushes with only its bell's share when there is no power to run the ring", () => {
        // A Dinky has neither generator nor battery.
        const design = compileBlueprint(magnetised(DINKY));
        const throttles = burnt(magnetised(DINKY));
        design.engines.forEach((engine, t) => {
            const bell = engineGeometry(design.modules[engine.module!]!.spec).bellDivergence;
            expect(throttles[t]).toBeCloseTo(bell, 9);
        });
    });

    it("pushes with all of it on a fighter's core", () => {
        for (const u of burnt(magnetised(X_WING))) expect(u).toBe(1);
        for (const u of burnt(X_WING)) expect(u).toBe(1);
    });
});
