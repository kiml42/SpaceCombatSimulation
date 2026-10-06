import type { ShipDesign } from './blueprint.js';
import { sqrt } from './math.js';
import { FUEL_DENSITY, type ModuleSpec } from './modules.js';

/**
 * Pressure in a full tank, pascals: five atmospheres, about what keeps a
 * rocket's propellant feeding its pumps. It falls with how full the tank is,
 * so a hole in a nearly empty tank dribbles.
 */
export const TANK_PRESSURE = 5e5;

/** Discharge coefficient of a ragged hole: how much of its area the jet actually uses. */
export const LEAK_DISCHARGE = 0.6;

/**
 * Chance a round through a sound tank's wall holes it, rather than the plate
 * closing round it. Rises to certain as the tank's integrity falls to nothing.
 */
export const LEAK_CHANCE = 0.2;

/** Width of the hole a round leaves, in its calibres. */
export const LEAK_HOLE_CALIBRES = 1;

/** Fuel out of a hole of `area` in a tank `fill` full, kg/s: orifice flow, `Cd A √(2ρP)`. */
export function leakRate(area: number, fill: number): number {
  if (!(fill > 0)) return 0;
  return LEAK_DISCHARGE * area * sqrt(2 * FUEL_DENSITY * TANK_PRESSURE * fill);
}

/** How fast it leaves, m/s: what the pressure behind it gives it, `√(2P/ρ)`. */
export function leakSpeed(fill: number): number {
  if (!(fill > 0)) return 0;
  return sqrt((2 * TANK_PRESSURE * fill) / FUEL_DENSITY);
}

/** The chance a round through the wall of a tank this whole holes it. */
export function leakChance(integrity: number): number {
  const worn = integrity < 0 ? 1 : integrity > 1 ? 0 : 1 - integrity;
  return LEAK_CHANCE + (1 - LEAK_CHANCE) * worn;
}

/**
 * A hole in something holding fuel, open to space. Kept in the holed module's
 * own frame, so it goes with the module through a sever or a weld whatever
 * the design around it becomes.
 */
export interface Leak {
  module: number;
  /** Where the hole is, from the module's centre along and across its facing, metres. */
  x: number;
  y: number;
  /** Outward normal of the face it is in, in the same frame: the way the fuel leaves. */
  nx: number;
  ny: number;
  /** Area open to space, m². */
  area: number;
  /** Fuel through it last step, kg/s. What a renderer draws the plume from. */
  rate: number;
}

/**
 * What every body has left in its tanks, by module, and what burning it has
 * taken off the body's mass.
 *
 * Fuel is kept per module rather than per ship because a hull comes apart
 * along its modules: a severed chunk takes its tanks with what is in them, and
 * a weld brings both hulls' tanks aboard. A design's mass and inertia are its
 * full ones, so a body's are those less what has burnt (`burntMass`,
 * `burntInertia`); its centre of mass stays where the full ship's was.
 *
 * **An engine draws on the tanks it is connected to**: those on its own piece
 * of hull, since a hook between two wrecks carries no fuel line. Within that,
 * tanks are drained tier by tier (`drainPriority`), and within a tier in
 * proportion to how much each holds when full, so tanks that start full run
 * dry together.
 */
export class Fuel {
  /** Kilograms in each module now. */
  private readonly contents: (Float64Array | null)[] = [];
  /** Kilograms in each module when full. */
  private readonly full: (Float64Array | null)[] = [];
  /** Moment about the centre of mass per kilogram of fuel in each module, m². */
  private readonly spin: (Float64Array | null)[] = [];
  /** Which piece of the hull each module is on. */
  private readonly pieceOf: (Int32Array | null)[] = [];
  /** Every piece's tanks, tier by tier, as module indices. */
  private readonly tanks: (Int32Array[] | null)[] = [];
  /** Where each tier of a piece's `tanks` ends, exclusive. */
  private readonly tierEnds: (Int32Array[] | null)[] = [];
  private readonly burnt: number[] = [];
  private readonly burntSpin: number[] = [];
  private readonly leaks: (Leak[] | null)[] = [];

