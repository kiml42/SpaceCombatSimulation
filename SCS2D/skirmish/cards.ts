import { math, Rng, type Budget } from "../sim/index.js";
import deckFile from "./cards.json" with { type: "json" };

/**
 * Upgrade cards (#691): what a skirmish's player picks after losing a few
 * times running, and what its enemy draws when its search stalls. Each moves
 * the limits a side builds its fleet to. The deck is data, in `cards.json`.
 */

/** What a card can move: the three costs, the ship count and how far a fleet may spread. */
export type Limit = "metal" | "fuel" | "build" | "ships" | "spread";

/** The three costs, which a card moves by a share of where the skirmish started them. */
export const RESOURCES = ["metal", "fuel", "build"] as const;
export type Resource = (typeof RESOURCES)[number];

/** One change a card makes: a share of the starting value for a cost, a whole step for ships and spread. */
export type Effect = { readonly limit: Resource; readonly share: number } | { readonly limit: "ships" | "spread"; readonly step: number };

export interface Card {
    readonly id: string;
    readonly name: string;
    readonly effects: readonly Effect[];
}

/** The limits a side's fleet is held to. */
export interface Limits {
    readonly budget: Budget;
    readonly maxShips: number;
    /** How far from its origin any hull may reach, metres. */
    readonly radius: number;
}

/** No limit falls below this share of where it started. */
export const FLOOR = 0.5;

/** How many cards a hand offers. */
export const HAND = 3;

export function isResource(limit: Limit): limit is Resource {
    return (RESOURCES as readonly string[]).includes(limit);
}

/** The number an effect moves its limit by: a share, or a step. */
export function amountOf(effect: Effect): number {
    return "share" in effect ? effect.share : effect.step;
}

/** Whether a card only adds: a trade-off cuts something. */
export function isSimple(card: Card): boolean {
    return card.effects.every((effect) => amountOf(effect) > 0);
}

/** The resource a card adds to, which colours it, or null if it adds only ships or spread. */
export function cardResource(card: Card): Resource | null {
    for (const effect of card.effects) if (amountOf(effect) > 0 && isResource(effect.limit)) return effect.limit;
    return null;
}

/** What an effect says on a card: its change, and what it changes. */
export function effectText(effect: Effect): { readonly amount: string; readonly limit: Limit; readonly word: string } {
    const n = amountOf(effect);
    const sign = n < 0 ? "−" : "+";
    const size = math.abs(n);
    if ("share" in effect) {
        const word = effect.limit === "build" ? "build time" : effect.limit;
        return { amount: `${sign}${math.round(size * 1000) / 10}%`, limit: effect.limit, word };
    }
    if (effect.limit === "ships") return { amount: `${sign}${size}`, limit: "ships", word: size === 1 ? "ship" : "ships" };
    return { amount: `${sign}${size} m`, limit: "spread", word: "spread" };
}

/** A deck as its file holds it, every card checked. */
export function parseDeck(value: unknown): Card[] {
    const fail = (problem: string): never => {
        throw new Error(`Invalid card deck — ${problem}`);
    };
    if (typeof value !== "object" || value === null || Array.isArray(value)) fail("it must be an object");
    const file = value as Record<string, unknown>;
    if (file["formatVersion"] !== 1) fail(`formatVersion must be 1, got ${JSON.stringify(file["formatVersion"])}`);
    if (!Array.isArray(file["cards"])) fail("cards must be a list");
    const seen = new Set<string>();
    return (file["cards"] as unknown[]).map((raw, i) => {
        if (typeof raw !== "object" || raw === null) return fail(`card ${i} must be an object`);
        const card = raw as Record<string, unknown>;
        const id = card["id"];
        if (typeof id !== "string" || id === "") return fail(`card ${i} needs an id`);
        if (seen.has(id)) return fail(`two cards are called ${id}`);
        seen.add(id);
        const name = card["name"];
        if (typeof name !== "string" || name.trim() === "") return fail(`${id} needs a name`);
        const effects = card["effects"];
        if (!Array.isArray(effects) || effects.length === 0) return fail(`${id} needs at least one effect`);
        const limits = new Set<string>();
        return {
            id,
            name,
            effects: effects.map((e: unknown): Effect => {
                const effect = (typeof e === "object" && e !== null ? e : {}) as Record<string, unknown>;
                const limit = effect["limit"];
                if (typeof limit !== "string" || limits.has(limit)) return fail(`${id} moves ${String(limit)} twice, or nothing`);
                limits.add(limit);
                if (limit === "metal" || limit === "fuel" || limit === "build") {
                    const share = effect["share"];
                    if (typeof share !== "number" || !Number.isFinite(share) || share === 0 || share <= -FLOOR)
                        return fail(`${id}: ${limit} needs a share, not zero, above −${FLOOR}`);
                    return { limit, share };
                }
                if (limit === "ships" || limit === "spread") {
                    const step = effect["step"];
                    if (typeof step !== "number" || !Number.isFinite(step) || step === 0 || (limit === "ships" && !Number.isInteger(step)))
                        return fail(`${id}: ${limit} needs a step, not zero${limit === "ships" ? ", and whole" : ""}`);
                    return { limit, step };
                }
                return fail(`${id} moves ${limit}, which is not a limit`);
            }),
        };
    });
}

