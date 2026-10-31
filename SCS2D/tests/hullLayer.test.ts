import { describe, expect, it } from "vitest";
import type { AlphaFilter, Graphics } from "pixi.js";
import { capture, isDomed, Snapshot } from "../sim/index.js";
import { duel } from "../scenarios/duel.js";
import { asteroidField } from "../scenarios/asteroidField.js";
import { starWars } from "../scenarios/starWars.js";
import { blockShadow, HullLayer } from "../render/hullLayer.js";
import {
    BUILDER_LIGHT,
    DEFAULT_LIGHT,
    FIGHTER_SHADOW_M,
    KERNEL_RISE,
    LANDED_SHADOW_M,
    rockHeight,
    ROCK_SHADOW_M,
    THICK_ROCK_RISE,
    THICK_SHADOW_M,
    type Light,
} from "../render/light.js";
import { isFighterModule } from "../render/moduleFills.js";

/** A layer whose shadows are darkened through a stand-in, as Node cannot build a filter's shader. */
const layerOf = (): HullLayer => new HullLayer(() => ({ alpha: 1 }) as AlphaFilter);

describe("the Pixi hull layer", () => {
    // Capital ships with thick modules, and fighters.
    const battle = starWars();
    const view = capture(new Snapshot(), battle.world, battle.ships, battle.projectiles, battle.beams);
    const ships = view.ships.slice(0, view.shipCount);
    // Far enough out to see every ship.
    const camera = { x: 0, y: 0, scale: 0.0001 };
    const count = (which: (fighter: boolean, thick: boolean) => boolean): number => {
        let n = 0;
        for (const ship of ships) {
            const design = ship.currentStructure;
            for (let i = 0; i < design.modules.length; i++) {
                const m = design.modules[i]!;
                // A turret's block is hull; only its dome stands above the deck.
                const thick = m.weaponsLayer && !isDomed(m.spec.kind);
                if (ship.drawn?.[i] !== false && which(isFighterModule(design, i), thick)) n++;
            }
        }
        return n;
    };
    const drawn = (layer: HullLayer, light: Light = DEFAULT_LIGHT): HullLayer => {
        layer.update(view, camera, 1000, 1000, light);
        return layer;
    };

    it("casts each turret's dome's shadow on the thin hull, as a thick module's", () => {
        const layer = drawn(layerOf());
        const domes = ships.reduce(
            (sum, ship) =>
                sum +
                ship.currentStructure.modules.filter(
                    (m, i) => ship.drawn?.[i] !== false && isDomed(m.spec.kind) && !isFighterModule(ship.currentStructure, i),
                ).length,
            0,
        );
        expect(domes).toBeGreaterThan(0);
        expect(layer.thickShadows.shapes.length).toBeGreaterThanOrEqual(layer.thick.shown().length + domes);
    });

    it("fills every capital module, thin or thick by its layer, each within its ship and relative to the camera", () => {
        const layer = drawn(layerOf());
        expect(count((fighter, thick) => !fighter && thick)).toBeGreaterThan(0);
        expect(layer.thick.shown().length).toBe(count((fighter, thick) => !fighter && thick));
        expect(layer.thin.shown().length).toBe(count((fighter, thick) => !fighter && !thick));
        for (const g of [...layer.thin.shown(), ...layer.thick.shown()]) {
            const near = ships.some(
                (ship) =>
                    Math.hypot(g.position.x + camera.x - ship.x, g.position.y + camera.y - ship.y) <= ship.currentStructure.radius + 1e-3,
            );
            expect(near).toBe(true);
            expect(g.alpha).toBeGreaterThan(0);
            expect(g.alpha).toBeLessThanOrEqual(1);
        }
    });

    it("casts each thick module's shadow away from the light onto thin hull, and each fighter's further, onto any", () => {
        const light: Light = { from: Math.PI / 3, colour: "#ffd0a0", ambient: 0.4 };
        const layer = drawn(layerOf(), light);
        const away = (distance: number): [number, number] => [-Math.cos(light.from) * distance, -Math.sin(light.from) * distance];
        const [tx, ty] = away(THICK_SHADOW_M);
        // Each thick module's shadow joins it: every corner it has, and every corner moved away, is within its shadow.
        const thick = layer.thick.shown();
        expect(layer.thickShadows.shapes.length).toBeGreaterThanOrEqual(thick.length);
        const inside = (shape: number[], x: number, y: number): boolean => {
            for (let k = 0; k < shape.length; k += 2) {
                const j = (k + 2) % shape.length;
                if ((shape[j]! - shape[k]!) * (y - shape[k + 1]!) - (shape[j + 1]! - shape[k + 1]!) * (x - shape[k]!) < -1e-6) return false;
            }
            return true;
        };
        for (const g of thick) {
            const reached = layer.thickShadows.shapes.some(
                (shape) => inside(shape, g.position.x, g.position.y) && inside(shape, g.position.x + tx, g.position.y + ty),
            );
            expect(reached).toBe(true);
        }
        expect(count((fighter) => fighter)).toBeGreaterThan(0);
        expect(layer.fighterShadows.shown().length).toBe(count((fighter) => fighter));
        // Each fighter's shadow falls further from it, in the order the fighters' modules come: a
        // flying fighter's further than a thick module's, one aboard its carrier's nearer.
        expect(LANDED_SHADOW_M).toBeLessThan(THICK_SHADOW_M);
        expect(FIGHTER_SHADOW_M).toBeGreaterThan(THICK_SHADOW_M);
        const fighterShadows = layer.fighterShadows.shown();
        let k = 0;
        for (const ship of ships) {
            const design = ship.currentStructure;
            const [fx, fy] = away(design.fighter && ship.riding !== true ? FIGHTER_SHADOW_M : LANDED_SHADOW_M);
            const [c, s] = [Math.cos(ship.angle), Math.sin(ship.angle)];
            for (let i = 0; i < design.modules.length; i++) {
                if (ship.drawn?.[i] === false || !isFighterModule(design, i)) continue;
                const m = design.modules[i]!;
                const shadow = fighterShadows[k++]!;
                expect(shadow.position.x).toBeCloseTo(ship.x - camera.x + m.x * c - m.y * s + fx, 6);
                expect(shadow.position.y).toBeCloseTo(ship.y - camera.y + m.x * s + m.y * c + fy, 6);
            }
        }
        // Where they may fall: thick shadows on the thin hull, a fighter's on any.
        expect(layer.thinHull.shown().length).toBe(layer.thin.shown().length);
        expect(layer.hull.shown().length).toBe(layer.thin.shown().length + thick.length);
        expect(layer.thickShadows.layer.mask).toBe(layer.thinHull.container);
        expect(layer.fighterShadows.container.mask).toBe(layer.hull.container);
        // What is in shadow keeps only the ambient share; what is lit takes the light's colour.
        expect((layer.thickShadows.layer.filters as AlphaFilter[])[0]!.alpha).toBeCloseTo(0.6);
        expect(layer.thin.container.tint).toBe(0xffd0a0);
    });

    it("brings a fighter's shadow in to the landed offset while it is parked on its carrier's pad", () => {
        const fighter = ships.find((ship) => ship.currentStructure.fighter)!;
        const firstShadow = (): number => {
            const layer = drawn(layerOf());
            // Shadows come in the order the ships do: this fighter's is after every fighter module before it.
            let before = 0;
            for (const ship of ships) {
                if (ship === fighter) break;
                const design = ship.currentStructure;
                for (let i = 0; i < design.modules.length; i++) if (ship.drawn?.[i] !== false && isFighterModule(design, i)) before++;
            }
            return layer.fighterShadows.shown()[before]!.position.x;
        };
        const flying = firstShadow();
        fighter.riding = true;
        try {
            const parked = firstShadow();
            // Away from the light: along -cos(from) by the height.
            const along = -Math.cos(DEFAULT_LIGHT.from);
            expect(parked - flying).toBeCloseTo(along * (LANDED_SHADOW_M - FIGHTER_SHADOW_M), 6);
        } finally {
            fighter.riding = false;
        }
    });

    it("shortens every shadow by the light's slant, as a light nearer overhead does", () => {
        const offsets = (light: Light): number[] =>
            drawn(layerOf(), light)
                .fighterShadows.shown()
                .map((g) => g.position.x);
        const low = offsets(DEFAULT_LIGHT);
        const high = offsets(BUILDER_LIGHT);
        const flat = offsets({ ...BUILDER_LIGHT, slant: 0 });
        expect(BUILDER_LIGHT.slant).toBeLessThan(1);
        // Measured from where it would fall with the light straight overhead.
        low.forEach((x, i) => expect(high[i]! - flat[i]!).toBeCloseTo((x - flat[i]!) * BUILDER_LIGHT.slant!, 6));
    });

    it("casts each capital barrel's shadow on the thin hull, moved away from the light by a thick module's height", () => {
        const layer = drawn(layerOf());
        let barrels = 0;
        for (const ship of ships) {
            const design = ship.currentStructure;
            for (let t = 0; t < design.turrets.length; t++) {
                const module = design.turrets[t]!.module;
                if (ship.drawn?.[module] === false || isFighterModule(design, module)) continue;
                barrels += design.turrets[t]!.gun.barrelCount;
            }
        }
        expect(barrels).toBeGreaterThan(0);
        expect(layer.thickShadows.strokes).toBe(barrels);
    });

    it("casts a block's shadow as its footprint swept away from the light", () => {
        const shadow = blockShadow([0, 0, 1, 0, 1, 1, 0, 1], 1, -1);
        let area = 0;
        for (let k = 0; k < shadow.length; k += 2) {
            const j = (k + 2) % shadow.length;
            area += shadow[k]! * shadow[j + 1]! - shadow[j]! * shadow[k + 1]!;
        }
        // The square, and a parallelogram along each of the two sides it is swept across.
        expect(area / 2).toBeCloseTo(3);
        expect(shadow.length / 2).toBe(6);
    });

    it("stands an asteroid's thin rock above any ship, its thick rock and kernel each a step higher, each shadowing what is below", () => {
        const field = asteroidField();
        const seen = capture(new Snapshot(), field.world, field.ships, field.projectiles, field.beams);
        const layer = layerOf();
        layer.update(seen, camera, 1000, 1000);
        let thin = 0;
        let thick = 0;
        let kernel = 0;
        for (const ship of seen.ships.slice(0, seen.shipCount)) {
            for (let i = 0; i < ship.currentStructure.modules.length; i++) {
                if (ship.drawn?.[i] === false) continue;
                const m = ship.currentStructure.modules[i]!;
                if (m.spec.kind === "rock" && m.weaponsLayer) thick++;
                else if (m.spec.kind === "rock") thin++;
                if (m.spec.kind === "kernel") kernel++;
            }
        }
        expect(thin).toBeGreaterThan(0);
        expect(thick).toBeGreaterThan(0);
        expect(kernel).toBeGreaterThan(0);
        expect(layer.rock.shown().length).toBe(thin);
        expect(layer.thickRock.shown().length).toBe(thick);
        expect(layer.kernel.shown().length).toBe(kernel);
        expect(layer.rockShadows.shapes.length).toBeGreaterThanOrEqual(thin + thick);
        expect(layer.thickRockShadows.shapes.length).toBeGreaterThanOrEqual(thick);
        expect(layer.kernelShadows.shapes.length).toBeGreaterThanOrEqual(kernel);
        // Rock shades ships' hulls; thick rock, the thin; a kernel, the rock round it.
        expect(layer.rockShadows.layer.mask).toBe(layer.hullUnderRock.container);
        expect(layer.thickRockShadows.layer.mask).toBe(layer.thinRock.container);
        expect(layer.kernelShadows.layer.mask).toBe(layer.rockUnderKernel.container);
        expect(layer.thinRock.shown().length).toBe(thin);
        expect(layer.rockUnderKernel.shown().length).toBe(thin + thick);
        expect(ROCK_SHADOW_M).toBeCloseTo(2 * THICK_SHADOW_M);
        expect(THICK_ROCK_RISE).toBeGreaterThan(1);
        expect(KERNEL_RISE).toBeGreaterThan(THICK_ROCK_RISE);
        // A small asteroid's rock stands at the least height, a large one's higher, so its step still shows.
        expect(rockHeight(10)).toBe(ROCK_SHADOW_M);
        expect(rockHeight(1000)).toBeGreaterThan(10 * ROCK_SHADOW_M);
    });

    it("shares one context between modules of the same spec and side, and keeps them from frame to frame", () => {
        // Two corvettes of one design.
        const pair = duel();
        const seen = capture(new Snapshot(), pair.world, pair.ships, pair.projectiles, pair.beams);
        const layer = layerOf();
        layer.update(seen, { x: 500, y: -200, scale: 0.001 }, 1000, 1000);
        const fills: Graphics[] = layer.thin.shown();
        expect(new Set(fills.map((g) => g.context)).size).toBeLessThan(fills.length);
        const before = fills.map((g) => g.context);
        layer.update(seen, { x: 500, y: -200, scale: 0.001 }, 1000, 1000);
        expect(layer.thin.shown().map((g) => g.context)).toEqual(before);
    });

    it("hides what is off screen, and reuses its fills when it comes back", () => {
        const layer = drawn(layerOf());
        const held = layer.thin.container.children.length;
        layer.update(view, { x: 1e9, y: 1e9, scale: 1 }, 1000, 1000);
        expect(layer.thin.shown().length).toBe(0);
        expect(layer.thin.container.children.every((g) => !g.visible)).toBe(true);
        drawn(layer);
        expect(layer.thin.container.children.length).toBe(held);
    });
});
