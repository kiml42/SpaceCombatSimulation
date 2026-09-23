import { describe, expect, it } from 'vitest';
import {
  blueprintProblem,
  blueprintProblems,
  compileBlueprint,
  compileDraft,
  firingArc,
  modulesOverlap,
  type Blueprint,
} from '../sim/blueprint.js';
import { HALF_PI, PI } from '../sim/math.js';
import { GunType, moduleCentre, moduleStats, type ModuleSpec } from '../sim/modules.js';
import { BLUEPRINTS, type BlueprintName } from '../scenarios/blueprints.js';

/**
 * What a compiled design has to get right is arithmetic that nothing
 * downstream can check: a wrong centre of mass makes every thruster's moment
 * arm wrong, and a wrong inertia makes every ship turn at the wrong rate.
 * Neither looks broken — the ships still fly — so these are checked against
 * values worked out independently rather than against the compiler's own
 * output.
 */

function structure(x: number, y: number, length: number, width: number): ModuleSpec {
  return { kind: 'structure', x, y, length, width };
}

/** What flies the ship, and so what every rule about its layout is anchored on. */
function core(x: number, y: number, length: number, width: number): ModuleSpec {
  return { kind: 'core', x, y, length, width };
}

describe('module overlap', () => {
  const a = structure(0, 0, 10, 4);

  it('sees a box overlapping itself', () => {
    expect(modulesOverlap(a, structure(0, 0, 2, 2))).toBe(true);
  });

  it('lets modules abut exactly', () => {
    // The common case in an authored layout, and the one a tolerance has to
    // get right: faces flush together is a valid ship, not a collision.
    expect(modulesOverlap(a, structure(7, 0, 4, 4))).toBe(false);
    expect(modulesOverlap(a, structure(0, 4, 4, 4))).toBe(false);
  });

  it('separates boxes that miss each other', () => {
    expect(modulesOverlap(a, structure(20, 0, 4, 4))).toBe(false);
    expect(modulesOverlap(a, structure(0, 10, 4, 4))).toBe(false);
  });

  it('catches an overlap only a rotated axis reveals', () => {
    // Two long boxes crossing at a right angle: their axis-aligned bounds
    // would suggest a hit either way, so this is what tells the separating-axis
    // test from a bounding-box test.
    const cross: ModuleSpec = { kind: 'structure', x: 0, y: 0, angle: HALF_PI, length: 10, width: 2 };
    expect(modulesOverlap(a, cross)).toBe(true);

    const clear: ModuleSpec = { kind: 'structure', x: 0, y: 8, angle: HALF_PI, length: 10, width: 2 };
    expect(modulesOverlap(a, clear)).toBe(false);
  });
});

describe('blueprint validation', () => {
  it('accepts a layout of abutting modules', () => {
    const bp: Blueprint = {
      name: 'Pair',
      modules: [core(0, 0, 10, 4), structure(7, 0, 4, 4)],
    };
    expect(blueprintProblem(bp)).toBeNull();
  });

  it('rejects overlapping modules by index', () => {
    const bp: Blueprint = {
      name: 'Fused',
      modules: [structure(0, 0, 10, 4), structure(2, 0, 4, 4)],
    };
    expect(blueprintProblem(bp)).toMatch(/modules 0 and 1 overlap/);
    expect(() => compileBlueprint(bp)).toThrow(/overlap/);
  });

  describe('an engine may be held on any way round', () => {
    // An engine carries the machinery it needs, so what it is bolted to is
    // nobody's business but the layout's: it is held on like any other module,
    // and the only rule left about where one may go is the one every module
    // obeys — it has to be attached to the ship.
    const hull = core(0, 0, 10, 4);
    const engine = (angle: number): ModuleSpec => ({
      kind: 'thruster',
      x: -5,
      y: 0,
      angle,
      length: 2,
      width: 4,
    });

    it('accepts one bolted on by the face it pushes from', () => {
      expect(blueprintProblem({ name: 'Right', modules: [hull, engine(0)] })).toBeNull();
    });

    it('accepts one mounted back to front, or held on by its bell', () => {
      // Both were refused while an engine was a nozzle on the end of a
      // mounting. A ship that points its exhaust at its own hull is a bad
      // design rather than an impossible one, and the plume that lands on the
      // hull is what says so.
      expect(
        blueprintProblem({ name: 'Backwards', modules: [hull, { ...engine(PI), x: -7 }] }),
      ).toBeNull();
      const bellFirst: ModuleSpec = { kind: 'thruster', x: -9, y: 0, angle: PI, length: 4, width: 4 };
      expect(blueprintProblem({ name: 'Bell', modules: [hull, bellFirst] })).toBeNull();
    });

    it('accepts one bolted to another engine or to a gun', () => {
      const stack: ModuleSpec = { kind: 'thruster', x: -7, y: 0, angle: 0, length: 2, width: 4 };
      expect(blueprintProblem({ name: 'Stacked', modules: [hull, engine(0), stack] })).toBeNull();
    });

    it('still rejects one floating free of the ship', () => {
      const adrift: ModuleSpec = { kind: 'thruster', x: -20, y: 0, angle: 0, length: 2, width: 4 };
      expect(blueprintProblem({ name: 'Adrift', modules: [hull, adrift] })).toMatch(
        /touches nothing/,
      );
    });
  });

  it('rejects an empty ship and reports which module is impossible', () => {
    expect(blueprintProblem({ name: 'Nothing', modules: [] })).toMatch(/at least one module/);
    expect(
      blueprintProblem({ name: 'Bad', modules: [structure(0, 0, 10, 4), structure(20, 0, 0, 4)] }),
    ).toMatch(/module 1/);
  });
});

