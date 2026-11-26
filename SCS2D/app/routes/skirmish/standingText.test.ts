import { describe, expect, it } from "vitest";
import type { ShipStanding } from "~/scenarios/decision";
import { Unarmed } from "~/sim/index";
import { ableLine, outLine, quietLine } from "./standingText";

const ship = (over: Partial<ShipStanding>): ShipStanding => ({
    team: 0,
    name: "1",
    design: "Gunny",
    unarmed: Unarmed.None,
    immobile: Unarmed.None,
    rounds: 0,
    quietFor: null,
    nearest: Infinity,
    ...over,
});

describe("why a ship is out of the fight", () => {
    it("names fuel, the casings it could not fire, and dry engines", () => {
        expect(outLine(ship({ unarmed: Unarmed.NoFuel, immobile: Unarmed.NoFuel, rounds: 4 }))).toBe(
            "out of fuel to reload; casings for 4 rounds aboard; its engines are dry",
        );
    });

    it("says no more than that its core is out, when it is", () => {
        expect(outLine(ship({ unarmed: Unarmed.NoCore, immobile: Unarmed.NoCore, rounds: 9 }))).toBe("its core is out");
    });

    it("says how long a ship that went quiet had not fired, and how far off the enemy was", () => {
        expect(quietLine(ship({ quietFor: 31.4, nearest: 2400 }))).toBe("last fired 31 s ago; nearest enemy 2.4 km away");
    });

    it("says what a ship still able to fight had", () => {
        expect(ableLine(ship({ rounds: 1 }))).toBe("1 round aboard; never fired");
    });
});
