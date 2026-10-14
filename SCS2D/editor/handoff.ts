import { parseFleet, serialiseFleet, shipFleet, type Fleet } from '../sim/index.js';
import { parseSkirmish, serialiseSkirmish, skirmishFragment, type Skirmish } from '../scenarios/skirmish.js';

/**
 * Handing what an editor holds to the battle page, to try it out.
 *
 * Carried in the link rather than in browser storage, which some browsers do
 * not share between pages opened as files.
 */

const KEY = '#fleet=';

/** The battle page's address, carrying this fleet as its first side. */
export function battleHref(fleet: Fleet): string {
  return `index.html${KEY}${encodeURIComponent(JSON.stringify(serialiseFleet(fleet)))}`;
}

export { shipFleet };

/** The fleet a battle page address carries, or null. Throws on one that is there but unreadable. */
export function handedFleet(hash: string): Fleet | null {
  if (!hash.startsWith(KEY)) return null;
  return parseFleet(JSON.parse(decodeURIComponent(hash.slice(KEY.length))));
}

/** A fleet's design opened in the ship editor, with what is needed to go back to the fleet. */
export interface DesignInFleet {
  fleet: Fleet;
  /** The design being edited, by its name in the fleet. */
  design: string;
  /** The skirmish the fleet is the player's in, if it is. */
  skirmish?: Skirmish;
}

const DESIGN_KEY = '#design=';

/** The ship editor's address, opening a design of this fleet. */
export function designHref(handed: DesignInFleet): string {
  const value = {
    fleet: serialiseFleet(handed.fleet),
    design: handed.design,
    ...(handed.skirmish === undefined ? {} : { skirmish: serialiseSkirmish(handed.skirmish) }),
  };
  return `editor.html${DESIGN_KEY}${encodeURIComponent(JSON.stringify(value))}`;
}

/** The fleet design an editor address carries, or null. Throws on one that is there but unreadable. */
export function handedDesign(hash: string): DesignInFleet | null {
  if (!hash.startsWith(DESIGN_KEY)) return null;
  const value = JSON.parse(decodeURIComponent(hash.slice(DESIGN_KEY.length))) as Record<string, unknown>;
  const fleet = parseFleet(value['fleet']);
  const design = value['design'];
  if (typeof design !== 'string' || fleet.designs[design] === undefined) {
    throw new Error(`the fleet has no design called ${JSON.stringify(design)}`);
  }
  return {
    fleet,
    design,
    ...(value['skirmish'] === undefined ? {} : { skirmish: parseSkirmish(value['skirmish']) }),
  };
}

/** The fleet editor's address, opening this fleet: as the skirmish's, if it is in one. */
export function fleetHref(fleet: Fleet, skirmish?: Skirmish): string {
  if (skirmish !== undefined) return `fleet.html${skirmishFragment({ ...skirmish, player: fleet })}`;
  return `fleet.html${KEY}${encodeURIComponent(JSON.stringify(serialiseFleet(fleet)))}`;
}
