import { math, type ShipView, type Snapshot } from '../sim/index.js';
import { gridStep, type Camera } from './camera.js';

const { cos, sin, max, sqrt, TAU } = math;

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
const PLUME = '#ffd9a0';
const PLUME_CORE = '#fff4e0';

/**
 * Newtons of thrust per square metre of drawn plume.
 *
 * The plume is a triangle as wide as the engine's exit, stretching with
 * throttle — so its *area* is proportional to the force being produced, which
 * is the quantity worth reading off a picture. It falls out of that: a
 * thruster's thrust scales with its exit area, so thrust per unit width is the
 * same for every engine, and every engine therefore reaches the same plume
 * length at full throttle. That is what it should look like — they share an
 * exhaust velocity, and a bigger engine is a wider flame, not a longer one.
 */
const PLUME_THRUST_PER_AREA = 1.5e4;

function shipColours(team: number): (typeof TEAM_COLOURS)[number] {
  return TEAM_COLOURS[team] ?? NEUTRAL;
}

function drawShip(ctx: CanvasRenderingContext2D, ship: ShipView, metresToPx: number): void {
  const colours = shipColours(ship.team);
  const design = ship.design;

  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(ship.angle);

  // Module boxes, in the body frame the design already put them in. Thrusters
  // are counted as they are met, because a design lists its thrusters in the
  // order its modules appear.
  let thruster = 0;
  for (let i = 0; i < design.modules.length; i++) {
    const m = design.modules[i]!;
    const spec = m.spec;
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(m.angle);
    ctx.fillStyle = spec.kind === 'structure' ? colours.hull : colours.trim;
    ctx.fillRect(-spec.length / 2, -spec.width / 2, spec.length, spec.width);
    if (spec.kind === 'thruster') {
      // Exhaust leaves the way the thruster does not push, so the plume is
      // drawn along -x in the module's own frame.
      const throttle = ship.throttles[thruster] ?? 0;
      const force = throttle * (design.thrusters[thruster]?.maxThrust ?? 0);
      thruster++;
      if (force > 0) {
        const root = -spec.length / 2;
        const reach = force / (spec.width * PLUME_THRUST_PER_AREA);
        ctx.fillStyle = PLUME;
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.moveTo(root, -spec.width / 2);
        ctx.lineTo(root, spec.width / 2);
        ctx.lineTo(root - reach, 0);
        ctx.closePath();
        ctx.fill();
        // A brighter core, a third the width, so a hard burn reads as hotter
        // rather than merely longer.
        ctx.fillStyle = PLUME_CORE;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.moveTo(root, -spec.width / 6);
        ctx.lineTo(root, spec.width / 6);
        ctx.lineTo(root - reach * 0.55, 0);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }
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
