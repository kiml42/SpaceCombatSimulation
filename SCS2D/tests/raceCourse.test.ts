import { describe, expect, it } from "vitest";
import { DEFAULT_MATCH, Match, runMatch, type CoursePoint, type GoalSpec } from "../evolution/match.js";
import { parseRunConfig, runConfigFileProblem, serialiseRunConfig } from "../evolution/configFile.js";
import { DEFAULT_RUN } from "../evolution/run.js";
import { CORVETTE } from "../scenarios/blueprints.js";

/**
 * A race round a course of goals, one after another: each ship is sent on to
 * the next once it reaches one, and the match is over once every ship has
 * reached the last.
 */

/** A goal `x`, `y` metres from the middle, as the default goal is. */
const at = (x: number, y: number, reach?: number): GoalSpec => ({
    ...DEFAULT_MATCH.goal!,
    x,
    y,
    ...(reach === undefined ? {} : { reach }),
});

/** A lone corvette, on the ring at (500, 0). */
const lone = (goal: GoalSpec, course: CoursePoint[], duration = 120) => runMatch([CORVETTE], { seed: 5, duration, goal, course });

describe("a race round a course", () => {
    it("sends a ship on to each goal in turn, and ends once it has reached the last", () => {
        const match = new Match([CORVETTE], {
            seed: 5,
            goal: at(300, 0),
            course: [
                { x: 300, y: 300 },
                { x: 0, y: 300 },
            ],
        });
        const { ships, slots, markers } = match.battle;
        expect(markers).toHaveLength(3);
        const targets = new Set<number>();
        while (!match.done) {
            match.advance();
            targets.add(ships.ordersOf(slots[0]!)[0]!.target);
        }
        expect([...targets]).toEqual(markers);
        const result = match.result();
        expect(result.ending).toEqual("finished");
        expect(result.elapsed).toBeLessThan(DEFAULT_MATCH.duration);
        expect(result.scores[0]!.race).toBeGreaterThan(0.9);
        expect(result.scores[0]!.race).toBeLessThanOrEqual(1);
    });

    it("pays more for each goal reached than for any progress towards one not reached", () => {
        // Within a few metres of the first goal for most of the match, but never
        // within reach of it, which is nought...
        const nearly = lone(at(300, 0, 0), [{ x: 1_000_000, y: 0 }], 60).scores[0]!.race;
        // ...against reaching it, then spending the rest of the match nowhere
        // near the next, which is too far off to get anywhere towards.
        const reached = lone(at(300, 0), [{ x: 1_000_000, y: 0 }], 60).scores[0]!.race;
        expect(nearly).toBeGreaterThan(0.5 / 2.1);
        expect(reached).toBeGreaterThan(nearly);
    });

    it("pays for reaching a goal sooner", () => {
        const near = lone(at(300, 0), [{ x: 1_000_000, y: 0 }], 60).scores[0]!.race;
        const far = lone(at(-300, 0), [{ x: 1_000_000, y: 0 }], 60).scores[0]!.race;
        expect(near).toBeGreaterThan(far);
        // Both reached the first, and neither got anywhere towards the second.
        expect(far).toBeGreaterThan(1 / 2.1);
    });

    it("is written to a settings file and read back", () => {
        const goal = { ...at(0, 0, 40), linger: 3, finalLinger: 20 };
        const config = {
            ...DEFAULT_RUN,
            match: {
                ...DEFAULT_MATCH,
                goal,
                course: [
                    { x: 100, y: 200 },
                    { x: -100, y: 0 },
                ],
            },
        };
        const file = serialiseRunConfig({ founders: [], config });
        expect(runConfigFileProblem(file)).toBeNull();
        expect(parseRunConfig(file).config.match.course).toEqual(config.match.course);
        expect(parseRunConfig(file).config.match.goal).toEqual(goal);
        const bad = { ...file, match: { ...(file["match"] as object), course: [{ x: 0 }] } };
        expect(runConfigFileProblem(bad)).toContain("match.course[0]");
        const lingering = { ...file, match: { ...(file["match"] as object), goal: { ...goal, linger: -1 } } };
        expect(runConfigFileProblem(lingering)).toContain("match.goal.linger");
    });

    it("counts a goal reached only once a ship has stayed at it for its linger", () => {
        const course = [{ x: 300, y: 300 }];
        const quick = lone(at(300, 0), course);
        const stays = lone({ ...at(300, 0), linger: 5 }, course);
        const holds = lone({ ...at(300, 0), linger: 5, finalLinger: 30 }, course);
        for (const result of [quick, stays, holds]) expect(result.ending).toEqual("finished");
        expect(stays.elapsed).toBeGreaterThan(quick.elapsed + 5);
        expect(holds.elapsed).toBeGreaterThan(stays.elapsed + 25 - 5);
    });

    it("pays for staying at a goal, though not as much as staying long enough", () => {
        // Never long enough: the last goal is to be held for longer than the match.
        const short = lone({ ...at(300, 0), finalLinger: 1000 }, [], 30).scores[0]!.race;
        const long = lone({ ...at(300, 0), finalLinger: 1000 }, [], 60).scores[0]!.race;
        expect(long).toBeGreaterThan(short);
        expect(long).toBeLessThan(1 / 1.1);
        // Got there, which is half of what there was to do.
        expect(short).toBeGreaterThan(0.45 / 1.1);
    });
});
