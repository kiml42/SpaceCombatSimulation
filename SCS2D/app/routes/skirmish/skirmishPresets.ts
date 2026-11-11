import { DEFAULT_SKIRMISH_SETTINGS, type SkirmishSettings } from "~/scenarios/skirmish";

/**
 * Ways to start a skirmish, picked on the setup screen as a quick start: an
 * enemy to begin against, and every setting at its default but those that make
 * that kind of game. The budget then follows the enemy's cost.
 */
export interface SkirmishPreset {
    readonly name: string;
    readonly hint: string;
    /** The enemy, as the setup screen's list names it (`FleetChoices`). */
    readonly enemy: string;
    readonly settings: SkirmishSettings;
}

const presetOf = (changes: Partial<SkirmishSettings>): SkirmishSettings => ({ ...DEFAULT_SKIRMISH_SETTINGS, ...changes });

export const SKIRMISH_PRESETS: readonly SkirmishPreset[] = [
    {
        name: "One big ship",
        hint: "Against a gunship, one ship a side",
        enemy: "ship:Gunship",
        settings: presetOf({ maxShips: 1 }),
    },
    {
        name: "Small ships",
        hint: "Against a corvette, with room for the fleets to grow",
        enemy: "ship:Corvette",
        settings: presetOf({}),
    },
    {
        name: "Bare core",
        hint: "Against a bare core, on its tiny budget",
        enemy: "ship:Bare Core",
        settings: presetOf({ maxShips: 3 }),
    },
];
