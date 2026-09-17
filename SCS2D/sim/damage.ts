import type { Bodies } from './bodies.js';
import type { ShipDesign } from './blueprint.js';
import { Terminal, deflected, incidenceAngle, strike } from './ballistics.js';
import { HullPath, modulesAlong, type HullDesigns } from './hull.js';
import type { ProjectileHits, Projectiles } from './projectiles.js';
import type { BeamHits, Beams } from './beams.js';
import { cos, max, min, sin, sqrt } from './math.js';
import type { ModuleSpec } from './modules.js';

/**
 * What a hit does to the ship it landed on.
 *
 * Terminal ballistics decides what happens at each plate; this decides what
 * the ship makes of it. A round walks the modules along its path, each one
 * taking the energy its armour stopped, until the round embeds, skids off, or
 * comes out the far side. A beam pours its power into what it is burning
 * through.
 *
 * **Matter is conserved** (DESIGN.md §4). A module that has taken all it can
 * stops *working*, not existing: it keeps its mass, its place in the layout
 * and its ability to stop a shell, so wrecked structure is free armour and a
 * mission-killed ship is a drifting hulk rather than an easier target.
 */

/**
 * How much energy a module absorbs, per kilogram of its structure, before it
 * stops working — the energy of its own mass at about 45 m/s.
 *
 * The one number here that is a balance decision rather than a derivation, in
 * the same sense as `DE_MARRE_K`: the law decides how much energy gets *in*,
 * and this decides how much a module can take. ROADMAP.md §12 keeps it open.
 */
export const DAMAGE_ENERGY_PER_KG = 1000;

/** What damage takes away from a module, beyond eventually stopping it. */
export enum DamageEffect {
  /** A thruster's push. */
  Thrust = 0,
  /** How often a gun can fire. */
  FireRate = 1,
}

/**
 * One thing damage does to a module.
 *
 * A module declares the list of these it is subject to, and each says how much
 * of that capability survives at a given integrity. Keeping them as a list
 * rather than as branches in the damage code is what lets a module grow more
 * failure modes — a jammed traverse, a broken barrel, widening dispersion —
 * without the code that applies damage learning about any of them.
 */
export interface DamageResponse {
  readonly effect: DamageEffect;
  /** What fraction of the capability is left, given integrity 0 to 1. */
  readonly remaining: (integrity: number) => number;
}

/**
 * A capability that fails outright somewhat before its module is spent.
 *
 * An engine does not dwindle smoothly to nothing: its plumbing gives out while
 * there is still a good deal of engine left, and what remains is mass that
 * still stops shells. So the response fades to zero at `cutout` rather than at
 * zero integrity, and the module goes on absorbing damage below that.
 */
function fadesOutAt(cutout: number): (integrity: number) => number {
  return (integrity) => (integrity <= cutout ? 0 : (integrity - cutout) / (1 - cutout));
}

/** Integrity at which an engine quits, with a third of itself left. */
const THRUST_CUTOUT = 0.3;
/** Guns keep working longer: a gun is simpler than a rocket engine. */
const FIRE_RATE_CUTOUT = 0.15;

export const DAMAGE_RESPONSES: Readonly<Record<ModuleSpec['kind'], readonly DamageResponse[]>> = {
  structure: [],
  thruster: [{ effect: DamageEffect.Thrust, remaining: fadesOutAt(THRUST_CUTOUT) }],
  turret: [{ effect: DamageEffect.FireRate, remaining: fadesOutAt(FIRE_RATE_CUTOUT) }],
  beamTurret: [{ effect: DamageEffect.FireRate, remaining: fadesOutAt(FIRE_RATE_CUTOUT) }],
};

/**
 * What every ship in the world has taken, by body index and module.
 *
 * Keyed by body rather than by ship because that is what a hit knows, and it
 * is what lets a wreck go on taking damage after its ship has been removed.
 *
 * `version` counts the edits to a body's damage, so that anything derived from
 * it — a thruster layout, most of all — can be rebuilt when it changes and
 * left alone when it has not, without a callback or a dirty flag per consumer.
 */
export class Damage {
  private readonly absorbed: (Float64Array | null)[] = [];
  /** Joules each module can take before it stops working. */
  private readonly capacity: (Float64Array | null)[] = [];
  private readonly kinds: (ModuleSpec['kind'][] | null)[] = [];
  private readonly versions: number[] = [];

