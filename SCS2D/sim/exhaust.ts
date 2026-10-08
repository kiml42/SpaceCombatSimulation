import type { Bodies } from './bodies.js';
import type { ShipDesign } from './blueprint.js';
import { SEAM_CUT_ENERGY_PER_AREA, type Damage } from './damage.js';
import { joints, jointsOf } from './connectivity.js';
import {
  BOTH_LAYERS,
  HULL_LAYER,
  HullPath,
  moduleLayers,
  modulesAlong,
  OWN_LAYERS,
  WEAPONS_LAYER,
  type Boxes,
  type Hulls,
} from './hull.js';
import { cos, sin, sqrt } from './math.js';
import { triangleOf } from './shape.js';
import {
  DECK_HEIGHT,
  nozzleOffset,
  THRUST_PER_EXIT_AREA,
  engineGeometry,
  type EngineGeometry,
} from './modules.js';
import { RayHit, type SpatialGrid } from './spatialGrid.js';

/**
 * What a rocket exhaust does to whatever is standing in it.
 *
 * An engine produces its thrust whatever its nozzle is pointed at, so without
 * this a plume is scenery: an engine buried in its own hull flies exactly as
 * well as one in clear air and merely looks absurd. That is free thrust with
 * no penalty attached, which is the shape of exploit `modules.ts` warns about
 * — evolution would pack every layout tighter by firing its engines into
 * itself. Making the plume *bite* prices it, and prices it continuously — an
 * obstruction near the tip of the flame costs a little and one at the throat
 * costs everything — because a hard edge is one a mutation cannot cross, and
 * the search wants a gradient rather than a wall.
 *
 * It cuts both ways, which is the point. A plume is as dangerous to a ship
 * that gets behind one as to the ship carrying it, so where an engine points
 * is something a designer can aim and an attacker can be caught by.
 *
 * **A buried nozzle also costs thrust.** Exhaust that runs into the ship's own
 * hull hands its momentum back to the hull it was pushing — the push on the
 * blocked module and the thrust off the nozzle are the same newton-seconds
 * with opposite signs, so that share of the engine is not thrust at all. What
 * the hull stands in is swept exactly across each nozzle, so nothing can hide
 * in a flame. What is in the way
 * on its own ship is fixed geometry, so it is worked out once when the design
 * is compiled and lands on `EngineSpec.escaping`, which `EngineLayout`
 * flies the engine at.
 *
 * **The plume the simulation burns with is the plume the renderer draws** —
 * both take their length from `plumeReach`, and the renderer's opacity from
 * `plumeIntensity`, so what is on the screen is what is doing the damage.
 */

/**
 * How far a flame carries, in widths of the nozzle it leaves, when the throat
 * is fed at the pressure `THRUST_PER_EXIT_AREA` assumes and the bell is
 * perfect.
 *
 * **A jet runs a roughly fixed number of its own widths** before it has mixed
 * into the dark, so a bigger nozzle throws a longer flame and an engine scaled
 * up bodily reaches proportionally further. Machinery that feeds the throat
 * harder lengthens it in proportion, being more gas at higher pressure, and a
 * cluster of nozzles throws flames as short as each nozzle is narrow.
 *
 * Seventeen widths, so a choked two-metre nozzle through a good bell throws
 * the fifty-odd metres every full engine used to, and everything larger
 * throws further.
 */
export const PLUME_CORE_WIDTHS = 17;

/**
 * How much of an engine's power a plume delivers to what it plays on, watts
 * per newton of thrust.
 *
 * A balance dial rather than a derivation, in the same sense as
 * `DAMAGE_ENERGY_PER_KG`: a real exhaust carries some kilowatts of jet power
 * per newton and would destroy anything sitting in it far faster than a battle
 * lasts, and nearly all of that gas flows past rather than into what it hits.
 * What is wanted is a timescale a player can see and manoeuvre against, so
 * this is chosen for the timescale and not from the physics. At this figure a
 * full-throttle plume destroys a square structure module as wide as the
 * engine in four to seven seconds at the nozzle, or roughly twice that
 * halfway out. ROADMAP.md §12 keeps it open
 * with the rest of the dials.
 */
export const PLUME_POWER_PER_NEWTON = 4;

