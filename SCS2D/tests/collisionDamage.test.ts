import { describe, expect, it } from 'vitest';
import { Bodies } from '../sim/bodies.js';
import {
  Contacts,
  Damage,
  HullPath,
  IMPACT_COLLISION,
  Impacts,
  RESTITUTION,
  Ships,
  World,
  compileBlueprint,
  resolveCollision,
  type ShipDesign,
} from '../sim/index.js';
import { CORVETTE, DINKY } from '../scenarios/blueprints.js';

/**
 * What a collision costs the hulls that had it.
 *
 * A bounce gives back only part of the closing speed; the rest of the energy
 * went into folding metal. This is where it lands — at the faces that met,
 * working inward, which is why a ram crushes a nose in rather than putting a
 * neat hole through a ship.
 */

const corvette: ShipDesign = compileBlueprint(CORVETTE);
const dinky: ShipDesign = compileBlueprint(DINKY);

/** One hull at the origin, facing +x, with a damage record. */
function hull(design = corvette): { bodies: Bodies; damage: Damage; path: HullPath } {
  const bodies = new Bodies();
  bodies.create({ x: 0, y: 0, mass: design.mass, inertia: design.inertia, radius: design.radius });
  const damage = new Damage();
  damage.register(0, design);
  return { bodies, damage, path: new HullPath() };
}

/** How many of a hull's modules have taken anything at all. */
function marked(h: ReturnType<typeof hull>, design = corvette): number {
  let n = 0;
  for (let i = 0; i < design.modules.length; i++) {
    if (h.damage.integrity(0, i) < 1) n++;
  }
  return n;
}

describe('crushing a hull', () => {
  it('spends the energy on the metal, starting where it was hit', () => {
    const h = hull();
    // Square on the nose, driving aft.
    const spent = resolveCollision(corvette, h.damage, h.bodies, 0, h.path, corvette.radius, 0, -1, 0, 1e6);
    expect(spent).toBeCloseTo(1e6, 6);
    expect(marked(h)).toBeGreaterThan(0);
  });

  it('reaches deeper the harder it is hit', () => {
    const light = hull();
    resolveCollision(corvette, light.damage, light.bodies, 0, light.path, corvette.radius, 0, -1, 0, 1e6);
    const heavy = hull();
    resolveCollision(corvette, heavy.damage, heavy.bodies, 0, heavy.path, corvette.radius, 0, -1, 0, 1e9);
    expect(marked(heavy)).toBeGreaterThan(marked(light));
  });

  it('crushes what is behind the contact and not what is in front of it', () => {
    // Driving aft from the nose and driving forward from the tail cannot mark
    // the same modules first, or the direction means nothing.
    const fore = hull();
    resolveCollision(corvette, fore.damage, fore.bodies, 0, fore.path, corvette.radius, 0, -1, 0, 2e6);
    const aft = hull();
    resolveCollision(corvette, aft.damage, aft.bodies, 0, aft.path, -corvette.radius, 0, 1, 0, 2e6);

    const hitBoth = corvette.modules.some(
      (_m, i) => fore.damage.integrity(0, i) < 1 && aft.damage.integrity(0, i) < 1,
    );
    expect(marked(fore)).toBeGreaterThan(0);
    expect(marked(aft)).toBeGreaterThan(0);
    expect(hitBoth).toBe(false);
  });

  it('stops when the hull has nothing left to absorb it', () => {
    const h = hull(dinky);
    // Far more than a nine-tonne fighter can take anywhere.
    const spent = resolveCollision(dinky, h.damage, h.bodies, 0, h.path, dinky.radius, 0, -1, 0, 1e12);
    expect(spent).toBeLessThan(1e12);
    expect(spent).toBeGreaterThan(0);
    for (let i = 0; i < dinky.modules.length; i++) {
      // Everything the crush reached is gone, and nothing is over-spent.
      expect(h.damage.integrity(0, i)).toBeGreaterThanOrEqual(0);
    }
  });

  it('does nothing to a body with no hull to crush', () => {
    const h = hull();
    expect(resolveCollision(corvette, h.damage, h.bodies, 0, h.path, 0, 0, 1, 0, 0)).toBe(0);
    expect(marked(h)).toBe(0);
  });
});

describe('a contact, end to end', () => {
  /** Two ships, touching, with one contact between them. */
  function met(impulse: number, closing: number) {
    const world = new World({ dt: 1 / 60, seed: 7 });
    const ships = new Ships();
    const heavy = ships.spawn(world, { design: corvette, x: 0, y: 0, team: 0 });
    // Nose to nose, so the contact point is on both hulls at once.
    const light = ships.spawn(world, { design: dinky, x: corvette.radius + dinky.radius, y: 0, team: 1 });
    const impacts = new Impacts();
    const contacts = new Contacts();
    contacts.push(
      world.bodies.indexOf(ships.body(heavy)),
      world.bodies.indexOf(ships.body(light)),
      corvette.radius,
      0,
      1,
      0,
      0.1,
      0,
      0,
    );
    contacts.impulse[0] = impulse;
    contacts.closing[0] = closing;
    impacts.collisions(ships, ships.damage, world.bodies, contacts);
    return { world, ships, impacts, heavy, light };
  }

  it('costs both hulls the same energy, which is not the same injury', () => {
    // Half each, with no rule about which is the harder: a module's capacity
    // goes with its mass, so what dents a corvette destroys a fighter.
    const m = met(2e6, 60);
    const heavyBody = m.world.bodies.indexOf(m.ships.body(m.heavy));
    const lightBody = m.world.bodies.indexOf(m.ships.body(m.light));

    let heavyDead = 0;
    corvette.modules.forEach((_x, i) => {
      if (m.ships.damage.spent(heavyBody, i)) heavyDead++;
    });
    let lightDead = 0;
    dinky.modules.forEach((_x, i) => {
      if (m.ships.damage.spent(lightBody, i)) lightDead++;
    });
    expect(lightDead).toBeGreaterThan(heavyDead);
  });

  it('spends what the bounce did not give back', () => {
    const closing = 60;
    const impulse = 2e6;
    const m = met(impulse, closing);
    const expected = 0.5 * (1 - RESTITUTION) * closing * impulse;
    expect(m.impacts.log.energy[0]).toBeCloseTo(expected, 3);
    expect(m.impacts.log.kind[0]).toBe(IMPACT_COLLISION);
  });

  it('costs nothing where the hulls were already coming apart', () => {
    const m = met(0, 0);
    expect(m.impacts.log.count).toBe(0);
  });
});
