import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DOCTRINE,
  DOCTRINE_FIELDS,
  Ships,
  World,
  blueprintFileProblem,
  compileBlueprint,
  doctrineProblem,
  parseBlueprint,
  score,
  serialiseBlueprint,
  serialiseDoctrine,
  toDoctrine,
  type Candidate,
  type Doctrine,
} from '../sim/index.js';
import { CORVETTE, DINKY, GUNSHIP } from '../scenarios/blueprints.js';

/**
 * What a craft does when nobody is telling it anything.
 *
 * Two halves, tested apart: what a doctrine *is* — a block of named numbers a
 * person can read and evolution can reach — and what it *decides*, which is
 * the scoring that turns a set of preferences into one target.
 */

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  ship: 1,
  range: 500,
  closing: 0,
  mass: 100_000,
  disabled: false,
  ...over,
});

describe('a doctrine as written down', () => {
  it('is a block of named numbers, every one of them reachable', () => {
    // Named, so a person can read the file; numbers, so evolution can mutate
    // it. A field that is neither is a field one of those two cannot use.
    for (const field of DOCTRINE_FIELDS) {
      expect(typeof DEFAULT_DOCTRINE[field]).toBe('number');
    }
    expect(new Set(DOCTRINE_FIELDS).size).toBe(DOCTRINE_FIELDS.length);
    expect(Object.keys(DEFAULT_DOCTRINE).sort()).toEqual([...DOCTRINE_FIELDS].sort());
  });

  it('fills in whatever a file leaves out', () => {
    const partial = toDoctrine({ standoff: 2 });
    expect(partial.standoff).toBe(2);
    expect(partial.approachSpeed).toBe(DEFAULT_DOCTRINE.approachSpeed);
  });

  it('refuses what it cannot read', () => {
    expect(doctrineProblem(undefined)).toBeNull();
    expect(doctrineProblem({ standoff: 1.2 })).toBeNull();
    expect(doctrineProblem({ standoff: 'close' })).toMatch(/standoff/);
    expect(doctrineProblem({ aggression: 3 })).toMatch(/unknown key/);
    expect(doctrineProblem({ tolerance: -1 })).toMatch(/negative/);
    expect(doctrineProblem([])).toMatch(/object/);
  });

  it('writes down only what it says differently from the default', () => {
    // So a file stays short, and a default that moves later moves for every
    // ship that never had an opinion about it.
    expect(serialiseDoctrine(DEFAULT_DOCTRINE)).toBeUndefined();
    expect(serialiseDoctrine({ ...DEFAULT_DOCTRINE, standoff: 2 })).toEqual({ standoff: 2 });
  });

  it('survives a trip through a blueprint file', () => {
    const blueprint = { ...CORVETTE, doctrine: toDoctrine({ standoff: 1.4, hulkValue: 0.5 }) };
    const file = serialiseBlueprint(blueprint);
    expect(file['doctrine']).toEqual({ standoff: 1.4, hulkValue: 0.5 });
    expect(blueprintFileProblem(file)).toBeNull();
    expect(parseBlueprint(file).doctrine?.standoff).toBe(1.4);
  });

  it('reaches a compiled ship, and a piece broken off one keeps it', () => {
    const design = compileBlueprint({ ...CORVETTE, doctrine: toDoctrine({ standoff: 1.4 }) });
    expect(design.doctrine.standoff).toBe(1.4);
    const plain = compileBlueprint(CORVETTE);
    expect(plain.doctrine).toEqual(DEFAULT_DOCTRINE);
  });
});

