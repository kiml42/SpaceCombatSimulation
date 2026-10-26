import { DEFAULT_MAP, MAP_KEYS, type MapKey } from "../sim/index.js";
import type { SettingField } from "./settingsFields.js";

/** A battle's map settings as rows of the settings cards, in the group `map`. */

const LABELS: Record<MapKey, { label: string; title: string; step: number; max?: number }> = {
    majors: { label: "majors", title: "Major asteroids: each a kernel carrying a well, on an orbit with the others", step: 1 },
    majorSize: { label: "major m", title: "A major asteroid’s radius, metres", step: 25 },
    majorSpread: { label: "", title: "How far either side each major’s radius is drawn", step: 25 },
    minors: { label: "minors", title: "Minor asteroids: loose rock, in orbit about a major or adrift", step: 1 },
    minorSize: { label: "minor m", title: "A minor asteroid’s radius, metres", step: 10 },
    minorSpread: { label: "", title: "How far either side each minor’s radius is drawn", step: 10 },
    eccentricity: {
        label: "eccentricity",
        title: "The most eccentric a pair of majors’ orbit may be, each drawn up to it",
        step: 0.1,
        max: 1,
    },
    surfaceGravity: { label: "gravity m/s²", title: "A major’s pull at its surface", step: 0.1 },
    metal: { label: "metal", title: "The share of rock that is ore, on average", step: 0.05, max: 1 },
    fuel: { label: "fuel", title: "The share of rock that is ice, on average", step: 0.05, max: 1 },
};

/** Which of the settings is drawn as the ± of another. */
const SPREAD_OF: Partial<Record<MapKey, MapKey>> = { majorSpread: "majorSize", minorSpread: "minorSize" };

/** The map's rows, each input's id `prefix` and its key. */
export function mapFields(prefix = "map"): SettingField[] {
    return MAP_KEYS.map((key) => ({
        name: `${prefix}${key}`,
        group: "map",
        label: LABELS[key].label,
        title: LABELS[key].title,
        step: LABELS[key].step,
        ...(LABELS[key].max === undefined ? {} : { max: LABELS[key].max }),
        value: DEFAULT_MAP[key],
        ...(SPREAD_OF[key] === undefined ? {} : { spreadOf: `${prefix}${SPREAD_OF[key]}` }),
    }));
}

/**
 * The same, every setting with a ± of its own after it, for a page that draws
 * each battle's map from a range: the ± boxes' ids are `rangePrefix` and the key.
 */
export function rangedMapFields(prefix = "map", rangePrefix = "mapRange"): SettingField[] {
    const out: SettingField[] = [];
    for (const field of mapFields(prefix)) {
        const key = field.name.slice(prefix.length) as MapKey;
        out.push(field);
        // A size already has its ± for each asteroid.
        if (SPREAD_OF[key] !== undefined || Object.values(SPREAD_OF).includes(key)) continue;
        out.push({
            ...field,
            name: `${rangePrefix}${key}`,
            label: "",
            title: `How far either side each round’s ${LABELS[key].label} is drawn`,
            value: 0,
            spreadOf: field.name,
        });
    }
    return out;
}
