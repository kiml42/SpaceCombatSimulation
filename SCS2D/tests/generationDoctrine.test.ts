import { describe, expect, it } from "vitest";
import { DEFAULT_DOCTRINE, serialiseBlueprint, serialiseFleet, type Blueprint, type Fleet } from "../sim/index.js";
import { CORVETTE } from "../scenarios/blueprints.js";
import { DOCTRINE_NUMBERS, generationDoctrine, type GenerationRecord, type IndividualRecord } from "../evolution/run.js";

const holding = (standoff: number): Blueprint => ({
    ...CORVETTE,
    doctrine: { ...DEFAULT_DOCTRINE, approach: { ...DEFAULT_DOCTRINE.approach, standoff } },
});

const individual = (fitness: number, entrant: { blueprint?: Blueprint; fleet?: Fleet }): IndividualRecord => ({
    id: fitness,
    parent: -1,
    edits: [],
    matches: 1,
    fitness,
    survival: 0,
    damage: 0,
    race: 0,
    mass: 1,
    ...(entrant.blueprint ? { blueprint: serialiseBlueprint(entrant.blueprint) } : {}),
    ...(entrant.fleet ? { fleet: serialiseFleet(entrant.fleet) as Record<string, unknown> } : {}),
});

const generation = (individuals: IndividualRecord[]): GenerationRecord => ({ individuals }) as unknown as GenerationRecord;

describe("a generation's doctrine", () => {
    it("averages each number over the individuals, and reads the fittest", () => {
        expect(DOCTRINE_NUMBERS).toContain("approach.standoff");
        const read = generationDoctrine(
            generation([individual(1, { blueprint: holding(0.4) }), individual(3, { blueprint: holding(0.8) })]),
        );
        expect(read.mean["approach.standoff"]).toBeCloseTo(0.6, 9);
        expect(read.best["approach.standoff"]).toBeCloseTo(0.8, 9);
    });

    it("averages a fleet's over its ships", () => {
        const fleet: Fleet = {
            name: "Pair",
            designs: { Near: { ...holding(0.2), name: "Near" }, Far: { ...holding(1), name: "Far" } },
            ships: [
                { design: "Near", x: 0, y: 0, angle: 0 },
                { design: "Far", x: 0, y: 400, angle: 0 },
                { design: "Far", x: 0, y: 800, angle: 0 },
            ],
        } as unknown as Fleet;
        const read = generationDoctrine(generation([individual(1, { fleet })]));
        expect(read.mean["approach.standoff"]).toBeCloseTo((0.2 + 1 + 1) / 3, 9);
    });
});
