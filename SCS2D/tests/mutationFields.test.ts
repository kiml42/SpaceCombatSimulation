import { describe, expect, it } from "vitest";
import { breeding, MUTATION_FIELDS } from "../evolution/mutationFields.js";
import { DEFAULT_BUILD_WEIGHTS, DEFAULT_DOCTRINE_WEIGHTS, DEFAULT_KINDS, DEFAULT_LIMITS } from "../evolution/mutate.js";
import { DEFAULT_FLEET_LIMITS } from "../evolution/fleetMutate.js";

describe("the mutation settings a page offers", () => {
    it("make the default limits when nothing is set", () => {
        const made = breeding(() => undefined);
        expect(made.ship).toEqual({
            magnitude: DEFAULT_LIMITS.magnitude,
            structural: DEFAULT_LIMITS.structural,
            geometry: DEFAULT_LIMITS.geometry,
            thrusters: DEFAULT_LIMITS.thrusters,
            build: DEFAULT_BUILD_WEIGHTS,
            kinds: DEFAULT_KINDS,
            doctrine: DEFAULT_DOCTRINE_WEIGHTS,
        });
        expect(made.operators).toEqual(DEFAULT_FLEET_LIMITS.operators);
    });

    it("cover every number the defaults have, each once", () => {
        const names = MUTATION_FIELDS.map((f) => f.name);
        expect(new Set(names).size).toBe(names.length);
        // The number drift, the structural, geometry and thruster chances, the
        // fleet's design chance, ship moves and change chance, and the weights.
        const count =
            7 +
            [DEFAULT_BUILD_WEIGHTS, DEFAULT_KINDS, DEFAULT_DOCTRINE_WEIGHTS, DEFAULT_FLEET_LIMITS.operators]
                .map((o) => Object.keys(o).length)
                .reduce((a, b) => a + b, 0);
        expect(names).toHaveLength(count);
    });

    it("holds a value to zero and up, and a chance to one", () => {
        const made = breeding((name) => (name === "structural" ? 3 : name === "kindTank" ? -2 : undefined));
        expect(made.ship.structural).toBe(1);
        expect(made.ship.kinds.tank).toBe(0);
    });
});
