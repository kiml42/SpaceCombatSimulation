import type { Bodies } from './bodies.js';
import type { ShipDesign } from './blueprint.js';
import { Terminal, deflected, incidenceAngle, strike } from './ballistics.js';
import { HullPath, modulesAlong, type HullDesigns } from './hull.js';
import { jointBetween, joints } from './connectivity.js';
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

/**
 * How wide a hole a round makes, in calibres.
 *
 * A perforation is not a neat bore: the plate petals and spalls, and what is
 * left is a ragged hole rather larger than the round that made it. It matters
 * here because it is what decides how many rounds through the same seam it
 * takes to cut a weld — at one calibre apiece a gun would have to put thirty
 * shells through the same joint.
 */
const HOLE_CALIBRES = 3;

/**
 * What it takes to cut a square metre of weld with a beam, joules.
 *
 * A beam has no momentum to tear anything with, so this is the whole of how a
 * beam can take a piece off a ship: it boils its way along a seam until there
 * is no seam left. The figure is what decides whether that is a few seconds of
 * held fire or half a minute — a dial, in §12 with the rest.
 */
const BEAM_CUT_ENERGY_PER_AREA = 6.0e7;

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
  /**
   * Metres of weld cut away, by body and joint — what a round took out of a
   * weld by passing through it.
   *
   * Separate from what its modules have absorbed because it is a different
   * injury: damage to the metal at a weld's ends *weakens* it, and a hole
   * punched through the weld itself *removes* it.
   */
  private readonly cut: (Float64Array | null)[] = [];
  private readonly cutVersions: number[] = [];
  /** Joules each module can take before it stops working. */
  private readonly capacity: (Float64Array | null)[] = [];
  private readonly kinds: (ModuleSpec['kind'][] | null)[] = [];
  private readonly versions: number[] = [];

  /**
   * Give a body a damage record, sized from its design.
   *
   * `carried` is what each module has already taken, which is how a hull that
   * has come apart keeps its scars: a severed chunk is a new body with a
   * design of its own, and the modules on it are the same battered modules
   * they were a moment earlier.
   */
  register(
    bodyIndex: number,
    design: ShipDesign,
    carried?: readonly number[],
    welds?: readonly number[],
  ): void {
    const n = design.modules.length;
    const capacity = new Float64Array(n);
    const kinds: ModuleSpec['kind'][] = [];
    for (let i = 0; i < n; i++) {
      const module = design.modules[i]!;
      capacity[i] = module.stats.hitPoints * DAMAGE_ENERGY_PER_KG;
      kinds.push(module.spec.kind);
    }
    const absorbed = new Float64Array(n);
    if (carried !== undefined) {
      for (let i = 0; i < n; i++) absorbed[i] = carried[i] ?? 0;
    }
    this.absorbed[bodyIndex] = absorbed;
    const cut = new Float64Array(joints(design).length);
    if (welds !== undefined) {
      for (let i = 0; i < cut.length; i++) cut[i] = welds[i] ?? 0;
    }
    this.cut[bodyIndex] = cut;
    this.cutVersions[bodyIndex] = (this.cutVersions[bodyIndex] ?? 0) + 1;
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

  /**
   * Take a strip out of a weld: what a round removes by going through it.
   *
   * A weld with nothing left is not a weld, so this is how a gun can cut a
   * piece off a ship rather than merely loosening it — and it is deliberately
   * geometry rather than energy, because what matters is how much of the
   * section is still there.
   */
  cutWeld(bodyIndex: number, joint: number, metres: number): void {
    const cut = this.cut[bodyIndex];
    if (!cut) return;
    if (joint < 0 || joint >= cut.length) return;
    if (!(metres > 0)) return;
    cut[joint] += metres;
    this.cutVersions[bodyIndex] = (this.cutVersions[bodyIndex] ?? 0) + 1;
  }

  /** How much of a weld's section is still there, 1 whole and 0 cut through. */
  weldIntegrity(bodyIndex: number, joint: number, width: number): number {
    const cut = this.cut[bodyIndex];
    if (!cut || !(width > 0)) return 1;
    const gone = cut[joint];
    if (gone === undefined) return 1;
    return max(0, 1 - gone / width);
  }

  /** Metres already cut out of a weld, for carrying scars across a sever. */
  cutAt(bodyIndex: number, joint: number): number {
    return this.cut[bodyIndex]?.[joint] ?? 0;
  }

  /** How many times this body's welds have been cut into. */
  cutVersion(bodyIndex: number): number {
    return this.cutVersions[bodyIndex] ?? 0;
  }

  /** Joules one module has taken, which is what a weld holding it is up against. */
  absorbedAt(bodyIndex: number, module: number): number {
    const absorbed = this.absorbed[bodyIndex];
    if (!absorbed) return 0;
    return absorbed[module] ?? 0;
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
    this.cut[bodyIndex] = null;
    this.absorbed[bodyIndex] = null;
    this.capacity[bodyIndex] = null;
    this.kinds[bodyIndex] = null;
  }
}

