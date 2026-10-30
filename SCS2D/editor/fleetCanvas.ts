import { degreesToRadians, isGroupUse, math, radiansToDegrees, Snapshot, type Fleet } from "../sim/index.js";
import { ARC_LABELS, ARCS_KEY, draw, nextArcs, type Arcs } from "../render/canvas2d.js";
import { frame, snapStep, type Camera } from "../render/camera.js";
import { viewOptions } from "../host/viewOptions.js";
import { loadRenderer } from "../host/viewSettings.js";
import { BUILDER_LIGHT } from "../render/light.js";
import { pixiUnder } from "../render/pixiView.js";
import { snap } from "./edit.js";
import { deleteEntries, entryAt, moveEntries, samePath, updateEntry, type EntryPath } from "./fleetEdit.js";
import { centreOf, toFrame, toFrameAngle, type EntryFrame, type FleetDocument } from "./fleetDocument.js";
import { drawFleetOverlay, knobFor, type FleetOverlayView } from "./fleetOverlay.js";
import { fleetSnapshot } from "./fleetPreview.js";
import { HANDLE_GRAB_PX } from "./handles.js";

/**
 * The fleet drawn, and the pointer and keys on it: select, move, turn, pan,
 * zoom, delete, undo. The panel round it is the page's; this tells it when
 * the fleet, the selection or the zoom has changed under it.
 */

const { atan2, max, sqrt } = math;

export const ANGLE_SNAP_DEGREES = 15;

export interface FleetCanvas {
    readonly camera: Camera;
    /** Draw again, after the page changed the fleet or the selection. */
    render(): void;
    /** Frame the whole fleet, at the next draw. */
    fit(): void;
    dispose(): void;
}

export interface FleetCanvasHooks {
    /** After the canvas changed the fleet, the selection or the zoom. */
    changed(): void;
    /** Escape, before it selects nothing: true if the page took it. */
    escape?(): boolean;
}

type Drag =
    | { kind: "pan"; x: number; y: number; deselect: boolean }
    | {
          kind: "move";
          from: Fleet;
          startX: number;
          startY: number;
          moved: boolean;
          /** The ship pressed on, and whether releasing without a drag steps in a level. */
          hit: number;
          drill: boolean;
          /** Each selected entry's frame, held so the drag measures against where it began. */
          frames: (EntryFrame | null)[];
      }
    | { kind: "rotate"; from: Fleet; moved: boolean; frame: EntryFrame };

