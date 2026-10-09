import type { ShipDesign } from './blueprint.js';
import { DamageEffect, type Damage } from './damage.js';
import { Store } from './store.js';

/**
 * What every body's batteries hold, joules, and what its generators make.
 *
 * Charge weighs nothing, so unlike fuel and metal it never moves a body's mass.
 * Like them it reaches only its own piece of hull. A step goes:
 *
 * - `open`: what each piece's generators make this step, and what each battery
 *   may pass, both as damage leaves them. A battery holding more than its
 *   broken cells can loses the rest.
 * - `draw`, for each load: from the generators first, then the batteries.
 * - `close`: whatever the generators made that nothing used goes into the
 *   batteries, as far as their room and their wiring allow. The rest is lost.
 */
export class Charge extends Store {
  /** Each piece's generation not yet used this step, J. */
  private readonly supply: (Float64Array | null)[] = [];
  /** What each battery may still give out this step, J. */
  private readonly outflow: (Float64Array | null)[] = [];
  /** What each battery may still take in this step, J. */
  private readonly inflow: (Float64Array | null)[] = [];
  /** What each battery holds at most as damage leaves it, J. */
  private readonly cap: (Float64Array | null)[] = [];
  /** Each module's rate and generation when sound, W. */
  private readonly rate: (Float64Array | null)[] = [];
  private readonly makes: (Float64Array | null)[] = [];

  constructor() {
    super((stats) => stats.charge, () => 0);
  }

  override register(bodyIndex: number, design: ShipDesign, carried?: readonly number[]): void {
    super.register(bodyIndex, design, carried);
    const n = design.modules.length;
    const rate = new Float64Array(n);
    const makes = new Float64Array(n);
    for (let m = 0; m < n; m++) {
      rate[m] = design.modules[m]!.stats.chargeRate;
      makes[m] = design.modules[m]!.stats.generation;
    }
    this.rate[bodyIndex] = rate;
    this.makes[bodyIndex] = makes;
    this.supply[bodyIndex] = new Float64Array(this.stores[bodyIndex]!.length);
    this.outflow[bodyIndex] = new Float64Array(n);
    this.inflow[bodyIndex] = new Float64Array(n);
    this.cap[bodyIndex] = Float64Array.from(this.full[bodyIndex]!);
  }

  /** Start a step of `dt` seconds for one body. */
  open(bodyIndex: number, dt: number, damage: Damage): void {
    const supply = this.supply[bodyIndex];
    if (supply === null || supply === undefined) return;
    const pieceOf = this.pieceOf[bodyIndex]!;
    const contents = this.contents[bodyIndex]!;
    const full = this.full[bodyIndex]!;
    const rate = this.rate[bodyIndex]!;
    const makes = this.makes[bodyIndex]!;
    const outflow = this.outflow[bodyIndex]!;
    const inflow = this.inflow[bodyIndex]!;
    const cap = this.cap[bodyIndex]!;
    supply.fill(0);
    for (let m = 0; m < makes.length; m++) {
      if (makes[m]! > 0) {
        supply[pieceOf[m]!] = supply[pieceOf[m]!]! + makes[m]! * damage.remaining(bodyIndex, m, DamageEffect.Generation) * dt;
      }
      if (!(full[m]! > 0)) continue;
      cap[m] = full[m]! * damage.remaining(bodyIndex, m, DamageEffect.Storage);
      if (contents[m]! > cap[m]!) contents[m] = cap[m]!;
      const pass = rate[m]! * damage.remaining(bodyIndex, m, DamageEffect.Discharge) * dt;
      outflow[m] = pass;
      inflow[m] = pass;
    }
  }

  /**
   * Take up to `joules` for a load at module `user`, from its piece's
   * generators and then its batteries, and say how much there was.
   */
  draw(bodyIndex: number, user: number, joules: number): number {
    const supply = this.supply[bodyIndex];
    if (supply === null || supply === undefined || !(joules > 0)) return 0;
    const piece = this.pieceOf[bodyIndex]![user]!;
    const made = supply[piece]!;
    const direct = made < joules ? made : joules;
    supply[piece] = made - direct;
    const wanted = joules - direct;
    if (!(wanted > 0)) return direct;

    // The rest from the batteries, each in proportion to what it can give.
    const stores = this.stores[bodyIndex]![piece];
    if (stores === undefined) return direct;
    const contents = this.contents[bodyIndex]!;
    const outflow = this.outflow[bodyIndex]!;
    let available = 0;
    for (let k = 0; k < stores.length; k++) {
      const m = stores[k]!;
      available += contents[m]! < outflow[m]! ? contents[m]! : outflow[m]!;
    }
    if (!(available > 0)) return direct;
    const share = wanted < available ? wanted / available : 1;
    let taken = 0;
    for (let k = 0; k < stores.length; k++) {
      const m = stores[k]!;
      const take = (contents[m]! < outflow[m]! ? contents[m]! : outflow[m]!) * share;
      contents[m] = contents[m]! - take;
      outflow[m] = outflow[m]! - take;
      taken += take;
    }
    return direct + taken;
  }

  /** End a step for one body: bank what its generators made and nothing used. */
  close(bodyIndex: number): void {
    const supply = this.supply[bodyIndex];
    if (supply === null || supply === undefined) return;
    const contents = this.contents[bodyIndex]!;
    const inflow = this.inflow[bodyIndex]!;
    const cap = this.cap[bodyIndex]!;
    for (let piece = 0; piece < supply.length; piece++) {
      const spare = supply[piece]!;
      if (!(spare > 0)) continue;
      const stores = this.stores[bodyIndex]![piece]!;
      let room = 0;
      for (let k = 0; k < stores.length; k++) {
        const m = stores[k]!;
        const space = cap[m]! - contents[m]!;
        room += space < inflow[m]! ? (space > 0 ? space : 0) : inflow[m]!;
      }
      if (!(room > 0)) continue;
      const share = spare < room ? spare / room : 1;
      for (let k = 0; k < stores.length; k++) {
        const m = stores[k]!;
        const space = cap[m]! - contents[m]!;
        const give = (space < inflow[m]! ? (space > 0 ? space : 0) : inflow[m]!) * share;
        contents[m] = contents[m]! + give;
        inflow[m] = inflow[m]! - give;
      }
      supply[piece] = 0;
    }
  }

  override forget(bodyIndex: number): void {
    super.forget(bodyIndex);
    this.supply[bodyIndex] = null;
    this.outflow[bodyIndex] = null;
    this.inflow[bodyIndex] = null;
    this.cap[bodyIndex] = null;
    this.rate[bodyIndex] = null;
    this.makes[bodyIndex] = null;
  }
}
