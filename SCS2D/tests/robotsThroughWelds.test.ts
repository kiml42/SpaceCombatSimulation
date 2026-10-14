import { describe, expect, it } from 'vitest';
import { compileBlueprint, DAMAGE_ENERGY_PER_KG, ROBOT_SPEED } from '../sim/index.js';
import type { Robot } from '../sim/robots.js';
import { makeBattle } from '../scenarios/battle.js';
import { MENDER } from '../scenarios/mending.js';
import { LEECH } from '../scenarios/salvage.js';

/** A battered Mender with its robots out, and a torn hulk drifting into its bow to weld on. */
function setup(gap = 0) {
  const mender = compileBlueprint(MENDER);
  const leech = compileBlueprint(LEECH);
  return makeBattle({ seed: 1 }, (ships, world) => {
    const a = ships.spawn(world, { design: mender, x: 0, y: 0, angle: 0, team: 0 });
    const body = world.bodies.indexOf(ships.body(a));
    for (let m = 0; m < mender.modules.length; m++) {
      const module = mender.modules[m]!;
      if (module.spec.kind === 'robotBay') continue;
      ships.damage.absorb(body, m, module.stats.hitPoints * DAMAGE_ENERGY_PER_KG * (module.spec.kind === 'core' ? 0.3 : 0.5));
    }
    const offset = mender.modules[0]!.x - mender.radius - leech.radius - gap;
    const b = ships.spawn(world, { design: leech, x: offset, y: 0, angle: 0, vx: 1, team: 1 });
    const hulk = world.bodies.indexOf(ships.body(b));
    for (let m = 0; m < leech.modules.length; m++) {
      ships.damage.absorb(hulk, m, leech.modules[m]!.stats.hitPoints * DAMAGE_ENERGY_PER_KG * 0.95);
    }
    return { a, b };
  });
}

describe('robots through a weld', () => {
  it.each([0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30])('carry on where they were when something welds onto their hull, %i m off', { timeout: 60_000 }, (gap) => {
    const run = setup(gap);
    const robotsOf = (): Robot[] =>
      (run.ships as unknown as { robots: { on(b: number): Robot[] | null } }).robots.on(run.world.bodies.indexOf(run.ships.body(run.a))) ?? [];
    /** Where a robot is in the world, as the view draws it. */
    const where = (robot: Robot): [number, number] => {
      const design = run.ships.design(run.a);
      const b = run.world.bodies.indexOf(run.ships.body(run.a));
      const here = design.modules[robot.at]!;
      let x = here.x;
      let y = here.y;
      if (robot.path !== null && robot.leg < robot.path.length - 1) {
        const there = design.modules[robot.path[robot.leg + 1]!]!;
        const leg = Math.hypot(there.x - here.x, there.y - here.y);
        const t = leg > 0 ? robot.along / leg : 0;
        x += (there.x - here.x) * t;
        y += (there.y - here.y) * t;
      }
      const c = Math.cos(run.world.bodies.angle[b]!);
      const s = Math.sin(run.world.bodies.angle[b]!);
      return [run.world.bodies.x[b]! + x * c - y * s, run.world.bodies.y[b]! + x * s + y * c];
    };
    const modules = (): number => run.ships.design(run.a).modules.length;
    const before = modules();
    let welded = false;
    for (let s = 0; s < 120 * 60 && !welded; s++) {
      const out = robotsOf().filter((r) => r.mode !== 0);
      const was = out.map(where);
      const doing = out.map((r) => [r.mode, r.target]);
      run.step();
      if (modules() === before) continue;
      welded = true;
      expect(out.length).toBeGreaterThan(0);
      out.forEach((robot, k) => {
        const [x, y] = where(robot);
        const moved = Math.hypot(x - was[k]![0], y - was[k]![1]);
        // No further than it crawls in a step, and the hull drifts.
        expect(moved).toBeLessThan(ROBOT_SPEED / 60 + 0.1);
        // And still about what it was about, rather than sent home.
        expect([robot.mode, robot.target]).toEqual(doing[k]);
      });
    }
    expect(welded).toBe(true);
  });
});
