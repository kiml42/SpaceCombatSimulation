import { math, type Snapshot } from '../sim/index.js';

const { abs, max, min } = math;

/**
 * The camera: what part of the world is on screen, and how it follows.
 *
 * Separate from the drawing because none of it touches a canvas — it is
 * arithmetic over a snapshot, which means it can be tested in Node without a
 * browser, and camera behaviour is exactly the sort of thing that is easier to
 * get wrong than to notice.
 */

/** Roughly how far apart grid lines should sit on screen, pixels. */
export const TARGET_GRID_PX = 90;
/** How many snap positions the editor puts across one drawn grid square. */
const SNAPS_PER_SQUARE = 10;

export interface Camera {
  /** Centre of the view, world coordinates. */
  x: number;
  y: number;
  /** Pixels per metre. */
  scale: number;
}

/**
 * Keep the snapshot's bounds in shot, easing rather than snapping — except
 * when easing would crop.
 *
 * Three rules, each of which exists because the obvious version failed.
 *
 * **Move with what is being followed, then ease the remainder.** A camera that
 * only eases toward where the ships *are* is always chasing them, and the
 * faster they travel the further behind it sits — at speed the lag is most of
 * the screen. So the ships' own velocity is applied to the camera first, which
 * cancels their motion exactly, and the easing then has only the residual to
 * close: the formation spreading, or its centre drifting. This is the same
 * trick as the turrets' velocity feed-forward (DESIGN.md §4) and it is the
 * same insight — correct for the motion you can predict, and save the
 * feedback loop for the part you cannot.
 *
 * **Widen at once, close in gently.** Easing in both directions loses the race
 * whenever the scene spreads faster than the camera follows, and something
 * ends up cut off. A frame that has already cropped is worse than one that
 * moved abruptly.
 *
 * **Then contain.** After easing, the centre is pulled back far enough that
 * the bounds are inside the view, so cropping is impossible rather than
 * merely unlikely.
 *
 * `dt` is *simulated* seconds since the last frame, not wall seconds: the
 * ships move in simulated time, so at eight times speed the feed-forward has
 * eight times as far to carry. These are smoothing constants, not physics,
 * which is why they live out here rather than in `sim/`.
 *
 * **The easing, though, is per frame rather than per `dt`, and that is the
 * right way round.** Only the feed-forward is chasing the battle; the easing
 * and the containment are the camera settling, and the camera is the viewer's
 * instrument rather than a thing in the world. So a paused battle goes on
 * settling into frame, which is what anybody pausing to look at something
 * wants. An impact flash is the opposite case and ages on the battle's clock,
 * because a flash *is* a thing in the world (`render/flashes.ts`).
 */
export function frame(
  camera: Camera,
  snapshot: Snapshot,
  widthPx: number,
  heightPx: number,
  ease = 0.08,
): void {
  const wantScale = fitScale(snapshot, widthPx, heightPx);
  const wantX = (snapshot.minX + snapshot.maxX) * 0.5;
  const wantY = (snapshot.minY + snapshot.maxY) * 0.5;

  camera.x += (wantX - camera.x) * ease;
  camera.y += (wantY - camera.y) * ease;
  // Scale eases geometrically when closing in — a fixed fraction of a ratio,
  // so zooming in from 10 m/px and from 0.1 m/px feel the same — and snaps
  // when it has to widen, because a frame that has already cropped is worse
  // than a frame that moved abruptly.
  camera.scale = wantScale < camera.scale ? wantScale : easeScale(camera.scale, wantScale, ease);

  contain(camera, snapshot, widthPx, heightPx);
}

/** Pixels per metre at which a snapshot's bounds fill a view, with a margin round them. */
export function fitScale(snapshot: Snapshot, widthPx: number, heightPx: number): number {
  const margin = 1.25;
  const spanX = max(snapshot.maxX - snapshot.minX, 1) * margin;
  const spanY = max(snapshot.maxY - snapshot.minY, 1) * margin;
  return min(widthPx / spanX, heightPx / spanY);
}

/**
 * A scale moved `ease` of the way to `target` as a ratio rather than a
 * difference, so a zoom takes as long from 10 px/m as from 0.1. It lands on
 * `target` once within a fraction of a percent, so an easing can finish.
 */
export function easeScale(current: number, target: number, ease: number): number {
  if (!(current > 0)) return target;
  const next = current * (target / current) ** ease;
  return abs(next / target - 1) < 0.002 ? target : next;
}

