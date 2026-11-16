import { expect, it } from "vitest";
import { SCENARIOS, type ScenarioName } from "./fixtures/scenarios.js";
import { ALONE, GOLDEN, goldenTests } from "./golden.js";

/** Every golden scenario but the slowest, which have files of their own (`golden.ts`). */
goldenTests((Object.keys(GOLDEN) as ScenarioName[]).filter((name) => !ALONE.includes(name)));

it("covers every fixture scenario", () => {
    // A new scenario without a golden constant would otherwise go unnoticed.
    expect(Object.keys(GOLDEN).sort()).toEqual(Object.keys(SCENARIOS).sort());
});
