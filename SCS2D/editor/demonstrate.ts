import { MAX_BEAM_LENGTH } from '../sim/beams.js';
import { math, type ShipDesign, type Snapshot } from '../sim/index.js';
import { GunType } from '../sim/modules.js';

const { cos, sin, min, max } = math;

/**
 * The selected module, shown doing its job: an engine burns, a gun fires.
 *
 * A module's figures are hard to feel. "9.4 rounds per minute" and "600" are
 * both just numbers until you watch the gun cycle, and a thruster's share of
 * the ship's thrust is a plume's length rather than a fraction. This animates
 * exactly the figures already on the panel, so it adds nothing that is not
 * already claimed — the rate is the gun's `cycleTime`, the rounds leave at its
 * `muzzleSpeed` and are its calibre wide, and the plume is drawn by the same
 * renderer from the same throttle a flying ship would report.
 *
 * **This is an animation and not a simulation, and the distinction is the
 * point.** Nothing is integrated, nothing collides, no round can hit anything
 * and the ship does not move however hard its engine burns. Rounds fly
 * straight, ignore gravity, and are forgotten when their time is up. The
 * editor's *test flight* — the thing that would put a ship in a scene and let
 * it fly — is a separate piece of work (ROADMAP.md §8, step 1), and this is
 * deliberately not a start on it: a straight line at a constant speed cannot
 * grow into one by accident.
 */

/** How long a round is kept before it is forgotten, seconds. */
export const ROUND_LIFETIME = 2.5;

/** Most rounds held at once, so a fast gun cannot grow the buffer without end. */
const MAX_ROUNDS = 256;

/** Seconds for a selected engine to come up to full throttle, and to fall back. */
const SPOOL_TIME = 0.8;

/** Rounds in the air, as flat arrays so the snapshot can be filled without objects. */
interface Rounds {
  // Typed to a plain ArrayBuffer so they can be handed straight to a snapshot,
  // whose buffers are the same shape.
  x: Float64Array<ArrayBuffer>;
  y: Float64Array<ArrayBuffer>;
  vx: Float64Array<ArrayBuffer>;
  vy: Float64Array<ArrayBuffer>;
  width: Float64Array<ArrayBuffer>;
  age: Float64Array<ArrayBuffer>;
  count: number;
}

/**
 * Beams being shown, as flat arrays so the snapshot can be filled without
 * objects.
 *
 * A beam is not in flight the way a round is — it exists for as long as its
 * mount holds the trigger down and then stops — so what is stored is how much
 * of that dwell is left rather than how far it has travelled.
 */
interface Beams {
  // Typed to a plain ArrayBuffer so they can be handed straight to a snapshot,
  // whose buffers are the same shape.
  startX: Float64Array<ArrayBuffer>;
  startY: Float64Array<ArrayBuffer>;
  endX: Float64Array<ArrayBuffer>;
  endY: Float64Array<ArrayBuffer>;
  width: Float64Array<ArrayBuffer>;
  power: Float64Array<ArrayBuffer>;
  /** Seconds of dwell still to run. */
  remaining: Float64Array<ArrayBuffer>;
  count: number;
}

export class Demonstration {
  /** Throttle each of the design's thrusters is showing, 0 to 1. */
  private throttles = new Float64Array(0);
  /** Seconds until each of the design's turrets fires its next round. */
  private cycles = new Float64Array(0);
  private rounds: Rounds = {
    x: new Float64Array(MAX_ROUNDS),
    y: new Float64Array(MAX_ROUNDS),
    vx: new Float64Array(MAX_ROUNDS),
    vy: new Float64Array(MAX_ROUNDS),
    width: new Float64Array(MAX_ROUNDS),
    age: new Float64Array(MAX_ROUNDS),
    count: 0,
  };
  private beams: Beams = {
    startX: new Float64Array(MAX_ROUNDS),
    startY: new Float64Array(MAX_ROUNDS),
    endX: new Float64Array(MAX_ROUNDS),
    endY: new Float64Array(MAX_ROUNDS),
    width: new Float64Array(MAX_ROUNDS),
    power: new Float64Array(MAX_ROUNDS),
    remaining: new Float64Array(MAX_ROUNDS),
    count: 0,
  };
  /** Which barrel of each turret fires next, so a multi-barrel mount alternates. */
  private barrels = new Int32Array(0);

