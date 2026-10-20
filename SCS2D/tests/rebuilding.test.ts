import { describe, expect, it } from 'vitest';
import {
  compileBlueprint,
  DAMAGE_ENERGY_PER_KG,
  DamageEffect,
  ROBOT_BUILD_TIME,
  joints,
  moduleStats,
  type Blueprint,
  type ShipDesign,
} from '../sim/index.js';
import { faceToward, fittingOf, SHELL_STEPS, shellOf } from '../sim/rebuild.js';
import { moduleOutline, type ModuleSpec } from '../sim/modules.js';
import { polygonArea } from '../sim/shape.js';
import { makeBattle } from '../scenarios/battle.js';
import { CATAMARAN } from '../scenarios/blueprints.js';

/** Robots rebuilding what their ship has lost (ROADMAP.md §8, repair stage 5). */

/** A core, a spine, a bay with a hold and a battery beside it, a fin off the hold, and an engine off the bay. */
const BUILDER: Blueprint = {
  name: 'Builder',
  modules: [
    { kind: 'core', x: 0, y: 0, length: 3, width: 3 },
    { kind: 'structure', x: 4, y: 0, length: 5, width: 3 },
    { kind: 'structure', x: 9, y: 0, length: 5, width: 3 },
    { kind: 'robotBay', x: 13.5, y: 0, length: 4, width: 4 },
    { kind: 'hold', x: 13.5, y: 3.5, length: 4, width: 3 },
    { kind: 'battery', x: 13.5, y: -3.5, length: 4, width: 3 },
    { kind: 'structure', x: 13.5, y: 6.5, length: 4, width: 3 },
    { kind: 'engine', x: 15.5, y: 0, angle: 0, length: 2, width: 2 },
  ],
};
const builder = compileBlueprint(BUILDER);
const of = (kind: string, n = 0): number => builder.modules.map((m, k) => (m.spec.kind === kind ? k : -1)).filter((k) => k >= 0)[n]!;
const HOLD = of('hold');
const BAY = of('robotBay');
const FIN = of('structure', 2);
const ENGINE = of('engine');

type Run = ReturnType<typeof makeBattle<{ a: number }>>;
function scene(vx = 0, angularVel = 0): Run {
  return makeBattle({ seed: 1, pilots: false }, (ships, world) => ({
    a: ships.spawn(world, { design: builder, x: 0, y: 0, angle: 0, vx, angularVel }),
  }));
}
const body = (run: Run): number => run.world.bodies.indexOf(run.ships.body(run.a));
const hull = (run: Run): ShipDesign => run.ships.currentStructure(run.a);
/** The module of the hull that is module `m` of the design it set out as, or -1. */
const find = (run: Run, m: number): number =>
  hull(run).modules.findIndex((module, k) => (module.origin?.design ?? hull(run)) === builder && (module.origin?.module ?? k) === m);

/** Cut module `m` away from module `from`, and take what came off out of the way. */
function lose(run: Run, m: number, from: number): void {
  const b = body(run);
  const all = joints(hull(run));
  const k = all.findIndex((j) => (j.a === m && j.b === from) || (j.a === from && j.b === m));
  run.ships.damage.cutWeld(b, k, all[k]!.width * 2);
  run.step();
  for (let j = 0; j < run.world.bodies.highWater; j++) {
    if (j !== body(run) && run.world.bodies.alive[j] === 1) run.world.bodies.x[j] = run.world.bodies.x[j]! + 500;
  }
}

/** Everything the world holds, kg, with what it has thrown away. */
function matter(run: Run): number {
  let kg = run.ships.discarded;
  for (let j = 0; j < run.world.bodies.highWater; j++) if (run.world.bodies.alive[j] === 1) kg += run.world.bodies.mass[j]!;
  return kg;
}

function runUntil(run: Run, done: () => boolean, seconds: number): number {
  let s = 0;
  for (; s < seconds * 60 && !done(); s++) run.step();
  return s / 60;
}

