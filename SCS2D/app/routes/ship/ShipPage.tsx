import { styled } from "@linaria/react";
import { useEffect, useEffectEvent, useReducer, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useLibrary } from "~/features/storage/useLibrary";
import { kg } from "~/editor/budget";
import { EditorDocument } from "~/editor/document";
import {
    addModule,
    addModuleTo,
    arrivingModule,
    instanceOf,
    removeCopy,
    removeInstance,
    renameShip,
    toPlacementAngle,
} from "~/editor/edit";
import { replaceDesign, replacedName } from "~/editor/fleetEdit";
import { battleRoute, designRoute, fleetRoute, handedDesign, shipFleet, type DesignInFleet } from "~/editor/handoff";
import { emptyBlueprint, nextName, toFileText, unusedName } from "~/editor/library";
import { ANGLE_SNAP_DEGREES, type ShipCanvas as Engine } from "~/editor/shipCanvas";
import { buildTime } from "~/editor/stats";
import type { KeyRow } from "~/host/keyHelp";
import { ARC_LABELS } from "~/render/canvas2d";
import { billOfFleet, canFight, fleetFault, overLimit } from "~/scenarios/skirmish";
import {
    fighterProblem,
    parseBlueprint,
    samePlacement,
    withFleetFighters,
    type AssemblyInstance,
    type Blueprint,
    type ModulePath,
    type ModuleSpec,
    type ShipModuleKind,
} from "~/sim/index";
import { Button, ToggleButton } from "~/ui/buttons/Button";
import { KeyHelp } from "~/ui/dialogs/KeyHelp";
import { LiveText } from "~/ui/fields/LiveText";
import { fromLibrary, optionLabel, optionValue } from "../fleet/fleetOptions";
import { AddModule } from "./AddModule";
import { AssemblyPanel, SeveralSelected } from "./AssemblyPanels";
import type { DoctrineOpen } from "./DoctrineDetails";
import { ModulePanel } from "./ModulePanel";
import { ShipCanvas } from "./ShipCanvas";
import type { ShipEditing } from "./shipEditing";
import { DEFAULTS, isModuleSpec } from "./shipFields";
import { Field } from "./shipLayout";
import { Figures, ShipProblems, ShipRefit, ShipStats } from "./ShipReport";

// Fixed text: the footer's height is part of the canvas's, so a line that grew and shrank would resize the view under the ship.
const KEYS: readonly KeyRow[] = [
    { keys: "Click a module", does: "Select it" },
    { keys: "Drag a module", does: "Move it" },
    { keys: "Drag a corner or edge", does: "Size it, pushing its neighbours; with Ctrl, alone; with Shift, about its middle" },
    { keys: "Drag the knob", does: "Turn it" },
    { keys: "Two touching selected", does: "Drag the face between them" },
    { keys: "Shift-click", does: "Pick several, to Create assembly or Add them to the last assembly picked" },
    { keys: "Assembly selected", does: "A new module goes into it" },
    { keys: "Alt", does: `Hold to escape the snaps: positions to a tenth of the grid on screen, facings to ${ANGLE_SNAP_DEGREES}°` },
    { keys: "Drag empty space", does: "Pan" },
    { keys: "Scroll", does: "Zoom" },
    { keys: "F", does: "Fit the ship in view" },
    { keys: "A", does: "Cycle the arcs drawn" },
    { keys: "Delete or Backspace", does: "Remove what is selected" },
    { keys: "Escape", does: "Select nothing" },
    { keys: "Ctrl+Z, Ctrl+Shift+Z", does: "Undo, redo" },
];

const Main = styled.main`
    display: flex;
    flex-direction: column;
`;

const Bar = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    padding: 0.6rem 0.9rem;
    border-bottom: 1px solid var(--colour-border);

    /* Fixed, so the bar does not jump about as the ship's name is typed and the list resizes to it. */
    #ship {
        width: 11rem;
    }

    a[aria-disabled="true"] {
        opacity: 0.5;
        cursor: not-allowed;
    }
`;

const Grow = styled.span`
    flex: 1;
