import { styled } from "@linaria/react";
import { useEffect, useEffectEvent, useReducer, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useLibrary } from "~/features/storage/useLibrary";
import { useSkirmish } from "~/features/skirmish/SkirmishProvider";
import { useStorage } from "~/features/storage/StorageContext";
import type { FleetCanvas as Engine } from "~/editor/fleetCanvas";
import { ANGLE_SNAP_DEGREES } from "~/editor/fleetCanvas";
import { centreOf, FleetDocument, type FleetView } from "~/editor/fleetDocument";
import { addShip, distinctDesign, emptyFleet, refreshDesign } from "~/editor/fleetEdit";
import { battleRoute, designRoute, handedToFleet } from "~/editor/handoff";
import { emptyBlueprint, Library, nextName, SHIPS, unusedName } from "~/editor/library";
import { snap } from "~/editor/edit";
import type { KeyRow } from "~/host/keyHelp";
import { snapStep } from "~/render/camera";
import { inSkirmish, pick, serialiseSkirmish, type Skirmish } from "~/scenarios/skirmish";
import { compileBlueprint, parseBlueprint, parseFleet, serialiseFleet, type Blueprint, type Fleet } from "~/sim/index";
import { CommitText } from "~/ui/fields/CommitText";
import { LiveryPanel } from "~/features/livery/LiveryPanel";
import { withLivery } from "~/editor/livery";
import { AddShipMenu } from "./AddShipMenu";
import { FleetCanvas } from "./FleetCanvas";
import { designOf, fromLibrary } from "./fleetOptions";
import { LibraryOptions } from "./LibraryOptions";
import { DesignList, FleetProblems, FleetStats } from "./FleetReport";
import { SelectionPanel } from "./SelectionPanel";
import { skirmishBlock, SkirmishBudget, SkirmishCards, SkirmishTitle } from "./SkirmishCard";
import { Button } from "~/ui/buttons/Button";
import { PauseMenu } from "~/features/menu/PauseMenu";

