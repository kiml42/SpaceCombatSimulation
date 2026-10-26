import { styled } from "@linaria/react";
import {
    kindName,
    mountDefault,
    mountSummary,
    MOUNT_SECTIONS,
    shipDefault,
    shipSummary,
    SHIP_SECTIONS,
    withMountField,
    withShipField,
    type DoctrineContext,
    type DoctrineEntry,
    type DoctrineSection,
    type DoctrineValues,
} from "~/editor/doctrine";
import { updatePlacement } from "~/editor/edit";
import { designStats, moduleReadout, type Envelopes } from "~/editor/stats";
import {
    DEFAULT_DOCTRINE,
    defaultTargeting,
    inReachDesign,
    isWeaponMount,
    resolveTargeting,
    type ModuleSpec,
    type Placement,
} from "~/sim/index";
import { Button } from "~/ui/buttons/Button";
import { LiveText } from "~/ui/fields/LiveText";
import { Buttons, Field } from "./shipLayout";
import type { ShipEditing } from "./shipEditing";

/*
 * Shut by default and quiet when shut: building a ship is the common case, and
 * a summary line is all the panel owes someone who is not setting doctrine.
 */
const Details = styled.details`
    margin-top: 0.7rem;
    padding-top: 0.6rem;
    border-top: 1px solid var(--colour-border);

    summary {
        color: var(--colour-muted);
        cursor: pointer;
    }

    summary:hover {
        color: var(--colour-text);
    }

    summary span {
        color: var(--colour-heading);
    }

    h3 {
        margin: 0.8rem 0 0.4rem;
        color: var(--colour-muted);
        font-size: var(--font-size-small);
        font-weight: 400;
        letter-spacing: 0.08em;
        text-transform: uppercase;
    }

    h4 {
        margin: 0.5rem 0 0.3rem;
        color: var(--colour-muted);
        font-size: var(--font-size-small);
        font-weight: 400;
    }

    p {
        margin: 0.5rem 0 0;
        color: var(--colour-faint);
    }

    /* A stated number stands out from the ones still at their default. */
    input[data-stated="true"] {
        border-color: #4a3f24;
        color: var(--colour-warning);
    }
`;

const Absolute = styled.span`
    flex: 0 0 auto;
    color: var(--colour-faint);
`;

export interface DoctrineOpen {
    readonly mount: boolean;
    readonly ship: boolean;
}

/**
 * The boxes of one doctrine, laid out by what each decision is about. Every box
 * says what its number comes to for this ship, and is left out while a setting
 * above it has made it mean nothing. Empty is the default, shown as the
 * placeholder: what the box will do if left alone.
 */
function DoctrineBoxes({
    sections,
    values,
    context,
    held,
    fallback,
    onType,
    onStart,
}: {
    readonly sections: readonly DoctrineSection[];
    readonly values: DoctrineValues;
    readonly context: DoctrineContext | null;
    readonly held: (row: DoctrineEntry) => number | undefined;
    readonly fallback: (row: DoctrineEntry) => number;
    readonly onType: (row: DoctrineEntry, typed: string) => void;
    readonly onStart: () => void;
}) {
    return sections.map((section) => (
        <div key={section.title}>
            <h3>{section.title}</h3>
            {section.groups.map((group) => (
                <div key={group.title}>
                    {/* A section of one group says it once. */}
                    {group.title !== section.title && <h4>{group.title}</h4>}
                    {group.entries
                        .filter((row) => row.shown === undefined || row.shown(values))
                        .map((row) => {
                            const id = `doctrine-${row.half}-${row.field}`;
                            const value = held(row);
                            const shown = value === undefined || value === fallback(row) ? "" : String(value);
                            return (
                                <Field key={row.field} title={row.hint}>
                                    <label htmlFor={id}>{row.label}</label>
                                    <LiveText
                                        id={id}
                                        type="number"
                                        step={row.step}
                                        title={row.hint}
                                        placeholder={String(fallback(row))}
                                        data-stated={shown !== ""}
                                        value={shown}
                                        onStart={onStart}
                                        onType={(typed) => onType(row, typed)}
                                    />
                                    <Absolute>{context === null ? "" : (row.absolute?.(values, context) ?? "")}</Absolute>
                                </Field>
                            );
                        })}
                </div>
            ))}
        </div>
    ));
}

/**
 * Which doctrine the selected module is about, if any. A weapon is asked what
 * it shoots at, and a core what its ship does — the ship's one doctrine, since
 * a core is only where it is edited from. Anything else is asked nothing.
 */