/**
 * How much of its length a flame keeps for the shape of its bell, 0 to 1.
 *
 * Gas leaving a divergent nozzle is already flying apart, and a flame spreads
 * out of existence far faster than the thrust it has lost, so this is the
 * eighth power of `divergence`: a good bell keeps most of its flame, a short
 * one loses a third, and a bare throat sprays what it has sideways and throws
 * almost nothing. Steep enough that more bell on the same machinery is a
 * visibly longer flame, which is the collimation a longer nozzle buys.
 */
export function collimation(divergence: number): number {
  const d2 = divergence * divergence;
  const d4 = d2 * d2;
  return d4 * d4;
}

/**
 * How far a plume reaches along its axis, metres. Zero for an engine that is
 * not burning.
 *
 * `PLUME_CORE_WIDTHS` of the nozzle's width, times how hard the throat is fed
 * — machinery and throttle together, read back off the force it is making —
 * times what the bell keeps of it. So a bigger nozzle, deeper machinery and a
 * longer bell each throw further, and a half-throttle burn is half the flame.
 */
export function plumeReach(force: number, exitWidth: number, divergence = 1, exitHeight = DECK_HEIGHT): number {
  if (!(force > 0) || !(exitWidth > 0) || !(divergence > 0)) return 0;
  const pressure = force / (exitWidth * exitHeight * THRUST_PER_EXIT_AREA * divergence);
  return PLUME_CORE_WIDTHS * exitWidth * pressure * collimation(divergence);
}

/**
 * How hot a flame burns where it leaves the nozzle, watts per square metre
 * of plume: one nozzle's power spread over its own triangle.
 *
 * What the renderer draws a flame's opacity from, so its size and its
 * brightness can say different things — a big engine throws a long flame
 * that is not especially fierce anywhere, and a cluster throws short ones
 * that are. Nothing in the simulation reads it: the burn goes by each ray's
 * share of the power, which fades along the flame the way the drawing does.
 */
export function plumeIntensity(geometry: EngineGeometry, force: number): number {
  const reach = nozzleReach(geometry, force);
  if (!(reach > 0)) return 0;
  return (PLUME_POWER_PER_NEWTON * (force / geometry.nozzles)) / (0.5 * geometry.exitWidth * reach);
}

/**
 * How many bands a nozzle's flame is cast beyond its own ship in, each by one
 * ray.
 *
 * Only what leaves the ship is sampled: what its own hull stands in is swept
 * exactly when the design is compiled (`exhaustObstruction`), since a layout
 * is the one thing a designer — or a search — can arrange to fall between
 * samples. Out past it, three is the cheapest count that tells a flame's
 * middle from its edges, so a hull off to one side of a nozzle is burnt
 * rather than missed.
 */
export const PLUME_RAYS = 3;

/**
 * Where each ray leaves the nozzle, as a fraction of the exit width from the
 * axis.
 *
 * The centroids of three equal bands across the exit, so each ray stands for
 * the same share of the gas and therefore the same share of the thrust and the
 * power. Nothing is weighted, because nothing needs to be.
 */
const RAY_OFFSET: readonly number[] = [-1 / 3, 0, 1 / 3];

/**
 * How many rays an engine's exhaust is sampled by: `PLUME_RAYS` for each of
 * its nozzles.
 *
 * Per nozzle rather than per engine, because a cluster is a row of separate
 * flames with ship's-eye gaps between them, and three rays stretched across
 * the whole face would fall where the fire is not.
 */
export function plumeRays(geometry: EngineGeometry): number {
  return PLUME_RAYS * geometry.nozzles;
}

const RAY_STARTS = new WeakMap<ShipDesign, Int32Array>();

/**
 * Where each of a design's engines' rays start in one flat list of all of
 * them, with the total at the end. Cached per design, which never changes.
 */
export function plumeRayStarts(design: ShipDesign): Int32Array {
  const known = RAY_STARTS.get(design);
  if (known !== undefined) return known;
  const starts = new Int32Array(design.engines.length + 1);
  for (let t = 0; t < design.engines.length; t++) {
    const engine = design.modules[design.engines[t]!.module ?? -1];
    starts[t + 1] = starts[t]! + (engine === undefined ? 0 : plumeRays(engineGeometry(engine.spec)));
  }
  RAY_STARTS.set(design, starts);
  return starts;
}

/**
 * Where one ray's landing is kept in a ship's flat list of them. Every ray has
 * two slots, the hull layer's and then, past all of those, the weapons
 * layer's, because a thick engine casts each ray once in each layer.
 */
export function landedIndex(design: ShipDesign, engine: number, ray: number, layer: number): number {
  const starts = plumeRayStarts(design);
  return starts[engine]! + ray + (layer === WEAPONS_LAYER ? starts[design.engines.length]! : 0);
}

