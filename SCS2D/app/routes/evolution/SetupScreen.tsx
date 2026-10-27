import { styled } from "@linaria/react";
import { useRef, type ReactNode } from "react";
import { BUILT_IN, FLEET_FILES, type Library } from "~/editor/library";
import { MUTATION_FIELDS } from "~/evolution/mutationFields";
import type { SettingField } from "~/host/settingsFields";
import type { Blueprint, Fleet } from "~/sim/index";
import { Button } from "~/ui/buttons/Button";
import { coRun, fleetRun, MAP_FIELDS, RIVAL, rivalTexts, valueOf, type Goal, type SetupForm } from "./evolutionSetup";
import { Fold } from "./Fold";

export const Cards = styled.div`
    column-gap: 1.6rem;
    columns: 16rem;

    > details {
        padding-bottom: 0.6rem;
        break-inside: avoid;
    }
`;

const Screen = styled.section`
    flex: 1.7;
    min-width: 0;
    padding: 0.7rem 0.9rem 2rem;
    overflow-y: auto;
    border-right: 1px solid var(--colour-border);
`;

/**
 * A setting a row, its boxes in two columns either side of a ±, so every row's
 * boxes line up: one box alone spans both, a spread puts its ± between them,
 * and in a co-evolution run side A's box takes the first and side B's the second.
 */
const Row = styled.div`
    display: grid;
    grid-template-columns: minmax(0, 1fr) 3.8rem 0.7rem 3.8rem;
    gap: 0.3rem;
    align-items: center;
    margin-bottom: 0.25rem;

    label,
    > span:first-child {
        color: #7f93aa;
    }

    input,
    select {
        width: 100%;
        min-width: 0;
    }

    input:only-of-type,
    select {
        grid-column: 2 / -1;
    }

    input[type="checkbox"] {
        justify-self: end;
        width: auto;
    }

    > span:not(:first-child) {
        color: var(--colour-faint);
        text-align: center;
    }

    > b {
        color: #9fb0c4;
        font-size: 11px;
        font-weight: 600;
    }

    .rival,
    > b:last-child {
        grid-column: 4;
    }
`;

const Sides = styled.div`
    margin-top: 0.8rem;
    padding-top: 0.6rem;
    border-top: 1px solid var(--colour-border);
`;

/** Side A on the left and side B on the right, throughout. */
const Pair = styled.div`
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.6rem;

    select {
        width: 100%;
        height: 9rem;
    }
`;

const SideHeads = styled.div`
    display: flex;
    gap: 1rem;
    align-items: center;

    > p {
        flex: 1;
    }
`;

export const Note = styled.p`
    margin: 0.3rem 0 0;
    color: var(--colour-muted);
`;

export const Buttons = styled.div`
    display: flex;
    gap: 0.4rem;
    margin: 0.7rem 0;

    > button {
        flex: 1;
        padding-inline: 0.3rem;
    }
`;

interface FieldProps {
    readonly id: string;
    readonly label: string;
    readonly title?: string;
    readonly step?: number | "any";
    /** 0 unless said; null for no least. */
    readonly min?: number | null;
    readonly max?: number;
    readonly placeholder?: string;
    readonly text?: boolean;
    readonly form: SetupForm;
    readonly onForm: (next: SetupForm) => void;
    /** A second box, after a ±: how far either side each match's figure is drawn. */
    readonly spread?: { readonly id: string; readonly title: string; readonly step?: number };
    /** Whether side B has a box of its own for it, beside side A's. */
    readonly sided?: boolean;
}

