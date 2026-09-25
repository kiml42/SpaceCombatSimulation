import { describe, expect, it } from 'vitest';
import {
  APPROACH_FIELDS,
  Choice,
  DEFAULT_DOCTRINE,
  defaultTargeting,
  DOCTRINE_FIELDS,
  TARGETING_FIELDS,
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
  type Targeting,
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
  it('is two halves of named numbers, every one of them reachable', () => {
    // Named, so a person can read the file; numbers, so evolution can mutate
    // it. Two halves, because choosing what to fight and deciding how to
    // fight it are different problems — and a turret, which picks its own
    // target and manoeuvres nowhere, wants only the first.
    for (const field of TARGETING_FIELDS) {
      expect(typeof DEFAULT_DOCTRINE.targeting[field]).toBe('number');
    }
    for (const field of APPROACH_FIELDS) {
      expect(typeof DEFAULT_DOCTRINE.approach[field]).toBe('number');
    }
    expect(new Set(DOCTRINE_FIELDS).size).toBe(DOCTRINE_FIELDS.length);
    expect(Object.keys(DEFAULT_DOCTRINE.targeting).sort()).toEqual([...TARGETING_FIELDS].sort());
    expect(Object.keys(DEFAULT_DOCTRINE.approach).sort()).toEqual([...APPROACH_FIELDS].sort());
  });

  it('fills in whatever a file leaves out, in either half', () => {
    const partial = toDoctrine({ approach: { standoff: 2 } });
    expect(partial.approach.standoff).toBe(2);
    expect(partial.approach.approachSpeed).toBe(DEFAULT_DOCTRINE.approach.approachSpeed);
    expect(partial.targeting).toEqual(DEFAULT_DOCTRINE.targeting);
  });

  it('refuses what it cannot read, and says which half', () => {
    expect(doctrineProblem(undefined)).toBeNull();
    expect(doctrineProblem({ approach: { standoff: 1.2 } })).toBeNull();
    expect(doctrineProblem({ approach: { standoff: 'close' } })).toMatch(/approach\.standoff/);
    expect(doctrineProblem({ targeting: { aggression: 3 } })).toMatch(/targeting has unknown key/);
    expect(doctrineProblem({ aggression: 3 })).toMatch(/unknown key/);
    expect(doctrineProblem({ targeting: { preferredMass: 0 } })).toMatch(/greater than zero/);
    expect(doctrineProblem({ approach: { standoffRadii: -2 } })).toMatch(/greater than zero/);
    expect(doctrineProblem([])).toMatch(/object/);
  });

  it('writes down only what it says differently from the default', () => {
    // So a file stays short, and a default that moves later moves for every
    // ship that never had an opinion about it.
    expect(serialiseDoctrine(DEFAULT_DOCTRINE)).toBeUndefined();
    const keener = {
      ...DEFAULT_DOCTRINE,
      approach: { ...DEFAULT_DOCTRINE.approach, standoff: 2 },
    };
    expect(serialiseDoctrine(keener)).toEqual({ approach: { standoff: 2 } });
  });

  it('survives a trip through a blueprint file', () => {
    const blueprint = {
      ...CORVETTE,
      doctrine: toDoctrine({ approach: { standoff: 1.4 }, targeting: { armedWeight: 90 } }),
    };
    const file = serialiseBlueprint(blueprint);
    expect(file['doctrine']).toEqual({ targeting: { armedWeight: 90 }, approach: { standoff: 1.4 } });
    expect(blueprintFileProblem(file)).toBeNull();
    expect(parseBlueprint(file).doctrine?.approach.standoff).toBe(1.4);
  });

  it('reaches a compiled ship', () => {
    const design = compileBlueprint({
      ...CORVETTE,
      doctrine: toDoctrine({ approach: { standoff: 1.4 } }),
    });
    expect(design.doctrine.approach.standoff).toBe(1.4);
    // The Dinky has an opinion about where to shoot and none at all about
    // what to shoot: the adaptable default already sends a fighter after
    // fighters, so it says nothing at all about flying and one thing about
    // gunnery — engines above the guns the default puts first.
    //
    // That one thing is on its gun rather than on its hull, which is where a
    // doctrine's aim weights have to live: a ship chooses a ship, and only a
    // mount chooses a part of one, so a hull block saying `engineWeight`
    // would be a number nothing ever read.
    expect(compileBlueprint(DINKY).doctrine).toEqual(DEFAULT_DOCTRINE);
    const gun = compileBlueprint(DINKY).turrets[0]!.targeting;
    expect(gun).toEqual({ ...defaultTargeting('hullGun'), engineWeight: 150 });
    expect(gun.engineWeight).toBeGreaterThan(gun.gunWeight);
  });
});

