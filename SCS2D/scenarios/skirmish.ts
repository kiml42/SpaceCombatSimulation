import {
    affords,
    blueprintProblem,
    expandFleet,
    fleetBill,
    fleetHulls,
    fleetProblem,
    fleetReach,
    math,
    parseFleet,
    Rng,
    serialiseFleet,
    type Bill,
    type Blueprint,
    type Budget,
    type Fleet,
    drawnMap,
    hasAsteroids,
    mapProblem,
    type MapSettings,
} from "../sim/index.js";
import type { BattleSetup } from "./customBattle.js";
import { QUIET_TIME, TIME_CAP } from "./decision.js";
import { fleetBlueprint, hangarClashes } from "../sim/fleetHangar.js";
import { firstLivery, liveryRng, STOCK_BASES } from "../sim/liveryDrift.js";
import { cardById, drawHand, withCards, type Limits } from "../skirmish/cards.js";
import { fleetId } from "./history.js";
import { destinationById, offerDestinations } from "../skirmish/destinations.js";

/**
 * A skirmish: the player's fleet against an enemy, a round at a time
 * (ROADMAP.md §8 step 5). The player's fleet must fit a budget set by the
 * enemy it first faced, moved by the upgrade cards they pick; a round is one
 * battle with a fixed seed, fought again until the player wins it.
 */

export const SKIRMISH_FORMAT_VERSION = 1;

export interface Skirmish {
    /** What the player calls it, which its exported files are named for. */
    name?: string;
    enemy: Fleet;
    player: Fleet;
    /** What either side's fleet may cost before its cards. */
    budget: Budget;
    /** Counting from 1. */
    round: number;
    /** How many times this round has been fought. */
    tries: number;
    /** This round's seed. */
    seed: number;
    /**
     * Set once the player has won the round, while the enemy evolves an answer:
     * the next round's seed, a new one, which the answer must win on. Cleared
     * by the next round, which is fought on it.
     */
    won?: number;
    /**
     * Where the next round may be fought, by id (`skirmish/destinations.ts`):
     * offered once the round is won, until one is picked. The enemy's answer
     * waits for the pick, since it is bred on the round as it will be fought.
     */
    ways?: readonly string[];
    /** What it is played under; the defaults where it says nothing. */
    settings?: SkirmishSettings;
    /** The upgrade cards the player has picked, by id, in the order picked. */
    cards?: readonly string[];
    /** The cards the enemy has drawn, by id, in the order drawn. */
    enemyCards?: readonly string[];
    /** Cards offered the player to pick one of, before they fight again. */
    hand?: readonly string[];
    /** Losses towards the next hand, each with a fleet that had not lost this round before. */
    streak?: number;
    /** The fleets that have lost this round, by id (`fleetId`). */
    losing?: readonly string[];
    /** The card picked since the last try, which the next try's row in the history shows. */
    picked?: string;
}

/**
 * What a skirmish is played under: how a round is set out and decided, and
 * how the enemy evolves its answer. Chosen when it starts, and kept with it.
 */
