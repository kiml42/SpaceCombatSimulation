import { expect, test } from "vitest";
import { SCENES } from "~/scenarios/scenes";
import { CUSTOM, sceneIndex, sceneParam, variantIndex, variantParam } from "./sceneParam";

test("every scene, and the custom battle, reads back from its name in the address", () => {
    for (let index = 0; index <= CUSTOM; index++) expect(sceneIndex(sceneParam(index))).toBe(index);
    expect(sceneParam(CUSTOM)).toBe("custom");
    expect(sceneParam(0)).toBe(SCENES[0]!.name);
});

test("an address naming no scene opens the first", () => {
    expect(sceneIndex(null)).toBe(0);
    expect(sceneIndex("No Such Scene")).toBe(0);
});

test("every variant reads back from its name in the address, and a scene without them names none", () => {
    for (let scene = 0; scene < CUSTOM; scene++) {
        const variants = SCENES[scene]!.variants;
        if (variants === undefined) {
            expect(variantParam(scene, 0)).toBeNull();
            continue;
        }
        for (let variant = 0; variant < variants.length; variant++) expect(variantIndex(scene, variantParam(scene, variant))).toBe(variant);
    }
    const swarm = sceneIndex("Swarm");
    expect(variantIndex(swarm, null)).toBe(0);
    expect(variantIndex(swarm, "No Such Variant")).toBe(0);
});
