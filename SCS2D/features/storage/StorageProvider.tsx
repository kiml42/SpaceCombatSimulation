import type { ReactNode } from "react";
import { StorageContext } from "./StorageContext";
import type { ObservedStorage } from "./observedStorage";

/** The one storage every route reads its library and settings from. */
export function StorageProvider({ storage, children }: { readonly storage: ObservedStorage; readonly children: ReactNode }) {
    return <StorageContext value={storage}>{children}</StorageContext>;
}