describe('a shell', () => {
  const box: ModuleSpec = { kind: 'structure', x: 2, y: 1, length: 4, width: 2, angle: 0.3 };
  const stats = moduleStats(box);

  it('grows across a box from the face it is built against', () => {
    const corners: number[] = [];
    moduleOutline(box, corners);
    for (let face = 0; face < 4; face++) {
      const part = shellOf(box, stats, face, 0.25);
      const inner: number[] = [];
      moduleOutline(part.spec, inner);
      expect(polygonArea(inner)).toBeCloseTo(polygonArea(corners) * 0.25, 9);
      // The face itself is laid down whole.
      const a = [corners[face * 2]!, corners[face * 2 + 1]!];
      const b = [corners[((face + 1) % 4) * 2]!, corners[((face + 1) % 4) * 2 + 1]!];
      for (const [x, y] of [a, b]) {
        let near = Infinity;
        for (let k = 0; k < 8; k += 2) near = Math.min(near, Math.hypot(inner[k]! - x!, inner[k + 1]! - y!));
        expect(near).toBeLessThan(1e-9);
      }
      expect(part.stats.mass).toBeCloseTo(stats.structureMass * 0.25, 9);
      expect(part.stats.fittingMass).toBe(0);
    }
  });

  it('grows across a triangle as a triangle on the same face', () => {
    const wedge: ModuleSpec = { kind: 'structure', x: 0, y: 0, length: 3, width: 3, vertices: [2, 0, -1, 1.5, -1, -1.5] };
    const corners: number[] = [];
    moduleOutline(wedge, corners);
    const part = shellOf(wedge, moduleStats(wedge), 1, 0.5);
    const inner: number[] = [];
    expect(moduleOutline(part.spec, inner)).toBe(3);
    expect(polygonArea(inner)).toBeCloseTo(polygonArea(corners) * 0.5, 9);
  });

  it('starts from the face that touches what it is built against', () => {
    const fin = builder.modules[FIN]!.spec;
    const hold = builder.modules[HOLD]!.spec;
    const part = shellOf(fin, builder.modules[FIN]!.stats, faceToward(fin, hold), 1 / SHELL_STEPS);
    expect(part.spec.y - part.spec.width / 2).toBeCloseTo(hold.y + hold.width / 2, 9);
  });
});

