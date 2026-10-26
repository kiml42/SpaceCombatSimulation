import { describe, expect, it } from "vitest";
import {
    parseRunConfig,
    runConfigFileProblem,
    runConfigWarnings,
    serialiseRunConfig,
    RUN_CONFIG_FORMAT_VERSION,
} from "../evolution/configFile.js";
import { DEFAULT_KINDS } from "../evolution/mutate.js";
import { DEFAULT_RUN } from "../evolution/run.js";
import { DEFAULT_MATCH } from "../evolution/match.js";
import { NO_BUDGET } from "../sim/bill.js";
import { serialiseBlueprint, serialiseFleet } from "../sim/index.js";
import { CORVETTE, DINKY } from "../scenarios/blueprints.js";
import { LINE_OF_BATTLE } from "../scenarios/fleets.js";

/**
 * Settings, written down and read back.
 *
 * A run is decided entirely by its seed and its configuration, so a file that
 * loses or quietly alters one of those numbers is a file that describes a
 * different experiment from the one it was written from — which is the whole
 * failure mode worth testing here. The other is a file from somewhere else
 * being believed: a weight that is a string, a population of nought, a typo in
 * a key that silently means the default.
 */

const SETUP = {
    name: "Star Wars tuning",
    founders: [CORVETTE, DINKY],
    config: {
        ...DEFAULT_RUN,
        seed: 42,
        generations: 25,
        budget: { metal: 12_000, fuel: 3_000, build: Infinity },
        mutation: {
            magnitude: 0.3,
            structural: 0,
            build: { move: 0, resize: 0, refit: 0, fittings: 0, tuning: 2, fighter: 0.5, shape: 1 },
            kinds: { ...DEFAULT_KINDS, turret: 0 },
            doctrine: { targeting: 0, approach: 2, escort: 0, avoidance: 3, gunnery: 1 },
        },
        match: {
            duration: 45,
            radius: 900,
            closingSpeed: 30,
            crossingSpeed: -10,
            weights: { survival: 0, functional: 0.5, damage: 0, disabling: 2, race: 1 },
        },
    },
};

