import { describe, expect, it } from "vitest";
import { Rng } from "../sim/index.js";
import { DECK, drawHand, effectText, fits, isSimple, neediest, parseDeck, withCards, type Limits } from "../skirmish/cards.js";
import deckFile from "../skirmish/cards.json" with { type: "json" };

const START: Limits = { budget: { metal: 1000, fuel: 100, build: 50 }, maxShips: 4, radius: 500 };

describe("the upgrade card deck", () => {
    it("reads, every card named once, with simple cards and trade-offs both", () => {
        expect(DECK).toEqual(parseDeck(deckFile));
        expect(new Set(DECK.map((card) => card.id)).size).toBe(DECK.length);
        expect(DECK.filter(isSimple).map((card) => card.id)).toEqual(["metal", "fuel", "build", "ship", "spread"]);
        expect(DECK.length).toBe(13);
    });

    it("refuses a card it cannot use", () => {
        const card = (effects: unknown) => ({ formatVersion: 1, cards: [{ id: "x", name: "X", effects }] });
        expect(() => parseDeck(card([]))).toThrow(/effect/);
        expect(() => parseDeck(card([{ limit: "metal", step: 1 }]))).toThrow(/share/);
        expect(() => parseDeck(card([{ limit: "ships", step: 0.5 }]))).toThrow(/whole/);
        expect(() => parseDeck(card([{ limit: "armour", share: 0.1 }]))).toThrow(/not a limit/);
        expect(() =>
            parseDeck(
                card([
                    { limit: "fuel", share: 0.1 },
                    { limit: "fuel", share: 0.1 },
                ]),
            ),
        ).toThrow(/twice/);
        expect(() =>
            parseDeck({
                formatVersion: 1,
                cards: [
                    { id: "x", name: "X", effects: [{ limit: "fuel", share: 0.1 }] },
                    { id: "x", name: "Y", effects: [{ limit: "fuel", share: 0.1 }] },
                ],
            }),
        ).toThrow(/two cards/);
    });

    it("writes what each effect does", () => {
        expect(effectText({ limit: "build", share: 0.15 })).toEqual({ amount: "+15%", limit: "build", word: "build time" });
        expect(effectText({ limit: "fuel", share: -0.1 })).toEqual({ amount: "−10%", limit: "fuel", word: "fuel" });
        expect(effectText({ limit: "ships", step: 1 }).word).toBe("ship");
        expect(effectText({ limit: "spread", step: -100 }).amount).toBe("−100 m");
    });
});

describe("cards held", () => {
    it("add shares of where the limits started, never cutting one below half, nor ships below one", () => {
        const limits = withCards(START, ["metal", "metal", "spread-for-ship"]);
        expect(limits.budget.metal).toBeCloseTo(1200);
        expect(limits.maxShips).toBe(5);
        expect(limits.radius).toBe(400);
        const cut = withCards(START, Array<string>(10).fill("ship-for-metal"));
        expect(cut.maxShips).toBe(2);
        expect(withCards({ ...START, maxShips: 1 }, ["ship-for-metal"]).maxShips).toBe(1);
    });

    it("are drawn only where they would not cut a limit past its floor", () => {
        const fuelLow = Array<string>(5).fill("fuel-for-metal");
        const card = DECK.find((c) => c.id === "fuel-for-build")!;
        expect(fits(START, fuelLow, card)).toBe(false);
        expect(fits(START, fuelLow.slice(1), card)).toBe(true);
        for (let seed = 0; seed < 50; seed++) expect(drawHand(new Rng(seed), START, fuelLow)).not.toContain("fuel-for-build");
    });

    it("are drawn three different at a time, the same from the same seed", () => {
        const hand = drawHand(new Rng(3), START, []);
        expect(hand).toHaveLength(3);
        expect(new Set(hand).size).toBe(3);
        expect(drawHand(new Rng(3), START, [])).toEqual(hand);
        for (const id of drawHand(new Rng(4), START, [], isSimple)) expect(isSimple(DECK.find((c) => c.id === id)!)).toBe(true);
    });

    it("go to the enemy for what it presses hardest, the first drawn on a tie", () => {
        const usage = { metal: 0.9, fuel: 0.3, build: 0.95, ships: 0.5, spread: 0.2 };
        expect(neediest(["fuel", "metal", "build"], usage)).toBe("build");
        expect(neediest(["fuel", "metal", "ship"], usage)).toBe("metal");
        expect(neediest(["spread", "fuel"], { ...usage, spread: 0.3 })).toBe("spread");
    });
});
