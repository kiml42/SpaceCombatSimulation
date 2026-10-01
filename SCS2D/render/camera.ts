import { math, type ShipView, type Snapshot } from '../sim/index.js';

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
  /**
   * How fast following ships would carry the camera, m/s, kept while paused.
   * Streaks are drawn relative to it. Still when absent.
   */
  vx?: number;
  vy?: number;
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

/**
 * How much wider than its bounds a fitted view is — the breathing room round
 * the scene. Named because it decides more than the zoom: the outermost ship
 * in a settled frame sits at exactly its reciprocal of the way out, which is
 * what `FULL_PACE_FRACTION` is placed against.
 */
const FIT_MARGIN = 1.25;

/** Pixels per metre at which a snapshot's bounds fill a view, with a margin round them. */
export function fitScale(snapshot: Snapshot, widthPx: number, heightPx: number): number {
  const spanX = max(snapshot.maxX - snapshot.minX, 1) * FIT_MARGIN;
  const spanY = max(snapshot.maxY - snapshot.minY, 1) * FIT_MARGIN;
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
 * How far out a ship may sit and still be kept up with at its own speed, as a
 * fraction of the distance from the middle of the frame to its edge.
 *
 * **Set outside where a settled frame puts anything.** `fitScale` leaves
 * `FIT_MARGIN` round the bounds, so a camera that has finished fitting a scene
 * has its outermost ship at exactly the reciprocal of that — four fifths of
 * the way out, whatever the scene is. Holding back inside that would tax every
 * ordinary battle, and the feed-forward exists precisely to stop the camera
 * trailing its ships. Past it lies only what the camera has *not* caught up
 * with: the scale widens the instant something distant appears, while the
 * centre still has a second of easing to cross, and for that second the
 * newcomer is out on the edge. That second is the one this is for.
 */
const FULL_PACE_FRACTION = 0.85;

/**
 * How much of a ship's speed the camera takes up when that ship is right at
 * the edge of the frame.
 *
 * Short of all of it on purpose. Matching a ship exactly holds it wherever it
 * happens to be, so something entering at the edge stays pinned to the edge
 * for as long as it flies straight — the camera dutifully keeping the worst
 * composition it was handed. Falling short lets the ship make ground towards
 * the middle under its own speed, and the pace comes up to meet it as it gets
 * there.
 */
const EDGE_PACE = 0.5;

/** How much of a ship's speed to take up, for a ship that far out of the middle. */
function matchedPace(out: number): number {
  if (out <= FULL_PACE_FRACTION) return 1;
  const past = (out - FULL_PACE_FRACTION) / (1 - FULL_PACE_FRACTION);
  return 1 - past * (1 - EDGE_PACE);
}

/**
 * What the camera would rather be following, best first.
 *
 * A battle is what anybody is watching, so ships with somebody aboard come
 * first and nothing else is looked at while there is one in shot. Past that
 * the fallbacks are about not abandoning the viewer: a fight that ends with
 * every core shot out should leave the camera travelling with the hulks it
 * made rather than watching them slide off the edge, and a hull that came
 * apart entirely should leave it travelling with the pieces.
 *
 * Wreckage is last rather than lumped in with the hulks because the two are
 * different pictures. A hulk is a ship — a thing that was being flown a moment
 * ago, and the one the viewer was watching; a severed piece is debris, and
 * there is usually far more of it, so counting both together would hand the
 * frame to whichever hull shed the most.
 *
 * Fixed at module scope so a frame allocates nothing.
 */
const FOLLOW_ORDER: readonly ((ship: ShipView) => boolean)[] = [
  (ship) => ship.hasControl,
  (ship) => !ship.hasControl && !ship.isDerelict,
  (ship) => ship.isDerelict,
];

/**
 * Carry the camera along with the ships it is looking at.
 *
 * With one ship in the middle of the frame this holds it perfectly still on
 * screen; with several it removes the part of their motion they share and
 * leaves only the spread.
 *
 * **Only the ships on screen count.** The camera's job is to hold what the
 * viewer is looking at still, so a ship they have panned away from, or zoomed
 * past, is not part of the answer. A ship counts while any part of it is in
 * shot, so one crossing the edge does not flick in and out.
 *
 * **Bigger ships pull harder**, by their radius: when a capital and its
 * escorts are in frame together it is the capital the eye is on, and a camera
 * that averaged them evenly would be steered by whichever side brought the
 * most fighters.
 *
 * **And ships near the middle pull harder than ships near the edge — which is
 * a statement about pace, not only about the average.** The attenuated
 * velocities are divided by the *unattenuated* weights, so holding back is
 * not normalised away: a lone ship entering at the edge is followed at part of
 * its speed, comes in under the difference, and is matched exactly once it is
 * within `FULL_PACE_FRACTION` of the middle. Dividing by the attenuated
 * weights instead would cancel the whole effect for a single ship, which is
 * the case it is most wanted in.
 *
 * `dt` is *simulated* seconds — this is the half of the camera that chases the
 * battle, so it runs on the battle's clock. The easing in `frame` is the half
 * that settles, and runs on the frame.
 *
 * The pace is left in `camera.vx`/`vy` even when `dt` is zero, so a paused
 * picture is drawn as if it were still moving.
 */
export function moveWithVisibleShips(
  camera: Camera,
  snapshot: Snapshot,
  dt: number,
  widthPx: number,
  heightPx: number,
): void {
  camera.vx = 0;
  camera.vy = 0;
  if (snapshot.shipCount === 0) return;
  if (!(camera.scale > 0) || !(widthPx > 0) || !(heightPx > 0)) return;

  // The view in metres, about the camera.
  const halfWidth = widthPx / (2 * camera.scale);
  const halfHeight = heightPx / (2 * camera.scale);

  // The first kind of thing that has anything in shot is the one followed, and
  // the rest are not looked at. Nothing in shot at all — panned away, or an
  // empty field — and the camera holds still rather than drifting after ships
  // the viewer has deliberately left behind, and rather than dividing by none
  // of them, which would put the camera at NaN and take the view with it.
  for (const worthFollowing of FOLLOW_ORDER) {
    if (keepPaceWith(camera, snapshot, halfWidth, halfHeight, worthFollowing)) break;
  }
  if (dt > 0) {
    camera.x += camera.vx * dt;
    camera.y += camera.vy * dt;
  }
}

/**
 * Set the camera's pace to that of the ships in shot that `worthFollowing`
 * accepts, and say whether there were any. A pass that finds nothing leaves
 * the camera exactly as it was, so the caller can try the next kind.
 */
function keepPaceWith(
  camera: Camera,
  snapshot: Snapshot,
  halfWidth: number,
  halfHeight: number,
  worthFollowing: (ship: ShipView) => boolean,
): boolean {
  let vx = 0;
  let vy = 0;
  // Unattenuated on purpose: see the note on pace above.
  let weight = 0;

  for (let i = 0; i < snapshot.shipCount; i++) {
    const ship = snapshot.ships[i]!;
    if (!worthFollowing(ship)) continue;
    const r = ship.design.radius;
    const outX = abs(ship.x - camera.x);
    if (outX > halfWidth + r) continue;
    const outY = abs(ship.y - camera.y);
    if (outY > halfHeight + r) continue;

    // How far out of the middle it sits, by whichever axis has it nearer an
    // edge — **measured to the nearest part of the hull rather than to the
    // middle of it**, which is the difference between a small ship and a big
    // one and not a refinement.
    //
    // A ship wider than the view is under the camera wherever the camera is
    // pointed, so where its centre of mass happens to be says nothing about
    // whether the viewer is looking at it. Measured centre to centre, zooming
    // in on a capital's stern puts its middle far outside the frame, reads
    // that as a ship out on the edge, and keeps only part of its pace — so the
    // view slides down the hull towards the middle of the ship while the
    // viewer is trying to watch the engines. Measured to the hull, the same
    // ship is dead centre and held exactly.
    //
    // The bounding radius is generous for a long thin hull, so this errs
    // towards holding a big ship still, which is the forgiving direction.
    const out = min(
      1,
      max(max(0, outX - r) / halfWidth, max(0, outY - r) / halfHeight),
    );
    const pace = matchedPace(out);
    vx += ship.vx * r * pace;
    vy += ship.vy * r * pace;
    weight += r;
  }

  if (!(weight > 0)) return false;
  camera.vx = vx / weight;
  camera.vy = vy / weight;
  return true;
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
