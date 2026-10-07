import { abs, angleDelta, atan2, max, min, normalizeAngle, PI, TAU } from './math.js';
import type { ShipDesign } from './blueprint.js';

/**
 * Which way round a ship fights: the bearing off its bow it wants its target
 * on, worked out from where its main guns can train.
 *
 * Every bearing a set of arcs can be asked about lies in a *region*: a stretch
 * over which the same guns bear. The best regions each start where some arc
 * starts, so trying each arc's start in turn, and narrowing to every arc that
 * covers it, finds them all without sorting anything.
 */

/** Half the bearing a weapon engine's flame is taken to cover, radians. */
export const FLAME_ARC = (10 * PI) / 180;

/**
 * The arcs to choose a bearing from, body frame: where each starts, going
 * anticlockwise, and how wide it is. Reused, so choosing allocates nothing
 * once it has grown to the ship with the most main guns.
 */
export class AttackArcs {
  start = new Float64Array(8);
  width = new Float64Array(8);
  /** One over each weapon's shot speed, s/m: zero for one that arrives at once. */
  slowness = new Float64Array(8);
  count = 0;
  /** Weapons that bear all the way round, and so on any bearing. */
  everywhere = 0;
  /** How many of those fire shot, and their `slowness` summed. */
  everywhereShot = 0;
  everywhereSlowness = 0;

  clear(): void {
    this.count = 0;
    this.everywhere = 0;
    this.everywhereShot = 0;
    this.everywhereSlowness = 0;
  }

  /**
   * A weapon that bears from `from` anticlockwise through `width`, firing at
   * `speed` m/s; zero or less for a beam or a flame, which arrives at once.
   */
  add(from: number, width: number, speed: number): void {
    const slowness = speed > 0 ? 1 / speed : 0;
    if (width >= TAU) {
      this.everywhere++;
      if (slowness > 0) {
        this.everywhereShot++;
        this.everywhereSlowness += slowness;
      }
      return;
    }
    if (this.count === this.start.length) {
      const grow = (a: Float64Array<ArrayBuffer>): Float64Array<ArrayBuffer> => {
        const out = new Float64Array(this.count * 2);
        out.set(a);
        return out;
      };
      this.start = grow(this.start);
      this.width = grow(this.width);
      this.slowness = grow(this.slowness);
    }
    this.start[this.count] = normalizeAngle(from);
    this.width[this.count] = width;
    this.slowness[this.count] = slowness;
    this.count++;
  }

  /** A mount training `rightArc` clockwise and `leftArc` anticlockwise of `rest`. */
  addMount(rest: number, leftArc: number, rightArc: number, speed: number): void {
    this.add(rest - rightArc, leftArc + rightArc, speed);
  }

  get total(): number {
    return this.count + this.everywhere;
  }
}

/** A stretch of bearings over which the same guns bear. */
export class AttackRegion {
  from = 0;
  width = 0;
  guns = 0;
  /**
   * The speed its guns' shot flies at, m/s, as the harmonic mean over those
   * that fire shot, so it leads by their average time of flight: zero when
   * every weapon in it arrives at once.
   */
  speed = 0;
  /** Where in it to hold the target: the thrust axis when that is in it, else the middle. */
  aim = 0;
}

/** How far anticlockwise `a` is from `from`, in [0, TAU). */
function sweep(from: number, a: number): number {
  const d = normalizeAngle(a - from);
  return d < 0 ? d + TAU : d;
}

/** Whether `a` lies in the region `from`..`from + width`. */
function inside(a: number, from: number, width: number): boolean {
  return sweep(from, a) <= width;
}

/**
 * The region starting where the `k`-th arc does, into `out`, held on `rest`
 * if it covers it: a ship whose guns bear down its thrust axis fights along
 * it, so it can close and fire at once.
 */
