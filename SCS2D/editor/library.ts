import { parseBlueprint, serialiseBlueprint, type Blueprint } from '../sim/index.js';
import { BLUEPRINTS } from '../scenarios/blueprints.js';

/**
 * The ships available to open, from two places at once: the ones that ship
 * with the game, and the ones the player has saved.
 *
 * Saving goes to browser storage so that iterating has no friction — a browser
 * cannot write into a checkout, and asking for a file every time a layout
 * changed would make the tool unusable. Export is how a ship reaches the
 * repository or another person, and it is deliberately a separate act.
 */

/**
 * The storage this needs, named rather than taken from the DOM.
 *
 * `localStorage` satisfies it as it stands, and so does a plain object in a
 * test — which is the point. A library whose behaviour can only be checked in
 * a browser is a library whose behaviour is not checked.
 */
export interface KeyValueStore {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Namespaced so the editor shares an origin with anything else politely. */
const PREFIX = 'scs2d.blueprint.';

/** The ships that come with the game, by name. */
export const BUILT_IN: readonly Blueprint[] = Object.values(BLUEPRINTS);

/**
 * One openable ship, which is a *copy* rather than a name.
 *
 * A saved ship and a shipped one of the same name are two entries, not one:
 * they are different layouts, and a list that showed a single Corvette would
 * be one in which the shipped Corvette could not be opened without deleting
 * the player's. `stock` is which of the two this is, and is what `load` and
 * `loadStock` are told apart by.
 */
export interface LibraryEntry {
  name: string;
  /** The ship as it ships with the game, rather than the player's copy of it. */
  stock: boolean;
  /** Whether a saved copy of this name exists at all, stock entry or not. */
  saved: boolean;
}

export class Library {
  constructor(private readonly store: KeyValueStore) {}

  /**
   * Everything openable: the shipped ships first, then the saved ones.
   *
   * A saved ship named after a shipped one **shadows it for `load` and is
   * listed beside it**, rather than taking its place. Opening the Corvette
   * gives the player their Corvette, which is what they mean by the name; the
   * shipped hull stays reachable because it is the thing a new ship is most
   * often started from, and reaching it by deleting an afternoon's work is no
   * way to offer it.
   */
  list(): LibraryEntry[] {
    const saved = this.savedNames();
    const out: LibraryEntry[] = [];
    for (const blueprint of BUILT_IN) {
      const shadowed = saved.includes(blueprint.name);
      // The player's copy first: it is the one the name means.
      if (shadowed) out.push({ name: blueprint.name, stock: false, saved: true });
      out.push({ name: blueprint.name, stock: true, saved: shadowed });
    }
    for (const name of saved) {
      if (!BUILT_IN.some((blueprint) => blueprint.name === name)) {
        out.push({ name, stock: false, saved: true });
      }
    }
    return out;
  }

  savedNames(): string[] {
    const names: string[] = [];
    for (let i = 0; i < this.store.length; i++) {
      const key = this.store.key(i);
      if (key !== null && key.startsWith(PREFIX)) names.push(key.slice(PREFIX.length));
    }
    return names.sort();
  }

  /**
   * Open a ship by name, or null if there is none.
   *
   * A saved layout goes through `parseBlueprint` exactly as a stranger's file
   * does. Browser storage is not a trusted store — it holds whatever the last
   * version of the format wrote, and whatever anyone typed into a console —
   * so a file that cannot be read at all is thrown on rather than guessed at.
   *
   * A layout that *reads* but would not fly comes back like any other, faults
   * and all: the editor is where such a ship is put right, and it names what
   * is wrong with it in the problems panel.
   */
  load(name: string): Blueprint | null {
    const raw = this.store.getItem(PREFIX + name);
    if (raw !== null) return parseBlueprint(JSON.parse(raw));
    return this.loadStock(name);
  }

  /**
   * The ship as it ships with the game, whatever the player has saved under
   * that name. Nothing to parse: a shipped ship is already a blueprint.
   */
  loadStock(name: string): Blueprint | null {
    return BUILT_IN.find((blueprint) => blueprint.name === name) ?? null;
  }

  save(blueprint: Blueprint): void {
    this.store.setItem(PREFIX + blueprint.name, JSON.stringify(serialiseBlueprint(blueprint), null, 2));
  }

  /** Delete the saved copy. A built-in ship of the same name reappears. */
  remove(name: string): void {
    this.store.removeItem(PREFIX + name);
  }
}

/** A blueprint as the text an export writes and an import reads. */
export function toFileText(blueprint: Blueprint): string {
  return `${JSON.stringify(serialiseBlueprint(blueprint), null, 2)}\n`;
}

/** A blank ship. No seed module: the first choice is what the ship is built around. */
export function emptyBlueprint(name: string): Blueprint {
  return { name, modules: [] };
}

/**
 * The next name in a series: the number on the end put up by one, or a 2
 * added when there is no number to put up.
 *
 * "Corvette" becomes "Corvette 2" and "Corvette 2" becomes "Corvette 3", so
 * duplicating repeatedly counts rather than stacking suffixes.
 */
export function nextName(name: string): string {
  const numbered = /^(.*?)(\d+)$/.exec(name.trim());
  if (numbered === null) return `${name.trim()} 2`;
  return `${numbered[1]}${Number(numbered[2]) + 1}`;
}

/** `wanted` if it is free, else the next name in its series that is. */
export function unusedName(wanted: string, taken: readonly string[]): string {
  let name = wanted;
  while (taken.includes(name)) name = nextName(name);
  return name;
}
