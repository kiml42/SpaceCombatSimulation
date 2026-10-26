import { expect, test } from "vitest";
import { DEFAULT_SETUP, parseBattleSetup, serialiseBattleSetup } from "~/scenarios/customBattle";
import { FLEETS } from "~/scenarios/fleets";
import { DEFAULT_FIELDS, fieldsOf, setupOf, slotsOf } from "./customSetup";

const [fleet] = Object.values(FLEETS);

test("the default boxes describe the default setup", () => {
    const setup = setupOf([], DEFAULT_FIELDS);
    expect(setup).toMatchObject({ ...DEFAULT_SETUP, fleets: [] });
    expect(setup.map).toBeUndefined();
});

test("a box left empty or not a number is taken as its default", () => {
    const setup = setupOf([], { ...DEFAULT_FIELDS, range: "", closing: "fast", seed: "2.6" });
    expect(setup.range).toBe(DEFAULT_SETUP.range);
    expect(setup.closingSpeed).toBe(DEFAULT_SETUP.closingSpeed);
    expect(setup.seed).toBe(3);
});

test("a setup comes back through its boxes as it went in", () => {
    const setup = parseBattleSetup({
        ...serialiseBattleSetup({ ...DEFAULT_SETUP, fleets: [fleet!] }),
        range: 3500,
        rotation: 30,
        spread: { range: 200, rotation: 15 },
        map: { majors: 2, minors: 8 },
    });
    const back = setupOf(slotsOf(setup, "file"), fieldsOf(setup));
    expect(serialiseBattleSetup(back)).toEqual(serialiseBattleSetup(setup));
});

test("a side from a file is labelled as such", () => {
    expect(slotsOf({ ...DEFAULT_SETUP, fleets: [fleet!] }, "file")[0]!.source).toEqual({ kind: "other", label: `${fleet!.name} (file)` });
});
