import { math, type ShipView, type Snapshot } from '../sim/index.js';
import { gridStep, type Camera } from './camera.js';

const { cos, sin, max, min, PI, sqrt, TAU } = math;

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
/**
 * Colours by team, chosen so the three layers of a turret always separate.
 *
 * A mount is drawn as its module box, then the sector it can traverse through,
 * then the barrel — and the ordering of *values* is what makes all three
 * legible rather than the ordering of hues. The sweep is a pale wash, so it
 * shows over the dark field as well as over the hull; the barrel is dark, so
 * it shows against that wash. A barrel never leaves its own sector — the two
 * share a radius — so it only ever has to contrast with the sweep, which is
 * why it can afford to be the darkest thing on the ship.
 *
 * The sweep is deliberately not team-tinted. It marks where a gun *could*
 * point rather than anything belonging to the ship, and colouring it by team
 * made it read as hull.
 */
const TEAM_COLOURS = [
  {
    hull: '#5b8dd6',
    trim: '#a8c8f0',
    pivot: '#2c4a72',
    ready: '#e9c05f',
  },
  {
    hull: '#d65b5b',
    trim: '#f0a8a8',
    pivot: '#722c2c',
    ready: '#e9c05f',
  },
];
const NEUTRAL = {
  hull: '#8a8a8a',
  trim: '#c4c4c4',
  pivot: '#4a4a4a',
  ready: '#e9c05f',
};
const BACKGROUND = '#0b0f16';
const GRID = '#161d29';
const TRACER = '#ffe6a8';
const TRACER_GLOW = '#ffb2a888';

/**
 * Tracer geometry, in seconds of flight per metre of calibre — so a round's
 * streak is as long as a bigger round's is, scaled by how big it is. The glow
 * leads slightly ahead of the round so its nose is visible against whatever it
 * is about to hit.
 */
const GLOW_LEAD = 0.025;
const GLOW_STREAK = 0.35;
const TRACER_STREAK = 0.3;

/**
 * Width of the tracer's halo, in calibres. Proportional to the round rather
 * than a fixed size, so that close up a light round is a small bright thing
 * and a heavy one is a large one — a fixed halo makes every round look the
 * same size at the zoom where its true size is finally legible.
 */
const GLOW_CALIBRES = 3;

/**
 * Smallest widths anything is drawn at on screen, in pixels.
 *
 * Zoomed out, honest widths go to a fraction of a pixel and detail that
 * carries meaning stops being drawn at all: a round's two colours collapse
 * into one, and a barrel — a few centimetres of steel — disappears, taking
 * with it the only indication of where a turret is pointing. Below these
 * floors a stroke is therefore drawn wider than life. Above them the true
 * width wins and what is on screen is to scale, which is the point of having
 * derived it from the mount in the first place.
 *
 * The glow's floor is the widest because it has to stay visible *around* the
 * tracer rather than merely be present. That ordering holds at every zoom, and
 * not by luck: where the tracer is at its floor the glow's larger floor wins,
 * and where the tracer is at its true width the glow is three times it, which
 * clears the glow's floor on its own.
 */
const MIN_GLOW_PX = 5;
const MIN_TRACER_PX = 2;
const MIN_BARREL_PX = 2;

/** A stroke at its true width, but never thinner than `minPx` on screen. */
function legibleWidth(physical: number, minPx: number, metresToPx: number): number {
  const floor = minPx / metresToPx;
  return physical > floor ? physical : floor;
}
const WELL = '#3a4e7a';

/** The firing arc: a pale wash with an optional edge to define it (currently disabled). */
const SWEEP = 'rgba(196, 210, 232, 0.2)';
const SWEEP_EDGE = 'rgba(196, 210, 232, 0)';

/**
 * How far the arc indicator reaches, as a multiple of the barrel's length.
 *
 * The quantity being shown is an *angle* — where the gun may shoot — and the
 * radius is only there to make that angle readable. Drawn at the barrel's own
 * length the wedge is too small to judge, and reads as the volume the barrel
 * sweeps rather than the sky it covers. Three times is enough to see the span
 * at a glance while staying well short of the gun's actual reach, which is
 * measured in kilometres and would swallow the battle.
 */
const ARC_RADIUS_SCALE = 3;

