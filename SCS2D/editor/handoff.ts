import { parseFleet, serialiseFleet, type Blueprint, type Fleet } from '../sim/index.js';

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

/** A fleet of one ship, named after it, for trying a design on its own. */
export function shipFleet(blueprint: Blueprint): Fleet {
  return { name: blueprint.name, designs: { [blueprint.name]: blueprint }, ships: [{ design: blueprint.name, x: 0, y: 0 }] };
}

/** The fleet a battle page address carries, or null. Throws on one that is there but unreadable. */
export function handedFleet(hash: string): Fleet | null {
  if (!hash.startsWith(KEY)) return null;
  return parseFleet(JSON.parse(decodeURIComponent(hash.slice(KEY.length))));
}