  /**
   * Give a body a fuel record, sized from its design. `carried` is what each
   * module already holds, for a body made from another; absent, every tank is
   * full.
   */
  register(bodyIndex: number, design: ShipDesign, carried?: readonly number[], leaks?: readonly Leak[]): void {
    const n = design.modules.length;
    const contents = new Float64Array(n);
    const full = new Float64Array(n);
    const spin = new Float64Array(n);
    const pieceOf = new Int32Array(n);
    let pieces = 1;
    let burnt = 0;
    let burntSpin = 0;
    for (let m = 0; m < n; m++) {
      const module = design.modules[m]!;
      const capacity = module.stats.fuel;
      full[m] = capacity;
      const held = carried === undefined ? capacity : (carried[m] ?? 0);
      contents[m] = held < capacity ? held : capacity;
      const { length, width } = module.spec;
      spin[m] = (length * length + width * width) / 12 + module.x * module.x + module.y * module.y;
      burnt += capacity - contents[m]!;
      burntSpin += (capacity - contents[m]!) * spin[m]!;
      const piece = design.pieces?.[m] ?? 0;
      pieceOf[m] = piece;
      if (piece + 1 > pieces) pieces = piece + 1;
    }

    const tanks: Int32Array[] = [];
    const tierEnds: Int32Array[] = [];
    for (let p = 0; p < pieces; p++) {
      const own: number[] = [];
      for (let m = 0; m < n; m++) if (pieceOf[m] === p && full[m]! > 0) own.push(m);
      own.sort((a, b) => drainPriority(design.modules[a]!.spec) - drainPriority(design.modules[b]!.spec) || a - b);
      const ends: number[] = [];
      for (let k = 1; k <= own.length; k++) {
        const last = k === own.length;
        if (last || drainPriority(design.modules[own[k]!]!.spec) !== drainPriority(design.modules[own[k - 1]!]!.spec)) {
          ends.push(k);
        }
      }
      tanks.push(Int32Array.from(own));
      tierEnds.push(Int32Array.from(ends));
    }

    this.contents[bodyIndex] = contents;
    this.full[bodyIndex] = full;
    this.spin[bodyIndex] = spin;
    this.pieceOf[bodyIndex] = pieceOf;
    this.tanks[bodyIndex] = tanks;
    this.tierEnds[bodyIndex] = tierEnds;
    this.burnt[bodyIndex] = burnt;
    this.burntSpin[bodyIndex] = burntSpin;
    this.leaks[bodyIndex] = leaks === undefined ? [] : leaks.map((leak) => ({ ...leak }));
  }

  /** Open a hole in a module. */
  hole(bodyIndex: number, leak: Leak): void {
    this.leaks[bodyIndex]?.push(leak);
  }

  /** Every hole in a body. */
  leaksOf(bodyIndex: number): readonly Leak[] {
    return this.leaks[bodyIndex] ?? NO_LEAKS;
  }

  /** Let up to `kg` out of one module through a hole, and say how much there was. */
  vent(bodyIndex: number, module: number, kg: number): number {
    const contents = this.contents[bodyIndex];
    if (contents === null || contents === undefined || !(kg > 0)) return 0;
    const held = contents[module] ?? 0;
    const take = kg < held ? kg : held;
    if (!(take > 0)) return 0;
    contents[module] = held - take;
    this.burnt[bodyIndex] = this.burnt[bodyIndex]! + take;
    this.burntSpin[bodyIndex] = this.burntSpin[bodyIndex]! + take * this.spin[bodyIndex]![module]!;
    return take;
  }