/** How long a ship's list of ray landings is: two slots a ray. */
export function landedLength(design: ShipDesign): number {
  return 2 * plumeRayStarts(design)[design.engines.length]!;
}

/** The layers an engine's plume is in: its own, or the whole ship's for a fighter. */
export function plumeLayers(design: ShipDesign, engine: number, bodyLayers: number): number {
  const m = design.modules[design.engines[engine]?.module ?? -1];
  return m === undefined ? 0 : moduleLayers(m, bodyLayers);
}

/** How many layers a plume is in, and so how many ways each ray is split. */
export function layerCount(layers: number): number {
  return ((layers & HULL_LAYER) !== 0 ? 1 : 0) + ((layers & WEAPONS_LAYER) !== 0 ? 1 : 0);
}

/** Which nozzle a ray belongs to, and which of its three it is. */
function rayNozzle(ray: number): { nozzle: number; across: number } {
  const nozzle = (ray / PLUME_RAYS) | 0;
  return { nozzle, across: RAY_OFFSET[ray - nozzle * PLUME_RAYS] ?? 0 };
}

/** How far one flame reaches, given what the whole engine is producing. */
export function nozzleReach(geometry: EngineGeometry, force: number): number {
  // Every nozzle gets an equal share of the gas through an equal share of the
  // face, so each is fed at the same pressure the single nozzle was — and so
  // throws a flame as much shorter as it is narrower, less what its better
  // bell gives back.
  return plumeReach(force / geometry.nozzles, geometry.exitWidth, geometry.divergence, geometry.exitHeight);
}

/**
 * How far one ray reaches, given what the whole engine is producing.
 *
 * **Derived from the drawn plume rather than chosen**, so the picture and the
 * burn cannot part company: each flame is a triangle as wide as its own
 * nozzle, narrowing to a point at its reach, so at an offset `y` from that
 * nozzle's axis it ends where the triangle's half-width has shrunk to `y` — a
 * third of the way out for the rays at a third of the width. A plume is
 * therefore wide at the nozzle and a thin core further out, which is what a
 * wedge-shaped flame should do and what a single ray could not express.
 */
export function rayReach(ray: number, geometry: EngineGeometry, force: number): number {
  const { across } = rayNozzle(ray);
  const edge = 1 - 2 * (across < 0 ? -across : across);
  return edge > 0 ? nozzleReach(geometry, force) * edge : 0;
}

/** Where a ray leaves the engine, in metres across the exit face from its middle. */
export function rayOffset(ray: number, geometry: EngineGeometry): number {
  const { nozzle, across } = rayNozzle(ray);
  return nozzleOffset(geometry, nozzle) + across * geometry.exitWidth;
}

/**
 * A stretch across one nozzle's exit that its own ship's hull stands in front
 * of: from `from` to `to`, metres across the engine's face from its middle (as
 * `rayOffset` measures), the nearest module there, and how far out that module
 * starts at each end. Between the two ends its near face is one straight edge,
 * so how far out it is runs straight from one figure to the other.
 */
export interface PlumeSlice {
  readonly nozzle: number;
  readonly from: number;
  readonly to: number;
  readonly module: number;
  readonly nearFrom: number;
  readonly nearTo: number;
}

/** Narrower than this, a stretch of nozzle is not worth a slice, metres. */
const SLICE_MIN = 1e-9;

/** How far out a flame reaches at `across` metres from its nozzle's axis, given its reach on the axis. */
function reachAcross(axisReach: number, across: number, exitWidth: number): number {
  const edge = 1 - (2 * (across < 0 ? -across : across)) / exitWidth;
  return edge > 0 ? axisReach * edge : 0;
}

/** Scratch for `blockedSpan`, so asking allocates nothing. */
const span = { from: 0, to: 0 };

/**
 * The part of a slice its module actually stands in the flame over, into
 * `span`: where it starts nearer than the flame reaches at that point across.
 * False if it is beyond the flame all the way across. The flame's reach and
 * the module's near face are each straight within a slice, since the nozzle's
 * axis is one of the places slices are cut, so the two cross at most once.
 */
