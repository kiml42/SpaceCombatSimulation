import { parseBlueprint, parseFleet, serialiseBlueprint, serialiseFleet, type Blueprint, type Fleet } from "../sim/index.js";
import { BLUEPRINTS } from "../scenarios/blueprints.js";
import { FLEETS } from "../scenarios/fleets.js";

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

/** What one kind of saved file needs: where it is kept, and how it is read and written. */
export interface LibraryKind<T extends { name: string }> {
    /** Namespaced so the editor shares an origin with anything else politely. */
    readonly prefix: string;
    /**
     * Whether it is known by its category and name together, rather than its
     * name alone. Then the categories its built-in ones use are the game's, and
     * one saved under none of its own, or under one of those, goes under `MY_SHIPS`.
     */
    readonly categorised?: boolean;
    /** Where saves kept before it was categorised are, to be moved under `prefix`. */
    readonly formerPrefix?: string;
    readonly builtIn: readonly T[];
    parse(value: unknown): T;
    serialise(value: T): Record<string, unknown>;
}

/** The ships that come with the game, by name. */
export const BUILT_IN: readonly Blueprint[] = Object.values(BLUEPRINTS);

export const SHIPS: LibraryKind<Blueprint> = {
    prefix: "scs2d.ship.",
    categorised: true,
    formerPrefix: "scs2d.blueprint.",
    builtIn: BUILT_IN,
    parse: parseBlueprint,
    serialise: serialiseBlueprint,
};

export const FLEET_FILES: LibraryKind<Fleet> = {
    prefix: "scs2d.fleet.",
    builtIn: Object.values(FLEETS),
    parse: parseFleet,
    serialise: serialiseFleet,
};

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
    /** What `Library.load` opens it by. */
    key: string;
    name: string;
    /** The ship as it ships with the game, rather than the player's copy of it. */
    stock: boolean;
    /** Whether a saved copy of this name exists at all, stock entry or not. */
    saved: boolean;
    /** What it is grouped under, if it says (`Blueprint.category`). */
    category?: string;
}

/** Alphabetical, ignoring case and reading digits as numbers, so "Mk 2" comes before "Mk 10". */
export function byName(a: string, b: string): number {
    return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}

/** What a ship with no category of its own is grouped under. */
export const UNCATEGORISED = "Uncategorised";

/** Where a player's ship goes with no category of its own, or one kept for the game's. */
export const MY_SHIPS = "My ships";

/** A stock entry a saved one of its name shadows, told apart from it, where a name alone is its key. */
export const STOCK = "stock:";

/** What a categorised entry is known by: its category and name. */
export function shipKey(category: string, name: string): string {
    return `${category}/${name}`;
}

/** Items grouped by category, the groups in alphabetical order and each in the order given. */
export function byCategory<T>(items: readonly T[], categoryOf: (item: T) => string | undefined): [string, T[]][] {
    const groups = new Map<string, T[]>();
    for (const item of items) {
        const category = categoryOf(item) ?? UNCATEGORISED;
        const group = groups.get(category);
        if (group === undefined) groups.set(category, [item]);
        else group.push(item);
    }
    return [...groups].sort(([a], [b]) => a.localeCompare(b));
}

export class Library<T extends { name: string; category?: string } = Blueprint> {
    private readonly kind: LibraryKind<T>;

    constructor(
        private readonly store: KeyValueStore,
        kind?: LibraryKind<T>,
    ) {
        this.kind = kind ?? (SHIPS as unknown as LibraryKind<T>);
    }

    /** The categories the game's own use, which a player's are never filed under. */
    reserved(): Set<string> {
        if (this.kind.categorised !== true) return new Set();
        return new Set(this.kind.builtIn.map((item) => categoryIn(item) ?? UNCATEGORISED));
    }

    /** `value` as a save files it: under a category of the player's, if it is known by one. */
    filed(value: T): T {
        if (this.kind.categorised !== true) return value;
        const category = categoryIn(value);
        return category !== undefined && !this.reserved().has(category) ? value : { ...value, category: MY_SHIPS };
    }

    /** What `value` is known by where it stands: a stock ship's key while it is in its stock category. */
    keyOf(value: T): string {
        if (this.kind.categorised !== true) return value.name;
        return shipKey(categoryIn(value) ?? MY_SHIPS, value.name);
    }

    /** Whether there is a saved copy under this key. */
    isSaved(key: string): boolean {
        this.migrate();
        return this.store.getItem(this.kind.prefix + key) !== null;
    }

    /** Everything openable, by name: a saved one just before the stock one it shadows. */
    list(): LibraryEntry[] {
        return this.entries().sort((a, b) => byName(a.name, b.name));
    }

    /** What opens when nothing is asked for: the first shipped entry, as its name opens it. */
    first(): LibraryEntry | undefined {
        return this.entries()[0];
    }

    /**
     * Everything openable: the shipped ones first, then the saved ones.
     *
     * Where a name alone is the key, a saved one named after a shipped one
     * **shadows it for `load` and is listed beside it**, rather than taking its
     * place, so the shipped one stays reachable without deleting the player's.
     * Where a category is part of the key, nothing shadows anything: a player's
     * is never filed under a category of the game's.
     */
    private entries(): LibraryEntry[] {
        this.migrate();
        const saved = this.savedKeys();
        const out: LibraryEntry[] = [];
        for (const item of this.kind.builtIn) {
            const key = this.keyOf(item);
            const shadowed = saved.includes(key);
            // The player's copy first: it is the one the name means.
            if (shadowed) out.push(this.savedEntry(key));
            out.push(withCategory({ key: shadowed ? STOCK + key : key, name: item.name, stock: true, saved: shadowed }, categoryIn(item)));
        }
        for (const key of saved) {
            if (!this.kind.builtIn.some((item) => this.keyOf(item) === key)) out.push(this.savedEntry(key));
        }
        return out;
    }