  /** How full one module is, 0 to 1 of what it holds when full; 0 for one that holds none. */
  fill(bodyIndex: number, module: number): number {
    const full = this.full[bodyIndex]?.[module] ?? 0;
    return full > 0 ? (this.contents[bodyIndex]![module] ?? 0) / full : 0;
  }

  /**
   * Take up to `kg` from the tanks an engine is connected to, and say how much
   * there was. `engine` is the engine's module index.
   */
  drain(bodyIndex: number, engine: number, kg: number): number {
    const contents = this.contents[bodyIndex];
    if (contents === null || contents === undefined || !(kg > 0)) return 0;
    const piece = this.pieceOf[bodyIndex]![engine] ?? 0;
    const tanks = this.tanks[bodyIndex]![piece];
    if (tanks === undefined) return 0;
    const ends = this.tierEnds[bodyIndex]![piece]!;
    const full = this.full[bodyIndex]!;
    const spin = this.spin[bodyIndex]!;

    let wanted = kg;
    let start = 0;
    for (let tier = 0; tier < ends.length && wanted > 0; tier++) {
      const end = ends[tier]!;
      // In proportion to size, among the tanks with anything left. A tank that
      // empties before its share is met passes the rest to the others, so this
      // repeats at most once per tank.
      for (let pass = start; pass < end && wanted > 0; pass++) {
        let size = 0;
        for (let k = start; k < end; k++) {
          const m = tanks[k]!;
          if (contents[m]! > 0) size += full[m]!;
        }
        if (!(size > 0)) break;
        let taken = 0;
        for (let k = start; k < end; k++) {
          const m = tanks[k]!;
          const held = contents[m]!;
          if (!(held > 0)) continue;
          const share = (wanted * full[m]!) / size;
          const take = share < held ? share : held;
          contents[m] = held - take;
          taken += take;
          this.burntSpin[bodyIndex] = this.burntSpin[bodyIndex]! + take * spin[m]!;
        }
        wanted -= taken;
        // Round-off can leave a sliver no tank will part with.
        if (wanted <= kg * 1e-12) wanted = 0;
      }
      start = end;
    }
    const supplied = kg - wanted;
    this.burnt[bodyIndex] = this.burnt[bodyIndex]! + supplied;
    return supplied;
  }

  /** Fuel burnt from a body's tanks since they were full, kg. */
  burntMass(bodyIndex: number): number {
    return this.burnt[bodyIndex] ?? 0;
  }

  /** What that fuel contributed to the body's moment of inertia, kg·m². */
  burntInertia(bodyIndex: number): number {
    return this.burntSpin[bodyIndex] ?? 0;
  }

  /** Kilograms in one module now. */
  held(bodyIndex: number, module: number): number {
    return this.contents[bodyIndex]?.[module] ?? 0;
  }

  /** What each module holds now, for a body made from this one. Null if it has no record. */
  contentsOf(bodyIndex: number): Float64Array | null {
    return this.contents[bodyIndex] ?? null;
  }

  /** Fuel left across a body, kg. */
  left(bodyIndex: number): number {
    const contents = this.contents[bodyIndex];
    if (contents === null || contents === undefined) return 0;
    let total = 0;
    for (let m = 0; m < contents.length; m++) total += contents[m]!;
    return total;
  }

  forget(bodyIndex: number): void {
    this.contents[bodyIndex] = null;
    this.full[bodyIndex] = null;
    this.spin[bodyIndex] = null;
    this.pieceOf[bodyIndex] = null;
    this.tanks[bodyIndex] = null;
    this.tierEnds[bodyIndex] = null;
    this.burnt[bodyIndex] = 0;
    this.burntSpin[bodyIndex] = 0;
    this.leaks[bodyIndex] = null;
  }
}

const NO_LEAKS: readonly Leak[] = [];

/**
 * Which tier a tank is drained in, lowest first. Every tank is in the same one
 * until a layout can say otherwise, which is where a drain priority goes.
 */
function drainPriority(_spec: ModuleSpec): number {
  return 0;
}
