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

/** What an entry in the list is, which decides what may be done to it. */
export interface LibraryEntry {
  name: string;
  /** Saved copies shadow a built-in ship of the same name rather than replacing it. */
  saved: boolean;
  builtIn: boolean;
}

export class Library {
  constructor(private readonly store: KeyValueStore) {}

  /**
   * Everything openable, built-in ships first and saved ones after, each name
   * appearing once.
   *
   * A saved ship named after a built-in one shadows it: the player edited the
   * Corvette and saved it, and what they open next should be their Corvette.
   * The original is not gone — deleting the saved copy brings it back — which
   * is a gentler answer than refusing the name.
   */
  list(): LibraryEntry[] {
    const saved = this.savedNames();
    const out: LibraryEntry[] = BUILT_IN.map((blueprint) => ({
      name: blueprint.name,
      saved: saved.includes(blueprint.name),
      builtIn: true,
    }));
    for (const name of saved) {
      if (!out.some((entry) => entry.name === name)) out.push({ name, saved: true, builtIn: false });
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
   * and a layout that fails to parse is reported as a broken file rather than
   * allowed to become a broken ship.
   */
  load(name: string): Blueprint | null {
    const raw = this.store.getItem(PREFIX + name);
    if (raw !== null) return parseBlueprint(JSON.parse(raw));
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
