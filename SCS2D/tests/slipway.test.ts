import { describe, expect, it } from "vitest";
import {
    blueprintProblems,
    compileBlueprint,
    expandBlueprint,
    fleetBlueprint,
    math,
    padFighterNames,
    parseBlueprint,
    serialiseBlueprint,
    withFleetFighters,
    type Blueprint,
    type ModuleSpec,
} from "../sim/index.js";
import { CORVETTE, DINKY, SCAVENGER } from "../scenarios/blueprints.js";
import { addShip, emptyFleet, forkDesign } from "../editor/fleetEdit.js";
import { dockFighter, renameShip } from "../editor/edit.js";

const { PI } = math;

/** Slipways: a hull module that builds ships alongside (ROADMAP.md §8 step 12, slice 3). */

const SLIPWAY = 2;

/** A core, a hold, and a slipway facing forward that keeps `keep` of `craft`. */
function yard(craft: Blueprint = SCAVENGER, keep = 1, slipway: Partial<ModuleSpec> = {}, more: ModuleSpec[] = []): Blueprint {
    return {
        name: "Yard",
        modules: [
            { kind: "core", x: 0, y: 0, length: 4, width: 4 },
            { kind: "hold", x: -4, y: 0, length: 4, width: 6 },
            { kind: "slipway", x: 4, y: 0, angle: 0, length: 4, width: 6, craft: craft.name, keep, ...slipway },
            ...more,
        ],
        hangar: { [craft.name]: craft },
    };
}

/** Short and broad: 2 m bow to stern and 8 m across the beam, wider than the yard's slipway. */
const BAR: Blueprint = {
    name: "Bar",
    modules: [
        { kind: "core", x: 0, y: 0, length: 2, width: 2 },
        { kind: "structure", x: 0, y: 2.5, length: 2, width: 3 },
        { kind: "structure", x: 0, y: -2.5, length: 2, width: 3 },
    ],
};

/** A core with a slipway astern as wide as it is, keeping one of `craft`, by default itself. */
function builder(name: string, craft = name, hangar?: Blueprint["hangar"]): Blueprint {
    return {
        name,
        modules: [
            { kind: "core", x: 0, y: 0, length: 4, width: 4 },
            { kind: "slipway", x: -3, y: 0, angle: PI, length: 2, width: 4, craft, keep: 1 },
        ],
        ...(hangar === undefined ? {} : { hangar }),
    };
}

