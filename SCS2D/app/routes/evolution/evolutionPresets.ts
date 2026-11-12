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
        hint: "Scored only on ground gained towards a goal that cannot be hit",
        apply: (form) =>
            fresh(
                form,
                { survivalWeight: "0", functionalWeight: "0", damageWeight: "0", disablingWeight: "0", raceWeight: "1" },
                { goal: "ghost" },
            ),
    },
];
