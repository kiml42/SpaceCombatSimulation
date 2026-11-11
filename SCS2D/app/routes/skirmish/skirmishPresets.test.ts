import { expect, test } from "vitest";
import { BUILT_IN } from "~/editor/library";
import { SKIRMISH_PRESETS } from "./skirmishPresets";
import { readSettings, settingsTexts } from "./skirmishFields";

test("every preset's enemy is a stock ship, and its settings survive the boxes", () => {
    const stock = new Set(BUILT_IN.map((ship) => `ship:${ship.name}`));
    for (const preset of SKIRMISH_PRESETS) {
        expect(stock).toContain(preset.enemy);
        expect(readSettings(settingsTexts(preset.settings)).maxShips).toBe(preset.settings.maxShips);
    }
});

test("one big ship is one ship a side", () => {
    expect(SKIRMISH_PRESETS.find((preset) => preset.name === "One big ship")!.settings.maxShips).toBe(1);
});
