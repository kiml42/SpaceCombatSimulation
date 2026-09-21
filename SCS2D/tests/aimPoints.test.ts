import { describe, expect, it } from 'vitest';
import {
  compileBlueprint,
  DEFAULT_DOCTRINE,
  math,
  Ships,
  toDoctrine,
  World,
  type ShipDesign,
} from '../sim/index.js';
import { DINKY, GUNSHIP } from '../scenarios/blueprints.js';

/**
 * Which part of a ship to shoot at.
 *
 * A weight per kind of module, and none of them set is the default: a gun
 * with no opinion shoots at the ship rather than at a part of it, because
 * picking a part is picking a smaller thing to miss. The weights earn their
 * keep where crippling is worth more than killing — a fighter that cannot
 * destroy a capital can still strand one, which is what §3's mission kill is
 * for.
 */

const DT = 1 / 60;
const gunship = compileBlueprint(GUNSHIP);

/** A fighter with a stated opinion about where to shoot, and one without. */
const sniper = compileBlueprint({
  ...DINKY,
  doctrine: toDoctrine({ targeting: { engineWeight: 1 } }),
});
const indifferent = compileBlueprint({
  ...DINKY,
  doctrine: DEFAULT_DOCTRINE,
});

interface Aim {
  /** Where the gun ends up pointing, world frame. */
  bearing: number;
  /** Bearing from the gun to the target's centre. */
  toCentre: number;
  /** Bearing to whichever engine of the target is nearest the gun. */
  toNearestEngine: number;
  ships: Ships;
  world: World;
  mark: number;
}

/**
 * One fighter training on a capital held broadside on, so that the ship's
 * centre and its engines are in quite different directions.
 *
 * The world is never stepped, so nothing moves and the bearings the test
 * compares are the ones it set up.
 */
function aim(design: ShipDesign, seconds = 20): Aim {
  const world = new World({ dt: DT, seed: 9 });
  const ships = new Ships();
  world.addForceProvider(ships.forceProvider());
  const shooter = ships.spawn(world, { design, x: 0, y: 0, team: 0 });
  // Broadside: bow to port, so the engines are off one end rather than
  // hidden behind the middle.
  const mark = ships.spawn(world, { design: gunship, x: 300, y: 0, angle: math.PI / 2, team: 1 });

  const steps = Math.ceil(seconds / DT);
  for (let i = 0; i < steps; i++) ships.command(DT, world);

  const bodies = world.bodies;
  const b = bodies.indexOf(ships.body(mark));
  const angle = bodies.angle[b]!;
  const bearingTo = (x: number, y: number): number => Math.atan2(y, x);

  let nearest = Infinity;
  let toNearestEngine = 0;
  for (const module of gunship.modules) {
    if (module.spec.kind !== 'thruster') continue;
    const x = bodies.x[b]! + module.x * Math.cos(angle) - module.y * Math.sin(angle);
    const y = bodies.y[b]! + module.x * Math.sin(angle) + module.y * Math.cos(angle);
    const range = Math.hypot(x, y);
    if (range >= nearest) continue;
    nearest = range;
    toNearestEngine = bearingTo(x, y);
  }

  return {
    bearing: ships.turrets.worldBearing(bodies, ships.turretIndexOf(shooter, 0)),
    toCentre: bearingTo(bodies.x[b]!, bodies.y[b]!),
    toNearestEngine,
    ships,
    world,
    mark,
  };
}

/** How far off a bearing is, the short way round. */
const off = (a: number, b: number): number => Math.abs(math.angleDelta(a, b));

describe('where a gun aims on a ship', () => {
  it('aims at the ship when its doctrine has no opinion about parts', () => {
    const a = aim(indifferent);
    expect(off(a.bearing, a.toCentre)).toBeLessThan(0.01);
    // And the two really are different directions, or this proves nothing.
    expect(off(a.toCentre, a.toNearestEngine)).toBeGreaterThan(0.03);
  });

  it('aims at an engine when its doctrine says engines', () => {
    const a = aim(sniper);
    expect(off(a.bearing, a.toNearestEngine)).toBeLessThan(0.01);
    expect(off(a.bearing, a.toCentre)).toBeGreaterThan(0.03);
  });

  it('takes the engine on the near side rather than one behind the ship', () => {
    // Ties go to whatever is nearest the gun, so a mount aiming for engines
    // does not shoot through the ship to reach one on the far side.
    const a = aim(sniper);
    const bodies = a.world.bodies;
    const b = bodies.indexOf(a.ships.body(a.mark));
    const angle = bodies.angle[b]!;
    let furthest = 0;
    let toFurthest = 0;
    for (const module of gunship.modules) {
      if (module.spec.kind !== 'thruster') continue;
      const x = bodies.x[b]! + module.x * Math.cos(angle) - module.y * Math.sin(angle);
      const y = bodies.y[b]! + module.x * Math.sin(angle) + module.y * Math.cos(angle);
      const range = Math.hypot(x, y);
      if (range <= furthest) continue;
      furthest = range;
      toFurthest = Math.atan2(y, x);
    }
    expect(off(a.bearing, toFurthest)).toBeGreaterThan(off(a.bearing, a.toNearestEngine));
  });

  it('goes back to shooting at the ship once that part is gone', () => {
    // A gun holding its aim on a module that is no longer there would be
    // pointing at empty space beside the target.
    const a = aim(sniper);
    const bodies = a.world.bodies;
    const b = bodies.indexOf(a.ships.body(a.mark));
    const design = a.ships.design(a.mark);
    for (let k = 0; k < design.modules.length; k++) {
      if (design.modules[k]!.spec.kind !== 'thruster') continue;
      a.ships.damage.absorb(b, k, a.ships.damage.capacityLeft(b, k));
      expect(a.ships.damage.spent(b, k)).toBe(true);
    }
    const shooter = 0;
    for (let i = 0; i < 600; i++) a.ships.command(DT, a.world);
    const bearing = a.ships.turrets.worldBearing(bodies, a.ships.turretIndexOf(shooter, 0));
    expect(off(bearing, a.toCentre)).toBeLessThan(0.01);
  });
});
