import { describe, expect, it } from "vitest";
import { generateMap, middleRock, NEUTRAL_TEAM, shipFleet, type MapSettings } from "../sim/index.js";
import { CORVETTE, GUNSHIP } from "../scenarios/blueprints.js";
import { customBattle } from "../scenarios/customBattle.js";
import { DEFAULT_SKIRMISH_SETTINGS, roundBattle } from "../scenarios/skirmish.js";
import { Match } from "../evolution/match.js";

const MIDDLE: MapSettings = { majors: 1, majorSize: 400, middle: 1 };

/** Every ship of a battle on a side: its distance from the middle less its radius, the nearest. */
function nearest(battle: { ships: Match["battle"]["ships"]; world: Match["battle"]["world"] }): number {
    let near = Infinity;
    const bodies = battle.world.bodies;
    for (let i = 0; i < battle.ships.highWater; i++) {
        if (!battle.ships.isAlive(i) || battle.ships.teamOf(i) === NEUTRAL_TEAM) continue;
        const b = bodies.indexOf(battle.ships.body(i));
        near = Math.min(near, Math.hypot(bodies.x[b]!, bodies.y[b]!) - bodies.radius[b]!);
    }
    return near;
}

describe("a map with a rock in the middle", () => {
    it("puts a lone major at the middle, with nothing starting there", () => {
        const map = generateMap(MIDDLE, 3, [{ x: 2000, y: 0, radius: 100 }]);
        expect(Math.hypot(map.asteroids[0]!.x, map.asteroids[0]!.y)).toBeLessThan(1e-9);
        // Its radius, drawn about 400, and a margin.
        expect(middleRock(MIDDLE, 3)).toBeGreaterThan(300);
    });

    it("keeps majors clear of the start without it, or with more than one", () => {
        expect(middleRock({ majors: 1, majorSize: 400 }, 3)).toBe(0);
        expect(middleRock({ middle: 1 }, 3)).toBe(0);
        expect(middleRock({ majors: 2, middle: 1 }, 3)).toBe(0);
    });

    it("keeps clear of something starting where it would be", () => {
        const map = generateMap(MIDDLE, 3, [{ x: 0, y: 0, radius: 20 }]);
        expect(Math.hypot(map.asteroids[0]!.x, map.asteroids[0]!.y)).toBeGreaterThan(400);
    });

    it("starts a custom battle's fleets clear of it, however close they were set", () => {
        const battle = customBattle({
            fleets: [shipFleet(CORVETTE), shipFleet(GUNSHIP)],
            range: 200,
            closingSpeed: 0,
            crossingSpeed: 0,
            rotation: 0,
            seed: 6,
            map: MIDDLE,
        });
        expect(nearest(battle)).toBeGreaterThan(middleRock(MIDDLE, 6) - 1);
    });

    it("starts a match's entrants clear of it", () => {
        const match = new Match([CORVETTE, GUNSHIP], { seed: 4, map: MIDDLE });
        expect(nearest(match.battle)).toBeGreaterThan(middleRock(MIDDLE, 4) - 1);
    });

    it("starts a skirmish's fleets clear of it", () => {
        const setup = roundBattle(shipFleet(CORVETTE), shipFleet(GUNSHIP), 5, { ...DEFAULT_SKIRMISH_SETTINGS, gap: 100, map: MIDDLE });
        const battle = customBattle(setup);
        expect(nearest(battle)).toBeGreaterThan(middleRock(MIDDLE, 5) - 1);
    });
});
