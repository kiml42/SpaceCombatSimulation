import { describe, expect, it } from "vitest";
import { standings } from "../scenarios/decision.js";

/** Ships named one way and painted another, as a piece broken off a ship is. */
function stood(ships: readonly { name: string; cores: readonly (string | null)[] }[]): string[] {
    const fake = {
        highWater: ships.length,
        teamOf: () => 1,
        isDerelict: () => false,
        isAlive: () => true,
        nameOf: (i: number) => ships[i]!.name,
        coreNames: (i: number, out: (string | null)[]) => {
            out.length = 0;
            out.push(...ships[i]!.cores);
        },
        designs: ships.map(() => ({ name: "Gunship" })),
        whyUnarmed: () => 0,
        whyImmobile: () => 0,
        roundsAboard: () => 0,
        lastFired: () => -1,
        nearestEnemy: () => 100,
    };
    return standings({ ships: fake as never, world: { tick: 0, dt: 1 } }, 2).map((standing) => standing.name);
}

describe("a ship in the standings", () => {
    it("is named as its hull is labelled, by every core it carries", () => {
        expect(stood([{ name: "3.1", cores: ["3.2"] }])).toEqual(["3.2"]);
        expect(stood([{ name: "4.1", cores: ["4.1", "4.3", null] }])).toEqual(["4.1, 4.3"]);
    });

    it("keeps its own name where no core of its is painted", () => {
        expect(stood([{ name: "5.1", cores: [null, null] }])).toEqual(["5.1"]);
    });
});
