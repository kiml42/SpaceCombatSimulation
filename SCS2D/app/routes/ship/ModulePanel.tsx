import { styled } from "@linaria/react";
import { Fragment, type ReactNode } from "react";
import { kindName } from "~/editor/doctrine";
import {
    dockFighter,
    duplicatePlacement,
    instanceOf,
    mirrorPlacement,
    newestInstance,
    reshapePlacement,
    updatePlacement,
} from "~/editor/edit";
import type { DesignInFleet } from "~/editor/handoff";
import { byCategory, byName, type Library } from "~/editor/library";
import { selectedPosition } from "~/editor/shipCanvas";
import { moduleReadout, roundsAboard, type Envelopes, type ModuleReadout, type ReadoutRow } from "~/editor/stats";
import {
    canShape,
    canThicken,
    countsOutlets,
    CORE_COMPUTING_SHARE,
    CORE_SHARE_DEFAULTS,
    CORE_SHARE_KEYS,
    type CoreShareKey,
    degreesToRadians,
    firesShells,
    isShaped,
    isThick,
    isMagnetic,
    isWeaponMount,
    math,
    MAX_BORE,
    MODULE_KINDS,
    moduleProblem,
    padHolds,
    placementAt,
    radiansToDegrees,
    readsBarrelCalibres,
    readsComputing,
    readsTurning,
    MAX_TURNING,
    TRAVERSE_GEAR_FRACTION,
    readsRobotsPerBerth,
    readsCraft,
    readsCraftAngle,
    readsDocked,
    readsDrainPriority,
    readsPriority,
    defaultPriority,
    readsFill,
    readsFuse,
    readsSealing,
    WARHEAD_DRAIN_PRIORITY,
    SPREAD_PER_FRAGMENT,
    DEFAULT_WARHEAD_FRAGMENTS,
    readsThick,
    readsMagnetic,
    readsReady,
    refitModule,
    shapeModule,
    slipwayHolds,
    wedge,
    type Blueprint,
    type ModuleKind,
    type ModulePath,
    type ModuleSpec,
    type Placement,
    fighterBarred,
} from "~/sim/index";
import { Button } from "~/ui/buttons/Button";
import { LiveNumber, LiveText } from "~/ui/fields/LiveText";
import { TakeOut } from "./AssemblyPanels";
import { DoctrineDetails, type DoctrineOpen } from "./DoctrineDetails";
import { Figures } from "./ShipReport";
import { Buttons, Field } from "./shipLayout";
import { asCraft, craftChoices, CRAFT_ANGLES, MODULE_GROUPS, moduleField, numbers, type ModuleNumberField } from "./shipFields";
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

/** What the setting above works out to, one figure a line, under the box so however long it cannot squeeze it. */
const Under = styled.div`
    margin: -0.15rem 0 0.45rem 6.9rem;
    font-size: var(--font-size-small);

    > div {
        display: flex;
        gap: 0.5rem;
        justify-content: space-between;
        color: var(--colour-muted);
    }

    > div.sub {
        padding-left: 0.8rem;
    }

    span:last-child {
        color: var(--colour-heading);
        white-space: nowrap;
    }
`;

function SettingFigures({ id, rows }: { readonly id: string; readonly rows: readonly ReadoutRow[] }) {
    return (
        <Under id={id}>
            {rows.map((row) => (
                <div key={row.name} className={row.sub === true ? "sub" : undefined} title={row.title}>
                    <span>{row.name.charAt(0).toLowerCase() + row.name.slice(1)}</span>
                    <span>{row.value}</span>
                </div>
            ))}
        </Under>
    );
}

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

const More = styled.details`
    margin-top: 0.4rem;

    > summary {
        color: var(--colour-muted);
        cursor: pointer;
    }
`;

/** One figure a row, its meaning on the whole row, name and value, where the name alone does not say. */
function FigureRows({ rows }: { readonly rows: readonly ReadoutRow[] }) {
    return (
        <Figures>
            <tbody>
                {rows.map((row) => (
                    <tr key={row.name} className={row.sub === true ? "sub" : undefined} title={row.title}>
                        <th>{row.name}</th>
                        <td>{row.value}</td>
                    </tr>
                ))}
            </tbody>
        </Figures>
    );
}

