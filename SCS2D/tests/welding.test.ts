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
import { hooked as hookedScenario } from '../scenarios/hooked.js';
import { capture, Snapshot } from '../sim/snapshot.js';
import { CORVETTE, DINKY, GUNSHIP } from '../scenarios/blueprints.js';
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
    // Hulks rather than wreckage — ships whose cores are out — so both ride it.
    expect(run.ships.body(run.a)).toBe(run.ships.body(run.b));
    expect(run.world.bodies.count).toBe(1);
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

  describe('two ships', () => {
    /** Two corvettes with their noses torn open, hooked together nose to nose. */
    function hooked(): ReturnType<typeof drift> {
      const run = drift(1, (ships, world, a, b) => {
        for (const ship of [a, b]) wear(ships, world, ship, nose, RAGGED_INTEGRITY * 0.5);
      });
      runUntilWelded(run);
      expect(run.totalWelded).toBe(1);
      return run;
    }
    /** The `hooked` scenario a second in: welded, and both ships training their guns. */
    function hookedUnderFire(): ReturnType<typeof hookedScenario> {
      const run = hookedScenario();
      for (let s = 0; s < 60; s++) run.step();
      expect(run.ships.body(0)).toBe(run.ships.body(1));
      return run;
    }
    const front = Math.max(...corvette.modules.map((m) => m.x + m.spec.length / 2));
    const nose = corvette.modules.findIndex((m) => m.x + m.spec.length / 2 === front);
    const own = corvette.modules.length;

    it('both ride one body, each on its own side', () => {
      const run = hooked();
      const { ships, a, b } = run;
      expect(ships.body(a)).toBe(ships.body(b));
      expect(ships.hasControl(a)).toBe(true);
      expect(ships.hasControl(b)).toBe(true);
      expect(ships.teamOf(b)).toBe(1);
      const design = ships.design(a);
      for (let m = 0; m < design.modules.length; m++) {
        expect(ships.owns(a, m)).toBe(m < own);
        expect(ships.owns(b, m)).toBe(m >= own);
      }
      // Who a hit on either side counts against, for scoring.
      const body = run.world.bodies.indexOf(ships.body(a));
      expect(ships.pilotAt(body, 0)).toBe(a);
      expect(ships.pilotAt(body, own)).toBe(b);
    });

    it('pull against each other, each with its own engines', () => {
      const { ships, world, a, b } = hooked();
      // An enemy for each, off in opposite directions.
      ships.spawn(world, { design: corvette, x: -20000, y: 0, team: 1 });
      ships.spawn(world, { design: corvette, x: 20000, y: 0, team: 0 });
      for (let s = 0; s < 30; s++) ships.command(world.dt, world);
      const engines = ships.design(a).engines;
      const burning = (ship: number, side: (m: number) => boolean): number =>
        engines.reduce((sum, e, k) => sum + (side(e.module!) ? ships.throttleOf(ship, k) : 0), 0);
      expect(burning(a, (m) => m < own)).toBeGreaterThan(0);
      expect(burning(b, (m) => m >= own)).toBeGreaterThan(0);
      expect(burning(a, (m) => m >= own)).toBe(0);
      expect(burning(b, (m) => m < own)).toBe(0);
    });

    it('holds the wrench of a ship whose cores are out, gathering no recoil from the other', () => {
      const run = hookedUnderFire();
      const { ships, world } = run;
      const body = world.bodies.indexOf(ships.body(0));
      const design = ships.design(0);
      for (const core of design.cores) {
        if (ships.owns(0, core)) ships.damage.absorb(body, core, design.modules[core]!.stats.hitPoints * DAMAGE_ENERGY_PER_KG);
      }
      expect(ships.hasControl(0)).toBe(false);
      // Its last demand is held — a throttle left where it was — but nothing is added to it.
      run.step();
      const held = ships['demandTorque'][0];
      for (let s = 0; s < 300 && ships.body(0) === ships.body(1); s++) {
        run.step();
        expect(ships['demandTorque'][0]).toBe(held);
      }
    });

    it('keeps a side\'s colours on what it leaves hooked to the other', () => {
      // The blue ship's core is cut out of the pair, leaving the rest of its
      // hull on the red one: red's now, and still drawn blue. Cut by hand,
      // since the core is deck and no turret here can reach it.
      const run = hookedUnderFire();
      const body = run.world.bodies.indexOf(run.ships.body(0));
      const design = run.ships.design(0);
      joints(design).forEach((joint, k) => {
        const blue = design.cores.find((core) => run.ships.owns(0, core));
        if (joint.a === blue || joint.b === blue) run.ships.damage.cutWeld(body, k, joint.width);
      });
      const snapshot = new Snapshot();
      let leftBehind = false;
      for (let s = 0; s < 3000 && !leftBehind; s++) {
        run.step();
        if (run.ships.body(0) === run.ships.body(1)) continue;
        capture(snapshot, run.world, run.ships, run.projectiles, run.beams);
        for (let v = 0; v < snapshot.shipCount; v++) {
          const view = snapshot.ships[v]!;
          if (view.sides!.some((side, m) => side !== view.team && view.drawn![m])) leftBehind = true;
        }
      }
      expect(leftBehind).toBe(true);
    });

    it('draws every module once, in its own ship', () => {
      const run = hooked();
      const snapshot = capture(new Snapshot(), run.world, run.ships, run.projectiles, run.beams);
      const views = snapshot.ships.slice(0, snapshot.shipCount);
      expect(views).toHaveLength(2);
      const drawn = new Array<number>(views[0]!.design.modules.length).fill(0);
      for (const view of views) view.drawn!.forEach((d, m) => (drawn[m]! += d ? 1 : 0));
      expect(drawn.every((n) => n === 1)).toBe(true);
    });

    it('part as the two ships they were when the seam goes', () => {
      const run = hooked();
      const { ships, world, a, b } = run;
      const body = world.bodies.indexOf(ships.body(a));
      const all = joints(ships.design(a));
      const seam = all.findIndex((joint) => joint.seam === true);
      run.step();
      const before = totals(world);
      ships.damage.cutWeld(body, seam, all[seam]!.width * 2);
      run.step();
      expect(ships.body(a)).not.toBe(ships.body(b));
      for (const ship of [a, b]) {
        expect(ships.design(ship).modules.length).toBe(own);
        expect(ships.hasControl(ship)).toBe(true);
        for (let m = 0; m < own; m++) expect(ships.owns(ship, m)).toBe(true);
      }
      expect(ships.teamOf(a)).toBe(0);
      expect(ships.teamOf(b)).toBe(1);
      const after = totals(world);
      expect(after.mass).toBeCloseTo(before.mass, 6);
      expect(after.px).toBeCloseTo(before.px, 3);
      expect(after.py).toBeCloseTo(before.py, 3);
    });
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

  it('leaves the mounts of a ship carrying a hulk aimed where it aims them', () => {
    // A hulk hooked on fails safe every step, and shares the carrier's mount
    // state: stopping the carrier's guns where they point would call them on
    // target, and the bow gun would fire with the enemy well off its arc.
    const gunship = compileBlueprint(GUNSHIP);
    const tail = Math.min(...corvette.modules.map((m) => m.x - m.spec.length / 2));
    const stern = corvette.modules.findIndex((m) => m.x - m.spec.length / 2 === tail);
    const pair: number[] = [];
    const run = makeBattle({ seed: 1, projectiles: 256, beams: 64 }, (ships, world) => {
      const gap = -2 * tail + 0.5;
      for (const [x, angle, vx] of [[-gap / 2, Math.PI, 0.5], [gap / 2, 0, -0.5]] as const) {
        const ship = ships.spawn(world, { design: corvette, x, y: 0, angle, vx });
        wear(ships, world, ship, stern, RAGGED_INTEGRITY * 0.5);
        pair.push(ship);
      }
      wreck(ships, world, pair[1]!);
      ships.spawn(world, { design: gunship, x: 0, y: 1500, team: 1 });
    });
    for (let s = 0; s < 600 && run.totalWelded === 0; s++) run.step();
    expect(run.ships.body(pair[0]!)).toBe(run.ships.body(pair[1]!));
    expect(run.ships.hasControl(pair[1]!)).toBe(false);
    // Rounds from the shared hull only: the gunship is firing too.
    const { projectiles, world } = run;
    const ours = (): Set<number> => {
      const body = world.bodies.indexOf(run.ships.body(pair[0]!));
      const out = new Set<number>();
      for (let p = 0; p < projectiles.highWater; p++) {
        if (projectiles.alive[p] === 1 && projectiles.owner[p] === body) out.add(p);
      }
      return out;
    };
    for (let s = 0; s < 30; s++) {
      const before = ours();
      run.step();
      expect([...ours()].filter((p) => !before.has(p))).toEqual([]);
    }
  });

  it('holds fire on the step a weld remakes the mounts, rather than firing wherever they point', () => {
    // Two allies hooking stern to stern with an enemy off their beam, their
    // guns already trained on it. The weld lands between aiming and firing.
    const gunship = compileBlueprint(GUNSHIP);
    const tail = Math.min(...corvette.modules.map((m) => m.x - m.spec.length / 2));
    const stern = corvette.modules.findIndex((m) => m.x - m.spec.length / 2 === tail);
    const run = makeBattle({ seed: 1, projectiles: 256, beams: 64 }, (ships, world) => {
      const gap = -2 * tail + 0.5;
      for (const [x, angle, vx] of [[-gap / 2, Math.PI, 0.5], [gap / 2, 0, -0.5]] as const) {
        const ship = ships.spawn(world, { design: corvette, x, y: 0, angle, vx });
        wear(ships, world, ship, stern, RAGGED_INTEGRITY * 0.5);
      }
      ships.spawn(world, { design: gunship, x: 0, y: 1500, team: 1 });
    });
    let fired = -1;
    for (let s = 0; s < 600 && run.totalWelded === 0; s++) {
      const before = run.totalProjectilesFired;
      run.step();
      fired = run.totalProjectilesFired - before;
    }
    expect(run.totalWelded).toBe(1);
    expect(fired).toBe(0);
  });
});

