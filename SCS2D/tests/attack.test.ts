import { describe, expect, it } from 'vitest';
import { AttackArcs, AttackRegion, attackBearing as choose, bestAttackBearings, compileBlueprint, designArcs } from '../sim/index.js';
import { broadside } from '../scenarios/broadside.js';
import { BARE_CORE, BROADSIDE, GUNSHIP, STAR_DESTROYER, TORCH } from '../scenarios/blueprints.js';
import { makeBattle } from '../scenarios/battle.js';
import { OrderCancelCondition } from '../sim/ships.js';

const deg = (d: number): number => (d * Math.PI) / 180;

/** Arcs from `[rest, half-width]` pairs, in degrees, of guns firing at `speed` m/s or `[rest, half, speed]`. */
function arcs(...mounts: ([number, number] | [number, number, number])[]): AttackArcs {
  const out = new AttackArcs();
  for (const [rest, half, speed] of mounts) out.addMount(deg(rest), deg(half), deg(half), speed ?? 1000);
  return out;
}

/** Where in the chosen region to hold the target. */
function attackBearing(a: AttackArcs, current: number, bias: number, rest: number): number {
  return choose(a, current, bias, rest, new AttackRegion()).aim;
}

describe('the attack bearing', () => {
  it('is where the most main guns bear', () => {
    // Two on the port beam, one on the bow: port wins.
    const a = arcs([90, 30], [90, 30], [0, 5]);
    expect(attackBearing(a, 0, 0.5, 0)).toBeCloseTo(deg(90), 9);
  });

  it('is the thrust axis when the guns bear there anyway, or bear everywhere', () => {
    expect(attackBearing(arcs([0, 60], [10, 60]), deg(40), 0.5, 0)).toBe(0);
    expect(attackBearing(arcs([0, 180]), deg(40), 0.5, deg(180))).toBeCloseTo(deg(180), 9);
    expect(attackBearing(new AttackArcs(), deg(40), 0.5, 0)).toBe(0);
  });

  it('takes the nearer of two even batteries', () => {
    const a = arcs([90, 30], [-90, 30]);
    expect(attackBearing(a, deg(60), 0.5, 0)).toBeCloseTo(deg(90), 9);
    expect(attackBearing(a, deg(-60), 0.5, 0)).toBeCloseTo(deg(-90), 9);
  });

  it('turns away from the nearer battery only for more guns than the turn costs', () => {
    // Three to port and one to starboard, with the target on the starboard beam.
    const a = arcs([90, 30], [90, 30], [90, 30], [-90, 30]);
    // Half a turn's worth of difference at 0.5 is half the battery; the gain is too.
    expect(attackBearing(a, deg(-90), 0.4, 0)).toBeCloseTo(deg(90), 9);
    expect(attackBearing(a, deg(-90), 2, 0)).toBeCloseTo(deg(-90), 9);
  });

  it('leads by the harmonic mean of its shot guns\' speeds, and not at all for beams', () => {
    // Two guns at 500 and 1000 m/s fly a metre in 1.5 ms between them, as 667 m/s does.
    expect(choose(arcs([90, 30, 500], [90, 30, 1000]), deg(90), 0.5, 0, new AttackRegion()).speed).toBeCloseTo(2000 / 3, 9);
    expect(choose(arcs([90, 30, 500], [90, 30, -1]), deg(90), 0.5, 0, new AttackRegion()).speed).toBe(500);
    expect(choose(arcs([90, 30, -1]), deg(90), 0.5, 0, new AttackRegion()).speed).toBe(0);
  });

  it('puts the Star Destroyer broadside on, either beam', () => {
    const design = compileBlueprint(STAR_DESTROYER);
    const best = bestAttackBearings(designArcs(design, new AttackArcs()), design.thrustBearing);
    expect(best.length).toBe(2);
    expect(best.every((b) => Math.abs(Math.abs(b.bearing) - Math.PI / 2) < deg(20))).toBe(true);
    expect(best.every((b) => b.guns === 4)).toBe(true);
  });

  it('leaves the gunship and the Torch fighting bow on', () => {
    for (const blueprint of [GUNSHIP, TORCH]) {
      const design = compileBlueprint(blueprint);
      const best = bestAttackBearings(designArcs(design, new AttackArcs()), design.thrustBearing);
      expect(best.length).toBe(1);
      expect(best[0]!.bearing).toBeCloseTo(0, 9);
      expect(best[0]!.guns).toBe(1);
    }
  });

  it('is beside the thrust axis on the Broadside', () => {
    const design = compileBlueprint(BROADSIDE);
    expect(design.thrustBearing).toBe(0);
    const best = bestAttackBearings(designArcs(design, new AttackArcs()), design.thrustBearing);
    expect(best.map((b) => b.bearing)).toEqual([expect.closeTo(deg(90), 9)]);
  });
});

describe('the Broadside', () => {
  it('leads a crossing target with its broadside', () => {
    // An engineless core drifting across its port beam 2 km off: the hull is
    // held ahead of the target's centre, the way it is going.
    // Never turning to burn, so its heading is the attack bearing's alone.
    const doctrine = BROADSIDE.doctrine!;
    const holding = { ...BROADSIDE, doctrine: { ...doctrine, approach: { ...doctrine.approach, burnWeight: 0 } } };
    const off = (vy: number): number => {
      const run = makeBattle({ seed: 4 }, (ships, world) => {
        const mine = ships.spawn(world, { design: compileBlueprint(holding), x: 0, y: 0, angle: -Math.PI / 2, team: 0 });
        const them = ships.spawn(world, { design: compileBlueprint(BARE_CORE), x: 2000, y: 0, vy, team: 1 });
        ships.clearOrder(mine);
        ships.pushOrder(mine, them, 1500, 2500, 0, OrderCancelCondition.None);
        return { mine, them };
      });
      // Two seconds in: long enough to turn, and before it has matched the target's velocity.
      for (let s = 0; s < 120; s++) run.step();
      const bodies = run.world.bodies;
      const i = bodies.indexOf(run.ships.body(run.mine));
      const j = bodies.indexOf(run.ships.body(run.them));
      const towards = Math.atan2(bodies.y[j]! - bodies.y[i]!, bodies.x[j]! - bodies.x[i]!);
      const d = towards - bodies.angle[i]!;
      return Math.atan2(Math.sin(d), Math.cos(d));
    };
    expect(off(0)).toBeCloseTo(Math.PI / 2, 2);
    expect(off(60)).toBeLessThan(Math.PI / 2 - deg(2));
    expect(off(-60)).toBeGreaterThan(Math.PI / 2 + deg(2));
  });

  it('turns its port beam to the enemy it started bow to bow with', () => {
    const run = broadside();
    for (let s = 0; s < 1200; s++) run.step();
    const bodies = run.world.bodies;
    const i = bodies.indexOf(run.ships.body(run.broadside));
    const j = bodies.indexOf(run.ships.body(run.enemy));
    const towards = Math.atan2(bodies.y[j]! - bodies.y[i]!, bodies.x[j]! - bodies.x[i]!);
    let off = towards - bodies.angle[i]!;
    off = Math.atan2(Math.sin(off), Math.cos(off));
    expect(Math.abs(off - Math.PI / 2)).toBeLessThan(deg(10));
  });
});