export interface SkirmishSettings {
    /** A side that has not fired, hit or rammed for this long is out, s. */
    readonly quietTime: number;
    /** A battle not decided by then is a draw, which is a loss for the player, s. */
    readonly timeCap: number;
    /** Clear water between the two fleets' furthest hulls at the start, metres. */
    readonly gap: number;
    /** Each fleet's starting speed towards the other, m/s. */
    readonly closingSpeed: number;
    /** Each fleet's starting speed across the line between them, to its left, m/s. */
    readonly crossingSpeed: number;
    /** How far either side of those three each round's are drawn, evenly; zero holds them. */
    readonly gapSpread: number;
    readonly closingSpread: number;
    readonly crossingSpread: number;
    /** Mutants a generation of the enemy's search, beside the best so far. */
    readonly mutants: number;
    /** Matches each enemy fights a generation, the next round's seed among them. */
    readonly seeds: number;
    /** How long a match of the search may last before the side ahead is taken to win, s. */
    readonly duration: number;
    /** Drills each enemy fights a generation against a bare core, which only add to its score. */
    readonly bareCoreDrills: number;
    /** Drills each enemy fights a generation, invincible, against the player's fleet, which only add to its score. */
    readonly shieldedDrills: number;
    /** Losses in a row, each with a new fleet, that earn the player a card; none for no cards. */
    readonly cardAfter: number;
    /** Generations without an answer before the enemy draws a card. */
    readonly stretchAfter: number;
    /**
     * How far ahead an answer must finish the round, its share of its own
     * starting mass still sound less the player's: room for what orders win back.
     */
    readonly answerMargin: number;
    /**
     * The most ships either side may field, unless the enemy already has more:
     * a limit on the work a battle is, more than on the fleets.
     */
    readonly maxShips: number;
    /** How far from its origin any of either side's hulls may reach, unless the enemy already reaches further, metres. */
    readonly radius: number;
    /** How bright each round's drawn light is, sun and shadows alike, as a multiple of what its seed draws: only seen, never fought. */
    readonly light: number;
    /**
     * How the enemy is bred: the mutation odds by the names the settings pages
     * give them (`evolution/mutationFields.ts`), each missing one its default.
     */
    readonly breeding: Readonly<Record<string, number>>;
    /**
     * The asteroids a round is fought among, and how far either side each
     * setting is drawn for a round, evenly: every round its own place, the same
     * for every try of it and for every match the enemy is bred in for it.
     */
    readonly map: MapSettings;
    readonly mapSpread: MapSettings;
}

export const DEFAULT_SKIRMISH_SETTINGS: SkirmishSettings = {
    quietTime: QUIET_TIME,
    timeCap: TIME_CAP,
    gap: 1500,
    closingSpeed: 0,
    crossingSpeed: 0,
    gapSpread: 0,
    closingSpread: 0,
    crossingSpread: 0,
    mutants: 5,
    seeds: 3,
    duration: 180,
    bareCoreDrills: 1,
    shieldedDrills: 1,
    cardAfter: 3,
    stretchAfter: 4,
    answerMargin: 0.2,
    maxShips: 3,
    radius: 500,
    light: 1,
    breeding: {},
    map: {},
    mapSpread: {},
};

/** A ship made or changed for a skirmish, filed under the skirmish's name. */
export function inSkirmish(blueprint: Blueprint, skirmish: Skirmish): Blueprint {
    const category = skirmish.name ?? "Skirmish";
    return blueprint.category === category ? blueprint : { ...blueprint, category };
}

/** What a skirmish is played under. */
export function settingsOf(skirmish: Skirmish): SkirmishSettings {
    return skirmish.settings ?? DEFAULT_SKIRMISH_SETTINGS;
}

/** The closest the fleets' origins start, metres: the custom battle's default range. */
const MIN_RANGE = 2000;

export function billOfFleet(fleet: Fleet): Bill {
    return fleetBill(fleetHulls(fleet));
}

/** A skirmish against `enemy`, the player's budget what it cost unless given. */
export function newSkirmish(
    enemy: Fleet,
    player: Fleet,
    seed: number,
    settings?: SkirmishSettings,
    budget?: Budget,
    name?: string,
): Skirmish {
    // An enemy unpainted is given a livery from the skirmish's seed, far from the player's colours.
    const away = [player.livery?.base ?? STOCK_BASES[0]];
    const painted = enemy.livery === undefined ? { ...enemy, livery: firstLivery(liveryRng(new Rng(seed), 0), away) } : enemy;
    return {
        ...(name === undefined || name.trim() === "" ? {} : { name: name.trim() }),
        enemy: painted,
        player,
        budget: budget === undefined ? billOfFleet(enemy) : { ...budget },
        round: 1,
        tries: 0,
        seed: seed >>> 0,
        ...(settings === undefined ? {} : { settings }),
    };
}

/**
 * What stops a fleet being priced or fought, short of its cost: an entry it
 * cannot place, or a design it flies that would not fly. Null if nothing.
 */
