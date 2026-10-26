import { styled } from "@linaria/react";
import { useEffect, useState } from "react";
import { useSampled } from "~/features/battle/useSampled";
import { useLibrary } from "~/features/storage/useLibrary";
import { MOUNT_SECTIONS, SHIP_SECTIONS, type DoctrineEntry } from "~/editor/doctrine";
import { keyOf, mountsOf, shared, slotsOf, told, valuesOf, type BuildSlot } from "~/editor/doctrineParts";
import type { BattleView } from "~/host/battleView";
import { choices, type Choice } from "~/host/designChoices";
import { mountAt, viewOf } from "~/render/picking";
import { padHolds, placementOf, slipwayHolds, type DoctrinePart, type ShipView, type Snapshot } from "~/sim/index";
import type { OrderState } from "./orderState";

const Panel = styled.aside`
    position: absolute;
    top: 0;
    right: 0;
    bottom: 3rem;
    width: 19rem;
    max-width: 60vw;
    overflow-y: auto;
    padding: 0.5rem 0.7rem;
    border-left: 1px solid var(--colour-border);
    background: #0b0f16e6;

    h3 {
        margin: 0.6rem 0 0.1rem;
        color: var(--colour-text);
        font-size: 0.85rem;
    }

    h4 {
        margin: 0.3rem 0 0;
        color: var(--colour-muted);
        font-size: 0.8rem;
        font-weight: normal;
    }

    p {
        margin: 0.4rem 0 0;
        color: var(--colour-faint);
    }

    button[aria-pressed="true"] {
        border-color: var(--colour-link);
        background: var(--colour-surface-hover);
    }
`;

const Tabs = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin-bottom: 0.5rem;
`;

const Row = styled.label`
    display: flex;
    gap: 0.3rem;
    align-items: center;
    margin-bottom: 0.25rem;

    span {
        flex: 1;
        color: var(--colour-muted);
    }

    &[data-told="true"] span {
        color: var(--colour-warning);
    }

    input {
        width: 5.5rem;
    }

    select {
        max-width: 8rem;
    }
