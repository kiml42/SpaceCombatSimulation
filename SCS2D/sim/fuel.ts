import type { ShipDesign } from './blueprint.js';
import { sqrt } from './math.js';
import { FUEL_DENSITY } from './modules.js';
import { Store } from './store.js';

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
  /** How wide it is open now, metres. */
  width: number;
  /** The narrowest the module's sealing lining can close it to, metres: zero if it can seal it. */
  floor: number;
  /** How fast the lining is closing it, metres a second; zero with no lining. */
  closing: number;
  /** Fuel through it last step, kg/s. What a renderer draws the plume from. */
  rate: number;
}

/**
 * What every body has left in its tanks, and the holes it is leaking from.
 *
 * **An engine draws on the tanks it is connected to** (`drain`), tier by tier,
 * highest `drainPriority` first.
 */
export class Fuel extends Store {
  private readonly leaks: (Leak[] | null)[] = [];

  constructor() {
    super((stats) => stats.fuel, (spec) => spec.drainPriority ?? 0);
  }

  override register(bodyIndex: number, design: ShipDesign, carried?: readonly number[], leaks?: readonly Leak[]): void {
    super.register(bodyIndex, design, carried);
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
    this.spent[bodyIndex] = this.spent[bodyIndex]! + take;
    this.spentSpin[bodyIndex] = this.spentSpin[bodyIndex]! + take * this.spin[bodyIndex]![module]!;
    return take;
  }

  override forget(bodyIndex: number): void {
    super.forget(bodyIndex);
    this.leaks[bodyIndex] = null;
  }
}

const NO_LEAKS: readonly Leak[] = [];
