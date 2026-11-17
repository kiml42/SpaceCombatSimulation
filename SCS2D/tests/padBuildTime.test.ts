import { describe, expect, it } from "vitest";
import { buildTime, moduleReadout, padBuildTime } from "../editor/stats.js";
import { QUASAR } from "../scenarios/blueprints.js";
import { billOf, compileBlueprint, PAD_REPAIR_PER_AREA, ROBOT_REPAIR_RATE } from "../sim/index.js";

describe("a pad's figures in the editor", () => {
    const carrier = compileBlueprint(QUASAR);
    const built = carrier.builds![0]!;
    const pad = carrier.modules[built.pad]!.spec;
    const layout = carrier.modules.map((module) => module.spec);

    it("say how long it takes to build one of what it builds, at its deck's rate", () => {
        const seconds = padBuildTime(pad, built.design);
        expect(seconds).toBeCloseTo((billOf(built.design).build * ROBOT_REPAIR_RATE) / (PAD_REPAIR_PER_AREA * pad.length * pad.width));
        // A deck twice the size builds twice as fast.
        expect(padBuildTime({ ...pad, length: pad.length * 2 }, built.design)).toBeCloseTo(seconds / 2);
        const row = moduleReadout(pad, layout, built.pad, carrier.radius, built.design).rows.find((r) => r.name === "Builds one in");
        expect(row).toMatchObject({ value: buildTime(seconds), under: "keep" });
    });

    it("say nothing of it for a pad that builds nothing", () => {
        expect(moduleReadout(pad, layout, built.pad, carrier.radius).rows.some((r) => r.name === "Builds one in")).toBe(false);
    });
});
