import { describe, expect, it } from "vitest";
import { AttackArcs, addTurret, bears, compileBlueprint, math } from "../sim/index.js";
import { Demonstration } from "../editor/demonstrate.js";

const { angleDelta } = math;
import { CATAMARAN, CORVETTE } from "../scenarios/blueprints.js";
import { attackBearings, attackRosette, gunsBearing, previewSnapshot } from "../editor/preview.js";
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

    it("slew round at their mounts' own rates, the trigger cone there at once, and fire once on it", () => {
        const design = compileBlueprint(CATAMARAN);
        const demo = new Demonstration();
        const snapshot = previewSnapshot(design);
        const view = snapshot.ships[0]!;
        const best = attackBearings(design)[0]!;
        const bearing = best.from + best.width / 2;
        const rest = design.turrets.map((turret) => turret.mount.restBearing ?? 0);
        const dt = 1 / 60;

        demo.step(design, [], dt, { bearing });
        demo.writeInto(snapshot);
        design.turrets.forEach((turret, t) => {
            if (!turret.main) return;
            // The cone is on the bearing; the barrel has gone no further than its rate allows.
            expect(Math.abs(angleDelta(view.turretAim![t]!, bearing))).toBeLessThan(1e-9);
            expect(Math.abs(angleDelta(rest[t]!, view.turretBearings[t]!))).toBeLessThanOrEqual(turret.mount.maxRate * dt + 1e-9);
        });

        let fired = 0;
        for (let i = 0; i < 60 * 30; i++) {
            demo.step(design, [], dt, { bearing });
            fired = Math.max(fired, demo.flashes.count);
        }
        demo.writeInto(snapshot);
        const { turrets } = gunsBearing(design, bearing);
        design.turrets.forEach((_, t) => {
            if (!turrets[t]) return;
            expect(Math.abs(angleDelta(view.turretBearings[t]!, bearing))).toBeLessThan(1e-3);
            expect(view.turretReady[t]).toBe(true);
        });
        expect(fired).toBeGreaterThan(0);
    });

    it("show a cone aimed into their own ship as fouled at once, before the barrel gets there", () => {
        const design = compileBlueprint(CATAMARAN);
        let checked = 0;
        design.turrets.forEach((turret, t) => {
            const mask = turret.mount.mask ?? [];
            if (!turret.main || mask.length === 0) return;
            const bearing = (turret.mount.restBearing ?? 0) + (mask[0]! + mask[1]!) / 2;
            const demo = new Demonstration();
            const snapshot = previewSnapshot(design);
            demo.step(design, [], 1 / 60, { bearing });
            demo.writeInto(snapshot);
            const view = snapshot.ships[0]!;
            expect(Math.abs(angleDelta(view.turretBearings[t]!, bearing))).toBeGreaterThan(0.1);
            expect(view.turretFouled![t]).toBe(true);
            checked++;
        });
        expect(checked).toBeGreaterThan(0);
    });

    it("go as far as they can towards a bearing they cannot fire on, and hold fire", () => {
        const design = compileBlueprint(CATAMARAN);
        const demo = new Demonstration();
        const snapshot = previewSnapshot(design);
        const view = snapshot.ships[0]!;
        for (let i = 0; i < 16; i++) {
            const bearing = -Math.PI + (2 * Math.PI * i) / 16;
            for (let k = 0; k < 60 * 30; k++) demo.step(design, [], 1 / 60, { bearing });
            demo.writeInto(snapshot);
            const { turrets } = gunsBearing(design, bearing);
            design.turrets.forEach((turret, t) => {
                if (!turret.main || turrets[t]) return;
                expect(view.turretReady[t]).toBe(false);
                expect(view.turretFouled![t] || Math.abs(angleDelta(view.turretBearings[t]!, bearing)) > 1e-3).toBe(true);
            });
        }
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