/**
 * Carry the camera along with the mean velocity of the ships it is looking at.
 *
 * With one ship this holds it perfectly still on screen; with several it
 * removes the part of their motion they share and leaves only the spread.
 *
 * **Only the ships on screen count.** The camera's job is to hold what the
 * viewer is looking at still, so a ship they have panned away from, or zoomed
 * past, is not part of the answer — and neither is a hulk, which is drifting
 * out of the fight rather than flying in it. A ship counts while any part of
 * it is in shot, so one crossing the edge does not flick in and out.
 *
 * `dt` is *simulated* seconds — this is the half of the camera that chases the
 * battle, so it runs on the battle's clock. The easing in `frame` is the half
 * that settles, and runs on the frame.
 */
export function moveWithVisibleShips(
  camera: Camera,
  snapshot: Snapshot,
  dt: number,
  widthPx: number,
  heightPx: number,
): void {
  if (!(dt > 0) || snapshot.shipCount === 0 || !(camera.scale > 0)) return;

  // The view in metres, about the camera.
  const halfWidth = widthPx / (2 * camera.scale);
  const halfHeight = heightPx / (2 * camera.scale);

  let vx = 0;
  let vy = 0;
  let counted = 0;
  for (let i = 0; i < snapshot.shipCount; i++) {
    const ship = snapshot.ships[i]!;
    if (!ship.hasControl) continue;
    const r = ship.design.radius;
    if (abs(ship.x - camera.x) > halfWidth + r) continue;
    if (abs(ship.y - camera.y) > halfHeight + r) continue;
    vx += ship.vx;
    vy += ship.vy;
    counted++;
  }
  // Nothing in shot to keep up with: hold still rather than drift after ships
  // the viewer has deliberately left behind — and rather than divide by none
  // of them, which would put the camera at NaN and take the view with it.
  if (counted === 0) return;
  camera.x += (vx / counted) * dt;
  camera.y += (vy / counted) * dt;
}

/**
 * Nudge the centre until the bounds fit inside the view. A no-op once the
 * camera has caught up, which is most of the time.
 */
function contain(
  camera: Camera,
  snapshot: Snapshot,
  widthPx: number,
  heightPx: number,
): void {
  const halfW = widthPx / 2 / camera.scale;
  const halfH = heightPx / 2 / camera.scale;

  const overX = snapshot.maxX - snapshot.minX > halfW * 2;
  if (overX) camera.x = (snapshot.minX + snapshot.maxX) * 0.5;
  else if (snapshot.minX < camera.x - halfW) camera.x = snapshot.minX + halfW;
  else if (snapshot.maxX > camera.x + halfW) camera.x = snapshot.maxX - halfW;

  const overY = snapshot.maxY - snapshot.minY > halfH * 2;
  if (overY) camera.y = (snapshot.minY + snapshot.maxY) * 0.5;
  else if (snapshot.minY < camera.y - halfH) camera.y = snapshot.minY + halfH;
  else if (snapshot.maxY > camera.y + halfH) camera.y = snapshot.maxY - halfH;
}

/**
 * Grid spacing in metres: the roundest number that keeps the lines about
 * `TARGET_GRID_PX` apart on screen. Exported so a caller can label the scale
 * it is actually drawing.
 */
export function gridStep(scale: number): number {
  return roundStep(TARGET_GRID_PX / scale);
}

/**
 * The step the editor's edits snap to, metres: the same ladder of round
 * numbers, a tenth of the drawn grid.
 *
 * It follows the zoom because no fixed step is right for more than one size of
 * ship — half a metre is uselessly coarse on a three-metre drone and uselessly
 * fine on a Star Destroyer, and which of the two is being worked on is exactly
 * what the zoom says. Tying it to the *drawn* grid rather than picking a
 * second scale of its own means the step is something already on screen: ten
 * snaps to a square, at every zoom.
 */
export function snapStep(scale: number): number {
  return roundStep(TARGET_GRID_PX / scale / SNAPS_PER_SQUARE);
}

/** The roundest number at or above `raw`: 1, 2, 5 or 10 times a power of ten. */
function roundStep(raw: number): number {
  const power = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? power * 10;
}

/**
 * A snap step in the unit that makes it a small whole number — millimetres,
 * centimetres or metres — since the ladder runs from a Star Destroyer's fifty
 * metres down to a drone's centimetre and "0.02 m" is a worse way of saying
 * two of them.
 */
export function describeStep(step: number): string {
  const round3 = (value: number): string => String(Number(value.toPrecision(3)));
  if (step < 0.01) return `${round3(step * 1000)} mm`;
  if (step < 1) return `${round3(step * 100)} cm`;
  return `${round3(step)} m`;
}