  /** Give a body a damage record, sized from its design. */
  register(bodyIndex: number, design: ShipDesign): void {
    const n = design.modules.length;
    const capacity = new Float64Array(n);
    const kinds: ModuleSpec['kind'][] = [];
    for (let i = 0; i < n; i++) {
      const module = design.modules[i]!;
      capacity[i] = module.stats.hitPoints * DAMAGE_ENERGY_PER_KG;
      kinds.push(module.spec.kind);
    }
    this.absorbed[bodyIndex] = new Float64Array(n);
    this.capacity[bodyIndex] = capacity;
    this.kinds[bodyIndex] = kinds;
    this.versions[bodyIndex] = (this.versions[bodyIndex] ?? 0) + 1;
  }

  /** Put energy into a module. Energy past what it can take is simply gone. */
  absorb(bodyIndex: number, module: number, joules: number): void {
    const absorbed = this.absorbed[bodyIndex];
    if (absorbed === null || absorbed === undefined) return;
    if (module < 0 || module >= absorbed.length) return;
    if (!(joules > 0)) return;
    absorbed[module] += joules;
    this.versions[bodyIndex] = (this.versions[bodyIndex] ?? 0) + 1;
  }

  /** How much of a module is left, 1 untouched and 0 spent. */
  integrity(bodyIndex: number, module: number): number {
    const absorbed = this.absorbed[bodyIndex];
    const capacity = this.capacity[bodyIndex];
    if (!absorbed || !capacity) return 1;
    const limit = capacity[module];
    if (limit === undefined || !(limit > 0)) return 1;
    return max(0, 1 - absorbed[module]! / limit);
  }

  /** Whether a module has taken everything it can. */
  spent(bodyIndex: number, module: number): boolean {
    return this.integrity(bodyIndex, module) <= 0;
  }

  /**
   * How much of one capability a module still has, from its own responses.
   *
   * A module with no response for an effect keeps all of it: structure has
   * nothing to lose this way, and neither has a kind that has not been given a
   * failure mode yet.
   */
  remaining(bodyIndex: number, module: number, effect: DamageEffect): number {
    const kinds = this.kinds[bodyIndex];
    if (!kinds) return 1;
    const kind = kinds[module];
    if (kind === undefined) return 1;
    const integrity = this.integrity(bodyIndex, module);
    let left = 1;
    for (const response of DAMAGE_RESPONSES[kind]) {
      if (response.effect === effect) left = min(left, response.remaining(integrity));
    }
    return left;
  }

  /** How many times this body's damage has changed. */
  version(bodyIndex: number): number {
    return this.versions[bodyIndex] ?? 0;
  }

  /** What a body's modules have absorbed, for a checksum. Null if it has none. */
  absorbedOf(bodyIndex: number): Float64Array | null {
    return this.absorbed[bodyIndex] ?? null;
  }

  /** How many bodies have ever had a record, so a checksum knows where to stop. */
  get highWater(): number {
    return this.absorbed.length;
  }

  /** Whether a body has a damage record at all. */
  knows(bodyIndex: number): boolean {
    return this.absorbed[bodyIndex] !== undefined && this.absorbed[bodyIndex] !== null;
  }

  forget(bodyIndex: number): void {
    this.absorbed[bodyIndex] = null;
    this.capacity[bodyIndex] = null;
    this.kinds[bodyIndex] = null;
  }
}

/** Where a round ended up, and what it left with. */
export interface RoundOutcome {
  /** What the last plate it met did to it. */
  outcome: Terminal;
  /** Distance from the impact point at which it stopped, metres. */
  distance: number;
  /** Speed it carries on at: zero when it embeds, its residual otherwise. */
  speed: number;
  /** Where it is going now — the same direction unless it skidded. */
  dirX: number;
  dirY: number;
  /** Distance from the impact at which it left the last module it crossed. */
  exit: number;
  /** Total energy the ship absorbed, which is what the impact was worth. */
  energy: number;
  /** How many modules it went through, the one it stopped in included. */
  crossed: number;
}

/**
 * Walk a round through the ship it just hit, spending it plate by plate.
 *
 * The round arrives at `(x, y)` travelling along `(dirX, dirY)`, both in world
 * coordinates, having been stopped at the face of the first module it met. The
 * cast is taken from well outside the ship rather than from the impact point
 * itself: a segment beginning exactly on a face is *inside* the module by no
 * distance at all, which would report it entered by no face and so met it
 * square on, when the whole question is how oblique the meeting was.
 *
 * Each module takes the energy its armour stopped, which for a perforation is
 * the energy of a round arriving at the limit velocity and for an embedding is
 * everything the round had left. **Overpenetration is therefore cheap**: a
 * heavy round through a light hull leaves most of its energy on the far side,
 * which is the honest answer and the reason a shell has a fuse.
 */
