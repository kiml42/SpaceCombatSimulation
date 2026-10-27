import { styled } from "@linaria/react";
import { kindName } from "~/editor/doctrine";
import { dockFighter, duplicatePlacement, instanceOf, reshapePlacement, updatePlacement } from "~/editor/edit";
import type { DesignInFleet } from "~/editor/handoff";
import type { Library } from "~/editor/library";
import { selectedPosition } from "~/editor/shipCanvas";
import { moduleReadout, roundsAboard, type Envelopes } from "~/editor/stats";
import {
    canShape,
    canThicken,
    CORE_COMPUTING_SHARE,
    degreesToRadians,
    firesShells,
    isHullMount,
    isShaped,
    isThick,
    isWeaponMount,
    math,
    MODULE_KINDS,
    padHolds,
    placementAt,
    radiansToDegrees,
    readsBarrelCalibres,
    readsComputing,
    readsRobotsPerBerth,
    readsCraft,
    readsCraftAngle,
    readsDocked,
    readsDrainPriority,
    readsFill,
    readsFuse,
    readsSealing,
    readsThick,
    refitModule,
    shapeModule,
    slipwayHolds,
    wedge,
    type Blueprint,
    type ModuleKind,
    type ModuleSpec,
    type Placement,
} from "~/sim/index";
import { Button } from "~/ui/buttons/Button";
import { LiveNumber, LiveText } from "~/ui/fields/LiveText";
import { TakeOut } from "./AssemblyPanels";
import { DoctrineDetails, type DoctrineOpen } from "./DoctrineDetails";
import { Figures } from "./ShipReport";
import { Buttons, Field } from "./shipLayout";
import { asCraft, barrelReadout, craftChoices, CRAFT_ANGLES, moduleField, numbers, type ModuleNumberField } from "./shipFields";
import type { ShipEditing } from "./shipEditing";

const { abs, PI } = math;

const Linked = styled.p`
    margin: 0 0 0.5rem;
    color: var(--colour-warning);
`;

const Shell = styled.fieldset`
    margin: 0 0 0.3rem;
    padding: 0.2rem 0.5rem 0.1rem;
    border: 1px solid var(--colour-border);
    border-radius: 4px;

    legend {
        color: var(--colour-muted);
    }
`;

const Readout = styled.span`
    flex: 0 0 auto;
    color: var(--colour-faint);
`;

const WarnLabel = styled.label`
    &[data-warn="true"] {
        color: var(--colour-warning) !important;
    }
`;

const Stats = styled.div`
    margin-top: 0.7rem;
    padding-top: 0.6rem;
    border-top: 1px solid var(--colour-border);
`;

const THICK_TITLE =
    "As deep as it is across, rather than a deck. Stands up into the weapons layer: cover for turrets and in their arcs, and in their reach. A bigger barrel or nozzle, and heavier walls. Structure of any width may be marked, and stands as high as the deepest module it is welded to.";

export interface ModulePanelProps {
    readonly editing: ShipEditing;
    readonly spec: ModuleSpec;
    readonly library: Library<Blueprint>;
    readonly inFleet: DesignInFleet | null;
    readonly envelope: Envelopes | null;
    readonly doctrineOpen: DoctrineOpen;
    readonly onDoctrineOpen: (open: DoctrineOpen) => void;
    readonly onDelete: () => void;
}

