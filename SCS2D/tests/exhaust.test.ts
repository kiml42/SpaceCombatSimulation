import { describe, expect, it } from 'vitest';
import { Bodies } from '../sim/bodies.js';
import {
  Damage,
  Hulls,
  PLUME_THRUST_PER_AREA,
  Plumes,
  SpatialGrid,
  compileBlueprint,
  plumeReach,
  type ModuleSpec,
  type ShipDesign,
} from '../sim/index.js';

/**
 * What an exhaust does to what it is pointed at.
 *
 * The thing being pinned is that a plume is not scenery: an engine firing into
 * something destroys it, near the nozzle faster than far from it, and stops at
 * the flame's own length.
 */

/** A hull to bolt engines to, wide enough that nothing here is a near miss. */
const hull = (x: number, length: number): ModuleSpec => ({
  kind: 'core',
  x,
  y: 0,
  angle: 0,
  length,
  width: 6,
});

/** An engine mounted at `x`, pushing along `angle` and exhausting the other way. */
const engine = (x: number, angle: number): ModuleSpec => ({
  kind: 'thruster',
  x,
  y: 0,
  angle,
  length: 2,
  width: 4,
});

/**
 * A ship with the engine's exhaust running aft into clear air, and one where a
 * block of structure sits `gap` metres behind the nozzle.
 *
 * The block hangs off a spar running alongside the exhaust rather than
 * floating free, because a module attached to nothing is not a ship and
 * `compileBlueprint` says so. The spar is there whether or not the block is,
 * so the two layouts differ only by what is standing in the flame.
 *
 * The engine is module 0 and the block, where there is one, is module 3 — the
 * indices the tests below name.
 */
function design(gap?: number): ShipDesign {
  const spar: ModuleSpec = {
    kind: 'structure',
    x: -20,
    y: 3.5,
    angle: 0,
    length: 50,
    width: 1,
  };
  const modules: ModuleSpec[] = [engine(-5, 0), hull(0, 10), spar];
  if (gap !== undefined) modules.push({ ...hull(-9 - gap, 4), kind: 'structure' });
  return compileBlueprint({ name: gap === undefined ? 'Clear' : 'Blocked', modules });
}

/** The block a `design(gap)` puts in the flame. */
const BLOCK = 3;

/** The world one of those ships sits alone in, at the origin and facing +x. */
function world(designs: readonly ShipDesign[]) {
  const bodies = new Bodies();
  const damage = new Damage();
  designs.forEach((d, i) => {
    bodies.create({ x: i * 200, y: 0, angle: 0, mass: d.mass, inertia: d.inertia, radius: d.radius });
    damage.register(i, d);
  });
  const grid = new SpatialGrid(64);
  grid.rebuild(bodies);
  return {
    bodies,
    damage,
    grid,
    plumes: new Plumes(),
    hulls: new Hulls({ designOf: (b) => designs[b] ?? null }),
  };
}

/**
 * Burn `design`'s only engine at full throttle for `seconds`, in one call per
 * sixtieth of a second so the distance falloff is sampled the way a battle
 * samples it.
 */
function burn(w: ReturnType<typeof world>, d: ShipDesign, body: number, seconds: number): void {
  const dt = 1 / 60;
  for (let step = 0; step * dt < seconds; step++) {
    w.plumes.burn(d, 0, d.thrusters[0]!.maxThrust, w.damage, w.bodies, body, w.grid, w.hulls, dt);
  }
}

describe('how far a plume reaches', () => {
  it('gives every engine the same reach at full throttle', () => {
    // Thrust scales with exit area, so thrust per unit width is the same for
    // every engine: a bigger engine is a wider flame, not a longer one.
    const reaches = [1, 2, 4, 8].map((width) => {
      const d = compileBlueprint({
        name: 'Engine',
        modules: [engine(-5, 0), hull(0, 10)].map((m, i) => (i === 0 ? { ...m, width } : m)),
      });
      const t = d.thrusters[0]!;
      return plumeReach(t.maxThrust, d.modules[t.module!]!.spec.width);
    });
    for (const reach of reaches) expect(reach).toBeCloseTo(reaches[0]!, 9);
  });

  it('shortens with the throttle, so a low burn is a short flame', () => {
    const d = design();
    const t = d.thrusters[0]!;
    const width = d.modules[t.module!]!.spec.width;
    expect(plumeReach(t.maxThrust * 0.25, width)).toBeCloseTo(
      plumeReach(t.maxThrust, width) * 0.25,
      9,
    );
  });

  it('is nothing for an engine that is not burning', () => {
    expect(plumeReach(0, 4)).toBe(0);
  });
});

