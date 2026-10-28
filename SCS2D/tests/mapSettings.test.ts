import { describe, expect, it } from "vitest";
import { drawnMap, mapProblem, shipFleet, writeMap } from "../sim/index.js";
import { Rng } from "../sim/rng.js";
import { CORVETTE, GUNSHIP } from "../scenarios/blueprints.js";
import { customBattle, parseBattleSetup, serialiseBattleSetup, type BattleSetup } from "../scenarios/customBattle.js";
import { DEFAULT_SKIRMISH_SETTINGS, parseSkirmishSettings, roundBattle, roundMap } from "../scenarios/skirmish.js";
import { parseRunConfig, runConfigFileProblem, serialiseRunConfig } from "../evolution/configFile.js";
import { DEFAULT_RUN } from "../evolution/run.js";
import { Match } from "../evolution/match.js";

const FIELD = { majors: 1, minors: 4, fuel: 0.3 };

/** Where each asteroid in a battle starts, as text to compare. */
function rocks(battle: {
    ships: CustomBattleShips;
    world: { bodies: { indexOf(id: number): number; x: Float64Array; y: Float64Array } };
}): string {
    const out: string[] = [];
    for (let i = 0; i < battle.ships.count; i++) {
        if (battle.ships.teamOf(i) !== -1) continue;
        const b = battle.world.bodies.indexOf(battle.ships.body(i));
        out.push(`${battle.world.bodies.x[b]!.toFixed(3)},${battle.world.bodies.y[b]!.toFixed(3)}`);
    }
    return out.join(" ");
}
type CustomBattleShips = { count: number; teamOf(i: number): number; body(i: number): number };

describe("map settings", () => {
    it("are checked as a file holds them", () => {
        expect(mapProblem(FIELD)).toBeNull();
        expect(mapProblem({ majors: 1.5 })).toMatch(/whole/);
        expect(mapProblem({ metal: 0.7, fuel: 0.4 })).toMatch(/together/);
        expect(mapProblem({ asteroids: 3 })).toMatch(/unknown/);
    });

    it("write nothing for no asteroids, and only what differs from the defaults", () => {
        expect(writeMap({ majorSize: 500 })).toBeUndefined();
        expect(writeMap({ majors: 2, majorSize: 300 })).toEqual({ majors: 2 });
    });

    it("are drawn from a spread within their bounds", () => {
        for (let seed = 1; seed < 50; seed++) {
            const map = drawnMap({ majors: 1, metal: 0.6, fuel: 0.3 }, { majors: 3, metal: 0.5, fuel: 0.5 }, new Rng(seed));
            expect(Number.isInteger(map.majors)).toBe(true);
            expect(map.majors).toBeGreaterThanOrEqual(0);
            expect(map.metal! + map.fuel!).toBeLessThanOrEqual(1 + 1e-12);
        }
    });
});

describe("a custom battle", () => {
    const setup: BattleSetup = {
        fleets: [shipFleet(CORVETTE), shipFleet(GUNSHIP)],
        range: 2000,
        closingSpeed: 0,
        crossingSpeed: 0,
        rotation: 0,
        seed: 7,
        map: FIELD,
    };

    it("keeps its map in its file", () => {
        const back = parseBattleSetup(JSON.parse(JSON.stringify(serialiseBattleSetup(setup))));
        expect(back.map).toEqual(FIELD);
        expect(serialiseBattleSetup({ ...setup, map: {} })).not.toHaveProperty("map");
    });

    it("is fought among the asteroids it asks for", () => {
        const battle = customBattle(setup);
        let neutral = 0;
        for (let i = 0; i < battle.ships.count; i++) if (battle.ships.teamOf(i) === -1) neutral++;
        expect(neutral).toBe(5);
        expect(battle.wells.length).toBe(1);
    });
});

describe("an evolution run", () => {
    it("keeps its map in its config file, and refuses a bad one", () => {
        const run = { founders: [CORVETTE], config: { ...DEFAULT_RUN, match: { map: FIELD } } };
        const back = parseRunConfig(JSON.parse(JSON.stringify(serialiseRunConfig(run))));
        expect(back.config.match?.map).toEqual(FIELD);
        const file = serialiseRunConfig(run) as { match: Record<string, unknown> };
        expect(runConfigFileProblem({ ...file, match: { ...file.match, map: { majors: -1 } } })).toMatch(/map/);
    });

    it("fights each match among a field of its own", () => {
        const a = new Match([CORVETTE, GUNSHIP], { seed: 1, map: FIELD });
        const b = new Match([CORVETTE, GUNSHIP], { seed: 2, map: FIELD });
        expect(rocks(a.battle)).not.toBe("");
        expect(rocks(a.battle)).not.toBe(rocks(b.battle));
    });
});

describe("a skirmish", () => {
    const settings = { ...DEFAULT_SKIRMISH_SETTINGS, map: FIELD, mapSpread: { minors: 3 } };
    const player = shipFleet(CORVETTE);
    const enemy = shipFleet(GUNSHIP);

    it("has no asteroids unless asked", () => {
        expect(roundBattle(player, enemy, 3)).not.toHaveProperty("map");
    });

    it("fights a round in the same place every time, and each round in its own", () => {
        expect(rocks(customBattle(roundBattle(player, enemy, 3, settings)))).toBe(
            rocks(customBattle(roundBattle(player, enemy, 3, settings))),
        );
        const maps = new Set<string>();
        for (let seed = 1; seed <= 6; seed++) maps.add(JSON.stringify(roundBattle(player, enemy, seed, settings).map));
        expect(maps.size).toBeGreaterThan(1);
    });

    it("breeds its answer on the round’s map, whatever seed a search match is fought on", () => {
        const round = roundBattle(player, enemy, 3, settings);
        const search = roundBattle(player, enemy, 99, settings, 3);
        expect(search.map).toEqual(round.map);
        expect(search.mapSeed).toBe(3);
    });

    it("keeps its map and ranges with its settings", () => {
        const back = parseSkirmishSettings(JSON.parse(JSON.stringify(settings)));
        expect(back.map).toEqual(FIELD);
        expect(back.mapSpread).toEqual({ minors: 3 });
        expect(() => parseSkirmishSettings({ map: { majors: -1 } })).toThrow(/negative/);
    });

    it("takes a partial count, drawn as whole numbers across its range", () => {
        const partial = parseSkirmishSettings({ map: { minors: 7.5 }, mapSpread: { minors: 2.5 } });
        const drawn = new Set<number>();
        for (let seed = 1; seed <= 200; seed++) drawn.add(roundMap(seed, partial).minors!);
        expect([...drawn].sort((a, b) => a - b)).toEqual([5, 6, 7, 8, 9, 10]);
    });
});