export function fleetFault(fleet: Fleet): string | null {
    const problem = fleetProblem(fleet) ?? hangarClashes(fleet)[0] ?? null;
    if (problem !== null) return problem;
    for (const name of new Set(expandFleet(fleet).map((ship) => ship.design))) {
        const design = blueprintProblem(fleetBlueprint(fleet, name));
        if (design !== null) return design;
    }
    return null;
}

/**
 * The player's limits before their cards: the skirmish's budget, ship count
 * and spread as set. Unlike the enemy's, none is raised to what the enemy
 * fields: the player builds their fleet after, to fit them.
 */
export function startLimits(skirmish: Skirmish): Limits {
    const settings = settingsOf(skirmish);
    return { budget: skirmish.budget, maxShips: settings.maxShips, radius: settings.radius };
}

/** What the player's fleet is held to: the starting limits, moved by the cards they hold. */
export function playerLimits(skirmish: Skirmish): Limits {
    return withCards(startLimits(skirmish), skirmish.cards ?? []);
}

/** Limits raised where need be to what `fleet` already costs, fields and reaches. */
export function atLeast(limits: Limits, fleet: Fleet): Limits {
    const hulls = fleetHulls(fleet);
    const bill = fleetBill(hulls);
    return {
        budget: {
            metal: math.max(bill.metal, limits.budget.metal),
            fuel: math.max(bill.fuel, limits.budget.fuel),
            build: math.max(bill.build, limits.budget.build),
        },
        maxShips: math.max(hulls.length, limits.maxShips),
        radius: math.max(fleetReach(hulls), limits.radius),
    };
}

/**
 * What the enemy is held to: the skirmish's budget, ship count and spread,
 * moved by its cards, and never less than what it already has.
 */
export function enemyLimits(skirmish: Skirmish): Limits {
    const settings = settingsOf(skirmish);
    const start = { budget: skirmish.budget, maxShips: settings.maxShips, radius: settings.radius };
    return atLeast(withCards(start, skirmish.enemyCards ?? []), skirmish.enemy);
}

/**
 * How the player's fleet breaks the skirmish's limit on ships or spread, or
 * null if it does not.
 */
export function overLimit(skirmish: Skirmish): string | null {
    const { maxShips, radius } = playerLimits(skirmish);
    const hulls = fleetHulls(skirmish.player);
    if (hulls.length > maxShips) return `${hulls.length} ships, more than the ${maxShips} allowed`;
    const reach = fleetReach(hulls);
    if (reach > radius) return `a spread of ${math.round(reach)} m, beyond the ${math.round(radius)} m allowed`;
    return null;
}

/**
 * Whether the player's fleet has a ship to fight with, every design flies, and
 * it is within budget and limits, with no card waiting to be picked.
 */
export function canFight(skirmish: Skirmish): boolean {
    const player = skirmish.player;
    return (
        skirmish.hand === undefined &&
        player.ships.length > 0 &&
        fleetFault(player) === null &&
        overLimit(skirmish) === null &&
        affords(playerLimits(skirmish).budget, billOfFleet(player))
    );
}

/** The battle a round is: the player's fleet first, so it is blue. */
export function roundSetup(skirmish: Skirmish): BattleSetup {
    return roundBattle(skirmish.player, skirmish.enemy, skirmish.seed, settingsOf(skirmish));
}

type Opening = Pick<
    SkirmishSettings,
    "gap" | "closingSpeed" | "crossingSpeed" | "gapSpread" | "closingSpread" | "crossingSpread" | "map" | "mapSpread"
>;

/** The map of the round on `seed`: its settings drawn from their spreads, from a generator of its own. */
export function roundMap(seed: number, settings: Pick<SkirmishSettings, "map" | "mapSpread">): MapSettings {
    return drawnMap(settings.map, settings.mapSpread, new Rng(seed ^ 0x6d6170));
}

/**
 * Two fleets as a round sets them out, on this seed, which also draws the gap
 * and speeds from their spreads. The map is the round's on `mapSeed`, which is
 * this seed's unless a search is fighting the round on another.
 */