/** One setting a row: its name, side A's box, and side B's beside it in a co-evolution run. */
function Field({ id, label, title, step, min = 0, max, placeholder, text = false, form, onForm, spread, sided = false }: FieldProps) {
    const set = (name: string, value: string): void => onForm({ ...form, texts: { ...form.texts, [name]: value } });
    const co = coRun(form);
    return (
        <Row title={title}>
            <label htmlFor={id}>{label}</label>
            <input
                id={id}
                type={text ? "text" : "number"}
                value={form.texts[id] ?? ""}
                placeholder={placeholder}
                {...(text ? {} : { step: step ?? 1, min: min ?? undefined, max })}
                onChange={(event) => set(id, event.target.value)}
            />
            {spread !== undefined && (
                <>
                    <span aria-hidden="true">±</span>
                    <input
                        id={spread.id}
                        type="number"
                        min={0}
                        step={spread.step ?? step}
                        title={spread.title}
                        value={form.texts[spread.id] ?? ""}
                        onChange={(event) => set(spread.id, event.target.value)}
                    />
                </>
            )}
            {sided && co && (
                <input
                    id={RIVAL + id}
                    className="rival"
                    type="number"
                    step={step ?? 1}
                    min={min ?? undefined}
                    max={max}
                    placeholder={placeholder}
                    title={`Side B's ${label}`}
                    style={form.rivalEvolves ? undefined : { visibility: "hidden" }}
                    value={rivalTexts(form)[id] ?? ""}
                    onChange={(event) => onForm({ ...form, rivalOwn: true, rival: { ...rivalTexts(form), [id]: event.target.value } })}
                />
            )}
        </Row>
    );
}

/** The rows of a group of settings drawn from their definitions, the ± of one on its row. */
function Group({
    fields,
    group,
    form,
    onForm,
    sided = false,
}: {
    readonly fields: readonly SettingField[];
    readonly group: string;
    readonly form: SetupForm;
    readonly onForm: (next: SetupForm) => void;
    readonly sided?: boolean;
}) {
    const mine = fields.filter((field) => field.group === group);
    return mine
        .filter((field) => field.spreadOf === undefined)
        .map((field) => {
            const spread = mine.find((each) => each.spreadOf === field.name);
            return (
                <Field
                    key={field.name}
                    id={field.name}
                    label={field.label}
                    title={field.title}
                    step={field.step}
                    min={field.min === undefined ? 0 : field.min}
                    {...(field.max === undefined ? {} : { max: field.max })}
                    form={form}
                    onForm={onForm}
                    sided={sided}
                    {...(spread === undefined ? {} : { spread: { id: spread.name, title: spread.title, step: spread.step } })}
                />
            );
        });
}

/** A, then B, over side A's and side B's boxes, in a co-evolution run. */
function Heads({ form }: { readonly form: SetupForm }) {
    if (!coRun(form)) return null;
    return (
        <Row>
            <span />
            <b>A</b>
            <b>B</b>
        </Row>
    );
}

/** Chosen by name, and a name opens one layout: the player's copy where there is one. */
const STOCK_SHIPS = new Set(BUILT_IN.map((blueprint) => blueprint.name));
const STOCK_FLEETS = new Set(FLEET_FILES.builtIn.map((fleet) => fleet.name));

/** The ships and fleets to pick from, a group each. */
export function EntrantOptions({
    ships,
    fleets,
    label,
}: {
    readonly ships: Library<Blueprint>;
    readonly fleets: Library<Fleet>;
    readonly label: (stock: boolean, name: string) => string;
}) {
    return (
        <>
            {(
                [
                    ["ship", "Ships", ships, STOCK_SHIPS],
                    ["fleet", "Fleets", fleets, STOCK_FLEETS],
                ] as const
            ).map(([kind, title, library, stock]) => (
                <optgroup key={kind} label={title}>
                    {library
                        .list()
                        // The editors list a shadowed stock design beside the player's copy, as something to open; a founder picked by name is not.
                        .filter((entry) => !(entry.stock && entry.saved))
                        .map((entry) => (
                            <option key={entry.name} value={valueOf(kind, entry.name)}>
                                {label(stock.has(entry.name), entry.name)}
                            </option>
                        ))}
                </optgroup>
            ))}
        </>
    );
}

const saved = (stock: boolean, name: string): string => (stock ? name : `${name} (saved)`);
const chosen = (select: HTMLSelectElement): string[] => [...select.selectedOptions].map((option) => option.value);

export interface SetupScreenProps {
    readonly hidden: boolean;
    readonly form: SetupForm;
    readonly onForm: (next: SetupForm) => void;
    readonly ships: Library<Blueprint>;
    readonly fleets: Library<Fleet>;
    readonly onExport: () => void;
    readonly onImport: (file: File) => void;
    readonly onReset: () => void;
}