export function resolveRound(
  design: ShipDesign,
  damage: Damage,
  bodies: Bodies,
  bodyIndex: number,
  path: HullPath,
  x: number,
  y: number,
  dirX: number,
  dirY: number,
  mass: number,
  calibre: number,
  speed: number,
): RoundOutcome {
  const result: RoundOutcome = {
    outcome: Terminal.Perforate,
    distance: 0,
    exit: 0,
    speed,
    dirX,
    dirY,
    energy: 0,
    crossed: 0,
  };

  const angle = bodies.angle[bodyIndex]!;
  const c = cos(angle);
  const s = sin(angle);
  const rx = x - bodies.x[bodyIndex]!;
  const ry = y - bodies.y[bodyIndex]!;
  // The impact and the heading in the ship's frame, where its modules live.
  const px = rx * c + ry * s;
  const py = -rx * s + ry * c;
  const ux = dirX * c + dirY * s;
  const uy = -dirX * s + dirY * c;

  // From outside the ship, through it, and out the other side.
  const reach = design.radius * 2 + 1;
  modulesAlong(design, px - ux * reach, py - uy * reach, px + ux * reach, py + uy * reach, path);

  let carried = speed;
  for (let k = 0; k < path.count; k++) {
    const module = path.module[k]!;
    const crossing = design.modules[module]!;
    const nx = path.nx[k]!;
    const ny = path.ny[k]!;
    // A crossing with no face was entered from inside, which for a round
    // arriving from outside means the two faces coincide; square on is the
    // only answer the geometry supports.
    const incidence = nx === 0 && ny === 0 ? 0 : incidenceAngle(ux, uy, nx, ny);
    const hit = strike(mass, calibre, carried, crossing.stats.wallThickness, incidence);

    damage.absorb(bodyIndex, module, hit.energy);
    result.energy += hit.energy;
    result.crossed++;
    result.outcome = hit.outcome;
    // Distances are measured from the impact, which is where the cast crossed
    // the first module rather than where it began.
    const from = path.entry[0] ?? 0;
    result.distance = max(0, path.entry[k]! - from);
    result.exit = max(0, path.exit[k]! - from);

    if (hit.outcome === Terminal.Embed) {
      result.speed = 0;
      return result;
    }
    if (hit.outcome === Terminal.Deflect) {
      const away = deflected(ux, uy, nx, ny);
      // Back into the world frame, where the round is flying.
      result.dirX = away.x * c - away.y * s;
      result.dirY = away.x * s + away.y * c;
      result.speed = hit.residualSpeed;
      return result;
    }
    carried = hit.residualSpeed;
  }

  // Out the far side, or into a ship it crossed no module of.
  result.speed = carried;
  return result;
}

/**
 * One impact worth drawing: where it was, how hard, and what it happened *on*.
 *
 * The position is recorded twice, in the world and in the struck ship's own
 * frame, because a flash belongs to the hull it went off against: a ship doing
 * two hundred metres a second would otherwise leave its own hits behind. The
 * world position is what a flash falls back to when the ship it was on is no
 * longer there to carry it.
 */
export class ImpactLog {
  x = new Float64Array(64);
  y = new Float64Array(64);
  /** Body struck, or -1 for a hit on nothing in particular. */
  body = new Int32Array(64);
  /** The same point in that body's frame, so the flash rides it. */
  localX = new Float64Array(64);
  localY = new Float64Array(64);
  /** Energy the ship absorbed, joules. What decides how bright it reads. */
  energy = new Float64Array(64);
  /** 0 for a round, 1 for a beam. */
  kind = new Uint8Array(64);
  count = 0;

  push(
    x: number,
    y: number,
    energy: number,
    kind: number,
    bodies?: Bodies,
    body = -1,
  ): void {
    if (this.count === this.x.length) this.grow();
    const i = this.count++;
    this.x[i] = x;
    this.y[i] = y;
    this.energy[i] = energy;
    this.kind[i] = kind;
    this.body[i] = body;
    this.localX[i] = 0;
    this.localY[i] = 0;
    if (bodies === undefined || body < 0) return;
    const angle = bodies.angle[body]!;
    const c = cos(angle);
    const sn = sin(angle);
    const dx = x - bodies.x[body]!;
    const dy = y - bodies.y[body]!;
    this.localX[i] = dx * c + dy * sn;
    this.localY[i] = -dx * sn + dy * c;
  }