/**
 * A dumbbell — two boxes with a gap between them — is deliberately not a
 * buildable ship, since nothing joins its halves. It is used anyway because
 * the arithmetic is the whole point here and a dumbbell's centre of mass and
 * inertia can be worked out by hand exactly, so these compile a *draft*, which
 * is the same derivation without the rules about how a ship goes together.
 */
describe('where a module sits', () => {
  // A thruster is the one module with a side that means something: it is held
  // on by the face it pushes from, so that face is what its position names.
  // The hull it is bolted to is the core, so each of these layouts is a ship.
  const hull = core(0, 0, 10, 4);

  it('puts an ordinary module about its own position', () => {
    expect(moduleCentre(structure(3, -2, 8, 4))).toEqual({ x: 3, y: -2 });
  });

  it('hangs a thruster back from its mounting face', () => {
    const engine: ModuleSpec = { kind: 'thruster', x: -5, y: 0, angle: 0, length: 4, width: 4 };
    expect(moduleCentre(engine).x).toBeCloseTo(-7, 12);
    // Turned, it hangs back along its own facing rather than along the world's.
    expect(moduleCentre({ ...engine, angle: HALF_PI }).y).toBeCloseTo(-2, 12);
  });

  it('measures overlap and attachment from the box, not from the mounting', () => {
    // Bolted flush to the hull's -x face: the position is *on* the hull and
    // the engine is entirely clear of it.
    const engine: ModuleSpec = { kind: 'thruster', x: -5, y: 0, angle: 0, length: 4, width: 4 };
    expect(blueprintProblem({ name: 'Flush', modules: [hull, engine] })).toBeNull();
    expect(modulesOverlap(hull, engine)).toBe(false);
  });

  it('says the same about an engine and its hull whichever is listed first', () => {
    // Attachment is tested by growing one module and asking whether it now
    // overlaps the other, and the answer has to be the same either way round.
    // Growing a thruster from its *mounting* would add the length astern, so
    // an engine would reach towards its own exhaust and a ship listed engine
    // first would look like two pieces.
    const engine: ModuleSpec = { kind: 'thruster', x: -5, y: 0, angle: 0, length: 4, width: 4 };
    expect(blueprintProblem({ name: 'Hull first', modules: [hull, engine] })).toBeNull();
    expect(blueprintProblem({ name: 'Engine first', modules: [engine, hull] })).toBeNull();
  });

  it('lengthens a thruster into its exhaust, leaving the mounting where it was', () => {
    // The point of measuring an engine from its mounting face: making it
    // bigger is one number, and it stays bolted where it was rather than
    // growing half into the hull.
    const engine: ModuleSpec = { kind: 'thruster', x: -5, y: 0, angle: 0, length: 4, width: 4 };
    const longer: ModuleSpec = { ...engine, length: 9 };
    expect(blueprintProblem({ name: 'Longer', modules: [hull, longer] })).toBeNull();
    expect(moduleCentre(longer).x).toBeCloseTo(-9.5, 12);
  });
});

