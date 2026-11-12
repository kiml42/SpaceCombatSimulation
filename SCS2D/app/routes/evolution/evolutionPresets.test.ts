import { expect, test } from "vitest";
import { EVOLUTION_PRESETS } from "./evolutionPresets";
import { coRun, configOf, defaultForm, type SetupForm } from "./evolutionSetup";

const named = (name: string) => EVOLUTION_PRESETS.find((preset) => preset.name === name)!;
const was: SetupForm = {
    ...defaultForm(["ship:Dinky"], ["ship:Corvette"]),
    texts: { ...defaultForm().texts, configName: "mine", seed: "42" },
};

test("a preset keeps the founders and the name, and puts the rest back to the defaults", () => {
    for (const preset of EVOLUTION_PRESETS) {
        const form = preset.apply(was);
        expect(form.founders).toEqual(["ship:Dinky"]);
        expect(form.texts["configName"]).toBe("mine");
        expect(form.texts["seed"]).toBe(defaultForm().texts["seed"]);
    }
});

test("co-evolution breeds the founders against themselves, and a boss against a gunship that stays put", () => {
    expect(named("Co-evolution").apply(was).versus).toEqual(["ship:Dinky"]);
    const boss = named("Boss").apply(was);
    expect(boss.versus).toEqual(["ship:Gunship"]);
    expect(boss.rivalEvolves).toBe(false);
});

test("a single group and a race are runs of one lineage", () => {
    const group = named("Single group").apply(was);
    expect(coRun(group)).toBe(false);
    expect(configOf(group).group).toBe(configOf(group).population);
    const race = configOf(named("Race").apply(was));
    expect(race.match.weights).toEqual({ survival: 0, functional: 0, damage: 0, disabling: 0, race: 1 });
    expect(race.match.goal?.solid).toBe(false);
});
