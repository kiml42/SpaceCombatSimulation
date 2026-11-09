import { describe, expect, it } from "vitest";
import { compileBlueprint, masked, masksWholeArc, type Blueprint, type ModuleSpec } from "../sim/index.js";

/** A lance between two struts lying flush along its sides, with `ahead` set out past its mouth. */
function lancer(ahead: ModuleSpec[]): Blueprint {
    return {
        name: "Lancer",
        modules: [
            { kind: "core", x: -12, y: 0, length: 4, width: 8 },
            { kind: "plasmaLance", x: 0, y: 0, length: 20, width: 8 },
            { kind: "structure", x: 0, y: 4.75, length: 30, width: 1.5 },
            { kind: "structure", x: 0, y: -4.75, length: 30, width: 1.5 },
            ...ahead,
        ],
    };
}

function lanceMount(blueprint: Blueprint) {
    const design = compileBlueprint(blueprint);
    return design.turrets.find((t) => t.gun.plasmaReach > 0)!.mount;
}

describe("a lance's own ship in its way", () => {
    it("is clear ahead between struts flush along its sides and plates beside its mouth", () => {
        // The plates stand inside the lance's width but outside the gap between its prongs.
        const mount = lanceMount(
            lancer([
                { kind: "structure", x: 15, y: 3.25, length: 10, width: 1.5 },
                { kind: "structure", x: 15, y: -3.25, length: 10, width: 1.5 },
            ]),
        );
        expect(masked(mount.mask!, 0)).toBe(false);
        expect(masksWholeArc(mount.mask!, mount.leftArc!, mount.rightArc!)).toBe(false);
    });

    it("never fires with a plate across its mouth", () => {
        const mount = lanceMount(lancer([{ kind: "structure", x: 15.75, y: 0, length: 1.5, width: 11 }]));
        expect(masked(mount.mask!, 0)).toBe(true);
        expect(masksWholeArc(mount.mask!, mount.leftArc!, mount.rightArc!)).toBe(true);
    });
});

describe("masksWholeArc", () => {
    it("finds a clear bearing anywhere in the arc, and none outside it", () => {
        const mask = [-1, -0.1, 0.1, 1];
        expect(masksWholeArc(mask, 0, 0)).toBe(false);
        expect(masksWholeArc([-1, 1], 0.5, 0.5)).toBe(true);
        expect(masksWholeArc([-1, 1], 1.5, 0.5)).toBe(false);
        expect(masksWholeArc([], 0, 0)).toBe(false);
    });
});
