import { expect, test } from "vitest";
import { SCENES } from "~/scenarios/scenes";
import { CUSTOM, sceneIndex, sceneParam } from "./sceneParam";

test("every scene, and the custom battle, reads back from its name in the address", () => {
    for (let index = 0; index <= CUSTOM; index++) expect(sceneIndex(sceneParam(index))).toBe(index);
    expect(sceneParam(CUSTOM)).toBe("custom");
    expect(sceneParam(0)).toBe(SCENES[0]!.name);
});

test("an address naming no scene opens the first", () => {
    expect(sceneIndex(null)).toBe(0);
    expect(sceneIndex("No Such Scene")).toBe(0);
});
