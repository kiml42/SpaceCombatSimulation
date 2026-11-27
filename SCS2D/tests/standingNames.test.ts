import { describe, expect, it } from "vitest";
import { mostRelevant, standings, type ShipStanding } from "../scenarios/decision.js";
import { Unarmed } from "../sim/index.js";

/** Ships named one way and painted another, as a piece broken off a ship is. */
function stood(ships: readonly { name: string; cores: readonly (string | null)[]; gone?: boolean }[]): string[] {
    const fake = {
        highWater: ships.length,
        teamOf: () => 1,
        isDerelict: () => false,
        isAlive: (i: number) => ships[i]!.gone !== true,
        nameOf: (i: number) => ships[i]!.name,
        coreNames: (i: number, out: (string | null)[]) => {
            // As a ship gone has nothing left to read its paint from.
            if (ships[i]!.gone === true) throw new Error("no hull");
            out.length = 0;
            out.push(...ships[i]!.cores);
        },
        designs: ships.map((ship) => (ship.gone === true ? null : { name: "Gunship" })),
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

    it("leaves out a ship that is gone, which has no hull or design left to name it by", () => {
        expect(
            stood([
                { name: "6", cores: [], gone: true },
                { name: "7", cores: ["7"] },
            ]),
        ).toEqual(["7"]);
    });
});

describe("the ships a report names", () => {
    const ship = (name: string, quietFor: number | null, unarmed = Unarmed.None): ShipStanding => ({
        team: 1,
        name,
        design: "Gunship",
        unarmed,
        immobile: Unarmed.None,
        rounds: 0,
        quietFor,
        nearest: 100,
    });

    it("are the five most recently fired, those that never fired last", () => {
        const stood = [ship("a", null), ship("b", 40), ship("c", 5), ship("d", 90), ship("e", 10), ship("f", 20), ship("g", 30)];
        expect(mostRelevant(stood).map((s) => s.name)).toEqual(["c", "e", "f", "g", "b"]);
    });

    it("put those still able to fight first among those that fired as long ago", () => {
        const stood = [ship("out", 10, Unarmed.NoAmmunition), ship("able", 10)];
        expect(mostRelevant(stood).map((s) => s.name)).toEqual(["able", "out"]);
    });
});
