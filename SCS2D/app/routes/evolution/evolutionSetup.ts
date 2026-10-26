import { mapFields } from "~/host/mapFields";
import { DEFAULT_COEVOLUTION, rivalSettings, type CoevolutionConfig, type SideSettings } from "~/evolution/coevolution";
import type { RunSetup } from "~/evolution/configFile";
import { DEFAULT_FLEET_LIMITS } from "~/evolution/fleetMutate";
import { DEFAULT_MATCH, isFleet, type Entrant, type MatchConfig } from "~/evolution/match";
import { DEFAULT_BUILD_WEIGHTS, DEFAULT_KINDS, DEFAULT_LIMITS, doctrineWeights, type KindWeights } from "~/evolution/mutate";
import { breeding, MUTATION_FIELDS } from "~/evolution/mutationFields";
import { DEFAULT_RUN, type RunConfig } from "~/evolution/run";
import { DEFAULT_MAP, MAP_KEYS, writeMap, type Blueprint, type Fleet, type MapKey } from "~/sim/index";

/** What the settings are saved under, so a refresh does not cost them. */
export const SETUP_KEY = "scs2d.evolution.setup";
/** Which cards are folded away, so a refresh keeps them so. */
export const FOLDED_KEY = "scs2d.evolution.folded";
/** Side B's box for a setting is side A's id with this before it. */
export const RIVAL = "b_";

/** The settings each side of a co-evolution run has its own of. */
export const SIDE_FIELDS = [
    "population",
    "winners",
    "group",
    "metalBudget",
    "fuelBudget",
    "buildBudget",
    "fleetRadius",
    "fleetShips",
    ...MUTATION_FIELDS.map((field) => field.name),
] as const;
export type SideField = (typeof SIDE_FIELDS)[number];

/** The boxes that are the run's rather than a side's. */
export const RUN_FIELDS = [
    "configName",
    "generations",
    "minMatches",
    "seed",
    "duration",
    "radius",
    "radiusSpread",
    "scatter",
    "closing",
    "closingSpread",
    "crossing",
    "crossingSpread",
    "quietLimit",
    "survivalWeight",
    "functionalWeight",
    "damageWeight",
    "disablingWeight",
    "raceWeight",
    "effort",
    "hall",
    "phaseWin",
    "phaseCap",
    "shieldedDrills",
    "bareCoreDrills",
] as const;

export const MAP_FIELDS = mapFields();

/** Every box of the form but side B's, by its id. */
export type Texts = Record<string, string>;

export type Goal = "solid" | "ghost" | "none";

/** The setup screen as it stands: every box as typed, and what is chosen. */
export interface SetupForm {
    readonly texts: Texts;
    /** Side B's boxes, by side A's ids. */
    readonly rival: Texts;
    /** Whether side B has settings of its own, rather than following side A's. */
    readonly rivalOwn: boolean;
    readonly rivalEvolves: boolean;
    readonly goal: Goal;
    /** Option values, `ship:Name` or `fleet:Name`. */
    readonly founders: readonly string[];
    readonly versus: readonly string[];
}

