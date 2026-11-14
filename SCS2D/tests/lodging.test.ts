import { describe, expect, it } from "vitest";
import {
    asteroidBlueprint,
    compileBlueprint,
    DAMAGE_ENERGY_PER_KG,
    inWeaponsLayer,
    moduleOutline,
    NEUTRAL_TEAM,
    originOf,
    type ShipDesign,
} from "../sim/index.js";
import { Rng } from "../sim/rng.js";
import type { Ships } from "../sim/ships.js";
import type { World } from "../sim/world.js";
import { makeBattle } from "../scenarios/battle.js";
import { RIVAL_WELLS } from "../scenarios/rivalMines.js";
import { DINKY, REPLICATOR } from "../scenarios/blueprints.js";

/** Wreckage come to rest on rock lodges there, for whoever mines the rock to take apart. */

/**
 * A major, a Dinky set down at rest on top of it (`setDown`), unless `later`,
 * and, with `miner`, a Replicator of side 0 to anchor there.
 */
function scene(miner: boolean, flown = false, team = 1, unarmed = false, angle = 0, later = false) {
    return makeBattle({ seed: 1, wells: [RIVAL_WELLS[0]!] }, (ships, world, wells) => {
        const rock = asteroidBlueprint("A", { radius: 250, kernel: true, ore: 0.35, ice: 0.25 }, new Rng(5));
        const a = ships.spawn(world, { design: compileBlueprint(rock), rides: wells[0]!, team: NEUTRAL_TEAM });
        const { w, dinky } = later ? { w: -1, dinky: null } : setDown(ships, world, a, flown, team, unarmed, angle);
        const m = miner ? ships.spawn(world, { design: compileBlueprint(REPLICATOR), x: -340, y: 0, angle: 0, team: 0 }) : -1;
        return { a, w, m, dinky };
    });
}

/**
 * A Dinky at rest on top of rock `a`. It is wrecked, or with `flown` left under
 * control but with its tanks dry, so it lies where it is put; on side `team`,
 * and with `unarmed`, its guns shot out too; facing `angle`.
 */
function setDown(ships: Ships, world: World, a: number, flown = false, team = 1, unarmed = false, angle = 0) {
    const ab = world.bodies.indexOf(ships.body(a));
    const dinky = compileBlueprint(DINKY);
    const y = restingHeight(ships.currentStructure(a), world.bodies.x[ab]!, world.bodies.y[ab]!, world.bodies.angle[ab]!, dinky, angle);
    const vx = world.bodies.vx[ab]!;
    const vy = world.bodies.vy[ab]!;
    const w = ships.spawn(world, { design: dinky, x: 0, y, vx, vy, angle, team });
    const wb = world.bodies.indexOf(ships.body(w));
    const wreck = (m: number): void => ships.damage.absorb(wb, m, dinky.modules[m]!.stats.hitPoints * DAMAGE_ENERGY_PER_KG);
    if (!flown) for (const core of dinky.cores) wreck(core);
    else for (let m = 0; m < dinky.modules.length; m++) ships.fuel.drain(wb, m, ships.fuel.held(wb, m));
    if (unarmed) for (const turret of dinky.turrets) wreck(turret.module);
    return { w, dinky };
}

/** Every corner of a design's modules, in the world, for a body at `(x, y)` turned by `angle`. */
function corners(design: ShipDesign, x: number, y: number, angle: number): [number, number][] {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const out: [number, number][][] = [];
    for (const module of design.modules) {
        const outline: number[] = [];
        const n = moduleOutline(module.spec, outline);
        const ring: [number, number][] = [];
        for (let k = 0; k < n; k++) {
            const px = outline[2 * k]! - design.centreOfMassX;
            const py = outline[2 * k + 1]! - design.centreOfMassY;
            ring.push([x + px * c - py * s, y + px * s + py * c]);
        }
        out.push(ring);
    }
    return out.flat();
}

/**
 * How high above the rock a ship turned by `angle` at x = 0 has to be to just
 * clear it: its lowest corners on the rock's top edge, and a centimetre over.
 * A fighter flies over rock no deeper than a deck, so only what stands in the
 * weapons layer holds it up.
 */
function restingHeight(rock: ShipDesign, rx: number, ry: number, rockAngle: number, ship: ShipDesign, angle: number): number {
    const edges: [number, number, number, number][] = [];
    for (const module of rock.modules) {
        if (ship.fighter && !inWeaponsLayer(module.spec)) continue;
        const outline: number[] = [];
        const n = moduleOutline(module.spec, outline);
        const ring = corners({ ...rock, modules: [module] }, rx, ry, rockAngle).slice(0, n);
        for (let k = 0; k < n; k++) edges.push([...ring[k]!, ...ring[(k + 1) % n]!]);
    }
    const surface = (x: number): number => {
        let top = -Infinity;
        for (const [x0, y0, x1, y1] of edges) {
            if ((x - x0) * (x - x1) > 0 || x0 === x1) continue;
            top = Math.max(top, y0 + ((y1 - y0) * (x - x0)) / (x1 - x0));
        }
        return top;
    };
    let height = -Infinity;
    for (const [px, py] of corners(ship, 0, 0, angle)) height = Math.max(height, surface(px) - py);
    return height + 0.01;
}