describe('every module attached to the ship', () => {
  // A ship is one connected assembly, anchored on the core it is flown from:
  // a piece is part of the ship if it can be traced back to the core through
  // its neighbours.
  const hull = core(0, 0, 10, 4);

  it('accepts a chain of modules, however long the way round', () => {
    const bp: Blueprint = {
      name: 'Chain',
      // Only the first touches the hull; the rest hang off each other.
      modules: [hull, structure(7, 0, 4, 4), structure(11, 0, 4, 4), structure(15, 0, 4, 4)],
    };
    expect(blueprintProblem(bp)).toBeNull();
  });

  it('accepts modules that touch within the attachment tolerance', () => {
    // A hand-typed file misses exact abutment; a centimetre is nothing at ship
    // scale, and it is the same tolerance a thruster's mounting is judged by.
    const bp: Blueprint = { name: 'Near', modules: [hull, structure(7.005, 0, 4, 4)] };
    expect(blueprintProblem(bp)).toBeNull();
  });

  it('names a module that touches nothing', () => {
    const bp: Blueprint = { name: 'Adrift', modules: [hull, structure(30, 0, 4, 4)] };
    expect(blueprintProblem(bp)).toMatch(/module 1 touches nothing/);
    expect(() => compileBlueprint(bp)).toThrow(/touches nothing/);
  });

  it('reports a detached piece once rather than once per module of it', () => {
    const bp: Blueprint = {
      name: 'Severed',
      modules: [hull, structure(30, 0, 4, 4), structure(34, 0, 4, 4)],
    };
    const problems = blueprintProblems(bp).filter((p) => /separate piece/.test(p));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/modules 1, 2 are a separate piece/);
  });

  it('measures the ship from its core, wherever the core is listed', () => {
    // Not from the first module and not from the biggest piece: what the check
    // answers is whether a layout is one ship or several, and only the core
    // says which of the pieces the ship is. Here the core is listed second and
    // the module listed first is the one adrift.
    const bp: Blueprint = {
      name: 'Lonely first',
      modules: [structure(30, 0, 4, 4), hull, structure(7, 0, 4, 4)],
    };
    expect(blueprintProblems(bp)).toEqual([expect.stringMatching(/module 0 touches nothing/)]);
  });

  it('says nothing about a module it could not measure in the first place', () => {
    // Zero size is already a complaint of its own, and a box with no interior
    // touches nothing by construction. One mistake, one problem.
    const bp: Blueprint = { name: 'Nothing there', modules: [hull, structure(30, 0, 0, 4)] };
    expect(blueprintProblems(bp)).toEqual([expect.stringMatching(/module 1/)]);
    expect(blueprintProblems(bp)[0]).not.toMatch(/touches nothing/);
  });
});

describe('mass properties', () => {
  it('puts the origin on the centre of mass', () => {
    // Two identical boxes, one at the origin and one ten metres up the x axis:
    // the centre of mass is exactly between them, so the compiled positions
    // are ±5 whatever the boxes weigh.
    const design = compileDraft({
      name: 'Dumbbell',
      modules: [structure(0, 0, 4, 4), structure(10, 0, 4, 4)],
    });

    expect(design.centreOfMassX).toBeCloseTo(5, 12);
    expect(design.centreOfMassY).toBeCloseTo(0, 12);
    expect(design.modules[0]!.x).toBeCloseTo(-5, 12);
    expect(design.modules[1]!.x).toBeCloseTo(5, 12);
  });

  it('weights the centre of mass by module mass', () => {
    const light = structure(0, 0, 4, 4);
    const heavy = structure(10, 0, 8, 8);
    const design = compileDraft({ name: 'Lopsided', modules: [light, heavy] });

    const lm = moduleStats(light).mass;
    const hm = moduleStats(heavy).mass;
    expect(design.centreOfMassX).toBeCloseTo((10 * hm) / (lm + hm), 9);
    expect(design.mass).toBeCloseTo(lm + hm, 6);
  });

  it('carries each module inertia out to where it sits', () => {
    const spec = structure(0, 0, 4, 4);
    const design = compileDraft({
      name: 'Dumbbell',
      modules: [spec, structure(10, 0, 4, 4)],
    });

    const one = moduleStats(spec);
    // Parallel axis, by hand: each box's own inertia plus its mass at 5 m.
    expect(design.inertia).toBeCloseTo(2 * (one.inertia + one.mass * 25), 6);
  });

  it('bounds the ship by its furthest corner', () => {
    const design = compileBlueprint({ name: 'One', modules: [core(0, 0, 10, 4)] });
    expect(design.radius).toBeCloseTo(Math.sqrt(25 + 4), 12);
  });

  it('reaches the radius out to a barrel that protrudes', () => {
    const design = compileDraft({
      name: 'Gun',
      // A mount and nothing else: not a ship — there is nothing to fly it —
      // but the bounding radius is pure derivation, so a draft is enough.
      modules: [{ kind: 'turret', x: 0, y: 0, length: 8, width: 4 }],
    });
    const gun = design.modules[0]!.stats.gun!;
    // The barrel reaches past the mount's own corners, so it, not a corner, is
    // what the ship's bounding circle has to contain.
    expect(gun.barrelLength).toBeGreaterThan(Math.sqrt(16 + 4));
    expect(design.radius).toBeCloseTo(gun.barrelLength, 12);
  });
});

