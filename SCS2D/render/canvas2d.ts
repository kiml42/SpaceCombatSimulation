import { math, type ShipView, type Snapshot } from '../sim/index.js';

const { cos, sin, max, min, sqrt, TAU } = math;

/**
 * A Canvas2D view of a snapshot.
 *
 * **A stop-gap until the WebGL renderer (DESIGN.md §5), which replaces it.**
 * It exists to make the simulation watchable rather than only checksummable,
 * which is the thing a golden test cannot do: a duel can be bit-for-bit
 * reproducible and still look wrong, and nobody finds that out from a hash.
 * What survives the replacement is the shape — a function of a snapshot, with
 * no access to the simulation and no state of its own beyond the camera.
 *
 * It knows no game rules. Everything it draws, it draws because the snapshot
 * says so: module boxes from the design, barrels from turret bearings, tracers
 * from projectile velocity. It never asks who is winning.
 */

/** Colours by team, plus the furniture. Deliberately few. */
const TEAM_COLOURS = [
  { hull: '#5b8dd6', trim: '#a8c8f0', ready: '#ffd166' },
  { hull: '#d65b5b', trim: '#f0a8a8', ready: '#ffd166' },
];
const NEUTRAL = { hull: '#8a8a8a', trim: '#c4c4c4', ready: '#ffd166' };
const BACKGROUND = '#0b0f16';
const GRID = '#161d29';
const TRACER = '#ffe6a8';
const WELL = '#3a4e7a';

/** Roughly how far apart grid lines should sit on screen, pixels. */
const TARGET_GRID_PX = 90;

export interface Camera {
  /** Centre of the view, world coordinates. */
  x: number;
  y: number;
  /** Pixels per metre. */
  scale: number;
}

/**
 * A camera that keeps the snapshot's bounds in shot, easing rather than
 * snapping — except when easing would crop.
 *
 * Tracking the bounds exactly makes the view twitch at every small change, so
 * the target is approached at a fixed fraction per frame. But easing alone
 * loses the race whenever the scene expands faster than the camera follows,
 * which at eight times speed it does, and something ends up cut off at the
 * edge. So the two directions are not symmetric: **zoom out at once, zoom in
 * gently**, and after easing, pull the centre back far enough that the bounds
 * are inside the view. The result settles smoothly and never crops, which the
 * simpler version could not promise.
 *
 * These are smoothing constants, not physics, which is why they live out here
 * rather than in `sim/`.
 */
