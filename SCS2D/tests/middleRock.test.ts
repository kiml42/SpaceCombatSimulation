import { describe, expect, it } from "vitest";
import {
    drawnMap,
    generateMap,
    mapProblem,
    middleRock,
    NEUTRAL_TEAM,
    Rng,
    shipFleet,
    type MapSettings,
    type MiddleRock,
} from "../sim/index.js";
import { CORVETTE, GUNSHIP } from "../scenarios/blueprints.js";
import { customBattle } from "../scenarios/customBattle.js";
import { DEFAULT_SKIRMISH_SETTINGS, roundBattle, roundMap } from "../scenarios/skirmish.js";
import { Match } from "../evolution/match.js";

const MIDDLE: MapSettings = { majors: 1, majorSize: 400, middle: 1 };

/** Every ship of a battle on a side: its distance from the rock's centre less its own radius, the nearest. */
function nearest(battle: { ships: Match["battle"]["ships"]; world: Match["battle"]["world"] }, rock: MiddleRock): number {
    let near = Infinity;
    const bodies = battle.world.bodies;
    for (let i = 0; i < battle.ships.highWater; i++) {
        if (!battle.ships.isAlive(i) || battle.ships.teamOf(i) === NEUTRAL_TEAM) continue;
        const b = bodies.indexOf(battle.ships.body(i));
        near = Math.min(near, Math.hypot(bodies.x[b]! - rock.x, bodies.y[b]! - rock.y) - bodies.radius[b]!);
    }
    return near;
}

describe("a map with a rock in the middle", () => {
    it("puts a lone major at the middle, with nothing starting there", () => {
        const map = generateMap(MIDDLE, 3, [{ x: 2000, y: 0, radius: 100 }]);
        expect(Math.hypot(map.asteroids[0]!.x, map.asteroids[0]!.y)).toBeLessThan(1e-9);
        // Its radius, drawn about 400, and a margin.
        expect(middleRock(MIDDLE, 3)!.radius).toBeGreaterThan(300);
    });

    it("puts it across the line between the sides by what is left of the setting", () => {
        for (const seed of [3, 4]) {
            // Its clearance is its radius and a margin of 100 m.
            const size = middleRock(MIDDLE, seed)!.radius - 100;
            // At a half, its edge on the line: as far across as it is big.
            const half = middleRock({ ...MIDDLE, middle: 0.5 }, seed)!;
            expect(half.x).toBe(0);
            expect(Math.abs(half.y)).toBeCloseTo(size, 9);
            expect(Math.abs(half.y)).toBeGreaterThan(200);
            // Nearly nothing: a radius clear of it. The map puts the major where it says.
            const edge = middleRock({ ...MIDDLE, middle: 0.01 }, seed)!;
            expect(Math.abs(edge.y)).toBeCloseTo(Math.abs(half.y) * 1.98, 6);
            const map = generateMap({ ...MIDDLE, middle: 0.5 }, seed, [{ x: 2000, y: 0, radius: 100 }]);
            expect(map.asteroids[0]!.x).toBeCloseTo(0, 9);
            expect(map.asteroids[0]!.y).toBeCloseTo(half.y, 9);
        }
        // Either side of the line, by the seed.
        expect(Math.sign(middleRock({ ...MIDDLE, middle: 0.5 }, 3)!.y)).not.toBe(Math.sign(middleRock({ ...MIDDLE, middle: 0.5 }, 4)!.y));
    });

    it("keeps majors clear of the start without it, or with more than one", () => {
        expect(middleRock({ majors: 1, majorSize: 400 }, 3)).toBeNull();
        expect(middleRock({ middle: 1 }, 3)).toBeNull();
        expect(middleRock({ majors: 2, middle: 1 }, 3)).toBeNull();
    });

    it("keeps clear of something starting where it would be", () => {
        const map = generateMap(MIDDLE, 3, [{ x: 0, y: 0, radius: 20 }]);
        expect(Math.hypot(map.asteroids[0]!.x, map.asteroids[0]!.y)).toBeGreaterThan(400);
    });

    it("is a share, read from a file and drawn afresh each round", () => {
        expect(mapProblem({ majors: 1, middle: 0.5 })).toBeNull();
        expect(mapProblem({ majors: 1, middle: 1.5 })).not.toBeNull();
        const drawn = new Set<number>();
        const rng = new Rng(7);
        for (let k = 0; k < 20; k++) {
            const middle = drawnMap({ majors: 1, middle: 0.5 }, { middle: 0.5 }, rng).middle!;
            expect(middle).toBeGreaterThanOrEqual(0);
            expect(middle).toBeLessThanOrEqual(1);
            drawn.add(middle);
        }
        expect(drawn.size).toBe(20);
        const rounds = new Set(
            [1, 2, 3, 4].map((seed) => roundMap(seed, { map: { majors: 1, middle: 0.5 }, mapSpread: { middle: 0.4 } }).middle),
        );
        expect(rounds.size).toBe(4);
    });

    for (const middle of [1, 0.5, 0.2]) {
        it(`starts a custom battle's fleets clear of it, however close they were set, at ${middle}`, () => {
            const map = { ...MIDDLE, middle };
            const battle = customBattle({
                fleets: [shipFleet(CORVETTE), shipFleet(GUNSHIP)],
                range: 200,
                closingSpeed: 0,
                crossingSpeed: 0,
                rotation: 0,
                seed: 6,
                map,
            });
            const rock = middleRock(map, 6)!;
            expect(nearest(battle, rock)).toBeGreaterThan(rock.radius - 1);
        });
    }

    it("starts a match's entrants clear of it", () => {
        for (const middle of [1, 0.5]) {
            const map = { ...MIDDLE, middle };
            const match = new Match([CORVETTE, GUNSHIP], { seed: 4, map });
            const rock = middleRock(map, 4)!;
            expect(nearest(match.battle, rock)).toBeGreaterThan(rock.radius - 1);
        }
    });

    it("starts a skirmish's fleets clear of it", () => {
        const setup = roundBattle(shipFleet(CORVETTE), shipFleet(GUNSHIP), 5, { ...DEFAULT_SKIRMISH_SETTINGS, gap: 100, map: MIDDLE });
        const battle = customBattle(setup);
        const rock = middleRock(MIDDLE, 5)!;
        expect(nearest(battle, rock)).toBeGreaterThan(rock.radius - 1);
    });
});