describe('derived thrusters', () => {
  it('gives the layout each thruster where it sits and facing where it pushes', () => {
    const design = compileBlueprint({
      name: 'Pusher',
      modules: [
        core(0, 0, 10, 4),
        { kind: 'thruster', x: -5, y: 0, angle: 0, length: 4, width: 4 },
      ],
    });

    expect(design.thrusters).toHaveLength(1);
    const t = design.thrusters[0]!;
    expect(t.dirX).toBeCloseTo(1, 12);
    expect(t.dirY).toBeCloseTo(0, 12);
    // Bolted on at -5 and four long, so the box's middle — which is what a
    // compiled design carries, and what its mass acts at — is at -7.
    expect(t.x).toBeCloseTo(-7 - design.centreOfMassX, 12);
    expect(t.maxThrust).toBeCloseTo(design.modules[1]!.stats.thrust, 6);
  });

  it('builds a layout that can push the ship the way its thrusters point', () => {
    const design = compileBlueprint(BLUEPRINTS.corvette);
    expect(design.thrusterLayout.maxThrustAlong(1, 0)).toBeGreaterThan(0);
    expect(design.thrusterLayout.hasFullAuthority()).toBe(true);
  });
});

describe('firing arcs', () => {
  const mount: ModuleSpec = { kind: 'turret', x: 0, y: 0, angle: 0, length: 4, width: 4 };

  it('gives a turret with nothing around it the full circle', () => {
    const arc = firingArc([mount], 0, 8);
    expect(arc.left).toBeCloseTo(PI, 12);
    expect(arc.right).toBeCloseTo(PI, 12);
  });

  it('ignores a module beyond the barrel', () => {
    const far = structure(100, 0, 10, 10);
    const arc = firingArc([mount, far], 0, 8);
    expect(arc.left).toBeCloseTo(PI, 12);
    expect(arc.right).toBeCloseTo(PI, 12);
  });

  it('cuts the arc back to the edge of what fouls it', () => {
    // A wall directly astern, its near corners bearing 135° off the bow: the
    // gun trains freely until it reaches them.
    const wall: ModuleSpec = { kind: 'structure', x: -8, y: 0, length: 8, width: 16 };
    const arc = firingArc([mount, wall], 0, 12);
    expect(arc.left).toBeCloseTo(Math.atan2(8, -4), 9);
    expect(arc.right).toBeCloseTo(Math.atan2(8, -4), 9);
  });

  it('only reduces the arc on one side when only one side is fouled', () => {
    // A block off the port beam, spanning bearings 63.4° to 116.6°. It stops
    // the gun training to port at the nearer of those, and — the point of the
    // test — leaves the starboard sweep entirely alone: there is nothing to
    // starboard, so the gun trains all the way round to the far side where it hits the same block.
    const toPort: ModuleSpec = { kind: 'structure', x: 0, y: 6, length: 4, width: 4 };
    const arc = firingArc([mount, toPort], 0, 12);
    expect(arc.left).toBeCloseTo(Math.atan2(4, 2), 9);
    expect(arc.left).toBeLessThan(HALF_PI);
    expect(arc.right).toBeGreaterThan(PI);
  });

  it('gives no arc at all to a gun buried in the hull', () => {
    const ahead = structure(6, 0, 4, 20);
    const arc = firingArc([mount, ahead], 0, 12);
    expect(arc.left).toBe(0);
    expect(arc.right).toBe(0);
  });
});