`;

const Back = styled.a`
    padding: 0.25rem 0.9rem;
    border: 1px solid var(--colour-primary-border);
    border-radius: 4px;
    background: var(--colour-primary);
    color: #fff;
    font-weight: 600;
    text-decoration: none;
`;

const Body = styled.div`
    display: flex;
    flex: 1;
    min-height: 0;

    @media (width <= 800px) {
        flex-direction: column;
    }
`;

// In a corner, where the readouts drawn on the canvas leave room.
const Overlays = styled.div`
    position: absolute;
    bottom: 0.6rem;
    left: 0.6rem;
    display: flex;
    gap: 0.4rem;
    padding: 0.35rem;
    border: 1px solid var(--colour-border);
    border-radius: 6px;
    background: #0b0f16cc;
`;

const Panel = styled.aside`
    width: 22rem;
    max-width: 45vw;
    padding: 0.7rem 0.9rem 2rem;
    overflow-y: auto;
    border-left: 1px solid var(--colour-border);

    h2 {
        margin: 1.2rem 0 0.4rem;
        color: var(--colour-muted);
        font-size: var(--font-size-small);
        font-weight: 400;
        letter-spacing: 0.08em;
        text-transform: uppercase;
    }

    > section:first-child h2 {
        margin-top: 0;
    }

    textarea {
        width: 100%;
        min-height: 3.2rem;
        resize: vertical;
    }

    label[data-warn="true"] {
        color: var(--colour-warning);
    }

    @media (width <= 800px) {
        width: auto;
        max-width: none;
        border-top: 1px solid var(--colour-border);
        border-left: none;
    }
`;

const Note = styled.p`
    margin: 0.4rem 0 0;
    color: var(--colour-faint);
`;

const Footer = styled.footer`
    padding: 0.4rem 0.9rem;
    border-top: 1px solid var(--colour-border);
`;

function problemOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** The design handed over in the address, or null after saying why it could not be read. */
function handed(search: URLSearchParams): DesignInFleet | null {
    try {
        return handedDesign(search);
    } catch (error) {
        window.alert(`Could not read the fleet's design handed over.\n\n${problemOf(error)}`);
        return null;
    }
}

/**
 * A ship drawn module by module, with every figure the battle would give it,
 * saved to browser storage and exported as a blueprint file. Opened from a
 * fleet, it is one of the fleet's designs, to be taken back to it.
 *
 * The editor is independent of the running simulation and tightly coupled to
 * its laws: every mass, thrust, gun figure and arc here comes out of
 * `compileDraft`, and the ship is drawn by the battle's own renderer, so the
 * picture and the numbers are what the battle would make of it.
 */
