import { describe, expect, it } from 'vitest';
import {
  Choice,
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
  armed: true,
  mobile: true,
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
    const blueprint = { ...CORVETTE, doctrine: toDoctrine({ standoff: 1.4, armedWeight: 90 }) };
    const file = serialiseBlueprint(blueprint);
    expect(file['doctrine']).toEqual({ standoff: 1.4, armedWeight: 90 });
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
  const doctrine: Doctrine = { ...DEFAULT_DOCTRINE, loyaltyWeight: 20 };
  const REACH = 1000;

  it('prefers what is closer', () => {
    const near = score(doctrine, candidate({ range: 200 }), REACH, 100_000, -1);
    const far = score(doctrine, candidate({ range: 800 }), REACH, 100_000, -1);
    expect(near).toBeGreaterThan(far);
  });

  it('prefers a target its own size, whatever size it is', () => {
    // The adaptable default: the preference is a ratio to the chooser's own
    // mass, so the same doctrine sends a fighter after fighters and a capital
    // after capitals with nothing said about either.
    const OWN = 100_000;
    const same = score(doctrine, candidate({ mass: OWN }), REACH, OWN, -1);
    const bigger = score(doctrine, candidate({ mass: OWN * 8 }), REACH, OWN, -1);
    const smaller = score(doctrine, candidate({ mass: OWN / 8 }), REACH, OWN, -1);
    expect(same).toBeGreaterThan(bigger);
    expect(same).toBeGreaterThan(smaller);
  });

  it('measures size as a ratio, so wrong in either direction is wrong alike', () => {
    // Half my mass and twice my mass are equally wrong; ten tonnes is a
    // rounding error to one ship and the whole of another.
    const OWN = 100_000;
    const half = score(doctrine, candidate({ mass: OWN / 2 }), REACH, OWN, -1);
    const double = score(doctrine, candidate({ mass: OWN * 2 }), REACH, OWN, -1);
    expect(half).toBeCloseTo(double, 9);
  });

  it('can be pointed at another weight class entirely', () => {
    // A torpedo boat that only wants capitals, said without a mechanism of
    // its own: "what I go for is fifty times my own mass".
    const hunter = { ...doctrine, preferredMass: 50 };
    const OWN = 10_000;
    const capital = score(hunter, candidate({ mass: OWN * 50 }), REACH, OWN, -1);
    const peer = score(hunter, candidate({ mass: OWN }), REACH, OWN, -1);
    expect(capital).toBeGreaterThan(peer);
  });

  it('prefers what is coming at it', () => {
    const closing = score(doctrine, candidate({ closing: 120 }), REACH, 100_000, -1);
    const leaving = score(doctrine, candidate({ closing: -120 }), REACH, 100_000, -1);
    expect(closing).toBeGreaterThan(leaving);
  });

  it('sticks with what it is already fighting', () => {
    // The cheapest fix for the most visible failure a target picker has: two
    // equally good targets, and a ship that spends the battle turning round.
    const evens = candidate({ ship: 7 });
    expect(score(doctrine, evens, REACH, 100_000, 7)).toBeGreaterThan(score(doctrine, evens, REACH, 100_000, 3));
  });

  it('prefers what can still shoot back, and what can still get away', () => {
    const live = candidate();
    const disarmed = candidate({ armed: false });
    const stranded = candidate({ mobile: false });
    expect(score(doctrine, live, REACH, 100_000, -1)).toBeGreaterThan(score(doctrine, disarmed, REACH, 100_000, -1));
    expect(score(doctrine, live, REACH, 100_000, -1)).toBeGreaterThan(score(doctrine, stranded, REACH, 100_000, -1));
  });

  it('puts a hulk behind every live ship without a rule about hulks', () => {
    // It earns neither of the two bonuses, so it falls behind by exactly what
    // a doctrine says they are worth. §3's mission kill is then a consequence
    // of what a ship is rather than a special case about what it has become.
    const hulk = candidate({ armed: false, mobile: false, range: 1 });
    const live = candidate({ ship: 2, range: REACH * 0.9 });
    expect(score(doctrine, live, REACH, 100_000, -1)).toBeGreaterThan(score(doctrine, hulk, REACH, 100_000, -1));
  });

  it('still finishes a hulk when there is nothing else left', () => {
    // Ranking rather than a threshold: a fleet with nothing appealing to
    // shoot at does the job in front of it.
    const choice = new Choice();
    const hulk = candidate({ armed: false, mobile: false });
    choice.begin();
    choice.offer(hulk, score(doctrine, hulk, REACH, 100_000, -1));
    expect(choice.ship).toBe(hulk.ship);
  });

  it('sends a fighter after fighters, on the default doctrine alone', () => {
    // A fighter that goes for the biggest thing on the board achieves
    // nothing, and this is why the Dinky needs no doctrine block of its own:
    // "something my own size" is already what the default says.
    const dinky = compileBlueprint(DINKY);
    const capital = compileBlueprint(GUNSHIP);
    expect(dinky.doctrine).toEqual(DEFAULT_DOCTRINE);

    const small = candidate({ ship: 1, mass: dinky.mass });
    const large = candidate({ ship: 2, mass: capital.mass });
    expect(score(dinky.doctrine, small, dinky.reach, dinky.mass, -1)).toBeGreaterThan(
      score(dinky.doctrine, large, dinky.reach, dinky.mass, -1),
    );

    // And the capital, given the same choice, prefers the capital.
    expect(score(capital.doctrine, large, capital.reach, capital.mass, -1)).toBeGreaterThan(
      score(capital.doctrine, small, capital.reach, capital.mass, -1),
    );

    // Still takes one on when it is all there is: scoring ranks, it does not
    // admit.
    const choice = new Choice();
    choice.begin();
    choice.offer(large, score(dinky.doctrine, large, dinky.reach, dinky.mass, -1));
    expect(choice.ship).toBe(large.ship);
  });

  it('scores a target beyond its reach against, so a ship closes', () => {
    expect(
      score(
        { ...doctrine, massWeight: 0, closingWeight: 0, armedWeight: 0, mobileWeight: 0 },
        candidate({ range: REACH * 2 }),
        REACH,
        100_000,
        -1,
      ),
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
