import { describe, expect, it } from "vitest";
import { capture, compileBlueprint, Damage, Snapshot, type ShipDesign } from "../sim/index.js";
import { DAMAGE_ENERGY_PER_KG } from "../sim/damage.js";
import { SCAR_BURN, SCAR_ROUND, SCAR_SHARE, SCAR_VIEW_STRIDE, scarSlots } from "../sim/scars.js";
import { CORVETTE } from "../scenarios/blueprints.js";
import { duel } from "../scenarios/duel.js";
import { beamDuel } from "../scenarios/beamDuel.js";
import { cloneBattle } from "../scenarios/clone.js";
import type { Battle } from "../scenarios/types.js";

const corvette: ShipDesign = compileBlueprint(CORVETTE);
/** The corvette's biggest module, which has room for more than one scar. */
const big = corvette.modules.reduce(
    (best, m, i) => (m.spec.length * m.spec.width > corvette.modules[best]!.spec.length * corvette.modules[best]!.spec.width ? i : best),
    0,
);
const placed = corvette.modules[big]!;
const capacity = placed.stats.hitPoints * DAMAGE_ENERGY_PER_KG;
const threshold = SCAR_SHARE * capacity;

function fresh(): Damage {
    const damage = new Damage();
    damage.register(0, corvette);
    return damage;
}

/** A hit of `energy` on the big module at its centre, along +x of the hull, absorbed and then scarred. */
function hit(damage: Damage, energy: number, kind = SCAR_ROUND, dx = 0): void {
    damage.absorb(0, big, energy);
    damage.scar(0, big, kind, placed.x + dx, placed.y, placed.x + dx, placed.y, 1, 0, energy);
}

function shown(damage: Damage, body = 0): number[][] {
    const out: number[] = [];
    damage.scars.view(body, out);
    const scars: number[][] = [];
    for (let i = 0; i < out.length; i += SCAR_VIEW_STRIDE) scars.push(out.slice(i, i + SCAR_VIEW_STRIDE));
    return scars;
}

describe("scars", () => {
    it("are held by a module's area, one at least and eight at most", () => {
        expect(scarSlots(1.5, 0.5)).toBe(1);
        expect(scarSlots(4, 4)).toBe(4);
        expect(scarSlots(50, 10)).toBe(8);
    });

    it("come only from a round worth a share of what breaks the module", () => {
        const damage = fresh();
        hit(damage, threshold * 0.5);
        expect(shown(damage)).toHaveLength(0);
        hit(damage, threshold * 2);
        const scars = shown(damage);
        expect(scars).toHaveLength(1);
        expect(scars[0]![0]).toBe(big);
        expect(scars[0]![2]).toBe(SCAR_ROUND);
        // At the module's centre, in its own frame.
        expect(scars[0]![3]).toBeCloseTo(0, 9);
        expect(scars[0]![4]).toBeCloseTo(0, 9);
    });

    it("put a greater scar in place of the least once a module is full, and never a lesser", () => {
        const damage = fresh();
        const slots = scarSlots(placed.spec.length, placed.spec.width);
        for (let k = 0; k < slots; k++) hit(damage, threshold * (2 + k));
        expect(shown(damage)).toHaveLength(slots);
        hit(damage, threshold * 1.5);
        expect(Math.min(...shown(damage).map((s) => s[9]!))).toBeCloseTo(threshold * 2, 3);
        hit(damage, threshold * 100);
        const energies = shown(damage).map((s) => s[9]!);
        expect(energies).toHaveLength(slots);
        expect(Math.max(...energies)).toBeCloseTo(threshold * 100, 3);
        if (slots > 1) expect(Math.min(...energies)).toBeCloseTo(threshold * 3, 3);
    });

    it("grow a burn from the pieces that land near it, showing it once they add up", () => {
        const damage = fresh();
        for (let k = 0; k < 9; k++) hit(damage, threshold / 10, SCAR_BURN);
        expect(shown(damage)).toHaveLength(0);
        hit(damage, threshold / 10, SCAR_BURN);
        hit(damage, threshold / 10, SCAR_BURN, 0.1);
        const scars = shown(damage);
        expect(scars).toHaveLength(1);
        expect(scars[0]![9]).toBeCloseTo(threshold * 1.1, 3);
        // Drawn out to where the last piece landed.
        expect(Math.abs(scars[0]![5]! - scars[0]![3]!) + Math.abs(scars[0]![6]! - scars[0]![4]!)).toBeCloseTo(0.1, 6);
    });

    it("come off in reverse as the module is mended", () => {
        const damage = fresh();
        hit(damage, threshold * 2);
        hit(damage, threshold * 3);
        expect(shown(damage)).toHaveLength(2);
        damage.repair(0, big, threshold * 3);
        const left = shown(damage);
        expect(left).toHaveLength(1);
        expect(left[0]![9]).toBeCloseTo(threshold * 2, 3);
        damage.repair(0, big, threshold * 2);
        expect(shown(damage)).toHaveLength(0);
    });

    it("go with their module into a body remade around it", () => {
        const damage = fresh();
        hit(damage, threshold * 2);
        const carried = corvette.modules.map((_, m) => damage.scars.carriedAt(0, m));
        damage.register(1, corvette, undefined, undefined, undefined, carried);
        expect(shown(damage, 1)).toEqual(shown(damage, 0));
    });

    it("do not show on a body nothing can hurt", () => {
        const damage = fresh();
        damage.protect(0);
        hit(damage, threshold * 2);
        expect(shown(damage)).toHaveLength(0);
    });
});

const SEED = 20260905;

/** Every scar showing in a battle, ship by ship. */
function battleScars(battle: Battle): number[][] {
    return capture(new Snapshot(), battle.world, battle.ships, battle.projectiles, battle.beams).ships.map((ship) => [
        ...(ship.scars ?? []),
    ]);
}

describe("scars in a battle", () => {
    for (const [name, create, kind] of [
        ["duel", () => duel(SEED), SCAR_ROUND],
        ["beamDuel", () => beamDuel(SEED), SCAR_BURN],
    ] as const) {
        it(`${name} leaves them, and a copy of it goes on to leave the same`, () => {
            const battle = create();
            let steps = 0;
            const kinds = (): number[] => battleScars(battle).flatMap((s) => s.filter((_, i) => i % SCAR_VIEW_STRIDE === 2));
            while (!kinds().includes(kind) && steps < 6000) {
                for (let i = 0; i < 60; i++) battle.step();
                steps += 60;
            }
            expect(kinds()).toContain(kind);
            const copy = cloneBattle(battle);
            for (let i = 0; i < 240; i++) {
                battle.step();
                copy.step();
            }
            expect(battleScars(copy)).toEqual(battleScars(battle));
        }, 120_000);
    }
});