export function regionAt(arcs: AttackArcs, k: number, rest: number, out: AttackRegion): AttackRegion {
  const from = arcs.start[k]!;
  let width = arcs.width[k]!;
  let guns = arcs.everywhere;
  let shot = arcs.everywhereShot;
  let slowness = arcs.everywhereSlowness;
  for (let j = 0; j < arcs.count; j++) {
    const into = sweep(arcs.start[j]!, from);
    if (into > arcs.width[j]!) continue;
    guns++;
    width = min(width, arcs.width[j]! - into);
    if (arcs.slowness[j]! > 0) {
      shot++;
      slowness += arcs.slowness[j]!;
    }
  }
  out.from = from;
  out.width = width;
  out.guns = guns;
  out.speed = slowness > 0 ? shot / slowness : 0;
  out.aim = inside(rest, from, width) ? rest : normalizeAngle(from + width / 2);
  return out;
}

const scratch = new AttackRegion();

/**
 * The region of bearings to hold the target in, and where in it, given
 * where it is now (`current`, body frame), how much a turn costs (`bias`, a
 * share of the battery per half turn) and its thrust axis (`rest`).
 *
 * The share of main guns a region brings to bear, less `bias` for every half
 * turn it is from where the target already is, so a ship with a battery on
 * each beam fights on whichever is nearer, and turns its other side only for
 * more guns than the turn costs it. The thrust axis when nothing is to
 * choose: no main guns, or every one of them trains right round.
 */
export function attackBearing(
  arcs: AttackArcs,
  current: number,
  bias: number,
  rest: number,
  out: AttackRegion,
): AttackRegion {
  const total = arcs.total;
  let best = -Infinity;
  out.from = rest;
  out.width = TAU;
  out.guns = arcs.everywhere;
  out.speed = arcs.everywhereSlowness > 0 ? arcs.everywhereShot / arcs.everywhereSlowness : 0;
  out.aim = rest;
  for (let k = 0; k < arcs.count; k++) {
    const region = regionAt(arcs, k, rest, scratch);
    const off = inside(current, region.from, region.width)
      ? 0
      : min(abs(angleDelta(current, region.from)), abs(angleDelta(current, region.from + region.width)));
    const score = region.guns / total - (bias * off) / PI;
    if (score > best) {
      best = score;
      out.from = region.from;
      out.width = region.width;
      out.guns = region.guns;
      out.speed = region.speed;
      out.aim = region.aim;
    }
  }
  return out;
}

/**
 * Every bearing that brings the most main guns to bear, with how many: what
 * the editor shows. Allocates; not for a running battle.
 */
export function bestAttackBearings(arcs: AttackArcs, rest: number): { bearing: number; guns: number }[] {
  const out: { bearing: number; guns: number }[] = [];
  let most = 0;
  const region = new AttackRegion();
  for (let k = 0; k < arcs.count; k++) most = max(most, regionAt(arcs, k, rest, region).guns);
  for (let k = 0; k < arcs.count; k++) {
    regionAt(arcs, k, rest, region);
    if (region.guns < most) continue;
    if (out.some((r) => abs(angleDelta(r.bearing, region.aim)) < 1e-9)) continue;
    out.push({ bearing: region.aim, guns: region.guns });
  }
  if (out.length === 0) out.push({ bearing: rest, guns: arcs.everywhere });
  return out;
}

/**
 * Every main weapon a design has, as arcs: what the editor asks about, and
 * what a ship with nothing yet shot off fights with.
 */
export function designArcs(design: ShipDesign, out: AttackArcs): AttackArcs {
  out.clear();
  for (const turret of design.turrets) {
    if (turret.main) addTurret(out, turret.mount);
  }
  for (const t of design.mainEngines) addFlame(out, design, t);
  return out;
}

/** A mount's arc, as its spec gives it: right round when it gives none. */
export function addTurret(
  out: AttackArcs,
  mount: { restBearing?: number; leftArc?: number; rightArc?: number; muzzleSpeed?: number },
): void {
  out.addMount(mount.restBearing ?? 0, mount.leftArc ?? PI, mount.rightArc ?? PI, mount.muzzleSpeed ?? 0);
}

/** The `t`-th engine's flame, which points the way it does not push. */
export function addFlame(out: AttackArcs, design: ShipDesign, t: number): void {
  const engine = design.engines[t]!;
  out.add(atan2(-engine.dirY, -engine.dirX) - FLAME_ARC, 2 * FLAME_ARC, 0);
}
