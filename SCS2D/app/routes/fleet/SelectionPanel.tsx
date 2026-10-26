import { styled } from "@linaria/react";
import { useRef } from "react";
import type { FleetDocument } from "~/editor/fleetDocument";
import {
    dissolveGroup,
    duplicateEntries,
    deleteEntries,
    entryAt,
    forkDesign,
    makeGroup,
    renameGroup,
    swapDesign,
    updateEntry,
} from "~/editor/fleetEdit";
import type { Library, LibraryEntry } from "~/editor/library";
import { snapStep } from "~/render/camera";
import {
    degreesToRadians,
    isGroupUse,
    MAX_FLEET_REPEAT,
    radiansToDegrees,
    type Blueprint,
    type FleetEntry,
    type FleetStep,
} from "~/sim/index";
import { CommitText } from "~/ui/fields/CommitText";
import { LiveNumber } from "~/ui/fields/LiveText";
import { CARRIED, designOf, optionLabel, optionValue } from "./fleetOptions";
import { Button } from "~/ui/buttons/Button";

const Field = styled.div`
    display: flex;
    gap: 0.4rem;
    align-items: center;
    margin-bottom: 0.3rem;

    > label {
        flex: 0 0 6.5rem;
        color: var(--colour-muted);
    }

    > input,
    > select {
        flex: 1;
        min-width: 0;
    }

    > input[type="checkbox"] {
        flex: 0 0 auto;
    }
`;

const Buttons = styled.div`
    display: flex;
    gap: 0.4rem;
    margin-top: 0.6rem;

    > button {
        flex: 1;
        padding-inline: 0.3rem;
    }
`;

export interface SelectionPanelProps {
    readonly doc: FleetDocument;
    /** The view's zoom, which sets how far a position box steps. */
    readonly scale: number;
    readonly ships: Library<Blueprint>;
    readonly library: readonly LibraryEntry[];
    /** The ship editor's address for one of the fleet's designs. */
    readonly designHref: (design: string) => string;
    /** Before following a link away. */
    readonly onLeave: () => void;
    /** After the fleet or the selection changed. */
    readonly onChanged: () => void;
}

function round(value: number): number {
    return Math.round(value * 1000) / 1000;
}

