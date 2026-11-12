import { DEFAULT_SKIRMISH_SETTINGS, type SkirmishSettings } from "~/scenarios/skirmish";

/** An enemy to begin against, and how many ships a side. The budget then follows the enemy's cost. */
export interface EnemyPreset {
    readonly name: string;
    readonly hint: string;
    /** The enemy, as the setup screen's list names it (`FleetChoices`). */
    readonly enemy: string;
    readonly maxShips: number;
}

export const ENEMY_PRESETS: readonly EnemyPreset[] = [
    { name: "One big ship", hint: "Against a gunship, one ship a side", enemy: "ship:Gunship", maxShips: 1 },
    { name: "Small ships", hint: "Against a corvette, with room for the fleets to grow", enemy: "ship:Corvette", maxShips: 20 },
    { name: "Bare core", hint: "Against a bare core, on its tiny budget", enemy: "ship:Bare Core", maxShips: 3 },
];

/** Where and how the rounds are fought, and how the enemy is bred: every setting but the enemy preset's. */
export interface BattlefieldPreset {
    readonly name: string;
    readonly hint: string;
    readonly changes: Partial<SkirmishSettings>;
}

export const BATTLEFIELD_PRESETS: readonly BattlefieldPreset[] = [
    { name: "Open space", hint: "No asteroids, ever", changes: {} },
    {
        name: "Asteroid field",
        hint: "Rocks in nearly every round, sometimes a big one",
        changes: { map: { majors: 1, minors: 10 }, mapSpread: { majors: 1, minors: 10 } },
    },
    {
        name: "Small universe",
        hint: "Only small rocks, 800 m apart, 400 s to win and 20 s quiet",
        changes: { gap: 800, timeCap: 400, quietTime: 20, map: { minors: 8 }, mapSpread: { minors: 4 } },
    },
    {
        name: "Radiation field",
        hint: "The enemy mutates fast, and every round is drawn far from the last",
        changes: {
            breeding: { magnitude: 0.3, structural: 0.9, geometry: 0.8, thrusters: 0.8 },
            gapSpread: 1000,
            closingSpread: 30,
            crossingSpread: 30,
            map: { minors: 4 },
            mapSpread: {
                majors: 1,
                majorSize: 150,
                minors: 8,
                minorSize: 40,
                eccentricity: 0.3,
                surfaceGravity: 0.4,
                metal: 0.15,
                fuel: 0.1,
            },
        },
    },
];

export function withEnemyPreset(settings: SkirmishSettings, preset: EnemyPreset): SkirmishSettings {
    return { ...settings, maxShips: preset.maxShips };
}

/** The battlefield's settings, every other at its default, but the enemy preset's kept. */
export function withBattlefield(settings: SkirmishSettings, preset: BattlefieldPreset): SkirmishSettings {
    return { ...DEFAULT_SKIRMISH_SETTINGS, ...preset.changes, maxShips: settings.maxShips, radius: settings.radius };
}
