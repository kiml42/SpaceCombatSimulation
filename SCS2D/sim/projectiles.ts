import type { Bodies } from './bodies.js';
import type { WellSpec } from './gravity.js';
import { wellPull } from './gravity.js';
import { cos, sin, sqrt, TAU } from './math.js';
import type { Rng } from './rng.js';
import { RayHit, type SpatialGrid } from './spatialGrid.js';
import { BOTH_LAYERS, HULL_LAYER, WEAPONS_LAYER, type Hulls } from './hull.js';

/**
 * Projectiles: shells, slugs and other ballistic rounds in flight.
 *
 * **A torpedo is not a projectile.** DESIGN.md §2 settles that a torpedo is a
 * strike craft carrying a warhead in place of a gun — so it thrusts, steers,
 * picks its own targets, obeys doctrine and collides, none of which a swept
 * segment can do. It is a *body*, and it belongs with the fighters.
 *
 * The discriminator is **propulsion and guidance, not lethality or size**. What
 * belongs here is anything launched that thereafter merely *falls*, with nothing
 * but physics acting on it. A one-tonne kinetic penetrator is a projectile; a
 * tiny guided munition is not.
 *
 * Beams are neither. A laser is an instantaneous cast against the index with no
 * store and no flight time at all.
 *
 * A projectile is **not a rigid body**. It is a position, a velocity and a
 * payload in a flat array, and a step of its flight is a *swept segment* tested
 * against the spatial index. Two consequences follow, and both are the reason
 * for the design:
 *
 *  - **Tunnelling is impossible.** A body moved forward and then tested where it
 *    landed can pass clean through a hull between one step and the next, and the
 *    usual patch is to raycast afterwards and teleport it back. Casting the
 *    whole step as one segment is that algorithm done in the right place.
 *  - **It is far cheaper.** No rigid body, no mass properties, no integration
 *    into the collision graph. Thousands of rounds in the air are an array walk.
 *
 * Unlike bodies, projectiles get plain integer indices rather than generational
 * handles. Nothing holds a reference to a round across steps: it is spawned,
 * flies, and is consumed on impact or expiry, all inside the system that owns
 * it. Handles exist to catch stale references, and there are none to catch.
 *
 * Impacts are *reported*, not applied — and that includes not deciding whether
 * the round survives. On impact a round is parked at the point of contact and
 * marked **pending**: it stops moving and stops being cast, and waits for
 * something else to say what became of it.
 *
 * That is what lets terminal ballistics live outside this file. A round that
 * penetrates is taken `inside` the hull and walked through it; one that
 * embeds is consumed after its mass and momentum are transferred; one that
 * deflects has its velocity rewritten and is returned to flight with `resume`. Ballistics does
 * not need to know which, and consuming a round unilaterally would already be
 * applying an outcome.
 *
 * Because the round is still alive when its hit is reported, the hit record
 * carries only what the *cast* discovered — which body, where, when in the step
 * and the surface normal. Mass, velocity, remaining flight time and payload are
 * read straight from the store by index, so there is no second copy to diverge.
 */

/** A projectile with no firing ship to pass through. */
export const NO_OWNER = -1;
/** A projectile in open flight rather than passing through a hull. */
export const NOT_INSIDE = -1;


export interface ProjectileSpec {
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  /** Seconds of flight before the round expires. */
  ttl: number;
  /** Used for imparted momentum, and for the mass gained if the round embeds. */
  mass?: number;
  damage?: number;
  /** How deeply the round reaches into a hull's internals. */
  penetration?: number;
  /**
   * The body *index* that fired it. Passed through entirely unless
   * `fromModule` says which part of it fired, in which case only that part is.
   */
  owner?: number;
  /** The module of `owner` it was fired from, or -1. */
  fromModule?: number;
  /**
   * Fired in the weapons layer (DESIGN.md §3), so it meets only weapons-layer
   * modules. Off by default: a round meets everything.
   */
  weaponsLayer?: boolean;
  /** The layers it is in, as a `HULL_LAYER` / `WEAPONS_LAYER` mask. Overrides `weaponsLayer`. */
  layers?: number;
  /** Caller-defined classification (AP, HE, and so on). Uninterpreted here. */
  kind?: number;
  /** Seconds until it bursts into `fragments`. Never when absent. */
  fuse?: number;
  /** How many fragments it bursts into. */
  fragments?: number;
  /** The mass the fragments share, kg: the casing, with the charge gone to gas. The whole round when absent. */
  casing?: number;
  /** The most a fragment's speed differs from the round's, m/s. */
  spread?: number;
  /** Seconds a fragment flies before it expires. */
  fragmentLife?: number;
}