export const DEFAULT_TEXTS: Texts = {
    ...Object.fromEntries(MUTATION_FIELDS.map((field) => [field.name, String(field.value)])),
    ...Object.fromEntries(MAP_FIELDS.map((field) => [field.name, String(field.value)])),
    configName: "",
    generations: String(DEFAULT_RUN.generations),
    population: String(DEFAULT_RUN.population),
    winners: String(DEFAULT_RUN.winners),
    group: String(DEFAULT_RUN.group),
    minMatches: String(DEFAULT_RUN.minMatches),
    metalBudget: "",
    fuelBudget: "",
    buildBudget: "",
    fleetRadius: String(DEFAULT_FLEET_LIMITS.radius),
    fleetShips: String(DEFAULT_FLEET_LIMITS.maxShips),
    seed: String(DEFAULT_RUN.seed),
    duration: String(DEFAULT_MATCH.duration),
    radius: String(DEFAULT_MATCH.radius),
    scatter: String(Math.round((DEFAULT_MATCH.scatter * 180) / Math.PI)),
    closing: String(DEFAULT_MATCH.closingSpeed),
    crossing: String(DEFAULT_MATCH.crossingSpeed),
    radiusSpread: String(DEFAULT_MATCH.radiusSpread),
    closingSpread: String(DEFAULT_MATCH.closingSpread),
    crossingSpread: String(DEFAULT_MATCH.crossingSpread),
    quietLimit: String(DEFAULT_MATCH.quietLimit),
    survivalWeight: String(DEFAULT_MATCH.weights.survival),
    functionalWeight: String(DEFAULT_MATCH.weights.functional),
    damageWeight: String(DEFAULT_MATCH.weights.damage),
    disablingWeight: String(DEFAULT_MATCH.weights.disabling),
    raceWeight: String(DEFAULT_MATCH.weights.race),
    effort: "12",
    hall: String(DEFAULT_COEVOLUTION.hall),
    phaseWin: String(DEFAULT_COEVOLUTION.phaseWin),
    phaseCap: String(DEFAULT_COEVOLUTION.phaseCap),
    shieldedDrills: String(DEFAULT_COEVOLUTION.shieldedDrills),
    bareCoreDrills: String(DEFAULT_COEVOLUTION.bareCoreDrills),
};

const sideOf = (texts: Texts): Texts => Object.fromEntries(SIDE_FIELDS.map((name) => [name, texts[name] ?? DEFAULT_TEXTS[name]!]));

/** Every setting at its default, both sides; the founders and versus as given. */
export function defaultForm(founders: readonly string[] = ["ship:Corvette"], versus: readonly string[] = []): SetupForm {
    return { texts: DEFAULT_TEXTS, rival: sideOf(DEFAULT_TEXTS), rivalOwn: false, rivalEvolves: true, goal: "solid", founders, versus };
}

/** A founder or benchmark in a list, as its option's value: `ship:Name` or `fleet:Name`. */
export interface Choice {
    readonly kind: "ship" | "fleet";
    readonly name: string;
}
export const valueOf = (kind: Choice["kind"], name: string): string => `${kind}:${name}`;
export function pickOf(value: string): Choice {
    // Settings saved before fleets could found a run hold bare ship names.
    if (value.startsWith("fleet:")) return { kind: "fleet", name: value.slice(6) };
    return { kind: "ship", name: value.startsWith("ship:") ? value.slice(5) : value };
}

/** Side B's boxes as they read: its own, or side A's while it follows them. */
export function rivalTexts(form: SetupForm): Texts {
    return form.rivalOwn ? form.rival : sideOf(form.texts);
}

/** The form as it is kept, in the shape the old evolution page kept it, so its settings carry over. */
export function heldOf(form: SetupForm): Record<string, string> {
    const held: Record<string, string> = { ...form.texts, goal: form.goal };
    const rival = rivalTexts(form);
    for (const name of SIDE_FIELDS) held[RIVAL + name] = rival[name] ?? "";
    held["rivalOwn"] = form.rivalOwn ? "1" : "";
    held["rivalEvolves"] = form.rivalEvolves ? "1" : "";
    held["founders"] = form.founders.join("\n");
    held["versus"] = form.versus.join("\n");
    return held;
}

/** A kept form back, its defaults where it says nothing or cannot be read. */
export function formOfHeld(raw: string | null): SetupForm {
    let held: Record<string, string> = {};
    try {
        if (raw !== null) held = JSON.parse(raw) as Record<string, string>;
    } catch {
        // Unreadable settings are settings that were never saved.
    }
    const texts: Texts = {};
    for (const name of Object.keys(DEFAULT_TEXTS)) texts[name] = typeof held[name] === "string" ? held[name] : DEFAULT_TEXTS[name]!;
    const rivalOwn = held["rivalOwn"] === "1";
    const rival = Object.fromEntries(SIDE_FIELDS.map((name) => [name, (rivalOwn ? held[RIVAL + name] : undefined) ?? texts[name]!]));
    // Settings saved when this was a checkbox held '1' or ''.
    const goal = held["goal"] === "" ? "none" : held["goal"] === "1" ? "solid" : held["goal"];
    return {
        texts,
        rival,
        rivalOwn,
        rivalEvolves: held["rivalEvolves"] !== "",
        goal: goal === "ghost" || goal === "none" ? goal : "solid",
        founders: (held["founders"] ?? "Corvette").split("\n").map((value) => {
            const { kind, name } = pickOf(value);
            return valueOf(kind, name);
        }),
        versus: (held["versus"] ?? "").split("\n").filter((value) => value !== ""),
    };
}

