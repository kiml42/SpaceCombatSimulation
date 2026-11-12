import { expect, test } from "vitest";
import { BUILT_IN } from "~/editor/library";
import { DEFAULT_SKIRMISH_SETTINGS } from "~/scenarios/skirmish";
import { BATTLEFIELD_PRESETS, ENEMY_PRESETS, withBattlefield, withEnemyPreset } from "./skirmishPresets";
import { readSettings, settingsTexts } from "./skirmishFields";

const battlefield = (name: string) => BATTLEFIELD_PRESETS.find((preset) => preset.name === name)!;

test("every enemy preset is a stock ship, and its ship count survives the boxes", () => {
    const stock = new Set(BUILT_IN.map((ship) => `ship:${ship.name}`));
    for (const preset of ENEMY_PRESETS) {
        expect(stock).toContain(preset.enemy);
        const settings = withEnemyPreset(DEFAULT_SKIRMISH_SETTINGS, preset);
        expect(readSettings(settingsTexts(settings)).maxShips).toBe(preset.maxShips);
    }
});

test("a battlefield survives the boxes, and keeps the enemy preset's ship count", () => {
    const one = withEnemyPreset(DEFAULT_SKIRMISH_SETTINGS, ENEMY_PRESETS[0]!);
    for (const preset of BATTLEFIELD_PRESETS) {
        const settings = withBattlefield({ ...one, mutants: 9 }, preset);
        expect(settings.maxShips).toBe(1);
        expect(settings.mutants).toBe(preset.changes.mutants ?? DEFAULT_SKIRMISH_SETTINGS.mutants);
        const read = readSettings(settingsTexts(settings));
        expect(read.map).toMatchObject(settings.map);
        expect(read.breeding).toMatchObject(settings.breeding);
        expect(read.mapSpread).toEqual(settings.mapSpread);
    }
});

test("open space has no asteroids, and the small universe only minor ones", () => {
    const open = withBattlefield(DEFAULT_SKIRMISH_SETTINGS, battlefield("Open space"));
    expect(open.map.majors ?? 0).toBe(0);
    expect(open.map.minors ?? 0).toBe(0);
    expect(open.mapSpread).toEqual({});
    const small = withBattlefield(DEFAULT_SKIRMISH_SETTINGS, battlefield("Small universe"));
    expect(small.map.majors ?? 0).toBe(0);
    expect(small.mapSpread.majors ?? 0).toBe(0);
    expect(small).toMatchObject({ gap: 800, timeCap: 400, quietTime: 20 });
});
