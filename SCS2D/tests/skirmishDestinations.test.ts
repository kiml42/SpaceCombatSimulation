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
import { arriveAt, describeArena, DESTINATIONS, destinationById, OFFERED, offerDestinations } from "../skirmish/destinations.js";
import { startLighting } from "../scenarios/lights.js";

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

    it("says what a round is like as its settings set it out", () => {
        expect(describeArena(DEFAULT_SKIRMISH_SETTINGS)).toBe("Open space, 1,500 m apart, from rest");
        const busy = ["rocks", "rocks", "headOn"].reduce((s, id) => destinationById(id)!.apply(s), {
            ...DEFAULT_SKIRMISH_SETTINGS,
            light: 0.6,
        });
        expect(describeArena(busy)).toBe("2 major and 12 minor asteroids, 1,500 m apart, closing at 40 m/s, 60% sunlight");
    });

    it("says what each changes, from what to what, and what that means", () => {
        expect(destinationById("further")!.change(DEFAULT_SKIRMISH_SETTINGS)).toBe("Fleets start 1,500 m → 3,000 m apart");
        expect(destinationById("closer")!.change(DEFAULT_SKIRMISH_SETTINGS)).toBe("Fleets start 1,500 m → 0 m apart");
        expect(destinationById("rocks")!.change(DEFAULT_SKIRMISH_SETTINGS)).toBe("Major asteroids 0 → 1, minor 0 → 6");
        // Only the speeds it stops.
        expect(destinationById("still")!.change({ ...DEFAULT_SKIRMISH_SETTINGS, crossingSpeed: 40 })).toBe("Crossing 40 → 0 m/s");
        for (const destination of DESTINATIONS) expect(destination.means.length).toBeGreaterThan(0);
    });

    it("each changes the settings it says it does", () => {
        // Rock and speed: somewhere every one of them is open.
        const busy = ["rocks", "headOn"].reduce((s, id) => destinationById(id)!.apply(s), DEFAULT_SKIRMISH_SETTINGS);
        for (const destination of DESTINATIONS) {
            const from = destination.open(DEFAULT_SKIRMISH_SETTINGS) ? DEFAULT_SKIRMISH_SETTINGS : busy;
            expect(destination.open(from)).toBe(true);
            expect(destination.apply(from)).not.toEqual(from);
        }
        expect(destinationById("rocks")!.apply(DEFAULT_SKIRMISH_SETTINGS).map).toMatchObject({ majors: 1, minors: 6 });
        // No further than two majors, which orbit truly; more only where the setup asked for them.
        const rocks = destinationById("rocks")!;
        const two = rocks.apply(rocks.apply(DEFAULT_SKIRMISH_SETTINGS));
        expect(two.map).toMatchObject({ majors: 2, minors: 12 });
        expect(rocks.apply(two).map).toMatchObject({ majors: 2, minors: 18 });
        const three = { ...DEFAULT_SKIRMISH_SETTINGS, map: { majors: 3 } };
        expect(rocks.apply(three).map.majors).toBe(3);
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
        expect(settingsOf(going)).toEqual(arriveAt(DEFAULT_SKIRMISH_SETTINGS, skirmish.won!, id, skirmish.seed));
        expect(settingsOf(nextRound(going, gunship))).toEqual(settingsOf(going));
        // Where it is headed is kept while the enemy answers, and gone once the next round starts.
        expect(going.headed).toBe(id);
        expect(parseSkirmish(JSON.parse(JSON.stringify(serialiseSkirmish(going)))).headed).toEqual(going.headed);
        expect(nextRound(going, gunship).headed).toBeUndefined();
    });

    it("wanders the light a step on each way picked, the same for the same round, changing nothing else", () => {
        const start = startLighting(9);
        for (let seed = 0; seed < 20; seed++) {
            for (const { id } of DESTINATIONS) {
                const there = arriveAt(DEFAULT_SKIRMISH_SETTINGS, seed, id, 9)!;
                const { lighting, ...rest } = there;
                expect(rest).toEqual(destinationById(id)!.apply(DEFAULT_SKIRMISH_SETTINGS));
                expect(arriveAt(DEFAULT_SKIRMISH_SETTINGS, seed, id, 9)).toEqual(there);
                // A step from the light the round won was seen in, not a jump.
                expect(Math.abs(lighting!.brightness - start.brightness)).toBeLessThanOrEqual(0.15 + 1e-9);
                expect(Math.abs(lighting!.ambient - start.ambient)).toBeLessThanOrEqual(0.1 + 1e-9);
            }
        }
        // And on from wherever it has got to.
        const once = arriveAt(DEFAULT_SKIRMISH_SETTINGS, 1, "further", 9)!;
        const twice = arriveAt(once, 2, "closer", 1)!;
        expect(twice.lighting).not.toEqual(once.lighting);
        expect(Math.abs(twice.lighting!.brightness - once.lighting!.brightness)).toBeLessThanOrEqual(0.15 + 1e-9);
    });

    it("opens a skirmish saved when the light was a way of its own, dropping the ways no longer offered", () => {
        const skirmish = won(newSkirmish(gunship, gunship, 5));
        const file = { ...serialiseSkirmish(skirmish), ways: ["dark", "further", "bright"], headed: "dark" };
        const back = parseSkirmish(JSON.parse(JSON.stringify(file)));
        expect(back.ways).toEqual(["further"]);
        expect(back.headed).toBeUndefined();
        expect(parseSkirmish({ ...file, ways: ["dark"] }).ways).toBeUndefined();
    });
});