/**
 * Impacts from one step, in projectile order. Reused between steps so that
 * reporting hits allocates nothing.
 */
export class ProjectileHits {
  /** Index of the round, which is still alive and pending resolution. */
  projectile: Int32Array;
  /** Body index struck. */
  body: Int32Array;
  /**
   * Where in the step the impact happened, 0 to 1. A deflected round has
   * `(1 - t) * dt` of its step left, and the remainder is what a substep would
   * carry forward.
   */
  t: Float64Array;
  x: Float64Array;
  y: Float64Array;
  /**
   * Outward unit surface normal at the impact point — what decides incidence
   * angle, and therefore whether an oblique hit skids off armour.
   *
   * The face of the module struck when a hull was cast against; the circle's
   * own normal for a body with no hull to cast against.
   */
  nx: Float64Array;
  ny: Float64Array;
  /**
   * Index into the struck ship's `design.modules`, or -1 where the hit was
   * against a bounding circle and no module is known.
   */
  module: Int32Array;
  count = 0;

  constructor(capacity = 256) {
    this.projectile = new Int32Array(capacity);
    this.body = new Int32Array(capacity);
    this.t = new Float64Array(capacity);
    this.x = new Float64Array(capacity);
    this.y = new Float64Array(capacity);
    this.nx = new Float64Array(capacity);
    this.ny = new Float64Array(capacity);
    this.module = new Int32Array(capacity);
  }

  clear(): void {
    this.count = 0;
  }

  private grow(): void {
    const size = this.projectile.length * 2;
    const i32 = (old: Int32Array): Int32Array => {
      const next = new Int32Array(size);
      next.set(old);
      return next;
    };
    const f64 = (old: Float64Array): Float64Array => {
      const next = new Float64Array(size);
      next.set(old);
      return next;
    };
    this.projectile = i32(this.projectile);
    this.body = i32(this.body);
    this.t = f64(this.t);
    this.x = f64(this.x);
    this.y = f64(this.y);
    this.nx = f64(this.nx);
    this.ny = f64(this.ny);
    this.module = i32(this.module);
  }

  /** Append an impact. Called by `Projectiles.step`. */
  push(
    projectile: number,
    body: number,
    t: number,
    x: number,
    y: number,
    nx: number,
    ny: number,
    module = -1,
  ): void {
    if (this.count === this.projectile.length) this.grow();
    const i = this.count++;
    this.projectile[i] = projectile;
    this.body[i] = body;
    this.t[i] = t;
    this.x[i] = x;
    this.y[i] = y;
    this.nx[i] = nx;
    this.ny[i] = ny;
    this.module[i] = module;
  }
}

export class Projectiles {
  x!: Float64Array;
  y!: Float64Array;
  vx!: Float64Array;
  vy!: Float64Array;
  width!: Float64Array;
  ttl!: Float64Array;
  mass!: Float64Array;
  damage!: Float64Array;
  penetration!: Float64Array;
  owner!: Int32Array;
  fromModule!: Int32Array;
  /** The layers it is in, as a `HULL_LAYER` / `WEAPONS_LAYER` mask. */
  layers!: Uint8Array;
  kind!: Int32Array;
  /** Seconds until it bursts; `Infinity` for a round that never does. */
  fuse!: Float64Array;
  /** The most a fragment's speed differs from the round's, m/s. */
  spread!: Float64Array;
  /** Seconds a fragment flies before it expires: long enough to cross what it was fused for. */
  fragmentLife!: Float64Array;
  /** How many fragments it bursts into. */
  fragments!: Int32Array;
  /** The mass its fragments share, kg. */
  casing!: Float64Array;
  /** 1 for a fragment of a burst, rather than a round a gun fired. */
  fragment!: Uint8Array;
  alive!: Uint8Array;
  /**
   * Set on impact. A pending round is stopped at the point of contact and is
   * not cast again until something resolves it — see the note at the top of
   * this file.
   */
  pending!: Uint8Array;
  /**
   * The body a round is passing through, or `NOT_INSIDE` for one in open
   * flight. A round inside a hull is not cast: the damage model carries it
   * through, a step's travel at a time, so a long hull takes time to cross.
   */
  inside!: Int32Array;
  /**
   * The line a round is walking through that hull, in the hull's own frame:
   * where it went in, and which way.
   */
  lineX!: Float64Array;
  lineY!: Float64Array;
  lineUx!: Float64Array;
  lineUy!: Float64Array;
  /** How far along that line it has got, metres. */
  along!: Float64Array;
  /** The next crossing on the line it has yet to strike, or -1 to find it. */
  crossing!: Int32Array;