/** The selected module: its kind, place, size and every setting its kind reads, what it comes to, and its doctrine. */
export function ModulePanel({ editing, spec, library, inFleet, envelope, doctrineOpen, onDoctrineOpen, onDelete }: ModulePanelProps) {
    const { doc } = editing;
    const path = doc.selection;
    const copies = doc.selectedModules().length;
    const fighter = doc.blueprint.fighter === true;
    const step = editing.snapMetres();

    const update = (change: (placement: Placement) => Placement, continues = false): void => {
        if (path === null) return;
        editing.change(updatePlacement(doc.blueprint, path, change), continues);
    };
    const patch = (fields: Partial<ModuleSpec>): void => update((placement) => ({ ...placement, ...fields }) as Placement, true);
    /** A flag, absent rather than false when it is off, so a file only ever says the unusual thing. */
    const flag = (key: "weapon" | "thick" | "docked" | "buildAnchored", on: boolean): void =>
        update((placement) => {
            if (!("kind" in placement)) return placement;
            const next = { ...placement };
            if (on) next[key] = true;
            else delete next[key];
            return next;
        });
    /** A share, left unsaid when it is the default. */
    const share = (key: "fill" | "computing", value: number, fallback: number): void =>
        update((placement) => {
            const { [key]: _, ...rest } = placement as ModuleSpec;
            const part = Math.min(Math.max(value, 0), 100) / 100;
            return (part !== fallback ? { ...rest, [key]: part } : rest) as Placement;
        }, true);

    const box = (
        key: ModuleNumberField,
        props: { step: number; min?: number; max?: number; title?: string; disabled?: boolean },
        apply: (value: number) => void,
    ) => (
        <LiveNumber
            id={`prop${key[0]!.toUpperCase()}${key.slice(1)}`}
            value={moduleField(spec, key)}
            {...props}
            onEdit={apply}
            onStart={editing.endGesture}
            onDone={editing.endGesture}
        />
    );

    // The position shown is the one that puts this copy here: for a shared part, its instance's.
    const handle = selectedPosition(doc);
    const positioned = handle === null ? null : placementAt(doc.blueprint, handle.origin.path);
    const position = (key: "x" | "y") => (
        <LiveNumber
            id={key === "x" ? "propX" : "propY"}
            value={positioned === null ? 0 : positioned[key]}
            step={step}
            onStart={editing.endGesture}
            onDone={editing.endGesture}
            onEdit={(value) => {
                const at = selectedPosition(doc);
                if (at !== null)
                    editing.change(
                        updatePlacement(doc.blueprint, at.origin.path, (p) => ({ ...p, [key]: value })),
                        true,
                    );
            }}
        />
    );
    const size = (key: "length" | "width") => (
        <LiveNumber
            id={key === "length" ? "propLength" : "propWidth"}
            value={spec[key]}
            step={step}
            min={step}
            onStart={editing.endGesture}
            onDone={editing.endGesture}
            onEdit={(value) => patch({ [key]: value })}
        />
    );

    // One field, three words for it: a gun's outlets are barrels, a beam's emitters, an engine's nozzles.
    const nozzles = spec.kind === "engine";
    const barrels = nozzles || isHullMount(spec.kind) || spec.kind === "turret" || spec.kind === "beamTurret";
    // Solid shot has no burst to time or to size.
    const shells = firesShells(spec);
    const thickable = canThicken(spec) && !fighter;
    const origin = doc.selectedOrigin();
    const within = origin === null ? null : instanceOf(origin);
    const index = doc.selectedModules()[0] ?? -1;
    const readout = moduleReadout(spec, doc.view.modules, index, doc.view.design?.radius ?? 0);
    const design = doc.view.design;

    return (
        <section id="properties">
            <h2>Selected module</h2>
            {copies > 1 && (
                <Linked id="linked">{`Shared: drawn ${copies} times. Size, facing and notes change every copy; position moves this one.`}</Linked>
            )}
            <Field>
                <label htmlFor="propKind">kind</label>
                <select
                    id="propKind"
                    title="Swap this module for another kind in the same space. Becoming or ceasing to be an engine turns it round, so what faced outboard still does."
                    value={spec.kind}
                    onChange={(event) => {
                        const to = event.target.value as ModuleKind;
                        // Every copy of a shared part is swapped, as any other edit to it is.
                        update((placement) => ("kind" in placement ? refitModule(placement, to) : placement));
                    }}
                >
                    {MODULE_KINDS.map((kind) => (
                        <option key={kind} value={kind} disabled={fighter && (kind === "turret" || kind === "beamTurret")}>
                            {kindName(kind)}
                        </option>
                    ))}
                </select>
            </Field>
            <Field>
                <label htmlFor="propX">position</label>
                {position("x")}
                {position("y")}
            </Field>
            <Field>
                <label htmlFor="propAngle">facing °</label>
                {box("angle", { step: 15 }, (degrees) => patch({ angle: degreesToRadians(degrees) }))}
            </Field>
            <Field>
                <label htmlFor="propLength">length m</label>
                {size("length")}
            </Field>
            <Field>
                <label htmlFor="propWidth">width m</label>
                {size("width")}
            </Field>
            <Field>
                <label htmlFor="propReinforcement">reinforce</label>
                {box("reinforcement", { step: 0.5, min: 1 }, (reinforcement) => patch({ reinforcement }))}
            </Field>
            {barrels && (
                <Field id="barrelsRow">
                    <label htmlFor="propBarrels" id="barrelsLabel">
                        {nozzles ? "nozzles" : spec.kind === "beamTurret" ? "emitters" : "barrels"}
                    </label>
                    {box("barrels", { step: 1, min: 1 }, (value) => patch({ barrels: value }))}
                </Field>
            )}
            {nozzles && (
                <Field id="nozzleRow">
                    <label htmlFor="propNozzle" id="nozzleLabel">
                        nozzle
                    </label>
                    {box(
                        "nozzle",
                        {
                            step: 0.1,
                            min: 0,
                            title: "How long the bell is, in widths of its exit, reaching out beyond the block that length and width size. Longer wastes less thrust sideways, with little more to gain past a width or two, and is more engine to fit in and to be hit.",
                        },
                        (nozzle) => patch({ nozzle }),
                    )}
                </Field>
            )}
            {readsBarrelCalibres(spec.kind) && (
                <Field id="barrelCalibresRow">
                    <label htmlFor="propBarrelCalibres">barrel cal</label>
                    {box(
                        "barrelCalibres",
                        {
                            step: 1,
                            min: 1,
                            max: 100,
                            title: "How long the barrels are, in calibres of the bore. Longer is a faster shell, with diminishing returns, and costs steel and traverse; on a hull gun it reaches out beyond the block that length and width size. Past 50 calibres a barrel needs bracing, which makes each calibre heavier, and nothing may be longer than 100.",
                        },
                        (barrelCalibres) => patch({ barrelCalibres }),
                    )}
                    <Readout id="barrelMetres">{barrelReadout(spec)}</Readout>
                </Field>
            )}
            {isWeaponMount(spec.kind) && (
                <Field id="traverseRow">
                    <label htmlFor="propTraverse">traverse °</label>
                    {box(
                        "traverse",
                        {
                            step: 5,
                            min: 0,
                            title: "How far the weapon may train either way from its resting bearing. A limit only: the mount's own arc and whatever the ship is in the way of still apply. A turret's ring goes all the way round whatever it is told, so limiting one weighs the same; a hull weapon's bed is built for the arc it sweeps, so a narrower one is lighter and a fixed one carries no training gear at all.",
                        },
                        (degrees) => patch({ traverse: degreesToRadians(degrees) }),
                    )}
                </Field>
            )}
            {readsFuse(spec.kind) && (
                <Shell id="shellRow">
                    <legend>shell</legend>
                    <Field>
                        <label htmlFor="propFragments">fragments</label>
                        {box(
                            "fragments",
                            {
                                step: 1,
                                min: 0,
                                max: 64,
                                title: "How many fragments the round bursts into. Fragments meet every module, deck included, which is how a turret reaches a hull. One or fewer fires solid shot: all metal, never bursting.",
                            },
                            (fragments) => patch({ fragments }),
                        )}
                    </Field>
                    <Field>
                        <label htmlFor="propBurstSpeed">burst m/s</label>
                        {box(
                            "burstSpeed",
                            {
                                step: 10,
                                min: 1,
                                disabled: !shells,
                                title: "How fast the fragments leave the burst. Faster spreads them wider, and needs more of the shell to be charge, so a lighter shell that leaves the barrel faster.",
                            },
                            (burstSpeed) => patch({ burstSpeed }),
                        )}
                    </Field>
                    <Field>
                        <label htmlFor="propFuse">fuse s</label>
                        {box(
                            "fuse",
                            {
                                step: 0.05,
                                min: 0,
                                disabled: !shells,
                                title: "How long before its round would reach what it is aimed at it bursts, seconds. Longer spreads the fragments wider and thinner. Zero bursts at the aim point, which still counts on a miss or on what is behind the target.",
                            },
                            (fuse) => patch({ fuse }),
                        )}
                    </Field>
                </Shell>
            )}
            {/* Only an engine has a plume to point. */}
            {spec.kind === "engine" && (
                <Field id="weaponRow">
                    <label htmlFor="propWeapon">weapon</label>
                    <input
                        id="propWeapon"
                        type="checkbox"
                        title="Burn at an enemy that gets close behind this engine, whether or not thrust was wanted"
                        checked={spec.weapon === true}
                        onChange={(event) => flag("weapon", event.target.checked)}
                    />
                </Field>
            )}
            {/* An engine is only a weapon once it is marked as one. */}
            {(isWeaponMount(spec.kind) || (spec.kind === "engine" && spec.weapon === true)) && (
                <Field id="mainRow">
                    <label htmlFor="propMain">main</label>
                    <input
                        id="propMain"
                        type="checkbox"
                        title="Part of the main battery: the ship flies to these weapons' reach and counts itself armed while one works. Untick point defence and other secondaries."
                        checked={spec.main !== false}
                        onChange={(event) => {
                            const on = event.target.checked;
                            update((placement) => {
                                if (!("kind" in placement)) return placement;
                                const next = { ...placement };
                                // Absent rather than true when it is on: main is the usual thing.
                                if (on) delete next.main;
                                else next.main = false;
                                return next;
                            });
                        }}
                    />
                </Field>
            )}
            {canShape(spec.kind) && (
                <Field id="shapeRow">
                    <label htmlFor="propShape">triangle</label>
                    <input
                        id="propShape"
                        type="checkbox"
                        title="Three corners instead of a box, each dragged on its own. A hull of rectangles can only step towards a prow; a wedge draws one. It costs the two things a box has that a triangle has not: a face to size it by, and a face for a bell or a barrel to come out of — so hull, tanks and holds only."
                        checked={isShaped(spec)}
                        onChange={(event) => {
                            // A triangle starts as the wedge filling its box; squared off, it is the box its corners fitted in.
                            const drawn = doc.view.modules[doc.selectedLoose()[0] ?? -1];
                            if (origin === null || drawn === undefined) return;
                            const shaped = event.target.checked ? shapeModule(drawn, wedge(drawn)) : shapeModule(drawn, null);
                            if (shaped === null) return editing.refresh();
                            editing.change(
                                reshapePlacement(doc.blueprint, origin, shaped.vertices ?? null, shaped.x - drawn.x, shaped.y - drawn.y),
                            );
                        }}
                    />
                </Field>
            )}
            {readsThick(spec.kind) && (
                <Field id="thickRow">
                    <label htmlFor="propThick">thick</label>
                    <input
                        id="propThick"
                        type="checkbox"
                        disabled={!thickable}
                        title={
                            thickable
                                ? THICK_TITLE
                                : fighter && canThicken(spec)
                                  ? "A fighter has nothing thick."
                                  : spec.kind === "engine"
                                    ? "Too narrow to be thick: each nozzle is no more than a deck wide, so already as deep as it is wide."
                                    : "Too narrow to be thick: no more than a deck across, so already as deep as it is wide."
                        }
                        checked={isThick(spec)}
                        onChange={(event) => flag("thick", event.target.checked)}
                    />
                </Field>
            )}
            {readsSealing(spec.kind) && (
                <Field id="sealingRow">
                    <label htmlFor="propSealing">sealing mm</label>
                    {box(
                        "sealing",
                        {
                            step: 5,
                            min: 0,
                            title: "How thick a self-sealing lining is inside the walls, millimetres. Thicker closes a hole faster, and closes wider ones; a hole wider than it can reach shrinks but stays open. It weighs, and takes room from the fuel. Zero never seals.",
                        },
                        (millimetres) => patch({ sealing: millimetres / 1000 }),
                    )}
                </Field>
            )}
            {readsDrainPriority(spec.kind) && (
                <Field id="drainPriorityRow">
                    <label htmlFor="propDrainPriority">drain priority</label>
                    {box(
                        "drainPriority",
                        {
                            step: 1,
                            title: "Which tanks an engine burns from first: the highest priority it is connected to, then the next once those are dry. Tanks of the same priority drain together. Zero by default.",
                        },
                        (drainPriority) => patch({ drainPriority }),
                    )}
                </Field>
            )}
            {readsFill(spec.kind) && (
                <Field id="fillRow">
                    <label htmlFor="propFill">starts full %</label>
                    {box(
                        "fill",
                        {
                            step: 10,
                            min: 0,
                            max: 100,
                            title: "How full it starts, per cent. A ship sent out part full weighs less, so it costs less of a budget, and has to find the rest from a wreck or a carrier. 100 by default.",
                        },
                        // Full is what a tank is when nothing says otherwise, so it is left unsaid.
                        (percent) => share("fill", percent, 1),
                    )}
                </Field>
            )}
            {readsComputing(spec.kind) && (
                <Field id="computingRow">
                    <label htmlFor="propComputing">computing %</label>
                    {box(
                        "computing",
                        {
                            step: 5,
                            min: 0,
                            max: 100,
                            title: "How much of the core computes rather than holding fuel, metal and charge, per cent. More reaches modules further away; the circle it reaches is drawn round it. A core of 1 m³ or less is all computing. 10 by default.",
                        },
                        (percent) => share("computing", percent, CORE_COMPUTING_SHARE),
                    )}
                </Field>
            )}
            {readsRobotsPerBerth(spec.kind) && (
                <Field id="robotsPerBerthRow">
                    <label htmlFor="propRobotsPerBerth">robots per berth</label>
                    {box(
                        "robotsPerBerth",
                        {
                            step: 0.5,
                            min: 1,
                            title: "How many robots it keeps for each berth while its ship is moored to a rock. The extra work the rock and wait there for a berth to come home to, and are left on it when the ship casts off, for this ship or a friend to take aboard later. 1 by default.",
                        },
                        (value) =>
                            update((placement) => {
                                const { robotsPerBerth: _, ...rest } = placement as ModuleSpec;
                                const per = Math.max(1, value);
                                // One to a berth is what a bay keeps when nothing says otherwise, so it is left unsaid.
                                return (per > 1 ? { ...rest, robotsPerBerth: per } : rest) as Placement;
                            }, true),
                    )}
                </Field>
            )}
            {readsCraft(spec.kind) && (
                <CraftRows editing={editing} spec={spec} library={library} inFleet={inFleet} flag={flag} update={update} />
            )}
            <Field>
                <label htmlFor="propNotes">notes</label>
                <LiveText
                    id="propNotes"
                    multiline
                    placeholder="why this module is here"
                    value={spec.notes ?? ""}
                    onStart={editing.endGesture}
                    onDone={editing.endGesture}
                    onType={(typed) => {
                        const text = typed.trim();
                        update((placement) => {
                            const next = { ...placement };
                            if (text === "") delete next.notes;
                            else next.notes = text;
                            return next;
                        }, true);
                    }}
                />
            </Field>
            <Stats id="moduleStats">
                <Figures>
                    <tbody>
                        {readout.rows.map(([name, value]) => (
                            <tr key={name}>
                                <th>{name}</th>
                                <td>{value}</td>
                            </tr>
                        ))}
                        {readout.gun !== null && (
                            <>
                                <tr>
                                    <th>Gun</th>
                                    <td>
                                        {`${numbers(readout.gun.calibre * 1000, 0)} mm${readout.gun.barrels > 1 ? ` ×${readout.gun.barrels}` : ""}, ` +
                                            `${numbers(readout.gun.roundsPerMinute)} rpm, ${numbers(readout.gun.muzzleSpeed, 0)} m/s, ${numbers(readout.gun.roundMass, 1)} kg shell`}
                                    </td>
                                </tr>
                                {design !== null && readout.gun.roundMass > 0 && design.modules[index]?.spec.kind === spec.kind && (
                                    <tr>
                                        <th>Rounds</th>
                                        <td>{`${numbers(roundsAboard(design, index), 0)} from the metal its piece of hull sets out with, shared with every gun there`}</td>
                                    </tr>
                                )}
                                <tr>
                                    <th>Arc</th>
                                    <td>{`${numbers(readout.gun.arcRight, 0)}°R–${numbers(readout.gun.arcLeft, 0)}°L, trains at ${numbers(readout.gun.traverseRate)} °/s`}</td>
                                </tr>
                                {readout.gun.triggerRange != null && (
                                    <tr>
                                        <th>Fires within</th>
                                        <td>{`${numbers(readout.gun.triggerRange, 0)} m of what its doctrine wants`}</td>
                                    </tr>
                                )}
                            </>
                        )}
                    </tbody>
                </Figures>
            </Stats>
            <DoctrineDetails editing={editing} spec={spec} envelope={envelope} open={doctrineOpen} onOpen={onDoctrineOpen} />
            <Buttons>
                <Button
                    id="propDuplicate"
                    title="Make this a shared part and place a second copy"
                    onClick={() => {
                        if (origin === null) return;
                        const duplicated = duplicatePlacement(doc.blueprint, origin);
                        if (duplicated === null) return;
                        doc.apply(duplicated.blueprint);
                        // The copy just made is selected, not the one it was made from: it is the one about to be put somewhere.
                        doc.select(duplicated.path);
                        const drawn = doc.selectedModules();
                        if (drawn.length > 0) doc.selectModule(drawn[drawn.length - 1]!);
                        editing.endGesture();
                        editing.refresh();
                    }}
                >
                    Duplicate
                </Button>
                <TakeOut id="propTakeOut" editing={editing} path={origin === null ? null : origin.path} what="module" />
                <Button
                    id="propSelectAssembly"
                    disabled={within === null}
                    title={
                        within === null
                            ? "This module is not in an assembly"
                            : "Edit where the assembly sits, how far it is turned, and whether it is mirrored"
                    }
                    onClick={() => {
                        if (within === null) return;
                        // The copy the module was picked in, not whichever the layout drew first.
                        doc.selectAt(doc.selectedModules()[0] ?? 0, within);
                        editing.refresh();
                    }}
                >
                    Select assembly
                </Button>
                <Button id="propDelete" onClick={onDelete}>
                    Delete
                </Button>
            </Buttons>
        </section>
    );
}

