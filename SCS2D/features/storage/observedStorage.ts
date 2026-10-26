import type { KeyValueStore } from "~/editor/library";

/**
 * Browser storage that says when it has changed, so React can re-render on a
 * save: from this page, through `setItem` and `removeItem`, or from another
 * tab, through the `storage` event.
 */
export class ObservedStorage implements KeyValueStore {
    private readonly listeners = new Set<() => void>();
    private changes = 0;

    constructor(private readonly store: KeyValueStore) {}

    get length(): number {
        return this.store.length;
    }

    key(index: number): string | null {
        return this.store.key(index);
    }

    getItem(key: string): string | null {
        return this.store.getItem(key);
    }

    setItem(key: string, value: string): void {
        this.store.setItem(key, value);
        this.changed();
    }

    removeItem(key: string): void {
        this.store.removeItem(key);
        this.changed();
    }

    /** For `useSyncExternalStore`: goes up on every change. */
    readonly version = (): number => this.changes;

    readonly subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    /** Another tab wrote to the same storage. */
    changed(): void {
        this.changes++;
        for (const listener of this.listeners) listener();
    }
}

/** Storage that lasts as long as the page: for tests, and where the browser refuses its own. */
export function memoryStore(entries: Record<string, string> = {}): KeyValueStore {
    const items = new Map(Object.entries(entries));
    return {
        get length() {
            return items.size;
        },
        key: (index) => [...items.keys()][index] ?? null,
        getItem: (key) => items.get(key) ?? null,
        setItem: (key, value) => void items.set(key, value),
        removeItem: (key) => void items.delete(key),
    };
}

/**
 * The browser's storage, watched for other tabs' writes, or storage in memory
 * if the browser will not give it: a private window, or files opened with
 * storage turned off.
 */
export function browserStorage(): ObservedStorage {
    let store: KeyValueStore;
    try {
        store = window.localStorage;
        store.getItem("scs2d.probe");
    } catch {
        store = memoryStore();
    }
    const observed = new ObservedStorage(store);
    window.addEventListener("storage", () => observed.changed());
    return observed;
}