  capacity = 0;
  /** Rounds currently in flight, including those awaiting resolution. */
  count = 0;
  /** Rounds stopped at an impact, awaiting resolution. */
  pendingCount = 0;
  /** Rounds passing through a hull. */
  insideCount = 0;
  /** One past the highest slot ever used; loops may stop here. */
  highWater = 0;

  private free: number[] = [];
  private readonly hit = new RayHit();

  constructor(initialCapacity = 1024) {
    this.grow(initialCapacity);
  }

  private grow(capacity: number): void {
    const f64 = (old: Float64Array | undefined): Float64Array => {
      const next = new Float64Array(capacity);
      if (old) next.set(old);
      return next;
    };
    const i32 = (old: Int32Array | undefined): Int32Array => {
      const next = new Int32Array(capacity);
      if (old) next.set(old);
      return next;
    };
    this.x = f64(this.x);
    this.y = f64(this.y);
    this.vx = f64(this.vx);
    this.vy = f64(this.vy);
    this.width = f64(this.width);
    this.ttl = f64(this.ttl);
    this.mass = f64(this.mass);
    this.damage = f64(this.damage);
    this.penetration = f64(this.penetration);
    this.owner = i32(this.owner);
    this.fromModule = i32(this.fromModule);
    const layer = new Uint8Array(capacity);
    if (this.layers) layer.set(this.layers);
    this.layers = layer;
    this.kind = i32(this.kind);
    this.fuse = f64(this.fuse);
    this.spread = f64(this.spread);
    this.fragmentLife = f64(this.fragmentLife);
    this.fragments = i32(this.fragments);
    this.casing = f64(this.casing);
    const fragment = new Uint8Array(capacity);
    if (this.fragment) fragment.set(this.fragment);
    this.fragment = fragment;

    const alive = new Uint8Array(capacity);
    if (this.alive) alive.set(this.alive);
    this.alive = alive;

    const pending = new Uint8Array(capacity);
    if (this.pending) pending.set(this.pending);
    this.pending = pending;

    this.inside = i32(this.inside);
    this.lineX = f64(this.lineX);
    this.lineY = f64(this.lineY);
    this.lineUx = f64(this.lineUx);
    this.lineUy = f64(this.lineUy);
    this.along = f64(this.along);
    this.crossing = i32(this.crossing);

    this.capacity = capacity;
  }

  /**
   * Put a round in the air, allocating nothing. Returns its index.
   *
   * The long argument list is deliberate: firing is frequent enough that the
   * gunnery code should not have to build an options object per shot.
   */
  spawnRaw(
    x: number,
    y: number,
    vx: number,
    vy: number,
    width: number,
    ttl: number,
    mass: number,
    damage: number,
    penetration: number,
    owner: number,
    kind: number,
    fromModule = -1,
    layers = HULL_LAYER,
    fuse = Infinity,
    spread = 0,
    fragmentLife = 0,
    fragments = 0,
    casing = mass,
  ): number {
    let i: number;
    const reused = this.free.pop();
    if (reused !== undefined) {
      i = reused;
    } else {
      if (this.highWater >= this.capacity) this.grow(this.capacity * 2);
      i = this.highWater++;
    }

    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.width[i] = width;
    this.ttl[i] = ttl;
    this.mass[i] = mass;
    this.damage[i] = damage;
    this.penetration[i] = penetration;
    this.owner[i] = owner;
    this.fromModule[i] = fromModule;
    this.layers[i] = layers;
    this.kind[i] = kind;
    this.fuse[i] = fuse;
    this.spread[i] = spread;
    this.fragmentLife[i] = fragmentLife;
    this.fragments[i] = fragments;
    this.casing[i] = casing;
    this.fragment[i] = 0;
    this.alive[i] = 1;
    this.pending[i] = 0;
    this.inside[i] = NOT_INSIDE;
    this.count++;
    return i;
  }

