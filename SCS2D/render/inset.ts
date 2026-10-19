import type { Camera } from './camera.js';

/**
 * Where to show a ship close up, in a small window over the battle view, when
 * the view itself does not: the ship is off screen, or too small on it to
 * read. DOM-free arithmetic, so it is unit-tested; `canvas2d.ts` draws it.
 *
 * A window goes as near its ship as it can: over it, if the ship is on screen
 * but small, and against the edge it is beyond, if it is off screen — so
 * where the window is says where the ship is.
 */

/** A window, canvas pixels from the top left. */
export interface InsetRect {
  x: number;
  y: number;
  size: number;
}

export interface Inset extends InsetRect {
  /** The body it shows. */
  readonly body: number;
  /** The camera it is drawn with, centred on its ship. */
  readonly camera: Camera;
  /** Screen bearing from the window's centre to its ship, radians, y down; null when it covers the ship. */
  readonly toward: number | null;
}

/** The part of the view windows are kept to, canvas pixels: all of it unless something covers its edges. */
export interface InsetArea {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** What placing a window needs of the ship it shows. */
export interface InsetShip {
  readonly body: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  /** Hull radius, m. */
  readonly radius: number;
}

export interface InsetSettings {
  /** Side of a window, canvas pixels. */
  readonly size: number;
  /** Gap kept from the view's edge and between windows, canvas pixels. */
  readonly margin: number;
  /** A ship drawn smaller across than this, canvas pixels, is too small to read. */
  readonly smallest: number;
}

/** How much of a window's half-width the ship's radius fills. */
const FILL = 0.7;

/** Where a world point lands on a view, canvas pixels from the top left. */
function onScreen(camera: Camera, widthPx: number, heightPx: number, x: number, y: number): { x: number; y: number } {
  return { x: widthPx / 2 + (x - camera.x) * camera.scale, y: heightPx / 2 - (y - camera.y) * camera.scale };
}

function clamp(value: number, low: number, high: number): number {
  return high < low ? (low + high) / 2 : Math.min(high, Math.max(low, value));
}

/**
 * The window for one ship, or null if the view shows it well enough: within
 * `area`, and at least `smallest` across.
 */
export function insetFor(
  ship: InsetShip,
  camera: Camera,
  widthPx: number,
  heightPx: number,
  settings: InsetSettings,
  area: InsetArea = { left: 0, top: 0, right: widthPx, bottom: heightPx },
): Inset | null {
  const { size, margin, smallest } = settings;
  const at = onScreen(camera, widthPx, heightPx, ship.x, ship.y);
  const off = at.x < area.left || at.x > area.right || at.y < area.top || at.y > area.bottom;
  if (!off && 2 * ship.radius * camera.scale >= smallest) return null;
  const half = size / 2;
  const cx = clamp(at.x, area.left + margin + half, area.right - margin - half);
  const cy = clamp(at.y, area.top + margin + half, area.bottom - margin - half);
  return {
    body: ship.body,
    x: cx - half,
    y: cy - half,
    size,
    camera: { x: ship.x, y: ship.y, scale: (half * FILL) / Math.max(ship.radius, 0.1), vx: ship.vx, vy: ship.vy },
    toward: off ? Math.atan2(at.y - cy, at.x - cx) : null,
  };
}

/** Whether two windows, each with `margin` round it, overlap. */
function overlap(a: InsetRect, b: InsetRect, margin: number): boolean {
  return a.x < b.x + b.size + margin && b.x < a.x + a.size + margin && a.y < b.y + b.size + margin && b.y < a.y + a.size + margin;
}

/**
 * Move `moving` off `fixed`, the shorter way along whichever axis is
 * shorter, staying inside the view; the other way along that axis if the
 * shorter way would leave it.
 */
export function separate(
  fixed: InsetRect,
  moving: InsetRect,
  widthPx: number,
  heightPx: number,
  margin: number,
  area: InsetArea = { left: 0, top: 0, right: widthPx, bottom: heightPx },
): void {
  if (!overlap(fixed, moving, margin)) return;
  const gap = moving.size + margin;
  const options = [
    { axis: 'x' as const, to: fixed.x - gap, low: area.left, high: area.right },
    { axis: 'x' as const, to: fixed.x + fixed.size + margin, low: area.left, high: area.right },
    { axis: 'y' as const, to: fixed.y - gap, low: area.top, high: area.bottom },
    { axis: 'y' as const, to: fixed.y + fixed.size + margin, low: area.top, high: area.bottom },
  ]
    .filter((option) => option.to >= option.low + margin && option.to + moving.size <= option.high - margin)
    .sort((a, b) => Math.abs(a.to - moving[a.axis]) - Math.abs(b.to - moving[b.axis]));
  const best = options[0];
  if (best !== undefined) moving[best.axis] = best.to;
}

/**
 * The windows for the selected ship and what it is fighting, each only where
 * it is needed, the second moved off the first where they would overlap.
 */
export function insetsFor(
  ships: readonly InsetShip[],
  camera: Camera,
  widthPx: number,
  heightPx: number,
  settings: InsetSettings,
  area: InsetArea = { left: 0, top: 0, right: widthPx, bottom: heightPx },
): Inset[] {
  const insets: Inset[] = [];
  for (const ship of ships) {
    const inset = insetFor(ship, camera, widthPx, heightPx, settings, area);
    if (inset === null) continue;
    for (const placed of insets) separate(placed, inset, widthPx, heightPx, settings.margin, area);
    insets.push(inset);
  }
  return insets;
}

/** The body whose window holds a canvas point, or -1; the window placed last is on top. */
export function insetAt(insets: readonly Inset[], x: number, y: number): number {
  for (let i = insets.length - 1; i >= 0; i--) {
    const inset = insets[i]!;
    if (x >= inset.x && x <= inset.x + inset.size && y >= inset.y && y <= inset.y + inset.size) return inset.body;
  }
  return -1;
}

/** A range for a window's label: metres to a kilometre, then kilometres to three figures. */
export function describeRange(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${Number((metres / 1000).toPrecision(3))} km`;
}