/** Setting a run up: the settings have the width to themselves, beside the founders they would start from. */
export function SetupScreen({ hidden, form, onForm, ships, fleets, onExport, onImport, onReset }: SetupScreenProps) {
    const file = useRef<HTMLInputElement>(null);
    const co = coRun(form);
    const fleet = fleetRun(form);
    const field = (props: Omit<FieldProps, "form" | "onForm">): ReactNode => (
        <Field key={props.id} {...props} form={form} onForm={onForm} />
    );
    const sided = (props: Omit<FieldProps, "form" | "onForm" | "sided">): ReactNode => field({ ...props, sided: true });
    const mutation = (group: string): ReactNode => <Group fields={MUTATION_FIELDS} group={group} form={form} onForm={onForm} sided />;

    return (
        <Screen id="setupScreen" hidden={hidden}>
            <Cards>
                <Fold k="settings" title="Settings">
                    {field({
                        id: "configName",
                        label: "name",
                        title: "What these settings are for. An exported file is named after it.",
                        text: true,
                        placeholder: "evolution-config",
                    })}
                    <Buttons>
                        <Button id="exportConfig" title="Write these settings out as a file" onClick={onExport}>
                            Export
                        </Button>
                        <Button id="importConfig" title="Read settings back from a file" onClick={() => file.current?.click()}>
                            Import
                        </Button>
                        <Button
                            id="resetConfig"
                            title="Put every setting back to its default, for both sides; the founders and versus stay as chosen"
                            onClick={onReset}
                        >
                            Reset to defaults
                        </Button>
                        <input
                            ref={file}
                            id="importConfigFile"
                            type="file"
                            accept="application/json,.json"
                            hidden
                            onChange={(event) => {
                                const picked = event.target.files?.[0];
                                if (picked !== undefined) onImport(picked);
                                // Cleared, so choosing the same file twice is two imports, as while it is edited beside the page.
                                event.target.value = "";
                            }}
                        />
                    </Buttons>
                    <Note>A run is decided by its seed and these numbers, so the file is the whole of what was tried.</Note>
                </Fold>
                <Fold k="therun" title="The run">
                    {field({ id: "generations", label: "generations", min: 1 })}
                    {field({ id: "minMatches", label: "matches each", min: 1 })}
                    {field({ id: "seed", label: "seed", min: null })}
                    {field({ id: "effort", label: "ms per frame", min: 1, max: 200 })}
                    <Note>
                        How long each frame is spent measuring a run against a yardstick. The run itself is fought in a worker, at full
                        speed, hidden tab or not.
                    </Note>
                </Fold>
                <Fold k="thematch" title="The match">
                    {field({ id: "duration", label: "seconds", min: 1, step: 5 })}
                    {field({
                        id: "radius",
                        label: "arena m",
                        min: 10,
                        step: 50,
                        spread: { id: "radiusSpread", title: "How far either side each match's arena is drawn, evenly. Zero holds it." },
                    })}
                    {field({ id: "scatter", label: "scatter °", max: 180, step: 15 })}
                    {field({
                        id: "closing",
                        label: "closing m/s",
                        title: "Each entrant's starting speed towards the middle",
                        min: null,
                        step: 5,
                        spread: {
                            id: "closingSpread",
                            title: "How far either side each match's closing speed is drawn, evenly. Zero holds it.",
                        },
                    })}
                    {field({
                        id: "crossing",
                        label: "crossing m/s",
                        title: "Each entrant's starting speed to its left, across the line to the middle",
                        min: null,
                        step: 5,
                        spread: {
                            id: "crossingSpread",
                            title: "How far either side each match's crossing speed is drawn, evenly. Zero holds it.",
                        },
                    })}
                    {field({
                        id: "quietLimit",
                        label: "quiet s",
                        step: 5,
                        title: "A match is over once every side has gone this long without firing, hitting, building or closing on an enemy; the side last at it wins if it has hit anything. Zero is 30.",
                    })}
                    <Row title="Solid blocks shots and can be run into; a ghost is only somewhere to be">
                        <label htmlFor="goal">goal</label>
                        <select id="goal" value={form.goal} onChange={(event) => onForm({ ...form, goal: event.target.value as Goal })}>
                            <option value="solid">solid</option>
                            <option value="ghost">ghost</option>
                            <option value="none">none</option>
                        </select>
                    </Row>
                </Fold>
                <Fold k="asteroids" title="Asteroids" open={false}>
                    <Group fields={MAP_FIELDS} group="map" form={form} onForm={onForm} />
                    <Note>Drawn afresh for every match, from its seed. No majors and no minors is none.</Note>
                </Fold>
                <Fold k="whatitisscoredon" title="What it is scored on">
                    {field({ id: "survivalWeight", label: "hull kept", min: null, step: 0.5 })}
                    {field({ id: "functionalWeight", label: "function kept", min: null, step: 0.5 })}
                    {field({ id: "damageWeight", label: "damage done", min: null, step: 0.5 })}
                    {field({ id: "disablingWeight", label: "function taken", min: null, step: 0.5 })}
                    {field({ id: "raceWeight", label: "ground gained", min: null, step: 0.5 })}
                    <Note>Zero a weight to breed for the others alone.</Note>
                </Fold>
                {co && (
                    <Fold k="coevolution" title="Co-evolution">
                        {field({
                            id: "hall",
                            label: "hall of fame",
                            min: 1,
                            title: "Champions each side keeps, one a round, the latest: what the other side is bred against. Its founders until it has any.",
                        })}
                        {field({
                            id: "phaseWin",
                            label: "wins to end a round",
                            max: 1,
                            step: 0.05,
                            title: "The share of its matches against the other side's hall a round's best must win for the other side's turn to come.",
                        })}
                        {field({
                            id: "phaseCap",
                            label: "most generations a round",
                            min: 1,
                            title: "The most generations a round may take before the other side's turn comes anyway.",
                        })}
                        {field({
                            id: "shieldedDrills",
                            label: "invincible drills",
                            title: "Matches each design fights a generation with its own ships invincible, against the other side's hall: it learns to hurt them before it has to survive them. Scored only for what it does to them.",
                        })}
                        {field({
                            id: "bareCoreDrills",
                            label: "bare-core drills",
                            title: "Matches each design fights a generation against bare cores, which cannot fight back: something to hit while it cannot yet hit anything else. Scored only for what it does to them.",
                        })}
                        <Note>
                            One side is bred at a time, against the other&apos;s hall of fame, until its best usually wins; then the other
                            side&apos;s turn comes. Each turn is a round.
                        </Note>
                    </Fold>
                )}
            </Cards>
            <Sides>
                <Pair>
                    <Fold k="founders" title="Side A — founders">
                        <select
                            id="founders"
                            multiple
                            title="The ships and fleets the run starts from"
                            value={[...form.founders]}
                            onChange={(event) => onForm({ ...form, founders: chosen(event.target) })}
                        >
                            <EntrantOptions ships={ships} fleets={fleets} label={saved} />
                        </select>
                        <Note>
                            Ctrl-click for several. The rest of the first generation is mutants of these. A ship starts as a fleet of one,
                            and grows into more unless the most ships is one.
                        </Note>
                    </Fold>
                    <Fold k="versus" title="Side B — versus">
                        <select
                            id="versus"
                            multiple
                            title="A second lineage, bred against the first: every match is one of each"
                            value={[...form.versus]}
                            onChange={(event) => onForm({ ...form, versus: chosen(event.target) })}
                        >
                            <EntrantOptions ships={ships} fleets={fleets} label={saved} />
                        </select>
                        <Note>
                            Pick ships here to co-evolve two lineages against each other: every match is one of side A against one of side
                            B, with no goal. Leave it empty for an ordinary run.
                        </Note>
                        <Buttons>
                            <Button id="clearVersus" title="An ordinary run of one lineage" onClick={() => onForm({ ...form, versus: [] })}>
                                Clear
                            </Button>
                        </Buttons>
                        {co && (
                            <Row title="Unticked, side B is its founders every generation: a fixed opponent for side A to be bred against. Several of side A a match against one of a fixed side B is a boss battle.">
                                <label htmlFor="rivalEvolves">side B evolves</label>
                                <input
                                    id="rivalEvolves"
                                    type="checkbox"
                                    checked={form.rivalEvolves}
                                    onChange={(event) => onForm({ ...form, rivalEvolves: event.target.checked })}
                                />
                            </Row>
                        )}
                    </Fold>
                </Pair>
                {co && (
                    <SideHeads>
                        <Note id="rivalFollowing">
                            {!form.rivalEvolves
                                ? "Side B does not evolve: it fights as its founders every generation, so it has no settings of its own."
                                : form.rivalOwn
                                  ? "Side B has settings of its own, in the right-hand boxes."
                                  : "Side B follows side A's settings until one of its own boxes, on the right, is changed."}
                        </Note>
                        <Buttons>
                            <Button
                                id="sameAsA"
                                title="Copy every setting of side A into side B, and have B follow A again"
                                onClick={() => onForm({ ...form, rivalOwn: false })}
                            >
                                Same as side A
                            </Button>
                        </Buttons>
                    </SideHeads>
                )}
                <Cards>
                    <Fold k="breeding" title="Breeding and limits">
                        <Heads form={form} />
                        {sided({ id: "population", label: "population", min: 2 })}
                        {sided({ id: "winners", label: "bred from", min: 1 })}
                        {sided({
                            id: "group",
                            label: "per match",
                            min: 1,
                            title: "Entrants in each match. In co-evolution, each side's, fighting together against the other's",
                        })}
                        {sided({
                            id: "metalBudget",
                            label: "metal budget t",
                            placeholder: "none",
                            title: "Hull, fittings and the metal in its holds",
                        })}
                        {sided({
                            id: "fuelBudget",
                            label: "fuel budget t",
                            placeholder: "none",
                            title: "The fuel in its tanks as it sets out",
                        })}
                        {sided({
                            id: "buildBudget",
                            label: "build budget min",
                            placeholder: "none",
                            title: "How long one robot would take to build every module",
                        })}
                        {sided({ id: "fleetShips", label: "most ships", min: 1, title: "One keeps a run of ships breeding ships" })}
                        {fleet &&
                            sided({
                                id: "fleetRadius",
                                label: "spread m",
                                min: 1,
                                step: 50,
                                title: "How far from its origin any hull may reach",
                            })}
                        <Note>
                            A mutant over any of these is refused.{" "}
                            {fleet && "They are the whole fleet's, and a fleet whose hulls overlap is refused too. "}
                            More than one ship lets a ship grow into a fleet; one keeps it a ship.
                        </Note>
                    </Fold>
                    <Fold k="shipMutations" title="Ship mutations">
                        <Heads form={form} />
                        {mutation("build")}
                        <Note>
                            How often each sort of number in a ship&apos;s build changes, against each other and the doctrine weights below.
                            To tune a ship without rebuilding it, zero the structural and thruster chances, move, resize, refit, fittings
                            and fighter role.
                        </Note>
                        {mutation("kinds")}
                        <Note>
                            Relative odds of each kind, when a module is added or refitted into something else; hover one for what it is.
                            Zero shuts a kind out altogether.
                        </Note>
                    </Fold>
                    {fleet && (
                        <Fold k="fleetMutations" title="Fleet mutations">
                            <Heads form={form} />
                            {mutation("fleet")}
                            <Note>
                                Relative odds of each change to a fleet; hover one for what it does. A design being mutated uses the odds
                                above.
                            </Note>
                        </Fold>
                    )}
                    <Fold k="doctrineMutations" title="Doctrine mutations">
                        <Heads form={form} />
                        {mutation("doctrine")}
                        <Note>
                            How often each part of a ship&apos;s doctrine changes, against a number in its build at 1; hover one for what it
                            covers.
                        </Note>
                    </Fold>
                </Cards>
            </Sides>
        </Screen>
    );
}