describe("wreckage on rock", () => {
    it("lodges on a major once it has come to rest there, rather than lying on it", () => {
        const run = scene(false);
        expect(run.ships.hasControl(run.w)).toBe(false);
        for (let t = 0; t < 120 * 60 && run.ships.body(run.w) !== run.ships.body(run.a); t++) run.step();
        expect(run.ships.body(run.w)).toBe(run.ships.body(run.a));
        // The rock keeps its body and its rail.
        expect(run.world.bodies.pinned[run.world.bodies.indexOf(run.ships.body(run.a))]).toBe(1);
    });

    it("is taken apart by the robots of a ship moored to the rock", () => {
        const run = scene(true, false, 1, false, 0, true);
        for (let t = 0; t < 120 * 60 && !run.ships.isMoored(run.m); t++) run.step();
        const { w } = setDown(run.ships, run.world, run.a);
        const rockModules = () => run.ships.currentStructure(run.a).modules.length;
        for (let t = 0; t < 120 * 60 && run.ships.body(w) !== run.ships.body(run.a); t++) run.step();
        const lodged = rockModules();
        for (let t = 0; t < 900 * 60 && run.ships.isAlive(w); t++) run.step();
        expect(run.ships.isMoored(run.m)).toBe(true);
        expect(run.ships.isAlive(w)).toBe(false);
        expect(rockModules()).toBeLessThan(lodged);
    }, 300_000);
});

describe("a ship stuck on rock", () => {
    /** Run until the Dinky lodges on the rock, or two minutes pass. */
    const lodge = (run: ReturnType<typeof scene>): void => {
        for (let t = 0; t < 120 * 60 && run.ships.body(run.w) !== run.ships.body(run.a); t++) run.step();
    };

    it("lodges once it has lain still against it, though it is still flown", () => {
        const run = scene(false, true);
        lodge(run);
        expect(run.ships.body(run.w)).toBe(run.ships.body(run.a));
        expect(run.ships.hasControl(run.w)).toBe(true);
        expect(run.world.bodies.pinned[run.world.bodies.indexOf(run.ships.body(run.a))]).toBe(1);
    });

    it("is taken apart by an enemy's robots on the rock, though it could still fight", () => {
        // Nose up, so it comes to rest on its tail rather than grinding its gun on the rock.
        const run = scene(true, true, 1, false, Math.PI / 2);
        /** The Dinky's modules on its body, wherever it now is. */
        const own = (): number[] => {
            const design = run.ships.currentStructure(run.w);
            return design.modules.flatMap((_, m) => (originOf(design, m).design === run.dinky ? [m] : []));
        };
        // Its rounds topped up and its hurts mended, so the Replicator's guns cannot put
        // it out of the fight: only robots taking it apart can.
        const step = (): void => {
            const b = run.world.bodies.indexOf(run.ships.body(run.w));
            for (const m of own()) {
                run.ships.metal.add(b, m, 1e9);
                run.ships.damage.repair(b, m, 1e12);
            }
            run.step();
        };
        for (let t = 0; t < 120 * 60 && run.ships.body(run.w) !== run.ships.body(run.a); t++) step();
        expect(run.ships.body(run.w)).toBe(run.ships.body(run.a));
        const lodged = own().length;
        let fitWhenStarted: boolean | null = null;
        for (let t = 0; t < 900 * 60 && run.ships.isAlive(run.w); t++) {
            const fit = run.ships.hasControl(run.w) && !run.ships.isMissionKilled(run.w);
            step();
            if (fitWhenStarted === null && own().length < lodged) fitWhenStarted = fit;
        }
        expect(run.ships.isMoored(run.m)).toBe(true);
        expect(fitWhenStarted).toBe(true);
    }, 300_000);

    it("is left by a friend's robots while it can fight, and taken once it cannot", () => {
        const armed = scene(true, true, 0);
        lodge(armed);
        for (let t = 0; t < 900 * 60; t++) armed.step();
        expect(armed.ships.isMoored(armed.m)).toBe(true);
        expect(armed.ships.isAlive(armed.w)).toBe(true);

        const spent = scene(true, true, 0, true);
        lodge(spent);
        expect(spent.ships.isMissionKilled(spent.w)).toBe(true);
        for (let t = 0; t < 900 * 60 && spent.ships.isAlive(spent.w); t++) spent.step();
        expect(spent.ships.isAlive(spent.w)).toBe(false);
    }, 600_000);
});