/** A barrel that is not clear to fire. Dark, because it sits on the pale sweep. */
const BARREL = '#8f6f25';
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
const PLUME_THRUST_PER_AREA = 0.5e4;

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
    ctx.restore();
  }
  ctx.restore();

  // Turrets are drawn in world space: a turret's bearing is a world bearing, so
  // rotating into the hull frame first would apply the hull's angle twice.
  const lineWidth = max(0.6, 1.5 / metresToPx);
  const c = cos(ship.angle);
  const s = sin(ship.angle);

  for (let t = 0; t < design.turrets.length; t++) {
    const mount = design.turrets[t]!.mount;
    const mx = ship.x + mount.x * c - mount.y * s;
    const my = ship.y + mount.x * s + mount.y * c;
    const reach = mount.muzzleOffset ?? 0;
    const left = mount.leftArc ?? PI;
    const right = mount.rightArc ?? PI;
    const rest = ship.angle + (mount.restBearing ?? 0);

    // Where the gun may shoot: a mount fouled by its own ship shows a narrow
    // wedge, one with clear sky a full disc. This is the layout's cost made
    // visible — DESIGN.md §3 has arcs derived from where a gun was put rather
    // than authored, and this is what that decision bought or cost, per mount.
    //
    // It is drawn symmetric about the rest bearing because the *model* is
    // symmetric, not because the ship is: an obstruction on one beam currently
    // costs the clear sector on the other too. ROADMAP.md §12 has the shape of
    // the fix, and this wedge is where it will show.
    if (reach > 0) {
      const span = reach * ARC_RADIUS_SCALE;
      ctx.fillStyle = SWEEP;
      ctx.strokeStyle = SWEEP_EDGE;
      ctx.lineWidth = lineWidth * 0.8;
      ctx.beginPath();
      if (left + right >= 2 * PI) {
        ctx.arc(mx, my, span, 0, TAU);
      } else {
        ctx.moveTo(mx, my);
        ctx.arc(mx, my, span, rest - right, rest + left);
        ctx.closePath();
      }
      ctx.fill();
      ctx.stroke();
    }

    // The rotating part itself: a disc at the mount, sized to the module it
    // sits in so a heavy mount looks heavy.
    const spec = design.modules[design.turrets[t]!.module]!.spec;
    const pivot = min(spec.length, spec.width) * 0.5;
    ctx.fillStyle = colours.pivot;
    ctx.beginPath();
    ctx.arc(mx, my, pivot, 0, TAU);
    ctx.fill();

    const ready = ship.turretReady[t] === true;
    const bearing = ship.turretBearings[t] ?? 0;
    const dirX = cos(bearing);
    const dirY = sin(bearing);
    const gun = design.turrets[t]!.gun;
    const count = gun.barrelCount;
    const spacing = gun.barrelSpacing;

    ctx.strokeStyle = ready ? colours.ready : BARREL;
    // The barrel's outer diameter, twice the calibre, which is the tube the
    // annulus in `moduleStats` charges steel for — not the bore.
    const physicalWidth = 2 * gun.calibre;
    // Barrels are allowed to overlap once the floor has widened them past their
    // own gaps, which happens only when the whole ship is a hundred-odd pixels
    // across. A row that closes into one solid bar still says where the turret
    // is pointing, where holding each barrel inside its gap would shrink them
    // back below the floor and say nothing. Overlap is free: the barrel colours
    // are opaque, so a bar drawn twice looks like a bar.
    ctx.lineWidth = legibleWidth(physicalWidth, MIN_BARREL_PX, metresToPx);
    ctx.beginPath();
    for (let k = 0; k < count; k++) {
      const lat = count > 1 ? (k - (count - 1) * 0.5) * spacing : 0;
      const bx = mx - dirY * lat;
      const by = my + dirX * lat;
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + dirX * reach, by + dirY * reach);
    }
    ctx.stroke();
  }

  drawPlumes(ctx, ship);
}

/**
 * Exhaust, in a pass of its own after the turrets.
 *
 * Drawn last of the ship's parts because a plume is in front of the hull, not
 * part of it: sharing the module pass put it *under* the sector a nearby
 * turret sweeps, which dimmed a burning engine to the colour of a shadow.
 */
function drawPlumes(ctx: CanvasRenderingContext2D, ship: ShipView): void {
  const design = ship.design;
  // Thrusters are counted as they are met, because a design lists its
  // thrusters in the order its modules appear.
  let thruster = 0;

  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(ship.angle);
  for (let i = 0; i < design.modules.length; i++) {
    const m = design.modules[i]!;
    const spec = m.spec;
    if (spec.kind !== 'thruster') continue;
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(m.angle);

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
    ctx.restore();
  }
  ctx.restore();
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

  // Tracers, in two passes so that every glow sits under every streak. Both
  // are sized from the round's calibre and floored on screen, so a round is
  // true to size close up and legible from far out. Streak length scales with
  // calibre too, which makes a heavy shell read as a slower, fatter round than
  // a light one.
  //
  // A stroke per round rather than one path for all of them, which the glow's
  // translucency notices: two rounds whose glows cross now brighten where they
  // meet, where a single stroke over one path would have composited once.
  // Worth it for a halo that is the round's own size, and rare enough not to
  // read as anything but two tracers crossing.
  ctx.strokeStyle = TRACER_GLOW;
  for (let i = 0; i < snapshot.projectileCount; i++) {
    const calibre = snapshot.projectileWidth[i]!;
    const x = snapshot.projectileX[i]! + snapshot.projectileVx[i]! * GLOW_LEAD * calibre;
    const y = snapshot.projectileY[i]! + snapshot.projectileVy[i]! * GLOW_LEAD * calibre;
    ctx.lineWidth = legibleWidth(GLOW_CALIBRES * calibre, MIN_GLOW_PX, camera.scale);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(
      x - snapshot.projectileVx[i]! * GLOW_STREAK * calibre,
      y - snapshot.projectileVy[i]! * GLOW_STREAK * calibre,
    );
    ctx.stroke();
  }

  // A pass per round, because each carries its own width. Cheap at the round
  // counts a battle reaches; if that ever stops being true, bucket by width
  // rather than reaching for a single average.
  ctx.strokeStyle = TRACER;
  for (let i = 0; i < snapshot.projectileCount; i++) {
    const calibre = snapshot.projectileWidth[i]!;
    const x = snapshot.projectileX[i]!;
    const y = snapshot.projectileY[i]!;
    // The round *is* its calibre wide. Twice the calibre is the barrel's outer
    // diameter — right for the tube, wrong for what comes out of it.
    ctx.lineWidth = legibleWidth(calibre, MIN_TRACER_PX, camera.scale);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(
      x - snapshot.projectileVx[i]! * TRACER_STREAK * calibre,
      y - snapshot.projectileVy[i]! * TRACER_STREAK * calibre,
    );
    ctx.stroke();
  }
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
