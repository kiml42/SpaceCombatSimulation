import type { ShipDesign } from './blueprint.js';
import { fillOf, type ModuleSpec, type ModuleStats } from './modules.js';

/**
 * What every body has left of one thing its modules hold — fuel or metal — by
 * module, and what spending it has taken off the body's mass.
 *
 * Kept per module rather than per ship because a hull comes apart along its
 * modules: a severed chunk takes its stores with what is in them, and a weld
 * brings both hulls' stores aboard. A design's mass and inertia are its full
 * ones, so a body's are those less what has been spent (`spentMass`,
 * `spentInertia`); its centre of mass stays where the full ship's was.
 *
 * **What draws on a store reaches only those on its own piece of hull**, since
 * a hook between two wrecks carries no line. It crosses between pieces only
 * when pumped (`transfer`). Within a piece, stores are drawn tier by tier,
 * highest priority first, and within a tier in proportion to how much each
 * holds when full, so stores that start full run dry together.
 */
export class Store {
  /** Kilograms in each module now. */
  protected readonly contents: (Float64Array | null)[] = [];
  /** Kilograms in each module when full. */
  protected readonly full: (Float64Array | null)[] = [];
  /** Moment about the centre of mass per kilogram in each module, m². */
  protected readonly spin: (Float64Array | null)[] = [];
  /** Which piece of the hull each module is on. */
  protected readonly pieceOf: (Int32Array | null)[] = [];
  /** Every piece's stores, tier by tier, as module indices. */
  protected readonly stores: (Int32Array[] | null)[] = [];
  /** Where each tier of a piece's `stores` ends, exclusive. */
  protected readonly tierEnds: (Int32Array[] | null)[] = [];
  protected readonly spent: number[] = [];
  protected readonly spentSpin: number[] = [];

  constructor(
    /** What a module holds when full, kg. */
    private readonly capacityOf: (stats: ModuleStats) => number,
    /** Which tier a module is drawn in, highest first. */
    private readonly priorityOf: (spec: ModuleSpec) => number,
  ) {}

  /**
   * Give a body a record, sized from its design. `carried` is what each module
   * already holds, for a body made from another; absent, every store is as
   * full as it is built to start (`ModuleSpec.fill`).
   */
  register(bodyIndex: number, design: ShipDesign, carried?: readonly number[]): void {
    const n = design.modules.length;
    const contents = new Float64Array(n);
    const full = new Float64Array(n);
    const spin = new Float64Array(n);
    const pieceOf = new Int32Array(n);
    let pieces = 1;
    let spent = 0;
    let spentSpin = 0;
    for (let m = 0; m < n; m++) {
      const module = design.modules[m]!;
      const capacity = this.capacityOf(module.stats);
      full[m] = capacity;
      const held = carried === undefined ? capacity * fillOf(module.spec) : (carried[m] ?? 0);
      contents[m] = held < capacity ? held : capacity;
      const { length, width } = module.spec;
      spin[m] = (length * length + width * width) / 12 + module.x * module.x + module.y * module.y;
      spent += capacity - contents[m]!;
      spentSpin += (capacity - contents[m]!) * spin[m]!;
      const piece = design.pieces?.[m] ?? 0;
      pieceOf[m] = piece;
      if (piece + 1 > pieces) pieces = piece + 1;
    }

    const priority = (m: number): number => this.priorityOf(design.modules[m]!.spec);
    const stores: Int32Array[] = [];
    const tierEnds: Int32Array[] = [];
    for (let p = 0; p < pieces; p++) {
      const own: number[] = [];
      for (let m = 0; m < n; m++) if (pieceOf[m] === p && full[m]! > 0) own.push(m);
      own.sort((a, b) => priority(b) - priority(a) || a - b);
      const ends: number[] = [];
      for (let k = 1; k <= own.length; k++) {
        if (k === own.length || priority(own[k]!) !== priority(own[k - 1]!)) ends.push(k);
      }
      stores.push(Int32Array.from(own));
      tierEnds.push(Int32Array.from(ends));
    }

    this.contents[bodyIndex] = contents;
    this.full[bodyIndex] = full;
    this.spin[bodyIndex] = spin;
    this.pieceOf[bodyIndex] = pieceOf;
    this.stores[bodyIndex] = stores;
    this.tierEnds[bodyIndex] = tierEnds;
    this.spent[bodyIndex] = spent;
    this.spentSpin[bodyIndex] = spentSpin;
  }