  /**
   * Whether there is anything to keep drawing for.
   *
   * What the page uses to decide whether to ask for another frame: an editor
   * that runs an animation loop while nothing is animating is burning a
   * laptop's battery to redraw the same picture.
   *
   * It has to mean *something to show* rather than *something moving*, and the
   * difference is not pedantic — both of the cases it covers were bugs. The
   * first frame after a selection arrives with no elapsed time, so nothing has
   * moved yet and an engine would never start spooling; and a selected gun
   * between shots has nothing in the air, so a slow one would stop being drawn
   * before it ever fired.
   */
  get running(): boolean {
    return this.busy;
  }

  private busy = false;

  /** Forget everything, for when a different ship is opened. */
  reset(): void {
    this.busy = false;
    this.throttles = new Float64Array(0);
    this.cycles = new Float64Array(0);
    this.barrels = new Int32Array(0);
    this.rounds.count = 0;
    this.beams.count = 0;
  }

  /**
   * Advance by `dt` wall seconds, with `selected` the layout indices of the
   * modules currently selected.
   *
   * Wall seconds, not simulated ones: this is a picture of a module rather
   * than a state of the world, so there is nothing here that has to be
   * reproducible and nothing that a fixed step would buy.
   */
  step(design: ShipDesign, selected: readonly number[], dt: number): void {
    this.fit(design);
    let busy = false;

    for (let t = 0; t < design.thrusters.length; t++) {
      const module = design.modules[this.thrusterModule(design, t)];
      const wanted = module !== undefined && selected.includes(module.index) ? 1 : 0;
      const step = dt / SPOOL_TIME;
      const at = this.throttles[t]!;
      this.throttles[t] = wanted > at ? min(1, at + step) : max(0, at - step);
      if (wanted > 0 || this.throttles[t]! > 0) busy = true;
    }

    for (let t = 0; t < design.turrets.length; t++) {
      const turret = design.turrets[t]!;
      const module = design.modules[turret.module];
      if (module === undefined || !selected.includes(module.index)) {
        this.cycles[t] = 0;
        continue;
      }
      const cycle = turret.gun.cycleTime;
      if (!(cycle > 0)) continue;
      // A gun waiting out a long cycle is still being shown, even with nothing
      // in the air to prove it.
      busy = true;
      this.cycles[t] = this.cycles[t]! - dt;
      // One round per cycle elapsed, and never more than one per frame: a gun
      // whose cycle is shorter than a frame is drawn as fast as the display
      // can show rather than in a burst that arrives together.
      if (this.cycles[t]! <= 0) {
        this.cycles[t] = cycle;
        this.fire(design, t);
      }
    }

    const rounds = this.rounds;
    for (let i = rounds.count - 1; i >= 0; i--) {
      rounds.x[i] = rounds.x[i]! + rounds.vx[i]! * dt;
      rounds.y[i] = rounds.y[i]! + rounds.vy[i]! * dt;
      rounds.age[i] = rounds.age[i]! + dt;
      if (rounds.age[i]! < ROUND_LIFETIME) continue;
      // Swap the last round into the gap rather than shifting the rest down.
      const last = --rounds.count;
      rounds.x[i] = rounds.x[last]!;
      rounds.y[i] = rounds.y[last]!;
      rounds.vx[i] = rounds.vx[last]!;
      rounds.vy[i] = rounds.vy[last]!;
      rounds.width[i] = rounds.width[last]!;
      rounds.age[i] = rounds.age[last]!;
    }


    const beams = this.beams;
    for (let i = beams.count - 1; i >= 0; i--) {
      beams.remaining[i] = beams.remaining[i]! - dt;
      if (beams.remaining[i]! > 0) continue;
      // Swap the last beam into the gap rather than shifting the rest down.
      const last = --beams.count;
      beams.startX[i] = beams.startX[last]!;
      beams.startY[i] = beams.startY[last]!;
      beams.endX[i] = beams.endX[last]!;
      beams.endY[i] = beams.endY[last]!;
      beams.width[i] = beams.width[last]!;
      beams.power[i] = beams.power[last]!;
      beams.remaining[i] = beams.remaining[last]!;
    }

    this.busy = busy || rounds.count > 0 || beams.count > 0;
  }