  clear(): void {
    this.count = 0;
  }

  private grow(): void {
    const size = this.x.length * 2;
    const x = new Float64Array(size);
    const y = new Float64Array(size);
    const energy = new Float64Array(size);
    const kind = new Uint8Array(size);
    x.set(this.x);
    y.set(this.y);
    energy.set(this.energy);
    kind.set(this.kind);
    const body = new Int32Array(size);
    const localX = new Float64Array(size);
    const localY = new Float64Array(size);
    body.set(this.body);
    localX.set(this.localX);
    localY.set(this.localY);
    this.x = x;
    this.y = y;
    this.energy = energy;
    this.kind = kind;
    this.body = body;
    this.localX = localX;
    this.localY = localY;
  }
}

/** Kinds of impact, as the log records them. */
export const IMPACT_ROUND = 0;
export const IMPACT_BEAM = 1;

/**
 * Resolving a step's impacts: what each hit does, and a log of them to draw.
 *
 * Holds the scratch both halves need, so that resolving a fleet action's worth
 * of hits allocates nothing. Kept apart from `Ships` so that the damage model
 * can be driven — and tested — without one.
 */
export class Impacts {
  private readonly path = new HullPath();
  /** Impacts since the last time something drained this. Presentation only. */
  readonly log = new ImpactLog();

  /**
   * Spend every round that hit something this step.
   *
   * A round is killed where it stops and resumed where it does not: through
   * the far side it carries on at what is left of its speed, and off a plate
   * it carries on along the direction the skid gave it.
   */
  rounds(
    designs: HullDesigns,
    damage: Damage,
    bodies: Bodies,
    projectiles: Projectiles,
    hits: ProjectileHits,
  ): void {
    for (let i = 0; i < hits.count; i++) {
      const round = hits.projectile[i]!;
      const body = hits.body[i]!;
      const x = hits.x[i]!;
      const y = hits.y[i]!;
      const design = designs.designOf(body);

      const vx = projectiles.vx[round]!;
      const vy = projectiles.vy[round]!;
      const speed = sqrt(vx * vx + vy * vy);
      // A round with no design to walk, or no speed left to walk it with, is
      // absorbed where it stopped: there is nothing else to spend it on.
      if (design === null || !(speed > 0)) {
        this.log.push(x, y, 0.5 * projectiles.mass[round]! * speed * speed, IMPACT_ROUND, bodies, body);
        projectiles.kill(round);
        continue;
      }

      const mass = projectiles.mass[round]!;
      const outcome = resolveRound(
        design,
        damage,
        bodies,
        body,
        this.path,
        x,
        y,
        vx / speed,
        vy / speed,
        mass,
        projectiles.width[round]!,
        speed,
      );
      this.log.push(x, y, outcome.energy, IMPACT_ROUND, bodies, body);

      if (outcome.speed <= 0) {
        projectiles.kill(round);
        continue;
      }
      // Back into flight from where it got to, which is the far side of the
      // last module it crossed or the face it skidded off.
      const travelled = outcome.outcome === Terminal.Deflect ? outcome.distance : outcome.exit;
      projectiles.x[round] = x + (vx / speed) * travelled;
      projectiles.y[round] = y + (vy / speed) * travelled;
      projectiles.vx[round] = outcome.dirX * outcome.speed;
      projectiles.vy[round] = outcome.dirY * outcome.speed;
      projectiles.resume(round);
    }
  }

  /**
   * Pour every beam's power into what it is burning through.
   *
   * A beam is not a round: there is no perforation law for it, and no residual
   * to carry deeper. It deposits `power · dt` into the module it reached —
   * which, because a spent module no longer stops a beam, walks inward through
   * a hull as it destroys it.
   */
  beams(damage: Damage, beams: Beams, hits: BeamHits, dt: number, bodies?: Bodies): void {
    for (let i = 0; i < hits.count; i++) {
      const energy = beams.power[hits.beam[i]!]! * dt;
      damage.absorb(hits.body[i]!, hits.module[i]!, energy);
      this.log.push(hits.x[i]!, hits.y[i]!, energy, IMPACT_BEAM, bodies, hits.body[i]!);
    }
  }
}
