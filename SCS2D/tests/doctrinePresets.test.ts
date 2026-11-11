import { describe, expect, it } from "vitest";
import { APPROACH_FIELDS, DEFAULT_DOCTRINE, SHIP_TARGETING_FIELDS } from "../sim/index.js";
import { DOCTRINE_PRESETS, presetDoctrine, presetFields } from "../editor/doctrinePresets.js";

const named = (name: string) => DOCTRINE_PRESETS.find((preset) => preset.name === name)!;

describe("doctrine presets", () => {
    it("only set fields a ship reads", () => {
        for (const preset of DOCTRINE_PRESETS) {
            for (const field of Object.keys(preset.targeting ?? {})) expect(SHIP_TARGETING_FIELDS).toContain(field);
            for (const field of Object.keys(preset.approach ?? {})) expect(APPROACH_FIELDS).toContain(field);
        }
    });

    it("set every field of a ship's doctrine, the rest at their defaults", () => {
        const fields = presetFields(named("Sniper"));
        expect(fields).toHaveLength(SHIP_TARGETING_FIELDS.length + APPROACH_FIELDS.length);
        const value = (half: "targeting" | "approach", field: string) => fields.find((f) => f.half === half && f.field === field)!.value;
        expect(value("approach", "standoff")).toBe(0.95);
        expect(value("approach", "escortRadii")).toBe(DEFAULT_DOCTRINE.approach.escortRadii);
    });

    it("make the doctrine theirs alone, whatever it was", () => {
        const sniper = presetDoctrine(named("Sniper"))!;
        expect(sniper.approach.standoff).toBe(0.95);
        expect(sniper.approach.tolerance).toBe(0.05);
        const knife = presetDoctrine(named("Knife fighter"))!;
        expect(knife.approach.standoff).toBe(0.3);
        expect(knife.approach.tolerance).toBe(DEFAULT_DOCTRINE.approach.tolerance);
        expect(knife.targeting.closingWeight).toBe(DEFAULT_DOCTRINE.targeting.closingWeight);
        expect(presetDoctrine(named("Standard"))).toBeUndefined();
    });

    it("include a tender and an escort", () => {
        expect(presetDoctrine(named("Tender"))!.approach.deliverFuelAbove).toBeGreaterThan(0);
        expect(presetDoctrine(named("Escort"))!.targeting.escortWeight).toBeGreaterThan(0);
    });
});
