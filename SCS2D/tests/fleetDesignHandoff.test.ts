import { describe, expect, it } from "vitest";
import { expandFleet, serialiseFleet } from "../sim/index.js";
import { LINE_OF_BATTLE } from "../scenarios/fleets.js";
import { newSkirmish } from "../scenarios/skirmish.js";
import { replaceDesign, replacedName } from "../editor/fleetEdit.js";
import { designHref, fleetHref, handedDesign, handedToFleet } from "../editor/handoff.js";

describe("a fleet design edited in the ship editor", () => {
    it("goes back to every ship of it, in groups too", () => {
        const dinky = LINE_OF_BATTLE.designs["Dinky"]!;
        const changed = replaceDesign(LINE_OF_BATTLE, "Dinky", { ...dinky, notes: "changed" });
        expect(changed.designs["Dinky"]!.notes).toBe("changed");
        expect(expandFleet(changed)).toHaveLength(expandFleet(LINE_OF_BATTLE).length);
        expect(LINE_OF_BATTLE.designs["Dinky"]!.notes).not.toBe("changed");
    });

    it("takes every ship of it along when renamed", () => {
        const renamed = replaceDesign(LINE_OF_BATTLE, "Dinky", { ...LINE_OF_BATTLE.designs["Dinky"]!, name: "Dinky II" });
        expect(renamed.designs["Dinky"]).toBeUndefined();
        expect(renamed.designs["Dinky II"]!.name).toBe("Dinky II");
        const designs = expandFleet(renamed).map((ship) => ship.design);
        expect(designs).toContain("Dinky II");
        expect(designs).not.toContain("Dinky");
        expect(designs.filter((d) => d === "Dinky II")).toHaveLength(
            expandFleet(LINE_OF_BATTLE).filter((ship) => ship.design === "Dinky").length,
        );
    });

    it("keeps its old name rather than take another design of the fleet", () => {
        const clash = { ...LINE_OF_BATTLE.designs["Dinky"]!, name: "Gunship" };
        expect(replacedName(LINE_OF_BATTLE, "Dinky", clash)).toBe("Dinky");
        const kept = replaceDesign(LINE_OF_BATTLE, "Dinky", clash);
        expect(kept.designs["Dinky"]!.name).toBe("Dinky");
        expect(kept.designs["Gunship"]).toEqual(LINE_OF_BATTLE.designs["Gunship"]);
    });
});

const search = (href: string): URLSearchParams => new URLSearchParams(href.slice(href.indexOf("?")));

describe("handing a fleet design over and back", () => {
    it("round-trips the fleet, the design and the skirmish", () => {
        const skirmish = newSkirmish(LINE_OF_BATTLE, LINE_OF_BATTLE, 4);
        const href = designHref({ fleet: LINE_OF_BATTLE, design: "Corvette", skirmish });
        expect(href).toMatch(/^index\.html#\/ship\?design=/);
        const back = handedDesign(search(href))!;
        expect(back.design).toBe("Corvette");
        expect(serialiseFleet(back.fleet)).toEqual(serialiseFleet(LINE_OF_BATTLE));
        expect(back.skirmish?.seed).toBe(4);
        expect(handedDesign(new URLSearchParams("fleet=x"))).toBeNull();
    });

    it("refuses a design the fleet does not have", () => {
        const handed = new URLSearchParams({ design: JSON.stringify({ fleet: serialiseFleet(LINE_OF_BATTLE), design: "Nothing" }) });
        expect(() => handedDesign(handed)).toThrow(/no design/);
    });

    it("goes back to the fleet editor as the fleet, or as the skirmish it is in", () => {
        const plain = fleetHref(LINE_OF_BATTLE);
        expect(plain).toMatch(/^index\.html#\/fleet\?fleet=/);
        expect(handedToFleet(search(plain))).toMatchObject({ fleet: { name: LINE_OF_BATTLE.name }, skirmish: null });
        const inSkirmish = fleetHref(LINE_OF_BATTLE, newSkirmish(LINE_OF_BATTLE, LINE_OF_BATTLE, 1));
        expect(inSkirmish).toMatch(/^index\.html#\/fleet\?skirmish=/);
        expect(handedToFleet(search(inSkirmish))?.skirmish?.seed).toBe(1);
        expect(handedToFleet(new URLSearchParams())).toBeNull();
    });
});