  /** `spawnRaw` with named fields and defaults, for setup code and tests. */
  spawn(spec: ProjectileSpec): number {
    return this.spawnRaw(
      spec.x,
      spec.y,
      spec.vx,
      spec.vy,
      spec.width,
      spec.ttl,
      spec.mass ?? 1,
      spec.damage ?? 0,
      spec.penetration ?? 0,
      spec.owner ?? NO_OWNER,
      spec.kind ?? 0,
      spec.fromModule ?? -1,
      spec.layers ?? (spec.weaponsLayer === true ? WEAPONS_LAYER : HULL_LAYER),
      spec.fuse ?? Infinity,
      spec.spread ?? 0,
      spec.fragmentLife ?? 0,
      spec.fragments ?? 0,
      spec.casing ?? spec.mass ?? 1,
    );
  }

  /**
   * Remove a round from flight — it penetrated, embedded, detonated or expired.
   * Safe to call on an already-dead slot.
   */
  kill(i: number): void {
    if (i < 0 || i >= this.highWater || this.alive[i] === 0) return;
    if (this.pending[i] === 1) {
      this.pending[i] = 0;
      this.pendingCount--;
    }
    if (this.inside[i] !== NOT_INSIDE) {
      this.inside[i] = NOT_INSIDE;
      this.insideCount--;
    }
    this.alive[i] = 0;
    this.free.push(i);
    this.count--;
  }

  /**
   * Return a pending round to flight, after a deflection has rewritten its
   * velocity. The round resumes from the impact point on the next step.
   *
   * A caller that neither kills nor resumes a pending round leaves it stopped
   * in space indefinitely — visible in `pendingCount`, rather than silently
   * re-reporting the same impact every step.
   */
  resume(i: number): void {
    if (i < 0 || i >= this.highWater || this.alive[i] === 0) return;
    if (this.pending[i] === 0) return;
    this.pending[i] = 0;
    this.pendingCount--;
  }

  /**
   * Take a pending round into the hull it hit, to be walked through it along
   * `(ux, uy)` from `(x, y)`, both in that hull's frame.
   */
  enter(i: number, body: number, x: number, y: number, ux: number, uy: number): void {
    if (i < 0 || i >= this.highWater || this.alive[i] === 0) return;
    this.resume(i);
    if (this.inside[i] === NOT_INSIDE) this.insideCount++;
    this.inside[i] = body;
    this.lineX[i] = x;
    this.lineY[i] = y;
    this.lineUx[i] = ux;
    this.lineUy[i] = uy;
    this.along[i] = 0;
    this.crossing[i] = -1;
  }

  /** Return a round that has come out of a hull to open flight. */
  leave(i: number): void {
    if (i < 0 || i >= this.highWater || this.inside[i] === NOT_INSIDE) return;
    this.inside[i] = NOT_INSIDE;
    this.insideCount--;
  }

  /** Remove every round. */
  clear(): void {
    for (let i = 0; i < this.highWater; i++) {
      this.alive[i] = 0;
      this.pending[i] = 0;
      this.inside[i] = NOT_INSIDE;
    }
    this.free.length = 0;
    this.count = 0;
    this.pendingCount = 0;
    this.insideCount = 0;
    this.highWater = 0;
  }