export function roundBattle(
    player: Fleet,
    enemy: Fleet,
    seed: number,
    settings: Opening = DEFAULT_SKIRMISH_SETTINGS,
    mapSeed = seed,
): BattleSetup {
    // Always all three, in this order, so that widening one spread does not move the others.
    const draw = new Rng(seed ^ 0x5b4ead);
    const gap = settings.gap + settings.gapSpread * draw.nextRange(-1, 1);
    const closingSpeed = settings.closingSpeed + settings.closingSpread * draw.nextRange(-1, 1);
    const crossingSpeed = settings.crossingSpeed + settings.crossingSpread * draw.nextRange(-1, 1);
    const reach = fleetReach(fleetHulls(player)) + fleetReach(fleetHulls(enemy));
    const map = roundMap(mapSeed, settings);
    return {
        fleets: [player, enemy],
        range: math.max(MIN_RANGE, reach + math.max(0, gap)),
        closingSpeed,
        crossingSpeed,
        rotation: 0,
        seed,
        ...(hasAsteroids(map) ? { map, mapSeed } : {}),
    };
}

/** The round won: the enemy is to answer it on a new seed, the next round's. */
export function won(skirmish: Skirmish): Skirmish {
    const { picked: _picked, streak: _streak, ...rest } = skirmish;
    const seed = new Rng(skirmish.seed).nextUint32();
    const ways = offerDestinations(settingsOf(skirmish), seed);
    return { ...rest, won: seed, ...(ways.length === 0 ? {} : { ways }) };
}

/** The next round to be fought where `id` says, one of those offered; the enemy's answer can then start. */
export function goTo(skirmish: Skirmish, id: string): Skirmish {
    const { ways, ...rest } = skirmish;
    const destination = destinationById(id);
    if (ways === undefined || !ways.includes(id) || destination === null) return skirmish;
    return { ...rest, settings: destination.apply(settingsOf(skirmish)) };
}

/**
 * The same round, to be fought again. A loss with a fleet that has not lost
 * this round counts towards a hand of cards, drawn once enough have.
 */
export function lost(skirmish: Skirmish): Skirmish {
    const { picked: _picked, ...rest } = skirmish;
    const id = fleetId(serialiseFleet(skirmish.player));
    const losing = skirmish.losing ?? [];
    const counts = !losing.includes(id);
    const streak = (skirmish.streak ?? 0) + (counts ? 1 : 0);
    const next: Skirmish = { ...rest, tries: skirmish.tries + 1, losing: counts ? [...losing, id] : losing, streak };
    const after = settingsOf(skirmish).cardAfter;
    if (after < 1 || streak < after || skirmish.hand !== undefined) return next;
    const hand = drawHand(handRng(skirmish), startLimits(skirmish), skirmish.cards ?? []);
    return hand.length === 0 ? next : { ...next, streak: 0, hand };
}

/** The draw for the player's next hand: from the round's seed and the cards held, so a reload draws the same. */
function handRng(skirmish: Skirmish): Rng {
    return new Rng((skirmish.seed ^ 0x63617264 ^ math.imul(skirmish.cards?.length ?? 0, 0x9e3779b9)) >>> 0);
}

/** The card of the hand the player picks, kept; the rest go back. */
export function pick(skirmish: Skirmish, id: string): Skirmish {
    if (!(skirmish.hand ?? []).includes(id) || cardById(id) === null) return skirmish;
    const { hand: _hand, ...rest } = skirmish;
    return { ...rest, cards: [...(skirmish.cards ?? []), id], picked: id };
}

/**
 * The next round, against the enemy's answer, on the seed it won on: a new
 * one each round, and one the player's fleet as it stands loses, so it must
 * change to win. The budget is the player's and does not follow the enemy.
 */
export function nextRound(skirmish: Skirmish, enemy: Fleet): Skirmish {
    const { won, ways: _ways, losing: _losing, streak: _streak, ...rest } = skirmish;
    return { ...rest, enemy, round: skirmish.round + 1, tries: 0, seed: won ?? skirmish.seed };
}

