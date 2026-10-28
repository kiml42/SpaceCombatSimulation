import {
    inReachDesign,
    isInstance,
    math,
    placementAt,
    samePlacement,
    Snapshot,
    type AssemblyInstance,
    type Blueprint,
    type ModuleOrigin,
    type ModulePath,
    type ModuleSpec,
} from "../sim/index.js";
import { ARCS_KEY, draw, nextArcs, type Arcs } from "../render/canvas2d.js";
import { easeScale, fitScale, frame, snapStep, type Camera } from "../render/camera.js";
import type { EditorDocument } from "./document.js";
import {
    instanceHandle,
    instancePose,
    moduleAt,
    movePlacement,
    positionHandle,
    reshapePlacement,
    resizePlacement,
    snap,
    toPlacementAngle,
    updatePlacement,
    type InstancePose,
} from "./edit.js";
import { Demonstration } from "./demonstrate.js";
import { drawOverlay, envelopeBearingAt, overEnvelope } from "./overlay.js";
import {
    assemblyKnob,
    barrelCalibresTo,
    centreLineAxes,
    facingTo,
    handleAt,
    handlesFor,
    nozzleTo,
    resizedTo,
    seamBetween,
    seamTo,
    vertexTo,
    type Handle,
    type Seam,
} from "./handles.js";
import {
    alignment,
    cornersOf,
    drawnAngles,
    landing,
    landOrGrid,
    offsetBy,
    snapField,
    SNAP_WITHIN_PIXELS,
    tidyMetres,
    type SnapField,
} from "./snapping.js";
import { landOnSelf, lightSelfBurning, previewSnapshot } from "./preview.js";
import { envelopes, holdingThrottles, type Envelopes } from "./stats.js";

/**
 * The ship drawn, and the pointer and keys on it: select, move, size, shape
 * and turn modules and assemblies, pan, zoom, undo, and the engines and guns
 * of what is selected shown working. The panels round it are the page's; this
 * tells it when the ship, the selection or the zoom has changed under it.
 */

const { max } = math;

/** How much of the way a refit to another ship closes on its scale each frame. */
const FIT_EASE = 0.15;

/**
 * Rotation snap, degrees.
 *
 * Fixed where the position grid is not, because a right angle is a right angle
 * on any size of ship: an angle has no scale for the zoom to tell us about.
 */
export const ANGLE_SNAP_DEGREES = 15;

/** Where the selected copy's position is written, and in what frame. */
export function selectedPosition(doc: EditorDocument): ReturnType<typeof positionHandle> | null {
    // A selected assembly is dragged as one thing, which is the point of having
    // selected the assembly rather than a part of it.
    const assembly = doc.selectedAssemblyPath();
    if (assembly !== null) {
        const handle = instanceHandle(doc.view.origins, assembly);
        return handle === null ? null : { origin: handle, perCopy: true };
    }
    const origin = doc.selectedOrigin();
    return origin === null ? null : positionHandle(doc.blueprint, origin);
}

export interface ShipCanvas {
    readonly camera: Camera;
    /** The firing arcs drawn. The editor is where a mount's arcs are decided, so it starts showing them all. */
    readonly arcs: Arcs;
    /** Whether a refit's built and taken-down modules are marked. */
    readonly showRefit: boolean;
    /**
     * The grid an edit snaps to, metres: a tenth of the grid on screen, so it
     * always suits the ship being looked at rather than the ship the constant
     * was picked for.
     */
    snapMetres(): number;
    /** The ship's thrust envelope, measured once per layout rather than per frame. */
    envelope(): Envelopes | null;
    /** The part of the ship's frame in view, metres. */
    visible(): { x: number; y: number; width: number; height: number };
    /** The ship or the selection changed outside: draw it, and show what is selected working. */
    changed(): void;
    /** Frame the ship at once, at the next draw. */
    fit(): void;
    /** Another ship opened: ease from this one's scale to its, so switching shows which is bigger. */
    easeToNext(): void;
    cycleArcs(): void;
    toggleRefit(): void;
    dispose(): void;
}

export interface ShipCanvasHooks {
    /** After the canvas changed the ship or the selection. */
    changed(): void;
    /** The edit being made has ended, so the next is an undo step of its own. */
    gestureEnded(): void;
    /** Delete or Backspace, with something selected. */
    deleteSelected(): void;
    /** The scale changed, which sets how far a box's arrows step. */
    zoomed?(): void;
    /** The arcs or the refit marks were changed by a key. */
    viewChanged?(): void;
}

