import type { KeyValueStore } from "~/editor/library";

/** Where the Effects page keeps how it was left, so a reload comes back to it. */
export const EFFECTS_KEY = "scs2d.effects";

/**
 * How the Effects page was left: the scene and light by name, so adding or
 * reordering either does not change which is picked, and how fast, where in
 * its loop and whether it was playing.
 */
export interface KeptEffects {
    readonly scene: string;
    readonly speed: number;
    readonly light: string;
    readonly time: number;
    readonly playing: boolean;
}

export function keepEffects(store: KeyValueStore, kept: KeptEffects): void {
    try {
        store.setItem(EFFECTS_KEY, JSON.stringify(kept));
    } catch {
        // Storage full or refused: the page starts from its defaults next time.
    }
}

/** What was kept, each part that is missing or unreadable taken from `defaults`. */
export function keptEffects(store: KeyValueStore, defaults: KeptEffects): KeptEffects {
    let value: Partial<Record<keyof KeptEffects, unknown>>;
    try {
        const raw = store.getItem(EFFECTS_KEY);
        if (raw === null) return defaults;
        value = JSON.parse(raw) as Partial<Record<keyof KeptEffects, unknown>>;
        if (typeof value !== "object" || value === null) return defaults;
    } catch {
        return defaults;
    }
    return {
        scene: typeof value.scene === "string" ? value.scene : defaults.scene,
        speed: typeof value.speed === "number" && value.speed > 0 ? value.speed : defaults.speed,
        light: typeof value.light === "string" ? value.light : defaults.light,
        time: typeof value.time === "number" && value.time >= 0 ? value.time : defaults.time,
        playing: typeof value.playing === "boolean" ? value.playing : defaults.playing,
    };
}
