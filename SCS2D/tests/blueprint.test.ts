import { describe, expect, it } from 'vitest';
import {
  blueprintProblem,
  compileBlueprint,
  firingArc,
  modulesOverlap,
  type Blueprint,
} from '../sim/blueprint.js';
import { HALF_PI, PI } from '../sim/math.js';
import { moduleStats, type ModuleSpec } from '../sim/modules.js';
import { BLUEPRINTS } from '../scenarios/blueprints.js';

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
      modules: [structure(0, 0, 10, 4), structure(7, 0, 4, 4)],
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

  it('rejects an empty ship and reports which module is impossible', () => {
    expect(blueprintProblem({ name: 'Nothing', modules: [] })).toMatch(/at least one module/);
    expect(
      blueprintProblem({ name: 'Bad', modules: [structure(0, 0, 10, 4), structure(20, 0, 0, 4)] }),
    ).toMatch(/module 1/);
  });
});

describe('mass properties', () => {
  it('puts the origin on the centre of mass', () => {
    // Two identical boxes, one at the origin and one ten metres up the x axis:
    // the centre of mass is exactly between them, so the compiled positions
    // are ±5 whatever the boxes weigh.
    const design = compileBlueprint({
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
    const design = compileBlueprint({ name: 'Lopsided', modules: [light, heavy] });

    const lm = moduleStats(light).mass;
    const hm = moduleStats(heavy).mass;
    expect(design.centreOfMassX).toBeCloseTo((10 * hm) / (lm + hm), 9);
    expect(design.mass).toBeCloseTo(lm + hm, 6);
  });

  it('carries each module inertia out to where it sits', () => {
    const spec = structure(0, 0, 4, 4);
    const design = compileBlueprint({
      name: 'Dumbbell',
      modules: [spec, structure(10, 0, 4, 4)],
    });

    const one = moduleStats(spec);
    // Parallel axis, by hand: each box's own inertia plus its mass at 5 m.
    expect(design.inertia).toBeCloseTo(2 * (one.inertia + one.mass * 25), 6);
  });

  it('bounds the ship by its furthest corner', () => {
    const design = compileBlueprint({ name: 'One', modules: [structure(0, 0, 10, 4)] });
    expect(design.radius).toBeCloseTo(Math.sqrt(25 + 4), 12);
  });

  it('reaches the radius out to a barrel that protrudes', () => {
    const design = compileBlueprint({
      name: 'Gun',
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
        structure(0, 0, 10, 4),
        { kind: 'thruster', x: -7, y: 0, angle: 0, length: 4, width: 4 },
      ],
    });

    expect(design.thrusters).toHaveLength(1);
    const t = design.thrusters[0]!;
    expect(t.dirX).toBeCloseTo(1, 12);
    expect(t.dirY).toBeCloseTo(0, 12);
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
    expect(firingArc([mount], 0, 8)).toBeCloseTo(PI, 12);
  });

  it('ignores a module beyond the barrel', () => {
    const far = structure(100, 0, 10, 10);
    expect(firingArc([mount, far], 0, 8)).toBeCloseTo(PI, 12);
  });

  it('cuts the arc back to the edge of what fouls it', () => {
    // A wall directly astern, its near corners bearing 135° off the bow: the
    // gun trains freely until it reaches them.
    const wall: ModuleSpec = { kind: 'structure', x: -8, y: 0, length: 8, width: 16 };
    expect(firingArc([mount, wall], 0, 12)).toBeCloseTo(Math.atan2(8, -4), 9);
  });

  it('takes the same arc from the near side when only one side is fouled', () => {
    // A symmetric traverse limit cannot describe an obstruction on one beam
    // only, so the clear side is given up with it. Recorded here because it is
    // a deliberate limitation rather than a rounding artefact.
    const toPort: ModuleSpec = { kind: 'structure', x: 0, y: 6, length: 4, width: 4 };
    const arc = firingArc([mount, toPort], 0, 12);
    expect(arc).toBeLessThan(HALF_PI);
    expect(arc).toBeGreaterThan(0);
  });

  it('gives no arc at all to a gun buried in the hull', () => {
    const ahead = structure(6, 0, 4, 20);
    expect(firingArc([mount, ahead], 0, 12)).toBe(0);
  });
});

describe('the authored blueprints', () => {
  for (const [name, blueprint] of Object.entries(BLUEPRINTS)) {
    describe(name, () => {
      it('is a valid layout', () => {
        expect(blueprintProblem(blueprint)).toBeNull();
      });

      it('compiles to a ship that can fly and shoot', () => {
        const design = compileBlueprint(blueprint);

        expect(design.mass).toBeGreaterThan(0);
        expect(design.inertia).toBeGreaterThan(0);
        expect(design.radius).toBeGreaterThan(0);

        // Every ship must be able to produce force in any direction and torque
        // in either sense; a layout that cannot is one that cannot be flown.
        expect(design.thrusterLayout.hasFullAuthority()).toBe(true);

        expect(design.turrets.length).toBeGreaterThan(0);
        for (const turret of design.turrets) {
          expect(turret.mount.arc).toBeGreaterThan(0);
          expect(turret.mount.maxRate).toBeGreaterThan(0);
          expect(turret.mount.maxAccel).toBeGreaterThan(0);
          expect(turret.gun.muzzleSpeed).toBeGreaterThan(0);
          expect(turret.gun.cycleTime).toBeGreaterThan(0);
        }
      });

      it('is symmetric about its own axis', () => {
        // Every layout here is drawn symmetrically, so the centre of mass must
        // land on the axis. An asymmetric ship would translate when it meant to
        // rotate, which is very hard to spot by eye and easy to author by
        // accident.
        const design = compileBlueprint(blueprint);
        expect(design.centreOfMassY).toBeCloseTo(0, 12);
      });
    });
  }

  it('points every thruster so its exhaust leaves clear air', () => {
    // A thruster pushes along its facing and exhausts the other way, so a
    // mount out on a wing has to push *inboard* or it fires into the wing it
    // is bolted to. Nothing in the simulation stops that — thrust is produced
    // whatever the nozzle is buried in — so a layout drawn the wrong way round
    // flies perfectly well and only looks absurd, which is exactly how it goes
    // unnoticed.
    for (const blueprint of [BLUEPRINTS.corvette, BLUEPRINTS.gunship]) {
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
    for (const blueprint of [BLUEPRINTS.corvette, BLUEPRINTS.gunship]) {
      const design = compileBlueprint(blueprint);

      const thrusterModules = design.modules.filter((m) => m.spec.kind === 'thruster');
      expect(thrusterModules.length).toBe(design.thrusters.length);
      for (let i = 0; i < design.thrusters.length; i++) {
        expect(design.thrusters[i]!.x).toBe(thrusterModules[i]!.x);
        expect(design.thrusters[i]!.y).toBe(thrusterModules[i]!.y);
      }

      const turretModules = design.modules.filter((m) => m.spec.kind === 'turret');
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