type Pair = {
    a: { spec: ModuleSpec; origin: ModuleOrigin };
    b: { spec: ModuleSpec; origin: ModuleOrigin };
    seam: Seam;
};

type Drag =
    | {
          kind: "pan";
          x: number;
          y: number;
          /** Whether releasing without having panned clears the selection. */
          deselect: boolean;
      }
    | {
          kind: "module";
          from: Blueprint;
          startX: number;
          startY: number;
          /**
           * The corners of everything the drag is carrying, where they were when
           * it took hold. Read once rather than per move: the layout under the
           * pointer is the moved one, so corners taken from it and offset again
           * would count the drag twice.
           */
          corners: readonly number[];
          moved: boolean;
          /** The module pressed on, and whether releasing without a drag goes in a level. */
          hit: number;
          drill: boolean;
      }
    | {
          /** The knob on a selected assembly, dragged to turn it about its origin. */
          kind: "turn";
          from: Blueprint;
          path: ModulePath;
          pose: InstancePose;
          moved: boolean;
      }
    | {
          /** The face two selected modules share, moved to size both. */
          kind: "seam";
          from: Blueprint;
          pair: Pair;
          moved: boolean;
      }
    | {
          /**
           * A corner or edge is dragged to size the module, one of a shaped
           * module's own corners to move that corner alone, the knob to turn it,
           * the split to share its length between block and bell or barrel.
           */
          kind: "size" | "vertex" | "rotate" | "tip";
          from: Blueprint;
          /** The handle grabbed, which says which faces, or which corner, move. */
          handle: Handle;
          /**
           * The module as it was drawn when the handle was grabbed.
           *
           * Held rather than re-read, because it is the frame every position the
           * pointer reaches is measured in — and re-reading it mid-drag would
           * measure against a module the drag itself has just changed.
           */
          spec: ModuleSpec;
          moved: boolean;
      };

