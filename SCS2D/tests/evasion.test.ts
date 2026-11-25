import { describe, expect, it } from "vitest";
import { compileBlueprint, DEFAULT_DOCTRINE, type Blueprint } from "../sim/index.js";
import { makeBattle } from "../scenarios/battle.js";
import { GUNSHIP } from "../scenarios/blueprints.js";

/** A Gunship jinking at `evasion` m/s, `range` from another that shoots at it. */
function scene(evasion: number, range = 2000) {
    const evading: Blueprint = {
        ...GUNSHIP,
        doctrine: {
            targeting: { ...DEFAULT_DOCTRINE.targeting, ...GUNSHIP.doctrine?.targeting },
            approach: { ...DEFAULT_DOCTRINE.approach, ...GUNSHIP.doctrine?.approach, evasion },
        },
    };
    return makeBattle({ seed: 3 }, (ships, world) => {
        const c = ships.spawn(world, { design: compileBlueprint(evading), x: 0, y: 0, team: 0 });
        ships.spawn(world, { design: compileBlueprint(GUNSHIP), x: range, y: 0, angle: Math.PI, team: 1 });
        return { c };
    });
}

/** Each step's jink of the evading Gunship, for `seconds`. */
function jinks(evasion: number, seconds: number): number[] {
    const run = scene(evasion);
    const jink = (run.ships as unknown as { jink: readonly number[] }).jink;
    const out: number[] = [];
    for (let s = 0; s < seconds * 60; s++) {
        run.step();
        out.push(jink[run.c]!);
    }
    return out;
}

describe("evasive manoeuvres", () => {
    it("jinks either way, up to its evasion, and changes its jink from time to time", () => {
        const seen = jinks(30, 40).filter((v) => v !== 0);
        expect(seen.length).toBeGreaterThan(0);
        for (const v of seen) expect(Math.abs(v)).toBeLessThanOrEqual(30);
        expect(new Set(seen).size).toBeGreaterThan(1);
        expect(seen.some((v) => v > 0) && seen.some((v) => v < 0)).toBe(true);
        // Held a while rather than redrawn every step.
        expect(new Set(seen).size).toBeLessThan(seen.length / 10);
    });

    it("flies straight with no evasion", () => {
        expect(jinks(0, 10).every((v) => v === 0)).toBe(true);
    });
});