describe('mounts remade by a weld', () => {
  it('keep pointing and slewing where they were in the world, on either hull', () => {
    // Stern to stern, so the two hulls face opposite ways: a mount carried
    // into the other's frame without turning would point half a circle off.
    const gunship = compileBlueprint(GUNSHIP);
    const tail = Math.min(...corvette.modules.map((m) => m.x - m.spec.length / 2));
    const stern = corvette.modules.findIndex((m) => m.x - m.spec.length / 2 === tail);
    const pair: number[] = [];
    const run = makeBattle({ seed: 1, projectiles: 256, beams: 64 }, (ships, world) => {
      const gap = -2 * tail + 0.5;
      for (const [x, angle, vx] of [[-gap / 2, Math.PI, 0.5], [gap / 2, 0, -0.5]] as const) {
        const ship = ships.spawn(world, { design: corvette, x, y: 0, angle, vx });
        wear(ships, world, ship, stern, RAGGED_INTEGRITY * 0.5);
        pair.push(ship);
      }
      ships.spawn(world, { design: gunship, x: 0, y: 1500, team: 1 });
    });
    const { ships, world } = run;
    const turrets = ships.turrets;
    // Each mount's bearing and commanded bearing in the world, by ship and mount.
    const inWorld = (ship: number): { bearing: number; commanded: number }[] => {
      const angle = world.bodies.angle[world.bodies.indexOf(ships.body(ship))]!;
      return ships.design(ship).turrets.map((_, t) => {
        const ti = ships.turretIndexOf(ship, t);
        return { bearing: angle + turrets.bearing[ti]!, commanded: angle + turrets.commanded[ti]! };
      });
    };
    let before = pair.map(inWorld);
    for (let s = 0; s < 600 && run.totalWelded === 0; s++) {
      before = pair.map(inWorld);
      run.step();
    }
    expect(run.totalWelded).toBe(1);

    const kept = pair.findIndex((ship) => ships.isAlive(ship) && ships.design(ship).modules.length > corvette.modules.length);
    expect(kept).toBeGreaterThanOrEqual(0);
    const n = corvette.modules.length;
    const after = inWorld(pair[kept]!);
    const off = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    ships.design(pair[kept]!).turrets.forEach((mount, t) => {
      const from = mount.module < n ? kept : 1 - kept;
      const k = corvette.turrets.findIndex((m) => m.module === mount.module % n);
      // Within a step's slew, rather than reset to rest or half a circle round.
      expect.soft(off(after[t]!.bearing, before[from]![k]!.bearing)).toBeLessThan(0.05);
      expect.soft(off(after[t]!.commanded, before[from]![k]!.commanded)).toBeLessThan(0.05);
    });
  });
});