export function ShipPage() {
    const { ships: library } = useLibrary();
    const [search, setSearch] = useSearchParams();
    const navigate = useNavigate();
    const [inFleet] = useState(() => handed(search));
    const [doc] = useState(() => {
        const named = search.get("open");
        const read = (): Blueprint | null => (named === null ? null : fromLibrary(library, named)) ?? fromLibrary(library, "Corvette");
        // As it flies in its fleet, carrying the fleet's fighters for its pads.
        const opened = inFleet === null ? null : withFleetFighters(inFleet.fleet.designs[inFleet.design]!, inFleet.fleet.designs);
        return new EditorDocument(opened ?? read() ?? emptyBlueprint("New ship"));
    });
    // The document is changed in place; this is what re-renders the panels when it is.
    const [, changed] = useReducer((n: number) => n + 1, 0);
    const [engine, setEngine] = useState<Engine | null>(null);
    const [doctrineOpen, setDoctrineOpen] = useState<DoctrineOpen>({ mount: false, ship: false });
    // Whether the next edit continues the last: a drag or a held arrow key is one undo step, not hundreds.
    const gesture = useRef(false);

    const refresh = (): void => {
        changed();
        engine?.changed();
    };
    const editing: ShipEditing = {
        doc,
        change: (next, continues = false) => {
            if (next === null) return;
            if (continues && gesture.current) doc.amend(next);
            else doc.apply(next);
            gesture.current = continues;
            refresh();
        },
        refresh,
        endGesture: () => {
            gesture.current = false;
        },
        snapMetres: () => engine?.snapMetres() ?? 0.5,
    };
    const deleteSelected = (): void => {
        const assembly = doc.selectedAssemblyPath();
        if (assembly !== null) return editing.change(removeInstance(doc.blueprint, assembly));
        const origin = doc.selectedOrigin();
        if (origin !== null) editing.change(removeCopy(doc.blueprint, origin));
    };
    const reopen = (blueprint: Blueprint): void => {
        doc.replace(blueprint);
        engine?.easeToNext();
        gesture.current = false;
        refresh();
    };

    // Leaving for another route keeps the work, in case it was not saved. A reload does not:
    // that is how changes are thrown away.
    const keep = (): void => {
        try {
            library.saveIfChanged(doc.blueprint);
        } catch {
            // Storage full or refused: nothing more to be done on the way out.
        }
    };
    const leaving = useEffectEvent(keep);
    useEffect(() => () => leaving(), []);

    // Opened from a fleet, the address is kept up to date as the design is edited, so a reload picks up where this left off.
    const blueprint = doc.blueprint;
    const remember = useEffectEvent(() => {
        if (inFleet === null) return;
        const fleet = replaceDesign(inFleet.fleet, inFleet.design, doc.blueprint);
        const design = replacedName(inFleet.fleet, inFleet.design, doc.blueprint);
        const route = designRoute({ ...inFleet, fleet, design });
        setSearch(new URLSearchParams(route.slice(route.indexOf("?"))), { replace: true });
    });
    useEffect(() => {
        if (inFleet === null) return;
        const timer = setTimeout(remember, 300);
        return () => clearTimeout(timer);
    }, [inFleet, blueprint]);

    const add = (kind: ShipModuleKind): void => {
        const spec: ModuleSpec = { ...DEFAULTS[kind], x: 0, y: 0 };
        const view = engine?.visible() ?? { x: 0, y: 0, width: 100, height: 100 };
        const step = editing.snapMetres();
        // With an assembly selected, the module goes into it, at its origin, facing the way it would on the ship.
        const into = doc.selectedAssemblyPath();
        if (into !== null) {
            const sized = { ...arrivingModule(spec, view, step), x: 0, y: 0 };
            const member = memberOf(doc, into);
            const frame = member < 0 ? null : doc.view.origins[member]!;
            const written = frame === null ? sized : { ...sized, angle: toPlacementAngle(frame, sized.angle ?? 0) };
            const added = addModuleTo(doc.blueprint, into, written);
            if (added === null) return;
            doc.apply(added.blueprint);
            // The copy that was selected, not whichever one the layout drew first.
            const depth = into.length;
            const same = (a: ModulePath, b: ModulePath) =>
                a.slice(0, depth).every((s, k) => s.index === b[k]?.index && s.copy === b[k]?.copy);
            const drawn = doc.view.origins.findIndex(
                (origin) => samePlacement(origin.path, added.path) && (frame === null || same(origin.path, frame.path)),
            );
            if (drawn >= 0) doc.selectAt(drawn, added.path);
            else doc.select(added.path);
        } else {
            // The first module of a new ship is where it starts, at the size it starts at: the view is still the last ship's.
            const empty = (doc.blueprint.modules ?? []).length === 0;
            const added = addModule(doc.blueprint, empty ? spec : arrivingModule(spec, view, step));
            doc.apply(added.blueprint);
            doc.select(added.path);
        }
        gesture.current = false;
        refresh();
    };

    const name = blueprint.name;
    const entries = library.list();
    const taken = (): string[] => entries.map((entry) => entry.name);
    const listed = entries.some((entry) => entry.name === name);
    const broken = doc.view.problems[0];
    // A design that would not fly stays here until it would, so a fleet never carries one it cannot be fixed from.
    const refuseBroken = (event: { preventDefault(): void }): boolean => {
        if (broken === undefined) return false;
        event.preventDefault();
        window.alert(`Fix the design first: ${broken}`);
        return true;
    };

    const placement = doc.selections.length < 2 ? doc.selectedPlacement : null;
    const into = doc.selectedAssemblyPath();
    const target = into === null ? null : doc.selectedPlacement;
    const asked = blueprint.fighter === true;
    const design = doc.view.design;
    const notFighter = asked && design !== null && !design.fighter ? fighterProblem(design.modules.map((m) => m.spec)) : null;
    const panelKey = JSON.stringify(doc.selection);

    return (
        <Main>
            <Bar>
                <select
                    id="ship"
                    aria-label="Ship"
                    title="Open a ship"
                    value={name}
                    onChange={(event) => {
                        const opened = fromLibrary(library, event.target.value);
                        if (opened !== null) reopen(opened);
                    }}
                >
                    {!listed && <option value={name}>{`${name} (unsaved)`}</option>}
                    {entries.map((entry) => (
                        <option key={optionValue(entry)} value={optionValue(entry)}>
                            {optionLabel(entry)}
                        </option>
                    ))}
                </select>
                <LiveText
                    id="shipName"
                    aria-label="Ship name"
                    size={12}
                    title="The ship's name, which is its identity"
                    value={name}
                    onStart={editing.endGesture}
                    onType={(typed) => {
                        const next = typed.trim();
                        if (next !== "") editing.change(renameShip(doc.blueprint, next), true);
                    }}
                />
                <Button id="newShip" onClick={() => reopen(emptyBlueprint(unusedName("New ship", taken())))}>
                    New
                </Button>
                {/* Left unsaved, as a new ship is: how a stock hull becomes the start of the player's own without shadowing it. */}
                <Button
                    id="duplicateShip"
                    title="Start a copy of this ship under a new name"
                    onClick={() => {
                        doc.replace(renameShip(doc.blueprint, unusedName(nextName(name), taken())));
                        gesture.current = false;
                        refresh();
                    }}
                >
                    Copy
                </Button>
                <Button id="saveShip" onClick={() => library.save(doc.blueprint)}>
                    Save
                </Button>
                {/* On the undo stack, so undo brings the ship back and Save puts it in the library again. */}
                <Button
                    id="deleteShip"
                    disabled={!library.savedNames().includes(name)}
                    onClick={() => {
                        if (!window.confirm(`Delete the saved copy of ${name}?`)) return;
                        library.remove(name);
                        doc.apply(
                            emptyBlueprint(
                                unusedName(
                                    "New ship",
                                    taken().filter((each) => each !== name),
                                ),
                            ),
                        );
                        engine?.easeToNext();
                        gesture.current = false;
                        refresh();
                    }}
                >
                    Delete
                </Button>
                <Button
                    id="exportShip"
                    onClick={() => {
                        const url = URL.createObjectURL(new Blob([toFileText(doc.blueprint)], { type: "application/json" }));
                        const link = document.createElement("a");
                        link.href = url;
                        link.download = `${name.replace(/[^\w.-]+/g, "-").toLowerCase()}.ship.json`;
                        link.click();
                        URL.revokeObjectURL(url);
                    }}
                >
                    Export
                </Button>
                <Button id="importTrigger" onClick={() => document.getElementById("importShip")?.click()}>
                    Import
                </Button>
                <input
                    id="importShip"
                    type="file"
                    accept="application/json,.json"
                    hidden
                    onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file === undefined) return;
                        void file.text().then((text) => {
                            let imported: Blueprint;
                            try {
                                imported = parseBlueprint(JSON.parse(text));
                            } catch (error) {
                                window.alert(`Could not read that file.\n\n${problemOf(error)}`);
                                return;
                            }
                            // A name is identity, and a clash is what a friend's updated ship looks like: so ask.
                            if (library.savedNames().includes(imported.name)) {
                                const answer = window.prompt(
                                    `You already have a saved ship called ${imported.name}. Give this one a different name, or keep the name to replace yours.`,
                                    imported.name,
                                );
                                if (answer === null) return;
                                imported = { ...imported, name: answer.trim() || imported.name };
                            }
                            reopen(imported);
                        });
                    }}
                />
                <Grow />
                <Button
                    id="undo"
                    disabled={!doc.canUndo}
                    onClick={() => {
                        doc.undo();
                        gesture.current = false;
                        refresh();
                    }}
                >
                    Undo
                </Button>
                <Button
                    id="redo"
                    disabled={!doc.canRedo}
                    onClick={() => {
                        doc.redo();
                        gesture.current = false;
                        refresh();
                    }}
                >
                    Redo
                </Button>
                {/* One way back into a battle when in a skirmish, and it is through the fleet. */}
                {inFleet?.skirmish === undefined && (
                    <a
                        id="battleLink"
                        href={`#/battle`}
                        title="Try this in a custom battle"
                        aria-disabled={broken !== undefined}
                        onClick={(event) => {
                            event.preventDefault();
                            if (!refuseBroken(event)) void navigate(battleRoute(shipFleet(doc.blueprint)));
                        }}
                    >
                        Battle
                    </a>
                )}
                {inFleet !== null && (
                    <Back
                        id="backToFleet"
                        href="#/fleet"
                        title="Take this design back to its fleet"
                        aria-disabled={broken !== undefined}
                        onClick={(event) => {
                            event.preventDefault();
                            if (!refuseBroken(event))
                                void navigate(fleetRoute(replaceDesign(inFleet.fleet, inFleet.design, doc.blueprint), inFleet.skirmish));
                        }}
                    >
                        Back to fleet
                    </Back>
                )}
            </Bar>
            <Body>
                <ShipCanvas
                    doc={doc}
                    onEngine={setEngine}
                    changed={changed}
                    gestureEnded={() => {
                        gesture.current = false;
                    }}
                    deleteSelected={deleteSelected}
                    zoomed={changed}
                    viewChanged={changed}
                >
                    <Overlays role="toolbar" aria-label="What the view shows">
                        <ToggleButton
                            id="showRefit"
                            title="Show what refitting to the design this was opened from would build and take down"
                            disabled={doc.refit === null}
                            pressed={engine?.showRefit ?? true}
                            onPressedChange={() => {
                                engine?.toggleRefit();
                                changed();
                            }}
                        >
                            Refit
                        </ToggleButton>
                        <Button
                            id="cycleArcs"
                            title="Cycle the firing arcs drawn: none, where each gun may point, and where each will fire (A)"
                            onClick={() => {
                                engine?.cycleArcs();
                                changed();
                            }}
                        >
                            {ARC_LABELS[engine?.arcs ?? "trigger"]}
                        </Button>
                    </Overlays>
                </ShipCanvas>
                <Panel>
                    {inFleet !== null && <InFleet inFleet={inFleet} blueprint={blueprint} />}
                    <AddModule
                        into={target !== null && !isModuleSpec(target) ? (target as AssemblyInstance).use : null}
                        fighter={asked}
                        onAdd={add}
                    />
                    {/* With several picked, only what can be done to a set: a panel editing one of them would edit whichever came first. */}
                    {doc.selections.length >= 2 && <SeveralSelected editing={editing} />}
                    {placement !== null && !isModuleSpec(placement) && (
                        <AssemblyPanel
                            key={panelKey}
                            editing={editing}
                            instance={placement as AssemblyInstance}
                            onDelete={deleteSelected}
                        />
                    )}
                    {placement !== null && isModuleSpec(placement) && (
                        <ModulePanel
                            key={panelKey}
                            editing={editing}
                            spec={placement}
                            library={library}
                            inFleet={inFleet}
                            envelope={engine?.envelope() ?? null}
                            doctrineOpen={doctrineOpen}
                            onDoctrineOpen={setDoctrineOpen}
                            onDelete={deleteSelected}
                        />
                    )}
                    <section>
                        <h2>What it works out to</h2>
                        <ShipStats doc={doc} envelope={engine?.envelope() ?? null} />
                    </section>
                    <section>
                        <h2>Problems</h2>
                        <ShipProblems doc={doc} />
                    </section>
                    <ShipRefit doc={doc} />
                    <section>
                        <h2>Role</h2>
                        <Field>
                            <label
                                htmlFor="shipFighter"
                                id="shipFighterLabel"
                                data-warn={notFighter !== null}
                                title={
                                    notFighter !== null
                                        ? `Flies as an ordinary ship: ${notFighter}.`
                                        : "A strike craft: no turrets and nothing thick. It flies in the weapons layer, and drops into the hull layer as well only when its doctrine commits it, to ram or dock."
                                }
                            >
                                fighter
                            </label>
                            <input
                                id="shipFighter"
                                type="checkbox"
                                checked={asked}
                                onChange={(event) => {
                                    const next = { ...doc.blueprint };
                                    if (event.target.checked) next.fighter = true;
                                    else delete next.fighter;
                                    editing.change(next);
                                }}
                            />
                        </Field>
                    </section>
                    <section>
                        <h2>Ship notes</h2>
                        <LiveText
                            id="shipNotes"
                            aria-label="Ship notes"
                            multiline
                            placeholder="why the ship is shaped this way"
                            value={blueprint.notes ?? ""}
                            onStart={editing.endGesture}
                            onType={(typed) => {
                                const text = typed.trim();
                                const next = { ...doc.blueprint };
                                if (text === "") delete next.notes;
                                else next.notes = text;
                                editing.change(next, true);
                            }}
                        />
                    </section>
                </Panel>
            </Body>
            <Footer>
                <KeyHelp rows={KEYS} />
            </Footer>
        </Main>
    );
}

