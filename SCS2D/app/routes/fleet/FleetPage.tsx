import { styled } from "@linaria/react";
import { useEffect, useEffectEvent, useReducer, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useLibrary } from "~/features/storage/useLibrary";
import { useStorage } from "~/features/storage/StorageContext";
import type { FleetCanvas as Engine } from "~/editor/fleetCanvas";
import { ANGLE_SNAP_DEGREES } from "~/editor/fleetCanvas";
import { FleetDocument } from "~/editor/fleetDocument";
import { addShip, distinctDesign, emptyFleet, refreshDesign } from "~/editor/fleetEdit";
import { battleRoute, designHref, handedToFleet } from "~/editor/handoff";
import { Library, nextName, SHIPS, unusedName } from "~/editor/library";
import { snap } from "~/editor/edit";
import type { KeyRow } from "~/host/keyHelp";
import { snapStep } from "~/render/camera";
import { serialiseSkirmish, skirmishFragment, SKIRMISH_STORAGE_KEY, type Skirmish } from "~/scenarios/skirmish";
import { parseBlueprint, parseFleet, serialiseFleet, type Blueprint, type Fleet } from "~/sim/index";
import { KeyHelp } from "~/ui/dialogs/KeyHelp";
import { CommitText } from "~/ui/fields/CommitText";
import { AddShipMenu } from "./AddShipMenu";
import { FleetCanvas } from "./FleetCanvas";
import { designOf, fromLibrary, optionLabel, optionValue } from "./fleetOptions";
import { DesignList, FleetProblems, FleetStats } from "./FleetReport";
import { SelectionPanel } from "./SelectionPanel";
import { SkirmishCard, skirmishBlock } from "./SkirmishCard";
import { Button } from "~/ui/buttons/Button";

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

    @media (width <= 800px) {
        width: auto;
        max-width: none;
        border-top: 1px solid var(--colour-border);
        border-left: none;
    }
`;

const Footer = styled.footer`
    padding: 0.4rem 0.9rem;
    border-top: 1px solid var(--colour-border);
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
    const { ships, fleets } = useLibrary();
    const [search, setSearch] = useSearchParams();
    const navigate = useNavigate();
    const [start] = useState(() => handed(search));
    const skirmish = start?.skirmish ?? null;
    const [doc] = useState(() => {
        const first = fleets.list()[0];
        let opened: Fleet | null = start?.fleet ?? null;
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
    // Kept as it is edited, in the address and in storage, so a reload or the skirmish picks up where this left off.
    const remember = useEffectEvent(() => {
        if (now === null) return;
        const text = JSON.stringify(serialiseSkirmish(now));
        setSearch({ skirmish: text }, { replace: true });
        try {
            storage.setItem(SKIRMISH_STORAGE_KEY, text);
        } catch {
            // Storage full or refused: the address still has it.
        }
    });
    const fleet = doc.fleet;
    useEffect(() => {
        if (skirmish === null) return;
        const timer = setTimeout(remember, 300);
        return () => clearTimeout(timer);
    }, [skirmish, fleet]);

    const toDesign = (design: string): string =>
        designHref({ fleet: doc.fleet, design, ...(skirmish === null ? {} : { skirmish: { ...skirmish, player: doc.fleet } }) });

    const place = (blueprint: Blueprint): void => {
        const camera = engine?.camera ?? { x: 0, y: 0, scale: 1 };
        // In the middle of the view, on the grid.
        const step = snapStep(camera.scale);
        doc.apply(addShip(doc.fleet, blueprint, snap(camera.x, step), snap(camera.y, step)));
        doc.select([[doc.fleet.ships.length - 1]]);
        edited();
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

    return (
        <Main>
            <Bar>
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
                    {entries.map((entry) => (
                        <option key={optionValue(entry)} value={optionValue(entry)}>
                            {optionLabel(entry)}
                        </option>
                    ))}
                </select>
                <CommitText
                    id="fleetName"
                    aria-label="Fleet name"
                    size={12}
                    title="The fleet's name, which is its identity"
                    value={name}
                    onCommit={(typed) => {
                        const next = typed.trim();
                        if (next === "" || next === name) return edited();
                        apply({ ...doc.fleet, name: next });
                    }}
                />
                <Button id="newFleet" onClick={() => open(emptyFleet(unusedName("New fleet", taken())))}>
                    New
                </Button>
                <Button
                    id="duplicateFleet"
                    title="Start a copy of this fleet under a new name"
                    onClick={() => {
                        doc.replace({ ...doc.fleet, name: unusedName(nextName(name), taken()) });
                        edited();
                    }}
                >
                    Copy
                </Button>
                <Button id="saveFleet" onClick={() => fleets.save(doc.fleet)}>
                    Save
                </Button>
                <Button
                    id="deleteFleet"
                    disabled={!fleets.savedNames().includes(name)}
                    onClick={() => {
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
                    }}
                >
                    Delete
                </Button>
                <Button
                    id="exportFleet"
                    onClick={() => {
                        const text = `${JSON.stringify(serialiseFleet(doc.fleet), null, 2)}\n`;
                        const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
                        const link = document.createElement("a");
                        link.href = url;
                        link.download = `${name.replace(/[^\w.-]+/g, "-").toLowerCase()}.fleet.json`;
                        link.click();
                        URL.revokeObjectURL(url);
                    }}
                >
                    Export
                </Button>
                <Button id="importTrigger" onClick={() => document.getElementById("importFleet")?.click()}>
                    Import
                </Button>
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
                        title="Try this in a custom battle"
                        aria-disabled={!flies}
                        onClick={(event) => {
                            event.preventDefault();
                            if (!flies) return window.alert(`Fix the fleet first: ${view.faults[0]}`);
                            void navigate(battleRoute(doc.fleet));
                        }}
                    >
                        Battle
                    </a>
                ) : (
                    <Back
                        id="backToSkirmish"
                        href={`skirmish.html${skirmishFragment(now)}`}
                        title="Fight the skirmish round with this fleet"
                        aria-disabled={skirmishBlock(now, flies) !== null}
                        onClick={(event) => {
                            const block = skirmishBlock(now, flies);
                            if (block !== null) {
                                event.preventDefault();
                                window.alert(flies ? block : `Fix the fleet first: ${view.faults[0]}`);
                                return;
                            }
                            keep();
                        }}
                    >
                        Back to battle
                    </Back>
                )}
            </Bar>
            <Body>
                <FleetCanvas
                    doc={doc}
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
                    <section>
                        <h2>Add a ship</h2>
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
                    </section>
                    <section>
                        <h2>Designs</h2>
                        <DesignList view={view} designHref={toDesign} onLeave={keep} />
                    </section>
                    <SelectionPanel
                        doc={doc}
                        scale={engine?.camera.scale ?? 1}
                        ships={ships}
                        library={library}
                        designHref={toDesign}
                        onLeave={keep}
                        onChanged={edited}
                    />
                    {now !== null && <SkirmishCard skirmish={now} flies={flies} />}
                    <section>
                        <h2>What it works out to</h2>
                        <FleetStats view={view} />
                    </section>
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
            <Footer>
                <KeyHelp rows={KEYS} />
            </Footer>
        </Main>
    );
}