export function frame(
  camera: Camera,
  snapshot: Snapshot,
  widthPx: number,
  heightPx: number,
  ease = 0.08,
): void {
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

function shipColours(team: number): (typeof TEAM_COLOURS)[number] {
  return TEAM_COLOURS[team] ?? NEUTRAL;
}

function drawShip(ctx: CanvasRenderingContext2D, ship: ShipView, metresToPx: number): void {
  const colours = shipColours(ship.team);
  const design = ship.design;

  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(ship.angle);

  // Module boxes, in the body frame the design already put them in.
  for (let i = 0; i < design.modules.length; i++) {
    const m = design.modules[i]!;
    const spec = m.spec;
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(m.angle);
    ctx.fillStyle = spec.kind === 'structure' ? colours.hull : colours.trim;
    ctx.fillRect(-spec.length / 2, -spec.width / 2, spec.length, spec.width);
    if (spec.kind === 'thruster') {
      // A short spur the other way, so which way a thruster pushes is visible
      // without having to know the convention.
      ctx.fillStyle = colours.trim;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(-spec.length / 2 - spec.length * 0.4, -spec.width / 4, spec.length * 0.4, spec.width / 2);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
  ctx.restore();

  // Barrels are drawn in world space: a turret's bearing is a world bearing,
  // so rotating into the hull frame first would apply the hull's angle twice.
  const lineWidth = max(0.6, 1.5 / metresToPx);
  for (let t = 0; t < design.turrets.length; t++) {
    const mount = design.turrets[t]!.mount;
    const bearing = ship.turretBearings[t] ?? 0;
    const c = cos(ship.angle);
    const s = sin(ship.angle);
    const mx = ship.x + mount.x * c - mount.y * s;
    const my = ship.y + mount.x * s + mount.y * c;
    const reach = mount.muzzleOffset ?? 0;

    ctx.strokeStyle = ship.turretReady[t] === true ? colours.ready : colours.trim;
    ctx.lineWidth = lineWidth * (ship.turretReady[t] === true ? 2 : 1.2);
    ctx.beginPath();
    ctx.moveTo(mx, my);
    ctx.lineTo(mx + cos(bearing) * reach, my + sin(bearing) * reach);
    ctx.stroke();
  }
}

/** Draw one snapshot. The canvas is cleared first; nothing persists between frames. */
export function draw(
  ctx: CanvasRenderingContext2D,
  snapshot: Snapshot,
  camera: Camera,
  widthPx: number,
  heightPx: number,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, widthPx, heightPx);

  // World to screen: metres up, y flipped so +y is up as the maths intends.
  ctx.translate(widthPx / 2, heightPx / 2);
  ctx.scale(camera.scale, -camera.scale);
  ctx.translate(-camera.x, -camera.y);

  drawGrid(ctx, camera, widthPx, heightPx);
  drawWells(ctx, snapshot, camera);

  for (let i = 0; i < snapshot.shipCount; i++) {
    drawShip(ctx, snapshot.ships[i]!, camera.scale);
  }

  // Tracers, drawn along a fixed slice of each round's own velocity, so a
  // faster round draws a longer streak.
  ctx.strokeStyle = TRACER;
  ctx.lineWidth = max(0.5, 1.5 / camera.scale);
  ctx.beginPath();
  for (let i = 0; i < snapshot.projectileCount; i++) {
    const x = snapshot.projectileX[i]!;
    const y = snapshot.projectileY[i]!;
    ctx.moveTo(x, y);
    ctx.lineTo(x - snapshot.projectileVx[i]! * 0.03, y - snapshot.projectileVy[i]! * 0.03);
  }
  ctx.stroke();
}

/**
 * Gravity wells, as rings at the radii where their pull reaches round values.
 *
 * A well has no body to draw — it is a point mass — so what is drawn is its
 * *effect*: the distance at which it pulls at 1 m/s², and at a tenth of that.
 * Without this, ships and rounds curve for no visible reason, which reads as a
 * bug in the physics rather than the physics working.
 */
function drawWells(ctx: CanvasRenderingContext2D, snapshot: Snapshot, camera: Camera): void {
  ctx.strokeStyle = WELL;
  ctx.lineWidth = 1 / camera.scale;
  for (let i = 0; i < snapshot.wells.length; i++) {
    const well = snapshot.wells[i]!;
    for (const pull of [1, 0.1]) {
      // r where gm/r² is `pull`.
      const r = sqrt(well.gm / pull);
      ctx.beginPath();
      ctx.arc(well.x, well.y, r, 0, TAU);
      ctx.stroke();
    }
    // A cross at the centre, sized in pixels so it stays visible at any zoom.
    const arm = 8 / camera.scale;
    ctx.beginPath();
    ctx.moveTo(well.x - arm, well.y);
    ctx.lineTo(well.x + arm, well.y);
    ctx.moveTo(well.x, well.y - arm);
    ctx.lineTo(well.x, well.y + arm);
    ctx.stroke();
  }
}

/**
 * A grid at a round spacing, chosen so the lines stay a comfortable distance
 * apart on screen however far the camera has zoomed out. Without it there is
 * nothing to judge scale or motion against — two ships closing on a black
 * field look like two ships sitting still.
 */
function drawGrid(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  widthPx: number,
  heightPx: number,
): void {
  const step = gridStep(camera.scale);

  const halfW = widthPx / 2 / camera.scale;
  const halfH = heightPx / 2 / camera.scale;
  const x0 = Math.floor((camera.x - halfW) / step) * step;
  const x1 = camera.x + halfW;
  const y0 = Math.floor((camera.y - halfH) / step) * step;
  const y1 = camera.y + halfH;

  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1 / camera.scale;
  ctx.beginPath();
  for (let x = x0; x <= x1; x += step) {
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y1);
  }
  for (let y = y0; y <= y1; y += step) {
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
  }
  ctx.stroke();
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