function blockedSpan(slice: PlumeSlice, axisReach: number, centre: number, exitWidth: number): boolean {
  const gapFrom = reachAcross(axisReach, slice.from - centre, exitWidth) - slice.nearFrom;
  const gapTo = reachAcross(axisReach, slice.to - centre, exitWidth) - slice.nearTo;
  if (!(gapFrom > 0) && !(gapTo > 0)) return false;
  span.from = slice.from;
  span.to = slice.to;
  if (gapFrom > 0 && gapTo > 0) return true;
  const cross = slice.from + ((slice.to - slice.from) * gapFrom) / (gapFrom - gapTo);
  if (gapFrom > 0) span.to = cross;
  else span.from = cross;
  return span.to - span.from > SLICE_MIN;
}

/**
 * What one engine's exhaust runs into on its own ship, and what share of it
 * gets out.
 *
 * **Swept across each nozzle exactly rather than sampled.** The modules'
 * outlines are projected across the exit, and every corner that lands on a
 * nozzle cuts it, as does the nozzle's axis. Modules never overlap and each
 * is convex, so every line along the exhaust that meets two of them meets
 * them in the same order: between two cuts the nearest module is the same all
 * the way across, and one cast down the middle names it. Nothing can stand in
 * a flame and between its samples, because there are no samples to stand
 * between, and a nozzle half covered loses half its thrust rather than a
 * third or two.
 *
 * Pure geometry over the boxes a ship is built from, so the compiler and the
 * editor ask the same question of the same layout and get the same answer —
 * which is what stops a panel claiming a thrust the battle will not deliver.
 * `slices` is filled with every stretch something stands in, near or far; the
 * return is the share of the exhaust that leaves the ship at `rating`. A
 * module beyond the flame's own end there does not count against it: the gas
 * has spread to nothing by then, and has no momentum left to hand back.
 */
export function exhaustObstruction(
  boxes: Boxes,
  module: number,
  /** Thrust the nozzle throws at full throttle, newtons. */
  rating: number,
  path: HullPath,
  slices: PlumeSlice[],
): number {
  slices.length = 0;

  const engine = boxes.modules[module];
  if (engine === undefined) return 1;
  const geometry = engineGeometry(engine.spec);
  const exitWidth = geometry.exitWidth;
  if (!(exitWidth > 0)) return 1;
  const dirX = cos(engine.angle);
  const dirY = sin(engine.angle);
  // The exhaust leaves by the face opposite the one the engine pushes from.
  const rootX = engine.x - dirX * engine.spec.length * 0.5;
  const rootY = engine.y - dirY * engine.spec.length * 0.5;
  // Far enough to leave the ship by any route through it.
  let far = 0;
  for (const m of boxes.modules) {
    const reach = m.x * m.x + m.y * m.y;
    if (reach > far) far = reach;
  }
  far = sqrt(far) * 2 + 1;

  /** Where the exhaust down `across` first meets a module, into `hit`. */
  const hit = { module: -1, at: Infinity };
  const castAt = (across: number, only = -1): void => {
    const x = rootX - dirY * across;
    const y = rootY + dirX * across;
    modulesAlong(boxes, x, y, x - dirX * far, y - dirY * far, path);
    hit.module = -1;
    hit.at = Infinity;
    for (let k = 0; k < path.count; k++) {
      const m = path.module[k]!;
      if (m === module || (only >= 0 && m !== only)) continue;
      hit.module = m;
      hit.at = path.entry[k]!;
      return;
    }
  };

  // Every corner of every other module, as metres across the exit face.
  const corners: number[] = [];
  const corner = (x: number, y: number): void => {
    corners.push((x - rootX) * -dirY + (y - rootY) * dirX);
  };
  for (let i = 0; i < boxes.modules.length; i++) {
    if (i === module) continue;
    const m = boxes.modules[i]!;
    const c = cos(m.angle);
    const s = sin(m.angle);
    const triangle = triangleOf(m.spec);
    if (triangle !== null) {
      for (let v = 0; v < triangle.length; v += 2) {
        corner(m.x + triangle[v]! * c - triangle[v + 1]! * s, m.y + triangle[v]! * s + triangle[v + 1]! * c);
      }
      continue;
    }
    const hl = m.spec.length * 0.5;
    const hw = m.spec.width * 0.5;
    for (const [lx, ly] of [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw]] as const) {
      corner(m.x + lx * c - ly * s, m.y + lx * s + ly * c);
    }
  }

  const axisReach = nozzleReach(geometry, rating);
  let blocked = 0;
  for (let nozzle = 0; nozzle < geometry.nozzles; nozzle++) {
    const centre = nozzleOffset(geometry, nozzle);
    const lo = centre - exitWidth * 0.5;
    const hi = centre + exitWidth * 0.5;
    const cuts = [lo, centre, hi];
    for (const at of corners) if (at > lo && at < hi) cuts.push(at);
    cuts.sort((a, b) => a - b);

    for (let k = 0; k + 1 < cuts.length; k++) {
      const from = cuts[k]!;
      const to = cuts[k + 1]!;
      if (!(to - from > SLICE_MIN)) continue;
      castAt((from + to) * 0.5);
      const m = hit.module;
      if (m < 0) continue;
      // Its near face is straight across the slice, so two casts inside it
      // give the line, and the line gives it at the ends.
      const quarter = (to - from) * 0.25;
      castAt(from + quarter, m);
      const nearA = hit.at;
      castAt(to - quarter, m);
      const nearB = hit.at;
      const slope = (nearB - nearA) / (2 * quarter);
      const nearFrom = nearA - slope * quarter;
      const nearTo = nearB + slope * quarter;
      const slice: PlumeSlice = {
        nozzle,
        from,
        to,
        module: m,
        nearFrom: nearFrom > 0 ? nearFrom : 0,
        nearTo: nearTo > 0 ? nearTo : 0,
      };
      slices.push(slice);
      if (blockedSpan(slice, axisReach, centre, exitWidth)) blocked += span.to - span.from;
    }
  }
  const escaping = 1 - blocked / (geometry.nozzles * exitWidth);
  return escaping > 0 ? escaping : 0;
}

