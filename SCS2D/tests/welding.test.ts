import { describe, expect, it } from 'vitest';
import {
  compileBlueprint,
  DAMAGE_ENERGY_PER_KG,
  Damage,
  DamageEffect,
  joints,
  RAGGED_INTEGRITY,
  subDesign,
  weldDesigns,
  type ShipDesign,
  type Ships,
} from '../sim/index.js';
import { makeBattle } from '../scenarios/battle.js';
import { CORVETTE, DINKY } from '../scenarios/blueprints.js';
import type { World } from '../sim/world.js';

/**
 * Ragged hulls hooking together on a slow contact (DESIGN.md §4), and what a
 * ship can still command once its own hull is torn.
 */

const corvette = compileBlueprint(CORVETTE);
const dinky = compileBlueprint(DINKY);

/** Bring a module down to this integrity, 1 whole and 0 spent. */
function wear(ships: Ships, world: World, ship: number, module: number, integrity: number): void {
  const body = world.bodies.indexOf(ships.body(ship));
  const capacity = ships.design(ship).modules[module]!.stats.hitPoints * DAMAGE_ENERGY_PER_KG;
  ships.damage.absorb(body, module, capacity * (1 - integrity) - ships.damage.absorbedAt(body, module));
}

/** Knock out every core, leaving the hull a wreck. */
function wreck(ships: Ships, world: World, ship: number): void {
  for (const core of ships.design(ship).cores) wear(ships, world, ship, core, 0.3);
}

/** Tear every module open, so wherever the contact lands it lands on ragged metal. */
function tear(ships: Ships, world: World, ship: number): void {
  const design = ships.design(ship);
  for (let m = 0; m < design.modules.length; m++) {
    if (design.modules[m]!.spec.kind === 'core') continue;
    wear(ships, world, ship, m, RAGGED_INTEGRITY * 0.5);
  }
}

function totals(world: World): { mass: number; px: number; py: number; l: number } {
  const b = world.bodies;
  let mass = 0;
  let px = 0;
  let py = 0;
  let l = 0;
  for (let i = 0; i < b.highWater; i++) {
    if (b.alive[i] === 0) continue;
    mass += b.mass[i]!;
    px += b.mass[i]! * b.vx[i]!;
    py += b.mass[i]! * b.vy[i]!;
    l += b.inertia[i]! * b.angularVel[i]! + b.mass[i]! * (b.x[i]! * b.vy[i]! - b.y[i]! * b.vx[i]!);
  }
  return { mass, px, py, l };
}

/** Two hulls drifting together, nose to nose, at `closing` m/s between them. */
function drift(
  closing: number,
  prepare: (ships: Ships, world: World, a: number, b: number) => void,
): ReturnType<typeof makeBattle<{ a: number; b: number }>> {
  return makeBattle({ seed: 1, pilots: false }, (ships, world) => {
    const gap = corvette.radius * 2 + 2;
    const a = ships.spawn(world, { design: corvette, x: -gap / 2, y: 0, angle: 0, vx: closing / 2, angularVel: 0.01 });
    const b = ships.spawn(world, { design: corvette, x: gap / 2, y: 3, angle: Math.PI, vx: -closing / 2, team: 1 });
    prepare(ships, world, a, b);
    return { a, b };
  });
}

function runUntilWelded(run: ReturnType<typeof drift>, seconds = 60): void {
  for (let s = 0; s < seconds * 60 && run.totalWelded === 0; s++) run.step();
}