export function serialiseSkirmish(skirmish: Skirmish): Record<string, unknown> {
    return {
        formatVersion: SKIRMISH_FORMAT_VERSION,
        ...(skirmish.name === undefined ? {} : { name: skirmish.name }),
        round: skirmish.round,
        tries: skirmish.tries,
        seed: skirmish.seed,
        ...(skirmish.won === undefined ? {} : { won: skirmish.won }),
        ...(skirmish.ways === undefined ? {} : { ways: [...skirmish.ways] }),
        ...(skirmish.cards === undefined ? {} : { cards: [...skirmish.cards] }),
        ...(skirmish.enemyCards === undefined ? {} : { enemyCards: [...skirmish.enemyCards] }),
        ...(skirmish.hand === undefined ? {} : { hand: [...skirmish.hand] }),
        ...(skirmish.streak === undefined ? {} : { streak: skirmish.streak }),
        ...(skirmish.losing === undefined ? {} : { losing: [...skirmish.losing] }),
        ...(skirmish.picked === undefined ? {} : { picked: skirmish.picked }),
        budget: { ...skirmish.budget },
        enemy: serialiseFleet(skirmish.enemy),
        player: serialiseFleet(skirmish.player),
        ...(skirmish.settings === undefined ? {} : { settings: { ...skirmish.settings, breeding: { ...skirmish.settings.breeding } } }),
    };
}

/** Settings as a file holds them, every number checked; what it leaves out is the default. */
export function parseSkirmishSettings(value: unknown): SkirmishSettings {
    const fail = (problem: string): never => {
        throw new Error(`Invalid skirmish settings — ${problem}`);
    };
    if (typeof value !== "object" || value === null || Array.isArray(value)) fail("they must be an object");
    const file = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(DEFAULT_SKIRMISH_SETTINGS) as (keyof SkirmishSettings)[]) {
        if (key === "breeding" || key === "map" || key === "mapSpread") continue;
        const n = file[key];
        if (n === undefined) continue;
        // Speeds may be negative; nothing else may.
        const signed = key === "closingSpeed" || key === "crossingSpeed";
        if (typeof n !== "number" || !Number.isFinite(n) || (!signed && n < 0))
            fail(`${key} must be a number${signed ? "" : " of at least zero"}`);
        out[key] = n;
    }
    const breeding: Record<string, number> = {};
    const raw = file["breeding"];
    if (raw !== undefined) {
        if (typeof raw !== "object" || raw === null || Array.isArray(raw)) fail("breeding must be an object");
        for (const [name, n] of Object.entries(raw as Record<string, unknown>)) {
            if (typeof n !== "number" || !Number.isFinite(n) || n < 0) fail(`breeding.${name} must be a number of at least zero`);
            breeding[name] = n as number;
        }
    }
    const map: Record<string, MapSettings> = {};
    for (const key of ["map", "mapSpread"] as const) {
        if (file[key] === undefined) continue;
        // Drawn from for each round, so a count may be partial: 7.5 ± 2.5 minors is 5 to 10.
        const problem = mapProblem(file[key], key, false);
        if (problem !== null) fail(problem);
        map[key] = { ...(file[key] as MapSettings) };
    }
    return { ...DEFAULT_SKIRMISH_SETTINGS, ...out, breeding, ...map };
}

