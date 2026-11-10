import { describe, expect, it } from "vitest";
import { CRIPPLINGS, crippledLanding } from "../scenarios/crippledLanding.js";
import { SCENE_SEED } from "../scenarios/scenes.js";
import { landings } from "./landingRecord.js";

/**
 * The Crippled Landing scene, every variant as the battle page shows it: when each of its fighters lands on
 * its own carrier's pad, from 0 (east of its carrier) round anticlockwise, or that it has not by `LIMIT`,
 * and how many contacts there were. Recorded in `__snapshots__` as the goldens are, describing what
 * happens rather than judging it, so a change either way shows. After a deliberate change, re-record with
 * `pnpm exec vitest run tests/crippledLanding.test.ts -u` and read the diff. Open the scene to see one go.
 */

/** How long each variant runs for at most, seconds. */
const LIMIT = 300;

/** How a crippling leaves its fighters able to turn, which the variant's name says: none one way, or one way far weaker. */
type Turn = "one way" | "one weak";
const TURNS: Record<string, Turn> = {
    "Raider, one turn far weaker [1, 8]": "one weak",
    "Raider, one turn far weaker [3, 7]": "one weak",
    "Raider,  one way, spins [4, 7, 10]": "one way",
    "Raider,  one way, spins [1, 4, 10]": "one way",
    "Dinky,  anticlockwise only [2, 7, 8]": "one way",
    "Dinky,  clockwise only [1, 2, 9]": "one way",
};

describe("Crippled Landing", () => {
    it.each(CRIPPLINGS.map((crippling) => [crippling.name, crippling] as const))(
        "%s",
        (name, crippling) => {
            const run = crippledLanding(SCENE_SEED, crippling);

            // As crippled, before a pad mends it.
            const turn = TURNS[name];
            const layout = (run.ships as unknown as { layoutOf(i: number): { maxTorque(sense: number): number } }).layoutOf(
                run.fighters[0]!,
            );
            const turns = [layout.maxTorque(1), layout.maxTorque(-1)];
            if (turn === "one way") expect(turns.filter((t) => t > 0)).toHaveLength(1);
            if (turn === "one weak") {
                expect(Math.min(...turns)).toBeGreaterThan(0);
                expect(Math.min(...turns) / Math.max(...turns)).toBeLessThan(0.5);
            }

            const home = (k: number): boolean => run.ships.parkedCarrier(run.fighters[k]!) === run.carriers[k];
            expect(landings(run, run.fighters, home, LIMIT)).toMatchSnapshot();
        },
        300_000,
    );
});
