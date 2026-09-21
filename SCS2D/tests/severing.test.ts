import { describe, expect, it } from 'vitest';
import { beamDuel } from '../scenarios/beamDuel.js';
import {
  Contacts,
  Ships,
  World,
  compileBlueprint,
  joints,
  type Blueprint,
  type ModuleSpec,
  type ShipDesign,
} from '../sim/index.js';

/**
 * Hulls coming apart.
 *
 * **What parts a hull is a blow, not a wound.** Damage decides how much of a
 * weld is left and something still has to hit the ship hard enough to spend
 * it, so most of what is here is about which blows take something off and
 * which do not — and about the case that matters most, a ship shot to pieces
 * amidships going on carrying its wings.
 *
 * The graph that decides *where* a hull parts is tested on its own.
 */

function structure(x: number, y: number, length: number, width: number): ModuleSpec {
  return { kind: 'structure', x, y, length, width };
}

/**
 * Three boxes in a row. The tip is joined by 2 m of weld and the tail by 4 m,
 * so there is a weak end and a strong one and which goes is not a toss-up.
 */
const CHAIN: Blueprint = {
  name: 'Chain',
  modules: [structure(0, 0, 10, 4), structure(-10, 0, 10, 4), structure(8, 0, 6, 2)],
};

const design: ShipDesign = compileBlueprint(CHAIN);
const TIP = 2;
const TIP_JOINT = joints(design).find((j) => j.a === 0 && j.b === TIP)!;

interface Scene {
  world: World;
  ships: Ships;
  ship: number;
  body: number;
}

function scene(vx = 30, vy = -10, spin = 0.4): Scene {
  const world = new World({ dt: 1 / 60, seed: 1 });
  const ships = new Ships();
  const ship = ships.spawn(world, { design, x: 100, y: 40, vx, vy, angularVel: spin, team: 1 });
  return { world, ships, ship, body: world.bodies.indexOf(ships.body(ship)) };
}

/** Where a module of a ship is in the world. */
function moduleAt(scene: Scene, ship: number, module: number): { x: number; y: number } {
  const b = scene.world.bodies;
  const i = b.indexOf(scene.ships.body(ship));
  const m = scene.ships.design(ship).modules[module]!;
  const c = Math.cos(b.angle[i]!);
  const s = Math.sin(b.angle[i]!);
  return { x: b.x[i]! + m.x * c - m.y * s, y: b.y[i]! + m.x * s + m.y * c };
}

/** Hit one module square across the hull, with an impulse of `size`. */
function hit(s: Scene, module: number, size: number): void {
  const at = moduleAt(s, s.ship, module);
  s.ships.blow(s.body, module, 0, size, at.x, at.y);
}

/** Mass, momentum and angular momentum about the world origin, over everything. */
function totals(scene: Scene): { mass: number; px: number; py: number; l: number } {
  const b = scene.world.bodies;
  let mass = 0;
  let px = 0;
  let py = 0;
  let l = 0;
  for (let i = 0; i < b.highWater; i++) {
    if (b.alive[i] === 0) continue;
    mass += b.mass[i]!;
    px += b.mass[i]! * b.vx[i]!;
    py += b.mass[i]! * b.vy[i]!;
    l += b.inertia[i]! * b.angularVel[i]!;
    l += b.mass[i]! * (b.x[i]! * b.vy[i]! - b.y[i]! * b.vx[i]!);
  }
  return { mass, px, py, l };
}

/** Enough of a blow to part a sound weld, and nothing like enough. */
const HARD = TIP_JOINT.strength * 20;
const GENTLE = TIP_JOINT.strength * 0.05;

