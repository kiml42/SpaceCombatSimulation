import { expect, it } from "vitest";
import { asteroidBlueprint, compileBlueprint, DAMAGE_ENERGY_PER_KG, NEUTRAL_TEAM, RAGGED_INTEGRITY } from "../sim/index.js";
import { Rng } from "../sim/rng.js";
import { makeBattle } from "../scenarios/battle.js";
import { CORVETTE, GUNSHIP } from "../scenarios/blueprints.js";

/** A corvette with a torn stern backed slowly on to a rock, so the two weld into one body, and a gunship at (`gx`, 300). */
function stuck(gx: number) {
    return makeBattle({ seed: 1, projectiles: 256 }, (ships, world) => {
        const rock = asteroidBlueprint("Rock", { radius: 120, kernel: false, ore: 0.1, ice: 0.1 }, new Rng(2));
        ships.spawn(world, { design: compileBlueprint(rock), x: 0, y: 0, team: NEUTRAL_TEAM });
        const design = compileBlueprint(CORVETTE);
        const tail = design.modules.reduce((least, m) => Math.min(least, m.x - m.spec.length / 2), Infinity);
        const stern = design.modules.findIndex((m) => m.x - m.spec.length / 2 === tail);
        const corvette = ships.spawn(world, { design, x: 123 - tail, y: 0, angle: 0, vx: -0.5, team: 0 });
        const body = world.bodies.indexOf(ships.body(corvette));
        ships.damage.absorb(body, stern, design.modules[stern]!.stats.hitPoints * DAMAGE_ENERGY_PER_KG * (1 - RAGGED_INTEGRITY * 0.5));
        const gunship = ships.spawn(world, { design: compileBlueprint(GUNSHIP), x: gx, y: 300, team: 1 });
        return { corvette, gunship };
    });
}

/** Joules the gunship lands on the corvette's own modules, and on anything else, over `seconds`. */
function fight(run: ReturnType<typeof stuck>, seconds: number): { onShip: number; elsewhere: number } {
    const bodies = run.world.bodies;
    let onShip = 0;
    let elsewhere = 0;
    for (let t = 0; t < seconds * 60; t++) {
        run.step();
        const c = run.credit;
        for (let k = 0; k < c.count; k++) {
            if (c.attacker[k] !== bodies.indexOf(run.ships.body(run.gunship))) continue;
            if (run.ships.pilotAt(c.victim[k]!, c.module[k]!) === run.corvette) onShip += c.energy[k]!;
            else elsewhere += c.energy[k]!;
        }
    }
    return { onShip, elsewhere };
}

it("shoots an enemy stuck to a rock, not the rock", () => {
    const run = stuck(1500);
    for (let t = 0; t < 120; t++) run.step();
    expect(run.world.bodies.indexOf(run.ships.body(run.corvette))).toBe(run.world.bodies.indexOf(run.ships.body(0)));
    fight(run, 60);
    expect(run.ships.hasControl(run.corvette)).toBe(false);
});

it("holds fire on an enemy stuck to the far side of a rock", () => {
    const run = stuck(-1500);
    const { elsewhere } = fight(run, 60);
    expect(elsewhere).toBeLessThan(20e6);
});

it("fires only with its barrel on the stuck ship, not anywhere on the rock", () => {
    const run = stuck(1500);
    const bodies = run.world.bodies;
    const p = run.projectiles;
    const at = { x: 0, y: 0, vx: 0, vy: 0, radius: 0 };
    const seen = new Set<string>();
    let rounds = 0;
    let wide = 0;
    for (let t = 0; t < 60 * 60; t++) {
        run.step();
        const gunship = bodies.indexOf(run.ships.body(run.gunship));
        run.ships.locate(bodies, run.corvette, bodies.indexOf(run.ships.body(run.corvette)), at);
        for (let q = 0; q < p.alive.length; q++) {
            if (p.alive[q] !== 1 || p.fragment[q] === 1 || p.owner[q] !== gunship) continue;
            const key = `${q} ${p.startX[q]} ${p.startY[q]}`;
            if (seen.has(key)) continue;
            seen.add(key);
            // How far its line, relative to the ship, passes from the ship's middle.
            const vx = p.vx[q]! - at.vx;
            const vy = p.vy[q]! - at.vy;
            const miss = Math.abs(vx * (at.y - p.startY[q]!) - vy * (at.x - p.startX[q]!)) / Math.hypot(vx, vy);
            rounds++;
            // A bounding circle is not a silhouette: a round grazing its edge can still land on a module.
            if (miss > at.radius * 1.25) wide++;
        }
    }
    expect(rounds).toBeGreaterThan(10);
    // Fired once the barrel was anywhere on the rock, a fifth of them went wide of the ship.
    expect(wide).toBe(0);
});