  /** How full one module is, 0 to 1 of what it holds when full; 0 for one that holds none. */
  fill(bodyIndex: number, module: number): number {
    const full = this.full[bodyIndex]?.[module] ?? 0;
    return full > 0 ? (this.contents[bodyIndex]![module] ?? 0) / full : 0;
  }

  /**
   * Take up to `kg` from the stores module `user` is connected to, and say how
   * much there was.
   */
  drain(bodyIndex: number, user: number, kg: number): number {
    const pieceOf = this.pieceOf[bodyIndex];
    if (pieceOf === null || pieceOf === undefined || !(kg > 0)) return 0;
    return this.take(bodyIndex, pieceOf[user] ?? 0, kg);
  }

  /**
   * Pump up to `kg` from the piece of hull module `from` is on to the piece
   * `to` is on, and say how much went. Drawn as `drain` draws it, and put into
   * the receiver's lowest tier first, so the stores it would draw on last fill
   * first. Only as much as the receiver has room for goes.
   */
  transfer(bodyIndex: number, from: number, to: number, kg: number): number {
    const pieceOf = this.pieceOf[bodyIndex];
    if (pieceOf === null || pieceOf === undefined || !(kg > 0)) return 0;
    const source = pieceOf[from] ?? 0;
    const sink = pieceOf[to] ?? 0;
    if (source === sink) return 0;
    const room = this.room(bodyIndex, sink);
    const taken = this.take(bodyIndex, source, kg < room ? kg : room);
    return taken > 0 ? this.put(bodyIndex, sink, taken) : 0;
  }

  /** Which piece of hull a module is on, or -1 for a body with no record. */
  pieceAt(bodyIndex: number, module: number): number {
    return this.pieceOf[bodyIndex]?.[module] ?? -1;
  }

  /** What is held on the piece of hull a module is on, kg. */
  pieceHeld(bodyIndex: number, module: number): number {
    const pieceOf = this.pieceOf[bodyIndex];
    const stores = pieceOf === null || pieceOf === undefined ? undefined : this.stores[bodyIndex]![pieceOf[module] ?? 0];
    if (stores === undefined) return 0;
    const contents = this.contents[bodyIndex]!;
    let held = 0;
    for (let k = 0; k < stores.length; k++) held += contents[stores[k]!]!;
    return held;
  }

  /** Space left on the piece of hull a module is on, kg. */
  pieceRoom(bodyIndex: number, module: number): number {
    const pieceOf = this.pieceOf[bodyIndex];
    if (pieceOf === null || pieceOf === undefined) return 0;
    return this.room(bodyIndex, pieceOf[module] ?? 0);
  }

  /** What each module can hold now, kg: what it holds when full, unless damage takes some away. */
  protected ceiling(bodyIndex: number): Float64Array {
    return this.full[bodyIndex]!;
  }

  /** Space left in one piece's stores, kg. */
  private room(bodyIndex: number, piece: number): number {
    const stores = this.stores[bodyIndex]![piece];
    if (stores === undefined) return 0;
    const contents = this.contents[bodyIndex]!;
    const full = this.ceiling(bodyIndex);
    let room = 0;
    for (let k = 0; k < stores.length; k++) room += full[stores[k]!]! - contents[stores[k]!]!;
    return room;
  }