export function DoctrineDetails({
    editing,
    spec,
    envelope,
    open,
    onOpen,
}: {
    readonly editing: ShipEditing;
    readonly spec: ModuleSpec;
    readonly envelope: Envelopes | null;
    readonly open: DoctrineOpen;
    readonly onOpen: (open: DoctrineOpen) => void;
}) {
    const { doc } = editing;
    const weapon = isWeaponMount(spec.kind);
    const core = spec.kind === "core";
    if (!weapon && !core) return null;

    /** What relative numbers are said in terms of: the ship being edited. */
    const context = (fireRange: number | null = null): DoctrineContext | null => {
        const design = doc.view.design;
        if (design === null || envelope === null) return null;
        const stats = designStats(inReachDesign(design), envelope);
        return {
            mass: design.mass,
            radius: design.radius,
            reach: design.reach,
            accelFore: stats.accelFore,
            accelAft: stats.accelAft,
            brakeHolding: stats.brakeHolding,
            brakeTurned: stats.brakeTurned,
            guns: design.turrets.filter((turret) => turret.main).length,
            fireRange,
        };
    };
    /** An empty box takes the statement back out, rather than writing a zero. */
    const typedValue = (typed: string): number | null | undefined => {
        const text = typed.trim();
        if (text !== "" && !Number.isFinite(Number(text))) return undefined;
        return text === "" ? null : Number(text);
    };

    if (weapon) {
        const held = (spec.targeting ?? {}) as Record<string, number | undefined>;
        const index = doc.selectedModules()[0] ?? -1;
        const fireRange = moduleReadout(spec, doc.view.modules, index, doc.view.design?.radius ?? 0).gun?.triggerRange ?? null;
        return (
            <Details id="mountDoctrine" open={open.mount} onToggle={(event) => onOpen({ ...open, mount: event.currentTarget.open })}>
                <summary>
                    What it shoots at — <span id="mountDoctrineSummary">{mountSummary(spec.kind, spec.targeting)}</span>
                </summary>
                <div id="mountDoctrineFields">
                    <DoctrineBoxes
                        sections={MOUNT_SECTIONS}
                        values={{
                            targeting: resolveTargeting(spec.targeting, defaultTargeting(spec.kind)),
                            approach: (doc.blueprint.doctrine ?? DEFAULT_DOCTRINE).approach,
                        }}
                        context={context(fireRange)}
                        held={(row) => held[row.field]}
                        fallback={(row) => mountDefault(spec.kind, row.field)}
                        onStart={editing.endGesture}
                        onType={(row, typed) => {
                            let value = typedValue(typed);
                            const path = doc.selection;
                            if (value === undefined || path === null) return;
                            // What the archetype already does is not a statement, so the file stops carrying one.
                            if (value === mountDefault(spec.kind, row.field)) value = null;
                            editing.change(
                                updatePlacement(doc.blueprint, path, (placement) => {
                                    const next = { ...placement } as ModuleSpec;
                                    const targeting = withMountField(next.targeting, row.field, value);
                                    if (targeting === undefined) delete next.targeting;
                                    else next.targeting = targeting;
                                    return next as Placement;
                                }),
                                true,
                            );
                        }}
                    />
                </div>
                <p>Empty is this archetype&apos;s own default. Clear a box to go back to it.</p>
                <Buttons>
                    <Button
                        id="mountDoctrineReset"
                        disabled={spec.targeting === undefined}
                        title={`Take this ${kindName(spec.kind)} back to what its archetype does`}
                        onClick={() => {
                            const path = doc.selection;
                            if (path === null) return;
                            editing.change(
                                updatePlacement(doc.blueprint, path, (placement) => {
                                    const next = { ...placement } as ModuleSpec;
                                    delete next.targeting;
                                    return next as Placement;
                                }),
                            );
                        }}
                    >
                        Back to default
                    </Button>
                </Buttons>
            </Details>
        );
    }

    const doctrine = doc.blueprint.doctrine;
    return (
        <Details id="shipDoctrine" open={open.ship} onToggle={(event) => onOpen({ ...open, ship: event.currentTarget.open })}>
            <summary>
                What the ship does — <span id="shipDoctrineSummary">{shipSummary(doctrine)}</span>
            </summary>
            <div id="shipDoctrineFields">
                <DoctrineBoxes
                    sections={SHIP_SECTIONS}
                    values={doctrine ?? DEFAULT_DOCTRINE}
                    context={context()}
                    held={(row) =>
                        (doctrine?.[row.half as "targeting" | "approach"] as unknown as Record<string, number> | undefined)?.[row.field]
                    }
                    fallback={(row) => shipDefault(row.half as "targeting" | "approach", row.field)}
                    onStart={editing.endGesture}
                    onType={(row, typed) => {
                        const value = typedValue(typed);
                        if (value === undefined) return;
                        const changed = withShipField(doc.blueprint.doctrine, row.half as "targeting" | "approach", row.field, value);
                        const next = { ...doc.blueprint };
                        if (changed === undefined) delete next.doctrine;
                        else next.doctrine = changed;
                        editing.change(next, true);
                    }}
                />
            </div>
            <p>The ship&apos;s own doctrine, not this core&apos;s. Empty is the default.</p>
            <Buttons>
                <Button
                    id="shipDoctrineReset"
                    disabled={doctrine === undefined}
                    onClick={() => {
                        const next = { ...doc.blueprint };
                        delete next.doctrine;
                        editing.change(next);
                    }}
                >
                    Back to default
                </Button>
            </Buttons>
        </Details>
    );
}
