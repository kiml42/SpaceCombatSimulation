import { describe, expect, it } from "vitest";
import { courseOf, DEFAULT_MATCH, Match, runMatch, type CourseSpec, type GoalSpec } from "../evolution/match.js";
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

/** A course of `goals`, each `leg` metres on and turned `turn` degrees from the leg before, exactly. */
const course = (goals: number, leg: number, turn = 0): CourseSpec => ({ goals, leg, legSpread: 0, turn, turnSpread: 0 });

/** A lone corvette, on the ring at (500, 0). */
const lone = (goal: GoalSpec, laid: CourseSpec | undefined, duration = 120) =>
    runMatch([CORVETTE], { seed: 5, duration, goal, ...(laid === undefined ? {} : { course: laid }) });

/** Where each goal of the course a match with `seed` draws is. */
const drawn = (laid: CourseSpec, seed: number) => courseOf({ ...DEFAULT_MATCH, seed, course: laid }).map(({ x, y }) => ({ x, y }));

describe("a course", () => {
    const laid: CourseSpec = { goals: 5, leg: 800, legSpread: 200, turn: 90, turnSpread: 30 };

    it("is drawn afresh for every match, the same for the same seed", () => {
        expect(drawn(laid, 1)).toHaveLength(5);
        expect(drawn(laid, 1)).toEqual(drawn(laid, 1));
        expect(drawn(laid, 2)).not.toEqual(drawn(laid, 1));
        // Starting from the goal every entrant starts the same distance from.
        expect(drawn(laid, 2)[0]).toEqual({ x: DEFAULT_MATCH.goal!.x, y: DEFAULT_MATCH.goal!.y });
    });

    it("keeps each leg and turn inside what it is told, turning either way", () => {
        let left = 0;
        let right = 0;
        for (let seed = 1; seed <= 50; seed++) {
            const goals = drawn(laid, seed);
            for (let k = 1; k < goals.length; k++) {
                const leg = Math.hypot(goals[k]!.x - goals[k - 1]!.x, goals[k]!.y - goals[k - 1]!.y);
                expect(leg).toBeGreaterThanOrEqual(600 - 1e-6);
                expect(leg).toBeLessThanOrEqual(1000 + 1e-6);
                if (k < 2) continue;
                const ax = goals[k - 1]!.x - goals[k - 2]!.x;
                const ay = goals[k - 1]!.y - goals[k - 2]!.y;
                const bx = goals[k]!.x - goals[k - 1]!.x;
                const by = goals[k]!.y - goals[k - 1]!.y;
                const turn = (Math.atan2(ax * by - ay * bx, ax * bx + ay * by) * 180) / Math.PI;
                expect(Math.abs(turn)).toBeGreaterThanOrEqual(60 - 1e-6);
                expect(Math.abs(turn)).toBeLessThanOrEqual(120 + 1e-6);
                if (turn > 0) left++;
                else right++;
            }
        }
        expect(left).toBeGreaterThan(0);
        expect(right).toBeGreaterThan(0);
    });

    it("is the goal alone where it is one goal or not set", () => {
        expect(drawn({ ...laid, goals: 1 }, 3)).toHaveLength(1);
        expect(courseOf({ ...DEFAULT_MATCH, seed: 3 })).toHaveLength(1);
    });
});

describe("a race round a course", () => {
    it("sends a ship on to each goal in turn, and ends once it has reached the last", () => {
        const match = new Match([CORVETTE], {
            seed: 5,
            goal: at(300, 0),
            course: course(3, 300, 90),
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
        const nearly = lone(at(300, 0, 0), course(2, 1_000_000), 60).scores[0]!.race;
        // ...against reaching it, then spending the rest of the match nowhere
        // near the next, which is too far off to get anywhere towards.
        const reached = lone(at(300, 0), course(2, 1_000_000), 60).scores[0]!.race;
        expect(nearly).toBeGreaterThan(0.5 / 2.1);
        expect(reached).toBeGreaterThan(nearly);
    });

    it("pays for reaching a goal sooner", () => {
        const near = lone(at(300, 0), course(2, 1_000_000), 60).scores[0]!.race;
        const far = lone(at(-300, 0), course(2, 1_000_000), 60).scores[0]!.race;
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
                course: { goals: 3, leg: 500, legSpread: 100, turn: 45, turnSpread: 30 },
            },
        };
        const file = serialiseRunConfig({ founders: [], config });
        expect(runConfigFileProblem(file)).toBeNull();
        expect(parseRunConfig(file).config.match.course).toEqual(config.match.course);
        expect(parseRunConfig(file).config.match.goal).toEqual(goal);
        const none = { ...file, match: { ...(file["match"] as object), course: { goals: 0 } } };
        expect(runConfigFileProblem(none)).toContain("match.course.goals");
        const points = { ...file, match: { ...(file["match"] as object), course: [{ x: 0, y: 0 }] } };
        expect(runConfigFileProblem(points)).toContain("match.course must be an object");
        const lingering = { ...file, match: { ...(file["match"] as object), goal: { ...goal, linger: -1 } } };
        expect(runConfigFileProblem(lingering)).toContain("match.goal.linger");
    });

    it("counts a goal reached only once a ship has stayed at it for its linger", () => {
        const laid = course(2, 300);
        const quick = lone(at(300, 0), laid);
        const stays = lone({ ...at(300, 0), linger: 5 }, laid);
        const holds = lone({ ...at(300, 0), linger: 5, finalLinger: 30 }, laid);
        for (const result of [quick, stays, holds]) expect(result.ending).toEqual("finished");
        expect(stays.elapsed).toBeGreaterThan(quick.elapsed + 5);
        expect(holds.elapsed).toBeGreaterThan(stays.elapsed + 25 - 5);
    });

    it("pays for staying at a goal, though not as much as staying long enough", () => {
        // Never long enough: the last goal is to be held for longer than the match.
        const short = lone({ ...at(300, 0), finalLinger: 1000 }, undefined, 30).scores[0]!.race;
        const long = lone({ ...at(300, 0), finalLinger: 1000 }, undefined, 60).scores[0]!.race;
        expect(long).toBeGreaterThan(short);
        expect(long).toBeLessThan(1 / 1.1);
        // Got there, which is half of what there was to do.
        expect(short).toBeGreaterThan(0.45 / 1.1);
    });
});
