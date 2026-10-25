import { createContext, useContext } from "react";
import type { ObservedStorage } from "./observedStorage";

export const StorageContext = createContext<ObservedStorage | null>(null);

export function useStorage(): ObservedStorage {
    const storage = useContext(StorageContext);
    if (storage === null) throw new Error("useStorage needs a StorageProvider above it");
    return storage;
}
