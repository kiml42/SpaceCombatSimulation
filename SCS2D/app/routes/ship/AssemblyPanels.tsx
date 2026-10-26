import { useState } from "react";
import {
    addToAssembly,
    addToAssemblyProblem,
    countInstances,
    createAssembly,
    createAssemblyProblem,
    dissolveInstance,
    duplicateInstance,
    extentAlong,
    renameAssembly,
    renameProblem,
    setMirror,
    setRepetition,
    snap,
    takeOutCount,
    takeOutOfAssembly,
    updatePlacement,
} from "~/editor/edit";
import { assemblyMass } from "~/editor/stats";
import {
    degreesToRadians,
    MAX_REPEAT,
    placementAt,
    radiansToDegrees,
    type AssemblyInstance,
    type ModulePath,
    type Placement,
} from "~/sim/index";
import { Button } from "~/ui/buttons/Button";
import { LiveNumber, LiveText } from "~/ui/fields/LiveText";
import { Figures } from "./ShipReport";
import { Buttons, Field } from "./shipLayout";
import { isModuleSpec, numbers } from "./shipFields";
import type { ShipEditing } from "./shipEditing";

/** A Take out button for what `path` names, saying what it would leave. */
export function TakeOut({
    id,
    editing,
    path,
    what,
}: {
    readonly id: string;
    readonly editing: ShipEditing;
    readonly path: ModulePath | null;
    readonly what: string;
}) {
    const { doc } = editing;
    const leaving = path === null ? 0 : takeOutCount(doc.blueprint, path);
    return (
        <Button
            id={id}
            disabled={leaving === 0}
            title={
                leaving === 0
                    ? `This ${what} is not inside an assembly`
                    : leaving === 1
                      ? `Take this ${what} out of its assembly, leaving it where it is`
                      : `Take this ${what} out of its assembly, leaving a separate one beside each of its ${leaving} copies`
            }
            onClick={() => {
                if (path === null) return;
                const taken = takeOutOfAssembly(doc.blueprint, path);
                if (taken === null) return;
                doc.apply(taken.blueprint);
                // The loose copy it leaves stays picked.
                doc.select(taken.path);
                editing.refresh();
            }}
        >
            Take out
        </Button>
    );
}

/**
 * What can be done with several things picked at once: make an assembly of
 * them, or put the rest of them into the last assembly picked. Both are
 * offered whenever both are possible, and the panel says what each would do,
 * or why it cannot.
 */
export function SeveralSelected({ editing }: { readonly editing: ShipEditing }) {
    const { doc } = editing;
    const picked = doc.selections.length;
    const why = createAssemblyProblem(doc.blueprint, doc.selections);
    const adding = doc.additionTarget();
    const into = adding === null ? null : placementAt(doc.blueprint, adding.assembly);
    const name = into !== null && !isModuleSpec(into) ? (into as AssemblyInstance).use : null;
    const addWhy =
        adding === null
            ? "Pick an assembly to add the rest of the selection to"
            : addToAssemblyProblem(doc.blueprint, adding.assembly, adding.members);
    const lines = [why === null ? `${picked} picked. Create assembly makes them one part, built around the first one picked.` : why];
    if (adding !== null && addWhy === null && name !== null) {
        // Said out loud because it is the bargain rather than a surprise: what
        // goes in joins every copy of the assembly, so the ship gains it per copy.
        const spread = countInstances(doc.blueprint, name) > 1 ? " It is placed more than once, and every copy gains them." : "";
        lines.push(`Add to ${name} moves the other ${adding.members.length} into it.${spread}`);
    }
    return (
        <section id="assemblySelection">
            <h2>Several selected</h2>
            <p id="assemblyCount">{lines.join(" ")}</p>
            <Buttons>
                <Button
                    id="propAssembly"
                    title="Make these one part, placed once, built around the first one picked"
                    disabled={why !== null}
                    onClick={() => {
                        const assembled = createAssembly(doc.blueprint, doc.selections);
                        if (assembled === null) return;
                        doc.apply(assembled.blueprint);
                        // Selected straight away: the next thing done with a new assembly is to place it again or mirror it.
                        doc.select(assembled.path);
                        editing.refresh();
                    }}
                >
                    Create assembly
                </Button>
                <Button
                    id="propAddToAssembly"
                    title={addWhy ?? `Move the rest of the selection into ${name}`}
                    disabled={adding === null || addWhy !== null}
                    onClick={() => {
                        if (adding === null) return;
                        const next = addToAssembly(doc.blueprint, adding.assembly, adding.members);
                        if (next === null) return;
                        doc.apply(next.blueprint);
                        // Its own path, not the one picked: taking the modules out moved it up the list.
                        doc.select(next.path);
                        editing.refresh();
                    }}
                >
                    {name === null ? "Add to assembly" : `Add to ${name}`}
                </Button>
            </Buttons>
        </section>
    );
}

