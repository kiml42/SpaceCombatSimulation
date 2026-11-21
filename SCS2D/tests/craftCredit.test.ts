import { describe, expect, it } from "vitest";
import { Match } from "../evolution/match.js";
import { BARE_CORE, TORPEDO_BOAT } from "../scenarios/blueprints.js";

describe("a match", () => {
    it("credits what a carrier's craft do to the entrant whose carrier built them", () => {
        // The boat has no gun: anything it deals, its torpedoes dealt.
        const match = new Match([TORPEDO_BOAT, BARE_CORE], { seed: 3, duration: 120, radius: 600 }, [0, 1]);
        while (!match.done) match.advance();
        const [boat] = match.result().scores;
        expect(boat!.damage).toBeGreaterThan(0);
    });
});
