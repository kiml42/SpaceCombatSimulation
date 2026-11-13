import { describe, expect, it } from "vitest";
import { originOf } from "../sim/blueprint.js";
import { crash } from "../scenarios/crash.js";

/** The Star Destroyer's two bow triangles, as its blueprint numbers them. */
const BOW = [73, 159];
/** How far behind the tip of the bow the hull is spared, metres. */
const SPARED = 500;

describe("a Star Destroyer flown into a rock", () => {
    const battle = crash();
    const { ships, world } = battle;
    const bodies = world.bodies;
    const design = ships.currentStructure(1);

    /** Which of its blueprint's modules are still anywhere in the world. */
    const present = (): Set<number> => {
        const left = new Set<number>();
        for (let i = 0; i < ships.highWater; i++) {
            if (!ships.isAlive(i)) continue;
            const st = ships.currentStructure(i);
            st.modules.forEach((_, m) => {
                const o = originOf(st, m);
                if (o.design === design) left.add(o.module);
            });
        }
        return left;
    };
    /** How fast it closes on the rock, m/s. */
    const closing = (): number => bodies.vx[bodies.indexOf(ships.body(1))]! - bodies.vx[bodies.indexOf(ships.body(0))]!;

    /** Each contact that lost modules: which, when, and how fast it was closing just before. */
    const layers: { lost: number[]; closing: number; at: number }[] = [];
    let left = present();
    for (let s = 0; s < 40 * 60; s++) {
        const before = closing();
        battle.step();
        const now = present();
        const lost = [...left].filter((m) => !now.has(m));
        // Losses within half a second are one contact.
        if (lost.length > 0) {
            const last = layers[layers.length - 1];
            if (last !== undefined && s - last.at < 30) last.lost.push(...lost);
            else layers.push({ lost, closing: before, at: s });
        }
        left = now;
    }

    it("shatters its bow at the first contact", () => {
        expect(layers.length).toBeGreaterThan(0);
        for (const m of BOW) expect(layers[0]!.lost).toContain(m);
    });

    it("drives on, slower each time, through layer after layer until it comes to rest", () => {
        // Two at least: welds weak enough to tear shed the bow in pieces rather than crushing it layer by layer.
        expect(layers.length).toBeGreaterThanOrEqual(2);
        for (let k = 1; k < layers.length; k++) expect(layers[k]!.closing).toBeLessThan(layers[k - 1]!.closing);
        expect(closing()).toBeLessThan(0.5);
    });

    it("spares the hull well behind the bow", () => {
        const tip = Math.max(...design.modules.map((m) => m.x));
        const behind = design.modules.flatMap((m, k) => (m.x < tip - SPARED ? [k] : []));
        expect(behind.length).toBeGreaterThan(120);
        for (const m of behind) expect(left.has(m)).toBe(true);
    });
});
