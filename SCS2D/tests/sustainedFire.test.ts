import { describe, expect, it } from "vitest";
import { expandBlueprint, firingPeriod, moduleStats } from "../sim/index.js";
import { CORVETTE, LANCE_CORVETTE, RAIL_CORVETTE } from "../scenarios/blueprints.js";
import { moduleReadout, powerDraw, sustainedShare } from "../editor/stats.js";

/** The readout of the first module of `kind` in a layout. */
function readout(layout: ReturnType<typeof expandBlueprint>, kind: string) {
    const index = layout.findIndex((module) => module.kind === kind);
    return moduleReadout(layout[index]!, layout, index, 10).gun!;
}

describe("the rate of fire a ship's power can keep up", () => {
    it("holds a rail gun to what its generators make", () => {
        const layout = expandBlueprint(RAIL_CORVETTE);
        const share = sustainedShare(layout);
        expect(share).toBeGreaterThan(0);
        expect(share).toBeLessThan(1);
        const gun = readout(layout, "railGun");
        expect(gun.sustainedPerMinute).toBeCloseTo(gun.roundsPerMinute * share, 9);
    });

    it("holds it harder with fewer generators", () => {
        const layout = expandBlueprint(RAIL_CORVETTE);
        expect(sustainedShare(layout.filter((module) => module.kind !== "generator"))).toBeLessThan(sustainedShare(layout));
    });

    it("leaves a gun on fuel as fast as it loads", () => {
        const layout = expandBlueprint(CORVETTE);
        const kind = layout.find((module) => module.kind === "turret" || module.kind === "hullGun")!.kind;
        expect(readout(layout, kind).sustainedPerMinute).toBeUndefined();
    });

    it("counts what a lance takes from the ship's charge, not the fuel it throws", () => {
        const layout = expandBlueprint(LANCE_CORVETTE);
        const gun = moduleStats(layout.find((module) => module.kind === "plasmaLance")!).gun!;
        expect(powerDraw(gun)).toBeCloseTo(gun.shotEnergy / firingPeriod(gun), 6);
        expect(powerDraw(gun)).toBeLessThan((gun.beamPower * gun.beamOnTime) / firingPeriod(gun));
    });
});
