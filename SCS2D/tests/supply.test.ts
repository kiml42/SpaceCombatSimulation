import { describe, expect, it } from "vitest";
import { Claim, DEFAULT_DOCTRINE, Resource, Supply, type Approach, type Store } from "../sim/index.js";

/** Who gets a piece of hull's stores when there is not enough to go round. */

/** One body, one piece of hull, holding `held` of everything. */
function storeOf(held: { value: number }): Store {
    const layout = {};
    return {
        offered: () => held.value,
        pieceAt: () => 0,
        piecesOf: () => 1,
        layoutOf: () => layout,
    } as unknown as Store;
}

function setup(held: number, changes: Partial<Approach> = {}) {
    const box = { value: held };
    const store = storeOf(box);
    const supply = new Supply([store, store, store]);
    const approach = { ...DEFAULT_DOCTRINE.approach, ...changes };
    let tick = 0;
    return {
        box,
        /** What `claim` may take of metal on this step, wanting `want` in all. */
        allow: (claim: Claim, want: number, reserve = 0) => supply.allow(0, Resource.Metal, 0, claim, want, reserve, approach, tick),
        took: (claim: Claim, amount: number) => {
            supply.took(0, Resource.Metal, 0, claim, amount);
            box.value -= amount;
        },
        step: () => tick++,
    };
}

describe("supply", () => {
    it("serves a higher priority in full before a lower one gets any", () => {
        const s = setup(100, { robotsPriority: 2, slipwayPriority: 1 });
        s.allow(Claim.Robots, 80);
        s.allow(Claim.Slipway, 80);
        s.step();
        expect(s.allow(Claim.Robots, 80)).toBe(100);
        expect(s.allow(Claim.Slipway, 80)).toBe(20);
    });

    it("shares one priority out by share, none past what it wants", () => {
        const s = setup(40, { padsPriority: 1, robotsPriority: 1, padsShare: 3, robotsShare: 1 });
        s.allow(Claim.Pads, 100);
        s.allow(Claim.Robots, 100);
        s.step();
        expect(s.allow(Claim.Pads, 100)).toBe(30);
        expect(s.allow(Claim.Robots, 100)).toBe(10);

        // Wanting less than its share, the rest goes to the other.
        const t = setup(40, { padsPriority: 1, robotsPriority: 1, padsShare: 3, robotsShare: 1 });
        t.allow(Claim.Pads, 5);
        t.allow(Claim.Robots, 100);
        t.step();
        expect(t.allow(Claim.Robots, 100)).toBe(35);
    });

    it("lets a claim that took its share leave the rest to the others", () => {
        const s = setup(40, { padsPriority: 1, robotsPriority: 1, padsShare: 1, robotsShare: 1 });
        s.allow(Claim.Pads, 100);
        s.allow(Claim.Robots, 100);
        s.step();
        expect(s.allow(Claim.Pads, 100)).toBe(20);
        s.took(Claim.Pads, 20);
        expect(s.allow(Claim.Robots, 100)).toBe(20);
    });

    it("keeps the reserve for the ship's own engines, weapons and mending", () => {
        const s = setup(100);
        expect(s.allow(Claim.Robots, 10, 30)).toBe(70);
        expect(s.allow(Claim.Fire, 10, 30)).toBe(100);
        expect(s.allow(Claim.MendEngines, 10, 30)).toBe(100);
    });

    it("lets a claim asking for the first time have only what nobody wanted", () => {
        const s = setup(100, { robotsPriority: 1, padsPriority: 2 });
        s.allow(Claim.Robots, 100);
        s.step();
        // Pads asked for nothing last step, so robots had it all shared to them.
        expect(s.allow(Claim.Pads, 50)).toBe(100);
        expect(s.allow(Claim.Robots, 100)).toBe(100);
        s.step();
        // From the next step, by their priorities.
        expect(s.allow(Claim.Pads, 50)).toBe(100);
        expect(s.allow(Claim.Robots, 100)).toBe(50);
    });

    it("forgets a want nobody repeats", () => {
        const s = setup(100, { robotsPriority: 1, padsPriority: 2 });
        s.allow(Claim.Pads, 100);
        s.step();
        expect(s.allow(Claim.Robots, 10)).toBe(0);
        s.step();
        expect(s.allow(Claim.Robots, 10)).toBe(100);
    });
});