export function shipCanvas(canvas: HTMLCanvasElement, doc: EditorDocument, hooks: ShipCanvasHooks): ShipCanvas {
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("no 2d context");
    const camera: Camera = { x: 0, y: 0, scale: 8 };
    const snapMetres = (): number => snapStep(camera.scale);
    /**
     * How far from a corner, an edge or a drawn angle a drag lands on it, in
     * metres: a fixed distance on screen, so it is a reach of the hand rather
     * than a distance on the ship, whatever the zoom. Alt passes 0, which is no
     * snapping at all.
     */
    const snapWithin = (event: { altKey: boolean }): number => (event.altKey ? 0 : SNAP_WITHIN_PIXELS / camera.scale);
    /**
     * What the drag may land on: everything the selection is not carrying.
     *
     * Rebuilt per move rather than held for the drag, since an edit mid-drag —
     * a resize pushing its neighbours along — moves the targets as it goes.
     */
    const fieldNow = (): SnapField => snapField(doc.view.modules, (i) => doc.covers(i));
    /** The angles the rest of the design is drawn at, which a facing may land on. */
    const anglesNow = (): number[] => drawnAngles(doc.view.modules, (i) => doc.covers(i));
    const snapshot = new Snapshot();
    const demonstration = new Demonstration();
    let fitPending = true;
    let arcs: Arcs = "trigger";
    let showRefit = true;
    let easeFit = false;
    /** Wall time of the last animated frame, or 0 when nothing is animating. */
    let lastFrame = 0;
    let frameRequested = false;
    let disposed = false;
    // Measured when the layout changes, not when the view moves. The holding
    // curve costs thousands of allocations; panning must not pay for them.
    let measured: unknown = undefined;
    let measuredEnvelope: Envelopes | null = null;
    const envelope = (): Envelopes | null => {
        const design = doc.view.design;
        if (design !== measured) {
            measured = design;
            measuredEnvelope = design === null ? null : envelopes(inReachDesign(design));
        }
        return measuredEnvelope;
    };

    const resize = (): void => {
        const ratio = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = max(1, Math.round(rect.width * ratio));
        canvas.height = max(1, Math.round(rect.height * ratio));
    };

    /**
     * Two selected modules that share a face, and the seam between them — or
     * null. Each is the exact copy picked, and two copies of one shared part are
     * not offered, since sizing one sizes the other.
     */
    const seamPair = (): Pair | null => {
        if (doc.selections.length !== 2) return null;
        const [first, second] = doc.selections as [ModulePath, ModulePath];
        if (samePlacement(first, second)) return null;
        const picked = (path: ModulePath) => {
            const placement = placementAt(doc.blueprint, path);
            if (placement === null || isInstance(placement)) return null;
            const key = JSON.stringify(path);
            const drawn = doc.view.origins.findIndex((o) => JSON.stringify(o.path) === key);
            if (drawn < 0) return null;
            return { spec: doc.view.modules[drawn]!, origin: doc.view.origins[drawn]! };
        };
        const a = picked(first);
        const b = picked(second);
        if (a === null || b === null) return null;
        const seam = seamBetween(a.spec, b.spec);
        return seam === null ? null : { a, b, seam };
    };

    /** The selected assembly's pose, in the copy that was picked, and the modules it draws there. */
    const selectedAssemblyPose = (): { path: ModulePath; pose: InstancePose; modules: ModuleSpec[] } | null => {
        const path = doc.selectedAssemblyPath();
        if (path === null) return null;
        // The outlines are of every placement of the assembly; the ones that are
        // this instance's are those whose modules it accounts for.
        const under = (drawn: number) => {
            const at = doc.view.origins[drawn]?.path;
            return at !== undefined && path.every((step, k) => step.index === at[k]?.index && step.copy === at[k]?.copy);
        };
        const own = doc.selectedAssemblies().filter((each) => !each.context && under(each.modules[0]!));
        const outline = own.find((each) => each.primary) ?? own[0];
        const near = outline === undefined ? null : doc.view.origins[outline.modules[0]!]!.path;
        const pose = instancePose(doc.blueprint, path, near);
        if (pose === null) return null;
        return { path, pose, modules: (outline?.modules ?? []).map((i) => doc.view.modules[i]!) };
    };

    /**
     * The grab points on the selection, or none.
     *
     * Only for a single module: an assembly has no size, and several modules picked
     * at once have no one box to size or turn. The copy they sit on is the one
     * under the pointer, which is the copy the highlight draws brightest and the
     * one a drag would move.
     */
    const currentHandles = (): Handle[] => {
        const seam = seamPair();
        if (seam !== null) return [seam.seam.handle];
        if (doc.selections.length !== 1) return [];
        const assembly = selectedAssemblyPose();
        if (assembly !== null) return [assemblyKnob(assembly.pose, assembly.modules, camera.scale)];
        const drawn = doc.selectedLoose()[0];
        if (drawn === undefined) return [];
        const spec = doc.view.modules[drawn];
        return spec === undefined ? [] : handlesFor(spec, camera.scale);
    };

    /** The bearing on the envelope the pointer is over, radians from the bow, or null. */
    let thrustBearing: number | null = null;
    /** Whether the pointer is over the thrust rosette, which is drawn larger while it is. */
    let thrustExpanded = false;

    const render = (): void => {
        if (disposed) return;
        const view = doc.view;
        const scale = camera.scale;
        if (view.design !== null) {
            previewSnapshot(view.design, snapshot);
            if (fitPending) {
                // Measured now, as the page round it may have changed its size since.
                resize();
                // Snap rather than ease: a layout being fitted has no motion to follow.
                frame(camera, snapshot, canvas.width, canvas.height, 1);
                fitPending = false;
                easeFit = false;
            } else if (easeFit) {
                const want = fitScale(snapshot, canvas.width, canvas.height);
                camera.x = (snapshot.minX + snapshot.maxX) / 2;
                camera.y = (snapshot.minY + snapshot.maxY) / 2;
                camera.scale = easeScale(camera.scale, want, FIT_EASE);
                easeFit = camera.scale !== want;
                if (easeFit) requestFrame();
            }
        } else {
            snapshot.shipCount = 0;
        }
        if (view.design !== null) demonstration.writeInto(snapshot);
        if (view.design !== null && snapshot.ships[0] !== undefined) lightSelfBurning(snapshot.ships[0]);
        // Pointing at the envelope burns the engines the way the ship would to
        // push that way without turning, on top of whatever is selected.
        const shown = snapshot.ships[0];
        if (thrustBearing !== null && view.design !== null && shown !== undefined) {
            const burning = holdingThrottles(view.design, thrustBearing);
            for (let t = 0; t < shown.throttles.length; t++) {
                shown.throttles[t] = Math.max(shown.throttles[t] ?? 0, burning[t] ?? 0);
            }
        }
        if (shown !== undefined && view.design !== null) landOnSelf(shown);
        draw(ctx, snapshot, camera, canvas.width, canvas.height, demonstration.flashes, arcs);
        drawOverlay(
            ctx,
            {
                design: view.design,
                modules: view.modules,
                selected: doc.selectedLoose(),
                assemblies: doc.selectedAssemblies(),
                faulty: view.faulty,
                refitBuilt: showRefit ? (doc.refit?.built ?? []) : [],
                refitDown: showRefit ? (doc.refit?.takenDown ?? []) : [],
                handles: currentHandles(),
                envelope: envelope(),
                envelopeBearing: thrustBearing,
                envelopeExpanded: thrustExpanded,
            },
            camera,
            canvas.width,
            canvas.height,
        );
        if (camera.scale !== scale) hooks.zoomed?.();
    };

    /**
     * Animate for as long as there is something to animate.
     *
     * Frames are asked for only while an engine is spooling or a round is in the
     * air, so a still picture costs nothing. There is no fixed step and nothing
     * to reproduce: this is a picture of a module, not a state of the world.
     */
    const animate = (now: number): void => {
        frameRequested = false;
        if (disposed) return;
        const design = doc.view.design;
        if (design === null) {
            lastFrame = 0;
            return;
        }
        const dt = lastFrame === 0 ? 0 : Math.min((now - lastFrame) / 1000, 0.1);
        lastFrame = now;
        demonstration.step(design, doc.selectedModules(), dt);
        render();
        if (demonstration.running) requestFrame();
        else lastFrame = 0;
    };

    function requestFrame(): void {
        if (frameRequested || disposed) return;
        frameRequested = true;
        window.requestAnimationFrame(animate);
    }

    /** Draw, and ask for frames again: a newly selected engine or gun has something to show, and a deselected one a plume to wind down. */
    const redraw = (): void => {
        render();
        requestFrame();
    };
    const changed = (): void => {
        hooks.changed();
        redraw();
    };

    const worldAt = (event: PointerEvent | WheelEvent): { x: number; y: number } => {
        const rect = canvas.getBoundingClientRect();
        const px = ((event.clientX - rect.left) * canvas.width) / rect.width - canvas.width / 2;
        const py = ((event.clientY - rect.top) * canvas.height) / rect.height - canvas.height / 2;
        return { x: camera.x + px / camera.scale, y: camera.y - py / camera.scale };
    };

    let drag: Drag | null = null;

    const sizes = (r: ReturnType<typeof resizedTo>): [number, number, number, number] => [r.length, r.width, r.dx, r.dy];

    /**
     * Size or turn the selected module to wherever the pointer is.
     *
     * Written through the same `updatePlacement` the panel's boxes use, so a
     * module sized by dragging and one sized by typing are the same edit — and a
     * shared part's size and facing change every copy, exactly as the panel says
     * they do. A resize also moves the module within its assembly so the
     * opposite face stays put, so every copy moves the same way — mirrored where
     * the copy is.
     * The facing has to be converted on the way in: what the pointer names is a
     * direction on screen, and a module inside a turned or mirrored assembly is
     * written in another frame.
     */
    const dragHandle = (event: PointerEvent): void => {
        if (drag === null || drag.kind === "pan" || drag.kind === "module") return;
        if (drag.kind === "turn") {
            const world = worldAt(event);
            const { pose } = drag;
            // The bearing the assembly's +x should take on screen, then the angle
            // that gives it written in the frame the instance is placed in.
            const bearing = facingTo(
                { kind: "structure", x: pose.x, y: pose.y, length: 0, width: 0 },
                world.x,
                world.y,
                event.altKey ? 0 : ANGLE_SNAP_DEGREES,
                anglesNow(),
            );
            const origin: ModuleOrigin = { path: drag.path, ...pose.written, instanceFrame: null };
            const angle = toPlacementAngle(origin, bearing);
            const next = updatePlacement(drag.from, drag.path, (p) => {
                const turned = { ...p } as AssemblyInstance;
                if (angle === 0) delete turned.angle;
                else turned.angle = angle;
                return turned;
            });
            if (next === null) return;
            if (drag.moved) doc.amend(next);
            else doc.apply(next);
            drag = { ...drag, moved: true };
            changed();
            return;
        }
        if (drag.kind === "seam") {
            const { a, b, seam } = drag.pair;
            const world = worldAt(event);
            const moved = seamTo(a.spec, b.spec, seam, world.x, world.y, event.altKey ? 0 : snapMetres());
            const one = resizePlacement(drag.from, a.origin, ...sizes(moved.a), false);
            const both = one === null ? null : resizePlacement(one, b.origin, ...sizes(moved.b), false);
            if (both === null) return;
            if (drag.moved) doc.amend(both);
            else doc.apply(both);
            drag = { ...drag, moved: true };
            changed();
            return;
        }
        const path = doc.selection;
        const origin = doc.selectedOrigin();
        if (path === null || origin === null) return;
        const world = worldAt(event);
        let next: Blueprint | null;
        if (drag.kind === "tip") {
            if (drag.spec.kind === "hullGun") {
                const barrelCalibres = barrelCalibresTo(drag.spec, world.x, world.y, event.altKey);
                next = updatePlacement(drag.from, path, (p) => ({ ...p, barrelCalibres }));
            } else {
                const nozzle = nozzleTo(drag.spec, world.x, world.y, event.altKey ? 0 : snapMetres());
                next = updatePlacement(drag.from, path, (p) => ({ ...p, nozzle }));
            }
        } else if (drag.kind === "vertex") {
            // One corner to wherever the pointer is, the other two left alone. No
            // neighbour is pushed: a corner moves two edges at once and neither of
            // them squarely, so there is no face to carry one by.
            const point = landOrGrid(fieldNow(), world.x, world.y, snapWithin(event), event.altKey ? 0 : snapMetres());
            const moved = vertexTo(drag.spec, drag.handle.vertex ?? -1, point.x, point.y, 0);
            // A corner dragged onto the line between the other two is no module at
            // all, so the drag simply stops there rather than refusing the shape.
            if (moved === null) return;
            next = reshapePlacement(drag.from, origin, moved.vertices, moved.dx, moved.dy);
        } else if (drag.kind === "size") {
            const step = event.altKey ? 0 : snapMetres();
            // A face landed against a neighbour is sized by where that neighbour is,
            // so it keeps the grid only while it is near nothing.
            const landed = landing(fieldNow(), world.x, world.y, snapWithin(event));
            const point = landed ?? world;
            // Neighbours move with the face unless Ctrl (⌘) asks for this module alone.
            const alone = event.ctrlKey || event.metaKey;
            // Shift sizes about the middle, keeping it where it was; a module on the
            // centre line is sized about it across the line, to stay on it, unless
            // Ctrl holds the opposite face where it is.
            const { length, width, dx, dy } = resizedTo(
                drag.spec,
                drag.handle,
                point.x,
                point.y,
                landed === null ? step : 0,
                event.shiftKey || (!alone && centreLineAxes(drag.spec)),
            );
            const push = !alone;
            next = resizePlacement(drag.from, origin, length, width, dx, dy, push);
        } else {
            const angle = toPlacementAngle(
                origin,
                facingTo(drag.spec, world.x, world.y, event.altKey ? 0 : ANGLE_SNAP_DEGREES, anglesNow()),
            );
            next = updatePlacement(drag.from, path, (p) => ({ ...p, angle }));
        }
        if (next === null) return;
        if (drag.moved) doc.amend(next);
        else doc.apply(next);
        drag = { ...drag, moved: true };
        changed();
    };

    const pointerDown = (event: PointerEvent): void => {
        // A canvas is not focusable, so clicking it does not move focus off a
        // properties box on its own. Leaving focus there would keep that box out
        // of every refresh, and would swallow Delete, Escape and F, which are all
        // held back while something is being typed into.
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        const world = worldAt(event);
        canvas.setPointerCapture(event.pointerId);
        // The selection's own handles are tested before the layout under them: a
        // corner handle sits on the module's corner, and often over the neighbour
        // it abuts, so whichever is on top would otherwise decide whether a
        // resize or a drag of something else began.
        const handles = currentHandles();
        const grabbed = event.button === 1 ? -1 : handleAt(handles, world.x, world.y, camera.scale);
        const pair = seamPair();
        if (grabbed >= 0 && pair !== null) {
            hooks.gestureEnded();
            drag = { kind: "seam", from: doc.blueprint, pair, moved: false };
            return;
        }
        const assembly = grabbed >= 0 ? selectedAssemblyPose() : null;
        if (assembly !== null) {
            hooks.gestureEnded();
            drag = { kind: "turn", from: doc.blueprint, path: assembly.path, pose: assembly.pose, moved: false };
            return;
        }
        const spec = doc.view.modules[doc.selectedLoose()[0] ?? -1];
        if (grabbed >= 0 && spec !== undefined) {
            hooks.gestureEnded();
            const kind = handles[grabbed]!.kind;
            drag = {
                kind: kind === "rotate" ? "rotate" : kind === "tip" ? "tip" : kind === "vertex" ? "vertex" : "size",
                from: doc.blueprint,
                handle: handles[grabbed]!,
                spec,
                moved: false,
            };
            return;
        }
        const hit = moduleAt(doc.view.modules, world.x, world.y);
        // Shift over a module adds it to the selection; shift over empty space
        // still pans, as does the middle button and a plain drag on empty space.
        // The one gesture this costs is panning by shift-dragging *from* a module,
        // which the other two cover.
        if (hit >= 0 && event.shiftKey && event.button !== 1) {
            doc.togglePath(doc.resolveClick(hit));
            changed();
            return;
        }
        // Panning leaves the selection alone; only a plain click on empty space
        // clears it, and that is decided on release.
        if (hit < 0 || event.button === 1 || event.shiftKey) {
            drag = { kind: "pan", x: event.clientX, y: event.clientY, deselect: hit < 0 && event.button === 0 && !event.shiftKey };
            return;
        }
        // Pressing on something the selection already covers leaves the selection
        // alone, so that an assembly can be dragged as an assembly. Going *in* a level is
        // what a click does, and a click is a press that did not become a drag —
        // otherwise selecting a wing and then dragging it would quietly drag one
        // part of it instead, which is the difference between the two operations.
        const drill = doc.covers(hit);
        if (!drill) doc.selectAt(hit, doc.resolveClick(hit));
        hooks.gestureEnded();
        drag = {
            kind: "module",
            from: doc.blueprint,
            startX: world.x,
            startY: world.y,
            corners: cornersOf(doc.view.modules.filter((_, i) => doc.covers(i))),
            moved: false,
            hit,
            drill,
        };
        changed();
    };

    const pointerMove = (event: PointerEvent): void => {
        if (drag === null) {
            const rect = canvas.getBoundingClientRect();
            const ratio = canvas.width / rect.width;
            const x = (event.clientX - rect.left) * ratio;
            const y = (event.clientY - rect.top) * ratio;
            // Grown while pointed at, and so kept until the pointer leaves it at the larger size.
            const expanded = envelope() !== null && overEnvelope(canvas.width, canvas.height, x, y, thrustExpanded);
            const bearing = expanded ? envelopeBearingAt(canvas.width, canvas.height, x, y, true) : null;
            if (bearing !== thrustBearing || expanded !== thrustExpanded) {
                thrustBearing = bearing;
                thrustExpanded = expanded;
                render();
            }
            return;
        }
        if (drag.kind === "pan") {
            if (event.clientX === drag.x && event.clientY === drag.y) return;
            const ratio = canvas.width / canvas.getBoundingClientRect().width;
            camera.x -= ((event.clientX - drag.x) * ratio) / camera.scale;
            camera.y += ((event.clientY - drag.y) * ratio) / camera.scale;
            drag = { kind: "pan", x: event.clientX, y: event.clientY, deselect: false };
            easeFit = false;
            render();
            return;
        }
        if (drag.kind !== "module") {
            dragHandle(event);
            return;
        }
        const moving = drag;
        const handle = selectedPosition(doc);
        if (handle === null) return;
        const world = worldAt(event);
        // The *displacement* snaps, not the position. A layout drawn on half-metre
        // offsets — which the authored ships are, since modules abut exactly —
        // would be dragged onto whole metres by an absolute grid and every abutting
        // face would part company. Snapping the movement keeps whatever offsets a
        // ship was designed with, and Alt escapes it entirely.
        const step = event.altKey ? 0 : snapMetres();
        let dx = snap(world.x - moving.startX, step);
        let dy = snap(world.y - moving.startY, step);
        // What should land on a neighbour is one of the moving modules' own
        // corners, wherever within them the drag was taken hold of, so the field
        // is tried against those rather than against the pointer.
        const pull = alignment(fieldNow(), offsetBy(moving.corners, dx, dy), snapWithin(event));
        dx = tidyMetres(dx + pull.dx);
        dy = tidyMetres(dy + pull.dy);
        if (dx === 0 && dy === 0 && !moving.moved) return;
        const next = movePlacement(moving.from, handle.origin, dx, dy);
        if (next === null) return;
        if (moving.moved) doc.amend(next);
        else doc.apply(next);
        drag = { ...moving, moved: true };
        changed();
    };

    const endDrag = (): void => {
        // A press that never became a drag is a click, and a click on something
        // already selected goes in a level: assembly, then part of the assembly, then
        // nothing further.
        if (drag !== null && drag.kind === "module" && drag.drill && !drag.moved) {
            doc.selectAt(drag.hit, doc.resolveClick(drag.hit));
            changed();
        }
        if (drag !== null && drag.kind === "pan" && drag.deselect) {
            doc.select(null);
            changed();
        }
        drag = null;
        hooks.gestureEnded();
    };

    const pointerLeave = (): void => {
        if (thrustBearing === null && !thrustExpanded) return;
        thrustBearing = null;
        thrustExpanded = false;
        render();
    };

    const wheel = (event: WheelEvent): void => {
        event.preventDefault();
        easeFit = false;
        const before = worldAt(event);
        camera.scale *= Math.exp(-event.deltaY * 0.0015);
        const after = worldAt(event);
        camera.x += before.x - after.x;
        camera.y += before.y - after.y;
        render();
        hooks.zoomed?.();
    };

    const cycleArcs = (): void => {
        arcs = nextArcs(arcs);
        render();
    };

    const keyDown = (event: KeyboardEvent): void => {
        const typing =
            document.activeElement instanceof HTMLInputElement ||
            document.activeElement instanceof HTMLTextAreaElement ||
            document.activeElement instanceof HTMLSelectElement;
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
            event.preventDefault();
            if (event.shiftKey) doc.redo();
            else doc.undo();
            hooks.gestureEnded();
            changed();
            return;
        }
        if (typing) return;
        if (event.key === "f" || event.key === "F") {
            fitPending = true;
            redraw();
        } else if (event.key.toLowerCase() === ARCS_KEY && !event.ctrlKey && !event.metaKey) {
            cycleArcs();
            hooks.viewChanged?.();
        } else if (event.key === "Delete" || event.key === "Backspace") {
            if (doc.selection === null) return;
            event.preventDefault();
            hooks.deleteSelected();
        } else if (event.key === "Escape") {
            doc.select(null);
            changed();
        }
    };

    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("pointerleave", pointerLeave);
    canvas.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("keydown", keyDown);
    // The canvas, not the window: the header rewrapping resizes it too.
    const resized = new ResizeObserver(() => {
        resize();
        render();
    });
    resized.observe(canvas);

    return {
        camera,
        get arcs() {
            return arcs;
        },
        get showRefit() {
            return showRefit;
        },
        snapMetres,
        envelope,
        visible: () => ({ x: camera.x, y: camera.y, width: canvas.width / camera.scale, height: canvas.height / camera.scale }),
        changed: redraw,
        fit: () => {
            fitPending = true;
            redraw();
        },
        easeToNext: () => {
            demonstration.reset();
            easeFit = true;
        },
        cycleArcs,
        toggleRefit: () => {
            showRefit = !showRefit;
            render();
        },
        dispose: () => {
            disposed = true;
            canvas.removeEventListener("pointerdown", pointerDown);
            canvas.removeEventListener("pointermove", pointerMove);
            canvas.removeEventListener("pointerup", endDrag);
            canvas.removeEventListener("pointercancel", endDrag);
            canvas.removeEventListener("pointerleave", pointerLeave);
            canvas.removeEventListener("wheel", wheel);
            window.removeEventListener("keydown", keyDown);
            resized.disconnect();
        },
    };
}