  /** Take up to `kg` from one piece's stores, highest tier first, and say how much there was. */
  private take(bodyIndex: number, piece: number, kg: number): number {
    const stores = this.stores[bodyIndex]![piece];
    if (stores === undefined || !(kg > 0)) return 0;
    const contents = this.contents[bodyIndex]!;
    const ends = this.tierEnds[bodyIndex]![piece]!;
    const full = this.full[bodyIndex]!;
    const spin = this.spin[bodyIndex]!;

    let wanted = kg;
    let start = 0;
    for (let tier = 0; tier < ends.length && wanted > 0; tier++) {
      const end = ends[tier]!;
      // In proportion to size, among the stores with anything left. One that
      // empties before its share is met passes the rest to the others, so this
      // repeats at most once per store.
      for (let pass = start; pass < end && wanted > 0; pass++) {
        let size = 0;
        for (let k = start; k < end; k++) {
          const m = stores[k]!;
          if (contents[m]! > 0) size += full[m]!;
        }
        if (!(size > 0)) break;
        let taken = 0;
        for (let k = start; k < end; k++) {
          const m = stores[k]!;
          const held = contents[m]!;
          if (!(held > 0)) continue;
          const share = (wanted * full[m]!) / size;
          const take = share < held ? share : held;
          contents[m] = held - take;
          taken += take;
          this.spentSpin[bodyIndex] = this.spentSpin[bodyIndex]! + take * spin[m]!;
        }
        wanted -= taken;
        // Round-off can leave a sliver no store will part with.
        if (wanted <= kg * 1e-12) wanted = 0;
      }
      start = end;
    }
    const supplied = kg - wanted;
    this.spent[bodyIndex] = this.spent[bodyIndex]! + supplied;
    return supplied;
  }

  /**
   * Put up to `kg` into one piece's stores, lowest tier first, and say how much
   * went in. Within a tier in proportion to size, as `take` draws it.
   */
  private put(bodyIndex: number, piece: number, kg: number): number {
    const stores = this.stores[bodyIndex]![piece];
    if (stores === undefined || !(kg > 0)) return 0;
    const contents = this.contents[bodyIndex]!;
    const ends = this.tierEnds[bodyIndex]![piece]!;
    const full = this.full[bodyIndex]!;
    const ceiling = this.ceiling(bodyIndex);
    const spin = this.spin[bodyIndex]!;

    let wanted = kg;
    for (let tier = ends.length - 1; tier >= 0 && wanted > 0; tier--) {
      const start = tier > 0 ? ends[tier - 1]! : 0;
      const end = ends[tier]!;
      // A store that fills before its share is met passes the rest to the others.
      for (let pass = start; pass < end && wanted > 0; pass++) {
        let size = 0;
        for (let k = start; k < end; k++) {
          const m = stores[k]!;
          if (contents[m]! < ceiling[m]!) size += full[m]!;
        }
        if (!(size > 0)) break;
        let given = 0;
        for (let k = start; k < end; k++) {
          const m = stores[k]!;
          const space = ceiling[m]! - contents[m]!;
          if (!(space > 0)) continue;
          const share = (wanted * full[m]!) / size;
          const give = share < space ? share : space;
          contents[m] = contents[m]! + give;
          given += give;
          this.spentSpin[bodyIndex] = this.spentSpin[bodyIndex]! - give * spin[m]!;
        }
        wanted -= given;
        if (wanted <= kg * 1e-12) wanted = 0;
      }
    }
    const placed = kg - wanted;
    this.spent[bodyIndex] = this.spent[bodyIndex]! - placed;
    return placed;
  }

  /** What has been spent from a body's stores since they were full, kg. */
  spentMass(bodyIndex: number): number {
    return this.spent[bodyIndex] ?? 0;
  }

  /** What that contributed to the body's moment of inertia, kg·m². */
  spentInertia(bodyIndex: number): number {
    return this.spentSpin[bodyIndex] ?? 0;
  }

  /** Kilograms in one module now. */
  held(bodyIndex: number, module: number): number {
    return this.contents[bodyIndex]?.[module] ?? 0;
  }

  /** What each module holds now, for a body made from this one. Null if it has no record. */
  contentsOf(bodyIndex: number): Float64Array | null {
    return this.contents[bodyIndex] ?? null;
  }

  /** What is left across a body, kg. */
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
    this.stores[bodyIndex] = null;
    this.tierEnds[bodyIndex] = null;
    this.spent[bodyIndex] = 0;
    this.spentSpin[bodyIndex] = 0;
  }
}