/** A weapon's figures: what it throws, how often and how far it trains, the first few what a weapon is chosen by. */
function weaponRows(gun: ModuleReadout["gun"], rounds: number | null): ReadoutRow[] {
    if (gun === null) return [];
    const out: ReadoutRow[] =
        gun.plasmaReach > 0
            ? [
                  { name: "Pulse power", value: `${numbers(gun.beamPower / 1e6, 1)} MW` },
                  { name: "Reach", value: `${numbers(gun.plasmaReach, 0)} m` },
                  { name: "Rate", value: `${numbers(gun.roundsPerMinute)} /min` },
                  { name: "Energy a pulse", value: `${numbers(gun.shotEnergy / 1e6, 1)} MJ` },
                  { name: "Fuel a pulse", value: `${numbers(gun.shotFuel, 1)} kg` },
                  { name: "Kick", value: `${numbers(gun.jetThrust / 1e3, 0)} kN`, more: true },
              ]
            : [
                  {
                      name: "Calibre",
                      under: "bore",
                      value: `${numbers(gun.calibre * 1000, 0)} mm${gun.barrels > 1 ? ` ×${gun.barrels}` : ""}`,
                  },
                  { name: "Rate", value: `${numbers(gun.roundsPerMinute)} rpm` },
                  ...(gun.muzzleSpeed > 0
                      ? [{ name: "Muzzle speed", under: "barrelCalibres", value: `${numbers(gun.muzzleSpeed, 0)} m/s` }]
                      : []),
                  ...(gun.roundMass > 0 ? [{ name: "Shell", under: "bore", value: `${numbers(gun.roundMass, 1)} kg` }] : []),
                  ...(gun.roundMass > 0 && rounds !== null
                      ? [
                            {
                                name: "Rounds",
                                value: numbers(rounds, 0),
                                title: "From the metal its piece of hull sets out with, shared with every gun there",
                            },
                        ]
                      : []),
                  gun.shotEnergy > 0
                      ? { name: "Energy a shot", value: `${numbers(gun.shotEnergy / 1e6, 1)} MJ`, more: true }
                      : { name: "Fuel a shot", value: `${numbers(gun.shotFuel, 1)} kg`, more: true },
              ];
    out.push({ name: "Arc", under: "traverse", value: `${numbers(gun.arcRight, 0)}°R / ${numbers(gun.arcLeft, 0)}°L` });
    if (gun.triggerRange != null) {
        out.push({ name: "Fires within", value: `${numbers(gun.triggerRange, 0)} m`, title: "Of what its doctrine wants" });
    }
    out.push({ name: "Half turn", value: `${numbers(gun.halfTurn)} s`, more: true, under: "turning" });
    return out;
}

const THICK_TITLE =
    "As deep as it is across, rather than a deck. Stands up into the weapons layer: cover for turrets and in their arcs, and in their reach. A bigger barrel or nozzle, and heavier walls. Structure of any width may be marked, and stands as high as the deepest module it is welded to.";

export interface ModuleFolds {
    readonly settings: boolean;
    readonly figures: boolean;
}

export interface ModulePanelProps {
    readonly editing: ShipEditing;
    readonly spec: ModuleSpec;
    readonly library: Library<Blueprint>;
    readonly inFleet: DesignInFleet | null;
    readonly envelope: Envelopes | null;
    readonly doctrineOpen: DoctrineOpen;
    readonly onDoctrineOpen: (open: DoctrineOpen) => void;
    /** Which of its More sections are open, kept by the page so the next module picked opens as this one was left. */
    readonly folds: ModuleFolds;
    readonly onFolds: (folds: ModuleFolds) => void;
    readonly onDelete: () => void;
}

