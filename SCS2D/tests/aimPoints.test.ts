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

/**
 * A fighter that puts engines above the guns the default shoots at first, and
 * one that has opted out of picking parts altogether.
 */
const sniper = compileBlueprint({
  ...DINKY,
  doctrine: toDoctrine({ targeting: { engineWeight: 150 } }),
});
const indifferent = compileBlueprint({
  ...DINKY,
  doctrine: toDoctrine({
    targeting: { coreWeight: 0, engineWeight: 0, gunWeight: 0, structureWeight: 0 },
  }),
});
/** A fighter that would rather cripple a ship than go for what flies it. */
const crippler = compileBlueprint({
  ...DINKY,
  doctrine: toDoctrine({ targeting: { coreWeight: 0 } }),
});

interface Aim {
  /** Where the gun ends up pointing, world frame. */
  bearing: number;
  /** Bearing from the gun to the target's centre. */
  toCentre: number;
  /** Bearing to whichever engine of the target is nearest the gun. */
  toNearestEngine: number;
  /** Bearing to whichever of its mounts is nearest the gun. */
  toNearestGun: number;
  /** Bearing to the core it is flown from. */
  toCore: number;
  /** How far off the shooter each of those is, for "which did it pick". */
  rangeOf: (kind: 'thruster' | 'core' | 'gun') => number;
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

  /** The nearest module of one kind, from the shooter: bearing and range. */
  const nearestOf = (wanted: string): { bearing: number; range: number } => {
    let nearest = Infinity;
    let bearing = 0;
    for (const module of gunship.modules) {
      const kind = module.spec.kind;
      const isGun = kind === 'turret' || kind === 'beamTurret';
      const wantedHere =
        wanted === 'thruster' ? kind === 'thruster' : wanted === 'core' ? kind === 'core' : isGun;
      if (!wantedHere) continue;
      const x = bodies.x[b]! + module.x * Math.cos(angle) - module.y * Math.sin(angle);
      const y = bodies.y[b]! + module.x * Math.sin(angle) + module.y * Math.cos(angle);
      const range = Math.hypot(x, y);
      if (range >= nearest) continue;
      nearest = range;
      bearing = bearingTo(x, y);
    }
    return { bearing, range: nearest };
  };

  return {
    bearing: ships.turrets.worldBearing(bodies, ships.turretIndexOf(shooter, 0)),
    toCentre: bearingTo(bodies.x[b]!, bodies.y[b]!),
    toNearestEngine: nearestOf('thruster').bearing,
    toNearestGun: nearestOf('turret').bearing,
    toCore: nearestOf('core').bearing,
    rangeOf: (kind) => nearestOf(kind === 'gun' ? 'turret' : kind).range,
    ships,
    world,
    mark,
  };
}

/** How far off a bearing is, the short way round. */
const off = (a: number, b: number): number => Math.abs(math.angleDelta(a, b));

describe('where a gun aims on a ship', () => {
  it('prefers a core or a gun, then engines, then structure, by default', () => {
    // A ship whose core is out has stopped fighting altogether, and one that
    // cannot shoot has stopped being a threat: worth the same, because a core
    // is worth more only if you can reach it, and the tie-break — whatever is
    // nearest the gun — is what stops a ship drilling the length of a hull to
    // reach a core when there is a turret on the skin in front of it. After
    // those, one that cannot move has stopped being a problem, and structure
    // is what is left when there is nothing better to hit.
    const parts = DEFAULT_DOCTRINE.targeting;
    expect(parts.coreWeight).toBe(parts.gunWeight);
    expect(parts.gunWeight).toBeGreaterThan(parts.engineWeight);
    expect(parts.engineWeight).toBeGreaterThan(parts.structureWeight * 2);

    // And it trains on whichever of the two is nearer to it, which on this
    // capital is a mount on the skin rather than the core well inside it.
    const a = aim(compileBlueprint({ ...DINKY, doctrine: DEFAULT_DOCTRINE }));
    expect(a.rangeOf('gun')).toBeLessThan(a.rangeOf('core'));
    expect(off(a.bearing, a.toNearestGun)).toBeLessThan(0.01);
  });

  it('aims at a gun when its doctrine has no interest in the core', () => {
    // Guns before engines is the order underneath the core, and this is where
    // it shows: a doctrine that has written the core off is back to stripping
    // the ship of what makes it dangerous.
    const a = aim(crippler);
    expect(off(a.bearing, a.toNearestGun)).toBeLessThan(0.01);
    expect(off(a.toNearestGun, a.toNearestEngine)).toBeGreaterThan(0.03);
  });

  it('aims at the ship when its doctrine has opted out of picking parts', () => {
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

  it('leads the ship rather than the part, on a spinning target', () => {
    // A part goes round the centre of mass; it does not fly off along the
    // tangent it happens to be travelling down. Extrapolating that tangent
    // over a long shot throws the aim point clean off the ship — which is why
    // the lead is solved from the hull's own velocity, leaving an error of at
    // most how far the part sits from the centre of mass.
    const world = new World({ dt: DT, seed: 12 });
    const ships = new Ships();
    world.addForceProvider(ships.forceProvider());
    const shooter = ships.spawn(world, { design: sniper, x: 0, y: 0, team: 0 });
    const RANGE = 3000;
    const SPIN = 1;
    const mark = ships.spawn(world, {
      design: gunship,
      x: RANGE,
      y: 0,
      angle: math.PI / 2,
      angularVel: SPIN,
      team: 1,
    });

    // Spun by hand, so the hull turns while its centre stays exactly put:
    // stepping the world would let both craft manoeuvre and take the geometry
    // with them.
    const bodies = world.bodies;
    const b = bodies.indexOf(ships.body(mark));
    for (let i = 0; i < 600; i++) {
      ships.command(DT, world);
      bodies.angle[b] = bodies.angle[b]! + SPIN * DT;
    }

    const bearing = ships.turrets.worldBearing(bodies, ships.turretIndexOf(shooter, 0));
    const toCentre = Math.atan2(bodies.y[b]!, bodies.x[b]!);
    // How much of the sky the ship fills from here. The gun is aiming at one
    // of its engines, so it must be inside that — where the tangent would put
    // it several times further out, since a part twenty-odd metres off the
    // axis at this rate of turn is travelling at tens of metres a second and
    // the shell is nearly five seconds in the air.
    const angularRadius = Math.atan(bodies.radius[b]! / RANGE);
    expect(off(bearing, toCentre)).toBeLessThan(angularRadius);
    expect(SPIN * bodies.radius[b]! * (RANGE / sniper.reach)).toBeGreaterThan(50);
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