describe("a slipway", () => {
    it("builds a ship no wider than it, out into clear space", () => {
        expect(blueprintProblems(yard())).toEqual([]);
        const design = compileBlueprint(yard(SCAVENGER, 2));
        expect(design.yards?.map((y) => [y.slipway, y.design.name, y.keep])).toEqual([[SLIPWAY, SCAVENGER.name, 2]]);
        expect(design.builds).toBeUndefined();
    });

    it("builds nothing that keeps none, and is a plain module that names nothing", () => {
        expect(compileBlueprint(yard(SCAVENGER, 0)).yards).toBeUndefined();
        const bare = yard();
        const { craft: _, keep: __, ...slipway } = bare.modules[SLIPWAY] as ModuleSpec;
        expect(blueprintProblems({ ...bare, modules: [...bare.modules.slice(0, 2), slipway], hangar: {} })).toEqual([]);
    });

    it("refuses a fighter, a ship wider than it, and one that stands higher than it", () => {
        expect(blueprintProblems(yard(DINKY)).join()).toMatch(/Dinky is a fighter, which a pad builds/);
        expect(blueprintProblems(yard(SCAVENGER, 1, { width: 4 })).join()).toMatch(
            /5\.0 m across the beam, wider than this slipway \(4\.0 m\)/,
        );
        const corvette = yard(CORVETTE, 1, { width: 16, x: 6, length: 8 });
        expect(blueprintProblems(corvette).join()).toMatch(/stands in the weapons layer, so this slipway must be thick/);
        const thick = yard(CORVETTE, 1, { width: 16, x: 6, length: 8, thick: true });
        expect(blueprintProblems(thick)).toEqual([]);
    });

    it("refuses to build into its own ship", () => {
        const blocked = yard(SCAVENGER, 1, {}, [{ kind: "structure", x: 14, y: 0, length: 2, width: 2 }]);
        expect(blueprintProblems(blocked).join()).toMatch(/11\.0 m it builds Scavenger out into is not clear of this ship's hull/);
        // A rail along the strip, beside it, is clear of it.
        const beside = yard(SCAVENGER, 1, {}, [{ kind: "structure", x: 9, y: 4, length: 10, width: 2 }]);
        expect(blueprintProblems(beside)).toEqual([]);
    });

    it("names one that is in its hangar", () => {
        expect(blueprintProblems({ ...yard(), hangar: {} }).join()).toMatch(/no ship named Scavenger in the hangar/);
    });

    it("keeps its craft and count in a file, and never sets out with one docked", () => {
        const raw = serialiseBlueprint({
            ...yard(SCAVENGER, 2),
            modules: yard(SCAVENGER, 2).modules.map((m, i) => (i === SLIPWAY ? { ...m, docked: true } : m)),
        });
        const written = (raw as { modules: Record<string, unknown>[] }).modules[SLIPWAY]!;
        expect(written).toMatchObject({ craft: SCAVENGER.name, keep: 2 });
        expect(written["docked"]).toBeUndefined();
        expect(parseBlueprint(JSON.parse(JSON.stringify(raw))).modules[SLIPWAY]).toMatchObject({ craft: SCAVENGER.name, keep: 2 });
    });

    it("is given its craft by the editor without being docked", () => {
        const bare = yard();
        const { craft: _, keep: __, ...slipway } = bare.modules[SLIPWAY] as ModuleSpec;
        const given = dockFighter(
            { ...bare, modules: [...bare.modules.slice(0, 2), slipway], hangar: {} },
            [{ index: SLIPWAY, copy: 0 }],
            SCAVENGER,
        )!;
        expect(given.modules[SLIPWAY]).toMatchObject({ craft: SCAVENGER.name });
        expect((given.modules[SLIPWAY] as ModuleSpec).docked).toBeUndefined();
        expect(Object.keys(given.hangar ?? {})).toEqual([SCAVENGER.name]);
    });

    it("in a fleet builds the fleet’s design of its craft", () => {
        expect(padFighterNames(yard())).toEqual([SCAVENGER.name]);
        const fleet = addShip(emptyFleet("F"), yard(), 0, 0);
        expect(Object.keys(fleet.designs).sort()).toEqual([SCAVENGER.name, "Yard"]);
        expect(fleet.designs["Yard"]!.hangar).toBeUndefined();
    });

    it("lays a ship out side first when it is turned, so one broader than it is long fits", () => {
        expect(blueprintProblems(yard(BAR)).join()).toMatch(/8\.0 m across the beam, wider than this slipway \(6\.0 m\)/);
        expect(blueprintProblems(yard(BAR, 1, { craftAngle: PI / 2 }))).toEqual([]);
        expect(blueprintProblems(yard(BAR, 1, { craftAngle: -PI / 2 }))).toEqual([]);
        // Turned, it comes out its beam first, so its beam is what must be clear ahead.
        const blocked = yard(BAR, 1, { craftAngle: PI / 2 }, [{ kind: "structure", x: 11, y: 0, length: 2, width: 2 }]);
        expect(blueprintProblems(blocked).join()).toMatch(/8\.0 m it builds Bar out into is not clear/);
        // And one longer than the slipway is wide no longer fits.
        expect(blueprintProblems(yard(SCAVENGER, 1, { craftAngle: PI / 2 })).join()).toMatch(
            /across this slipway, wider than this slipway/,
        );
    });

    it("keeps which way it lays its ship in a file, in degrees, and lays it the other way mirrored", () => {
        const raw = serialiseBlueprint(yard(BAR, 1, { craftAngle: PI / 2 }));
        expect((raw as { modules: Record<string, unknown>[] }).modules[SLIPWAY]!["craftAngle"]).toBe(90);
        expect((parseBlueprint(JSON.parse(JSON.stringify(raw))).modules[SLIPWAY] as ModuleSpec).craftAngle).toBeCloseTo(PI / 2, 12);
        const plain = yard(BAR, 1, { craftAngle: PI / 2 });
        const mirrored: Blueprint = {
            ...plain,
            modules: [{ use: "Yard", x: 0, y: 0, mirror: true }],
            assemblies: { Yard: { modules: plain.modules } },
        };
        expect(expandBlueprint(mirrored)[SLIPWAY]!.craftAngle).toBeCloseTo(-PI / 2, 12);
    });

    it("is turned by the editor for a ship that fits only side first", () => {
        const bare = yard();
        const { craft: _, keep: __, ...slipway } = bare.modules[SLIPWAY] as ModuleSpec;
        const empty = { ...bare, modules: [...bare.modules.slice(0, 2), slipway], hangar: {} };
        const turned = dockFighter(empty, [{ index: SLIPWAY, copy: 0 }], BAR)!;
        expect((turned.modules[SLIPWAY] as ModuleSpec).craftAngle).toBeCloseTo(PI / 2, 12);
        expect(blueprintProblems(turned)).toEqual([]);
        // Back to one that fits bow first, it is turned back.
        const back = dockFighter(turned, [{ index: SLIPWAY, copy: 0 }], SCAVENGER)!;
        expect((back.modules[SLIPWAY] as ModuleSpec).craftAngle).toBeUndefined();
    });

    it("builds the ship it is on, with nothing in its hangar", () => {
        const self = builder("Seed");
        expect(blueprintProblems(self)).toEqual([]);
        const design = compileBlueprint(self);
        expect(design.yards?.[0]?.design).toBe(design);
    });

    it("builds a design that builds it back as one design each, from one flat hangar", () => {
        const a = builder("A", "B", { B: builder("B", "A") });
        expect(blueprintProblems(a)).toEqual([]);
        const design = compileBlueprint(a);
        const b = design.yards![0]!.design;
        expect(b.name).toBe("B");
        expect(b.yards![0]!.design).toBe(design);
        // What a hangar's design builds is looked for in the same hangar.
        const c = builder("A", "B", { B: builder("B", "C") });
        expect(blueprintProblems(c).join()).toMatch(/B cannot be built: .*no ship named C in the hangar/);
    });

    it("is pointed at the ship itself by the editor without a copy, and follows it when it is renamed", () => {
        const stub = { ...builder("Seed", "Old", { Old: BAR }) };
        const self = dockFighter(stub, [{ index: 1, copy: 0 }], stub)!;
        expect((self.modules[1] as ModuleSpec).craft).toBe("Seed");
        expect(self.hangar).toBeUndefined();
        const renamed = renameShip(self, "Sprout");
        expect((renamed.modules[1] as ModuleSpec).craft).toBe("Sprout");
        expect(blueprintProblems(renamed)).toEqual([]);
    });

    it("in a fleet builds what the fleet’s designs reach, each the fleet’s, and itself as itself", () => {
        const fleet = addShip(addShip(emptyFleet("F"), builder("A", "B", { B: builder("B", "C") }), 0, 0), builder("C", "C"), 50, 0);
        expect(Object.keys(fleet.designs).sort()).toEqual(["A", "B", "C"]);
        const a = withFleetFighters(fleet.designs["A"]!, fleet.designs);
        expect(Object.keys(a.hangar ?? {}).sort()).toEqual(["B", "C"]);
        expect(a.hangar!["C"]).toBe(fleet.designs["C"]);
        expect(blueprintProblems(a)).toEqual([]);
        expect(fleetBlueprint(fleet, "C").hangar).toBeUndefined();
        // A fork of a design that builds itself builds the fork.
        const forked = forkDesign(addShip(fleet, builder("C", "C"), 100, 0), [2])!;
        expect(padFighterNames(forked.fleet.designs[forked.name]!)).toEqual([forked.name]);
    });
});
