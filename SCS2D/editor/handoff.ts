import { parseFleet, serialiseFleet, shipFleet, type Fleet } from '../sim/index.js';

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