/** Every card there is. */
export const DECK: readonly Card[] = parseDeck(deckFile);

const BY_ID = new Map(DECK.map((card) => [card.id, card]));

/** The card with this id, or null if the deck has none. */
export function cardById(id: string): Card | null {
    return BY_ID.get(id) ?? null;
}

/** The cards of these ids, any the deck no longer has left out. */
export function cardsOf(ids: readonly string[]): Card[] {
    return ids.flatMap((id) => cardById(id) ?? []);
}

/** How far every limit has been moved by these cards: shares summed for costs, steps for ships and spread. */
function moved(cards: readonly Card[]): Record<Limit, number> {
    const out: Record<Limit, number> = { metal: 0, fuel: 0, build: 0, ships: 0, spread: 0 };
    for (const card of cards) for (const effect of card.effects) out[effect.limit] += amountOf(effect);
    return out;
}

/** The fewest ships a side may be cut to. */
function shipFloor(start: number): number {
    return math.max(1, math.ceil(start * FLOOR));
}

/**
 * The limits these cards make of the starting ones: a cost moved by its
 * shares of where it started, ships and spread by their steps, none below its
 * floor.
 */
export function withCards(start: Limits, ids: readonly string[]): Limits {
    const by = moved(cardsOf(ids));
    const cost = (key: Resource): number => start.budget[key] * math.max(FLOOR, 1 + by[key]);
    return {
        budget: { metal: cost("metal"), fuel: cost("fuel"), build: cost("build") },
        maxShips: math.max(shipFloor(start.maxShips), start.maxShips + by.ships),
        radius: math.max(start.radius * FLOOR, start.radius + by.spread),
    };
}

/** Whether a side holding `held` could take `card` without cutting any limit past its floor. */
export function fits(start: Limits, held: readonly string[], card: Card): boolean {
    const by = moved([...cardsOf(held), card]);
    for (const effect of card.effects) {
        if (amountOf(effect) > 0) continue;
        const limit = effect.limit;
        if (isResource(limit) && 1 + by[limit] < FLOOR) return false;
        if (limit === "ships" && start.maxShips + by.ships < shipFloor(start.maxShips)) return false;
        if (limit === "spread" && start.radius + by.spread < start.radius * FLOOR) return false;
    }
    return true;
}

/**
 * Up to `HAND` different cards from those `allowed`, drawn from `rng`: any a
 * side holding `held` could take, the deck's order kept for those drawn.
 */
export function drawHand(rng: Rng, start: Limits, held: readonly string[], allowed: (card: Card) => boolean = () => true): string[] {
    const pool = DECK.filter((card) => allowed(card) && fits(start, held, card));
    const hand: string[] = [];
    while (hand.length < HAND && pool.length > 0) hand.push(pool.splice(rng.nextInt(pool.length), 1)[0]!.id);
    return hand;
}

/** How much of each limit a fleet uses, as a share of it. */
export type Usage = Readonly<Record<Limit, number>>;

/**
 * The card of `hand` for the limit a fleet presses hardest, by its share of
 * it used: the enemy's pick. The first drawn on a tie.
 */
export function neediest(hand: readonly string[], usage: Usage): string | null {
    let best: string | null = null;
    let most = -Infinity;
    for (const id of hand) {
        const card = cardById(id);
        if (card === null) continue;
        let share = -Infinity;
        for (const effect of card.effects) if (amountOf(effect) > 0) share = math.max(share, usage[effect.limit]);
        if (share > most) {
            most = share;
            best = id;
        }
    }
    return best;
}

/** A share of a limit used, nothing where the limit is none or unbounded. */
export function shareOf(used: number, limit: number): number {
    return limit > 0 && Number.isFinite(limit) ? used / limit : 0;
}