describe('what an engine exhausts into', () => {
  // Worked out when the design is compiled, because a hull's geometry is
  // fixed: damage stops a module working without moving it.
  it('is nothing for a nozzle in clear air', () => {
    expect(design().thrusters[0]!.blocks).toBe(-1);
  });

  it('names the module in the way, and how far aft of the nozzle it is', () => {
    const t = design(5).thrusters[0]!;
    expect(t.blocks).toBe(BLOCK);
    expect(t.blockedAt).toBeCloseTo(5, 9);
  });
});

describe('an engine firing into its own ship', () => {
  it('destroys what is in the way, and leaves a clear nozzle alone', () => {
    const blocked = design(0.5);
    const clear = design();

    const w = world([blocked, clear]);
    burn(w, blocked, 0, 30);
    burn(w, clear, 1, 30);

    expect(w.damage.integrity(0, BLOCK)).toBe(0);
    // Nothing else on either ship is touched: the flame is not an explosion.
    expect(w.damage.integrity(0, 0)).toBe(1);
    expect(w.damage.integrity(0, 1)).toBe(1);
    for (let m = 0; m < clear.modules.length; m++) expect(w.damage.integrity(1, m)).toBe(1);
  });

  it('burns harder the nearer the obstruction is to the nozzle', () => {
    const reach = plumeReach(design().thrusters[0]!.maxThrust, 4);
    const at = (gap: number): number => {
      const d = design(gap);
      const w = world([d]);
      burn(w, d, 0, 1);
      return w.damage.absorbedAt(0, BLOCK);
    };
    const near = at(reach * 0.1);
    const far = at(reach * 0.8);
    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(0);
    expect(near).toBeGreaterThan(far * 3);
  });

  it('does nothing to something standing beyond the flame', () => {
    const reach = plumeReach(design().thrusters[0]!.maxThrust, 4);
    const d = design(reach * 1.01);
    const w = world([d]);
    burn(w, d, 0, 30);
    expect(w.damage.integrity(0, BLOCK)).toBe(1);
  });
});

describe('an engine firing at somebody else', () => {
  it('burns the other ship, and only what is at the front of it', () => {
    // A hull parked squarely in the exhaust, a couple of metres back.
    const firing = design();
    const victim = compileBlueprint({ name: 'Victim', modules: [hull(0, 4), hull(-4, 4)] });

    const bodies = new Bodies();
    bodies.create({ x: 0, y: 0, angle: 0, mass: firing.mass, inertia: firing.inertia, radius: firing.radius });
    // Facing the firing ship's stern, close enough to stand in the flame.
    bodies.create({ x: -12, y: 0, angle: 0, mass: victim.mass, inertia: victim.inertia, radius: victim.radius });
    const damage = new Damage();
    damage.register(0, firing);
    damage.register(1, victim);
    const grid = new SpatialGrid(64);
    grid.rebuild(bodies);
    const w = {
      bodies,
      damage,
      grid,
      plumes: new Plumes(),
      hulls: new Hulls({ designOf: (b: number) => [firing, victim][b] ?? null }),
    };

    burn(w, firing, 0, 20);

    // The near face takes it; the module behind it is shielded, spent or not.
    expect(w.damage.integrity(1, 0)).toBeLessThan(1);
    expect(w.damage.integrity(1, 1)).toBe(1);
    for (let m = 0; m < firing.modules.length; m++) expect(w.damage.integrity(0, m)).toBe(1);
  });
});

describe('the plume the renderer draws', () => {
  it('is the plume the simulation burns with', () => {
    // Both take their length from `plumeReach` and their width from the
    // engine's exit, so what is on the screen is what is doing the damage.
    expect(PLUME_THRUST_PER_AREA).toBeGreaterThan(0);
    expect(plumeReach(1e5, 2)).toBe(1e5 / (2 * PLUME_THRUST_PER_AREA));
  });
});
