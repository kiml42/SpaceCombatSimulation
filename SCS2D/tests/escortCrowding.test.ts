import { describe, expect, it } from "vitest";
import { compileBlueprint, DEFAULT_DOCTRINE } from "../sim/index.js";
import { makeBattle } from "../scenarios/battle.js";
import { CORVETTE, GUNSHIP } from "../scenarios/blueprints.js";

describe("escortCrowding", () => {
    // Two corvettes beside two gunships, one nearer than the other: alike they
    // both cover the nearer; told to mind the crowd, one covers each. Neither
    // covers the other, being no bigger than itself.
    function charges(escortCrowding: number): number[] {
        const doctrine = CORVETTE.doctrine!;
        const escort = compileBlueprint({
            ...CORVETTE,
            doctrine: {
                targeting: { ...doctrine.targeting, escortWeight: 400 },
                approach: { ...doctrine.approach, escortMinRadii: 1.01, escortCrowding },
            },
        });
        const gunship = compileBlueprint({
            ...GUNSHIP,
            doctrine: { ...GUNSHIP.doctrine!, targeting: { ...GUNSHIP.doctrine!.targeting, escortWeight: 0 } },
        });
        expect(gunship.radius).toBeGreaterThan(escort.radius * 1.01);
        const battle = makeBattle({ seed: 5 }, (ships, world) => {
            const escorts = [
                ships.spawn(world, { design: escort, x: 0, y: 0, angle: 0, team: 0 }),
                ships.spawn(world, { design: escort, x: 0, y: 60, angle: 0, team: 0 }),
            ];
            ships.spawn(world, { design: gunship, x: 300, y: 0, team: 0 });
            ships.spawn(world, { design: gunship, x: -500, y: 0, team: 0 });
            return { escorts };
        });
        for (let step = 0; step < 600; step++) battle.step();
        return battle.escorts.map((e) => battle.ships.consort[e]!);
    }

    it("piles onto the nearest friend when told to ignore the crowd", () => {
        const [a, b] = charges(0);
        expect(a).toBe(b);
    });

    it("spreads over friends by default", () => {
        const [a, b] = charges(DEFAULT_DOCTRINE.approach.escortCrowding);
        expect(a).not.toBe(b);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(b).toBeGreaterThanOrEqual(0);
    });
});