/**
 * Something that can be hit hard enough to come apart: a hull, told about a
 * blow it has to answer structurally.
 *
 * Declared here rather than taken as a `Ships` so that spending a hit stays
 * ignorant of what a ship is — this pass knows bodies and modules, and what
 * the hull does about the shock is the hull's business.
 */
export interface Shocked {
  blow(bodyIndex: number, module: number, jx: number, jy: number, px: number, py: number): void;
}

/** Put an impulse through a body at a world-frame point. */
function shove(bodies: Bodies, body: number, jx: number, jy: number, px: number, py: number): void {
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
    // A round that goes on from one module into the next has gone *through*
    // the weld between them, and taken its own width out of it. Enough rounds
    // along the same seam cut the piece free — a gun shearing a wing off at
    // the root rather than knocking it off.
    if (k > 0) {
      const from = path.module[k - 1]!;
      damage.cutWeld(bodyIndex, jointBetween(design, from, module), calibre * HOLE_CALIBRES);
    }
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
    shocks?: Shocked,
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

      // What the round left behind: the momentum it lost is the momentum the
      // ship gained, which is a shove and — where it lands — a blow the hull
      // has to hold together under.
      const jx = mass * (vx - outcome.dirX * outcome.speed);
      const jy = mass * (vy - outcome.dirY * outcome.speed);
      shove(bodies, body, jx, jy, x, y);
      if (shocks !== undefined && this.path.count > 0) {
        shocks.blow(body, this.path.module[0]!, jx, jy, x, y);
      }

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
  beams(
    damage: Damage,
    beams: Beams,
    hits: BeamHits,
    dt: number,
    bodies?: Bodies,
    designs?: HullDesigns,
  ): void {
    for (let i = 0; i < hits.count; i++) {
      const energy = beams.power[hits.beam[i]!]! * dt;
      damage.absorb(hits.body[i]!, hits.module[i]!, energy);
      this.log.push(hits.x[i]!, hits.y[i]!, energy, IMPACT_BEAM, bodies, hits.body[i]!);
      if (bodies !== undefined && designs !== undefined) {
        this.burnSeams(damage, designs, bodies, beams, hits, i, energy);
      }
    }
  }

  /**
   * Burn along every weld the beam is shining through.
   *
   * A beam bores inward: it is stopped only by matter it can still boil away,
   * so everything between where it entered the hull and where it is working
   * now is a tunnel it has already made. Every weld that tunnel crosses is a
   * seam the beam is passing through, and it goes on cutting all of them for
   * as long as the beam is held there — which is what lets a beam cut a ship
   * in half rather than merely hollow it out.
   *
   * This is the whole of how a beam can take a piece off a ship. It carries no
   * momentum, so nothing it does can *tear* anything (`Ships.sever`); what it
   * can do is leave nothing there to tear.
   */
  private burnSeams(
    damage: Damage,
    designs: HullDesigns,
    bodies: Bodies,
    beams: Beams,
    hits: BeamHits,
    i: number,
    energy: number,
  ): void {
    const body = hits.body[i]!;
    const design = designs.designOf(body);
    if (design === null) return;
    const stopped = hits.module[i]!;
    if (stopped < 0) return;

    // The beam's line, in the hull's frame, where its modules live.
    const angle = bodies.angle[body]!;
    const c = cos(angle);
    const s = sin(angle);
    const beam = hits.beam[i]!;
    const sx = beams.startX[beam]! - bodies.x[body]!;
    const sy = beams.startY[beam]! - bodies.y[body]!;
    const ex = hits.x[i]! - bodies.x[body]!;
    const ey = hits.y[i]! - bodies.y[body]!;
    modulesAlong(
      design,
      sx * c + sy * s,
      -sx * s + sy * c,
      ex * c + ey * s,
      -ex * s + ey * c,
      this.path,
    );

    for (let k = 1; k < this.path.count; k++) {
      const from = this.path.module[k - 1]!;
      const into = this.path.module[k]!;
      const joint = jointBetween(design, from, into);
      if (joint >= 0) {
        // The seam's own thickness is what has to be boiled through, and it is
        // the thinner of the two walls meeting there — the same section the
        // weld is rated by.
        const thickness = min(
          design.modules[from]!.stats.wallThickness,
          design.modules[into]!.stats.wallThickness,
        );
        if (thickness > 0) {
          damage.cutWeld(body, joint, energy / (thickness * BEAM_CUT_ENERGY_PER_AREA));
        }
      }
      if (into === stopped) break;
    }
  }
}