/** What a pad or slipway builds, whether it sets out with one, how many it keeps, and which way a slipway lays it. */
function CraftRows({
    editing,
    spec,
    library,
    inFleet,
    flag,
    update,
}: {
    readonly editing: ShipEditing;
    readonly spec: ModuleSpec;
    readonly library: Library<Blueprint>;
    readonly inFleet: DesignInFleet | null;
    readonly flag: (key: "docked" | "buildAnchored", on: boolean) => void;
    readonly update: (change: (placement: Placement) => Placement, continues?: boolean) => void;
}) {
    const { doc } = editing;
    const choices = craftChoices(doc.blueprint, spec.kind, library, inFleet);
    const options = [...choices].map(([name, blueprint]) => {
        // The copy aboard is what flies, so it is what is measured for the pad it is on.
        const own = name === doc.blueprint.name;
        const flown = name === spec.craft && !own ? (doc.blueprint.hangar?.[name] ?? blueprint) : blueprint;
        const design = asCraft(flown, spec.kind);
        // A slipway is turned for a ship that fits only turned, when it is picked.
        const fits =
            design !== null &&
            (spec.kind === "pad"
                ? padHolds(design, spec)
                : [spec.craftAngle ?? 0, 0, PI / 2].some((turn) => slipwayHolds(design, { ...spec, craftAngle: turn })));
        return { name, label: `${name}${own ? " (itself)" : ""}${fits ? "" : spec.kind === "pad" ? " ✗ too big" : " ✗ too wide"}` };
    });
    if (spec.craft !== undefined && !choices.has(spec.craft)) options.push({ name: spec.craft, label: `${spec.craft} ✗ missing` });
    const chosen = options.find((option) => option.name === spec.craft);
    const named = spec.craft !== undefined;
    const turn = spec.craftAngle ?? 0;
    const lies = CRAFT_ANGLES.find(({ degrees }) => abs(degreesToRadians(degrees) - turn) < 1e-9);

    return (
        <>
            <Field id="dockedRow">
                <WarnLabel htmlFor="propDocked" id="propDockedLabel" data-warn={chosen?.label.includes("✗") === true}>
                    {spec.kind === "pad" ? "fighter" : "builds"}
                </WarnLabel>
                <select
                    id="propDocked"
                    title="What this pad or slipway builds. A pad tends a fighter, the one it sets out with and the one it builds, marked ✗ when too big to lie inside it. A slipway builds any other ship, or this one, out of its face, marked ✗ when wider than it the way it lies."
                    value={spec.craft ?? ""}
                    onChange={(event) => {
                        const path = doc.selection;
                        if (path === null) return;
                        const name = event.target.value;
                        editing.change(dockFighter(doc.blueprint, path, name === "" ? null : (choices.get(name) ?? null)));
                    }}
                >
                    <option value="">none</option>
                    {options.map((option) => (
                        <option key={option.name} value={option.name}>
                            {option.label}
                        </option>
                    ))}
                </select>
            </Field>
            {/* Whether it sets out with one, how many it keeps and how it lies mean nothing until it names one. */}
            {named && readsDocked(spec.kind) && (
                <Field id="padDockedRow">
                    <label htmlFor="propPadDocked">sets out docked</label>
                    <input
                        id="propPadDocked"
                        type="checkbox"
                        title="The pad sets out with its fighter docked on it, its tanks topped up from this ship's before it lifts off."
                        checked={spec.docked === true}
                        onChange={(event) => flag("docked", event.target.checked)}
                    />
                </Field>
            )}
            {named && (
                <Field id="buildAnchoredRow">
                    <label htmlFor="propBuildAnchored">builds anchored</label>
                    <input
                        id="propBuildAnchored"
                        type="checkbox"
                        title="Lays down a new craft only while this ship's claw holds something; a slipway works only then, and the claw holds on until what it builds is let go. Off, it builds wherever the ship is."
                        checked={spec.buildAnchored === true}
                        onChange={(event) => flag("buildAnchored", event.target.checked)}
                    />
                </Field>
            )}
            {named && (
                <Field id="keepRow">
                    <label htmlFor="propKeep">keep</label>
                    <LiveNumber
                        id="propKeep"
                        step={1}
                        min={0}
                        title="How many of what it builds it keeps in the fight, counting a fighter a pad sets out with: short of that, it builds another, paid for in this ship's metal and charge, one at a time. None by default."
                        value={moduleField(spec, "keep")}
                        onStart={editing.endGesture}
                        onDone={editing.endGesture}
                        onEdit={(value) => {
                            const keep = Math.max(0, Math.floor(value));
                            // None is what a pad keeps when nothing says otherwise, so it is left unsaid.
                            update((placement) => {
                                const { keep: _, ...rest } = placement as ModuleSpec;
                                return (keep > 0 ? { ...rest, keep } : rest) as Placement;
                            }, true);
                        }}
                    />
                </Field>
            )}
            {named && readsCraftAngle(spec.kind) && (
                <Field id="craftAngleRow">
                    <label htmlFor="propCraftAngle">lies</label>
                    <select
                        id="propCraftAngle"
                        title="Which way the ship it builds lies on it. Bow first builds it out of the face bow leading; side first turns it a quarter, so a ship shorter than it is wide comes out across a slipway as wide as it is long. Picking a ship turns the slipway for you when only a turned ship fits."
                        value={lies?.degrees ?? radiansToDegrees(turn)}
                        onChange={(event) => {
                            const angle = degreesToRadians(Number(event.target.value));
                            update((placement) => {
                                if (!("kind" in placement)) return placement;
                                const { craftAngle: _, ...rest } = placement;
                                return angle === 0 ? rest : { ...rest, craftAngle: angle };
                            });
                        }}
                    >
                        {CRAFT_ANGLES.map(({ degrees, label }) => (
                            <option key={degrees} value={degrees}>
                                {label}
                            </option>
                        ))}
                        {lies === undefined && (
                            <option value={radiansToDegrees(turn)}>{`turned ${radiansToDegrees(turn).toFixed(0)}°`}</option>
                        )}
                    </select>
                </Field>
            )}
        </>
    );
}
