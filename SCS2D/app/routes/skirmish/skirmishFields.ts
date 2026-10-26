import type { SettingField } from "~/host/settingsFields";
import { rangedMapFields } from "~/host/mapFields";
import { MUTATION_FIELDS } from "~/evolution/mutationFields";
import { DEFAULT_MAP, MAP_KEYS, writeMap, type MapKey, type MapSettings } from "~/sim/index";
import { DEFAULT_SKIRMISH_SETTINGS, type SkirmishSettings } from "~/scenarios/skirmish";
import { settingValue } from "~/features/settings/SettingFields";

/** The settings a new skirmish starts with, kept as last chosen. */
export const SETTINGS_KEY = "scs2d.skirmish.settings";

const D = DEFAULT_SKIRMISH_SETTINGS;
/** The round's settings and the answer's, as the setup screen offers them. */
export const SKIRMISH_FIELDS: readonly SettingField[] = [
    {
        name: "maxShips",
        group: "limits",
        label: "most ships",
        step: 1,
        min: 1,
        value: D.maxShips,
        title: "The most ships either side may field, unless the enemy already has more: a limit on how hard a battle works the computer.",
    },
    {
        name: "radius",
        group: "limits",
        label: "spawn radius m",
        step: 50,
        min: 1,
        value: D.radius,
        title: "How far from its origin any of either side's hulls may reach, unless the enemy already reaches further.",
    },
    {
        name: "quietTime",
        group: "round",
        label: "quiet s",
        step: 5,
        min: 1,
        value: D.quietTime,
        title: "Once both sides have fired, a side that has not fired, hit or rammed for this long, while the other has, is out of the battle.",
    },
    {
        name: "timeCap",
        group: "round",
        label: "time cap s",
        step: 30,
        min: 1,
        value: D.timeCap,
        title: "A battle not decided by then is a draw, which is a loss for you.",
    },
    {
        name: "gap",
        group: "round",
        label: "gap m",
        step: 100,
        value: D.gap,
        title: "Clear water between the two fleets' furthest hulls at the start.",
    },
    {
        name: "closingSpeed",
        group: "round",
        label: "closing m/s",
        step: 5,
        min: null,
        value: D.closingSpeed,
        title: "Each fleet's starting speed towards the other.",
    },
    {
        name: "crossingSpeed",
        group: "round",
        label: "crossing m/s",
        step: 5,
        min: null,
        value: D.crossingSpeed,
        title: "Each fleet's starting speed across the line between them, to its left.",
    },
    {
        name: "gapSpread",
        group: "round",
        spreadOf: "gap",
        label: "",
        step: 100,
        value: D.gapSpread,
        title: "How far either side each round's gap is drawn, evenly. Zero holds it.",
    },
    {
        name: "closingSpread",
        group: "round",
        spreadOf: "closingSpeed",
        label: "",
        step: 5,
        value: D.closingSpread,
        title: "How far either side each round's closing speed is drawn, evenly. Zero holds it.",
    },
    {
        name: "crossingSpread",
        group: "round",
        spreadOf: "crossingSpeed",
        label: "",
        step: 5,
        value: D.crossingSpread,
        title: "How far either side each round's crossing speed is drawn, evenly. Zero holds it.",
    },
    {
        name: "mutants",
        group: "answer",
        label: "mutants",
        step: 1,
        min: 1,
        value: D.mutants,
        title: "Mutants of the enemy a generation, beside the best so far.",
    },
    {
        name: "seeds",
        group: "answer",
        label: "matches each",
        step: 1,
        min: 1,
        value: D.seeds,
        title: "Matches each enemy fights a generation, on different seeds, the next round's among them, so it cannot win by a fluke of one.",
    },
    {
        name: "duration",
        group: "answer",
        label: "match s",
        step: 30,
        min: 1,
        value: D.duration,
        title: "How long a match of the search lasts before the side ahead is taken to win.",
    },
    {
        name: "bareCoreDrills",
        group: "answer",
        label: "bare core drills",
        step: 1,
        value: D.bareCoreDrills,
        title: "Matches each enemy fights a generation against a bare core, scored on how much of it, and how soon, it destroys. They only add to its score: it learns to hit something.",
    },
    {
        name: "shieldedDrills",
        group: "answer",
        label: "invincible drills",
        step: 1,
        value: D.shieldedDrills,
        title: "Matches each enemy fights a generation against your fleet with itself made invincible, scored on how much of your fleet it destroys and how soon it leaves it nothing to fire. They only add to its score: it learns to hurt you before you strip it.",
    },
    {
        name: "budgetStep",
        group: "answer",
        label: "budget step",
        step: 0.05,
        value: D.budgetStep,
        title: "What is added to the enemy's budget, as a multiple of yours, each time its search stalls. It starts at 1×, or what the enemy already costs if more, and never falls.",
    },
    {
        name: "stretchAfter",
        group: "answer",
        label: "step up after",
        step: 1,
        min: 1,
        value: D.stretchAfter,
        title: "Generations without an answer before the enemy's budget steps up again.",
    },
    {
        name: "answerMargin",
        group: "answer",
        label: "answer wins by",
        step: 0.05,
        value: D.answerMargin,
        title: "How far ahead the enemy's answer must finish the round to count: its share of its own fleet left, less yours. 0.2 is 20 points: room for what your orders win back.",
    },
];
/** Those that are counts, and so whole. */
export const WHOLE = new Set(["mutants", "seeds", "stretchAfter", "maxShips", "bareCoreDrills", "shieldedDrills"]);

/** Every box of the setup screen: the skirmish's, the mutation odds and the map, each with its ±. */
export const SETUP_FIELDS: readonly SettingField[] = [...SKIRMISH_FIELDS, ...MUTATION_FIELDS, ...rangedMapFields()];

/** The boxes' text for some settings. */
export function settingsTexts(settings: SkirmishSettings): Record<string, string> {
    const out: Record<string, string> = {};
    for (const field of SKIRMISH_FIELDS) out[field.name] = String(settings[field.name as keyof SkirmishSettings]);
    for (const field of MUTATION_FIELDS) out[field.name] = String(settings.breeding[field.name] ?? field.value);
    for (const key of MAP_KEYS) {
        out[`map${key}`] = String(settings.map?.[key] ?? DEFAULT_MAP[key]);
        out[`mapRange${key}`] = String(settings.mapSpread[key] ?? 0);
    }
    return out;
}

/** What the boxes say, as settings: a box left blank or unreadable is its default. */
export function readSettings(texts: Readonly<Record<string, string>>): SkirmishSettings {
    const out: Record<string, unknown> = {};
    for (const field of SKIRMISH_FIELDS) out[field.name] = settingValue(field, texts[field.name], WHOLE.has(field.name));
    const breeding: Record<string, number> = {};
    for (const field of MUTATION_FIELDS) breeding[field.name] = settingValue({ ...field, min: 0 }, texts[field.name]);
    const map: Partial<Record<MapKey, number>> = {};
    const mapSpread: Partial<Record<MapKey, number>> = {};
    for (const key of MAP_KEYS) {
        const value = Number(texts[`map${key}`] ?? "");
        map[key] = (texts[`map${key}`] ?? "") !== "" && Number.isFinite(value) && value >= 0 ? value : DEFAULT_MAP[key];
        const spread = Number(texts[`mapRange${key}`] ?? 0);
        if (Number.isFinite(spread) && spread > 0) mapSpread[key] = spread;
    }
    return { ...DEFAULT_SKIRMISH_SETTINGS, ...out, breeding, map: writeMap(map) ?? {}, mapSpread: mapSpread as MapSettings };
}