function number(text: string | undefined, fallback: number): number {
    const value = Number(text);
    return text === undefined || text.trim() === "" || !Number.isFinite(value) ? fallback : value;
}

/** Whether there is a side B, which makes it a co-evolution run. */
export const coRun = (form: SetupForm): boolean => form.versus.length > 0;

/** Whether a fleet is among the founders, or a ship may grow into one, which makes it a run of fleets. */
export function fleetRun(form: SetupForm): boolean {
    return (
        [...form.founders, ...form.versus].some((value) => pickOf(value).kind === "fleet") ||
        Math.round(number(form.texts["fleetShips"], DEFAULT_FLEET_LIMITS.maxShips)) > 1 ||
        (coRun(form) && Math.round(number(rivalTexts(form)["fleetShips"], DEFAULT_FLEET_LIMITS.maxShips)) > 1)
    );
}

/** One side's own settings, read from its boxes. */
function sideSettings(texts: Texts): SideSettings {
    const bred = breeding((name) => (texts[name] === undefined || texts[name].trim() === "" ? undefined : Number(texts[name])));
    // Blank or nothing is no limit.
    const limit = (name: SideField, scale: number): number => {
        const value = number(texts[name], 0);
        return value > 0 ? value * scale : Infinity;
    };
    return {
        population: Math.max(2, Math.round(number(texts["population"], DEFAULT_RUN.population))),
        winners: Math.max(1, Math.round(number(texts["winners"], DEFAULT_RUN.winners))),
        group: Math.max(1, Math.round(number(texts["group"], DEFAULT_RUN.group))),
        budget: { metal: limit("metalBudget", 1000), fuel: limit("fuelBudget", 1000), build: limit("buildBudget", 60) },
        fleet: {
            radius: Math.max(1, number(texts["fleetRadius"], DEFAULT_FLEET_LIMITS.radius)),
            maxShips: Math.max(1, Math.round(number(texts["fleetShips"], DEFAULT_FLEET_LIMITS.maxShips))),
            operators: bred.operators,
            ...bred.fleet,
        },
        mutation: bred.ship,
    };
}

/** The asteroids the boxes say, or undefined for none. */
function mapOf(texts: Texts): MatchConfig["map"] {
    const out: Partial<Record<MapKey, number>> = {};
    for (const key of MAP_KEYS) {
        const text = texts[`map${key}`];
        const value = text === undefined || text === "" ? NaN : Number(text);
        out[key] = Number.isFinite(value) && value >= 0 ? value : DEFAULT_MAP[key];
    }
    return writeMap(out);
}

