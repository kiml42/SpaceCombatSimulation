import { describe, expect, it } from "vitest";
import { APPROACH_FIELDS, DEFAULT_DOCTRINE, SHIP_TARGETING_FIELDS } from "../sim/index.js";
import { DOCTRINE_PRESETS, presetFields, withPreset } from "../editor/doctrinePresets.js";
import { withShipField } from "../editor/doctrine.js";

const named = (name: string) => DOCTRINE_PRESETS.find((preset) => preset.name === name)!;

describe("doctrine presets", () => {
    it("only set fields a ship reads", () => {
        for (const preset of DOCTRINE_PRESETS) {
            for (const field of Object.keys(preset.targeting ?? {})) expect(SHIP_TARGETING_FIELDS).toContain(field);
            for (const field of Object.keys(preset.approach ?? {})) expect(APPROACH_FIELDS).toContain(field);
        }
    });

    it("all set the same fields, so one picked after another replaces it whole", () => {
        const fields = (name: string) => presetFields(named(name)).map(({ half, field }) => `${half}.${field}`);
        for (const preset of DOCTRINE_PRESETS) expect(fields(preset.name)).toEqual(fields("Standard"));
    });

    it("write their numbers over the doctrine, leaving the rest", () => {
        const own = withShipField(undefined, "approach", "escortRadii", 3);
        const sniper = withPreset(own, named("Sniper"))!;
        expect(sniper.approach.standoff).toBe(0.95);
        expect(sniper.approach.escortRadii).toBe(3);
        const knife = withPreset(sniper, named("Knife fighter"))!;
        expect(knife.approach.standoff).toBe(0.3);
        expect(knife.approach.tolerance).toBe(DEFAULT_DOCTRINE.approach.tolerance);
        expect(knife.targeting.closingWeight).toBe(DEFAULT_DOCTRINE.targeting.closingWeight);
    });

    it("leave a blueprint saying nothing when Standard is picked on a default ship", () => {
        expect(withPreset(withPreset(undefined, named("Torpedo")), named("Standard"))).toBeUndefined();
    });
});