    private savedEntry(key: string): LibraryEntry {
        let category: string | undefined;
        let name = key;
        if (this.kind.categorised === true) {
            const slash = key.indexOf("/");
            category = key.slice(0, slash);
            name = key.slice(slash + 1);
        } else {
            try {
                category = categoryIn(JSON.parse(this.store.getItem(this.kind.prefix + key) ?? "null"));
            } catch {
                // Unreadable: listed uncategorised, for the editor to put right.
            }
        }
        return withCategory({ key, name, stock: false, saved: true }, category);
    }

    /** The keys saved copies are kept under. */
    savedKeys(): string[] {
        this.migrate();
        const keys: string[] = [];
        for (let i = 0; i < this.store.length; i++) {
            const key = this.store.key(i);
            if (key !== null && key.startsWith(this.kind.prefix)) keys.push(key.slice(this.kind.prefix.length));
        }
        return keys.sort();
    }

    /** The names of the saved copies. */
    savedNames(): string[] {
        return [...new Set(this.savedKeys().map((key) => this.savedEntry(key).name))].sort();
    }

    /**
     * Open one by its key, or null if there is none. A bare name, as older
     * links and settings hold, opens a saved one of that name before a stock one.
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
    load(key: string): T | null {
        if (key.startsWith(STOCK)) return this.loadStock(key.slice(STOCK.length));
        this.migrate();
        const raw = this.store.getItem(this.kind.prefix + key);
        if (raw !== null) {
            const value = this.kind.parse(JSON.parse(raw));
            if (this.kind.categorised !== true) return value;
            // Where it is kept is what it is known by, whatever the file inside says.
            const category = this.savedEntry(key).category;
            return value.category === category ? value : { ...value, category };
        }
        const stock = this.loadStock(key);
        if (stock !== null || this.kind.categorised !== true) return stock;
        const named = this.list().filter((entry) => entry.name === key);
        const entry = named.find((each) => !each.stock) ?? named[0];
        return entry === undefined ? null : this.load(entry.key);
    }

    /**
     * The one shipped with the game under this key, whatever the player has
     * saved. Nothing to parse: a shipped one is already a blueprint.
     */
    loadStock(key: string): T | null {
        return this.kind.builtIn.find((item) => this.keyOf(item) === key) ?? null;
    }

    /** Save it where `filed` puts it, and return it as filed. */
    save(value: T): T {
        const filed = this.filed(value);
        this.store.setItem(this.kind.prefix + this.keyOf(filed), JSON.stringify(this.kind.serialise(filed), null, 2));
        return filed;
    }

    /**
     * Save it if it differs from what is kept under its key, so leaving an
     * editor keeps the work without copying an untouched stock one. One that
     * would not read back, an empty fleet say, is left unsaved. Whether it saved.
     */
    saveIfChanged(value: T): boolean {
        const text = JSON.stringify(this.kind.serialise(value));
        try {
            this.kind.parse(JSON.parse(text));
        } catch {
            return false;
        }
        const same = (as: T): boolean => {
            try {
                const current = this.load(this.keyOf(as));
                return current !== null && JSON.stringify(this.kind.serialise(current)) === JSON.stringify(this.kind.serialise(as));
            } catch {
                // Unreadable: overwritten by something that reads.
                return false;
            }
        };
        if (same(value)) return false;
        const filed = this.filed(value);
        if (filed !== value && this.isSaved(this.keyOf(filed)) && same(filed)) return false;
        this.save(value);
        return true;
    }

    /** Delete the saved copy. A built-in one of the same key reappears. */
    remove(key: string): void {
        this.store.removeItem(this.kind.prefix + key);
    }

    /** Move saves kept before the kind was categorised to where they are known now. */
    private migrate(): void {
        const former = this.kind.formerPrefix;
        if (former === undefined) return;
        const moving: string[] = [];
        for (let i = 0; i < this.store.length; i++) {
            const key = this.store.key(i);
            if (key !== null && key.startsWith(former)) moving.push(key);
        }
        for (const key of moving) {
            const raw = this.store.getItem(key)!;
            const name = key.slice(former.length);
            let text = raw;
            let category = MY_SHIPS;
            try {
                const value = JSON.parse(raw) as Record<string, unknown>;
                const own = categoryIn(value);
                if (own !== undefined && !this.reserved().has(own)) category = own;
                text = JSON.stringify({ ...value, category }, null, 2);
            } catch {
                // Unreadable: moved as it is, for the editor to put right.
            }
            let moved = shipKey(category, name);
            while (this.store.getItem(this.kind.prefix + moved) !== null)
                moved = shipKey(category, nextName(moved.slice(category.length + 1)));
            this.store.setItem(this.kind.prefix + moved, text);
            this.store.removeItem(key);
        }
    }
}

function categoryIn(value: unknown): string | undefined {
    const category = (value as { category?: unknown } | null)?.category;
    return typeof category === "string" && category.trim() !== "" ? category.trim() : undefined;
}

function withCategory(entry: LibraryEntry, category: string | undefined): LibraryEntry {
    return category === undefined ? entry : { ...entry, category };
}

/** The entries a library opens, grouped by category, leaving out a stock one a saved one shadows. */
export function openedByCategory(entries: readonly LibraryEntry[]): [string, LibraryEntry[]][] {
    return byCategory(
        entries.filter((entry) => !(entry.stock && entry.saved)),
        (entry) => entry.category,
    );
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