/** The run's settings, as the form says them. */
export function configOf(form: SetupForm): RunConfig {
    const t = form.texts;
    const map = mapOf(t);
    return {
        ...DEFAULT_RUN,
        seed: number(t["seed"], DEFAULT_RUN.seed),
        generations: Math.max(1, Math.round(number(t["generations"], DEFAULT_RUN.generations))),
        minMatches: Math.max(1, Math.round(number(t["minMatches"], DEFAULT_RUN.minMatches))),
        ...sideSettings(t),
        match: {
            duration: Math.max(1, number(t["duration"], DEFAULT_MATCH.duration)),
            radius: Math.max(10, number(t["radius"], DEFAULT_MATCH.radius)),
            scatter: (number(t["scatter"], 180) * Math.PI) / 180,
            closingSpeed: number(t["closing"], DEFAULT_MATCH.closingSpeed),
            crossingSpeed: number(t["crossing"], DEFAULT_MATCH.crossingSpeed),
            radiusSpread: Math.max(0, number(t["radiusSpread"], DEFAULT_MATCH.radiusSpread)),
            closingSpread: Math.max(0, number(t["closingSpread"], DEFAULT_MATCH.closingSpread)),
            crossingSpread: Math.max(0, number(t["crossingSpread"], DEFAULT_MATCH.crossingSpread)),
            quietLimit: Math.max(0, number(t["quietLimit"], DEFAULT_MATCH.quietLimit)),
            ...(map === undefined ? {} : { map }),
            goal: form.goal === "none" || DEFAULT_MATCH.goal === null ? null : { ...DEFAULT_MATCH.goal, solid: form.goal !== "ghost" },
            weights: {
                survival: number(t["survivalWeight"], 1),
                functional: number(t["functionalWeight"], 1),
                damage: number(t["damageWeight"], 1),
                disabling: number(t["disablingWeight"], 1),
                race: number(t["raceWeight"], 1),
            },
        },
    };
}

/** How side B is bred against side A: its own column of settings, and the hall. */
export function coevolutionOf(form: SetupForm): CoevolutionConfig {
    const t = form.texts;
    return {
        // Nothing set apart while side B follows side A, so a file says only what differs.
        rival: form.rivalOwn ? sideSettings(form.rival) : {},
        hall: Math.max(1, Math.round(number(t["hall"], DEFAULT_COEVOLUTION.hall))),
        phaseWin: Math.min(1, Math.max(0, number(t["phaseWin"], DEFAULT_COEVOLUTION.phaseWin))),
        phaseCap: Math.max(1, Math.round(number(t["phaseCap"], DEFAULT_COEVOLUTION.phaseCap))),
        shieldedDrills: Math.max(0, Math.round(number(t["shieldedDrills"], DEFAULT_COEVOLUTION.shieldedDrills))),
        bareCoreDrills: Math.max(0, Math.round(number(t["bareCoreDrills"], DEFAULT_COEVOLUTION.bareCoreDrills))),
        rivalEvolves: form.rivalEvolves,
    };
}

/** How long each frame is spent fighting, ms. */
export const effortOf = (form: SetupForm): number => Math.max(1, Math.min(200, number(form.texts["effort"], 12)));

/** One side's founders, split as a config file holds them. */
const designsOf = (entrants: readonly Entrant[]): { founders: Blueprint[]; fleets: Fleet[] } => ({
    founders: entrants.filter((entrant): entrant is Blueprint => !isFleet(entrant)),
    fleets: entrants.filter(isFleet),
});

/** Everything the form says, as a run's settings, with the founders it names. */
export function setupOf(form: SetupForm, founders: readonly Entrant[], rivals: readonly Entrant[]): RunSetup {
    const name = (form.texts["configName"] ?? "").trim();
    return {
        ...(name === "" ? {} : { name }),
        ...designsOf(founders),
        versus: coRun(form) ? { ...designsOf(rivals), coevolution: coevolutionOf(form) } : null,
        config: configOf(form),
    };
}

