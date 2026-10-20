import { compileBlueprint, refitShare, type Blueprint, type ShipDesign, type ShipView } from '../sim/index.js';
import { Library } from '../editor/library.js';

/** The designs a battle can remodel a ship to, or have a pad or slipway build: the blueprint library. */

/** A design that can be chosen to remodel to or to build: the blueprint, compiled, and where it is from. */
export interface Choice {
  readonly blueprint: Blueprint;
  readonly design: ShipDesign;
  readonly label: string;
}

/** The blueprint library, stock and saved, each compiled once; one that does not compile is left out. */
export function choices(): Choice[] {
  const library = new Library(window.localStorage);
  const out: Choice[] = [];
  for (const entry of library.list()) {
    try {
      const blueprint = entry.stock ? library.loadStock(entry.name) : library.load(entry.name);
      if (blueprint === null) continue;
      const cacheKey = `${entry.stock ? 'stock' : 'saved'}:${entry.name}`;
      let design = compiledChoices.get(cacheKey);
      if (design === undefined || design.blueprint !== blueprint) {
        design = { blueprint, design: compileBlueprint(blueprint) };
        compiledChoices.set(cacheKey, design);
      }
      out.push({ ...design, label: entry.stock && entry.saved ? `${entry.name} (stock)` : entry.name });
    } catch {
      // A saved ship that no longer reads or flies is for the editor to put right.
    }
  }
  return out;
}
const compiledChoices = new Map<string, { blueprint: Blueprint; design: ShipDesign }>();

/** A remodel on offer: a design every one of `ships` could be refitted to, and how much of them it keeps. */
export interface Remodel {
  readonly choice: Choice;
  readonly kept: number;
  readonly of: number;
  /** Whether it has a robot bay: without one, nothing would build the rest, and the refit is never finished. */
  readonly bay: boolean;
}

/** Every design in `library` a refit of each of `ships` would take, other than what they are built to now. */
export function remodels(ships: readonly ShipView[], library: readonly Choice[]): Remodel[] {
  return library.flatMap((choice) => {
    let kept = 0;
    let of = 0;
    let bay = true;
    for (const ship of ships) {
      const share = refitShare(ship.blueprint ?? ship.currentStructure, choice.design);
      if (share === null) return [];
      kept += share.kept;
      of += share.of;
      bay = share.bay;
    }
    // Not a remodel at all.
    if (kept === of && ships.every((ship) => (ship.blueprint ?? ship.currentStructure).modules.length === choice.design.modules.length)) {
      return [];
    }
    return [{ choice, kept, of, bay }];
  });
}