describe('a mount that breaks off', () => {
  it('keeps pointing where it was and brakes to a stop, rather than snapping to rest', () => {
    const gunship = compileBlueprint(GUNSHIP);
    let ship = -1;
    const run = makeBattle({ seed: 1, projectiles: 64, beams: 16 }, (ships, world) => {
      ship = ships.spawn(world, { design: gunship, x: 0, y: 0 });
    });
    const { ships, world } = run;
    // A broadside mount trained well off its rest bearing, and still slewing.
    const t = gunship.turrets.findIndex((m) => Math.abs(m.mount.restBearing ?? 0) > 1);
    const module = gunship.turrets[t]!.module;
    const ti = ships.turretIndexOf(ship, t);
    const rest = ships.turrets.restBearing[ti]!;
    ships.turrets.bearing[ti] = rest + 1.2;
    ships.turrets.rate[ti] = 0.4;
    const angle = world.bodies.angle[world.bodies.indexOf(ships.body(ship))]!;

    const detach = (ships as unknown as {
      detach(world: unknown, i: number, design: unknown, keep: readonly number[]): boolean;
    }).detach.bind(ships);
    expect(detach(world, ship, gunship, [module])).toBe(true);
    let piece = -1;
    for (let i = 0; i < ships.highWater; i++) if (ships.isAlive(i) && i !== ship) piece = i;
    const pi = ships.turretIndexOf(piece, 0);
    const pieceAngle = () => world.bodies.angle[world.bodies.indexOf(ships.body(piece))]!;
    expect(pieceAngle() + ships.turrets.bearing[pi]!).toBeCloseTo(angle + rest + 1.2, 9);
    expect(ships.turrets.rate[pi]).toBe(0.4);

    // Nobody flies it, so it brakes where it points instead of heading home.
    for (let s = 0; s < 120; s++) run.step();
    expect(ships.turrets.rate[pi]).toBeCloseTo(0, 6);
    // A little further on, for the braking, and nowhere near rest.
    const travelled = ships.turrets.bearing[pi]! - (rest + 1.2);
    expect(travelled).toBeGreaterThan(0);
    expect(travelled).toBeLessThan(0.5);
  });
});

