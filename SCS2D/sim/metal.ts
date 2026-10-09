import { Store } from './store.js';

/**
 * What every body has left in its holds, and its cores' share of metal.
 *
 * A gun loads each round straight from the holds on its own piece of hull, the
 * whole round at once (`load`), as an engine draws fuel from its tanks.
 */
export class Metal extends Store {
  constructor() {
    super((stats) => stats.metal, () => 0);
  }

  /**
   * Take a round of `kg` for the gun at module `mount`, if its piece of hull
   * has that much, and say whether it did. Never part of a round.
   */
  load(bodyIndex: number, mount: number, kg: number): boolean {
    if (!(kg > 0)) return true;
    if (this.pieceHeld(bodyIndex, mount) < kg) return false;
    this.drain(bodyIndex, mount, kg);
    return true;
  }
}