describe('welding on a slow contact', () => {
  it('hooks two torn wrecks into one body, conserving mass and momentum', () => {
    const run = drift(1, (ships, world, a, b) => {
      for (const ship of [a, b]) {
        wreck(ships, world, ship);
        tear(ships, world, ship);
      }
    });
    run.step();
    const before = totals(run.world);
    runUntilWelded(run);
    expect(run.totalWelded).toBe(1);
    expect(run.ships.count).toBe(1);
    const after = totals(run.world);
    expect(after.mass).toBeCloseTo(before.mass, 6);
    expect(after.px).toBeCloseTo(before.px, 3);
    expect(after.py).toBeCloseTo(before.py, 3);
    expect(after.l).toBeCloseTo(before.l, 0);
    const design = run.ships.design(run.a);
    expect(design.modules.length).toBe(corvette.modules.length * 2);
    expect(joints(design).filter((joint) => joint.seam === true)).toHaveLength(1);
  });

  it('glances off when the contact is fast', () => {
    const run = drift(12, (ships, world, a, b) => {
      for (const ship of [a, b]) {
        wreck(ships, world, ship);
        tear(ships, world, ship);
      }
    });
    runUntilWelded(run, 20);
    expect(run.totalWelded).toBe(0);
    expect(run.totalContacts).toBeGreaterThan(0);
  });

  it('glances off sound metal, however slow', () => {
    const run = drift(1, (ships, world, a, b) => {
      wreck(ships, world, a);
      wreck(ships, world, b);
    });
    runUntilWelded(run, 30);
    expect(run.totalWelded).toBe(0);
    expect(run.totalContacts).toBeGreaterThan(0);
  });

  it('never joins two ships', () => {
    const run = drift(1, (ships, world, a, b) => {
      tear(ships, world, a);
      tear(ships, world, b);
    });
    runUntilWelded(run, 30);
    expect(run.totalWelded).toBe(0);
  });

  it('leaves two hulks it hooks together no spin to gather', () => {
    // Nobody flies either, but their mounts still swing back to rest, and each
    // step's recoil must be spent once rather than held and added to.
    const run = makeBattle({ seed: 1 }, (ships, world) => {
      const gap = corvette.radius * 2 + 2;
      const a = ships.spawn(world, { design: corvette, x: -gap / 2, y: 0, angle: 0, vx: 0.5 });
      const b = ships.spawn(world, { design: corvette, x: gap / 2, y: 3, angle: Math.PI, vx: -0.5, team: 1 });
      for (const ship of [a, b]) {
        wreck(ships, world, ship);
        tear(ships, world, ship);
        for (let t = 0; t < corvette.turrets.length; t++) ships.turrets.bearing[ships.turretIndexOf(ship, t)] = 2;
      }
      return { a, b };
    });
    for (let s = 0; s < 60 * 60 && run.totalWelded === 0; s++) run.step();
    expect(run.totalWelded).toBe(1);
    for (let s = 0; s < 60 * 30; s++) run.step();
    const body = run.world.bodies.indexOf(run.ships.body(run.a));
    expect(Math.abs(run.world.bodies.angularVel[body]!)).toBeLessThan(1);
  });

  it('lets a ship carry a wreck it hooks, and command nothing on it', () => {
    const run = drift(1, (ships, world, _a, b) => {
      wreck(ships, world, b);
      tear(ships, world, b);
    });
    runUntilWelded(run);
    expect(run.totalWelded).toBe(1);
    const { ships, world } = run;
    expect(ships.hasControl(run.a)).toBe(true);
    const body = world.bodies.indexOf(ships.body(run.a));
    const design = ships.design(run.a);
    const own = corvette.modules.length;
    design.engines.forEach((engine) => {
      const module = engine.module!;
      const left = ships.damage.remaining(body, module, DamageEffect.Thrust);
      if (module < own) expect(left).toBeGreaterThan(0);
      else expect(left).toBe(0);
    });
    design.turrets.forEach((_, t) => {
      if (design.turrets[t]!.module >= own) expect(ships.isTurretDisabled(run.a, t)).toBe(true);
    });
  });
});

