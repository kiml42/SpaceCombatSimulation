import { describe, expect, it } from "vitest";
import { originOf } from "../sim/blueprint.js";
import { crash } from "../scenarios/crash.js";

/** The Star Destroyer's two bow triangles, as its blueprint numbers them. */
const BOW = [73, 159];

describe("a Star Destroyer flown into a rock", () => {
    const battle = crash();
    const ships = battle.ships;
    const design = ships.currentStructure(1);
    const discardedBefore = ships.discarded;
    for (let s = 0; s < 20 * 60; s++) battle.step();

    /** Which of its blueprint's modules are still anywhere in the world. */
    const left = new Set<number>();
    for (let i = 0; i < ships.highWater; i++) {
        if (!ships.isAlive(i)) continue;
        const st = ships.currentStructure(i);
        st.modules.forEach((_, m) => {
            const o = originOf(st, m);
            if (o.design === design) left.add(o.module);
        });
    }

    it("shatters its bow rather than bouncing off with it dented", () => {
        expect(left.size).toBeGreaterThan(100);
        for (const m of BOW) expect(left.has(m)).toBe(false);
        expect(ships.discarded).toBeGreaterThan(discardedBefore);
    });

    it("comes out of it a smaller ship", () => {
        expect(ships.currentStructure(1).modules.length).toBeLessThan(design.modules.length - BOW.length);
    });
});