describe('enemies hooked together', () => {
  it('both take the new design when wreckage hooks on to them', () => {
    // A seed on which wreckage welds onto the pair within the 25 s run. A ship
    // left on the old design is drawn, aimed and fired from a layout its body
    // no longer has.
    const run = hookedScenario(20260932);
    const { ships, world } = run;
    for (let s = 0; s < 1500; s++) {
      run.step();
      const owners = new Map<number, number>();
      for (let i = 0; i < ships.highWater; i++) {
        if (!ships.isAlive(i)) continue;
        const b = world.bodies.indexOf(ships.body(i));
        const first = owners.get(b);
        if (first === undefined) owners.set(b, i);
        else expect(ships.design(i)).toBe(ships.design(first));
      }
    }
    // The pair's own weld, and at least one more.
    expect(run.totalWelded).toBeGreaterThan(1);
  });

  it('shoot each other across the body they share', () => {
    // A core with a turret ahead of it and a plate beside it, and two of them
    // pressed plate to plate: each turret has a clear view of the other.
    const raft = compileBlueprint({
      name: 'raft',
      modules: [
        { kind: 'core', x: 0, y: 0, length: 4, width: 4 },
        { kind: 'structure', x: 0, y: -4, length: 4, width: 4 },
        { kind: 'turret', x: 3.5, y: 0, length: 3, width: 3 },
      ],
    });
    const plate = raft.modules.findIndex((m) => m.spec.kind === 'structure');
    const edge = Math.max(...raft.modules.map((m) => -m.y + m.spec.width / 2));
    const run = makeBattle({ seed: 3, projectiles: 256 }, (ships, world) => {
      ships.spawn(world, { design: raft, x: 0, y: edge + 0.01, vy: -0.3, team: 0 });
      ships.spawn(world, { design: raft, x: 0, y: -edge - 0.01, vy: 0.3, angle: Math.PI, team: 1 });
      for (const ship of [0, 1]) {
        const body = world.bodies.indexOf(ships.body(ship));
        const hp = raft.modules[plate]!.stats.hitPoints;
        ships.damage.absorb(body, plate, hp * DAMAGE_ENERGY_PER_KG * (1 - RAGGED_INTEGRITY * 0.5));
      }
    });
    const struck = [0, 0];
    for (let s = 0; s < 1200; s++) {
      run.step();
      if (run.ships.body(0) !== run.ships.body(1)) continue;
      for (let h = 0; h < run.credit.count; h++) {
        if (run.credit.attacker[h] !== run.credit.victim[h]) continue;
        const victim = run.ships.pilotAt(run.credit.victim[h]!, run.credit.module[h]!);
        if (victim === 0 || victim === 1) struck[victim]!++;
      }
    }
    expect(run.ships.body(0)).toBe(run.ships.body(1));
    expect(struck[0]).toBeGreaterThan(0);
    expect(struck[1]).toBeGreaterThan(0);
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

  it('is a fighter only if both halves were', () => {
    expect(dinky.fighter).toBe(true);
    expect(weldDesigns(dinky, dinky, 0, 30, 0, 0, 0, 0.5).fighter).toBe(true);
    expect(weldDesigns(dinky, corvette, 0, 30, 0, 0, 0, 0.5).fighter).toBe(false);
  });

  it('keeps its seams through a sever that leaves both ends', () => {
    const keep = welded.modules.map((_, m) => m).filter((m) => m !== 3);
    const piece = subDesign(welded, keep);
    expect(joints(piece).filter((joint) => joint.seam === true)).toHaveLength(1);
    const lonely = subDesign(welded, welded.modules.map((_, m) => m).slice(1));
    expect(joints(lonely).filter((joint) => joint.seam === true)).toHaveLength(0);
  });
});
