import {
  hullMountGeometry,
  isHullMount,
  math,
  nozzleOffset,
  nozzleReach,
  plumeIntensity,
  thrusterGeometry,
  type ShipView,
  type Snapshot,
} from '../sim/index.js';
import { gridStep, type Camera } from './camera.js';
import { beamAlpha, BEAM_GLOW_ALPHA, flooredFade, legibleWidth, plumeAlpha } from './strokes.js';
import { flashFade, flashPosition, type FlashAnchor, type Flashes } from './flashes.js';
import { iconAlpha, ICON_OUTLINE, ICON_PX } from './icons.js';

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
 *
 * **A side differs from the others by hue alone.** Every palette here is the
 * same three tones — a mid hull, a pale trim, a dark pivot — turned round the
 * wheel, so the value ordering that makes a turret legible holds for every
 * side rather than being got right once for blue and approximated afterwards.
 * The hues are spread as far apart as four will go without colliding with
 * something that already means a thing: a barrel goes amber when it is on
 * target, and a beam is a bright green, so the sides take blue, red, green and
 * magenta and leave the yellows alone.
 *
 * Four because that is a free-for-all of a size worth watching — an evolution
 * match puts every entrant on its own side (DESIGN.md §7). A fifth side is
 * drawn neutral grey rather than in a colour nobody could name, which is
 * honest about there being more sides than the picture can tell apart.
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
  {
    hull: '#5bd66f',
    trim: '#a8f0b4',
    pivot: '#2c7238',
    ready: '#e9c05f',
  },
  {
    hull: '#d65bd6',
    trim: '#f0a8f0',
    pivot: '#722c72',
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

const BEAM = '#3df72c';
const BEAM_GLOW = '#a8f132';


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
/** A flash is never smaller than this on screen, however far out the camera is. */
const MIN_FLASH_PX = 2;

/** A module that has taken everything it can: still there, no longer anything. */
const WRECKAGE = '#3c4048';

/** An impact: the white-hot moment, and the warmer flare around it. */
const FLASH_CORE = '#fff6e2';
const FLASH_GLOW = '#ffb257';
/** A beam's, which reads as the beam's own colour boiling the hull away. */
const BEAM_FLASH_CORE = '#eaffd9';
const BEAM_FLASH_GLOW = '#8ef04a';

const WELL = '#3a4e7a';

/** The firing arc: a pale wash with an optional edge to define it (currently disabled). */
const SWEEP = 'rgba(196, 210, 232, 0.2)';
const SWEEP_EDGE = 'rgba(196, 210, 232, 0)';

/**
 * How far the arc indicator reaches, as a multiple of the mount's own face.
 *
 * The quantity being shown is an *angle* — where the gun may shoot — and the
 * radius is only there to make that angle readable. Drawn at the mount's own
 * size the wedge is too small to judge, and reads as the volume the mount
 * sweeps rather than the sky it covers. Four times is enough to see the span
 * at a glance while staying well short of the weapon's actual reach, which is
 * measured in kilometres and would swallow the battle.
 *
 * From the mount rather than from the barrel, because a barrel is not a thing
 * every weapon has. A beam mount's emitter housing is about as deep as it is
 * wide, so scaling from that drew a wedge a metre or so across — invisible,
 * and invisible in a way that reads as a mount having no arc rather than as
 * the renderer having nothing to scale by. The mount's smaller face is the
 * same quantity the pivot disc is drawn at and the same one the mount's own
 * footprint is reckoned by, and every weapon has one.
 *
 * The bounds are guards rather than tuning: nothing in the current fleet
 * reaches either, and they are there so that a mount far outside today's range
 * of sizes still draws a wedge that can be read and does not swamp the ship
 * carrying it.
 */
const ARC_RADIUS_SCALE = 4;
const ARC_MIN_RADIUS = 8;
const ARC_MAX_RADIUS = 40;

/** A barrel that is not clear to fire. Dark, because it sits on the pale sweep. */
const BARREL = '#8f6f25';
/** Flame colours, as the RGB a gradient fades to transparent from. */
const PLUME = '255, 217, 160';
const PLUME_CORE = '255, 244, 224';


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
    // Wreckage: still there, still stopping shells, no longer doing its job.
    // Drawn as what it is rather than removed, which is what §4 means by
    // conserving matter — and it is the only way to see a ship being killed
    // module by module rather than simply going quiet.
    // Optional, because a view can be built by hand: the editor's preview and
    // the camera's tests both do, and neither has anything to be damaged.
    const integrity = ship.integrity?.[i] ?? 1;
    // A core is drawn in the darkest of the team's colours: the compartment
    // the ship is flown from is worth being able to find at a glance, since
    // shooting it out is what leaves a hulk.
    ctx.fillStyle =
      integrity <= 0
        ? WRECKAGE
        : spec.kind === 'structure'
          ? colours.hull
          : spec.kind === 'core'
            ? colours.pivot
            : colours.trim;
    ctx.globalAlpha = integrity <= 0 ? 1 : 0.45 + 0.55 * integrity;
    const halfLength = spec.length / 2;
    const halfWidth = spec.width / 2;
    if (spec.kind === 'thruster') {
      // An engine is a machinery block with bells on the back of it, and it is
      // drawn as exactly that: the block a box like any other module, each
      // bell flaring from its throat to the exit. Local +x is the way it
      // pushes and the face it is bolted on by, so the bells are at -x and
      // widen as they go, which is both how a rocket is shaped and the
      // direction the plume already leaves in.
      //
      // This is the one drawing that is not an approximation of the module:
      // the throat fraction it tapers from is the number the thrust is worked
      // out from, so what the bell looks like is what it does.
      const engine = thrusterGeometry(spec);
      ctx.fillRect(
        halfLength - engine.machineryLength,
        -halfWidth,
        engine.machineryLength,
        spec.width,
      );
      const throat = engine.throatWidth / 2;
      const exit = engine.exitWidth / 2;
      const mouth = halfLength - engine.machineryLength;
      for (let n = 0; n < engine.nozzles; n++) {
        const across = nozzleOffset(engine, n);
        ctx.beginPath();
        ctx.moveTo(mouth, across - throat);
        ctx.lineTo(mouth, across + throat);
        ctx.lineTo(-halfLength, across + exit);
        ctx.lineTo(-halfLength, across - exit);
        ctx.closePath();
        ctx.fill();
      }
    } else if (isHullMount(spec.kind)) {
      // Only the block. The barrel is drawn by the turret pass, from the root
      // it trains about and at the bearing it is actually pointing — which is
      // the whole reason it is a separate piece rather than part of the box.
      const mount = hullMountGeometry(spec);
      ctx.fillRect(-halfLength, -halfWidth, mount.blockLength, spec.width);
    } else {
      ctx.fillRect(-halfLength, -halfWidth, spec.length, spec.width);
    }
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
    // Asymmetric, because the model is: an obstruction off one beam costs the
    // sweep that way alone. The wedge runs from `rest - rightArc` to
    // `rest + leftArc`, since bearings increase anticlockwise and +y is to
    // port — so the left arc is the *upper* bound. Drawing it the other way
    // round looks perfectly plausible on a symmetric ship and mirrors every
    // gun's arc on an asymmetric one.
    const spec = design.modules[design.turrets[t]!.module]!.spec;
    const face = min(spec.length, spec.width);
    // A wrecked mount shows no arc: the wash says "this gun may shoot here",
    // which is a promise a gun that cannot shoot is not making. The barrel
    // stays, because it is still there.
    if (ship.turretDisabled?.[t] !== true) {
      const scaled = face * ARC_RADIUS_SCALE;
      const span =
        scaled < ARC_MIN_RADIUS
          ? ARC_MIN_RADIUS
          : scaled > ARC_MAX_RADIUS
            ? ARC_MAX_RADIUS
            : scaled;
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
    // sits in so a heavy mount looks heavy. A hull mount has none — what turns
    // there is a barrel on trunnions, not a ring carrying a house, and a disc
    // drawn at its root would say it was a turret let into the hull.
    if (!isHullMount(spec.kind)) {
      const pivot = face * 0.5;
      ctx.fillStyle = colours.pivot;
      ctx.beginPath();
      ctx.arc(mx, my, pivot, 0, TAU);
      ctx.fill();
    }

    const ready = ship.turretReady[t] === true;
    const bearing = ship.turretBearings[t] ?? 0;
    const dirX = cos(bearing);
    const dirY = sin(bearing);
    const gun = design.turrets[t]!.gun;
    const count = gun.barrelCount;
    const spacing = gun.barrelSpacing;

    ctx.strokeStyle = ready ? colours.ready : BARREL;
    // Twice the calibre: for a gun that is the barrel's outer diameter, the
    // tube the annulus in `moduleStats` charges steel for rather than the bore.
    // For a beam mount it is the housing round the optic rather than the optic
    // itself, which comes to the same drawn width and wants no special case —
    // and the two read quite differently anyway, a laser's housing being about
    // as deep as it is wide where a barrel is fifty times.
    // A hull mount knows its outlets' width outright, and for a lens that is
    // the lens rather than twice it.
    const physicalWidth = isHullMount(spec.kind) ? hullMountGeometry(spec).outletWidth : 2 * gun.calibre;
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
      // One flame per nozzle, the same triangles the burn samples its rays
      // across. How hot it burns is its opacity, and it fades to nothing at
      // its tip the way its share of the power does, so the brightest part of
      // the picture is the part doing the most damage.
      const engine = thrusterGeometry(spec);
      const root = -spec.length / 2;
      const reach = nozzleReach(engine, force);
      const alpha = plumeAlpha(plumeIntensity(engine, force));
      const half = engine.exitWidth / 2;
      const flame = fade(ctx, root, reach, PLUME, alpha);
      // A brighter core, a third the width, so a hard burn reads as hotter
      // rather than merely longer.
      const core = fade(ctx, root, reach * 0.55, PLUME_CORE, min(1, alpha * 1.4));
      for (let n = 0; n < engine.nozzles; n++) {
        const across = nozzleOffset(engine, n);
        ctx.fillStyle = flame;
        ctx.beginPath();
        ctx.moveTo(root, across - half);
        ctx.lineTo(root, across + half);
        ctx.lineTo(root - reach, across);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.moveTo(root, across - half / 3);
        ctx.lineTo(root, across + half / 3);
        ctx.lineTo(root - reach * 0.55, across);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }
  ctx.restore();
}

/** A flame's fill: `alpha` at the nozzle, fading to nothing `length` aft of it. */
function fade(
  ctx: CanvasRenderingContext2D,
  root: number,
  length: number,
  rgb: string,
  alpha: number,
): CanvasGradient {
  const gradient = ctx.createLinearGradient(root, 0, root - length, 0);
  gradient.addColorStop(0, `rgba(${rgb}, ${alpha})`);
  gradient.addColorStop(1, `rgba(${rgb}, 0)`);
  return gradient;
}

/**
 * A ship's icon: an arrowhead in its team's colour, pointing the way it is.
 *
 * Drawn at a fixed size on screen rather than in metres, which is the whole
 * point of it — the hull shrinks with the zoom and this does not, so a
 * skirmish seen from far enough out to fit is still a picture of ships facing
 * each other rather than a field of specks. `render/icons.ts` decides when it
 * shows and how solid it is.
 *
 * **The team's colour is for a ship anybody is still aboard, and nothing
 * else.** Not for one that can still fight: a hull with a sound core and
 * neither gun nor engine is somebody's ship, and drawing it grey said the
 * opposite about an entire generation of engineless craft. What grey means
 * here is that the core is out — the one thing that stops a hull being a
 * ship — which is also the only state in which the arrowhead is telling you
 * about something you can do nothing with and nothing can be done with.
 *
 * A derelict piece — a severed chunk, with nobody ever aboard it — gets no
 * icon at all: it has no facing worth pointing out, and a debris field that
 * drew as many arrowheads as the battle that made it would count as ships
 * wreckage that no longer is any. A mission-killed hull keeps its icon in
 * grey rather than losing it, because it is still a solid thing in the way,
 * and at the zoom where icons are what you are reading, losing it would make
 * it vanish rather than read as a hulk.
 */
function drawIcon(ctx: CanvasRenderingContext2D, ship: ShipView, metresToPx: number): void {
  if (ship.isDerelict) return;
  const alpha = iconAlpha(ship.design.radius * 2 * metresToPx);
  if (alpha <= 0) return;
  const colours = ship.hasControl ? shipColours(ship.team) : NEUTRAL;
  const size = ICON_PX / metresToPx;

  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(ship.angle);
  ctx.scale(size, size);
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(ICON_OUTLINE[0]![0], ICON_OUTLINE[0]![1]);
  for (let i = 1; i < ICON_OUTLINE.length; i++) {
    ctx.lineTo(ICON_OUTLINE[i]![0], ICON_OUTLINE[i]![1]);
  }
  ctx.closePath();
  ctx.fillStyle = colours.hull;
  ctx.fill();
  // An outline in the lighter of the same two colours, so the arrowhead holds
  // its shape against the hull it is sitting on as well as against the field.
  ctx.strokeStyle = colours.trim;
  ctx.lineWidth = 1 / ICON_PX;
  ctx.stroke();
  ctx.restore();
}

/** Draw one snapshot. The canvas is cleared first; nothing persists between frames. */
export function draw(
  ctx: CanvasRenderingContext2D,
  snapshot: Snapshot,
  camera: Camera,
  widthPx: number,
  heightPx: number,
  flashes?: Flashes,
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

  // Icons in a pass of their own, after every hull: an icon stands for the
  // ship as a whole, so it belongs over its neighbours rather than under
  // whichever of them happens to be drawn next.
  for (let i = 0; i < snapshot.shipCount; i++) {
    drawIcon(ctx, snapshot.ships[i]!, camera.scale);
  }

  drawProjectiles(ctx, snapshot, camera);
  drawBeams(ctx, snapshot, camera);
  if (flashes !== undefined) drawFlashes(ctx, snapshot, flashes, camera);
}

/** The ship a flash is riding, or null when nothing in the picture is it. */
function shipByBody(snapshot: Snapshot, body: number): FlashAnchor | null {
  if (body < 0) return null;
  for (let i = 0; i < snapshot.shipCount; i++) {
    const ship = snapshot.ships[i]!;
    if (ship.body === body) return ship;
  }
  return null;
}

/**
 * Impacts, as a hot core inside a warmer flare.
 *
 * Drawn last and additively, so a flash reads as light rather than as paint: a
 * hit on a hull brightens the hull rather than covering it, and two hits in
 * the same place are brighter than one.
 */
function drawFlashes(
  ctx: CanvasRenderingContext2D,
  snapshot: Snapshot,
  flashes: Flashes,
  camera: Camera,
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < flashes.count; i++) {
    const fade = flashFade(flashes.age[i]!, flashes.lifetime[i]!);
    if (fade <= 0) continue;
    const beam = flashes.kind[i] === 1;
    // Floored on screen, so a hit is visible from far enough out to see the
    // battle it is part of.
    const radius = max(flashes.radius[i]! * fade, MIN_FLASH_PX / camera.scale);
    // On the hull it went off against, wherever that hull has got to since.
    // A ship that has gone leaves its flashes where they happened.
    const anchor = shipByBody(snapshot, flashes.body[i]!);
    const at =
      anchor === null
        ? { x: flashes.x[i]!, y: flashes.y[i]! }
        : flashPosition(flashes.localX[i]!, flashes.localY[i]!, anchor);
    const x = at.x;
    const y = at.y;

    ctx.fillStyle = beam ? BEAM_FLASH_GLOW : FLASH_GLOW;
    ctx.globalAlpha = 0.5 * fade;
    ctx.beginPath();
    ctx.arc(x, y, radius * 2.2, 0, TAU);
    ctx.fill();

    ctx.fillStyle = beam ? BEAM_FLASH_CORE : FLASH_CORE;
    ctx.globalAlpha = 0.9 * fade;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawProjectiles(ctx: CanvasRenderingContext2D, snapshot: Snapshot, camera: Camera) {
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
  ctx.lineCap = 'round';
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
      y - snapshot.projectileVy[i]! * GLOW_STREAK * calibre
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
      y - snapshot.projectileVy[i]! * TRACER_STREAK * calibre
    );
    ctx.stroke();
  }
}