/**
 * How much of a nozzle's power a slice's module takes at `axisReach`, as metres
 * of the nozzle's width at full strength: the stretch it stands in, each part
 * of it weighted by how far the flame has faded by the time it gets there.
 * Simpson's rule over the stretch, since the fade is a ratio of two straight
 * lines rather than a straight line itself.
 */
function burntWidth(slice: PlumeSlice, axisReach: number, centre: number, exitWidth: number): number {
  if (!blockedSpan(slice, axisReach, centre, exitWidth)) return 0;
  const a = span.from;
  const b = span.to;
  const ends = fadeAt(slice, a, axisReach, centre, exitWidth) + fadeAt(slice, b, axisReach, centre, exitWidth);
  return ((b - a) / 6) * (ends + 4 * fadeAt(slice, (a + b) * 0.5, axisReach, centre, exitWidth));
}

/** What is left of the flame where it meets a slice's module at `across`, 0 to 1. */
function fadeAt(slice: PlumeSlice, across: number, axisReach: number, centre: number, exitWidth: number): number {
  const near = slice.nearFrom + ((slice.nearTo - slice.nearFrom) * (across - slice.from)) / (slice.to - slice.from);
  const reach = reachAcross(axisReach, across - centre, exitWidth);
  const left = reach > 0 ? 1 - near / reach : 0;
  return left > 0 ? left : 0;
}

/**
 * Where a band's gas leaves the ship, into `band`: how much of the band is
 * open at `axisReach`, the middle of its widest open stretch, and how far out
 * the nearest thing of its own the band runs into is.
 */
const band = { open: 0, at: 0, nearest: Infinity };
function openBand(
  slices: readonly PlumeSlice[],
  nozzle: number,
  from: number,
  to: number,
  axisReach: number,
  centre: number,
  exitWidth: number,
): void {
  band.open = 0;
  band.at = (from + to) * 0.5;
  band.nearest = Infinity;
  let widest = 0;
  // Slices are in order across the face, so the gaps between the stretches
  // they block are the open ones.
  let cursor = from;
  for (let k = 0; k <= slices.length; k++) {
    let until = to;
    let after = to;
    if (k < slices.length) {
      const slice = slices[k]!;
      if (slice.nozzle !== nozzle || slice.to <= from || slice.from >= to) continue;
      if (!blockedSpan(slice, axisReach, centre, exitWidth)) continue;
      until = span.from > from ? span.from : from;
      after = span.to < to ? span.to : to;
      if (!(after - until > SLICE_MIN)) continue;
      const near = slice.nearFrom < slice.nearTo ? slice.nearFrom : slice.nearTo;
      if (near < band.nearest) band.nearest = near;
    }
    if (until - cursor > SLICE_MIN) {
      band.open += until - cursor;
      if (until - cursor > widest) {
        widest = until - cursor;
        band.at = (cursor + until) * 0.5;
      }
    }
    if (after > cursor) cursor = after;
  }
}

