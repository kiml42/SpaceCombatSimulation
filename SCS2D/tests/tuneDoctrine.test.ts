import { describe, expect, it } from "vitest";
import { DEFAULT_DOCTRINE, serialiseFleet, shipFleet, type Fleet } from "../sim/index.js";
import { CORVETTE } from "../scenarios/blueprints.js";
import { DEFAULT_SKIRMISH_SETTINGS, startingBudget } from "../scenarios/skirmish.js";
import { DOCTRINE_ONLY, tuneDoctrine } from "../evolution/tune.js";

/** A Corvette closing at `speed` m/s, as the answer's tests set one up. */
const closingAt = (speed: number): Fleet =>
    shipFleet({
        ...CORVETTE,
        doctrine: {
            targeting: { ...DEFAULT_DOCTRINE.targeting, ...CORVETTE.doctrine?.targeting },
            approach: { ...DEFAULT_DOCTRINE.approach, ...CORVETTE.doctrine?.approach, approachSpeed: speed },
        },
    });

/** What a fleet's designs are built of, as a file says it, each weapon's own targeting left out: what tuning may not change. */
function hulls(fleet: Fleet): string {
    const raw = serialiseFleet(fleet) as { designs: Record<string, Record<string, unknown>> };
    return JSON.stringify(
        Object.values(raw.designs).map(({ modules, assemblies, hangar, fighter }) => ({ modules, assemblies, hangar, fighter })),
        (key, value: unknown) => (key === "targeting" ? undefined : value),
    );
}

describe("tuning a fleet's doctrine", { timeout: 120_000 }, () => {
    it("shuts off every mutation but the doctrine's", () => {
        expect(DOCTRINE_ONLY["structural"]).toBe(0);
        expect(DOCTRINE_ONLY["kindTurret"]).toBe(0);
        expect(DOCTRINE_ONLY["magnitude"]).toBeUndefined();
        expect(DOCTRINE_ONLY["doctrineApproach"]).toBeUndefined();
    });

    it("finds a version of the player's fleet that wins, differing only in doctrine", () => {
        // The slower of two Corvettes, which loses the mirror on seed 2.
        const player = closingAt(30);
        const enemy = closingAt(40);
        const settings = { ...DEFAULT_SKIRMISH_SETTINGS, mutants: 3, seeds: 1, duration: 60 };
        const search = tuneDoctrine(player, enemy, 2, settings, startingBudget(enemy));
        for (let slice = 0; slice < 40 && !search.advance(5000); slice++);
        // A doctrine that closes faster is all it takes, and soon found.
        const found = search.progress.found;
        expect(found).not.toBeNull();
        expect(hulls(found!)).toEqual(hulls(player));
    });
});