function drawBeams(ctx: CanvasRenderingContext2D, snapshot: Snapshot, camera: Camera) {
  // Beams, in two passes so that every glow sits under every streak. Both
  // are sized from the beam's width and floored on screen, so a beam is
  // true to size close up and legible from far out.
  //
  // A stroke per beam rather than one path for all of them, which the glow's
  // translucency notices: two beams whose glows cross now brighten where they
  // meet, where a single stroke over one path would have composited once.
  // Worth it for a halo that is the round's own size, and rare enough not to
  // read as anything but two tracers crossing.
  ctx.lineCap = 'butt';
  ctx.strokeStyle = BEAM_GLOW;
  for (let i = 0; i < snapshot.beamCount; i++) {
    const calibre = snapshot.beamWidth[i]!;
    const halo = GLOW_CALIBRES * calibre;
    ctx.globalAlpha =
      beamAlpha(snapshot.beamPower[i]!) *
      BEAM_GLOW_ALPHA *
      flooredFade(halo, MIN_GLOW_PX, camera.scale);
    ctx.lineWidth = legibleWidth(halo, MIN_GLOW_PX, camera.scale);
    ctx.beginPath();
    ctx.moveTo(snapshot.beamStartX[i]!, snapshot.beamStartY[i]!);
    ctx.lineTo(snapshot.beamEndX[i]!, snapshot.beamEndY[i]!);
    ctx.stroke();
  }

  // A pass per beam, because each carries its own width and its own opacity.
  // Cheap at the beam counts a battle reaches; if that ever stops being true,
  // bucket by width rather than reaching for a single average.
  ctx.strokeStyle = BEAM;
  for (let i = 0; i < snapshot.beamCount; i++) {
    const calibre = snapshot.beamWidth[i]!;
    ctx.globalAlpha =
      beamAlpha(snapshot.beamPower[i]!) * flooredFade(calibre, MIN_TRACER_PX, camera.scale);
    // The beam *is* its calibre wide. Twice the calibre is the barrel's outer
    // diameter — right for the tube, wrong for what comes out of it.
    ctx.lineWidth = legibleWidth(calibre, MIN_TRACER_PX, camera.scale);
    ctx.beginPath();
    ctx.moveTo(snapshot.beamStartX[i]!, snapshot.beamStartY[i]!);
    ctx.lineTo(snapshot.beamEndX[i]!, snapshot.beamEndY[i]!);
    ctx.stroke();
  }

  // Beams are drawn last, and nothing restores the context between frames:
  // leaving the final beam's opacity set would tint the next frame's grid and
  // wells before anything else had a chance to set it.
  ctx.globalAlpha = 1;
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