/**
 * Least share of its power a plume must land for an engine to be worth firing
 * as a weapon.
 *
 * A plume fades to nothing at its own reach, so the far end of one delivers
 * almost nothing while costing the ship the full push of the burn. An engine
 * that lit up whenever an enemy was anywhere in the flame would spend most of
 * its firing shoving itself about for no damage, so it holds until the target
 * is in the half of the plume that is worth burning — which is also what makes
 * this a close-quarters weapon rather than a second gun.
 */
export const WEAPON_PLUME_SHARE = 0.5;

/**
 * How far along one flame an engine used as a weapon will fire on what it
 * finds: the part landing at least `WEAPON_PLUME_SHARE`. Rays fade linearly,
 * so it is the flame's triangle cut short, and this is its length.
 */
export function weaponPlumeReach(geometry: EngineGeometry, force: number): number {
  return nozzleReach(geometry, force) * (1 - WEAPON_PLUME_SHARE);
}

/**
 * Where the plumes land, and what that costs whoever is standing in them.
 *
 * Kept apart from `Ships` for the same reason `Impacts` is: the model can be
 * driven, and tested, without one.
 */
export class Plumes {
  private readonly hit = new RayHit();

  /** Body the last `cast` landed on, or -1 if that ray met nothing. */
  body = -1;
  /** Module on that body, or -1 where the cast met a body with no hull. */
  module = -1;
  /**
   * Fraction of *one ray's* power landing there — 1 at the nozzle and 0 at
   * that ray's own end. A ray carries a third of a nozzle, so the share of
   * the whole plume is this over `PLUME_RAYS`, times `open`.
   */
  share = 0;
  /** How much of the ray's band leaves the ship rather than meeting its own hull, 0 to 1. */
  open = 0;
  /**
   * What is left of the band's flame where it first meets its own ship,
   * measured as `share` is, or 0 if it meets none: where the drawn flame is
   * cut off by its own hull.
   */
  own = 0;
  /** Where it landed, world frame, which is where its push acts. */
  x = 0;
  y = 0;
  /** The way the exhaust is travelling, world frame, unit. */
  dirX = 0;
  dirY = 0;

  /**
   * Where the open part of one ray's band of one engine's plume lands if it
   * burns at `force`, filled into `body`, `module`, `share` and the impact;
   * `open` and `own` are filled whatever it meets. Returns false if that
   * band reaches nothing beyond its own ship.
   *
   * **What its own hull stands in never leaves the ship**, so only the rest of
   * the band is cast, from the middle of its widest open stretch: what the
   * hull blocks is burnt by `burn` from the design's slices, and pushes
   * nothing, because its momentum has already been counted against the
   * engine's thrust (`EngineSpec.escaping`).
   *
   * **The first thing in the way takes all of it and shields everything
   * behind**, spent or not: a plume is gas, and a wrecked module is still a
   * wall of metal to it. That is how a shell and a ram see a hull, and unlike
   * a beam, which is stopped only by matter it can still boil away.
   *
   * **A plume stays in its engine's layer**, as a beam does: a fighter's
   * flame passes over the deck it is flying above, and a capital's deck-level
   * engine passes under the fighters behind it. A thick engine stands in both
   * and is cast in each separately, so `layers` is one layer for a burn.
   *
   * Held rather than returned, so that a caller deciding whether to *fire* can
   * ask the same question a burn does and get the same answer.
   */
  cast(
    design: ShipDesign,
    slot: number,
    ray: number,
    /** Thrust the engine is producing, or would produce, newtons. */
    force: number,
    bodies: Bodies,
    bodyIndex: number,
    grid: SpatialGrid,
    hulls: Hulls,
    /** The layers to cast in. */
    layers = BOTH_LAYERS,
  ): boolean {
    this.body = -1;
    this.module = -1;
    this.share = 0;
    this.open = 0;
    this.own = 0;

    const spec = design.engines[slot];
    if (spec === undefined || !(force > 0)) return false;
    const engine = design.modules[spec.module ?? -1];
    if (engine === undefined) return false;

    const geometry = engineGeometry(engine.spec);
    const exitWidth = geometry.exitWidth;
    const centre = nozzleOffset(geometry, rayNozzle(ray).nozzle);
    const axisReach = nozzleReach(geometry, force);
    this.own = ownLanding(design, slot, ray, force);
    this.open = band.open / (exitWidth / 3);
    if (!(band.open > 0)) return false;

    const reach = reachAcross(axisReach, band.at - centre, exitWidth);
    if (!(reach > 0)) return false;

    const angle = bodies.angle[bodyIndex]!;
    const c = cos(angle);
    const s = sin(angle);
    const rootX = spec.x - spec.dirX * engine.spec.length * 0.5 - spec.dirY * band.at;
    const rootY = spec.y - spec.dirY * engine.spec.length * 0.5 + spec.dirX * band.at;
    const ux = -(spec.dirX * c - spec.dirY * s);
    const uy = -(spec.dirX * s + spec.dirY * c);
    const x0 = bodies.x[bodyIndex]! + rootX * c - rootY * s;
    const y0 = bodies.y[bodyIndex]! + rootX * s + rootY * c;

    const dx = ux * reach;
    const dy = uy * reach;
    const hit = this.hit;
    hulls.castFrom(layers, -1, -1);
    if (!grid.raycast(bodies, x0, y0, x0 + dx, y0 + dy, hit, bodyIndex, hulls)) {
      hulls.reset();
      return false;
    }
    const distance = reach * hit.t;
    // A body with no hull to cast against has no module to burn, and
    // `Damage.absorb` says so by refusing the index.
    const victimModule = hulls.describe(bodies, hit.bodyIndex, x0, y0, dx, dy) ? hulls.module : -1;
    hulls.reset();

    const share = 1 - distance / reach;
    if (!(share > 0)) return false;
    this.body = hit.bodyIndex;
    this.module = victimModule;
    this.share = share;
    this.x = x0 + ux * distance;
    this.y = y0 + uy * distance;
    this.dirX = ux;
    this.dirY = uy;
    return true;
  }