/** The selected ship or group: its design, where it stands, how it repeats, and what can be done to it. */
export function SelectionPanel({ doc, scale, ships, library, designHref, onLeave, onChanged }: SelectionPanelProps) {
    // Typing in a box is one edit, not one per key: the first change is an undo step and the rest amend it.
    const gesture = useRef(false);
    const picked = doc.selection;
    const path = picked[0];
    const entry = path === undefined ? null : entryAt(doc.fleet, path);
    if (path === undefined || entry === null) return null;

    const one = picked.length === 1;
    const group = isGroupUse(entry);
    const inside = path.length > 1 ? entryAt(doc.fleet, path.slice(0, -1)) : null;
    const title =
        picked.length > 1
            ? `${picked.length} selected`
            : (group ? `Group: ${entry.group}` : `Ship: ${entry.design}`) +
              (inside !== null && isGroupUse(inside) ? ` in ${inside.group}` : "");
    const repeated = (entry.repeat ?? 1) > 1;
    const step = snapStep(scale);

    const changed = (): void => onChanged();
    const editSelected = (change: (entry: FleetEntry) => FleetEntry): void => {
        if (!one) return;
        const next = updateEntry(doc.fleet, path, change);
        if (gesture.current) doc.amend(next);
        else doc.apply(next);
        gesture.current = true;
        changed();
    };
    const live = (id: string, value: number, change: (value: number, entry: FleetEntry) => FleetEntry, boxStep = step, min?: number) => (
        <LiveNumber
            id={id}
            value={round(value)}
            step={boxStep}
            {...(min === undefined ? {} : { min })}
            onEdit={(typed) => editSelected((e) => change(typed, e))}
            onStart={() => (gesture.current = false)}
            onDone={() => (gesture.current = false)}
        />
    );
    const withStep = (e: FleetEntry, change: (step: FleetStep) => FleetStep): FleetEntry => ({
        ...e,
        step: change({ ...(e.step ?? { x: 0, y: 0 }) }),
    });
    // A new row starts a ship's width apart, plus a margin, so its copies do not stack on the first.
    const defaultStep = (): number => Math.max(snapStep(scale), Math.ceil(doc.reachOf(path) * 2.5));

    const carried = Object.keys(doc.fleet.designs).sort((a, b) => a.localeCompare(b));
    const others = library.filter((each) => !carried.includes(each.name));
    const saved = others.filter((each) => !each.stock);

    return (
        <section id="selection">
            <h2 id="selectionTitle">{title}</h2>
            {one && (
                <div id="single">
                    {!group && (
                        <Field id="designRow">
                            <label htmlFor="entryDesign">design</label>
                            <select
                                id="entryDesign"
                                title="Swap this ship for another design, in the same place and facing the same way"
                                value={CARRIED + entry.design}
                                onChange={(event) => {
                                    const blueprint = designOf(doc.fleet, ships, event.target.value);
                                    if (blueprint !== null) doc.apply(swapDesign(doc.fleet, [path], blueprint));
                                    changed();
                                }}
                            >
                                <optgroup label="In this fleet">
                                    {carried.map((name) => (
                                        <option key={name} value={CARRIED + name}>
                                            {name}
                                        </option>
                                    ))}
                                </optgroup>
                                {saved.length > 0 && (
                                    <optgroup label="Saved">
                                        {saved.map((each) => (
                                            <option key={optionValue(each)} value={optionValue(each)}>
                                                {optionLabel(each)}
                                            </option>
                                        ))}
                                    </optgroup>
                                )}
                                <optgroup label="Stock">
                                    {others
                                        .filter((each) => each.stock)
                                        .map((each) => (
                                            <option key={optionValue(each)} value={optionValue(each)}>
                                                {optionLabel(each)}
                                            </option>
                                        ))}
                                </optgroup>
                            </select>
                            <a
                                id="editDesign"
                                href={designHref(entry.design)}
                                title="Open this design in the ship editor, and come back to the fleet with it changed"
                                onClick={onLeave}
                            >
                                Edit
                            </a>
                            <Button
                                id="forkDesign"
                                title="Fly a copy of this design under a new name, to change this ship without changing the others of its design"
                                onClick={() => {
                                    const forked = forkDesign(doc.fleet, path);
                                    if (forked === null) return;
                                    doc.apply(forked.fleet);
                                    changed();
                                }}
                            >
                                Fork
                            </Button>
                        </Field>
                    )}
                    <Field>
                        <label htmlFor="entryX">position</label>
                        {live("entryX", entry.x, (x, e) => ({ ...e, x }))}
                        {live("entryY", entry.y, (y, e) => ({ ...e, y }))}
                    </Field>
                    <Field>
                        <label htmlFor="entryAngle">facing °</label>
                        {live(
                            "entryAngle",
                            radiansToDegrees(entry.angle ?? 0),
                            (degrees, e) => ({ ...e, angle: degreesToRadians(degrees) }),
                            15,
                        )}
                    </Field>
                    {group && (
                        <Field id="groupNameRow">
                            <label htmlFor="groupName">group</label>
                            <CommitText
                                id="groupName"
                                title="The group's name, in its definition and every use of it"
                                value={entry.group}
                                onCommit={(typed) => {
                                    const renamed = renameGroup(doc.fleet, entry.group, typed);
                                    if (renamed !== null) doc.apply(renamed);
                                    changed();
                                }}
                            />
                        </Field>
                    )}
                    {group && (
                        <Field id="mirrorRow">
                            <label htmlFor="entryMirror">mirrored</label>
                            <input
                                id="entryMirror"
                                type="checkbox"
                                checked={entry.mirror === true}
                                onChange={(event) => {
                                    const mirror = event.target.checked;
                                    gesture.current = false;
                                    editSelected((e) => {
                                        if (!isGroupUse(e)) return e;
                                        const next = { ...e };
                                        if (mirror) next.mirror = true;
                                        else delete next.mirror;
                                        return next;
                                    });
                                    gesture.current = false;
                                }}
                            />
                        </Field>
                    )}
                    <Field>
                        <label htmlFor="repeatCount">copies</label>
                        {live(
                            "repeatCount",
                            entry.repeat ?? 1,
                            (count, e) => {
                                const next = { ...e };
                                const copies = Math.max(1, Math.min(MAX_FLEET_REPEAT, Math.round(count)));
                                if (copies === 1) delete next.repeat;
                                else {
                                    next.repeat = copies;
                                    if (next.step === undefined) next.step = { x: 0, y: defaultStep() };
                                }
                                return next;
                            },
                            1,
                            1,
                        )}
                    </Field>
                    {repeated && (
                        <>
                            <Field id="stepRow">
                                <label htmlFor="stepX">step m</label>
                                {live("stepX", entry.step?.x ?? 0, (x, e) => withStep(e, (s) => ({ ...s, x })))}
                                {live("stepY", entry.step?.y ?? 0, (y, e) => withStep(e, (s) => ({ ...s, y })))}
                            </Field>
                            <Field id="stepAngleRow">
                                <label htmlFor="stepAngle">step turn °</label>
                                {live(
                                    "stepAngle",
                                    radiansToDegrees(entry.step?.angle ?? 0),
                                    (degrees, e) =>
                                        withStep(e, (s) => {
                                            if (degrees === 0) delete s.angle;
                                            else s.angle = degreesToRadians(degrees);
                                            return s;
                                        }),
                                    5,
                                )}
                            </Field>
                        </>
                    )}
                </div>
            )}
            <Buttons>
                {one && path.length > 1 && (
                    <Button
                        id="upLevel"
                        title="Select the group this is in"
                        onClick={() => {
                            doc.select([path.slice(0, -1)]);
                            changed();
                        }}
                    >
                        Select group
                    </Button>
                )}
                <Button
                    id="makeGroup"
                    title="Make a group of what is selected, where it stands"
                    disabled={makeGroup(doc.fleet, picked) === null}
                    onClick={() => {
                        const made = makeGroup(doc.fleet, picked);
                        if (made === null) return;
                        doc.apply(made.fleet);
                        doc.select([made.path]);
                        changed();
                    }}
                >
                    Make group
                </Button>
                {one && group && (
                    <Button
                        id="dissolveGroup"
                        title="Put this group's ships back where they stand, and drop the group if nothing else uses it"
                        onClick={() => {
                            const dissolved = dissolveGroup(doc.fleet, path);
                            if (dissolved === null) return;
                            doc.apply(dissolved.fleet);
                            doc.select(dissolved.paths);
                            changed();
                        }}
                    >
                        Dissolve
                    </Button>
                )}
                <Button
                    id="duplicateEntry"
                    onClick={() => {
                        const result = duplicateEntries(doc.fleet, picked, 0, -snapStep(scale) * 20);
                        doc.apply(result.fleet);
                        doc.select(result.paths);
                        changed();
                    }}
                >
                    Duplicate
                </Button>
                <Button
                    id="deleteEntry"
                    onClick={() => {
                        doc.apply(deleteEntries(doc.fleet, picked));
                        doc.select([]);
                        changed();
                    }}
                >
                    Delete
                </Button>
            </Buttons>
        </section>
    );
}