describe('what parts a hull', () => {
  it('leaves a ship alone when nothing hits it', () => {
    const s = scene();
    expect(s.ships.sever(s.world)).toBe(0);
    expect(s.ships.count).toBe(1);
  });

  it('leaves a ship alone however badly it is damaged, until something hits it', () => {
    // The whole of the middle of the ship, wrecked several times over. This
    // is the case the model exists for: a hull shot to pieces amidships is a
    // wreck, not a pile of parts.
    const s = scene();
    s.ships.damage.absorb(s.body, 0, 1e12);
    expect(s.ships.sever(s.world)).toBe(0);
    expect(s.ships.design(s.ship).modules).toHaveLength(3);
  });

  it('takes a piece off when something hits it hard enough', () => {
    const s = scene();
    hit(s, TIP, HARD);
    expect(s.ships.sever(s.world)).toBe(1);
    expect(s.ships.design(s.ship).modules).toHaveLength(2);
    expect(s.ships.design(s.ship + 1).modules).toHaveLength(1);
  });

  it('shrugs off a knock', () => {
    const s = scene();
    hit(s, TIP, GENTLE);
    expect(s.ships.sever(s.world)).toBe(0);
  });

  it('parts a wrecked weld under a blow a sound one would take', () => {
    const sound = scene();
    hit(sound, TIP, TIP_JOINT.strength * 2);
    expect(sound.ships.sever(sound.world)).toBe(0);

    const wrecked = scene();
    wrecked.ships.damage.absorb(wrecked.body, TIP, 1e12);
    hit(wrecked, TIP, TIP_JOINT.strength * 2);
    expect(wrecked.ships.sever(wrecked.world)).toBe(1);
  });

  it('holds wreckage on under a knock: a dead module is still metal', () => {
    const s = scene();
    s.ships.damage.absorb(s.body, TIP, 1e12);
    hit(s, TIP, GENTLE);
    expect(s.ships.sever(s.world)).toBe(0);
  });

  it('takes off what the blow landed on rather than what is furthest from it', () => {
    // The same blow twice. On the tip, nearly all of it goes through the one
    // weld holding the tip on, and the tip goes. Amidships — which is where a
    // gun aiming at the centre of mass puts it all day — the tip is a small
    // part of a ship that barely moved, so little reaches that weld and
    // nothing comes off. This is why wrecking the middle of a hull does not
    // shed its extremities.
    const size = TIP_JOINT.strength * 4;

    const tip = scene();
    hit(tip, TIP, size);
    expect(tip.ships.sever(tip.world)).toBe(1);

    const middle = scene();
    hit(middle, 0, size);
    expect(middle.ships.sever(middle.world)).toBe(0);
    expect(middle.ships.design(middle.ship).modules).toHaveLength(3);
  });

  it('breaks the weld the blow loaded, not every weld at once', () => {
    const s = scene();
    hit(s, TIP, HARD);
    s.ships.sever(s.world);
    // The tail is joined by twice the weld and is nowhere near the impact.
    expect(s.ships.design(s.ship).modules).toHaveLength(2);
    expect(s.ships.count).toBe(2);
  });

  it('answers a collision, which is the heaviest blow a battle has', () => {
    const s = scene();
    const at = moduleAt(s, s.ship, TIP);
    const contacts = new Contacts();
    contacts.push(s.body, 99, at.x, at.y, 0, 1, 0.1, TIP, -1);
    contacts.impulse[0] = HARD;
    expect(s.ships.sever(s.world, contacts)).toBe(1);
  });
});

describe('cutting a weld through', () => {
  const TIP_INDEX = joints(design).indexOf(TIP_JOINT);

  it('lets the piece go with no blow at all: a cut is not a weak weld', () => {
    const s = scene();
    s.ships.damage.cutWeld(s.body, TIP_INDEX, TIP_JOINT.width);
    expect(s.ships.sever(s.world)).toBe(1);
    expect(s.ships.design(s.ship).modules).toHaveLength(2);
  });

  it('holds while there is any of the weld left', () => {
    const s = scene();
    s.ships.damage.cutWeld(s.body, TIP_INDEX, TIP_JOINT.width * 0.9);
    expect(s.ships.sever(s.world)).toBe(0);
  });

  it('takes a part-cut weld off the blow it can stand', () => {
    const sound = scene();
    hit(sound, TIP, TIP_JOINT.strength * 2);
    expect(sound.ships.sever(sound.world)).toBe(0);

    const sawn = scene();
    sawn.ships.damage.cutWeld(sawn.body, TIP_INDEX, TIP_JOINT.width * 0.9);
    hit(sawn, TIP, TIP_JOINT.strength * 2);
    expect(sawn.ships.sever(sawn.world)).toBe(1);
  });

  it('keeps what has been cut out of the welds a piece takes with it', () => {
    // The tail's weld is half sawn through, and the tip is what comes off, so
    // the ship keeps a weld that is still half sawn through.
    const s = scene();
    const tail = joints(design).find((j) => j.a === 0 && j.b === 1)!;
    s.ships.damage.cutWeld(s.body, joints(design).indexOf(tail), tail.width * 0.5);
    hit(s, TIP, TIP_JOINT.strength * 4);
    s.ships.sever(s.world);

    const left = s.ships.design(s.ship);
    expect(left.modules).toHaveLength(2);
    const kept = joints(left)[0]!;
    expect(joints(left)).toHaveLength(1);
    expect(s.ships.damage.weldIntegrity(s.body, 0, kept.width)).toBeCloseTo(0.5, 9);
  });
});

