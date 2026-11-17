import { describe, expect, it } from "vitest";
import { blueprintProblem, compileBlueprint, type Blueprint } from "../sim/blueprint.js";
import type { Fleet } from "../sim/fleet.js";
import { repairBlueprint, repairFleet } from "../sim/repair.js";
import { GUNSHIP } from "../scenarios/blueprints.js";
import { newSkirmish, parseSkirmish, serialiseSkirmish } from "../scenarios/skirmish.js";

const adrift: Blueprint = {
    ...GUNSHIP,
    name: "Adrift",
    modules: [...GUNSHIP.modules, { kind: "engine", x: 0, y: 200, length: 3, width: 3 }],
};
const lone = (design: Blueprint): Fleet => ({
    name: design.name,
    designs: { [design.name]: design },
    ships: [{ design: design.name, x: 0, y: 0 }],
});

describe("repairBlueprint", () => {
    it("leaves a valid design as it is", () => {
        expect(repairBlueprint(GUNSHIP)).toEqual({ blueprint: GUNSHIP, dropped: [] });
    });

    it("drops a module that touches nothing, and keeps the rest", () => {
        const repaired = repairBlueprint(adrift)!;
        expect(repaired.dropped).toEqual([expect.stringMatching(/touches nothing/)]);
        expect(repaired.blueprint.modules).toEqual(GUNSHIP.modules);
        expect(blueprintProblem(repaired.blueprint)).toBeNull();
    });

    it("gives up on a layout with no core", () => {
        const coreless: Blueprint = { name: "Coreless", modules: GUNSHIP.modules.filter((m) => !("kind" in m) || m.kind !== "core") };
        expect(repairBlueprint(coreless)).toBeNull();
    });
});

describe("repairFleet", () => {
    it("repairs a design, saying so in its notes", () => {
        const { fleet, repairs } = repairFleet(lone(adrift));
        expect(repairs).toEqual(["Adrift lost 1 part to fit the rules"]);
        expect(fleet.designs["Adrift"]!.notes).toMatch(/Repaired on loading/);
        expect(() => compileBlueprint(fleet.designs["Adrift"]!)).not.toThrow();
    });

    it("leaves out the ships of a design past repair", () => {
        const coreless: Blueprint = { name: "Coreless", modules: [{ kind: "structure", x: 0, y: 0, length: 4, width: 4 }] };
        const fleet: Fleet = { ...lone(GUNSHIP), designs: { [GUNSHIP.name]: GUNSHIP, Coreless: coreless } };
        fleet.ships = [...fleet.ships, { design: "Coreless", x: 50, y: 0 }];
        const repaired = repairFleet(fleet);
        expect(repaired.fleet.ships).toEqual([{ design: GUNSHIP.name, x: 0, y: 0 }]);
    });
});

it("a skirmish holding a design the rules no longer accept still loads, repaired", () => {
    const begun = newSkirmish(lone(GUNSHIP), lone(GUNSHIP), 5);
    // Saved while it was valid, under rules that have since moved.
    const kept = serialiseSkirmish({ ...begun, enemy: lone(adrift) });
    const loaded = parseSkirmish(JSON.parse(JSON.stringify(kept)));
    expect(blueprintProblem(loaded.enemy.designs["Adrift"]!)).toBeNull();
});