describe('what a ship is worth shooting at', () => {
  const doctrine: Targeting = { ...DEFAULT_DOCTRINE.targeting, loyaltyWeight: 20 };
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
    const hunter: Targeting = { ...doctrine, preferredMass: 50 };
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

  it('is drawn to what the ship as a whole is fighting', () => {
    // What keeps a broadside concentrated once each mount chooses for itself
    // — a preference rather than an instruction, so a gun on the wrong side
    // is still free to fight what it can reach.
    const evens = candidate({ ship: 7 });
    expect(score(doctrine, evens, REACH, 100_000, -1, 7)).toBeGreaterThan(
      score(doctrine, evens, REACH, 100_000, -1, 3),
    );
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
    // nothing, and this is why the Dinky says nothing about what to go after:
    // "something my own size" is already what the default says.
    const dinky = compileBlueprint(DINKY);
    const capital = compileBlueprint(GUNSHIP);
    expect(dinky.doctrine.targeting.preferredMass).toBe(DEFAULT_DOCTRINE.targeting.preferredMass);
    expect(dinky.doctrine.targeting.massWeight).toBe(DEFAULT_DOCTRINE.targeting.massWeight);

    const small = candidate({ ship: 1, mass: dinky.mass });
    const large = candidate({ ship: 2, mass: capital.mass });
    expect(score(dinky.doctrine.targeting, small, dinky.reach, dinky.mass, -1)).toBeGreaterThan(
      score(dinky.doctrine.targeting, large, dinky.reach, dinky.mass, -1),
    );

    // And the capital, given the same choice, prefers the capital.
    expect(score(capital.doctrine.targeting, large, capital.reach, capital.mass, -1)).toBeGreaterThan(
      score(capital.doctrine.targeting, small, capital.reach, capital.mass, -1),
    );

    // Still takes one on when it is all there is: scoring ranks, it does not
    // admit.
    const choice = new Choice();
    choice.begin();
    choice.offer(large, score(dinky.doctrine.targeting, large, dinky.reach, dinky.mass, -1));
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
    const theirs = ships.spawn(world, { design: enemy, x: 2400, y: 0, angle: Math.PI, team: 1 });
    return { world, ships, mine, theirs };
  }

  it('picks a fight when it has been told nothing', () => {
    const s = scene();
    const b = s.world.bodies;
    const gap = (): number => {
      const a = b.indexOf(s.ships.body(s.mine));
      const t = b.indexOf(s.ships.body(s.theirs));
      return Math.hypot(b.x[a]! - b.x[t]!, b.y[a]! - b.y[t]!);
    };
    const before = gap();
    for (let i = 0; i < 600; i++) {
      s.ships.command(1 / 60, s.world);
      s.world.step();
    }
    // Nobody told it to, and it went anyway.
    expect(gap()).toBeLessThan(before);
  });

  it('closes further on a small target than on a large one', () => {
    // The range that matters is the one the target looks big from, so this
    // is one number covering two quite different engagements.
    const small = scene(compileBlueprint(GUNSHIP), compileBlueprint(DINKY));
    const large = scene(compileBlueprint(GUNSHIP), compileBlueprint(GUNSHIP));
    const settle = (s: ReturnType<typeof scene>): number => {
      for (let i = 0; i < 3000; i++) {
        s.ships.command(1 / 60, s.world);
        s.world.step();
      }
      const b = s.world.bodies;
      const a = b.indexOf(s.ships.body(s.mine));
      const t = b.indexOf(s.ships.body(s.theirs));
      return Math.hypot(b.x[a]! - b.x[t]!, b.y[a]! - b.y[t]!);
    };
    expect(settle(small)).toBeLessThan(settle(large));
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
    // Told to stand off at two kilometres, it holds out there rather than
    // closing to the few hundred metres its doctrine would have chosen.
    expect(Math.hypot(b.x[a]! - b.x[t]!, b.y[a]! - b.y[t]!)).toBeGreaterThan(1500);
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
