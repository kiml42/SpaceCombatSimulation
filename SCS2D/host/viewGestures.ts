import { PICK_PX, TOUCH_PICK_PX, zoomAt, type Camera } from '../render/camera.js';

/** How far a pointer travels before a press is a pan rather than a click, CSS pixels. */
const CLICK_SLOP_PX = 4;
/** The same for a finger, which wobbles more than a mouse. */
const TOUCH_SLOP_PX = 10;

/**
 * Pan and zoom a battle view: drag to pan, wheel or pinch to zoom about the
 * pointer, and two fingers pan as they pinch.
 *
 * `moved` is told whenever the camera is moved by hand. `tapped`, if given, is
 * told of a click or tap that did not pan, with the world point under it and
 * how far off that point a ship may be and still count as tapped, metres.
 */
export function viewGestures(
  canvas: HTMLCanvasElement,
  camera: Camera,
  moved: () => void,
  tapped?: (x: number, y: number, reach: number) => void,
): void {
  /** Canvas pixels per CSS pixel. */
  const ratio = (): number => canvas.width / canvas.getBoundingClientRect().width;
  /** A client point as canvas pixels from the centre of the view. */
  const offset = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    const r = ratio();
    return { x: (clientX - rect.left) * r - canvas.width / 2, y: (clientY - rect.top) * r - canvas.height / 2 };
  };

  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const at = offset(event.clientX, event.clientY);
    zoomAt(camera, at.x, at.y, Math.exp(-event.deltaY * 0.0015));
    moved();
  }, { passive: false });

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

  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    press =
      pointers.size === 1
        ? {
            x: event.clientX,
            y: event.clientY,
            slop: event.pointerType === 'touch' ? TOUCH_SLOP_PX : CLICK_SLOP_PX,
            panned: false,
          }
        : null;
  });
  canvas.addEventListener('pointermove', (event) => {
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
    const r = ratio();
    camera.x -= ((after.x - before.x) * r) / camera.scale;
    camera.y += ((after.y - before.y) * r) / camera.scale;
    if (pointers.size > 1 && before.size > 0) {
      const at = offset(after.x, after.y);
      zoomAt(camera, at.x, at.y, after.size / before.size);
    }
    moved();
  });
  canvas.addEventListener('pointerup', (event) => {
    if (press !== null && !press.panned && tapped !== undefined) {
      const at = offset(event.clientX, event.clientY);
      const reach = (event.pointerType === 'touch' ? TOUCH_PICK_PX : PICK_PX) * ratio();
      tapped(camera.x + at.x / camera.scale, camera.y - at.y / camera.scale, reach / camera.scale);
    }
    pointers.delete(event.pointerId);
    press = null;
  });
  canvas.addEventListener('pointercancel', (event) => {
    pointers.delete(event.pointerId);
    press = null;
  });
}
