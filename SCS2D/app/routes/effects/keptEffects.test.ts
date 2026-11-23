import { describe, expect, it } from "vitest";
import { memoryStore } from "~/features/storage/observedStorage";
import { EFFECTS_KEY, keepEffects, keptEffects, type KeptEffects } from "./keptEffects";

const DEFAULTS: KeptEffects = { scene: "Hits", speed: 0.25, light: "battle default", time: 0, playing: true };

describe("how the Effects page was left", () => {
    it("comes back as kept", () => {
        const store = memoryStore();
        const left: KeptEffects = { scene: "Leaking dry", speed: 1, light: "dark", time: 4.2, playing: false };
        keepEffects(store, left);
        expect(keptEffects(store, DEFAULTS)).toEqual(left);
    });

    it("starts from its defaults where nothing was kept, or it cannot be read", () => {
        expect(keptEffects(memoryStore(), DEFAULTS)).toEqual(DEFAULTS);
        expect(keptEffects(memoryStore({ [EFFECTS_KEY]: "not json" }), DEFAULTS)).toEqual(DEFAULTS);
        expect(keptEffects(memoryStore({ [EFFECTS_KEY]: "null" }), DEFAULTS)).toEqual(DEFAULTS);
    });

    it("takes each part that is missing or wrong from its defaults", () => {
        const store = memoryStore({ [EFFECTS_KEY]: JSON.stringify({ scene: "Beams", speed: -1, time: "soon" }) });
        expect(keptEffects(store, DEFAULTS)).toEqual({ ...DEFAULTS, scene: "Beams" });
    });
});
