import { useCallback, useMemo, useSyncExternalStore } from "react";
import { parseView, viewKey, type ViewSettings } from "~/host/viewSettings";
import { useStorage } from "./StorageContext";

/**
 * How a page shows a battle, kept between visits under the same key the old
 * page of that name uses. Anything missing or unreadable comes from `defaults`,
 * which should be a constant.
 */
export function useViewSettings(page: string, defaults: ViewSettings): [ViewSettings, (change: Partial<ViewSettings>) => void] {
    const storage = useStorage();
    const raw = useSyncExternalStore(storage.subscribe, () => storage.getItem(viewKey(page)));
    const settings = useMemo(() => parseView(raw, defaults), [raw, defaults]);
    const update = useCallback(
        (change: Partial<ViewSettings>) => {
            const next = { ...parseView(storage.getItem(viewKey(page)), defaults), ...change };
            try {
                storage.setItem(viewKey(page), JSON.stringify(next));
            } catch {
                // Not remembered, which costs a visit its settings and nothing else.
            }
        },
        [storage, page, defaults],
    );
    return [settings, update];
}
