import { math, type Snapshot } from '../sim/index.js';

const { max, min } = math;

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
 */
export function frame(
  camera: Camera,
  snapshot: Snapshot,
  widthPx: number,
  heightPx: number,
  dt = 0,
  ease = 0.08,
): void {
  // Carry the camera along with the mean velocity of what it is framing. With
  // one ship this holds it perfectly still on screen; with several it removes
  // the part of their motion they share and leaves only the spread.
  if (dt > 0 && snapshot.shipCount > 0) {
    let vx = 0;
    let vy = 0;
    for (let i = 0; i < snapshot.shipCount; i++) {
      vx += snapshot.ships[i]!.vx;
      vy += snapshot.ships[i]!.vy;
    }
    camera.x += (vx / snapshot.shipCount) * dt;
    camera.y += (vy / snapshot.shipCount) * dt;
  }

  const margin = 1.25;
  const spanX = max(snapshot.maxX - snapshot.minX, 1) * margin;
  const spanY = max(snapshot.maxY - snapshot.minY, 1) * margin;
  const wantScale = min(widthPx / spanX, heightPx / spanY);
  const wantX = (snapshot.minX + snapshot.maxX) * 0.5;
  const wantY = (snapshot.minY + snapshot.maxY) * 0.5;

  camera.x += (wantX - camera.x) * ease;
  camera.y += (wantY - camera.y) * ease;
  // Scale eases geometrically when closing in — a fixed fraction of a ratio,
  // so zooming in from 10 m/px and from 0.1 m/px feel the same — and snaps
  // when it has to widen, because a frame that has already cropped is worse
  // than a frame that moved abruptly.
  camera.scale =
    wantScale < camera.scale ? wantScale : camera.scale * (wantScale / camera.scale) ** ease;

  contain(camera, snapshot, widthPx, heightPx);
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
  const raw = TARGET_GRID_PX / scale;
  const power = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? power * 10;
}