/** The selected module: its kind, place, size and every setting its kind reads, what it comes to, and its doctrine. */
/** What each of a core's stores is called on the panel, and what it is for, in `CORE_SHARE_KEYS` order. */
const CORE_SHARE_LABELS = ["fuel share", "hold share", "generator share", "battery share"] as const;
const CORE_SHARE_TITLES = [
    "How much of the core's room is fuel.",
    "How much of the core's room is a hold for metal.",
    "How much of the core's room is a generator, up to 2 m³; past that it is fuel.",
    "How much of the core's room is a battery.",
] as const;

export function ModulePanel({
    editing,
    spec,
    library,
    inFleet,
    envelope,
    doctrineOpen,
    onDoctrineOpen,
    folds,
    onFolds,
    onDelete,
}: ModulePanelProps) {
    const { doc } = editing;
    const path = doc.selection;
    const copies = doc.selectedModules().length;
    const fighter = doc.blueprint.fighter === true;
    const step = editing.snapMetres();

    const update = (change: (placement: Placement) => Placement, continues = false): void => {
        if (path === null) return;
        // A half-typed number can make a module that can't be built; it waits for the next key.
        let invalid = false;
        const valid = (placement: Placement): Placement => {
            const next = change(placement);
            invalid ||= "kind" in next && moduleProblem(next) !== null && !("kind" in placement && moduleProblem(placement) !== null);
            return next;
        };
        const blueprint = updatePlacement(doc.blueprint, path, valid);
        if (!invalid) editing.change(blueprint, continues);
    };
    const patch = (fields: Partial<ModuleSpec>): void => update((placement) => ({ ...placement, ...fields }) as Placement, true);
    /** A flag, absent rather than false when it is off, so a file only ever says the unusual thing. */
    const flag = (key: "weapon" | "thick" | "magnetic" | "ready" | "docked" | "buildAnchored", on: boolean): void =>
        update((placement) => {
            if (!("kind" in placement)) return placement;
            const next = { ...placement };
            if (on) next[key] = true;
            else delete next[key];
            return next;
        });
    /** A share, left unsaid when it is the default. */
    const share = (key: "fill" | "computing" | "turning", value: number, fallback: number, least = 0, most = 100): void =>
        update((placement) => {
            const { [key]: _, ...rest } = placement as ModuleSpec;
            const part = Math.min(Math.max(value, least), most) / 100;
            return (part !== fallback ? { ...rest, [key]: part } : rest) as Placement;
        }, true);

    const storeShare = (key: CoreShareKey, value: number | undefined): void =>
        update((placement) => {
            const { [key]: _, ...rest } = placement as ModuleSpec;
            return (value === undefined ? rest : { ...rest, [key]: value }) as Placement;
        }, true);

    const kindOption = (kind: ModuleKind) => (
        <option key={kind} value={kind} disabled={fighter && fighterBarred(kind) !== null}>
            {kindName(kind)}
        </option>
    );

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
            aria-label={`position ${key}`}
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
    const barrels = countsOutlets(spec.kind);
    // Solid shot has no burst to time or to size.
    const shells = firesShells(spec);
    const thickable = canThicken(spec) && !fighter;
    const origin = doc.selectedOrigin();
    const within = origin === null ? null : instanceOf(origin);
    const index = doc.selectedModules()[0] ?? -1;
    const design = doc.view.design;
    // What it builds, where the design it compiled to still lines up with the layout.
    const builds =
        design !== null && design.modules[index]?.spec.kind === spec.kind
            ? (design.builds?.find((b) => b.pad === index)?.design ?? null)
            : null;
    const readout = moduleReadout(spec, doc.view.modules, index, design?.radius ?? 0, builds);
    const rows = [
        ...readout.rows,
        ...weaponRows(readout.gun, design !== null && design.modules[index]?.spec.kind === spec.kind ? roundsAboard(design, index) : null),
    ];
    // A figure goes under the setting that tunes it most directly, where the panel offers that setting; the rest are the
    // module's own, below. Settings are laid out first, so by the time the figures are, it is known which were taken.
    const placed = new Set<string>();
    // Detail stays under More figures wherever it belongs, so a setting shows only what a player looks for there.
    const notes = (key: string) => {
        placed.add(key);
        const own = rows.filter((row) => row.under === key && row.more !== true);
        return own.length === 0 ? null : <SettingFigures id={`${key}Figures`} rows={own} />;
    };
    const general = (): ReadoutRow[] => rows.filter((row) => row.more === true || row.under === undefined || !placed.has(row.under));
    // The copy just made is selected, not the one it was made from, and as its assembly: it is the one about to be put
    // somewhere and turned, and a copy is moved and turned by its assembly.
    const placeCopy = (placed: { blueprint: Blueprint; path: ModulePath } | null): void => {
        if (placed === null) return;
        doc.apply(placed.blueprint);
        const within = instanceOf({ path: placed.path, rotation: 0, mirrored: false, instanceFrame: null });
        const instance = within === null ? null : newestInstance(placed.blueprint, within);
        // Drawn under the new instance: its first module, by which the copy is picked.
        const made =
            instance === null
                ? -1
                : doc.view.origins.findIndex((origin) => instance.every((step, k) => step.index === origin.path[k]?.index));
        if (instance !== null && made >= 0) doc.selectAt(made, instance);
        else {
            doc.select(placed.path);
            const drawn = doc.selectedModules();
            if (drawn.length > 0) doc.selectModule(drawn[drawn.length - 1]!);
        }
        editing.endGesture();
        editing.refresh();
    };

    return (
        <section id="properties">
            <h2>Selected module</h2>
            {copies > 1 && (
                <Linked id="linked">{`Shared: drawn ${copies} times. Changes here change every copy; select the assembly to move or turn this copy.`}</Linked>
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
                    {/* The core alone, then the rest grouped as Add Module groups them. */}
                    {MODULE_KINDS.filter((kind) => !MODULE_GROUPS.some((group) => group.kinds.some((k) => k.kind === kind))).map(
                        kindOption,
                    )}
                    {MODULE_GROUPS.map((group) => (
                        <optgroup key={group.title} label={group.title}>
                            {group.kinds.map((k) => kindOption(k.kind))}
                        </optgroup>
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
            {notes("reinforcement")}
            {barrels && (
                <>
                    <Field id="barrelsRow">
                        <label htmlFor="propBarrels" id="barrelsLabel">
                            {nozzles ? "nozzles" : spec.kind === "beamTurret" ? "emitters" : "barrels"}
                        </label>
                        {box("barrels", { step: 1, min: 1 }, (value) => patch({ barrels: value }))}
                    </Field>
                    {notes("barrels")}
                </>
            )}
            {nozzles && (
                <>
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
                    {notes("nozzle")}
                </>
            )}
            {readsBarrelCalibres(spec.kind) && (
                <>
                    <Field id="boreRow">
                        <label htmlFor="propBore">bore ×</label>
                        {box(
                            "bore",
                            {
                                step: 0.1,
                                min: 0.1,
                                max: MAX_BORE,
                                title: `A multiple of the bore this mount's size gives it, up to ${MAX_BORE}. Wider is a heavier shell, barrel and load: more weight of metal a shot, fewer shots. Several barrels share it.`,
                            },
                            // The archetype's own bore is not a statement, so the file stops carrying one.
                            (bore) =>
                                update((placement) => {
                                    const next = { ...placement } as ModuleSpec;
                                    if (bore === 1) delete next.bore;
                                    else next.bore = bore;
                                    return next as Placement;
                                }, true),
                        )}
                    </Field>
                    {notes("bore")}
                </>
            )}
            {readsBarrelCalibres(spec.kind) && (
                <>
                    <Field id="barrelCalibresRow">
                        <label htmlFor="propBarrelCalibres">{spec.kind === "railGun" ? "barrel extension cal" : "barrel cal"}</label>
                        {box(
                            "barrelCalibres",
                            spec.kind === "railGun"
                                ? {
                                      step: 1,
                                      min: 0,
                                      max: 100,
                                      title: "How far the rails reach out beyond the block, in calibres of the bore; zero keeps them on it. The rails run along the block too, from two calibres in from its back, and the whole run is the barrel: longer is a faster round, with diminishing returns. What reaches beyond the block is braced along its sides and carries the rails, so it is heavier than a powder gun's barrel.",
                                  }
                                : {
                                      step: 1,
                                      min: 1,
                                      max: 100,
                                      title: "How long the barrels are, in calibres of the bore. Longer is a faster shell, with diminishing returns, and costs steel and traverse; on a hull gun it reaches out beyond the block that length and width size. Past 50 calibres a barrel needs bracing, which makes each calibre heavier, and nothing may be longer than 100.",
                                  },
                            (barrelCalibres) => patch({ barrelCalibres }),
                        )}
                    </Field>
                    {notes("barrelCalibres")}
                </>
            )}
            {isWeaponMount(spec.kind) && spec.kind !== "railGun" && spec.kind !== "plasmaLance" && (
                <>
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
                    {notes("traverse")}
                </>
            )}
            {/* Only an engine has a plume to point. */}
            {spec.kind === "engine" && (
                <>
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
                    {notes("weapon")}
                </>
            )}
            {/* An engine is only a weapon once it is marked as one. */}
            {(isWeaponMount(spec.kind) || spec.kind === "warhead" || (spec.kind === "engine" && spec.weapon === true)) && (
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
            {readsMagnetic(spec.kind) && (
                <>
                    <Field id="magneticRow">
                        <label htmlFor="propMagnetic">magnetic nozzle</label>
                        <input
                            id="propMagnetic"
                            type="checkbox"
                            title="A ring at the end of the bell that, powered, holds the jet straight: more thrust and a longer flame from the same fuel, for power drawn as it burns. It takes the end of the bell, so unpowered the engine aims its jet a little worse."
                            checked={isMagnetic(spec)}
                            onChange={(event) => flag("magnetic", event.target.checked)}
                        />
                    </Field>
                    {notes("magnetic")}
                </>
            )}
            {readsThick(spec.kind) && (
                <>
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
                                      ? "A fighter cannot have anything thick."
                                      : spec.kind === "engine"
                                        ? "Too narrow to be thick: each nozzle is no more than a deck wide, so already as deep as it is wide."
                                        : "Too narrow to be thick: no more than a deck across, so already as deep as it is wide."
                            }
                            checked={isThick(spec)}
                            onChange={(event) => flag("thick", event.target.checked)}
                        />
                    </Field>
                    {notes("thick")}
                </>
            )}
            {readsFill(spec.kind) && (
                <>
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
                    {notes("fill")}
                </>
            )}
            {spec.kind === "warhead" && (
                <Shell id="warheadRow">
                    <legend>warhead</legend>
                    <Field>
                        <label htmlFor="propFragments">fragments</label>
                        {box(
                            "fragments",
                            {
                                step: 1,
                                min: 1,
                                max: 64,
                                title: "How many pieces its casing flies out as. One is a single slug, a shaped charge's, which goes through armour; many spray a wider area.",
                            },
                            (fragments) => patch({ fragments }),
                        )}
                    </Field>
                    <Field>
                        <label htmlFor="propSpread">spread °</label>
                        {box(
                            "spread",
                            {
                                step: 5,
                                min: 0,
                                max: 360,
                                disabled: (spec.fragments ?? DEFAULT_WARHEAD_FRAGMENTS) <= 1,
                                title: `How wide it throws them, degrees, centred on its facing. The same again behind it, and lighter, slower fragments between; 180 or more throws them all round. Never narrower than its fragments need, ${radiansToDegrees(SPREAD_PER_FRAGMENT).toFixed(2)}° for each past the first, and none for a single slug, which goes straight ahead.`,
                            },
                            (degrees) => patch({ spread: degreesToRadians(Math.min(Math.max(degrees, 0), 360)) }),
                        )}
                    </Field>
                </Shell>
            )}
            {readsCraft(spec.kind) && (
                <CraftRows
                    editing={editing}
                    spec={spec}
                    library={library}
                    inFleet={inFleet}
                    flag={flag}
                    update={update}
                    keepNotes={notes("keep")}
                />
            )}
            {/* What tunes it rather than what it is: folded away, open or shut as it was left for the last module. */}
            <More id="settingsMore" open={folds.settings} onToggle={(event) => onFolds({ ...folds, settings: event.currentTarget.open })}>
                <summary>More settings</summary>
                {readsTurning(spec.kind) && (
                    <>
                        <Field id="turningRow">
                            <label htmlFor="propTurning">turning gear %</label>
                            {box(
                                "turning",
                                {
                                    step: 5,
                                    min: 1,
                                    max: MAX_TURNING * 100,
                                    title: `How much of the turret is turning gear, the ring and drive that swing it, per cent of the rest of it. More swings it faster and weighs what it is, and takes room from the loading gear, so a gun reloads slower and a beam holds on for less. ${TRAVERSE_GEAR_FRACTION * 100} by default.`,
                                },
                                (percent) => share("turning", percent, TRAVERSE_GEAR_FRACTION, 1, MAX_TURNING * 100),
                            )}
                        </Field>
                        {notes("turning")}
                    </>
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
                {readsReady(spec.kind) && (
                    <Field id="readyRow">
                        <label htmlFor="propReady">keep charged</label>
                        <input
                            id="propReady"
                            type="checkbox"
                            title="Kept charged and ready to fire the moment it bears, leaking a tenth of a pulse's power and fuel a second while it waits. Unticked, it charges only once it is on target, and may lose the target before it is ready."
                            checked={spec.ready === true}
                            onChange={(event) => flag("ready", event.target.checked)}
                        />
                    </Field>
                )}
                {readsSealing(spec.kind) && (
                    <>
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
                        {notes("sealing")}
                    </>
                )}
                {readsPriority(spec.kind) && (
                    <Field id="priorityRow">
                        <label htmlFor="propPriority">priority</label>
                        {box(
                            "priority",
                            {
                                step: 1,
                                title: `How soon this part gets its ship's fuel, metal and charge when there is not enough to go round, and how soon it is mended: a higher number is served in full before a lower one gets any, and parts of the same number split what is left by what each wants. ${defaultPriority(spec.kind)} by default for this kind.`,
                            },
                            (priority) =>
                                update((placement) => {
                                    const { priority: _, ...rest } = placement as ModuleSpec;
                                    const whole = Math.round(priority);
                                    return (whole === defaultPriority(spec.kind) ? rest : { ...rest, priority: whole }) as Placement;
                                }, true),
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
                                title: `Which tanks an engine burns from first: the highest priority it is connected to, then the next once those are dry. Tanks of the same priority drain together, and refuelling fills the lowest first. Zero by default; a warhead's ${WARHEAD_DRAIN_PRIORITY}, so it is burnt last.`,
                            },
                            (drainPriority) => patch({ drainPriority }),
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
                                title: "How much of the core computes rather than holding fuel, metal and charge, per cent. More reaches modules further away; the circle it reaches is drawn round it. A core of 0.5 m³ or less is all computing. 10 by default.",
                            },
                            (percent) => share("computing", percent, CORE_COMPUTING_SHARE),
                        )}
                    </Field>
                )}
                {readsComputing(spec.kind) && (
                    <>
                        <Field id="landingGearRow">
                            <label htmlFor="propLandingGear">landing gear</label>
                            <input
                                id="propLandingGear"
                                type="checkbox"
                                disabled={!fighter}
                                title={
                                    fighter
                                        ? "Whether this core can bring the fighter down onto a friend's pad to be refuelled, rearmed or mended. Without it on any core, the fighter never lands, though it is still built on a pad and launched from one, and the core is simpler to build."
                                        : "Only a fighter lands on a pad."
                                }
                                checked={!fighter || spec.landingGear !== false}
                                onChange={(event) =>
                                    update((placement) => {
                                        const { landingGear: _, ...rest } = placement as ModuleSpec;
                                        // Absent when it has it, so a file only ever says the unusual thing.
                                        return (event.target.checked ? rest : { ...rest, landingGear: false }) as Placement;
                                    })
                                }
                            />
                        </Field>
                        {notes("landingGear")}
                    </>
                )}
                {readsComputing(spec.kind) &&
                    CORE_SHARE_KEYS.map((key, k) => (
                        <Fragment key={key}>
                            <Field id={`${key}Row`}>
                                <label htmlFor={`prop${key[0]!.toUpperCase()}${key.slice(1)}`}>{CORE_SHARE_LABELS[k]}</label>
                                {box(
                                    key,
                                    {
                                        step: 0.05,
                                        min: 0,
                                        disabled: spec[key] === undefined,
                                        title: `${CORE_SHARE_TITLES[k]} A weight against the core's other stores, scaled to fill its room past its computing; 0 leaves it out, and the core is simpler for it. Untick auto to set it.`,
                                    },
                                    (value) => storeShare(key, Math.max(0, value)),
                                )}
                                <label>
                                    <input
                                        type="checkbox"
                                        title="Stepped in by default once the core has room for a useful amount, in order: fuel, then a hold, a generator and a battery."
                                        checked={spec[key] === undefined}
                                        onChange={(event) => storeShare(key, event.target.checked ? undefined : CORE_SHARE_DEFAULTS[k]!)}
                                    />
                                    auto
                                </label>
                            </Field>
                            {notes(key)}
                        </Fragment>
                    ))}
                {readsRobotsPerBerth(spec.kind) && (
                    <>
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
                        {notes("robotsPerBerth")}
                    </>
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
            </More>
            <Stats id="moduleStats">
                <FigureRows rows={general().filter((row) => row.more !== true)} />
                <More id="moduleMore" open={folds.figures} onToggle={(event) => onFolds({ ...folds, figures: event.currentTarget.open })}>
                    <summary>More figures</summary>
                    <FigureRows rows={general().filter((row) => row.more === true)} />
                </More>
            </Stats>
            <DoctrineDetails editing={editing} spec={spec} envelope={envelope} open={doctrineOpen} onOpen={onDoctrineOpen} />
            <Buttons>
                <Button
                    id="propDuplicate"
                    title="Make this a shared part and place a second copy"
                    onClick={() => {
                        if (origin === null) return;
                        placeCopy(duplicatePlacement(doc.blueprint, origin));
                    }}
                >
                    Duplicate
                </Button>
                <Button
                    id="propMirrorCopy"
                    title="Make this a shared part and place a reflected copy on the other side of the centreline"
                    onClick={() => {
                        if (origin === null) return;
                        placeCopy(mirrorPlacement(doc.blueprint, origin));
                    }}
                >
                    Mirror
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
    keepNotes,
}: {
    readonly editing: ShipEditing;
    readonly spec: ModuleSpec;
    readonly library: Library<Blueprint>;
    readonly inFleet: DesignInFleet | null;
    readonly flag: (key: "docked" | "buildAnchored", on: boolean) => void;
    readonly update: (change: (placement: Placement) => Placement, continues?: boolean) => void;
    /** The figures that go under how many it keeps. */
    readonly keepNotes: ReactNode;
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
        return {
            name,
            category: blueprint.category,
            label: `${name}${own ? " (itself)" : ""}${fits ? "" : spec.kind === "pad" ? " ✗ too big" : " ✗ too wide"}`,
        };
    });
    if (spec.craft !== undefined && !choices.has(spec.craft)) {
        options.push({ name: spec.craft, category: undefined, label: `${spec.craft} ✗ missing` });
    }
    options.sort((a, b) => byName(a.name, b.name));
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
                    {byCategory(options, (option) => option.category).map(([category, group]) => (
                        <optgroup key={category} label={category}>
                            {group.map((option) => (
                                <option key={option.name} value={option.name}>
                                    {option.label}
                                </option>
                            ))}
                        </optgroup>
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
            {named && keepNotes}
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