describe('command', () => {
  /** A ship's modules, and which of them its cores still command. */
  function commanded(design: ShipDesign, torn: readonly number[]): boolean[] {
    const damage = new Damage();
    damage.register(0, design);
    for (const m of torn) damage.absorb(0, m, design.modules[m]!.stats.hitPoints * DAMAGE_ENERGY_PER_KG * 0.9);
    return design.modules.map((_, m) =>
      design.modules[m]!.spec.kind === 'core' ? true : damage.remaining(0, m, DamageEffect.Thrust) > 0 || damage.remaining(0, m, DamageEffect.FireRate) > 0 || design.modules[m]!.spec.kind === 'structure',
    );
  }

  it('reaches every module of a sound hull', () => {
    const damage = new Damage();
    damage.register(0, dinky);
    for (const engine of dinky.engines) expect(damage.remaining(0, engine.module!, DamageEffect.Thrust)).toBe(1);
  });

  it('stops at a ragged module, cutting off what lies beyond it', () => {
    // A module on the path from the core to an engine, torn open, and the
    // engine past it silenced while it is itself sound.
    const links = new Map<number, number[]>();
    for (const joint of joints(dinky)) {
      links.set(joint.a, [...(links.get(joint.a) ?? []), joint.b]);
      links.set(joint.b, [...(links.get(joint.b) ?? []), joint.a]);
    }
    const core = dinky.cores[0]!;
    const engine = dinky.engines.find((e) => !(links.get(core) ?? []).includes(e.module!))!.module!;
    // Every neighbour of the core bar the engine's own line is torn: whatever
    // reaches the engine has to pass through something ragged.
    const torn = (links.get(core) ?? []).filter((m) => m !== engine);
    const damage = new Damage();
    damage.register(0, dinky);
    for (const m of torn) damage.absorb(0, m, dinky.modules[m]!.stats.hitPoints * DAMAGE_ENERGY_PER_KG * 0.9);
    expect(damage.integrity(0, engine)).toBe(1);
    expect(damage.remaining(0, engine, DamageEffect.Thrust)).toBe(0);
    expect(commanded(dinky, []).every((c) => c)).toBe(true);
  });

  it('never crosses a seam', () => {
    const welded = weldDesigns(corvette, corvette, 0, 40, 0, 0, 0, 0.5);
    const damage = new Damage();
    damage.register(0, welded);
    const own = corvette.modules.length;
    for (const engine of welded.engines) {
      const left = damage.remaining(0, engine.module!, DamageEffect.Thrust);
      // The second hull's own core commands its own engines; the seam carries nothing across.
      expect(left).toBe(1);
    }
    // With the second hull's core out, its engines answer to nobody.
    damage.absorb(0, own + corvette.cores[0]!, corvette.modules[corvette.cores[0]!]!.stats.hitPoints * DAMAGE_ENERGY_PER_KG * 0.7);
    for (const engine of welded.engines) {
      const left = damage.remaining(0, engine.module!, DamageEffect.Thrust);
      if (engine.module! < own) expect(left).toBe(1);
      else expect(left).toBe(0);
    }
  });
});

describe('a welded design', () => {
  const welded = weldDesigns(corvette, dinky, 0, 30, 0.5, 0, 0, 0.5);

  it('is the two hulls, joined only by the seam', () => {
    expect(welded.mass).toBeCloseTo(corvette.mass + dinky.mass, 6);
    const own = corvette.modules.length;
    const across = joints(welded).filter((joint) => joint.a < own !== joint.b < own);
    expect(across).toHaveLength(1);
    expect(across[0]!.seam).toBe(true);
  });

  it('keeps its seams through a sever that leaves both ends', () => {
    const keep = welded.modules.map((_, m) => m).filter((m) => m !== 3);
    const piece = subDesign(welded, keep);
    expect(joints(piece).filter((joint) => joint.seam === true)).toHaveLength(1);
    const lonely = subDesign(welded, welded.modules.map((_, m) => m).slice(1));
    expect(joints(lonely).filter((joint) => joint.seam === true)).toHaveLength(0);
  });
});
