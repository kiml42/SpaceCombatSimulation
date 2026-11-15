import { describe, expect, it } from "vitest";
import { Claim, Resource, Supply, type Store } from "../sim/index.js";

/** Who gets a piece of hull's stores when there is not enough to go round. */

/** One body of four modules on one piece of hull, holding `held` of everything. */
function storeOf(held: { value: number }): Store {
    const layout = {};
    return {
        offered: () => held.value,
        pieceAt: () => 0,
        piecesOf: () => 1,
        modulesOf: () => 4,
        layoutOf: () => layout,
    } as unknown as Store;
}

function setup(held: number) {
    const box = { value: held };
    const store = storeOf(box);
    const supply = new Supply([store, store, store]);
    let tick = 0;
    return {
        box,
        /** What module `m`, drawing for `claim` at `priority`, may take of metal on this step, wanting `want` in all. */
        allow: (m: number, claim: Claim, priority: number, want: number, reserve = 0) =>
            supply.allow(0, Resource.Metal, m, claim, priority, want, reserve, tick),
        took: (m: number, claim: Claim, amount: number) => {
            supply.took(0, Resource.Metal, m, claim, amount);
            box.value -= amount;
        },
        step: () => tick++,
    };
}

const BAY = 0;
const SLIPWAY = 1;
const PAD = 2;
const ENGINE = 3;

describe("supply", () => {
    it("serves a higher priority in full before a lower one gets any", () => {
        const s = setup(100);
        s.allow(BAY, Claim.Robots, 2, 80);
        s.allow(SLIPWAY, Claim.Slipway, 1, 80);
        s.step();
        expect(s.allow(BAY, Claim.Robots, 2, 80)).toBe(100);
        expect(s.allow(SLIPWAY, Claim.Slipway, 1, 80)).toBe(20);
    });

    it("shares one priority out in proportion to what each wants", () => {
        const s = setup(40);
        s.allow(PAD, Claim.Pads, 1, 150);
        s.allow(BAY, Claim.Robots, 1, 50);
        s.step();
        expect(s.allow(PAD, Claim.Pads, 1, 150)).toBe(30);
        expect(s.allow(BAY, Claim.Robots, 1, 50)).toBe(10);

        // Enough for both: each gets what it wants, and nobody takes the rest from the other.
        const t = setup(40);
        t.allow(PAD, Claim.Pads, 1, 5);
        t.allow(BAY, Claim.Robots, 1, 20);
        t.step();
        expect(t.allow(BAY, Claim.Robots, 1, 20)).toBe(35);
    });

    it("lets a claim that took its share leave the rest to the others", () => {
        const s = setup(40);
        s.allow(PAD, Claim.Pads, 1, 100);
        s.allow(BAY, Claim.Robots, 1, 100);
        s.step();
        expect(s.allow(PAD, Claim.Pads, 1, 100)).toBe(20);
        s.took(PAD, Claim.Pads, 20);
        expect(s.allow(BAY, Claim.Robots, 1, 100)).toBe(20);
    });

    it("keeps a part's work and its mending apart, at its one priority", () => {
        const s = setup(100);
        s.allow(BAY, Claim.Robots, 1, 100);
        s.allow(BAY, Claim.Mend, 1, 100);
        s.step();
        expect(s.allow(BAY, Claim.Robots, 1, 100)).toBe(50);
        expect(s.allow(BAY, Claim.Mend, 1, 100)).toBe(50);
    });

    it("keeps the reserve for the ship's own engines, weapons and mending", () => {
        const s = setup(100);
        expect(s.allow(BAY, Claim.Robots, 1, 10, 30)).toBe(70);
        expect(s.allow(ENGINE, Claim.Fire, 3, 10, 30)).toBe(100);
        expect(s.allow(ENGINE, Claim.Mend, 3, 10, 30)).toBe(100);
    });

    it("lets a claim asking for the first time have only what nobody wanted", () => {
        const s = setup(100);
        s.allow(BAY, Claim.Robots, 1, 100);
        s.step();
        // The pad asked for nothing last step, so the bay had it all shared to it.
        expect(s.allow(PAD, Claim.Pads, 2, 50)).toBe(100);
        expect(s.allow(BAY, Claim.Robots, 1, 100)).toBe(100);
        s.step();
        // From the next step, by their priorities.
        expect(s.allow(PAD, Claim.Pads, 2, 50)).toBe(100);
        expect(s.allow(BAY, Claim.Robots, 1, 100)).toBe(50);
    });

    it("forgets a want nobody repeats", () => {
        const s = setup(100);
        s.allow(PAD, Claim.Pads, 2, 100);
        s.step();
        expect(s.allow(BAY, Claim.Robots, 1, 10)).toBe(0);
        s.step();
        expect(s.allow(BAY, Claim.Robots, 1, 10)).toBe(100);
    });
});