/** One side's own settings as its boxes show them. */
function sideTexts(config: RunConfig): Texts {
    const kinds: KindWeights = { ...DEFAULT_KINDS, ...config.mutation.kinds };
    const operators = { ...DEFAULT_FLEET_LIMITS.operators, ...config.fleet.operators };
    const build = { ...DEFAULT_BUILD_WEIGHTS, ...config.mutation.build };
    const doctrine = doctrineWeights(config.mutation.doctrine);
    const shown = (value: number, scale: number): string => (Number.isFinite(value) ? String(value / scale) : "");
    const out: Texts = {
        population: String(config.population),
        winners: String(config.winners),
        group: String(config.group),
        metalBudget: shown(config.budget.metal, 1000),
        fuelBudget: shown(config.budget.fuel, 1000),
        buildBudget: shown(config.budget.build, 60),
        fleetRadius: String(config.fleet.radius ?? DEFAULT_FLEET_LIMITS.radius),
        fleetShips: String(config.fleet.maxShips ?? DEFAULT_FLEET_LIMITS.maxShips),
        fleetDesign: String(config.fleet.design ?? DEFAULT_FLEET_LIMITS.design),
        fleetMove: String(config.fleet.move ?? DEFAULT_FLEET_LIMITS.move),
        fleetChange: String(config.fleet.change ?? DEFAULT_FLEET_LIMITS.change),
        structural: String(config.mutation.structural ?? DEFAULT_LIMITS.structural),
        geometry: String(config.mutation.geometry ?? DEFAULT_LIMITS.geometry),
        thrusters: String(config.mutation.thrusters ?? DEFAULT_LIMITS.thrusters),
    };
    for (const [key, value] of Object.entries(operators)) out[`op${key[0]!.toUpperCase()}${key.slice(1)}`] = String(value);
    for (const [key, value] of Object.entries(build)) out[`build${key[0]!.toUpperCase()}${key.slice(1)}`] = String(value);
    for (const [key, value] of Object.entries(kinds)) out[`kind${key[0]!.toUpperCase()}${key.slice(1)}`] = String(value);
    for (const [key, value] of Object.entries(doctrine)) out[`doctrine${key[0]!.toUpperCase()}${key.slice(1)}`] = String(value);
    // Only the boxes there are: a weight with no box of its own is not one to show.
    return Object.fromEntries(SIDE_FIELDS.map((name) => [name, out[name] ?? DEFAULT_TEXTS[name]!]));
}

/** A setup read from a file, as the form; its founders as `founders` and `versus` name them. */
export function formOfSetup(setup: RunSetup, founders: readonly string[], versus: readonly string[], was: SetupForm): SetupForm {
    const config = setup.config;
    const match: MatchConfig = { ...DEFAULT_MATCH, ...config.match };
    const texts: Texts = {
        ...was.texts,
        ...sideTexts(config),
        ...Object.fromEntries(MAP_KEYS.map((key) => [`map${key}`, String(match.map?.[key] ?? DEFAULT_MAP[key])])),
        configName: setup.name ?? "",
        seed: String(config.seed),
        generations: String(config.generations),
        minMatches: String(config.minMatches),
        duration: String(match.duration),
        radius: String(match.radius),
        scatter: String((match.scatter * 180) / Math.PI),
        closing: String(match.closingSpeed),
        crossing: String(match.crossingSpeed),
        radiusSpread: String(match.radiusSpread ?? DEFAULT_MATCH.radiusSpread),
        closingSpread: String(match.closingSpread ?? DEFAULT_MATCH.closingSpread),
        crossingSpread: String(match.crossingSpread ?? DEFAULT_MATCH.crossingSpread),
        quietLimit: String(match.quietLimit ?? DEFAULT_MATCH.quietLimit),
        survivalWeight: String(match.weights.survival),
        functionalWeight: String(match.weights.functional),
        damageWeight: String(match.weights.damage),
        disablingWeight: String(match.weights.disabling),
        raceWeight: String(match.weights.race),
    };
    const coevolution = setup.versus?.coevolution ?? DEFAULT_COEVOLUTION;
    texts["hall"] = String(coevolution.hall);
    texts["phaseWin"] = String(coevolution.phaseWin);
    texts["phaseCap"] = String(coevolution.phaseCap);
    texts["shieldedDrills"] = String(coevolution.shieldedDrills);
    texts["bareCoreDrills"] = String(coevolution.bareCoreDrills);
    return {
        texts,
        // Side B's column in full: side A's settings, with whatever the file set apart for it.
        rival: sideTexts(rivalSettings({ ...DEFAULT_RUN, ...config }, coevolution.rival)),
        rivalOwn: Object.keys(coevolution.rival).length > 0,
        rivalEvolves: coevolution.rivalEvolves,
        goal: match.goal === null ? "none" : match.goal.solid === false ? "ghost" : "solid",
        founders: founders.length > 0 ? founders : was.founders,
        // Side B as the file has it, which for a run of one is nobody.
        versus,
    };
}
