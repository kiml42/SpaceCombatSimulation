import type { Library, LibraryEntry } from "~/editor/library";
import type { Blueprint, Fleet } from "~/sim/index";

/** A stock entry shadowed by a saved one, told apart as the ship editor does. */
export const STOCK = "stock:";
/** A design the fleet already carries, told apart from a library entry of the same name. */
export const CARRIED = "fleet:";

export function optionValue(entry: LibraryEntry): string {
    return entry.stock && entry.saved ? STOCK + entry.name : entry.name;
}

/** Its name, marked "(stock)" where a saved one shadows it, and "•" where it is the player's. */
export function optionLabel(entry: LibraryEntry): string {
    return entry.name + (entry.stock ? (entry.saved ? " (stock)" : "") : " •");
}

function reading<T>(name: string, read: () => T | null): T | null {
    try {
        return read();
    } catch (error) {
        window.alert(`Could not read the saved ${name}.\n\n${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}

/** The library entry an option names, or null after saying why it could not be read. */
export function fromLibrary<T extends { name: string }>(library: Library<T>, value: string): T | null {
    const stock = value.startsWith(STOCK);
    const name = stock ? value.slice(STOCK.length) : value;
    return reading(name, () => (stock ? library.loadStock(name) : library.load(name)));
}

/** The design an option names: one the fleet carries, or one from the library. */
export function designOf(fleet: Fleet, ships: Library<Blueprint>, value: string): Blueprint | null {
    return value.startsWith(CARRIED) ? (fleet.designs[value.slice(CARRIED.length)] ?? null) : fromLibrary(ships, value);
}
