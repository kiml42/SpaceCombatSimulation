import { describe, expect, it } from "vitest";
import { AttackArcs, addTurret, bears, compileBlueprint } from "../sim/index.js";
import { CATAMARAN, CORVETTE } from "../scenarios/blueprints.js";
import { aimAlong, attackBearings, attackRosette, gunsBearing, previewSnapshot } from "../editor/preview.js";
import { attackBearingAt, overAttack, overEnvelope } from "../editor/overlay.js";

describe("the guns the attack rosette turns", () => {
    it("are the main guns whose battle arcs, less their masks, cover the bearing", () => {
        for (const blueprint of [CORVETTE, CATAMARAN]) {
            const design = compileBlueprint(blueprint);
            for (let i = 0; i < 16; i++) {
                const bearing = -Math.PI + (2 * Math.PI * i) / 16;
                const { turrets } = gunsBearing(design, bearing);
                design.turrets.forEach((turret, t) => {
                    const arcs = new AttackArcs();
                    addTurret(arcs, turret.mount);
                    expect(turrets[t]).toBe(turret.main && bears(arcs, bearing));
                });
            }
        }
    });

    it("bring every gun counted in a best sector to bear in its middle", () => {
        const design = compileBlueprint(CATAMARAN);
        for (const sector of attackBearings(design)) {
            const { turrets, engines } = gunsBearing(design, sector.from + sector.width / 2);
            expect(turrets.filter(Boolean).length + engines.filter(Boolean).length).toBe(sector.guns);
        }
    });

    it("are as many as the rosette's shading says, everywhere round", () => {
        for (const blueprint of [CORVETTE, CATAMARAN]) {
            const design = compileBlueprint(blueprint);
            for (const stretch of attackRosette(design).coverage) {
                if (!(stretch.width > 0)) continue;
                const { turrets, engines } = gunsBearing(design, stretch.from + stretch.width / 2);
                expect(turrets.filter(Boolean).length + engines.filter(Boolean).length).toBe(stretch.guns);
            }
        }
    });

    it("turn to the bearing and are ready, leaving the rest at rest", () => {
        const design = compileBlueprint(CATAMARAN);
        const view = previewSnapshot(design).ships[0]!;
        expect(view.attackBearings).toBeUndefined();
        const before = [...view.turretBearings];
        const turrets = design.turrets.map((_, t) => t === 0);
        aimAlong(view, 1, turrets);
        expect(view.turretBearings[0]).toBe(1);
        expect(view.turretAim?.[0]).toBe(1);
        expect(view.turretReady[0]).toBe(true);
        expect(view.turretBearings.slice(1)).toEqual(before.slice(1));
    });
});

describe("the attack rosette", () => {
    it("sits left of the thrust rosette, and grows from its corner", () => {
        // 54 px radius, a 16 px gap left of the thrust rosette, an 18 px caption below.
        const cx = 1000 - 16 - 108 - 16 - 54;
        const cy = 600 - 54 - 16 - 18;
        expect(overAttack(1000, 600, cx, cy)).toBe(true);
        expect(overEnvelope(1000, 600, cx, cy)).toBe(false);
        expect(attackBearingAt(1000, 600, cx + 30, cy)).toBeCloseTo(0, 9);
        expect(attackBearingAt(1000, 600, cx, cy - 30)).toBeCloseTo(Math.PI / 2, 9);
        expect(attackBearingAt(1000, 600, 100, 100)).toBeNull();
        const between = { x: cx - 100, y: cy - 60 };
        expect(overAttack(1000, 600, between.x, between.y, false)).toBe(false);
        expect(overAttack(1000, 600, between.x, between.y, true)).toBe(true);
    });
});