const KEYS: readonly KeyRow[] = [
    { keys: "Add ship", does: "Add a ship to the fleet" },
    { keys: "Click a ship", does: "Select it" },
    { keys: "Shift-click", does: "Select several" },
    { keys: "Drag a ship", does: "Move it" },
    { keys: "Drag the knob", does: "Turn it" },
    { keys: "Alt", does: `Hold to escape the snaps: moves to a tenth of the grid, facings to ${ANGLE_SNAP_DEGREES}°` },
    { keys: "Drag empty space", does: "Pan" },
    { keys: "Scroll", does: "Zoom" },
    { keys: "F", does: "Fit the fleet in view" },
    { keys: "A", does: "Cycle the arcs drawn" },
    { keys: "Delete or Backspace", does: "Remove what is selected" },
    { keys: "Escape", does: "Close the Add ship menu, or select nothing" },
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

    /* Fixed, so the bar does not jump about as the fleet's name is typed and the list resizes to it. */
    #fleet {
        width: 12rem;
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

/** Between a new ship and the ones beside it, metres. */
const PLACING_GAP = 10;

/** How far a design reaches from its centre; nothing, for one that will not compile yet, such as a blank one. */
function footprint(blueprint: Blueprint): number {
    try {
        return compileBlueprint(blueprint).radius;
    } catch {
        return 0;
    }
}

/**
 * Where a ship of this reach goes beside the fleet's: abreast of them, just
 * past the lowest, so it overlaps none; or null for an empty fleet.
 */
function clearOf(view: FleetView, radius: number): { x: number; y: number } | null {
    let lowest = Infinity;
    let x = 0;
    let n = 0;
    view.ships.forEach((ship, i) => {
        const design = view.designs[i];
        if (design == null) return;
        const centre = centreOf(ship, design);
        lowest = Math.min(lowest, centre.y - design.radius);
        x += centre.x;
        n++;
    });
    return n === 0 ? null : { x: x / n, y: lowest - PLACING_GAP - radius };
}

/** A labelled list in the menu, as its buttons are laid out. */
const MenuField = styled.label`
    display: grid;
    gap: 0.25rem;
    color: var(--colour-muted);
`;

const Naming = styled.section`
    > input {
        width: 100%;
    }
`;

/** The ways to add a ship: a new design first, across the panel, as the one to reach for. */
const Adding = styled.section`
    display: grid;
    gap: 0.4rem;
    margin-top: 1rem;

    > button {
        width: 100%;
    }
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

    /* The first section's heading starts the panel, or follows a skirmish's heading closely. */
    > section:first-child > h2:first-child,
    > h2:first-child + section > h2:first-child {
        margin-top: 0;
    }

    textarea {
        width: 100%;
        min-height: 3.2rem;
        resize: vertical;
    }

    @media (width <= 800px) {
        width: auto;
        max-width: none;
        border-top: 1px solid var(--colour-border);
        border-left: none;
    }
`;

function problemOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** The fleet handed over in the address, or null after saying why it could not be read. */
function handed(search: URLSearchParams): { fleet: Fleet; skirmish: Skirmish | null } | null {
    try {
        return handedToFleet(search);
    } catch (error) {
        window.alert(`Could not read the fleet handed over.\n\n${problemOf(error)}`);
        return null;
    }
}

/**
 * Ships from the library placed, turned and laid out in rows and groups, saved
 * to browser storage and exported as fleet files. Opened from a skirmish, the
 * fleet is the player's there, held to its budget.
 */
export function FleetPage() {
    const storage = useStorage();
    const skirmishes = useSkirmish();
    const { ships, fleets } = useLibrary();
    const [search, setSearch] = useSearchParams();
    const navigate = useNavigate();
    const [start] = useState(() => handed(search));
    // Changed here only by picking an upgrade card; the fleet is the document's.
    const [skirmish, setSkirmish] = useState(start?.skirmish ?? null);
    const [doc] = useState(() => {
        const first = fleets.list()[0];
        const named = search.get("open");
        let opened: Fleet | null = start?.fleet ?? (named === null ? null : fromLibrary(fleets, named));
        if (opened === null && first !== undefined) {
            opened = fromLibrary(fleets, first.stock && first.saved ? `stock:${first.name}` : first.name);
        }
        // Read when asked, so a design saved since is what it is compared with.
        return new FleetDocument(opened ?? emptyFleet("New fleet"), (name) => {
            try {
                return new Library(storage, SHIPS).load(name);
            } catch {
                return null;
            }
        });
    });
    // The document is changed in place; this is what re-renders the panel when it is.
    const [, changed] = useReducer((n: number) => n + 1, 0);
    const [engine, setEngine] = useState<Engine | null>(null);
    const [adding, setAdding] = useState(false);
    const [liveryOpen, setLiveryOpen] = useState(false);
    // Whether the next livery change continues the last: a slider dragged is one undo step.
    const gesture = useRef(false);

    // A design saved since, here or in another tab, is checked against the fleet's copy again.
    const [checked, setChecked] = useState(ships);
    if (checked !== ships) {
        setChecked(ships);
        doc.refresh();
    }
    useEffect(() => engine?.render(), [engine, ships]);

    const edited = (): void => {
        changed();
        engine?.render();
    };
    const apply = (next: Fleet): void => {
        doc.apply(next);
        edited();
    };
    const open = (fleet: Fleet): void => {
        doc.replace(fleet);
        edited();
        engine?.fit();
    };

    const keep = (): void => {
        try {
            fleets.saveIfChanged(doc.fleet);
        } catch {
            // Storage full or refused: nothing more to be done on the way out.
        }
    };
    // Leaving for another route keeps the work, in case it was not saved. A reload does not:
    // that is how changes are thrown away.
    const leaving = useEffectEvent(keep);
    useEffect(() => () => leaving(), []);

    const now: Skirmish | null = skirmish === null ? null : { ...skirmish, player: doc.fleet };
    const view = doc.view;
    const flies = view.faults.length === 0;
    // Kept as it is edited, in the address and as the skirmish under way, so a reload or the skirmish picks up where this left off.
    const remember = useEffectEvent(() => {
        if (now === null) return;
        setSearch({ skirmish: JSON.stringify(serialiseSkirmish(now)) }, { replace: true });
        skirmishes.setSkirmish(now);
    });
    const fleet = doc.fleet;
    useEffect(() => {
        if (skirmish === null) return;
        const timer = setTimeout(remember, 300);
        return () => clearTimeout(timer);
    }, [skirmish, fleet]);

    const toDesign = (design: string): string =>
        `#${designRoute({ fleet: doc.fleet, design, ...(skirmish === null ? {} : { skirmish: { ...skirmish, player: doc.fleet } }) })}`;

    const place = (blueprint: Blueprint): void => {
        const step = snapStep(engine?.camera.scale ?? 1);
        const added = skirmish === null ? blueprint : inSkirmish(blueprint, skirmish);
        // The first ship stands at the formation's centre, and the view comes to it.
        const beside = clearOf(doc.view, footprint(added));
        const at = beside ?? { x: 0, y: 0 };
        doc.apply(addShip(doc.fleet, added, snap(at.x, step), snap(at.y, step)));
        doc.select([[doc.fleet.ships.length - 1]]);
        edited();
        if (beside === null) engine?.fit();
    };

    /** A blank design of its own, one ship of it placed, opened in the ship editor to be built. */
    const newDesign = (): void => {
        const taken = new Set([...Object.keys(doc.fleet.designs), ...ships.savedNames()]);
        let n = 1;
        while (taken.has(`Ship ${n}`)) n++;
        place(emptyBlueprint(`Ship ${n}`));
        keep();
        void navigate(
            designRoute({
                fleet: doc.fleet,
                design: `Ship ${n}`,
                ...(skirmish === null ? {} : { skirmish: { ...skirmish, player: doc.fleet } }),
            }),
        );
    };

    const exportFleet = (): void => {
        const text = `${JSON.stringify(serialiseFleet(doc.fleet), null, 2)}\n`;
        const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `${name.replace(/[^\w.-]+/g, "-").toLowerCase()}.fleet.json`;
        link.click();
        URL.revokeObjectURL(url);
    };

    const readFile = (file: File, then: (text: string) => void): void => {
        void file.text().then((text) => {
            try {
                then(text);
            } catch (error) {
                window.alert(`Could not read that file.\n\n${problemOf(error)}`);
            }
        });
    };

    const library = ships.list();
    const entries = fleets.list();
    const name = doc.fleet.name;
    const taken = (): string[] => entries.map((entry) => entry.name);
    const listed = entries.some((entry) => entry.name === name);
    const kept = listed ? fleets.load(name) : null;
    const unsavedChanges = kept === null || JSON.stringify(serialiseFleet(kept)) !== JSON.stringify(serialiseFleet(doc.fleet));

    return (
        <Main>
            <Bar>
                <PauseMenu
                    title="Fleet editor"
                    actions={[
                        ...(skirmish === null
                            ? [
                                  {
                                      id: "newFleet",
                                      label: "New fleet",
                                      onSelect: () => open(emptyFleet(unusedName("New fleet", taken()))),
                                  },
                                  {
                                      id: "duplicateFleet",
                                      label: "Copy fleet",
                                      title: "Start a copy of this fleet under a new name",
                                      onSelect: () => {
                                          doc.replace({ ...doc.fleet, name: unusedName(nextName(name), taken()) });
                                          edited();
                                      },
                                  },
                              ]
                            : []),
                        {
                            id: "saveFleet",
                            label: "Save to Library",
                            title: "Keep this fleet in the Library, to open or fight with later",
                            onSelect: () => fleets.save(doc.fleet),
                        },
                        ...(skirmish === null
                            ? [
                                  {
                                      id: "deleteFleet",
                                      label: "Delete saved copy",
                                      disabled: !fleets.savedNames().includes(name),
                                      onSelect: () => {
                                          if (!window.confirm(`Delete the saved copy of ${name}?`)) return;
                                          fleets.remove(name);
                                          apply(
                                              emptyFleet(
                                                  unusedName(
                                                      "New fleet",
                                                      taken().filter((each) => each !== name),
                                                  ),
                                              ),
                                          );
                                      },
                                  },
                              ]
                            : []),
                        { id: "exportFleet", label: "Export fleet", onSelect: exportFleet },
                        {
                            id: "importTrigger",
                            label: "Import fleet",
                            onSelect: () => document.getElementById("importFleet")?.click(),
                        },
                    ]}
                    keys={KEYS}
                    // A skirmish keeps its fleet as it is edited.
                    unsaved={skirmish === null && unsavedChanges ? { what: name, save: () => fleets.save(doc.fleet) } : null}
                >
                    {/* In a skirmish, a saved fleet is one to fight with; outside it, the picker on the bar opens one. */}
                    {skirmish !== null && (
                        <MenuField>
                            Load saved fleet
                            <select
                                id="loadFleet"
                                value=""
                                onChange={(event) => {
                                    const fleet = fromLibrary(fleets, event.target.value);
                                    if (fleet !== null) open(fleet);
                                }}
                            >
                                <option value="">Choose a fleet…</option>
                                <LibraryOptions entries={entries} />
                            </select>
                        </MenuField>
                    )}
                </PauseMenu>
                {skirmish === null && (
                    <select
                        id="fleet"
                        aria-label="Fleet"
                        title="Open a fleet"
                        value={name}
                        onChange={(event) => {
                            const fleet = fromLibrary(fleets, event.target.value);
                            if (fleet !== null) open(fleet);
                        }}
                    >
                        {!listed && <option value={name}>{`${name} (unsaved)`}</option>}
                        <LibraryOptions entries={entries} />
                    </select>
                )}
                <input
                    id="importFleet"
                    type="file"
                    accept="application/json,.json"
                    hidden
                    onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file === undefined) return;
                        readFile(file, (text) => {
                            let fleet = parseFleet(JSON.parse(text));
                            if (fleets.savedNames().includes(fleet.name)) {
                                const answer = window.prompt(
                                    `You already have a saved fleet called ${fleet.name}. ` +
                                        `Give this one a different name, or keep the name to replace yours.`,
                                    fleet.name,
                                );
                                if (answer === null) return;
                                fleet = { ...fleet, name: answer.trim() || fleet.name };
                            }
                            open(fleet);
                        });
                    }}
                />
                <Grow />
                <Button
                    id="undo"
                    disabled={!doc.canUndo}
                    onClick={() => {
                        doc.undo();
                        edited();
                    }}
                >
                    Undo
                </Button>
                <Button
                    id="redo"
                    disabled={!doc.canRedo}
                    onClick={() => {
                        doc.redo();
                        edited();
                    }}
                >
                    Redo
                </Button>
                {now === null ? (
                    <a
                        id="battleLink"
                        href={`#${battleRoute(doc.fleet)}`}
                        title="Try this fleet in the Simulator"
                        aria-disabled={!flies}
                        onClick={(event) => {
                            event.preventDefault();
                            if (!flies) return window.alert(`Fix the fleet first: ${view.faults[0]}`);
                            void navigate(battleRoute(doc.fleet));
                        }}
                    >
                        Test in Simulator
                    </a>
                ) : (
                    <Back
                        id="backToSkirmish"
                        href="#/skirmish"
                        title="Fight the skirmish round with this fleet"
                        aria-disabled={skirmishBlock(now, flies) !== null}
                        onClick={(event) => {
                            const block = skirmishBlock(now, flies);
                            if (block !== null) {
                                event.preventDefault();
                                window.alert(flies ? block : `Fix the fleet first: ${view.faults[0]}`);
                                return;
                            }
                            event.preventDefault();
                            skirmishes.setSkirmish(now);
                            void navigate("/skirmish");
                        }}
                    >
                        Back to Skirmish
                    </Back>
                )}
            </Bar>
            <Body>
                <FleetCanvas
                    doc={doc}
                    hint={doc.fleet.ships.length === 0 ? "Add new ship to design your first ship." : undefined}
                    onEngine={setEngine}
                    onChanged={changed}
                    onEscape={() => {
                        if (!adding) return false;
                        setAdding(false);
                        document.getElementById("addShip")?.focus();
                        return true;
                    }}
                />
                <Panel>
                    {now !== null && <SkirmishTitle skirmish={now} />}
                    <Naming>
                        <h2>
                            <label htmlFor="fleetName">Fleet name</label>
                        </h2>
                        <CommitText
                            id="fleetName"
                            title="The fleet's name, which is its identity"
                            value={name}
                            onCommit={(typed) => {
                                const next = typed.trim();
                                if (next === "" || next === name) return edited();
                                apply({ ...doc.fleet, name: next });
                            }}
                        />
                    </Naming>
                    {doc.fleet.ships.length > 0 && (
                        <section>
                            <h2>Designs</h2>
                            <DesignList
                                view={view}
                                designHref={toDesign}
                                onLeave={keep}
                                onAddOne={(design) => {
                                    const blueprint = doc.fleet.designs[design];
                                    if (blueprint !== undefined) place(blueprint);
                                }}
                            />
                        </section>
                    )}
                    <Adding>
                        <Button
                            id="newDesign"
                            variant={doc.fleet.ships.length === 0 ? "primary" : "plain"}
                            title="Design a new ship for this fleet: one of it is placed, and the ship editor opens on it"
                            onClick={newDesign}
                        >
                            Add new ship
                        </Button>
                        <AddShipMenu
                            open={adding}
                            onOpen={setAdding}
                            roster={view.roster}
                            library={library}
                            onAdd={(value) => {
                                const blueprint = designOf(doc.fleet, ships, value);
                                if (blueprint !== null) place(blueprint);
                            }}
                            onAddFile={(file) =>
                                readFile(file, (text) => {
                                    const read = parseBlueprint(JSON.parse(text));
                                    const blueprint = distinctDesign(doc.fleet, read);
                                    if (blueprint.name !== read.name) {
                                        window.alert(
                                            `The fleet already has a different ${read.name}, so this one is added as ${blueprint.name}.`,
                                        );
                                    }
                                    place(blueprint);
                                })
                            }
                        />
                    </Adding>
                    <SelectionPanel
                        doc={doc}
                        scale={engine?.camera.scale ?? 1}
                        ships={ships}
                        library={library}
                        designHref={toDesign}
                        onLeave={keep}
                        onChanged={edited}
                    />
                    {/* In a skirmish the budget says all the totals do that matters. */}
                    {now === null ? (
                        <section>
                            <h2>What it works out to</h2>
                            <FleetStats view={view} />
                        </section>
                    ) : (
                        <>
                            <SkirmishBudget skirmish={now} flies={flies} />
                            <SkirmishCards skirmish={now} onPick={(id) => setSkirmish((was) => (was === null ? was : pick(was, id)))} />
                        </>
                    )}
                    <section>
                        <h2>Problems</h2>
                        <FleetProblems
                            view={view}
                            onUpdate={(design) => {
                                const blueprint = new Library(storage, SHIPS).load(design);
                                if (blueprint !== null) apply(refreshDesign(doc.fleet, blueprint));
                            }}
                        />
                    </section>
                    <LiveryPanel
                        livery={doc.fleet.livery}
                        whose="the fleet's"
                        note="Worn by every ship in the fleet, whatever their own designs say."
                        open={liveryOpen}
                        onOpen={setLiveryOpen}
                        onChange={(livery, continues) => {
                            const next = withLivery(doc.fleet, livery);
                            if (continues && gesture.current) doc.amend(next);
                            else doc.apply(next);
                            gesture.current = continues;
                            edited();
                        }}
                        onEnd={() => {
                            gesture.current = false;
                        }}
                    />
                    <section>
                        <h2>Fleet notes</h2>
                        <CommitText
                            id="fleetNotes"
                            aria-label="Fleet notes"
                            multiline
                            placeholder="what this fleet is for"
                            value={doc.fleet.notes ?? ""}
                            onCommit={(text) => {
                                const next = { ...doc.fleet };
                                if (text === "") delete next.notes;
                                else next.notes = text;
                                apply(next);
                            }}
                        />
                    </section>
                </Panel>
            </Body>
        </Main>
    );
}