/**
 * A placed assembly: where it sits, how far it is turned, which way round, and
 * how it repeats.
 *
 * Separate from the module panel because it edits a different thing. A module
 * has a size and a kind; an instance has only a pose, and the whole reason it
 * is worth reaching is `mirror` — the flag that makes a second copy of a wing
 * the other wing rather than the same one again.
 */
export function AssemblyPanel({
    editing,
    instance,
    onDelete,
}: {
    readonly editing: ShipEditing;
    readonly instance: AssemblyInstance;
    readonly onDelete: () => void;
}) {
    const { doc } = editing;
    // A name being typed that cannot be used yet: the panel says why, and the assembly keeps the one it has.
    const [refused, setRefused] = useState<string | null>(null);
    const path = doc.selection;
    const members = doc.blueprint.assemblies?.[instance.use]?.modules ?? [];
    const nested = members.filter((member) => !isModuleSpec(member)).length;
    const modules = members.length - nested;
    const drawn = path === null ? 0 : doc.accountedFor(path);
    const counted = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    const parts = [
        ...(modules > 0 || nested === 0 ? [counted(modules, "module", "modules")] : []),
        ...(nested > 0 ? [counted(nested, "assembly", "assemblies")] : []),
    ];
    const copies = instance.repeat ?? 1;

    const editInstance = (patch: Partial<AssemblyInstance>, continues: boolean): void => {
        if (path === null) return;
        editing.change(
            updatePlacement(doc.blueprint, path, (placement) => ({ ...placement, ...patch }) as Placement),
            continues,
        );
    };
    /**
     * The step for an assembly repeated for the first time: its own length along
     * the row, snapped to the grid a drag moves on, so the second copy lands
     * beyond the first rather than on it.
     */
    const stepClear = (): { x: number; y: number; angle?: number } => {
        const outline = doc.selectedAssemblies().find((assembly) => assembly.primary);
        const specs = (outline?.modules ?? []).map((index) => doc.view.modules[index]!);
        const rotation = doc.selectedOrigin()?.rotation ?? 0;
        const along = specs.length === 0 ? 0 : extentAlong(specs, rotation);
        const step = editing.snapMetres();
        return { x: Math.max(step, snap(along, step)), y: 0 };
    };
    const step = instance.step ?? stepClear();
    const box = (id: string, value: number, boxStep: number, apply: (value: number) => void) => (
        <LiveNumber id={id} value={value} step={boxStep} onEdit={apply} onStart={editing.endGesture} onDone={editing.endGesture} />
    );

    // What an assembly weighs, the one figure that sums from modules: each copy, and all of them.
    const outlines = doc.selectedAssemblies().filter((assembly) => !assembly.context);
    const own = outlines.find((assembly) => assembly.primary) ?? outlines[0];

    return (
        <section id="assemblyPanel">
            <h2>Selected assembly</h2>
            <p id="assemblyOf">{refused ?? parts.join(" and ") + (drawn > members.length ? `, and this copy draws ${drawn}` : "")}</p>
            <Field>
                <label htmlFor="assemblyName">name</label>
                <LiveText
                    id="assemblyName"
                    value={instance.use}
                    onStart={editing.endGesture}
                    onDone={() => {
                        setRefused(null);
                        editing.endGesture();
                    }}
                    onType={(typed) => {
                        if (path === null) return;
                        const why = renameProblem(doc.blueprint, path, typed);
                        setRefused(why);
                        if (why === null) editing.change(renameAssembly(doc.blueprint, path, typed), true);
                    }}
                />
            </Field>
            <Field>
                <label htmlFor="assemblyX">position</label>
                {box("assemblyX", instance.x, 0.5, (x) => editInstance({ x }, true))}
                {box("assemblyY", instance.y, 0.5, (y) => editInstance({ y }, true))}
            </Field>
            <Field>
                <label htmlFor="assemblyAngle">facing °</label>
                {box("assemblyAngle", radiansToDegrees(instance.angle ?? 0), 15, (degrees) =>
                    editInstance({ angle: degreesToRadians(degrees) }, true),
                )}
            </Field>
            <Field>
                <label htmlFor="assemblyMirror">mirrored</label>
                <input
                    id="assemblyMirror"
                    type="checkbox"
                    checked={instance.mirror === true}
                    onChange={(event) => path !== null && editing.change(setMirror(doc.blueprint, path, event.target.checked))}
                />
            </Field>
            <Field>
                <label htmlFor="assemblyRepeat">copies</label>
                <LiveNumber
                    id="assemblyRepeat"
                    value={copies}
                    step={1}
                    min={1}
                    max={MAX_REPEAT}
                    onStart={editing.endGesture}
                    onDone={editing.endGesture}
                    onEdit={(value) => {
                        if (path === null) return;
                        const repeat = Math.max(1, Math.min(MAX_REPEAT, Math.round(value)));
                        editing.change(setRepetition(doc.blueprint, path, repeat, step), true);
                    }}
                />
            </Field>
            {/* A step with one copy places nothing: the count turns an assembly into a row, and the step is what the row is made of. */}
            {copies > 1 && (
                <>
                    <Field id="assemblyStepRow">
                        <label htmlFor="assemblyStepX">step m</label>
                        {box(
                            "assemblyStepX",
                            step.x,
                            0.5,
                            (x) => path !== null && editing.change(setRepetition(doc.blueprint, path, copies, { ...step, x }), true),
                        )}
                        {box(
                            "assemblyStepY",
                            step.y,
                            0.5,
                            (y) => path !== null && editing.change(setRepetition(doc.blueprint, path, copies, { ...step, y }), true),
                        )}
                    </Field>
                    <Field id="assemblyStepAngleRow">
                        <label htmlFor="assemblyStepAngle">step turn °</label>
                        {box(
                            "assemblyStepAngle",
                            radiansToDegrees(step.angle ?? 0),
                            15,
                            (degrees) =>
                                path !== null &&
                                editing.change(
                                    setRepetition(doc.blueprint, path, copies, { ...step, angle: degreesToRadians(degrees) }),
                                    true,
                                ),
                        )}
                    </Field>
                </>
            )}
            <div id="assemblyStats">
                {own !== undefined && (
                    <Figures>
                        <tbody>
                            <tr>
                                <th>Mass</th>
                                <td>{`${numbers(assemblyMass(doc.view.modules, own.modules) / 1000, 2)} t`}</td>
                            </tr>
                            {outlines.length > 1 && (
                                <tr>
                                    <th>{`All ${outlines.length} copies`}</th>
                                    <td>{`${numbers(
                                        assemblyMass(
                                            doc.view.modules,
                                            outlines.flatMap((each) => each.modules),
                                        ) / 1000,
                                        2,
                                    )} t`}</td>
                                </tr>
                            )}
                        </tbody>
                    </Figures>
                )}
            </div>
            <Buttons>
                <Button
                    id="assemblyDuplicate"
                    title="Place this assembly again"
                    onClick={() => {
                        if (path === null) return;
                        const placed = duplicateInstance(doc.blueprint, path);
                        if (placed === null) return;
                        doc.apply(placed.blueprint);
                        // The new copy is selected: it is the one about to be mirrored or dragged.
                        doc.select(placed.path);
                        editing.refresh();
                    }}
                >
                    Duplicate
                </Button>
                <TakeOut id="assemblyTakeOut" editing={editing} path={path} what="assembly" />
                <Button
                    id="assemblyDissolve"
                    title="Replace this copy with the modules and assemblies it is made of; other copies stay linked"
                    onClick={() => {
                        if (path === null) return;
                        const dissolved = dissolveInstance(doc.blueprint, path);
                        if (dissolved === null) return;
                        doc.apply(dissolved.blueprint);
                        // What it was made of stays picked, ready to be assembled differently.
                        doc.select(dissolved.paths[0] ?? null);
                        for (const each of dissolved.paths.slice(1)) doc.togglePath(each);
                        editing.refresh();
                    }}
                >
                    Dissolve
                </Button>
                <Button id="assemblyDelete" onClick={onDelete}>
                    Delete
                </Button>
            </Buttons>
        </section>
    );
}
