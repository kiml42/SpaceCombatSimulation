import { PICK_PX, TOUCH_PICK_PX, type Camera } from "../render/camera.js";
import { isSolid, panBetween, rendererChoice, worldAt, zoomAbout } from "../render/layerView.js";

/** How far a pointer travels before a press is a pan rather than a click, CSS pixels. */
const CLICK_SLOP_PX = 4;
/** The same for a finger, which wobbles more than a mouse. */
const TOUCH_SLOP_PX = 10;

/**
 * Pan and zoom a battle view: drag with the main or middle button to pan, wheel
 * or pinch to zoom about the pointer, and two fingers pan as they pinch.
 *
 * `moved` is told whenever the camera is moved by hand. `tapped`, if given, is
 * told of a click or tap that did not pan, with the world point under it, how
 * far off that point a ship may be and still count as tapped, metres,
 * whether Shift was held, and whether an order given by it is to be queued. `picking` adds what a page that gives orders wants.
 */
export function viewGestures(
    canvas: HTMLCanvasElement,
    camera: Camera,
    moved: () => void,
    tapped?: (x: number, y: number, reach: number, shift: boolean, queue: boolean) => void,
    picking?: Picking,
): void {
    /** Canvas pixels per CSS pixel. */
    const ratio = (): number => canvas.width / canvas.getBoundingClientRect().width;
    /** A client point as canvas pixels from the centre of the view. */
    const offset = (clientX: number, clientY: number): { x: number; y: number } => {
        const rect = canvas.getBoundingClientRect();
        const r = ratio();
        return { x: (clientX - rect.left) * r - canvas.width / 2, y: (clientY - rect.top) * r - canvas.height / 2 };
    };

    canvas.addEventListener(
        "wheel",
        (event) => {
            event.preventDefault();
            const at = offset(event.clientX, event.clientY);
            zoomAbout(canvas, camera, at.x, at.y, Math.exp(-event.deltaY * 0.0015));
            moved();
        },
        { passive: false },
    );

    const pointers = new Map<number, { x: number; y: number }>();
    /** A lone press that may yet be a tap; null once it pans or a second finger lands. */
    let press: { x: number; y: number; slop: number; panned: boolean } | null = null;

    /** The middle of the pointers down, and how far they are spread about it. */
    const spread = (): { x: number; y: number; size: number } => {
        let x = 0;
        let y = 0;
        for (const p of pointers.values()) {
            x += p.x / pointers.size;
            y += p.y / pointers.size;
        }
        let size = 0;
        for (const p of pointers.values()) size += Math.hypot(p.x - x, p.y - y) / pointers.size;
        return { x, y, size };
    };

    /**
     * Whether an order is to go after a ship's others: Ctrl or Cmd, or Shift where
     * the browser lets a page see it with a right-click.
     */
    const queued = (event: MouseEvent): boolean => event.ctrlKey || event.metaKey || event.shiftKey;
    /** World point under a client point. */
    const world = (clientX: number, clientY: number): { x: number; y: number } => {
        const at = offset(clientX, clientY);
        return worldAt(canvas, camera, at.x, at.y);
    };
    /** How far a ship may be from where a pick lands, metres: as far as that many pixels go on the deck there. */
    const reachOf = (event: PointerEvent | MouseEvent): number => {
        const px = ("pointerType" in event && event.pointerType === "touch" ? TOUCH_PICK_PX : PICK_PX) * ratio();
        const at = offset(event.clientX, event.clientY);
        const here = worldAt(canvas, camera, at.x, at.y);
        const there = worldAt(canvas, camera, at.x + px, at.y);
        return Math.hypot(there.x - here.x, there.y - here.y);
    };

    /** A Shift-drag drawing a box, from where it started, in client pixels. */
    let box: { x: number; y: number } | null = null;

    /**
     * A mouse right-press, which gives its order when let go, unless it was
     * dragged in 3D, which swings the camera (render/layerView.ts); and when it last ended.
     */
    let order: { x: number; y: number; dragged: boolean } | null = null;
    let orderEnded = -Infinity;

    if (picking !== undefined) {
        canvas.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            // A mouse's right-click orders as it is let go; this is a long press.
            if (order !== null || performance.now() - orderEnded < 500) return;
            const at = world(event.clientX, event.clientY);
            picking.commanded(at.x, at.y, reachOf(event), queued(event));
        });
        canvas.addEventListener("pointerdown", (event) => {
            if (event.pointerType !== "mouse" || event.button !== 2) return;
            canvas.setPointerCapture(event.pointerId);
            order = { x: event.clientX, y: event.clientY, dragged: false };
        });
        canvas.addEventListener("pointermove", (event) => {
            if (order !== null && Math.hypot(event.clientX - order.x, event.clientY - order.y) > CLICK_SLOP_PX) order.dragged = true;
        });
        const dropOrder = (): void => {
            order = null;
        };
        canvas.addEventListener("pointercancel", dropOrder);
        canvas.addEventListener("lostpointercapture", dropOrder);
        canvas.addEventListener("pointerup", (event) => {
            if (order === null || event.button !== 2) return;
            const swung = order.dragged && isSolid(rendererChoice());
            order = null;
            orderEnded = performance.now();
            if (swung) return;
            const at = world(event.clientX, event.clientY);
            picking.commanded(at.x, at.y, reachOf(event), queued(event));
        });
        canvas.addEventListener("dblclick", (event) => {
            const at = world(event.clientX, event.clientY);
            picking.doubled(at.x, at.y, reachOf(event));
        });
    }

    canvas.addEventListener("pointerdown", (event) => {
        // The main button pans or picks, the middle only pans, as in the editors;
        // the other is for orders.
        const middle = event.pointerType === "mouse" && event.button === 1;
        if (event.pointerType === "mouse" && event.button !== 0 && !middle) return;
        // Not the browser's autoscroll.
        if (middle) event.preventDefault();
        if (picking !== undefined && event.shiftKey && event.pointerType === "mouse" && !middle) {
            canvas.setPointerCapture(event.pointerId);
            box = { x: event.clientX, y: event.clientY };
            press = { x: event.clientX, y: event.clientY, slop: CLICK_SLOP_PX, panned: false };
            return;
        }
        canvas.setPointerCapture(event.pointerId);
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        press =
            pointers.size === 1
                ? {
                      x: event.clientX,
                      y: event.clientY,
                      slop: event.pointerType === "touch" ? TOUCH_SLOP_PX : CLICK_SLOP_PX,
                      // A middle press is never a tap.
                      panned: middle,
                  }
                : null;
    });
    canvas.addEventListener("pointermove", (event) => {
        if (box !== null && press !== null) {
            if (!press.panned && Math.hypot(event.clientX - press.x, event.clientY - press.y) <= press.slop) return;
            press.panned = true;
            const r = ratio();
            const rect = canvas.getBoundingClientRect();
            picking!.boxing({
                x0: (box.x - rect.left) * r,
                y0: (box.y - rect.top) * r,
                x1: (event.clientX - rect.left) * r,
                y1: (event.clientY - rect.top) * r,
            });
            return;
        }
        const pointer = pointers.get(event.pointerId);
        if (pointer === undefined) return;
        if (press !== null && !press.panned) {
            if (Math.hypot(event.clientX - press.x, event.clientY - press.y) <= press.slop) return;
            press.panned = true;
        }
        // Before and after over the same pointers, so a finger lifting mid-pinch
        // carries on as a pan from where it is rather than jumping.
        const before = spread();
        pointer.x = event.clientX;
        pointer.y = event.clientY;
        const after = spread();
        const from = offset(before.x, before.y);
        const to = offset(after.x, after.y);
        panBetween(canvas, camera, from.x, from.y, to.x, to.y);
        if (pointers.size > 1 && before.size > 0) zoomAbout(canvas, camera, to.x, to.y, after.size / before.size);
        moved();
    });
    canvas.addEventListener("pointerup", (event) => {
        if (box !== null) {
            const from = world(box.x, box.y);
            const to = world(event.clientX, event.clientY);
            const dragged = press?.panned === true;
            box = null;
            press = null;
            picking!.boxing(null);
            if (dragged) picking!.boxed(from.x, from.y, to.x, to.y);
            else tapped?.(to.x, to.y, reachOf(event), true, true);
            return;
        }
        if (press !== null && !press.panned && tapped !== undefined) {
            const at = world(event.clientX, event.clientY);
            tapped(at.x, at.y, reachOf(event), event.shiftKey, queued(event));
        }
        pointers.delete(event.pointerId);
        press = null;
    });
    canvas.addEventListener("pointercancel", (event) => {
        pointers.delete(event.pointerId);
        press = null;
        if (box !== null) {
            box = null;
            picking!.boxing(null);
        }
    });
}

/** What a battle view that gives orders needs from the mouse, beyond panning and picking. */
export interface Picking {
    /** A right-click: an order at the ship under it, queued if `queue`. */
    commanded(x: number, y: number, reach: number, queue: boolean): void;
    /** A double-click: every ship of the design under it. */
    doubled(x: number, y: number, reach: number): void;
    /** A Shift-drag let go, corner to corner, world metres. */
    boxed(x0: number, y0: number, x1: number, y1: number): void;
    /** The box being dragged, canvas pixels, to draw; null once it is let go. */
    boxing(box: { x0: number; y0: number; x1: number; y1: number } | null): void;
}