/**
 * Layouts that are deliberately not symmetric, listed by identity rather than
 * matched on a name: a substring test would silently exempt a future
 * "Undamaged Mk II", and the point of a wreck is that its asymmetry is the
 * feature.
 */
const ASYMMETRIC: readonly Blueprint[] = [BLUEPRINTS.damagedCorvette];

/**
 * The ships the rest of the suite flies.
 *
 * Every golden checksum is a statement about these hulls, so their handling
 * is load-bearing in a way the others' is not: a layout that cannot hold a
 * heading while translating, or whose centre of mass is a hair off the axis
 * it looks symmetric about, would move a checksum for a reason nobody could
 * see. They are therefore held to the stricter checks below.
 */
const FLEET: readonly BlueprintName[] = [
  'corvette',
  'beamCorvette',
  'gunship',
  'gunship2',
  'beamGunship',
  'damagedCorvette',
  'fractal',
  'flatGunship',
  'flatGunshipGrouped',
  'dinky',
  'catamaran',
];

/**
 * The rest: ships drawn for the look of the thing, flown in scenarios nothing
 * pins.
 *
 * **They are allowed to be fun.** A hull with no reverse thrust flies
 * perfectly well as long as it can turn and push one way; a centre of mass a
 * few millimetres off an axis is compensated by offset thrust without the
 * pilot ever noticing. Holding a showpiece to the fleet's standard buys
 * nothing and costs designs, so what they have to satisfy is only what makes
 * a ship a ship.
 *
 * Listed rather than inferred, so that a new blueprint has to be put in one
 * group or the other on purpose — see the test below that checks the two
 * cover every ship exactly once.
 */
const SHOWCASE: readonly BlueprintName[] = ['xWing', 'ghost', 'tie', 'starDestroyer'];

/**
 * Seeds: layouts that are somewhere for evolution to start rather than ships.
 *
 * A seed cannot fly, cannot shoot and is not supposed to — everything it ever
 * has is something selection paid for — so the checks below are inverted for
 * it and it is asserted to be *inert* rather than excused from being a ship.
 * A seed that quietly grew an engine is a seed that has been told which way a
 * ship is meant to go, and that is worth a failing test.
 */
const SEEDS: readonly BlueprintName[] = ['bareCore'];

/** Ships in the fleet, by identity, for the per-blueprint checks below. */
const inFleet = (name: string): boolean => (FLEET as readonly string[]).includes(name);
const isSeed = (name: string): boolean => (SEEDS as readonly string[]).includes(name);