  /**
   * Advance every round by one step, reporting impacts into `hits`.
   *
   * **`grid` must have been rebuilt from `bodies` at their current positions.**
   * Casting against a stale index is the one way to get this wrong, and it
   * fails quietly — rounds pass through hulls that have moved. The step order
   * is: advance bodies, rebuild the index, then advance projectiles.
   *
   * `wells` curves the rounds under gravity. Velocity is updated before the
   * segment is cast, so the path within a step is treated as straight — an
   * approximation whose error is dominated by the step length, and rounds live
   * for seconds rather than orbits, so a first-order scheme is ample here. The
   * scheme that has to behave over thousands of steps is the one in `world.ts`.
   */
  step(
    dt: number,
    bodies: Bodies,
    grid: SpatialGrid,
    hits: ProjectileHits,
    wells?: readonly WellSpec[],
    hulls?: Hulls,
    rng?: Rng,
  ): void {
    hits.clear();
    const bursting = this.bursting;
    bursting.length = 0;

    for (let i = 0; i < this.highWater; i++) {
      if (this.alive[i] === 0 || this.pending[i] === 1 || this.inside[i] !== NOT_INSIDE) continue;

      if (wells !== undefined) {
        let ax = 0;
        let ay = 0;
        for (let w = 0; w < wells.length; w++) {
          const well = wells[w]!;
          const pull = wellPull(well, this.x[i], this.y[i]);
          ax += (well.x - this.x[i]) * pull;
          ay += (well.y - this.y[i]) * pull;
        }
        this.vx[i] += ax * dt;
        this.vy[i] += ay * dt;
      }

      if (this.cast(i, this.vx[i] * dt, this.vy[i] * dt, 0, 1, bodies, grid, hits, hulls)) continue;
      this.ttl[i] -= dt;
      if (this.ttl[i] <= 0) this.kill(i);
      else if ((this.fuse[i] -= dt) <= 0 && rng !== undefined && this.fragments[i] > 1) bursting.push(i);
    }
    // After the walk, so no fragment is flown in the step it was made.
    for (let k = 0; k < bursting.length; k++) this.burst(bursting[k]!, rng!);
  }

  private readonly bursting: number[] = [];

  /**
   * Replace a round with its `fragments`, sharing its casing, energy and bore.
   *
   * Each leaves with the round's velocity plus a kick in a random direction,
   * spread evenly over a disc, and its twin with the opposite kick, so the
   * casing carries on with its own momentum; an odd one out takes none. The
   * charge is gone to gas. Fragments fly in both layers, so they meet every
   * module, and do not burst again.
   */
  private burst(i: number, rng: Rng): void {
    const n = this.fragments[i]!;
    const x = this.x[i]!;
    const y = this.y[i]!;
    const vx = this.vx[i]!;
    const vy = this.vy[i]!;
    const width = this.width[i]! / sqrt(n);
    const life = this.fragmentLife[i]!;
    const ttl = life < this.ttl[i]! ? life : this.ttl[i]!;
    const mass = this.casing[i]! / n;
    const damage = this.damage[i]! / n;
    const penetration = this.penetration[i]!;
    const owner = this.owner[i]!;
    const kind = this.kind[i]!;
    const from = this.fromModule[i]!;
    const spread = this.spread[i]!;
    this.kill(i);
    for (let k = 0; k + 1 < n; k += 2) {
      const angle = rng.nextFloat() * TAU;
      const speed = spread * sqrt(rng.nextFloat());
      const kx = cos(angle) * speed;
      const ky = sin(angle) * speed;
      this.fragment[this.spawnRaw(x, y, vx + kx, vy + ky, width, ttl, mass, damage, penetration, owner, kind, from, BOTH_LAYERS)] = 1;
      this.fragment[this.spawnRaw(x, y, vx - kx, vy - ky, width, ttl, mass, damage, penetration, owner, kind, from, BOTH_LAYERS)] = 1;
    }
    if (n % 2 === 1) {
      this.fragment[this.spawnRaw(x, y, vx, vy, width, ttl, mass, damage, penetration, owner, kind, from, BOTH_LAYERS)] = 1;
    }
  }

  /**
   * Fly a round that came out of a hull partway through a step on for the rest
   * of it, from fraction `t` of the step, reporting what it runs into.
   *
   * Cast rather than moved, because what is just beyond a hull is as often as
   * not another piece of the same ship. `left` is the hull it came out of,
   * which nothing further along its line belongs to. Returns whether it hit
   * something.
   */
  flyOn(
    i: number,
    left: number,
    t: number,
    dt: number,
    bodies: Bodies,
    grid: SpatialGrid,
    hits: ProjectileHits,
    hulls?: Hulls,
  ): boolean {
    const time = (1 - t) * dt;
    return this.cast(i, this.vx[i]! * time, this.vy[i]! * time, t, 1 - t, bodies, grid, hits, hulls, left);
  }

