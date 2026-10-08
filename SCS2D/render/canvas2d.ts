import {
  hullMountGeometry,
  IMPACT_BEAM,
  IMPACT_BURST,
  isHullMount,
  math,
  nozzleOffset,
  nozzleReach,
  HULL_LAYER,
  landedIndex,
  layerCount,
  OWN_LAYERS,
  plumeIntensity,
  plumeLayers,
  WEAPONS_LAYER,
  PLUME_POWER_PER_NEWTON,
  PLUME_RAYS,
  SHELL_CALIBRES,
  engineGeometry,
  type GunStats,
  type ShipView,
  type Snapshot,
  insetTriangle,
  triangleOf,
} from '../sim/index.js';
import { gridStep, type Camera } from './camera.js';
import { NEUTRAL, shipColours, teamName } from './teams.js';

export { teamColour } from './teams.js';
import { beamAlpha, BEAM_GLOW_ALPHA, flooredFade, legibleWidth, plumeAlpha, tracerAlpha } from './strokes.js';
import { flashExtent, flashFade, flashPosition, type Flashes } from './flashes.js';
import { clipToStart, exposureEnds, flashSamples, shutterWeight } from './exposure.js';
import { sprite } from './sprites.js';
import { iconAlpha, ICON_OUTLINE, ICON_PX } from './icons.js';

const { cos, sin, length, max, min, PI, sqrt, TAU } = math;

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

/**
 * Colours, chosen so the three layers of a turret always separate. The sides'
 * own palettes are in `teams.ts`.
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
const BACKGROUND = '#0b0f16';
const GRID = '#161d29';
const TRACER = '#ffe6a8';
const TRACER_GLOW = '#ffb2a888';
/**
 * A round passing through a hull, drawn as though seen through it. Null hides
 * that part, leaving only the flashes along its path.
 */
const TRACER_INSIDE: string | null = '#ffe6a840';
const TRACER_GLOW_INSIDE: string | null = null;

/**
 * Where a gun or a weapon engine will fire, faintly: on target and about to,
 * not yet, and pointing into its own ship where it will not.
 */
const TRIGGER_ON = '#ffd76a2e';
const TRIGGER_OFF = '#9fb6d61a';
const TRIGGER_FOULED = '#ff5a5a24';
/** The band of ranges a ship's doctrine closes to, against the enemy it wants. */
const HOLD_BAND = '#7fd6c214';
const HOLD_EDGE = '#7fd6c266';

/** Where a gun's barrel is pointing now, along its wedge, in battle. */
const BARREL_LINE = '#e6edf566';
const BARREL_LINE_PX = 1;
/** The narrowest a firing wedge's sides are drawn, in pixels; a gun's are a calibre wide otherwise. */
const MIN_TRIGGER_PX = 3;

/**
 * Which arcs a ship is drawn with: none, where each gun may point, or that and
 * where each gun and weapon engine will fire, with the band a ship's doctrine
 * closes to where it is known.
 */
export type Arcs = 'none' | 'firing' | 'trigger';

/** The next of `Arcs`, as the key that cycles them steps through. */
export function nextArcs(arcs: Arcs): Arcs {
  return arcs === 'none' ? 'firing' : arcs === 'firing' ? 'trigger' : 'none';
}

/** The key that cycles `Arcs` on every page that draws ships. */
export const ARCS_KEY = 'a';

/** The key that toggles rounds and beams between light and their side's colours. */
export const TEAM_SHOTS_KEY = 'c';

const BEAM = '#3df72c';
const BEAM_GLOW = '#a8f132';


/**
 * Width of the tracer's halo, in calibres, for a round at full opacity
 * (`tracerAlpha`); a fainter round's is narrower by as much, floored or not.
 * Proportional to the round rather than a fixed size, so that close up a light
 * round is a small bright thing and a heavy one is a large one — a fixed halo
 * makes every round look the same size at the zoom where its true size is
 * finally legible.
 */
const GLOW_CALIBRES = 7;

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
 * and where the tracer is at its true width the glow is at least
 * `GLOW_CALIBRES * TRACER_MIN_ALPHA` times it. The glow's floor is for a round
 * at full opacity, so zoomed out a fainter round's glow is smaller: it is then
 * the only thing that tells a heavy round from a light one.
 */
const MIN_GLOW_PX = 5;
/** A beam's halo, in its widths, and its floor on screen: kept apart from a tracer's. */
const BEAM_GLOW_WIDTHS = 5;
const MIN_BEAM_GLOW_PX = 3;
const MIN_TRACER_PX = 0.1;
const MIN_BARREL_PX = 1;
/** A flash is never smaller than this on screen, however far out the camera is. */
const MIN_FLASH_PX = 1;

/** A tank's wall as drawn round the fuel in it, as a share of its smaller side. */
const TANK_INSET = 0.15;

/** A module that has taken everything it can: still there, no longer anything. */
const WRECKAGE = '#3c4048';

/** An impact: the white-hot moment, and the warmer flare around it. */
const FLASH_CORE = '#fff6e2';
const FLASH_GLOW = '#ffb257';
/** A beam's, which reads as the beam's own colour boiling the hull away. */
const BEAM_FLASH_CORE = '#eaffd9';
const BEAM_FLASH_GLOW = '#8ef04a';
/** A shell bursting: redder than a hit, since it is fire rather than metal. */
const BURST_FLASH_CORE = '#fff0c8';
const BURST_FLASH_GLOW = '#ff7a2e';
/** How far a flash's glow reaches, in its core's radii. */
const FLASH_GLOW_SHARE = 2.2;
/** How much of a blast's width its bright core fills; the glow is the rest. */
const BLAST_CORE_SHARE = 0.45;