  /**
   * Burn and shove whatever one engine's plume is playing on, for one step.
   *
   * **Its own hull first, from the design's slices**: each module standing in
   * the flame takes the power of the stretch of nozzle it stands in, faded by
   * how far out it is, and is pushed by none of it — that momentum was taken
   * off the engine's thrust when the design was compiled, so paying it again
   * here would be the ship pushing itself. All of it, whichever layers the
   * flame is in, as the hull blocks it before it divides.
   *
   * **Then whatever the rest lands on.** The push is the exhaust's momentum
   * arriving, so it acts along the exhaust and at the point it lands — which
   * means a plume on a hull's flank spins it as well as pushing it, and a ship
   * can be shoved off a firing solution by an engine rather than shot off one.
   *
   * **A thick engine burns in each layer with half of every ray**, so what is
   * in one layer takes its half and the other half goes on past it.
   */
  burn(
    design: ShipDesign,
    slot: number,
    force: number,
    damage: Damage,
    bodies: Bodies,
    bodyIndex: number,
    grid: SpatialGrid,
    hulls: Hulls,
    dt: number,
    /** Where to write each ray's `share` landing on anything (`landedIndex`), 0 where it met nothing. */
    landed?: Float64Array,
    /** The body's layers (`Ships.layersOf`): `OWN_LAYERS` for each module its own. */
    bodyLayers = OWN_LAYERS,
  ): void {
    if (!(dt > 0) || !(force > 0)) return;
    const spec = design.engines[slot];
    const engine = design.modules[spec?.module ?? -1];
    if (spec === undefined || engine === undefined) return;
    const geometry = engineGeometry(engine.spec);
    const exitWidth = geometry.exitWidth;
    // Power across a nozzle is even, so a module takes its width's share.
    const perWidth = (PLUME_POWER_PER_NEWTON * force) / geometry.nozzles / exitWidth;
    const axisReach = nozzleReach(geometry, force);
    const slices = spec.slices ?? NO_SLICES;
    for (let k = 0; k < slices.length; k++) {
      const slice = slices[k]!;
      const width = burntWidth(slice, axisReach, nozzleOffset(geometry, slice.nozzle), exitWidth);
      if (!(width > 0)) continue;
      damage.absorb(bodyIndex, slice.module, perWidth * width * dt);
      heatSeams(damage, design, bodyIndex, slice.module, perWidth * width * dt);
    }

    const layers = moduleLayers(engine, bodyLayers);
    // A ray is one equal slice of the engine: a third of one of its nozzles,
    // so that share of the gas, the power and the momentum, split again
    // between the layers it is in.
    const rays = plumeRays(geometry);
    const perRay = force / rays / layerCount(layers);
    for (let layer = HULL_LAYER; layer <= WEAPONS_LAYER; layer <<= 1) {
      if ((layers & layer) === 0) continue;
      for (let ray = 0; ray < rays; ray++) {
        const hit = this.cast(design, slot, ray, force, bodies, bodyIndex, grid, hulls, layer);
        if (landed !== undefined) {
          landed[landedIndex(design, slot, ray, layer)] = hit && this.share > this.own ? this.share : this.own;
        }
        if (!hit) continue;
        const carried = perRay * this.open * this.share;
        damage.absorb(this.body, this.module, PLUME_POWER_PER_NEWTON * carried * dt);
        const victim = this.body === bodyIndex ? design : hulls.designOf(this.body);
        if (victim !== null) heatSeams(damage, victim, this.body, this.module, PLUME_POWER_PER_NEWTON * carried * dt);
        if (this.body === bodyIndex) continue;
        shove(bodies, this.body, this.dirX * carried * dt, this.dirY * carried * dt, this.x, this.y);
      }
    }
  }
}