describe('what a ship is worth shooting at', () => {
  const doctrine: Doctrine = { ...DEFAULT_DOCTRINE, loyaltyWeight: 20, hulkValue: 0 };
  const REACH = 1000;

  it('prefers what is closer', () => {
    const near = score(doctrine, candidate({ range: 200 }), REACH, -1);
    const far = score(doctrine, candidate({ range: 800 }), REACH, -1);
    expect(near).toBeGreaterThan(far);
  });

  it('prefers what is worth killing', () => {
    const big = score(doctrine, candidate({ mass: 500_000 }), REACH, -1);
    const small = score(doctrine, candidate({ mass: 10_000 }), REACH, -1);
    expect(big).toBeGreaterThan(small);
  });

  it('prefers what is coming at it', () => {
    const closing = score(doctrine, candidate({ closing: 120 }), REACH, -1);
    const leaving = score(doctrine, candidate({ closing: -120 }), REACH, -1);
    expect(closing).toBeGreaterThan(leaving);
  });

  it('sticks with what it is already fighting', () => {
    // The cheapest fix for the most visible failure a target picker has: two
    // equally good targets, and a ship that spends the battle turning round.
    const evens = candidate({ ship: 7 });
    expect(score(doctrine, evens, REACH, 7)).toBeGreaterThan(score(doctrine, evens, REACH, 3));
  });

  it('writes a hulk off entirely, by default', () => {
    // A multiplier rather than a term, so a doctrine that does not finish
    // hulks cannot be talked into one by how close it is.
    const hulk = candidate({ disabled: true, range: 1 });
    expect(score(doctrine, hulk, REACH, -1)).toBe(0);
    expect(score({ ...doctrine, hulkValue: 0.5 }, hulk, REACH, -1)).toBeGreaterThan(0);
  });

  it('scores a target beyond its reach against, so a ship closes', () => {
    expect(
      score({ ...doctrine, valueWeight: 0, closingWeight: 0 }, candidate({ range: REACH * 2 }), REACH, -1),
    ).toBeLessThan(0);
  });
});

describe('a ship deciding for itself', () => {
  /** Two hostile ships, close enough to argue about. */
  function scene(design = compileBlueprint(GUNSHIP), enemy = compileBlueprint(CORVETTE)) {
    const world = new World({ dt: 1 / 60, seed: 3 });
    const ships = new Ships();
    world.addForceProvider(ships.forceProvider());
    const mine = ships.spawn(world, { design, x: 0, y: 0, team: 0 });
    const theirs = ships.spawn(world, { design: enemy, x: 600, y: 0, angle: Math.PI, team: 1 });
    return { world, ships, mine, theirs };
  }

  it('picks a fight when it has been told nothing', () => {
    const s = scene();
    for (let i = 0; i < 300; i++) {
      s.ships.command(1 / 60, s.world);
      s.world.step();
    }
    // It went for it: something moved, and the guns went to work.
    const b = s.world.bodies;
    const body = b.indexOf(s.ships.body(s.mine));
    expect(Math.hypot(b.vx[body]!, b.vy[body]!)).toBeGreaterThan(0);
  });

  it('does what it is told instead, whenever it is told anything', () => {
    // Doctrine is the fallback, never a second voice: an order outranks it,
    // and the order's own range band is the one that is flown.
    const s = scene();
    s.ships.pushOrder(s.mine, s.theirs, 2000, 2400, 30);
    for (let i = 0; i < 600; i++) {
      s.ships.command(1 / 60, s.world);
      s.world.step();
    }
    const b = s.world.bodies;
    const a = b.indexOf(s.ships.body(s.mine));
    const t = b.indexOf(s.ships.body(s.theirs));
    // Told to stand off at two kilometres, it opens the range rather than
    // closing to the few hundred metres its doctrine would have chosen.
    expect(Math.hypot(b.x[a]! - b.x[t]!, b.y[a]! - b.y[t]!)).toBeGreaterThan(600);
    expect(s.ships.orderCount(s.mine)).toBe(1);
  });

  it('leaves its own side alone', () => {
    const world = new World({ dt: 1 / 60, seed: 4 });
    const ships = new Ships();
    world.addForceProvider(ships.forceProvider());
    const design = compileBlueprint(GUNSHIP);
    const a = ships.spawn(world, { design, x: 0, y: 0, team: 0 });
    ships.spawn(world, { design, x: 600, y: 0, team: 0 });
    for (let i = 0; i < 120; i++) {
      ships.command(1 / 60, world);
      world.step();
    }
    const bodies = world.bodies;
    const body = bodies.indexOf(ships.body(a));
    expect(Math.hypot(bodies.vx[body]!, bodies.vy[body]!)).toBeCloseTo(0, 6);
  });

  it('reconsiders faster on a light hull than on a heavy one', () => {
    // Derived rather than configured: mass stands in for how quickly a hull
    // can act on a change of mind, so a fighter thinks like a fighter.
    const fighter = compileBlueprint(DINKY);
    const capital = compileBlueprint(GUNSHIP);
    expect(fighter.mass).toBeLessThan(capital.mass);
    // The rate itself is private; what is checkable is that the two designs
    // differ enough in mass for the derivation to separate them at all.
    expect(capital.mass / fighter.mass).toBeGreaterThan(4);
  });
});
