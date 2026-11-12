import { DEFAULT_TEXTS, defaultForm, type SetupForm } from "./evolutionSetup";

/**
 * Kinds of run, picked on the setup screen as a quick start: every setting at
 * its default but those that make that kind of run. The founders stay as
 * chosen, and the name too.
 */
export interface EvolutionPreset {
    readonly name: string;
    readonly hint: string;
    readonly apply: (form: SetupForm) => SetupForm;
}

/** The defaults over `form`, keeping its founders and name, with `texts` and anything else given over that. */
function fresh(form: SetupForm, texts: Record<string, string>, rest: Partial<SetupForm> = {}): SetupForm {
    const base = defaultForm(form.founders);
    return { ...base, texts: { ...DEFAULT_TEXTS, configName: form.texts["configName"] ?? "", ...texts }, ...rest };
}

/**
 * A race and nothing else: one ship to a match, scored only on the race, and
 * the best two of each generation always kept, since a ship racing alone
 * scores much the same every match and a draw would only lose ground.
 */
const RACE: Record<string, string> = {
    survivalWeight: "0",
    functionalWeight: "0",
    damageWeight: "0",
    disablingWeight: "0",
    raceWeight: "1",
    fleetShips: "1",
    group: "1",
    keep: "2",
};

export const EVOLUTION_PRESETS: readonly EvolutionPreset[] = [
    {
        name: "Co-evolution",
        hint: "Two lineages bred against each other, each starting from the founders",
        apply: (form) => fresh(form, {}, { versus: form.founders }),
    },
    {
        name: "Boss",
        hint: "The founders bred to beat a gunship that does not evolve",
        apply: (form) => fresh(form, {}, { versus: ["ship:Gunship"], rivalEvolves: false }),
    },
    {
        name: "Single group",
        hint: "Every design fights every match, all against all",
        apply: (form) => fresh(form, { population: "8", group: "8", winners: "3" }),
    },
    {
        name: "Race",
        hint: "One ship alone, scored only on getting to a goal in the middle that cannot be hit",
        apply: (form) => fresh(form, RACE, { goal: "ghost" }),
    },
    {
        name: "Race course",
        hint: "One ship alone round five goals drawn afresh for every match, holding the last, scored only on how far round it got",
        apply: (form) =>
            fresh(
                form,
                {
                    ...RACE,
                    courseGoals: "5",
                    courseLeg: "800",
                    courseLegSpread: "300",
                    courseTurn: "90",
                    courseTurnSpread: "90",
                    goalLinger: "0",
                    goalFinalLinger: "15",
                    duration: "240",
                },
                { goal: "ghost" },
            ),
    },
];