describe('robots rebuilding', () => {
  it('build a lost module back against what is left of the hull, walls first, from metal in its hold', { timeout: 60_000 }, () => {
    const run = scene();
    lose(run, FIN, HOLD);
    expect(find(run, FIN)).toBe(-1);
    const before = matter(run);
    const discarded = run.ships.discarded;
    let steps = -1;
    let shareSeen = 0;
    const seconds = runUntil(
      run,
      () => {
        const at = find(run, FIN);
        const shell = at >= 0 ? hull(run).modules[at]!.shell : undefined;
        if (shell !== undefined) {
          // A step at a time, never shrinking.
          expect(shell.share).toBeGreaterThanOrEqual(shareSeen);
          shareSeen = shell.share;
          steps++;
        }
        return at >= 0 && shell === undefined;
      },
      600,
    );
    const at = find(run, FIN);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(shareSeen).toBeCloseTo(1 - 1 / SHELL_STEPS, 9);
    // Back where it was, the size it was.
    const rebuilt = hull(run).modules[at]!;
    expect(rebuilt.spec).toBe(builder.modules[FIN]!.spec);
    // No sooner than the robots could have put its walls up.
    const robots = builder.modules[BAY]!.stats.robots;
    const wall = builder.modules[FIN]!.stats.structureMass;
    expect(seconds).toBeGreaterThan(wall / (50 * robots));
    // Nothing made from nothing: what went in came out of the hold, and a tenth more was lost.
    expect(matter(run)).toBeCloseTo(before, 3);
    expect(run.ships.discarded - discarded).toBeCloseTo(wall * 0.1, 3);
  });

  it('leave a bay building a robot as far through it as it was, however often the hull is remade', { timeout: 60_000 }, () => {
    const run = scene();
    const berths = builder.modules[BAY]!.stats.robots;
    run.ships.robots.lose(body(run), 0);
    lose(run, FIN, HOLD);
    const count = (): number => run.ships.robots.on(body(run))!.length;
    const seconds = runUntil(run, () => count() === berths, 120);
    expect(count()).toBe(berths);
    // The fin's walls went up a step at a time meanwhile, each a remade hull.
    expect(seconds).toBeLessThan(ROBOT_BUILD_TIME + 2);
  });

  it('keep the momentum of a hull growing as it moves and turns', { timeout: 60_000 }, () => {
    const run = scene(3, 0.02);
    lose(run, FIN, HOLD);
    const momentum = (): [number, number] => {
      const bodies = run.world.bodies;
      const b = body(run);
      return [bodies.mass[b]! * bodies.vx[b]! + run.ships.discardedPx, bodies.mass[b]! * bodies.vy[b]! + run.ships.discardedPy];
    };
    const [px, py] = momentum();
    runUntil(run, () => find(run, FIN) >= 0 && hull(run).modules[find(run, FIN)]!.shell === undefined, 600);
    expect(find(run, FIN)).toBeGreaterThanOrEqual(0);
    const [qx, qy] = momentum();
    expect(qx).toBeCloseTo(px, 3);
    expect(qy).toBeCloseTo(py, 3);
  });

  it('fit out a module after its walls are up, and only then does it work', { timeout: 120_000 }, () => {
    const run = scene();
    lose(run, ENGINE, BAY);
    const engines = (): number => hull(run).engines.length;
    expect(engines()).toBe(0);
    runUntil(run, () => find(run, ENGINE) >= 0 && hull(run).modules[find(run, ENGINE)]!.shell === undefined, 600);
    const at = find(run, ENGINE);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(engines()).toBe(1);
    const fitting = fittingOf(builder.modules[ENGINE]!.stats);
    expect(run.ships.damage.unbuiltAt(body(run), at)).toBeCloseTo(fitting, 6);
    expect(run.ships.damage.remaining(body(run), at, DamageEffect.Thrust)).toBe(0);
    runUntil(run, () => !(run.ships.damage.unbuiltAt(body(run), at) > 0), 600);
    expect(run.ships.damage.unbuiltAt(body(run), at)).toBe(0);
    expect(run.ships.damage.remaining(body(run), at, DamageEffect.Thrust)).toBe(1);
  });

  it('build from what their ship keeps back for itself', { timeout: 60_000 }, () => {
    // Keeping back every kilogram and joule it holds.
    const hoarder = compileBlueprint({
      ...BUILDER,
      doctrine: { ...builder.doctrine, approach: { ...builder.doctrine.approach, rearmBelow: 1, rechargeBelow: 1 } },
    });
    const run = makeBattle({ seed: 1, pilots: false }, (ships, world) => ({
      a: ships.spawn(world, { design: hoarder, x: 0, y: 0, angle: 0 }),
    }));
    const b = (): number => run.world.bodies.indexOf(run.ships.body(run.a));
    for (const robot of run.ships.robots.on(b())!) robot.charge = 0;
    lose(run, FIN, HOLD);
    const hull2 = (): ShipDesign => run.ships.currentStructure(run.a);
    const rebuilt = (): boolean =>
      hull2().modules.some((m) => m.origin?.design === hoarder && m.origin.module === FIN && m.shell === undefined);
    runUntil(run, rebuilt, 600);
    expect(rebuilt()).toBe(true);
  });

  it('mend a shell that is hit before building any more of it', { timeout: 60_000 }, () => {
    const run = scene();
    lose(run, FIN, HOLD);
    runUntil(run, () => find(run, FIN) >= 0, 600);
    const at = find(run, FIN);
    const share = hull(run).modules[at]!.shell!.share;
    const capacity = hull(run).modules[at]!.stats.hitPoints * DAMAGE_ENERGY_PER_KG;
    run.ships.damage.absorb(body(run), at, capacity * 0.5);
    runUntil(run, () => hull(run).modules[at]!.shell?.share !== share, 600);
    expect(run.ships.damage.absorbedAt(body(run), at)).toBe(0);
  });

  it('wait while something is in the way', { timeout: 60_000 }, () => {
    const run = scene();
    const b = body(run);
    const all = joints(hull(run));
    const k = all.findIndex((j) => (j.a === FIN && j.b === HOLD) || (j.a === HOLD && j.b === FIN));
    run.ships.damage.cutWeld(b, k, all[k]!.width * 2);
    run.step();
    // The fin that came off is still where it was.
    runUntil(run, () => false, 120);
    expect(find(run, FIN)).toBe(-1);
    // Anything hurt meanwhile is mended, though nothing is built.
    const core = builder.cores[0]!;
    run.ships.damage.absorb(body(run), core, builder.modules[core]!.stats.hitPoints * DAMAGE_ENERGY_PER_KG * 0.3);
    runUntil(run, () => !(run.ships.damage.absorbedAt(body(run), core) > 0), 300);
    expect(run.ships.damage.absorbedAt(body(run), core)).toBe(0);
    expect(find(run, FIN)).toBe(-1);
    for (let j = 0; j < run.world.bodies.highWater; j++) {
      if (j !== body(run) && run.world.bodies.alive[j] === 1) run.world.bodies.x[j] = run.world.bodies.x[j]! + 500;
    }
    runUntil(run, () => find(run, FIN) >= 0, 120);
    expect(find(run, FIN)).toBeGreaterThanOrEqual(0);
  });

  it('grow both halves of a catamaran cut in two back into the whole ship', { timeout: 120_000 }, () => {
    // Flown, for the power its generators make, but not escorting: the halves
    // burn their fuel keeping station long before they are whole.
    const catamaran = compileBlueprint({
      ...CATAMARAN,
      doctrine: { ...CATAMARAN.doctrine!, targeting: { ...CATAMARAN.doctrine!.targeting, escortWeight: 0 } },
    });
    const run = makeBattle({ seed: 1 }, (ships, world) => ({ a: ships.spawn(world, { design: catamaran, x: 0, y: 0, angle: 0 }) }));
    const all = joints(catamaran);
    const mid = all.findIndex((j) => Math.abs(catamaran.modules[j.a]!.spec.y) < 3 && Math.abs(catamaran.modules[j.b]!.spec.y) < 3);
    run.ships.damage.cutWeld(body(run), mid, all[mid]!.width * 2);
    run.step();
    expect(run.ships.count).toBe(2);
    const other = run.world.bodies.indexOf(run.ships.body(1));
    run.world.bodies.y[other] = run.world.bodies.y[other]! - 200;
    const whole = (i: number): boolean => {
      const hull = run.ships.currentStructure(i);
      const b = run.world.bodies.indexOf(run.ships.body(i));
      return (
        hull.modules.length === catamaran.modules.length &&
        hull.modules.every((m, k) => m.shell === undefined && !(run.ships.damage.unbuiltAt(b, k) > 0))
      );
    };
    runUntil(run, () => whole(0) && whole(1), 6000);
    expect(whole(0)).toBe(true);
    expect(whole(1)).toBe(true);
    expect(run.ships.currentStructure(0).cores.length).toBe(2);
    // Each named for the core it kept, its cores numbered as the ship it came of numbered them.
    expect([run.ships.nameOf(0), run.ships.nameOf(1)].sort()).toEqual(['1.1', '1.2']);
    for (const i of [0, 1]) {
      const numbers: number[] = [];
      run.ships.coreNumbers(i, numbers);
      expect(numbers.slice().sort()).toEqual([1, 2]);
    }
  });
});