const WELL = '#3a4e7a';

/** The firing arc: a pale wash with an optional edge to define it (currently disabled). */
const SWEEP = 'rgba(196, 210, 232, 0.2)';
const SWEEP_EDGE = 'rgba(196, 210, 232, 0)';
/** The part of a sweep a mount may not fire into. */
const MASKED = 'rgba(226, 110, 84, 0.28)';

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
/** Bracing on a barrel too long to hold itself up: the barrel's colour, darker. */
const BRACE = '#4f3d14';
/**
 * A gun's load display: amber while it reloads, green while it is ready or a
 * beam is firing, on a grey track that shows how full it will get.
 */
const LOAD_TRACK = '#707070';
const LOAD_RELOADING = '#ffb000';
const LOAD_READY = '#4cf24c';
/** Flame colours, as the RGB a gradient fades to transparent from. */
const PLUME = '255, 217, 160';
const PLUME_CORE = '255, 244, 224';
/** A burn on a hull: the flame's colour, hotter at the middle. */
const BURN = '255, 170, 90';
const BURN_CORE = '255, 236, 200';



function drawShip(ctx: CanvasRenderingContext2D, ship: ShipView, metresToPx: number, arcs: Arcs): void {
  const design = ship.design;

  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(ship.angle);

  // Where its doctrine closes to, centre to centre: under everything, so the
  // trigger wedges' tips can be read against it.
  const holdMax = ship.holdMax ?? 0;
  if (arcs === 'trigger' && holdMax > 0) {
    const holdMin = ship.holdMin ?? 0;
    ctx.fillStyle = HOLD_BAND;
    ctx.beginPath();
    ctx.arc(0, 0, holdMax, 0, TAU);
    if (holdMin > 0) ctx.arc(0, 0, holdMin, TAU, 0, true);
    ctx.fill('evenodd');
    ctx.strokeStyle = HOLD_EDGE;
    ctx.lineWidth = 1 / metresToPx;
    ctx.beginPath();
    ctx.arc(0, 0, holdMax, 0, TAU);
    ctx.stroke();
    if (holdMin > 0) {
      ctx.beginPath();
      ctx.arc(0, 0, holdMin, 0, TAU);
      ctx.stroke();
    }
  }

  // Module boxes, in the body frame the design already put them in.
  for (let i = 0; i < design.modules.length; i++) {
    if (ship.drawn?.[i] === false) continue;
    const m = design.modules[i]!;
    // A piece hooked on from another ship keeps that ship's colours.
    const colours = shipColours(ship.sides?.[i] ?? ship.team);
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
        : spec.kind === 'structure' || spec.kind === 'tank'
          ? // Thick structure is drawn in the colour of the mounts and engines,
            // since it is what stands with them in the weapons layer. Read from
            // the compiled flag rather than the spec, since a plate that is
            // thick by borrowing its neighbour's depth is only as high as what
            // it covers.
            m.weaponsLayer
            ? colours.trim
            : colours.hull
          : spec.kind === 'core'
            ? colours.pivot
            : colours.trim;
    ctx.globalAlpha = integrity <= 0 ? 1 : 0.45 + 0.55 * integrity;
    const halfLength = spec.length / 2;
    const halfWidth = spec.width / 2;
    if (spec.kind === 'engine') {
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
      const engine = engineGeometry(spec);
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
      const triangle = triangleOf(spec);
      if (triangle !== null) {
        // The corners as they are authored, which is what the simulation
        // weighs, shoots at and welds — the module's own frame is already the
        // one they are written in.
        ctx.beginPath();
        ctx.moveTo(triangle[0]!, triangle[1]!);
        for (let v = 2; v < triangle.length; v += 2) ctx.lineTo(triangle[v]!, triangle[v + 1]!);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillRect(-halfLength, -halfWidth, spec.length, spec.width);
      }
      if (spec.kind === 'tank' && integrity > 0) {
        // What is left in it, filling from the aft end inside the walls.
        const inset = min(spec.length, spec.width) * TANK_INSET;
        const level = (spec.length - 2 * inset) * (ship.fuel?.[i] ?? 1);
        ctx.fillStyle = colours.pivot;
        if (triangle !== null) {
          // The same band of the tank, kept inside the shape rather than drawn
          // as the box the corners fit in. Measured from the aftmost corner,
          // so a triangular tank empties the way a rectangular one does.
          const lining = insetTriangle(triangle, inset);
          if (lining !== null) {
            let aft = Infinity;
            let fore = -Infinity;
            for (let v = 0; v < lining.length; v += 2) {
              aft = min(aft, lining[v]!);
              fore = max(fore, lining[v]!);
            }
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(lining[0]!, lining[1]!);
            for (let v = 2; v < lining.length; v += 2) ctx.lineTo(lining[v]!, lining[v + 1]!);
            ctx.closePath();
            ctx.clip();
            ctx.fillRect(aft, -halfWidth, (fore - aft) * (ship.fuel?.[i] ?? 1), spec.width);
            ctx.restore();
          }
        } else {
          ctx.fillRect(-halfLength + inset, -halfWidth + inset, level, spec.width - 2 * inset);
        }
      }
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
    if (ship.drawn?.[design.turrets[t]!.module] === false) continue;
    const colours = shipColours(ship.sides?.[design.turrets[t]!.module] ?? ship.team);
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
    if (arcs !== 'none' && ship.turretDisabled?.[t] !== true) {
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

      // Where it may point and may not fire, because its own ship is
      // downrange: the trigger mask, within the sweep.
      const mask = mount.mask;
      if (mask !== undefined && mask.length > 0) {
        const whole = left + right >= 2 * PI;
        ctx.fillStyle = MASKED;
        for (let k = 0; k < mask.length; k += 2) {
          for (let wrap = -1; wrap <= 1; wrap++) {
            const from = whole ? mask[k]! : max(mask[k]! + wrap * TAU, -right);
            const to = whole ? mask[k + 1]! : min(mask[k + 1]! + wrap * TAU, left);
            if (!(to > from)) continue;
            ctx.beginPath();
            ctx.moveTo(mx, my);
            ctx.arc(mx, my, span, rest + from, rest + to);
            ctx.closePath();
            ctx.fill();
            if (whole) break;
          }
        }
      }
    }

    // Where it will fire: the bearing it is aiming along, as far either side as
    // it will pull the trigger, out to as far as it is worth shooting at what
    // it is aiming at. Tinted by whether it would fire now — on target, not
    // yet, or pointing into its own ship.
    const triggerReach = ship.turretTriggerReach?.[t] ?? 0;
    // Its sides are lines a calibre wide, floored on screen, so a gun allowed
    // only a hair either side still shows which way it will fire.
    const half = ship.turretTrigger?.[t] ?? 0;
    if (arcs === 'trigger' && triggerReach > 0 && ship.turretDisabled?.[t] !== true) {
      const aim = ship.turretAim?.[t] ?? rest;
      const tint =
        ship.turretFouled?.[t] === true ? TRIGGER_FOULED : ship.turretReady[t] === true ? TRIGGER_ON : TRIGGER_OFF;
      ctx.fillStyle = tint;
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.arc(mx, my, triggerReach, aim - half, aim + half);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = tint;
      ctx.lineWidth = legibleWidth(design.turrets[t]!.gun.calibre, MIN_TRIGGER_PX, metresToPx);
      ctx.beginPath();
      ctx.moveTo(mx + cos(aim - half) * triggerReach, my + sin(aim - half) * triggerReach);
      ctx.lineTo(mx, my);
      ctx.lineTo(mx + cos(aim + half) * triggerReach, my + sin(aim + half) * triggerReach);
      ctx.stroke();

      // In battle, where the barrel actually points, so how far it is off its
      // aim shows. A preview has no body, and its barrel is on its aim anyway.
      if (ship.body >= 0) {
        const bearing = ship.turretBearings[t] ?? aim;
        ctx.strokeStyle = BARREL_LINE;
        ctx.lineWidth = BARREL_LINE_PX / metresToPx;
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(mx + cos(bearing) * triggerReach, my + sin(bearing) * triggerReach);
        ctx.stroke();
      }
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

    const bearing = ship.turretBearings[t] ?? 0;
    const dirX = cos(bearing);
    const dirY = sin(bearing);
    const gun = design.turrets[t]!.gun;
    const count = gun.barrelCount;
    const spacing = gun.barrelSpacing;

    ctx.strokeStyle = BARREL;
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
    if (gun.braceLength > 0) drawBracing(ctx, gun, physicalWidth, mx, my, dirX, dirY);
    drawLoad(ctx, ship, t, mx, my, bearing);
  }

  if (arcs === 'trigger') drawEngineTriggers(ctx, ship, metresToPx);
  drawPlumes(ctx, ship);
  drawLeaks(ctx, ship);
}

/** What leaking fuel looks like: vapour, white. */
const LEAK = '235, 242, 250';
/** How long a leak's plume is drawn, metres per √(kg/s) going out of it. */
const LEAK_PLUME_LENGTH = 1.5;
/** How far it has spread by its end, as a share of its length either side. */
const LEAK_PLUME_SPREAD = 0.3;

/**
 * Fuel leaking from a hole: a white plume widening and fading as it goes, longer
 * the faster fuel is going out, so a gash reads from across the battle and a
 * pinhole as a wisp.
 */
function drawLeaks(ctx: CanvasRenderingContext2D, ship: ShipView): void {
  const xs = ship.leakX;
  if (xs === undefined || xs.length === 0) return;
  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(ship.angle);
  for (let k = 0; k < xs.length; k++) {
    const rate = ship.leakRate![k]!;
    const half = ship.leakWidth![k]! / 2;
    const length = max(half * 8, LEAK_PLUME_LENGTH * sqrt(rate));
    const spread = half + length * LEAK_PLUME_SPREAD;
    ctx.save();
    ctx.translate(xs[k]!, ship.leakY![k]!);
    // `fade` runs towards -x, so turn the plume's way round to face it.
    ctx.rotate(math.atan2(ship.leakDirY![k]!, ship.leakDirX![k]!) + PI);
    ctx.fillStyle = fade(ctx, 0, length, LEAK, 0.6);
    ctx.beginPath();
    ctx.moveTo(0, -half);
    ctx.lineTo(0, half);
    ctx.lineTo(-length, spread);
    ctx.lineTo(-length, -spread);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

/**
 * The bracing on a row of long barrels: a block either side of the row and
 * one filling each gap between neighbours, which share it, out from the root
 * of the barrels.
 */
function drawBracing(
  ctx: CanvasRenderingContext2D,
  gun: GunStats,
  barrelWidth: number,
  mx: number,
  my: number,
  dirX: number,
  dirY: number,
): void {
  const count = gun.barrelCount;
  const half = barrelWidth * 0.5;
  const first = count > 1 ? -(count - 1) * 0.5 * gun.barrelSpacing : 0;
  const last = -first;
  const far = gun.braceLength;
  ctx.fillStyle = BRACE;
  const block = (from: number, to: number): void => {
    ctx.beginPath();
    ctx.moveTo(mx - dirY * from, my + dirX * from);
    ctx.lineTo(mx + dirX * far - dirY * from, my + dirY * far + dirX * from);
    ctx.lineTo(mx + dirX * far - dirY * to, my + dirY * far + dirX * to);
    ctx.lineTo(mx - dirY * to, my + dirX * to);
    ctx.closePath();
    ctx.fill();
  };
  block(first - half - gun.braceWidth, first - half);
  block(last + half, last + half + gun.braceWidth);
  for (let k = 0; k + 1 < count; k++) {
    const lat = first + k * gun.barrelSpacing;
    block(lat + half, lat + gun.barrelSpacing - half);
  }
}

/**
 * A gun's load, as a display on the mount: an arc round the back of a
 * turret's ring, or a bar down the starboard side of a hull mount's block.
 */
function drawLoad(
  ctx: CanvasRenderingContext2D,
  ship: ShipView,
  t: number,
  mx: number,
  my: number,
  bearing: number,
): void {
  // A view built by hand says nothing of loading, so its guns are ready. A
  // disabled gun is empty, so it never shows a ready light.
  const load = ship.turretDisabled?.[t] === true ? 0 : (ship.turretLoad?.[t] ?? 1);
  const module = ship.design.modules[ship.design.turrets[t]!.module]!;
  const spec = module.spec;
  const colour = ship.turretReloading?.[t] === true ? LOAD_RELOADING : LOAD_READY;
  if (isHullMount(spec.kind)) {
    const block = hullMountGeometry(spec).blockLength;
    const thick = min(spec.width * 0.08, block * 0.25);
    const end = block * 0.12;
    const from = -spec.length / 2 + end;
    const span = block - 2 * end;
    const y = -spec.width / 2 + thick;
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.angle);
    ctx.translate(module.x, module.y);
    ctx.rotate(module.angle);
    ctx.fillStyle = LOAD_TRACK;
    ctx.fillRect(from, y, span, thick);
    ctx.fillStyle = colour;
    ctx.fillRect(from, y, span * load, thick);
    ctx.restore();
    return;
  }
  // Inside the ring's back edge, by about its own thickness.
  const pivot = min(spec.length, spec.width) * 0.5;
  const thick = pivot * 0.14;
  const radius = pivot - 2 * thick;
  const back = bearing + PI;
  const half = PI * 0.3;
  ctx.lineWidth = thick;
  ctx.lineCap = 'butt';
  ctx.strokeStyle = LOAD_TRACK;
  ctx.beginPath();
  ctx.arc(mx, my, radius, back - half, back + half);
  ctx.stroke();
  if (load > 0) {
    ctx.strokeStyle = colour;
    ctx.beginPath();
    ctx.arc(mx, my, radius, back - half, back - half + 2 * half * load);
    ctx.stroke();
  }
}

/**
 * Where each engine used as a weapon will burn: the part of each flame that
 * lands enough to fire for, tinted as a gun's wedge is.
 */
function drawEngineTriggers(ctx: CanvasRenderingContext2D, ship: ShipView, metresToPx: number): void {
  const reaches = ship.engineTriggerReach;
  if (reaches === undefined) return;
  const design = ship.design;
  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(ship.angle);
  ctx.lineWidth = legibleWidth(0, MIN_TRIGGER_PX, metresToPx);
  for (let t = 0; t < design.engines.length; t++) {
    const reach = reaches[t] ?? 0;
    const engine = design.engines[t]!;
    const module = design.modules[engine.module ?? -1];
    if (!(reach > 0) || module === undefined) continue;
    const tint =
      (engine.escaping ?? 1) <= 0 ? TRIGGER_FOULED : ship.engineFiring?.[t] === true ? TRIGGER_ON : TRIGGER_OFF;
    const geometry = engineGeometry(module.spec);
    const root = -module.spec.length / 2;
    const half = geometry.exitWidth / 2;
    ctx.save();
    ctx.translate(module.x, module.y);
    ctx.rotate(module.angle);
    ctx.fillStyle = tint;
    ctx.strokeStyle = tint;
    for (let n = 0; n < geometry.nozzles; n++) {
      const across = nozzleOffset(geometry, n);
      ctx.beginPath();
      ctx.moveTo(root, across - half);
      ctx.lineTo(root - reach, across);
      ctx.lineTo(root, across + half);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(root, across - half);
      ctx.lineTo(root - reach, across);
      ctx.lineTo(root, across + half);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

/**
 * Exhaust, in a pass of its own after the turrets.
 *
 * Drawn last of the ship's parts because a plume is in front of the hull, not
 * part of it: sharing the module pass put it *under* the sector a nearby
 * turret sweeps, which dimmed a burning engine to the colour of a shadow.
 */
function drawPlumes(ctx: CanvasRenderingContext2D, ship: ShipView): void {
  eachNozzle(ctx, ship, (engine, force, reach, across, landed, split) => {
    // One flame per nozzle, the same triangles the burn samples its rays
    // across. How hot it burns is its opacity, and it fades to nothing at its
    // tip the way its share of the power does, so the brightest part of the
    // picture is the part doing the most damage.
    const root = -engine.length / 2;
    const alpha = layerAlpha(plumeAlpha(plumeIntensity(engine.geometry, force)), split);
    const half = engine.geometry.exitWidth / 2;

    // Cut off where its core lands on a hull, inside the glow that marks it.
    const cut = landed[1]! > 0 ? (1 - landed[1]!) * reach : Infinity;
    ctx.save();
    if (cut < reach) {
      ctx.beginPath();
      ctx.rect(root - cut, across - half, cut, half * 2);
      ctx.clip();
    }
    ctx.fillStyle = fade(ctx, root, reach, PLUME, alpha);
    ctx.beginPath();
    ctx.moveTo(root, across - half);
    ctx.lineTo(root, across + half);
    ctx.lineTo(root - reach, across);
    ctx.closePath();
    ctx.fill();
    // A brighter core, a third the width, so a hard burn reads as hotter
    // rather than merely longer.
    ctx.fillStyle = fade(ctx, root, reach * 0.55, PLUME_CORE, layerAlpha(min(1, plumeAlpha(plumeIntensity(engine.geometry, force)) * 1.4), split));
    ctx.beginPath();
    ctx.moveTo(root, across - half / 3);
    ctx.lineTo(root, across + half / 3);
    ctx.lineTo(root - reach * 0.55, across);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  });
}

/**
 * The opacity of one of `split` flames laid over each other that together
 * look like one flame of `alpha`, so a thick engine's two flames are the
 * single one where neither is blocked, and dimmer where one is.
 */
function layerAlpha(alpha: number, split: number): number {
  return split > 1 ? 1 - sqrt(1 - alpha) : alpha;
}

/**
 * Where flames are burning something: a soft glow on the hull, as wide as
 * the flame is there and spread along the surface rather than round, and as
 * bright as the power landing on it per square metre — a little brighter
 * than the flame itself, for the hull it is boiling off.
 *
 * In a pass of its own after every hull, so a glow on a ship drawn later is
 * not painted over by it, and additive, so it lights the hull rather than
 * covering it.
 */
function drawBurns(ctx: CanvasRenderingContext2D, snapshot: Snapshot): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < snapshot.shipCount; i++) {
    eachNozzle(ctx, snapshot.ships[i]!, (engine, force, reach, across, landed, split) => {
      // What of this nozzle's power is landing, and roughly where: the core's
      // landing if it has one, otherwise wherever its edges met something.
      const perRay = (PLUME_POWER_PER_NEWTON * force) / (engine.geometry.nozzles * PLUME_RAYS * split);
      let power = 0;
      let at = 0;
      let off = 0;
      let count = 0;
      for (let k = 0; k < PLUME_RAYS; k++) {
        const share = landed[k]!;
        if (!(share > 0)) continue;
        power += perRay * share;
        // A side ray reaches a third as far, so its landing is a third as deep.
        const rayReach = k === 1 ? reach : reach / 3;
        at += (1 - share) * rayReach;
        off += (k - 1) / 3;
        count++;
      }
      if (count === 0) return;
      at /= count;
      off /= count;
      const root = -engine.length / 2;
      const exit = engine.geometry.exitWidth;
      // As wide as the flame is where it lands, and never a speck.
      const along = max(exit * (1 - at / reach), exit * 0.5) * 1.8;
      const deep = along * 0.55;
      const alpha = min(1, plumeAlpha(power / (PI * along * deep)) * 1.3);

      ctx.save();
      ctx.translate(root - at, across + off * exit);
      ctx.scale(deep, along);
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      glow.addColorStop(0, `rgba(${BURN_CORE}, ${alpha})`);
      glow.addColorStop(0.25, `rgba(${BURN}, ${alpha * 0.7})`);
      glow.addColorStop(0.6, `rgba(${BURN}, ${alpha * 0.25})`);
      glow.addColorStop(1, `rgba(${BURN}, 0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, TAU);
      ctx.fill();
      ctx.restore();
    });
  }
  ctx.restore();
}

/** An engine as the flame passes need it: its bell geometry and its length. */
interface Engine {
  geometry: ReturnType<typeof engineGeometry>;
  length: number;
}

/**
 * Every burning nozzle on a ship, in its own module's frame with the exhaust
 * running along -x: what the flame and burn passes both draw from, so they
 * cannot disagree about where a flame is. A thick engine's nozzle is visited
 * once a layer, each with its share `split` of the flame.
 */
function eachNozzle(
  ctx: CanvasRenderingContext2D,
  ship: ShipView,
  visit: (engine: Engine, force: number, reach: number, across: number, landed: readonly number[], split: number) => void,
): void {
  const design = ship.design;
  // Engines are counted as they are met, because a design lists its
  // engines in the order its modules appear.
  let engine = 0;
  const landed = [0, 0, 0];

  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(ship.angle);
  for (let i = 0; i < design.modules.length; i++) {
    const m = design.modules[i]!;
    const spec = m.spec;
    if (spec.kind !== 'engine') continue;
    const t = engine++;
    const force = (ship.throttles[t] ?? 0) * (design.engines[t]?.maxThrust ?? 0);
    if (!(force > 0)) continue;
    const geometry = engineGeometry(spec);
    const reach = nozzleReach(geometry, force);
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(m.angle);
    const layers = ship.plumeLayers?.[t] ?? plumeLayers(design, t, OWN_LAYERS);
    const split = layerCount(layers);
    for (let layer = HULL_LAYER; layer <= WEAPONS_LAYER; layer <<= 1) {
      if ((layers & layer) === 0) continue;
      for (let n = 0; n < geometry.nozzles; n++) {
        for (let k = 0; k < PLUME_RAYS; k++) {
          landed[k] = ship.landed[landedIndex(design, t, n * PLUME_RAYS + k, layer)] ?? 0;
        }
        visit({ geometry, length: spec.length }, force, reach, nozzleOffset(geometry, n), landed, split);
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
 * **The team's colour is for a ship still under control, and nothing
 * else.** Not for one that can still fight: a hull with a sound core and
 * neither gun nor engine is still a ship, and drawing it grey said the
 * opposite about an entire generation of engineless craft. What grey means
 * here is that the core is out — the one thing that stops a hull being a
 * ship — which is also the only state in which the arrowhead is telling you
 * about something you can do nothing with and nothing can be done with.
 *
 * A derelict piece — a severed chunk, never controlled — gets no
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

/** Smallest a core is drawn, across, before its ship's name is written on it, pixels. */
const NAME_MIN_CORE_PX = 18;
/** The largest a name is written, and the smallest worth writing, pixels. */
const NAME_MAX_PX = 14;
const NAME_MIN_PX = 7;

/**
 * A ship's name — its side and which of that side's ships it is, as "Red 5" —
 * written on its first working core in its side's trim, once the core is big
 * enough on screen to carry it. Upright whichever way the ship is turned.
 */
function drawName(ctx: CanvasRenderingContext2D, ship: ShipView, metresToPx: number): void {
  if (ship.serial <= 0 || ship.team < 0 || !ship.hasControl) return;
  const core = ship.design.cores.find((m) => (ship.integrity[m] ?? 1) > 0);
  if (core === undefined) return;
  const module = ship.design.modules[core]!;
  const across = Math.min(module.spec.length, module.spec.width) * metresToPx;
  if (across < NAME_MIN_CORE_PX) return;
  const c = Math.cos(ship.angle);
  const s = Math.sin(ship.angle);
  const at = ctx.getTransform().transformPoint({
    x: ship.x + module.x * c - module.y * s,
    y: ship.y + module.x * s + module.y * c,
  });
  const text = `${teamName(ship.team)} ${ship.serial}`;
  const along = Math.max(module.spec.length, module.spec.width) * metresToPx;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  let size = Math.min(NAME_MAX_PX, across * 0.4);
  ctx.font = `${size}px ui-monospace, monospace`;
  // No wider than the core is long, so it reads as written on the core.
  const width = ctx.measureText(text).width;
  if (width > along * 0.9) size *= (along * 0.9) / width;
  if (size >= NAME_MIN_PX) {
    ctx.font = `${size}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = shipColours(ship.team).trim;
    ctx.fillText(text, at.x, at.y);
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
  flashes?: Flashes,
  arcs: Arcs = 'none',
  /** Rounds and beams in the colours of the side that fired them, rather than as light. */
  teamShots = false,
  /** The body of a ship picked out by the viewer, or -1: marked, its target shown, and the arcs only its. */
  selected = -1,
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
    const ship = snapshot.ships[i]!;
    drawShip(ctx, ship, camera.scale, selected < 0 || ship.body === selected ? arcs : 'none');
  }

  // Icons in a pass of their own, after every hull: an icon stands for the
  // ship as a whole, so it belongs over its neighbours rather than under
  // whichever of them happens to be drawn next.
  for (let i = 0; i < snapshot.shipCount; i++) {
    drawIcon(ctx, snapshot.ships[i]!, camera.scale);
    drawName(ctx, snapshot.ships[i]!, camera.scale);
  }

  if (selected >= 0) drawSelected(ctx, snapshot, selected, camera.scale);
  drawBurns(ctx, snapshot);
  drawProjectiles(ctx, snapshot, camera, teamShots);
  drawBeams(ctx, snapshot, camera, teamShots);
  if (flashes !== undefined) drawFlashes(ctx, snapshot, flashes, camera);
}

/** Pixels between the selected ship's hull circle and the ring drawn round it. */
const SELECTED_GAP_PX = 6;

/**
 * The ship the viewer has picked out: a ring round it in its side's trim, and
 * a broken line from it to whatever it is fighting, with a smaller ring there.
 */
function drawSelected(ctx: CanvasRenderingContext2D, snapshot: Snapshot, body: number, metresToPx: number): void {
  const ship = shipByBody(snapshot, body);
  if (ship === null) return;
  const colour = (ship.hasControl ? shipColours(ship.team) : NEUTRAL).trim;
  const gap = SELECTED_GAP_PX / metresToPx;
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1.5 / metresToPx;
  ctx.beginPath();
  ctx.arc(ship.x, ship.y, ship.design.radius + gap, 0, Math.PI * 2);
  ctx.stroke();
  const target = shipByBody(snapshot, ship.fighting ?? -1);
  if (target !== null) {
    const dx = target.x - ship.x;
    const dy = target.y - ship.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    const from = ship.design.radius + gap;
    const to = length - target.design.radius - gap;
    if (to > from) {
      ctx.setLineDash([6 / metresToPx, 6 / metresToPx]);
      ctx.beginPath();
      ctx.moveTo(ship.x + (dx / length) * from, ship.y + (dy / length) * from);
      ctx.lineTo(ship.x + (dx / length) * to, ship.y + (dy / length) * to);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.arc(target.x, target.y, target.design.radius + gap, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** The ship a flash is riding, or null when nothing in the picture is it. */
function shipByBody(snapshot: Snapshot, body: number): ShipView | null {
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
  // Exposed for the last step, as a camera would photograph it: drawn at
  // moments through the step, each at the size and brightness it had then and
  // where it was then relative to the camera, weighted by how open the shutter
  // was, and summed.
  const dt = snapshot.dt;
  const cvx = camera.vx ?? 0;
  const cvy = camera.vy ?? 0;
  const floor = MIN_FLASH_PX / camera.scale;
  const base = ctx.getTransform();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < flashes.count; i++) {
    const kind = flashes.kind[i]!;
    const glow = sprite('halo', kind === IMPACT_BEAM ? BEAM_FLASH_GLOW : kind === IMPACT_BURST ? BURST_FLASH_GLOW : FLASH_GLOW);
    // A burst is a blast of gas rather than a spot of hot metal, so its core is
    // soft: as bright in the middle, fading out to its edge.
    const core = sprite(
      kind === IMPACT_BURST ? 'halo' : 'disc',
      kind === IMPACT_BEAM ? BEAM_FLASH_CORE : kind === IMPACT_BURST ? BURST_FLASH_CORE : FLASH_CORE,
    );
    if (glow === null || core === null) continue;
    const age = flashes.age[i]!;
    const lifetime = flashes.lifetime[i]!;
    // Centred on now, as a round's is, and reaching back half a step past the
    // flash's birth at full brightness: so a burst's flash is brightest where
    // its fragments' streaks cross.
    const opened = age - dt * 0.5;
    const closed = min(lifetime, age + dt * 0.5);
    const exposure = closed - opened;
    if (!(exposure > 0)) continue;
    // On the hull it went off against, wherever that hull has got to since,
    // and moving with it. A ship that has gone leaves its flashes where they
    // happened, and a burst drifts on at its shell's velocity.
    const anchor = shipByBody(snapshot, flashes.body[i]!);
    const at =
      anchor === null
        ? { x: flashes.x[i]!, y: flashes.y[i]! }
        : flashPosition(flashes.localX[i]!, flashes.localY[i]!, anchor);
    const rvx = (anchor === null ? flashes.vx[i]! : anchor.vx) - cvx;
    const rvy = (anchor === null ? flashes.vy[i]! : anchor.vy) - cvy;

    const radius = flashes.radius[i]!;
    const growth = flashes.growth[i]!;
    // A blast's glow is its edge, which goes out with its fastest fragments,
    // and its core sits inside it; a hit's glow is a flare around its core.
    const blast = growth > 0;
    const coreShare = blast ? BLAST_CORE_SHARE : 1;
    const glowShare = blast ? 1 : FLASH_GLOW_SHARE;
    const start = blast ? radius * FLASH_GLOW_SHARE : radius;
    const rStart = max(flashExtent(start, growth, opened, lifetime) * coreShare, floor);
    const rEnd = max(flashExtent(start, growth, closed, lifetime) * coreShare, floor);
    const travelPx = length(rvx, rvy) * exposure * camera.scale;
    const widestPx = 2 * max(rStart, rEnd) * camera.scale;
    const n = flashSamples(travelPx, (rEnd - rStart) * camera.scale, widestPx * 0.5);

    // Shared between the moments, but only between those that overlap: a
    // flash streaked out along its path stays as bright at any one point as
    // it would standing still.
    let total = 0;
    for (let k = 0; k < n; k++) total += n === 1 ? 1 : shutterWeight((k + 0.5) / n);
    const overlapping = travelPx > widestPx ? widestPx / travelPx : 1;
    for (let k = 0; k < n; k++) {
      const u = n === 1 ? 0.5 : (k + 0.5) / n;
      const weight = (n === 1 ? 1 : shutterWeight(u)) / (total * overlapping);
      const t = opened + u * exposure;
      const fade = flashFade(t, lifetime);
      if (fade <= 0 || weight <= 0) continue;
      const ahead = t - age;
      const x = at.x + rvx * ahead;
      const y = at.y + rvy * ahead;
      // Floored on screen, so a hit is visible from far enough out to see the
      // battle it is part of.
      const extent = flashExtent(start, growth, t, lifetime);
      const r = max(extent * coreShare, floor);
      const g = max(extent * glowShare, floor);
      ctx.setTransform(base);
      ctx.globalAlpha = 0.5 * fade * weight;
      ctx.drawImage(glow, x - g, y - g, 2 * g, 2 * g);
      ctx.globalAlpha = 0.9 * fade * weight;
      ctx.drawImage(core, x - r, y - r, 2 * r, 2 * r);
    }
  }
  ctx.restore();
}

/**
 * Draw a sprite over the stretch a round crosses in a step centred on now: from
 * `(x0, y0)` to `(x1, y1)`, `width` across, and half a width further at either
 * end for the round's own size.
 */
function drawStreak(
  ctx: CanvasRenderingContext2D,
  base: DOMMatrix,
  image: CanvasImageSource,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  fallbackX: number,
  fallbackY: number,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const travel = length(dx, dy);
  // Still relative to the camera: the round's own heading, so it is not a
  // disc turned whichever way.
  const fallback = length(fallbackX, fallbackY);
  const ux = travel > 0 ? dx / travel : fallback > 0 ? fallbackX / fallback : 1;
  const uy = travel > 0 ? dy / travel : fallback > 0 ? fallbackY / fallback : 0;
  const along = travel + width;
  // The streak's own frame, composed onto the world's by hand: one call
  // rather than a reset and a multiply for every round.
  const a = ux * along;
  const b = uy * along;
  const c = -uy * width;
  const d = ux * width;
  const e = x0 - ux * width * 0.5;
  const f = y0 - uy * width * 0.5;
  ctx.setTransform(
    base.a * a + base.c * b,
    base.b * a + base.d * b,
    base.a * c + base.c * d,
    base.b * c + base.d * d,
    base.a * e + base.c * f + base.e,
    base.b * e + base.d * f + base.f,
  );
  ctx.drawImage(image, 0, -0.5, 1, 1);
}

/** A round's colours: as light, or in its side's trim with a glow of its hull colour. */
function tracerColour(team: number, teamShots: boolean, glow: boolean, inside: boolean): string | null {
  if (!teamShots || team < 0) {
    return glow ? (inside ? TRACER_GLOW_INSIDE : TRACER_GLOW) : inside ? TRACER_INSIDE : TRACER;
  }
  const { hull, trim } = shipColours(team);
  if (glow) return inside ? TRACER_GLOW_INSIDE : `${hull}88`;
  return inside ? `${trim}40` : trim;
}

function drawProjectiles(ctx: CanvasRenderingContext2D, snapshot: Snapshot, camera: Camera, teamShots: boolean) {
  // Tracers, in two passes so that every glow sits under every streak. Each
  // is exposed for the last step, as a camera would photograph it: drawn over
  // the line it crossed relative to the camera, fading in and out towards
  // either end as the shutter opens and closes. The round has hard sides; its
  // glow fades out from the line as well. Both are sized from the calibre and
  // floored on screen, so a round is true to size close up and legible from
  // far out. A round that covers each point of its streak for longer, by being
  // longer or slower, is more opaque; its glow is wider instead, which is what
  // a brighter soft glow looks like.
  const dt = snapshot.dt;
  const cvx = camera.vx ?? 0;
  const cvy = camera.vy ?? 0;
  const base = ctx.getTransform();
  ctx.save();
  for (let pass = 0; pass < 2; pass++) {
    const glowPass = pass === 0;
    for (let i = 0; i < snapshot.projectileCount; i++) {
      const inside = snapshot.projectileInside[i] === 1;
      const colour = tracerColour(snapshot.projectileTeam[i]!, teamShots, glowPass, inside);
      if (colour === null) continue;
      const image = sprite(glowPass ? 'glowStreak' : 'streak', colour);
      if (image === null) continue;
      const calibre = snapshot.projectileWidth[i]!;
      const x = snapshot.projectileX[i]!;
      const y = snapshot.projectileY[i]!;
      const vx = snapshot.projectileVx[i]!;
      const vy = snapshot.projectileVy[i]!;
      const sx = snapshot.projectileStartX[i];
      const sy = snapshot.projectileStartY[i];
      const open = exposureEnds(x, y, vx, vy, cvx, cvy, dt);
      // The editor's demonstration fills only the rounds' own figures.
      const ends = sx === undefined || sy === undefined ? open : clipToStart(open, sx, sy, vx, vy);
      const exposure = tracerAlpha(SHELL_CALIBRES * calibre, length(ends.x1 - ends.x0, ends.y1 - ends.y0));
      const width = glowPass
        ? legibleWidth(GLOW_CALIBRES * calibre, MIN_GLOW_PX, camera.scale) * exposure
        : legibleWidth(calibre, MIN_TRACER_PX, camera.scale);
      ctx.globalAlpha = glowPass ? 1 : exposure;
      drawStreak(ctx, base, image, ends.x0, ends.y0, ends.x1, ends.y1, width, vx, vy);
    }
  }
  ctx.restore();
}

function drawBeams(ctx: CanvasRenderingContext2D, snapshot: Snapshot, camera: Camera, teamShots: boolean) {
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
  const team = (i: number): number => (teamShots ? snapshot.beamTeam[i]! : -1);
  for (let i = 0; i < snapshot.beamCount; i++) {
    ctx.strokeStyle = team(i) < 0 ? BEAM_GLOW : shipColours(team(i)).hull;
    const calibre = snapshot.beamWidth[i]!;
    const halo = BEAM_GLOW_WIDTHS * calibre;
    ctx.globalAlpha =
      beamAlpha(snapshot.beamPower[i]!) *
      BEAM_GLOW_ALPHA *
      flooredFade(halo, MIN_BEAM_GLOW_PX, camera.scale);
    ctx.lineWidth = legibleWidth(halo, MIN_BEAM_GLOW_PX, camera.scale);
    ctx.beginPath();
    ctx.moveTo(snapshot.beamStartX[i]!, snapshot.beamStartY[i]!);
    ctx.lineTo(snapshot.beamEndX[i]!, snapshot.beamEndY[i]!);
    ctx.stroke();
  }

  // A pass per beam, because each carries its own width and its own opacity.
  // Cheap at the beam counts a battle reaches; if that ever stops being true,
  // bucket by width rather than reaching for a single average.
  for (let i = 0; i < snapshot.beamCount; i++) {
    ctx.strokeStyle = team(i) < 0 ? BEAM : shipColours(team(i)).trim;
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
