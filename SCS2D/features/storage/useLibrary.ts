import { useMemo, useSyncExternalStore } from "react";
import { FLEET_FILES, Library, SHIPS } from "~/editor/library";
import type { Blueprint, Fleet } from "~/sim/index";
import { useStorage } from "./StorageContext";

export interface Libraries {
    readonly ships: Library<Blueprint>;
    readonly fleets: Library<Fleet>;
}

/**
 * The saved ships and fleets, shared by every route and by the old pages, which
 * keep them under the same keys. A component using it re-renders on any save.
 */
export function useLibrary(): Libraries {
    const storage = useStorage();
    const version = useSyncExternalStore(storage.subscribe, storage.version);
    // A new object on every save, so a memoised child sees the change.
    return useMemo(() => {
        void version;
        return { ships: new Library(storage, SHIPS), fleets: new Library(storage, FLEET_FILES) };
    }, [storage, version]);
}
