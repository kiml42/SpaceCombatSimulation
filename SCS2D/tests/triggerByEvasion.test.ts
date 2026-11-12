import { describe, expect, it } from "vitest";
import { compileBlueprint, DAMAGE_ENERGY_PER_KG, math } from "../sim/index.js";
import { ASPECT_STEPS, aspectAlong, reachAgainst } from "../sim/blueprint.js";
import { makeBattle } from "../scenarios/battle.js";
import { CORVETTE, RAIL_GUNSHIP } from "../scenarios/blueprints.js";

/**
 * A Rail Gunship firing at a corvette lying dead in space well off its bow, at `share` of
 * its rail gun's reach: how far each round's line passes from the corvette's
 * middle, as a share of its radius.
 */
function misses(share: number): number[] {
    const sniper = compileBlueprint(RAIL_GUNSHIP);
    const target = compileBlueprint(CORVETTE);
    const rail = sniper.turrets.find((t) => sniper.modules[t.module]!.spec.kind === "railGun")!;
    const range = share * reachAgainst(rail.gun, target.radius);
    const run = makeBattle({ seed: 1 }, (ships, world) => {
        const sniperShip = ships.spawn(world, { design: sniper, x: 0, y: 0, angle: 0, team: 0 });
        // Well off its bow, so the gun swings on to it and the edge comes under it first.
        const targetShip = ships.spawn(world, {
            design: target,
            x: range * math.cos(OFF_BOW),
            y: range * math.sin(OFF_BOW),
            angle: 0,
            team: 1,
        });
        // Its engines out, so it lies still and every miss is the trigger's.
        const body = world.bodies.indexOf(ships.body(targetShip));
        target.modules.forEach((m, k) => {
            if (m.spec.kind === "engine") ships.damage.absorb(body, k, m.stats.hitPoints * DAMAGE_ENERGY_PER_KG);
        });
        return { sniper: sniperShip, target: targetShip };
    });
    const bodies = run.world.bodies;
    const p = run.projectiles;
    const seen = new Set<string>();
    const out: number[] = [];
    for (let t = 0; t < 60 * 60; t++) {
        run.step();
        const own = bodies.indexOf(run.ships.body(run.sniper));
        const tb = bodies.indexOf(run.ships.body(run.target));
        if (tb < 0) break;
        for (let q = 0; q < p.alive.length; q++) {
            if (p.alive[q] !== 1 || p.fragment[q] === 1 || p.owner[q] !== own) continue;
            // The rail gun's own rounds, not its secondaries'.
            if (Math.abs(p.mass[q]! - rail.gun.roundMass) > 1e-6 * rail.gun.roundMass) continue;
            const key = `${q} ${p.startX[q]} ${p.startY[q]}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const vx = p.vx[q]! - bodies.vx[tb]!;
            const vy = p.vy[q]! - bodies.vy[tb]!;
            const dx = bodies.x[tb]! - p.startX[q]!;
            const dy = bodies.y[tb]! - p.startY[q]!;
            out.push(Math.abs(vx * dy - vy * dx) / Math.hypot(vx, vy) / target.radius);
        }
    }
    return out;
}

const OFF_BOW = 1;

describe("a gun's trigger at long range", () => {
    it("waits for the middle of a target near its reach, rather than firing once the edge is under it", () => {
        const far = misses(0.85);
        expect(far.length).toBeGreaterThan(0);
        // At 85% of reach the target may jink 72% of its radius in the flight, so only the middle 28% will do.
        for (const miss of far) expect(miss).toBeLessThan(0.4);
    });

    it("still fires anywhere on the target close in", () => {
        expect(misses(0.2).length).toBeGreaterThan(0);
    });
});

describe("a ship's presented aspect", () => {
    // A long thin ship along its bow: 40 m by 4 m, the core aft so its centre of mass is off the middle.
    const design = compileBlueprint({
        name: "Needle",
        modules: [
            { kind: "core", x: -18, y: 0, length: 4, width: 4 },
            { kind: "structure", x: 2, y: 0, length: 36, width: 4 },
        ],
    });
    const out = { near: 0, far: 0 };

    it("is its width seen end on, and its length seen broadside", () => {
        aspectAlong(design, 0, out);
        expect(out.far - out.near).toBeCloseTo(4, 6);
        aspectAlong(design, math.PI / 2, out);
        expect(out.far - out.near).toBeCloseTo(40, 6);
    });

    it("measures each edge from the centre of mass, so a lopsided ship is lopsided", () => {
        aspectAlong(design, math.PI / 2, out);
        // Seen broadside, "across" points aft; the core pulls the centre of mass aft, so the bow is further from it.
        expect(-out.near).toBeGreaterThan(out.far);
        expect(out.far - out.near).toBeCloseTo(40, 6);
    });

    it("interpolates between the bearings it was tabulated at", () => {
        const step = (2 * math.PI) / ASPECT_STEPS;
        aspectAlong(design, step * 0.5, out);
        const half = out.far - out.near;
        aspectAlong(design, 0, out);
        const at0 = out.far - out.near;
        aspectAlong(design, step, out);
        expect(half).toBeCloseTo((at0 + out.far - out.near) / 2, 9);
    });
});
