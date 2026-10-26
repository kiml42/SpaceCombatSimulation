import { expect, test } from "vitest";
import { parseRunConfig, serialiseRunConfig } from "~/evolution/configFile";
import { DEFAULT_RUN } from "~/evolution/run";
import { DINKY } from "~/scenarios/blueprints";
import {
    configOf,
    coevolutionOf,
    defaultForm,
    fleetRun,
    formOfHeld,
    formOfSetup,
    heldOf,
    rivalTexts,
    setupOf,
    type SetupForm,
} from "./evolutionSetup";

const withTexts = (form: SetupForm, texts: Record<string, string>): SetupForm => ({ ...form, texts: { ...form.texts, ...texts } });

test("the default form is the default run", () => {
    const config = configOf(defaultForm());
    expect(config.population).toBe(DEFAULT_RUN.population);
    expect(config.generations).toBe(DEFAULT_RUN.generations);
    expect(config.budget.metal).toBe(Infinity);
    expect(config.match.map).toBeUndefined();
});

test("is kept and read back in the shape the old page kept it", () => {
    const form: SetupForm = {
        ...withTexts(defaultForm(["ship:Dinky", "fleet:Line of Battle"], ["ship:Corvette"]), { seed: "42", kindTurret: "0" }),
        rivalOwn: true,
        rival: { ...rivalTexts(defaultForm()), population: "6" },
        rivalEvolves: false,
        goal: "ghost",
    };
    const held = heldOf(form);
    expect(held["b_population"]).toBe("6");
    expect(held["founders"]).toBe("ship:Dinky\nfleet:Line of Battle");
    expect(formOfHeld(JSON.stringify(held))).toEqual(form);
});

test("reads settings kept before fleets, or the goal was a choice", () => {
    const form = formOfHeld(JSON.stringify({ founders: "Dinky", goal: "" }));
    expect(form.founders).toEqual(["ship:Dinky"]);
    expect(form.goal).toBe("none");
    expect(formOfHeld("not json")).toEqual(defaultForm());
});

test("side B follows side A until it has a box of its own", () => {
    const form = withTexts(defaultForm(["ship:Dinky"], ["ship:Dinky"]), { population: "8" });
    expect(rivalTexts(form)["population"]).toBe("8");
    expect(coevolutionOf(form).rival).toEqual({});
    const own = { ...form, rivalOwn: true, rival: { ...rivalTexts(form), group: "1" } };
    expect(coevolutionOf(own).rival).toMatchObject({ population: 8, group: 1 });
});

test("is a run of fleets with a fleet among the founders, or room for more than one ship", () => {
    expect(fleetRun(withTexts(defaultForm(["ship:Dinky"]), { fleetShips: "1" }))).toBe(false);
    expect(fleetRun(withTexts(defaultForm(["fleet:Line of Battle"]), { fleetShips: "1" }))).toBe(true);
    expect(fleetRun(withTexts(defaultForm(["ship:Dinky"]), { fleetShips: "3" }))).toBe(true);
});

test("puts a settings file back as the form that wrote it", () => {
    const form = withTexts(defaultForm(["ship:Dinky"]), {
        configName: "tuning",
        seed: "4242",
        kindTurret: "0",
        buildShape: "0",
        doctrineApproach: "0",
        metalBudget: "12",
        mapmajors: "2",
    });
    const file = serialiseRunConfig(setupOf(form, [DINKY], []));
    const back = formOfSetup(parseRunConfig(JSON.parse(JSON.stringify(file))), ["ship:Dinky"], [], defaultForm());
    // Side B's own boxes hold side A's settings while it follows them, which is what it reads either way.
    expect({ ...back, rival: {} }).toEqual({ ...form, rival: {} });
    expect(rivalTexts(back)).toEqual(rivalTexts(form));
});