const NO_SLICES: readonly PlumeSlice[] = [];

/**
 * What is left of one ray's band of flame where it first meets its own ship,
 * burning at `force` — measured as `Plumes.share` is, 1 at the nozzle — or 0
 * if it meets none. Where the drawn flame is cut off by its own hull, so the
 * editor can show a ship burning itself without flying it. Leaves the band's
 * open stretch in `band` for `cast`.
 */
export function ownLanding(design: ShipDesign, slot: number, ray: number, force: number): number {
  band.open = 0;
  const spec = design.engines[slot];
  const engine = design.modules[spec?.module ?? -1];
  if (spec === undefined || engine === undefined || !(force > 0)) return 0;
  const geometry = engineGeometry(engine.spec);
  const exitWidth = geometry.exitWidth;
  const { nozzle, across } = rayNozzle(ray);
  const centre = nozzleOffset(geometry, nozzle);
  const from = centre + (across - 1 / 6) * exitWidth;
  openBand(spec.slices ?? NO_SLICES, nozzle, from, from + exitWidth / 3, nozzleReach(geometry, force), centre, exitWidth);
  const centroidReach = rayReach(ray, geometry, force);
  return band.nearest < centroidReach ? 1 - band.nearest / centroidReach : 0;
}

/**
 * Cut the welds holding a module a plume is playing on, with `joules` of its
 * heat, shared between them by width.
 *
 * **What frees a module stood in a flame.** The plume's push on its own hull
 * cancels within the hull, so it can tear nothing; its heat boils the seams
 * the way a beam's does (`SEAM_CUT_ENERGY_PER_AREA`). Once one is cut through
 * the module comes away as a piece of its own (`Ships.sever`), the engine has
 * its thrust back, and the flame shoves the piece clear like anything else
 * standing in it.
 */
function heatSeams(damage: Damage, design: ShipDesign, body: number, module: number, joules: number): void {
  if (module < 0 || !(joules > 0)) return;
  const touching = jointsOf(design, module);
  if (touching.length === 0) return;
  const all = joints(design);
  let width = 0;
  for (let k = 0; k < touching.length; k++) width += all[touching[k]!]!.width;
  if (!(width > 0)) return;
  for (let k = 0; k < touching.length; k++) {
    const joint = all[touching[k]!]!;
    // The thinner of the two walls meeting there is the section to boil through.
    const a = design.modules[joint.a]!.stats.wallThickness;
    const b = design.modules[joint.b]!.stats.wallThickness;
    const thickness = a < b ? a : b;
    if (!(thickness > 0)) continue;
    damage.cutWeld(body, touching[k]!, (joules * joint.width) / width / (thickness * SEAM_CUT_ENERGY_PER_AREA));
  }
}

/**
 * Push a body at a world-frame point, as an impulse.
 *
 * The same thing a round does when it stops in a hull, applied to velocities
 * rather than through the force providers because this happens after the world
 * has stepped.
 */
function shove(
  bodies: Bodies,
  body: number,
  jx: number,
  jy: number,
  px: number,
  py: number,
): void {
  const mass = bodies.mass[body]!;
  if (!(mass > 0)) return;
  bodies.vx[body] = bodies.vx[body]! + jx / mass;
  bodies.vy[body] = bodies.vy[body]! + jy / mass;
  const inertia = bodies.inertia[body]!;
  if (!(inertia > 0)) return;
  const rx = px - bodies.x[body]!;
  const ry = py - bodies.y[body]!;
  bodies.angularVel[body] = bodies.angularVel[body]! + (rx * jy - ry * jx) / inertia;
}
