import { describe, expect, it } from 'vitest';
import { compileBlueprint, DAMAGE_ENERGY_PER_KG, joints, RAGGED_INTEGRITY } from '../sim/index.js';
import { makeBattle } from '../scenarios/battle.js';
import { capture, Snapshot } from '../sim/snapshot.js';
import { CATAMARAN, CORVETTE, DINKY } from '../scenarios/blueprints.js';

/**
 * Torn hulls of three sides drifting into each other, hooking, and being cut
 * apart again, for long enough that bodies end up carrying several ships.
 * Checks the books that sharing a body could get wrong.
 */

const designs = [compileBlueprint(CORVETTE), compileBlueprint(DINKY), compileBlueprint(CATAMARAN)];

function soak(seed: number, pilots: boolean) {
  let r = seed * 9301 + 49297;
  const rand = (): number => (r = (r * 9301 + 49297) % 233280) / 233280;
  return {
    rand,
    run: makeBattle({ seed, pilots }, (ships, world) => {
      for (let k = 0; k < 8; k++) {
        const d = designs[Math.floor(rand() * 3)]!;
        const e = designs[Math.floor(rand() * 3)]!;
        const x = (k % 4) * 400 - 600 + (rand() - 0.5) * 30;
        const y = Math.floor(k / 4) * 60 + (rand() - 0.5) * 20;
        const gap = d.radius + e.radius + 1;
        const closing = 0.3 + rand();
        const vy = (k < 4 ? 0.3 : -0.3) * rand();
        const pair = [
          ships.spawn(world, { design: d, x: x - gap / 2, y, angle: rand() * 6, vx: closing / 2, vy, team: k % 2 }),
          ships.spawn(world, { design: e, x: x + gap / 2, y, angle: rand() * 6, vx: -closing / 2, vy, team: (k + 1) % 3 }),
        ];
        for (const ship of pair) {
          const body = world.bodies.indexOf(ships.body(ship));
          ships.design(ship).modules.forEach((module, m) => {
            if (rand() < 0.6) {
              ships.damage.absorb(body, m, module.stats.hitPoints * DAMAGE_ENERGY_PER_KG * (1 - RAGGED_INTEGRITY * rand()));
            }
          });
        }
      }
      return {};
    }),
  };
}

describe('hulls hooking and parting at length', () => {
  for (const [seed, pilots] of [[1, false], [3, false], [2, true], [10, true]] as const) {
    it(`keeps its books, seed ${seed}${pilots ? ', flown' : ''}`, () => {
      const { run, rand } = soak(seed, pilots);
      const { ships, world } = run;
      const momentum = (): [number, number] => {
        const b = world.bodies;
        let x = ships.discardedPx;
        let y = ships.discardedPy;
        for (let i = 0; i < b.highWater; i++) {
          if (b.alive[i] === 0) continue;
          x += b.mass[i]! * b.vx[i]!;
          y += b.mass[i]! * b.vy[i]!;
        }
        return [x, y];
      };
      run.step();
      const before = momentum();
      const snapshot = new Snapshot();
      let shared = 0;
      for (let s = 0; s < 4000; s++) {
        run.step();
        // Now and then, cut a seam through.
        if (s % 200 === 100) {
          for (let i = 0; i < ships.highWater; i++) {
            if (!ships.isAlive(i)) continue;
            const all = joints(ships.design(i));
            const k = all.findIndex((joint) => joint.seam === true);
            if (k >= 0 && rand() < 0.3) ships.damage.cutWeld(world.bodies.indexOf(ships.body(i)), k, all[k]!.width * 2);
          }
        }
        if (s % 50 !== 0) continue;
        // Every module drawn once, and one set of mounts per body.
        capture(snapshot, world, ships, run.projectiles, run.beams);
        const drawn = new Map<number, number[]>();
        for (let v = 0; v < snapshot.shipCount; v++) {
          const view = snapshot.ships[v]!;
          const counts = drawn.get(view.body) ?? new Array<number>(view.design.modules.length).fill(0);
          view.drawn!.forEach((d, m) => (counts[m]! += d ? 1 : 0));
          drawn.set(view.body, counts);
        }
        for (const counts of drawn.values()) expect(counts.every((n) => n === 1)).toBe(true);
        const bodies = new Set<number>();
        let mounts = 0;
        for (let i = 0; i < ships.highWater; i++) {
          if (!ships.isAlive(i)) continue;
          const b = world.bodies.indexOf(ships.body(i));
          expect(b).toBeGreaterThanOrEqual(0);
          if (bodies.has(b)) {
            shared++;
            continue;
          }
          bodies.add(b);
          mounts += ships.design(i).turrets.length;
        }
        expect(ships.turrets.count).toBe(mounts);
      }
      expect(run.totalWelded).toBeGreaterThan(0);
      expect(shared).toBeGreaterThan(0);
      // Pilots push; without them only contacts act, and those trade momentum.
      if (!pilots) {
        const after = momentum();
        expect(after[0]).toBeCloseTo(before[0], 3);
        expect(after[1]).toBeCloseTo(before[1], 3);
      }
    });
  }
});
