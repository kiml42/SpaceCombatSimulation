import { describe, expect, it } from "vitest";
import { CRIPPLINGS, crippledLanding } from "../scenarios/crippledLanding.js";
import { SCENE_SEED } from "../scenarios/scenes.js";

/**
 * The Crippled Landing scene, every variant as the battle page shows it: each of its fighters
 * on its own carrier's pad within the time given, having hit nothing. Open the scene to see one go.
 */

/** How each fighter can turn: none one way, or one way far weaker than the other. */
type Turn = "one way" | "one weak";

/**
 * By variant: the slowest landing allowed, in seconds, and how its fighters are left able to turn. A variant
 * `broken` is a known failure, kept to be fixed: asserted still to leave some fighter unlanded, so its fix shows here.
 */
const EXPECTED: Record<string, { within: number; turn?: Turn; broken?: true }> = {
    "Raider, one turn far weaker [1, 8]": { within: 90, turn: "one weak" },
    "Raider, one turn far weaker [3, 7]": { within: 90, turn: "one weak" },
    "Raider, no main [4]": { within: 150 },
    "Raider, no main [2, 4]": { within: 260 },
    "Raider, pushes turn it [4, 6]": { within: 130 },
    "Raider, pushes turn it [4, 8, 10]": { within: 130 },
    "Raider, turns one way, every push spins it [4, 7, 10]": { within: 210, turn: "one way" },
    "Raider, turns one way, every push spins it [1, 4, 10]": { within: 210, turn: "one way" },
    "Dinky, turns anticlockwise only [2, 7, 8]": { within: 90, turn: "one way" },
    "Dinky, turns clockwise only [1, 2, 9]": { within: 90, turn: "one way" },
    "Dinky, nothing ahead of its tank [2, 3, 6, 8, 9, 10]": { within: 210 },
    // None lands within 300 s.
    "Dinky Beam on a Beam Carrier, nothing ahead of its tank [2, 3, 6, 8, 9, 10]": { within: 300, broken: true },
};

describe("Crippled Landing", () => {
    it("has an expectation for every variant", () => {
        expect(Object.keys(EXPECTED).sort()).toEqual(CRIPPLINGS.map((c) => c.name).sort());
    });

    it.each(CRIPPLINGS.map((crippling) => [crippling.name, crippling] as const))(
        "%s: every fighter lands",
        (name, crippling) => {
            const { within, turn, broken } = EXPECTED[name]!;
            const run = crippledLanding(SCENE_SEED, crippling);

            // As crippled, before a pad mends it.
            const layout = (run.ships as unknown as { layoutOf(i: number): { maxTorque(sense: number): number } }).layoutOf(
                run.fighters[0]!,
            );
            const turns = [layout.maxTorque(1), layout.maxTorque(-1)];
            if (turn === "one way") expect(turns.filter((t) => t > 0)).toHaveLength(1);
            if (turn === "one weak") {
                expect(Math.min(...turns)).toBeGreaterThan(0);
                expect(Math.min(...turns) / Math.max(...turns)).toBeLessThan(0.5);
            }

            const landed = (k: number): boolean => run.ships.parkedCarrier(run.fighters[k]!) === run.carriers[k];
            const at = run.fighters.map(() => Infinity);
            for (let t = 1; t <= within * 60 && !at.every(Number.isFinite); t++) {
                run.step();
                for (let k = 0; k < at.length; k++) if (at[k] === Infinity && landed(k)) at[k] = t / 60;
            }
            // Which approaches, from 0 (east of its carrier) round anticlockwise, failed to land in time.
            const unlanded = at.flatMap((s, k) => (Number.isFinite(s) ? [] : [k]));
            if (broken) {
                expect(unlanded).not.toEqual([]);
                return;
            }
            expect(unlanded).toEqual([]);
            expect(run.totalContacts).toBe(0);
        },
        120_000,
    );
});
