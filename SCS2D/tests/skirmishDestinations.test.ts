import { describe, expect, it } from "vitest";
import { shipFleet } from "../sim/index.js";
import { GUNSHIP } from "../scenarios/blueprints.js";
import {
    DEFAULT_SKIRMISH_SETTINGS,
    goTo,
    newSkirmish,
    nextRound,
    parseSkirmish,
    serialiseSkirmish,
    settingsOf,
    won,
} from "../scenarios/skirmish.js";
import { DESTINATIONS, destinationById, OFFERED, offerDestinations } from "../skirmish/destinations.js";

const gunship = shipFleet(GUNSHIP);

describe("where the next round is fought", () => {
    it("offers a few that would each change something, the same for the same seed", () => {
        const offered = offerDestinations(DEFAULT_SKIRMISH_SETTINGS, 7);
        expect(offered).toHaveLength(OFFERED);
        expect(new Set(offered).size).toBe(OFFERED);
        expect(offerDestinations(DEFAULT_SKIRMISH_SETTINGS, 7)).toEqual(offered);
        // With no rock and the fleets at rest, there is nothing to clear and nothing to stop.
        for (let seed = 0; seed < 50; seed++) {
            const ids = offerDestinations(DEFAULT_SKIRMISH_SETTINGS, seed);
            expect(ids).not.toContain("clear");
            expect(ids).not.toContain("still");
        }
    });

    it("each changes the settings it says it does", () => {
        for (const destination of DESTINATIONS) {
            const from = destination.open(DEFAULT_SKIRMISH_SETTINGS)
                ? DEFAULT_SKIRMISH_SETTINGS
                : DESTINATIONS[2]!.apply(DESTINATIONS[4]!.apply(DEFAULT_SKIRMISH_SETTINGS));
            expect(destination.open(from)).toBe(true);
            expect(destination.apply(from)).not.toEqual(from);
        }
        expect(destinationById("rocks")!.apply(DEFAULT_SKIRMISH_SETTINGS).map).toMatchObject({ majors: 1, minors: 6 });
    });

    it("waits on a round won until one is picked, which then decides how the next is fought", () => {
        const skirmish = won(newSkirmish(gunship, gunship, 5));
        expect(skirmish.ways).toHaveLength(OFFERED);
        const back = parseSkirmish(JSON.parse(JSON.stringify(serialiseSkirmish(skirmish))));
        expect(back.ways).toEqual(skirmish.ways);
        // Only one of those offered is taken.
        const unoffered = DESTINATIONS.find((d) => !skirmish.ways!.includes(d.id))!.id;
        expect(goTo(skirmish, unoffered)).toBe(skirmish);
        const id = skirmish.ways![0]!;
        const going = goTo(skirmish, id);
        expect(going.ways).toBeUndefined();
        expect(going.won).toBe(skirmish.won);
        expect(settingsOf(going)).toEqual(destinationById(id)!.apply(DEFAULT_SKIRMISH_SETTINGS));
        expect(settingsOf(nextRound(going, gunship))).toEqual(settingsOf(going));
    });
});