describe('what a hull that has come apart looks like', () => {
  function broken(): Scene {
    const s = scene();
    hit(s, TIP, HARD);
    s.ships.sever(s.world);
    return s;
  }

  it('conserves mass, momentum and angular momentum', () => {
    const s = scene();
    const before = totals(s);
    hit(s, TIP, HARD);
    s.ships.sever(s.world);
    const after = totals(s);
    expect(after.mass).toBeCloseTo(before.mass, 9);
    expect(after.px).toBeCloseTo(before.px, 9);
    expect(after.py).toBeCloseTo(before.py, 9);
    expect(after.l).toBeCloseTo(before.l, 6);
  });

  it('leaves every module exactly where it was', () => {
    const s = scene();
    const tail = moduleAt(s, s.ship, 1);
    const tip = moduleAt(s, s.ship, TIP);
    hit(s, TIP, HARD);
    s.ships.sever(s.world);
    expect(moduleAt(s, s.ship, 1).x).toBeCloseTo(tail.x, 9);
    expect(moduleAt(s, s.ship, 1).y).toBeCloseTo(tail.y, 9);
    expect(moduleAt(s, s.ship + 1, 0).x).toBeCloseTo(tip.x, 9);
    expect(moduleAt(s, s.ship + 1, 0).y).toBeCloseTo(tip.y, 9);
  });

  it('carries the damage across with the modules that took it', () => {
    const s = scene();
    s.ships.damage.absorb(s.body, TIP, 1000);
    s.ships.damage.absorb(s.body, 1, 2000);
    hit(s, TIP, HARD);
    s.ships.sever(s.world);
    const chunk = s.world.bodies.indexOf(s.ships.body(s.ship + 1));
    expect(s.ships.damage.absorbedAt(chunk, 0)).toBeCloseTo(1000, 9);
    expect(s.ships.damage.absorbedAt(s.body, 1)).toBeCloseTo(2000, 9);
  });

  it('gives the piece to nobody: it is not flown and does not shoot', () => {
    const s = broken();
    const chunk = s.ship + 1;
    expect(s.ships.isDerelict(chunk)).toBe(true);
    expect(s.ships.isDisabled(chunk)).toBe(true);

    // A ship with no orders brakes to a halt, so a piece still drifting a
    // second later is one nobody is flying.
    const b = s.world.bodies;
    const i = b.indexOf(s.ships.body(chunk));
    const speed = Math.hypot(b.vx[i]!, b.vy[i]!);
    for (let step = 0; step < 60; step++) {
      s.ships.command(1 / 60, s.world);
      s.world.step();
    }
    expect(Math.hypot(b.vx[i]!, b.vy[i]!)).toBeCloseTo(speed, 6);
  });

  it('keeps the ship it was: same body, same team, same orders', () => {
    const s = scene();
    s.ships.pushOrder(s.ship, 7, 100, 400, 50);
    const id = s.ships.body(s.ship);
    hit(s, TIP, HARD);
    s.ships.sever(s.world);
    expect(s.ships.body(s.ship)).toBe(id);
    expect(s.ships.teamOf(s.ship)).toBe(1);
    expect(s.ships.orderCount(s.ship)).toBe(1);
  });

  it('re-measures the ship that is left', () => {
    const s = broken();
    const b = s.world.bodies;
    const left = s.ships.design(s.ship);
    expect(b.mass[s.body]).toBeCloseTo(left.mass, 9);
    expect(b.inertia[s.body]).toBeCloseTo(left.inertia, 9);
    expect(b.radius[s.body]).toBeCloseTo(left.radius, 9);
    expect(left.mass).toBeLessThan(design.mass);
  });
});

describe('what a beam does to a hull', () => {
  it('never takes a piece off it, however long it burns', () => {
    // A beam delivers energy and no momentum, so it can wreck every module it
    // touches and still not part a single weld. Cutting is a mechanism of its
    // own, and is not this one.
    const run = beamDuel();
    for (let i = 0; i < 3000; i++) run.step();
    expect(run.totalBeamHits).toBeGreaterThan(0);
    expect(run.totalContacts).toBe(0);
    expect(run.totalSevered).toBe(0);
  });
});