`;

/** The panel's own key, `P` on the battle, as the old viewer's. */
export const DOCTRINE_KEY = "p";

export interface DoctrinePanelProps {
    readonly view: BattleView;
    readonly state: OrderState;
    readonly shown: () => Snapshot | null;
}

/**
 * The doctrine of the picked ships: the ship's, its main and its secondary weapons', one placement's
 * mounts, picked by clicking one, and what its pads and slipways keep. Each box shows what the ships go
 * by, blank where they differ; an edit is a logged command for all of them, over their blueprints, and
 * clearing a box takes it back to theirs.
 */
export function DoctrinePanel({ view, state, shown }: DoctrinePanelProps) {
    const { ships: library } = useLibrary();
    const [part, setPart] = useState<DoctrinePart>("ship");
    // Read again whenever what the boxes show changes: an order told, a craft or keep changed, a refit.
    useSampled(() => {
        const at = shown();
        if (at === null) return "";
        return JSON.stringify(
            state.picked.map((i) => {
                const s = viewOf(at, i);
                return [
                    s?.override ?? null,
                    s?.keeps ?? null,
                    Object.entries(s?.crafts ?? {}).map(([slot, c]) => [slot, c.name]),
                    s?.currentStructure.turrets.length,
                    s?.blueprint?.name,
                ];
            }),
        );
    });

    const at = shown();
    const ships = at === null ? [] : state.picked.map((i) => viewOf(at, i)).filter((s): s is ShipView => s !== null);
    const one = ships.length === 1 ? ships[0]! : null;
    // A placement belongs to the one ship it was picked on.
    const showing: DoctrinePart = part.startsWith("placement:") && one === null ? "ship" : part;

    // With the panel open on one ship, a click on one of its mounts tells that placement.
    useEffect(() => {
        view.pickPart((ship, x, y) => {
            if (view.picked.length !== 1 || ship.ship !== view.picked[0]) return false;
            const module = mountAt(ship, x, y);
            const placement = module < 0 ? undefined : placementOf(keyOf(ship.currentStructure, module));
            if (placement === undefined) return false;
            setPart(`placement:${placement}`);
            return true;
        });
        return () => view.pickPart(null);
    }, [view]);

    // The mounts it is telling, outlined on the ship; as text, so the effect runs only when they change.
    const marked = JSON.stringify(
        showing.startsWith("placement:") && one?.ship !== undefined
            ? { ship: one.ship, modules: mountsOf(one.currentStructure, showing).map((t) => one.currentStructure.turrets[t]!.module) }
            : null,
    );
    useEffect(() => {
        view.mark(JSON.parse(marked) as { ship: number; modules: number[] } | null);
        return () => view.mark(null);
    }, [view, marked]);

    const issue = (field: string, value: number | null): void =>
        view.issue({ kind: "doctrine", ships: [...state.picked], part: showing, field, value });

    const parts: [DoctrinePart, string][] = [
        ["ship", "Ship"],
        ["main", "Main weapons"],
        ["secondary", "Secondary weapons"],
    ];
    if (showing.startsWith("placement:")) parts.push([showing, "This mount"]);

    const sections = (showing === "ship" ? SHIP_SECTIONS : MOUNT_SECTIONS)
        .map((section) => ({
            section,
            groups: section.groups
                .map((group) => ({
                    group,
                    boxes: group.entries.filter((row) => shared(ships.flatMap((ship) => valuesOf(ship, showing, row))) !== null),
                }))
                .filter(({ boxes }) => boxes.length > 0),
        }))
        .filter(({ groups }) => groups.length > 0);
    const slots = showing === "ship" ? slotsOf(ships) : [];

    return (
        <Panel aria-label="Doctrine">
            <Tabs>
                {parts.map(([p, name]) => (
                    <button key={p} aria-pressed={p === showing} onClick={() => setPart(p)}>
                        {name}
                    </button>
                ))}
            </Tabs>
            {sections.map(({ section, groups }) => (
                <div key={section.title}>
                    <h3>{section.title}</h3>
                    {groups.map(({ group, boxes }) => (
                        <div key={group.title}>
                            {/* A section of one group says it once. */}
                            {group.title !== section.title && <h4>{group.title}</h4>}
                            {boxes.map((row) => (
                                <DoctrineBox key={row.field} row={row} ships={ships} part={showing} onIssue={issue} />
                            ))}
                        </div>
                    ))}
                </div>
            ))}
            {sections.length === 0 && showing !== "ship" && <p>No such weapons</p>}
            {slots.length > 0 && (
                <>
                    <h3>Building</h3>
                    {slots.map((slot) => (
                        <BuildBox key={slot.key} slot={slot} ships={ships} library={choices(library)} view={view} picked={state.picked} />
                    ))}
                </>
            )}
            <button
                title="Take all of this back to what the blueprint says"
                onClick={() => view.issue({ kind: "resetDoctrine", ships: [...state.picked], part: showing })}
            >
                ↺ Revert all
            </button>
            {one !== null && <p>Click a mount to tell it, and every copy of it, alone.</p>}
        </Panel>
    );
}

/** A box that tells its field when left or Enter is pressed, as an edit is a command, not every keystroke. */
function CommitBox({
    value,
    step,
    min,
    onCommit,
    label,
}: {
    readonly value: number | undefined;
    readonly step: number;
    readonly min?: number;
    readonly onCommit: (typed: string) => void;
    readonly label: string;
}) {
    const shown = value === undefined ? "" : String(value);
    const commit = (input: HTMLInputElement): void => {
        if (input.value.trim() !== shown) onCommit(input.value.trim());
    };
    return (
        <input
            // Put back to what the ships now go by whenever that changes.
            key={shown}
            type="number"
            aria-label={label}
            step={step}
            min={min}
            defaultValue={shown}
            placeholder={value === undefined ? "mixed" : ""}
            onBlur={(event) => commit(event.target)}
            onKeyDown={(event) => event.key === "Enter" && commit(event.currentTarget)}
        />
    );
}

function DoctrineBox({
    row,
    ships,
    part,
    onIssue,
}: {
    readonly row: DoctrineEntry;
    readonly ships: readonly ShipView[];
    readonly part: DoctrinePart;
    readonly onIssue: (field: string, value: number | null) => void;
}) {
    const value = shared(ships.flatMap((ship) => valuesOf(ship, part, row))) ?? undefined;
    const says = ships.some((ship) => told(ship.override, part, row));
    return (
        <Row title={row.hint} data-told={says}>
            <span>{row.label}</span>
            {/* Left of the box, so the box stays put as it comes and goes. */}
            {says && (
                <button title="Back to its design" aria-label={`${row.label} back to its design`} onClick={() => onIssue(row.field, null)}>
                    ↺
                </button>
            )}
            <CommitBox
                label={row.label}
                value={value}
                step={row.step}
                onCommit={(typed) => onIssue(row.field, typed === "" ? null : Number(typed))}
            />
        </Row>
    );
}

function BuildBox({
    slot,
    ships,
    library,
    view,
    picked,
}: {
    readonly slot: BuildSlot;
    readonly ships: readonly ShipView[];
    readonly library: readonly Choice[];
    readonly view: BattleView;
    readonly picked: readonly number[];
}) {
    // What it builds: as designed, or anything in the library it could build.
    const buildable = library.filter((choice) =>
        slot.pad
            ? choice.design.fighter && padHolds(choice.design, slot.spec)
            : !choice.design.fighter && slipwayHolds(choice.design, slot.spec),
    );
    return (
        <Row title="What it builds, and how many of them it keeps in the fight">
            <span>{slot.label}</span>
            {ships.some((ship) => ship.crafts?.[slot.key] !== undefined) && (
                <button
                    title="Back to what its design builds"
                    onClick={() => view.issue({ kind: "craft", ships: [...picked], slot: slot.key, blueprint: null })}
                >
                    ↺
                </button>
            )}
            <select
                aria-label={`${slot.label} builds`}
                value=""
                onChange={(event) => {
                    const choice = buildable[Number(event.target.value)];
                    if (event.target.value !== "" && choice !== undefined)
                        view.issue({ kind: "craft", ships: [...picked], slot: slot.key, blueprint: choice.blueprint });
                }}
            >
                <option value="">{slot.craft ?? "mixed"}</option>
                {buildable.map((choice, n) => (
                    <option key={choice.label} value={n}>
                        {choice.label}
                    </option>
                ))}
            </select>
            <CommitBox
                label={`${slot.label} keeps`}
                value={slot.keep}
                step={1}
                min={0}
                onCommit={(typed) =>
                    view.issue({
                        kind: "keep",
                        ships: [...picked],
                        slot: slot.key,
                        keep: typed === "" ? null : Math.max(0, Math.floor(Number(typed))),
                    })
                }
            />
        </Row>
    );
}