/** A module a member of the selected copy was written beside, whose frame is the assembly's on screen. */
function memberOf(doc: EditorDocument, instance: ModulePath): number {
    const own = (i: number) => {
        const inner = instanceOf(doc.view.origins[i]!);
        return inner !== null && samePlacement(inner, instance);
    };
    const grabbed = doc.highlightedModules().find(own);
    return grabbed ?? doc.view.origins.findIndex((_, i) => own(i));
}

/** The fleet this design is one of: what taking it back means, and in a skirmish what it costs against the budget. */
function InFleet({ inFleet, blueprint }: { readonly inFleet: DesignInFleet; readonly blueprint: Blueprint }) {
    const fleet = replaceDesign(inFleet.fleet, inFleet.design, blueprint);
    const skirmish = inFleet.skirmish;
    // A design that would not fly cannot be priced, and is an ordinary state to be editing in.
    const fault = skirmish === undefined ? null : fleetFault(fleet);
    const now = skirmish === undefined ? null : { ...skirmish, player: fleet };
    const limit = now === null || fault !== null ? null : overLimit(now);
    const bill = now === null || fault !== null ? null : billOfFleet(fleet);
    return (
        <section id="inFleet">
            <h2 id="inFleetTitle">{skirmish === undefined ? `In ${fleet.name}` : `Skirmish — round ${skirmish.round}`}</h2>
            <Note id="inFleetNote">
                {now === null
                    ? "Back to fleet takes this design back to every ship of it in the fleet."
                    : fault !== null
                      ? "Priced once the fleet would fly."
                      : canFight(now)
                        ? `The fleet with this design, against ${now.enemy.name}.`
                        : limit !== null
                          ? `The fleet with this design has ${limit}.`
                          : "The fleet with this design is over budget."}
            </Note>
            <Figures id="inFleetBudget">
                {bill !== null && now !== null && (
                    <tbody>
                        <tr data-over={bill.metal > now.budget.metal || undefined}>
                            <th>metal</th>
                            <td>{`${kg(bill.metal)} of ${kg(now.budget.metal)}`}</td>
                        </tr>
                        <tr data-over={bill.fuel > now.budget.fuel || undefined}>
                            <th>fuel</th>
                            <td>{`${kg(bill.fuel)} of ${kg(now.budget.fuel)}`}</td>
                        </tr>
                        <tr data-over={bill.build > now.budget.build || undefined}>
                            <th>build</th>
                            <td>{`${buildTime(bill.build)} of ${buildTime(now.budget.build)}`}</td>
                        </tr>
                    </tbody>
                )}
            </Figures>
        </section>
    );
}