  /**
   * Cast one round along `(dx, dy)`, parking it on what it meets or moving it
   * to the end. `t0` and `span` place the segment within the step, so the hit
   * reports where in the *step* it happened.
   */
  private cast(
    i: number,
    dx: number,
    dy: number,
    t0: number,
    span: number,
    bodies: Bodies,
    grid: SpatialGrid,
    hits: ProjectileHits,
    hulls?: Hulls,
    skip = NOT_INSIDE,
  ): boolean {
    const hit = this.hit;
    const x0 = this.x[i]!;
    const y0 = this.y[i]!;
    // A round that knows which part fired it may come back to the rest of its
    // own ship; one that does not passes through all of it.
    const from = this.fromModule[i]!;
    const owner = this.owner[i]!;
    hulls?.castFrom(this.layers[i]!, owner, from);
    const found = grid.raycast(bodies, x0, y0, x0 + dx, y0 + dy, hit, from >= 0 ? -1 : owner, hulls, skip);
    if (!found) {
      hulls?.reset();
      this.x[i] = x0 + dx;
      this.y[i] = y0 + dy;
      return false;
    }

    const bi = hit.bodyIndex;
    let module = -1;
    let nx = 0;
    let ny = 0;
    // The face of the module met, where there was a hull to meet. A body
    // with no design keeps the circle's own normal, which is exact for a
    // circle and is all there ever was before hulls.
    if (hulls !== undefined && hulls.describe(bodies, bi, x0, y0, dx, dy)) {
      module = hulls.module;
      nx = hulls.nx;
      ny = hulls.ny;
    }
    hulls?.reset();
    if (nx === 0 && ny === 0) {
      const ox = hit.x - bodies.x[bi]!;
      const oy = hit.y - bodies.y[bi]!;
      const olen = sqrt(ox * ox + oy * oy);
      // A round starting exactly at the centre has no meaningful normal;
      // oppose its travel, which is the only defensible answer.
      const oinv = olen > 0 ? 1 / olen : 0;
      const seglen = sqrt(dx * dx + dy * dy);
      const sinv = seglen > 0 ? 1 / seglen : 0;
      nx = olen > 0 ? ox * oinv : -dx * sinv;
      ny = olen > 0 ? oy * oinv : -dy * sinv;
    }

    // Stop at the point of contact and wait to be resolved. The round is
    // deliberately left alive: see the note at the top of this file.
    this.x[i] = hit.x;
    this.y[i] = hit.y;
    this.pending[i] = 1;
    this.pendingCount++;
    hits.push(i, bi, t0 + hit.t * span, hit.x, hit.y, nx, ny, module);
    return true;
  }

  /**
   * Muzzle velocity is added to the firing body's own velocity, so a round
   * fired from a ship under way inherits its motion. Returns the index.
   *
   * The lead a turret needs in order to *hit* something is the aiming problem,
   * not this one; this only makes the round leave the barrel correctly.
   */
  fireFrom(
    bodies: Bodies,
    bodyIndex: number,
    muzzleX: number,
    muzzleY: number,
    muzzleVx: number,
    muzzleVy: number,
    width: number,
    ttl: number,
    mass: number,
    damage: number,
    penetration: number,
    kind: number,
    fromModule = -1,
    layers = HULL_LAYER,
    fuse = Infinity,
    spread = 0,
    fragmentLife = 0,
    fragments = 0,
    casing = mass,
  ): number {
    return this.spawnRaw(
      muzzleX,
      muzzleY,
      bodies.vx[bodyIndex] + muzzleVx,
      bodies.vy[bodyIndex] + muzzleVy,
      width,
      ttl,
      mass,
      damage,
      penetration,
      bodyIndex,
      kind,
      fromModule,
      layers,
      fuse,
      spread,
      fragmentLife,
      fragments,
      casing,
    );
  }
}