describe("the run config file", () => {
    it("round-trips a setup without changing it", () => {
        const back = parseRunConfig(serialiseRunConfig(SETUP));
        expect(back.name).toEqual("Star Wars tuning");
        expect(back.founders.map(serialiseBlueprint)).toEqual(SETUP.founders.map(serialiseBlueprint));
        expect(back.config.mutation.structural).toEqual(0);
        expect(back.config.mutation.magnitude).toEqual(0.3);
        expect(back.config.mutation.build).toEqual({ move: 0, resize: 0, refit: 0, fittings: 0, tuning: 2, fighter: 0.5, shape: 1 });
        expect(back.config.seed).toEqual(42);
        expect(back.config.generations).toEqual(25);
        expect(back.config.budget).toEqual({ metal: 12_000, fuel: 3_000, build: Infinity });
        expect(back.config.mutation.kinds!.turret).toEqual(0);
        expect(back.config.mutation.doctrine).toEqual({ targeting: 0, approach: 2, escort: 0, avoidance: 3, gunnery: 1 });
        expect(back.config.match.duration).toEqual(45);
        expect(back.config.match.radius).toEqual(900);
        expect(back.config.match.closingSpeed).toEqual(30);
        expect(back.config.match.crossingSpeed).toEqual(-10);
        expect(back.config.match.weights).toEqual({ survival: 0, functional: 0.5, damage: 0, disabling: 2, race: 1 });
        // Written in degrees and read back in radians, exactly.
        expect(back.config.match.scatter).toEqual(DEFAULT_MATCH.scatter);
        expect(serialiseRunConfig(back)).toEqual(serialiseRunConfig(SETUP));
    });

    it("writes no budget as null, since JSON has no infinity", () => {
        const file = serialiseRunConfig({ founders: [], config: DEFAULT_RUN });
        expect(file["budget"]).toEqual({ metal: null, fuel: null, build: null });
        expect(parseRunConfig(file).config.budget).toEqual(NO_BUDGET);
    });

    it("reads an older file's massBudget as its metal", () => {
        expect(parseRunConfig({ massBudget: 5_000 }).config.budget).toEqual({ ...NO_BUDGET, metal: 5_000 });
        expect(parseRunConfig({ budget: { fuel: 400 } }).config.budget).toEqual({ ...NO_BUDGET, fuel: 400 });
    });

    it("takes the defaults for everything a file leaves out", () => {
        // "The defaults but with beam turrets shut out" should be three lines.
        const setup = parseRunConfig({ kinds: { beamTurret: 0 } });
        expect(setup.config.generations).toEqual(DEFAULT_RUN.generations);
        expect(setup.config.match.duration).toEqual(DEFAULT_MATCH.duration);
        expect(setup.config.mutation.kinds!.beamTurret).toEqual(0);
        expect(setup.config.mutation.kinds!.engine).toEqual(DEFAULT_KINDS.engine);
    });

    it("keeps a goal it is given, and a match told to have none", () => {
        const goal = { x: 10, y: -20, scale: 250, size: 30 };
        expect(parseRunConfig({ match: { goal } }).config.match.goal).toEqual(goal);
        expect(parseRunConfig({ match: { goal: null } }).config.match.goal).toBeNull();
        expect(parseRunConfig({}).config.match.goal).toEqual(DEFAULT_MATCH.goal);
        // A ghost says so; a goal that does not say is solid.
        const ghost = { ...goal, solid: false };
        expect(parseRunConfig({ match: { goal: ghost } }).config.match.goal).toEqual(ghost);
    });

    it("keeps a quiet limit, and leaves one of nought out of the file", () => {
        const quiet = { founders: [], config: { ...DEFAULT_RUN, match: { ...DEFAULT_MATCH, quietLimit: 30 } } };
        expect(parseRunConfig(serialiseRunConfig(quiet)).config.match.quietLimit).toEqual(30);
        const file = serialiseRunConfig({ founders: [], config: DEFAULT_RUN });
        expect("quietLimit" in (file["match"] as object)).toBe(false);
        expect(parseRunConfig(file).config.match.quietLimit).toEqual(0);
    });

    it("refuses a file that is not one, and says why", () => {
        const problems: [unknown, RegExp][] = [
            [null, /must be an object/],
            [[], /must be an object/],
            [{ formatVersion: 99 }, /formatVersion/],
            [{ population: 0 }, /at least one/],
            [{ population: 2.5 }, /whole number/],
            [{ seed: "one" }, /seed must be a finite number/],
            [{ massBudget: -1 }, /more than nothing/],
            [{ budget: { build: 0 } }, /budget.build must be more than nothing/],
            [{ budget: 5 }, /budget must be an object/],
            [{ founders: "Corvette" }, /list of blueprints/],
            [{ founders: ["Corvette"] }, /founders\[0\]/],
            [{ founders: [{ name: "Holey", modules: "none" }] }, /founders\[0\] \(Holey\)/],
            [{ fleets: [{ name: "Empty" }] }, /fleets\[0\] \(Empty\)/],
            [{ kinds: { engine: -1 } }, /zero or more/],
            [{ build: { move: -1 } }, /build.move must be zero or more/],
            [{ doctrine: { escort: "x" } }, /doctrine.escort/],
            [{ structural: 2 }, /between 0 and 1/],
            [{ magnitude: -0.1 }, /magnitude must be zero or more/],
            [{ name: 3 }, /name must be text/],
            [{ match: { duration: 0 } }, /more than nothing/],
            [{ match: { quietLimit: -1 } }, /quietLimit must not be negative/],
            [{ match: { goal: { x: 0, y: 0, scale: 1 } } }, /missing size/],
            [{ match: { goal: { x: 0, y: 0, scale: 1, size: 1, solid: "no" } } }, /solid must be true or false/],
            [{ match: { weights: { survival: "lots" } } }, /weights.survival/],
        ];
        for (const [value, expected] of problems) {
            const problem = runConfigFileProblem(value);
            expect(problem, JSON.stringify(value)).toMatch(expected);
            expect(() => parseRunConfig(value)).toThrow();
        }
    });

    it("opens a file with a key it does not know, and says so", () => {
        // A typo in a hand-edited file is to be told about, not a reason to refuse it.
        const cases: [Record<string, unknown>, RegExp][] = [
            [{ populaton: 4 }, /the file has a key[^\n]*populaton/],
            [{ kinds: { engines: 1 } }, /kinds[^\n]*engines/],
            [{ build: { scale: 1 } }, /build has a key[^\n]*scale/],
            [{ match: { durations: 10 } }, /match has a key[^\n]*durations/],
            [{ fleet: { operators: { split: 1 } } }, /fleet\.operators has a key[^\n]*split/],
            [{ founders: [{ ...serialiseBlueprint(DINKY), paint: "red" }] }, /founders\[0\] \(Dinky\)[^\n]*paint/],
        ];
        for (const [value, expected] of cases) {
            expect(runConfigFileProblem(value), JSON.stringify(value)).toBeNull();
            expect(runConfigWarnings(value).join("\n")).toMatch(expected);
            expect(() => parseRunConfig(value)).not.toThrow();
        }
        expect(runConfigWarnings(serialiseRunConfig(SETUP))).toEqual([]);
    });

    it("carries its founders whole, so it needs no library to be run from", () => {
        const file = JSON.parse(JSON.stringify(serialiseRunConfig({ ...SETUP, fleets: [LINE_OF_BATTLE] })));
        expect(file.founders).toEqual([serialiseBlueprint(CORVETTE), serialiseBlueprint(DINKY)]);
        expect(file.fleets).toEqual([serialiseFleet(LINE_OF_BATTLE)]);
        expect(parseRunConfig(file).fleets!.map(serialiseFleet)).toEqual([serialiseFleet(LINE_OF_BATTLE)]);
    });

    it("accepts what it writes, including the version it stamps", () => {
        const file = serialiseRunConfig(SETUP);
        expect(file["formatVersion"]).toEqual(RUN_CONFIG_FORMAT_VERSION);
        expect(runConfigFileProblem(file)).toBeNull();
        expect(runConfigFileProblem(JSON.parse(JSON.stringify(file)))).toBeNull();
    });
});