describe('the authored blueprints', () => {
  for (const [name, blueprint] of Object.entries(BLUEPRINTS)) {
    describe(name, () => {
      it('is a valid layout', () => {
        expect(blueprintProblem(blueprint)).toBeNull();
      });

      const canFly = !isSeed(name);

      it.skipIf(canFly)('compiles to something inert: a core, and nothing else', () => {
        const design = compileBlueprint(blueprint);
        expect(design.mass).toBeGreaterThan(0);
        expect(design.inertia).toBeGreaterThan(0);
        expect(design.radius).toBeGreaterThan(0);
        expect(design.cores.length).toBeGreaterThan(0);
        expect(design.turrets.length).toBe(0);
        expect(design.thrusterLayout.maxTorque(1)).toBe(0);
        expect(design.thrusterLayout.maxTorque(-1)).toBe(0);
      });

      it.skipIf(!canFly)('compiles to a ship that can fly and shoot', () => {
        const design = compileBlueprint(blueprint);

        expect(design.mass).toBeGreaterThan(0);
        expect(design.inertia).toBeGreaterThan(0);
        expect(design.radius).toBeGreaterThan(0);

        // What every ship has to manage: turn either way, and push itself
        // along at least one heading. A craft that can do that can get where
        // it is going and point at what it is shooting at, which is the whole
        // of what flying one asks.
        expect(design.thrusterLayout.maxTorque(1)).toBeGreaterThan(0);
        expect(design.thrusterLayout.maxTorque(-1)).toBeGreaterThan(0);
        const along = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].map(([x, y]) => design.thrusterLayout.maxThrustAlong(x!, y!));
        expect(Math.max(...along)).toBeGreaterThan(0);

        // And what the fleet has to manage on top: force in *every* direction,
        // so it can hold a heading while translating. A showpiece is allowed
        // to have no reverse thrust and fly like an aeroplane.
        if (inFleet(name)) {
          expect(design.thrusterLayout.hasFullAuthority()).toBe(true);
        }

        expect(design.turrets.length).toBeGreaterThan(0);
        // Something aboard has to be able to shoot; on a fleet ship, every
        // mount does. A showpiece is allowed a gun that is boxed in and
        // trains on nothing — the Ghost's dorsal turret is exactly that, and
        // says so in its own notes — because what fixes it is masking by what
        // a turret can shoot *over* (ROADMAP.md §12) rather than a redraw.
        const canTrain = design.turrets.filter(
          (t) => t.mount.leftArc! > 0 && t.mount.rightArc! > 0,
        );
        expect(canTrain.length).toBeGreaterThan(0);
        if (inFleet(name)) expect(canTrain.length).toBe(design.turrets.length);

        for (const turret of design.turrets) {
          expect(turret.mount.maxRate).toBeGreaterThan(0);
          expect(turret.mount.maxAccel).toBeGreaterThan(0);
          // Asked of the gun rather than of the ship's name: a name-based
          // test passes until someone adds a second beam ship, and then
          // reports the new design as broken rather than as unrecognised.
          if (turret.gun.type === GunType.Beam) {
            // Negative muzzle speed is how a weapon says it arrives instantly.
            expect(turret.gun.muzzleSpeed).toBe(-1);
            expect(turret.gun.beamPower).toBeGreaterThan(0);
          } else {
            expect(turret.gun.muzzleSpeed).toBeGreaterThan(0);
            expect(turret.gun.muzzleEnergy).toBeGreaterThan(0);
          }
          expect(turret.gun.cycleTime).toBeGreaterThan(0);
        }
      });

      const deliberatelyAsymmetric = ASYMMETRIC.includes(blueprint);

      it(
        deliberatelyAsymmetric
          ? 'is asymmetric about its own axis, as a wreck should be'
          : inFleet(name) || isSeed(name)
            ? 'is symmetric about its own axis'
            : 'is balanced closely enough to fly straight',
        () => {
          // A symmetric layout must put its centre of mass on the axis, or the
          // ship translates when it meant to rotate — very hard to spot by eye
          // and easy to author by accident.
          //
          // The asymmetric ones are *asserted* to be asymmetric rather than
          // skipped. A skipped check reports as a pass, which overstates the
          // coverage; this way a wreck that quietly became symmetric again —
          // by restoring a module, say — is a failure rather than a silence.
          const design = compileBlueprint(blueprint);
          if (deliberatelyAsymmetric) {
            expect(Math.abs(design.centreOfMassY)).toBeGreaterThan(0.01);
          } else if (inFleet(name) || isSeed(name)) {
            expect(design.centreOfMassY).toBeCloseTo(0, 12);
          } else {
            // A showpiece only has to be near enough that offset thrust can
            // trim it out without the pilot noticing — measured against the
            // ship's own size, since a millimetre means one thing on a fighter
            // and nothing at all on a kilometre of Star Destroyer.
            expect(Math.abs(design.centreOfMassY)).toBeLessThan(design.radius * 0.02);
          }
        },
      );
    });
  }

  it('sorts every layout into the fleet, the showcase or the seeds, and none into two', () => {
    // A new blueprint is classified on purpose or the suite complains. The
    // failure mode this exists for is silent: a ship added to the library and
    // to no list would be held to nothing at all, and a ship flown by a
    // golden but left out of the fleet would have its handling unchecked
    // while a checksum quietly depended on it.
    const sorted = [...FLEET, ...SHOWCASE, ...SEEDS].sort();
    expect(sorted).toEqual(Object.keys(BLUEPRINTS).sort());
    expect(new Set(sorted).size).toBe(sorted.length);
  });

  // Slow: it samples every thruster's plume along its whole length against
  // every other module, and the default 5s timeout is marginal on Windows CI.
  it('points every thruster so its exhaust leaves clear air', { timeout: 30_000 }, () => {
    // A thruster pushes along its facing and exhausts the other way, so a
    // mount out on a wing has to push *inboard* or it fires into the wing it
    // is bolted to.
    //
    // Not made redundant by `blueprintProblem` rejecting an unattached
    // thruster, which is a stricter rule in one direction and a weaker one in
    // the other: it catches a mount turned round, since that one is held on by
    // its nozzle, but says nothing about a correctly mounted engine whose
    // plume runs into something further aft. That layout is legal and is meant
    // to be — it burns what it is pointed at and loses the thrust it fires
    // into itself (`sim/exhaust.ts`) rather than being refused — so nothing
    // else would tell the fleet's authors they had drawn a ship that eats
    // itself.
    //
    // This casts the *axis* only. A plume is three rays wide, so a layout that
    // passes here can still lose a third of an engine to a side ray grazing
    // structure; what that costs is in the compiled design's `escaping` and on
    // the editor's panel, not here.
    for (const name of FLEET) {
      const blueprint = BLUEPRINTS[name];
      const design = compileBlueprint(blueprint);
      const thrusters = design.modules.filter((m) => m.spec.kind === 'thruster');

      for (const t of thrusters) {
        const dx = -Math.cos(t.angle);
        const dy = -Math.sin(t.angle);
        const startX = t.x + dx * (t.spec.length / 2);
        const startY = t.y + dy * (t.spec.length / 2);

        for (const other of design.modules) {
          if (other === t) continue;
          for (let d = 0.05; d < design.radius * 2; d += 0.25) {
            const px = startX + dx * d - other.x;
            const py = startY + dy * d - other.y;
            const c = Math.cos(-other.angle);
            const s = Math.sin(-other.angle);
            const localX = px * c - py * s;
            const localY = px * s + py * c;
            const inside =
              Math.abs(localX) <= other.spec.length / 2 &&
              Math.abs(localY) <= other.spec.width / 2;
            expect(
              inside,
              `${blueprint.name}: thruster at (${t.spec.x}, ${t.spec.y}) exhausts into ` +
                `${other.spec.kind} at (${other.spec.x}, ${other.spec.y})`,
            ).toBe(false);
          }
        }
      }
    }
  });

  it('lists thrusters and turrets in the order their modules appear', () => {
    // Anything holding per-thruster or per-turret state alongside a design —
    // throttles, gun timers, a renderer drawing exhaust — indexes these arrays
    // and walks the modules. If the two orders ever diverged, a ship would
    // show one engine's flame on another engine's mount, and the pilot would
    // steer with the wrong thruster.
    for (const blueprint of Object.values(BLUEPRINTS)) {
      const design = compileBlueprint(blueprint);

      const thrusterModules = design.modules.filter((m) => m.spec.kind === 'thruster');
      expect(thrusterModules.length).toBe(design.thrusters.length);
      for (let i = 0; i < design.thrusters.length; i++) {
        expect(design.thrusters[i]!.x).toBe(thrusterModules[i]!.x);
        expect(design.thrusters[i]!.y).toBe(thrusterModules[i]!.y);
      }

      const turretModules = design.modules.filter((m) => m.spec.kind === 'turret' || m.spec.kind === 'beamTurret');
      expect(turretModules.length).toBe(design.turrets.length);
      for (let i = 0; i < design.turrets.length; i++) {
        expect(design.modules[design.turrets[i]!.module]).toBe(turretModules[i]);
      }
    }
  });

  it('makes the corvette the nimbler of the two and the gunship the harder hitter', () => {
    const corvette = compileBlueprint(BLUEPRINTS.corvette);
    const gunship = compileBlueprint(BLUEPRINTS.gunship);

    const accel = (d: typeof corvette): number =>
      d.thrusterLayout.maxThrustAlong(1, 0) / d.mass;
    const angularAccel = (d: typeof corvette): number => d.thrusterLayout.maxTorque(1) / d.inertia;
    const heaviestShell = (d: typeof corvette): number =>
      d.turrets.reduce((m, t) => Math.max(m, t.gun.roundMass), 0);

    expect(gunship.mass).toBeGreaterThan(2 * corvette.mass);
    expect(accel(corvette)).toBeGreaterThan(accel(gunship));
    expect(angularAccel(corvette)).toBeGreaterThan(angularAccel(gunship));

    expect(heaviestShell(gunship)).toBeGreaterThan(heaviestShell(corvette));
    expect(gunship.turrets.length).toBeGreaterThan(corvette.turrets.length);
  });
});
