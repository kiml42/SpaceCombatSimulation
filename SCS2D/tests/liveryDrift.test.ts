import { describe, expect, it } from "vitest";
import {
    colourGap,
    driftLivery,
    firstLivery,
    fleetFileProblem,
    Rng,
    serialiseFleet,
    shipFleet,
    STOCK_BASES,
    type Livery,
} from "../sim/index.js";
import { CORVETTE, DINKY } from "../scenarios/blueprints.js";
import { LINE_OF_BATTLE } from "../scenarios/fleets.js";
import { newSkirmish } from "../scenarios/skirmish.js";
import { mutateFleet } from "../evolution/fleetMutate.js";
import { offspring } from "../evolution/generation.js";
import { Match } from "../evolution/match.js";

const TEAL: Livery = {
    base: "#2a6a8a",
    highlight: "#f0c040",
    pattern: "stripes",
    size: 0.1,
    spacing: 3,
    offset: 0.2,
    angle: 0.3,
    chevron: 0.5,
    points: 0,
};

/** Whether a fleet file would carry it, so a drifted livery is never one a file refuses. */
function readable(livery: Livery): boolean {
    return fleetFileProblem(serialiseFleet({ ...shipFleet(DINKY), livery })) === null;
}

describe("a livery drifting", () => {
    it("moves a little each child, and stays one a file can hold", () => {
        let livery = TEAL;
        for (let k = 0; k < 200; k++) {
            const child = driftLivery(livery, new Rng(k), []);
            expect(colourGap(child.base, livery.base)).toBeLessThan(100);
            expect(readable(child)).toBe(true);
            livery = child;
        }
    });

    it("leans away from its rivals' colours", () => {
        for (let k = 0; k < 100; k++) {
            const free = driftLivery(TEAL, new Rng(k), []);
            const leaning = driftLivery(TEAL, new Rng(k), [TEAL.base]);
            expect(colourGap(leaning.base, TEAL.base)).toBeGreaterThanOrEqual(colourGap(free.base, TEAL.base));
        }
    });

    it("starts far from what it leans away from", () => {
        for (let k = 0; k < 50; k++) {
            const first = firstLivery(new Rng(k), [STOCK_BASES[0]]);
            expect(readable(first)).toBe(true);
            expect(colourGap(first.base, STOCK_BASES[0])).toBeGreaterThan(80);
        }
    });
});

describe("a livery bred", () => {
    it("drifts in every child without moving a draw the breeding makes", () => {
        const painted = { ...LINE_OF_BATTLE, livery: TEAL };
        const rngA = new Rng(7);
        const rngB = new Rng(7);
        const plain = mutateFleet(LINE_OF_BATTLE, rngA).fleet;
        const child = mutateFleet(painted, rngB).fleet;
        const { livery, ...rest } = child;
        expect(rest).toEqual(plain);
        expect(livery).not.toEqual(TEAL);
        expect(rngA.nextUint32()).toBe(rngB.nextUint32());
    });

    it("drifts a lone ship's as well", () => {
        const rngA = new Rng(3);
        const rngB = new Rng(3);
        const plain = offspring(CORVETTE, rngA, {}).entrant;
        const { livery, ...rest } = offspring({ ...CORVETTE, livery: TEAL }, rngB, {}).entrant;
        expect(rest).toEqual(plain);
        expect(livery).toBeDefined();
        expect(rngA.nextUint32()).toBe(rngB.nextUint32());
    });

    it("is worn by each side of a match", () => {
        const match = new Match([{ ...CORVETTE, livery: TEAL }, DINKY]);
        expect(match.battle.liveries).toEqual([TEAL, undefined]);
    });

    it("gives a skirmish's enemy one of its own, unlike the player's", () => {
        const skirmish = newSkirmish(LINE_OF_BATTLE, LINE_OF_BATTLE, 11);
        expect(skirmish.enemy.livery).toBeDefined();
        expect(colourGap(skirmish.enemy.livery!.base, STOCK_BASES[0])).toBeGreaterThan(80);
        expect(newSkirmish(LINE_OF_BATTLE, LINE_OF_BATTLE, 11).enemy.livery).toEqual(skirmish.enemy.livery);
        expect(newSkirmish({ ...LINE_OF_BATTLE, livery: TEAL }, LINE_OF_BATTLE, 11).enemy.livery).toEqual(TEAL);
    });
});