export function fleetCanvas(canvas: HTMLCanvasElement, doc: FleetDocument, hooks: FleetCanvasHooks): FleetCanvas {
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("no 2d context");
    // Drawn with Pixi underneath unless Canvas2D is picked, as the battle is.
    const stacked = loadRenderer() === "webgl" ? pixiUnder(canvas) : null;
    const camera: Camera = { x: 0, y: 0, scale: 1 };
    const snapshot = new Snapshot();
    let fitPending = true;
    let arcs: Arcs = "none";
    const viewBar = viewOptions(canvas.parentElement ?? document.body, [
        {
            label: () => ARC_LABELS[arcs],
            title: "Cycle the firing arcs drawn: none, where each gun may point, and where each will fire (A)",
            press: () => {
                arcs = nextArcs(arcs);
                render();
            },
        },
    ]);

    const resize = (): void => {
        const ratio = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const width = max(1, Math.round(rect.width * ratio));
        const height = max(1, Math.round(rect.height * ratio));
        // Setting either clears the canvas, even to the size it already is.
        for (const each of stacked === null ? [canvas] : [canvas, stacked.canvas]) {
            if (each.width !== width) each.width = width;
            if (each.height !== height) each.height = height;
        }
    };

    const currentKnob = (): { x: number; y: number; fromX: number; fromY: number } | null => {
        if (doc.selection.length !== 1) return null;
        const path = doc.selection[0]!;
        const at = doc.frameOf(path);
        if (at === null) return null;
        return { ...knobFor(at.x, at.y, at.angle, doc.reachOf(path), camera.scale), fromX: at.x, fromY: at.y };
    };

    /** What the overlay outlines: selected ships, selected groups' boxes, and the group stepped into. */
    const selectionMarks = (): Pick<FleetOverlayView, "ships" | "boxes"> => {
        const ships: FleetOverlayView["ships"][number][] = [];
        const boxes: FleetOverlayView["boxes"][number][] = [];
        const contexts: EntryPath[] = [];
        doc.selection.forEach((path, n) => {
            const entry = entryAt(doc.fleet, path);
            if (entry === null) return;
            for (const copy of doc.copiesOf(path)) {
                if (isGroupUse(entry)) boxes.push({ ships: copy.ships, angle: copy.angle, style: copy.primary ? "primary" : "linked" });
                else ships.push({ ships: copy.ships, primary: copy.primary && n === 0 });
            }
            const parent = path.slice(0, -1);
            if (parent.length > 0 && !contexts.some((each) => samePath(each, parent))) contexts.push(parent);
        });
        for (const parent of contexts) {
            if (doc.selection.some((path) => samePath(path, parent))) continue;
            for (const copy of doc.copiesOf(parent)) boxes.push({ ships: copy.ships, angle: copy.angle, style: "context" });
        }
        return { ships, boxes };
    };

    const render = (): void => {
        fleetSnapshot(doc.view, snapshot);
        if (fitPending) {
            // Measured now, as the page round it may have changed its size since.
            resize();
            frame(camera, snapshot, canvas.width, canvas.height, 1);
            fitPending = false;
        }
        const pixi = stacked?.view.ready === true ? stacked.view.begin(snapshot, camera, canvas.width, canvas.height, BUILDER_LIGHT) : null;
        if (pixi !== null) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        // Pixi's context draws as a canvas does (render/pixiCanvas.ts), so the same code paints either.
        const into = pixi === null ? ctx : (pixi as unknown as CanvasRenderingContext2D);
        draw(into, snapshot, camera, canvas.width, canvas.height, undefined, arcs, false, -1, [], null, pixi !== null);
        drawFleetOverlay(
            into,
            {
                hulls: doc.view.hulls,
                circles: doc.view.ships.map((ship, i) => {
                    const design = doc.view.designs[i];
                    return design == null ? null : { ...centreOf(ship, design), radius: design.radius };
                }),
                faulty: doc.view.faulty,
                ...selectionMarks(),
                knob: currentKnob(),
            },
            camera,
            canvas.height,
        );
        if (pixi !== null) stacked!.view.end();
    };
    const changed = (): void => {
        hooks.changed();
        render();
    };

    const worldAt = (event: PointerEvent | WheelEvent): { x: number; y: number } => {
        const rect = canvas.getBoundingClientRect();
        const px = ((event.clientX - rect.left) * canvas.width) / rect.width - canvas.width / 2;
        const py = ((event.clientY - rect.top) * canvas.height) / rect.height - canvas.height / 2;
        return { x: camera.x + px / camera.scale, y: camera.y - py / camera.scale };
    };

    let drag: Drag | null = null;

    const pointerDown = (event: PointerEvent): void => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        canvas.setPointerCapture(event.pointerId);
        const world = worldAt(event);
        const knob = currentKnob();
        const knobFrame = doc.selection.length === 1 ? doc.frameOf(doc.selection[0]!) : null;
        if (knob !== null && knobFrame !== null && event.button === 0) {
            if (sqrt((world.x - knob.x) ** 2 + (world.y - knob.y) ** 2) <= HANDLE_GRAB_PX / camera.scale) {
                drag = { kind: "rotate", from: doc.fleet, moved: false, frame: knobFrame };
                return;
            }
        }
        const hit = event.button === 1 ? -1 : doc.shipAt(world.x, world.y, HANDLE_GRAB_PX / camera.scale);
        if (hit >= 0 && event.shiftKey) {
            const path = doc.resolveClick(hit);
            if (path !== null) doc.toggle(path, hit);
            changed();
            return;
        }
        if (hit < 0 || event.button === 1 || event.shiftKey) {
            drag = { kind: "pan", x: event.clientX, y: event.clientY, deselect: hit < 0 && event.button === 0 };
            return;
        }
        // Pressing on what is already selected leaves it alone, so a group drags as
        // a group; a click that does not become a drag steps in a level on release.
        const drill = doc.covers(hit);
        if (!drill) {
            const path = doc.resolveClick(hit);
            doc.select(path === null ? [] : [path], hit);
        }
        drag = {
            kind: "move",
            from: doc.fleet,
            startX: world.x,
            startY: world.y,
            moved: false,
            hit,
            drill,
            frames: doc.selection.map((path) => doc.frameOf(path)),
        };
        changed();
    };

    const pointerMove = (event: PointerEvent): void => {
        if (drag === null) return;
        if (drag.kind === "pan") {
            if (event.clientX === drag.x && event.clientY === drag.y) return;
            const ratio = canvas.width / canvas.getBoundingClientRect().width;
            camera.x -= ((event.clientX - drag.x) * ratio) / camera.scale;
            camera.y += ((event.clientY - drag.y) * ratio) / camera.scale;
            drag = { kind: "pan", x: event.clientX, y: event.clientY, deselect: false };
            render();
            return;
        }
        const world = worldAt(event);
        let next: Fleet;
        if (drag.kind === "move") {
            // The displacement snaps, not the position, so a formation keeps its offsets.
            const step = event.altKey ? 0 : snapStep(camera.scale);
            const dx = snap(world.x - drag.startX, step);
            const dy = snap(world.y - drag.startY, step);
            if (dx === 0 && dy === 0 && !drag.moved) return;
            const frames = drag.frames;
            next = moveEntries(
                drag.from,
                doc.selection.flatMap((path, i) => {
                    const frame = frames[i];
                    return frame == null ? [] : [{ path, ...toFrame(frame, dx, dy) }];
                }),
            );
        } else {
            const path = doc.selection[0]!;
            const frame = drag.frame;
            let degrees = radiansToDegrees(atan2(world.y - frame.y, world.x - frame.x));
            if (!event.altKey) degrees = Math.round(degrees / ANGLE_SNAP_DEGREES) * ANGLE_SNAP_DEGREES;
            const angle = foldAngle(toFrameAngle(frame, degreesToRadians(degrees)));
            next = updateEntry(drag.from, path, (e) => ({ ...e, angle }));
        }
        if (drag.moved) doc.amend(next);
        else doc.apply(next);
        drag = { ...drag, moved: true };
        changed();
    };

    const endDrag = (): void => {
        if (drag !== null && drag.kind === "move" && drag.drill && !drag.moved) {
            const path = doc.resolveClick(drag.hit);
            doc.select(path === null ? [] : [path], drag.hit);
            changed();
        }
        if (drag !== null && drag.kind === "pan" && drag.deselect) {
            doc.select([]);
            changed();
        }
        drag = null;
    };

    const wheel = (event: WheelEvent): void => {
        event.preventDefault();
        const before = worldAt(event);
        camera.scale *= Math.exp(-event.deltaY * 0.0015);
        const after = worldAt(event);
        camera.x += before.x - after.x;
        camera.y += before.y - after.y;
        changed();
    };

    const keyDown = (event: KeyboardEvent): void => {
        const typing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement;
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
            event.preventDefault();
            if (event.shiftKey) doc.redo();
            else doc.undo();
            changed();
            return;
        }
        if (typing) return;
        if (event.key === "f" || event.key === "F") {
            fitPending = true;
            render();
        } else if (event.key.toLowerCase() === ARCS_KEY && !event.ctrlKey && !event.metaKey) {
            arcs = nextArcs(arcs);
            viewBar.refresh();
            render();
        } else if (event.key === "Delete" || event.key === "Backspace") {
            event.preventDefault();
            if (doc.selection.length === 0) return;
            doc.apply(deleteEntries(doc.fleet, doc.selection));
            doc.select([]);
            changed();
        } else if (event.key === "Escape" && hooks.escape?.() !== true) {
            doc.select([]);
            changed();
        }
    };

    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("keydown", keyDown);
    // The canvas, not the window: the header rewrapping resizes it too.
    const resized = new ResizeObserver(() => {
        resize();
        render();
    });
    resized.observe(canvas);
    // Drawn in 2D until Pixi has started, and then again.
    void stacked?.view.started.then((started) => started && render());

    return {
        camera,
        render,
        fit: () => {
            fitPending = true;
            render();
        },
        dispose: () => {
            canvas.removeEventListener("pointerdown", pointerDown);
            canvas.removeEventListener("pointermove", pointerMove);
            canvas.removeEventListener("pointerup", endDrag);
            canvas.removeEventListener("pointercancel", endDrag);
            canvas.removeEventListener("wheel", wheel);
            resized.disconnect();
            stacked?.remove();
            window.removeEventListener("keydown", keyDown);
            viewBar.remove();
        },
    };
}

function foldAngle(a: number): number {
    let r = math.normalizeAngle(a);
    if (r <= -math.PI) r += math.TAU;
    else if (r > math.PI) r -= math.TAU;
    return r === 0 ? 0 : r;
}