export function parseSkirmish(value: unknown): Skirmish {
    const fail = (problem: string): never => {
        throw new Error(`Invalid skirmish — ${problem}`);
    };
    if (typeof value !== "object" || value === null || Array.isArray(value)) fail("it must be an object");
    const file = value as Record<string, unknown>;
    if (file["formatVersion"] !== SKIRMISH_FORMAT_VERSION) {
        fail(`formatVersion must be ${SKIRMISH_FORMAT_VERSION}, got ${JSON.stringify(file["formatVersion"])}`);
    }
    const whole = (key: string, least: number): number => {
        const n = file[key];
        if (typeof n !== "number" || !Number.isInteger(n) || n < least) fail(`${key} must be a whole number of at least ${least}`);
        return n as number;
    };
    const budget = file["budget"];
    if (typeof budget !== "object" || budget === null) fail("budget must be an object");
    const amount = (key: keyof Budget): number => {
        const n = (budget as Record<string, unknown>)[key];
        if (typeof n !== "number" || !(n >= 0)) fail(`budget.${key} must be a number of at least zero`);
        return n as number;
    };
    // An empty fleet is how a player starts building one, which a fleet file does not allow.
    const fleet = (key: string): Fleet => {
        const raw = file[key] as Record<string, unknown> | undefined;
        if (raw !== undefined && Array.isArray(raw["ships"]) && raw["ships"].length === 0) {
            return { name: typeof raw["name"] === "string" ? raw["name"] : "My fleet", designs: {}, ships: [] };
        }
        try {
            return parseFleet(raw);
        } catch (error) {
            return fail(`${key}: ${(error as Error).message}`);
        }
    };
    const wonSeed = file["won"] === undefined ? undefined : whole("won", 0);
    // Cards the deck has, by id; a skirmish from before cards, which kept a budget multiplier instead, holds none.
    const ids = (key: string, known: boolean): string[] | undefined => {
        const raw = file[key];
        if (raw === undefined) return undefined;
        if (!Array.isArray(raw) || raw.some((id) => typeof id !== "string" || (known && cardById(id) === null)))
            fail(`${key} must be a list of ${known ? "cards the deck has" : "ids"}`);
        return [...(raw as string[])];
    };
    const cards = ids("cards", true);
    const enemyCards = ids("enemyCards", true);
    const hand = ids("hand", true);
    const losing = ids("losing", false);
    const ways = ids("ways", false);
    if (ways?.some((id) => destinationById(id) === null)) fail("ways must be a list of destinations");
    const streak = file["streak"] === undefined ? undefined : whole("streak", 0);
    const picked = file["picked"];
    if (picked !== undefined && (typeof picked !== "string" || cardById(picked) === null)) fail("picked must be a card the deck has");
    const name = file["name"];
    if (name !== undefined && typeof name !== "string") fail("name must be text");
    return {
        ...(typeof name === "string" && name.trim() !== "" ? { name: name.trim() } : {}),
        ...(wonSeed === undefined ? {} : { won: wonSeed }),
        ...(wonSeed === undefined || ways === undefined ? {} : { ways }),
        ...(cards === undefined ? {} : { cards }),
        ...(enemyCards === undefined ? {} : { enemyCards }),
        ...(hand === undefined ? {} : { hand }),
        ...(streak === undefined ? {} : { streak }),
        ...(losing === undefined ? {} : { losing }),
        ...(typeof picked === "string" ? { picked } : {}),
        round: whole("round", 1),
        tries: whole("tries", 0),
        seed: whole("seed", 0),
        budget: { metal: amount("metal"), fuel: amount("fuel"), build: amount("build") },
        enemy: fleet("enemy"),
        player: fleet("player"),
        ...(file["settings"] === undefined ? {} : { settings: settingsIn(file["settings"]) }),
    };
    function settingsIn(raw: unknown): SkirmishSettings {
        try {
            // Settings saved before answers had a margin go on without one.
            const settings = parseSkirmishSettings(raw);
            return (raw as Record<string, unknown>)["answerMargin"] === undefined ? { ...settings, answerMargin: 0 } : settings;
        } catch (error) {
            return fail(`settings: ${(error as Error).message}`);
        }
    }
}

/** What a skirmish's exported file is called: its name, or "skirmish", and the round it is on. */
export function skirmishFileName(skirmish: Skirmish | null): string {
    const name = (skirmish?.name ?? "skirmish").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "skirmish";
    return `${skirmish === null ? name : `${name}-round-${skirmish.round}`}.skirmish.json`;
}

/** Where a page keeps the skirmish in progress, so it can be picked up again. */
export const SKIRMISH_STORAGE_KEY = "scs2d.skirmish";