  /** Write what is being shown into a snapshot the renderer already understands. */
  writeInto(snapshot: Snapshot): void {
    const view = snapshot.ships[0];
    if (view !== undefined) {
      for (let t = 0; t < view.throttles.length; t++) view.throttles[t] = this.throttles[t] ?? 0;
    }
    const rounds = this.rounds;
    snapshot.projectileX = rounds.x;
    snapshot.projectileY = rounds.y;
    snapshot.projectileVx = rounds.vx;
    snapshot.projectileVy = rounds.vy;
    snapshot.projectileWidth = rounds.width;
    snapshot.projectileCount = rounds.count;
    const beams = this.beams;
    snapshot.beamStartX = beams.startX;
    snapshot.beamStartY = beams.startY;
    snapshot.beamEndX = beams.endX;
    snapshot.beamEndY = beams.endY;
    snapshot.beamWidth = beams.width;
    snapshot.beamPower = beams.power;
    snapshot.beamCount = beams.count;
  }

  /** Resize the per-module state when a different design is being shown. */
  private fit(design: ShipDesign): void {
    if (this.throttles.length !== design.thrusters.length) {
      this.throttles = new Float64Array(design.thrusters.length);
    }
    if (this.cycles.length !== design.turrets.length) {
      this.cycles = new Float64Array(design.turrets.length);
      this.barrels = new Int32Array(design.turrets.length);
    }
  }

  /** Which module the `t`th thruster is, the design listing them in module order. */
  private thrusterModule(design: ShipDesign, t: number): number {
    let seen = 0;
    for (let i = 0; i < design.modules.length; i++) {
      if (design.modules[i]!.spec.kind !== 'thruster') continue;
      if (seen === t) return i;
      seen++;
    }
    return -1;
  }

  /** Put one round in the air, leaving the next barrel at the gun's muzzle speed. */
  private fire(design: ShipDesign, t: number): void {
    const rounds = this.rounds;
    const beams = this.beams;
    const turret = design.turrets[t]!;
    const gun = turret.gun;
    if (gun.type === GunType.Projectile && rounds.count >= MAX_ROUNDS) return;


    const mount = turret.mount;

    // Resting, since nothing here is aiming at anything. The design places its
    // modules about the centre of mass and the preview puts the body there, so
    // the ship's own frame is the world's.
    const bearing = mount.restBearing ?? 0;
    const dirX = cos(bearing);
    const dirY = sin(bearing);

    const barrel = this.barrels[t]!;
    this.barrels[t] = (barrel + 1) % gun.barrelCount;
    const lateral =
      gun.barrelCount > 1 ? (barrel - (gun.barrelCount - 1) * 0.5) * gun.barrelSpacing : 0;

    if (gun.type === GunType.Projectile) {
      const i = rounds.count++;
      rounds.x[i] = design.centreOfMassX + mount.x + dirX * gun.barrelLength - dirY * lateral;
      rounds.y[i] = design.centreOfMassY + mount.y + dirY * gun.barrelLength + dirX * lateral;
      rounds.vx[i] = dirX * gun.muzzleSpeed;
      rounds.vy[i] = dirY * gun.muzzleSpeed;
      rounds.width[i] = gun.calibre;
      rounds.age[i] = 0;
    } else {
      if (beams.count >= MAX_ROUNDS) return;
      const i = beams.count++;
      const startX = design.centreOfMassX + mount.x + dirX * gun.barrelLength - dirY * lateral;
      const startY = design.centreOfMassY + mount.y + dirY * gun.barrelLength + dirX * lateral;
      beams.startX[i] = startX;
      beams.startY[i] = startY;
      // Both ends are positions. Writing the heading alone here would run the
      // beam from the muzzle to a point measured from the world origin.
      beams.endX[i] = startX + dirX * MAX_BEAM_LENGTH;
      beams.endY[i] = startY + dirY * MAX_BEAM_LENGTH;
      beams.width[i] = gun.calibre;
      beams.power[i] = gun.beamPower;
      // Lit for as long as the mount holds it, which is the figure the panel
      // shows — the same relationship a round's speed has to its tracer.
      beams.remaining[i] = gun.beamOnTime;
    }
  }
}
