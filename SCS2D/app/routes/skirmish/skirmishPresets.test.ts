import { expect, test } from "vitest";
import { BUILT_IN } from "~/editor/library";
import { FLEETS } from "~/scenarios/fleets";
import { DEFAULT_SKIRMISH_SETTINGS } from "~/scenarios/skirmish";
import { blueprintKinds, canUnlock } from "~/skirmish/techTree";
import { BATTLEFIELD_PRESETS, ENEMY_PRESETS, withBattlefield, withEnemyPreset } from "./skirmishPresets";
import { readSettings, settingsTexts } from "./skirmishFields";

const battlefield = (name: string) => BATTLEFIELD_PRESETS.find((preset) => preset.name === name)!;

test("every enemy preset is a stock ship or fleet, and its ship count survives the boxes", () => {
    const stock = new Set([
        ...BUILT_IN.map((ship) => `ship:${ship.category ?? ""}/${ship.name}`),
        ...Object.keys(FLEETS).map((name) => `fleet:${name}`),
    ]);
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

test("holds a ship to at least one core, as none would leave nothing to build", () => {
    const texts = settingsTexts(DEFAULT_SKIRMISH_SETTINGS);
    expect(readSettings(texts).maxCores).toBe(1);
    expect(readSettings({ ...texts, maxCores: "0" }).maxCores).toBe(1);
    expect(readSettings({ ...texts, maxCores: "3" }).maxCores).toBe(3);
});

test("a preset's starting modules build its enemy, each with what it needs", () => {
    for (const preset of ENEMY_PRESETS) {
        if (preset.tech === undefined) continue;
        const enemy = BUILT_IN.find((ship) => `ship:${ship.category ?? ""}/${ship.name}` === preset.enemy)!;
        expect(preset.tech).toEqual(expect.arrayContaining(blueprintKinds(enemy)));
        for (const kind of preset.tech) expect(canUnlock(kind, preset.tech)).toBe(true);
    }
});

test("the torpedo boat preset starts with its modules, and a generator for the pad, and nothing else", () => {
    const preset = ENEMY_PRESETS.find((p) => p.name === "Torpedo boat")!;
    expect([...preset.tech!].sort()).toEqual(["core", "engine", "generator", "hold", "pad", "structure", "tank"]);
});
