import { describe, expect, it } from "vitest";
import { beamCarrier } from "../scenarios/beamCarrier.js";

describe("an escort with two ships to cover", () => {
    it("sticks with the one it picked, rather than swapping as it manoeuvres", () => {
        // Beam Carrier's Dinkies, between the carrier and the tender.
        const run = beamCarrier();
        const consort = (run.ships as unknown as { consort: readonly number[] }).consort;
        const last: number[] = [];
        let swaps = 0;
        for (let step = 0; step < 60 * 30; step++) {
            run.step();
            for (let i = 0; i < consort.length; i++) {
                const was = last[i];
                if (was !== undefined && was >= 0 && consort[i]! >= 0 && consort[i] !== was) swaps++;
                last[i] = consort[i]!;
            }
        }
        expect(swaps).toBeLessThanOrEqual(2);
    });
});
