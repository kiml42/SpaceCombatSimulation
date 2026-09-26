import { describe, expect, it } from 'vitest';
import { Bodies } from '../sim/bodies.js';
import {
  Damage,
  Hulls,
  DECK_HEIGHT,
  PLUME_CORE_WIDTHS,
  Plumes,
  collimation,
  plumeIntensity,
  SpatialGrid,
  compileBlueprint,
  nozzleReach,
  plumeReach,
  rayOffset,
  rayReach,
  thrusterGeometry,
  type ModuleSpec,
  type ShipDesign,
} from '../sim/index.js';
import { moduleReadout } from '../editor/stats.js';
import { THRUST_PER_EXIT_AREA } from '../sim/modules.js';

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
/** How far the engine on a `design` throws at full throttle. */
function fullReach(d: ShipDesign): number {
  return nozzleReach(thrusterGeometry(d.modules[0]!.spec), d.thrusters[0]!.maxThrust);
}

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

/**
 * Where the engine's nozzle sits in its ship's own frame — which compiling
 * re-expresses about the centre of mass, so it is never where the blueprint
 * put it.
 */
function nozzle(d: ShipDesign): { x: number; y: number; width: number } {
  const t = d.thrusters[0]!;
  const spec = d.modules[t.module!]!.spec;
  return { x: t.x - t.dirX * spec.length * 0.5, y: t.y - t.dirY * spec.length * 0.5, width: spec.width };
}

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
  it('throws a flame as long as its nozzle is wide, so a bigger engine reaches further', () => {
    // A jet runs a fixed number of its own widths before it mixes away, so an
    // engine scaled up bodily throws a proportionally longer flame. Scaled
    // rather than merely widened, because the bell is part of the shape — a
    // wide flare on a short engine is a different nozzle, not a big one.
    const reaches = [1, 2, 4, 8].map((scale) => {
      const d = compileBlueprint({
        name: 'Engine',
        modules: [{ ...engine(-5, 0), length: scale, width: 2 * scale }, hull(0, 10)],
      });
      const t = d.thrusters[0]!;
      return nozzleReach(thrusterGeometry(d.modules[t.module!]!.spec), t.maxThrust);
    });
    reaches.forEach((reach, i) => expect(reach).toBeCloseTo(reaches[0]! * [1, 2, 4, 8][i]!, 9));
  });

  it('carries further for more bell on the same machinery', () => {
    // A longer bell collimates the gas, so the flame holds together further
    // out — bought with length, since the machinery behind it is unchanged.
    const reach = (bell: number): number => {
      const spec: ModuleSpec = { ...engine(-5, 0), length: 1 + bell, width: 2, nozzle: bell / (1 + bell) };
      const d = compileBlueprint({ name: 'Engine', modules: [spec, hull(0, 10)] });
      const t = d.thrusters[0]!;
      return nozzleReach(thrusterGeometry(d.modules[t.module!]!.spec), t.maxThrust);
    };
    expect(reach(2)).toBeGreaterThan(reach(0.5) * 1.3);
    expect(reach(4)).toBeGreaterThan(reach(2));
  });

  it('splits into shorter, fiercer flames across more nozzles, and loses no thrust doing it', () => {
    // Each nozzle is fed at the same pressure through a narrower exit, so its
    // flame is shorter; its bell is narrower for the same length, so the gas
    // is better aimed and the engine as a whole pushes a little harder.
    const built = (barrels: number) => {
      const d = compileBlueprint({
        name: 'Engine',
        modules: [{ ...engine(-5, 0), length: 4, width: 4, barrels }, hull(0, 10)],
      });
      const t = d.thrusters[0]!;
      const geometry = thrusterGeometry(d.modules[t.module!]!.spec);
      return {
        thrust: t.maxThrust,
        reach: nozzleReach(geometry, t.maxThrust),
        intensity: plumeIntensity(geometry, t.maxThrust),
      };
    };
    const one = built(1);
    const four = built(4);
    expect(four.reach).toBeLessThan(one.reach * 0.5);
    expect(four.intensity).toBeGreaterThan(one.intensity * 2);
    expect(four.thrust).toBeGreaterThanOrEqual(one.thrust);
  });

  it('reaches furthest from a long bell, but not from one with nothing behind it', () => {
    // Gas leaving a divergent nozzle is already flying apart, so it spreads to
    // nothing close in — and what there is to throw is whatever the machinery
    // behind it can feed. Collimation counts for more in the flame than in the
    // thrust, so the flame peaks at a longer bell than the thrust does, but
    // still inside: a bell with no chamber behind it has nothing to throw.
    const reach = (nozzle: number): number => {
      const d = compileBlueprint({
        name: 'Engine',
        modules: [{ ...engine(-5, 0), nozzle }, hull(0, 10)],
      });
      const t = d.thrusters[0]!;
      return nozzleReach(thrusterGeometry(d.modules[t.module!]!.spec), t.maxThrust);
    };
    expect(reach(0.3)).toBeGreaterThan(reach(0.05) * 1.3);
    expect(reach(0.6)).toBeGreaterThan(reach(0.3));
    expect(reach(0.9)).toBeLessThan(reach(0.6) * 0.5);
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
  it('is nothing for a nozzle in clear air, on any of its rays', () => {
    const t = design().thrusters[0]!;
    expect(t.blocks).toEqual([-1, -1, -1]);
    expect(t.escaping).toBe(1);
  });

  it('names the module in the way, and how far aft of the nozzle it is', () => {
    const t = design(5).thrusters[0]!;
    expect(t.blocks).toEqual([BLOCK, BLOCK, BLOCK]);
    for (const at of t.blockedAt!) expect(at).toBeCloseTo(5, 9);
  });

  it('costs the thrust of every ray it stops, and no more', () => {
    // A ray that runs into the ship hands its momentum back to the hull it was
    // pushing, so that third of the engine is not thrust at all.
    const reach = fullReach(design());
    // Well inside the side rays' own reach, so all three are stopped.
    expect(design(reach * 0.1).thrusters[0]!.escaping).toBe(0);
    // Past where the side rays end but inside the core's, so only the core is.
    expect(design(reach * 0.5).thrusters[0]!.escaping).toBeCloseTo(2 / 3, 9);
    // Past the flame altogether: nothing is in it to stop.
    expect(design(reach * 1.1).thrusters[0]!.escaping).toBe(1);
  });

  it('is what the layout flies on, so a buried engine is a weak one', () => {
    const reach = fullReach(design());
    const clear = design().thrusterLayout.maxThrustAlong(1, 0);
    const buried = design(reach * 0.1).thrusterLayout.maxThrustAlong(1, 0);
    expect(clear).toBeGreaterThan(0);
    expect(buried).toBe(0);
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
    const reach = fullReach(design());
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
    const d0 = design();
    const reach = nozzleReach(thrusterGeometry(d0.modules[0]!.spec), d0.thrusters[0]!.maxThrust);
    const d = design(reach * 1.01);
    const w = world([d]);
    burn(w, d, 0, 30);
    expect(w.damage.integrity(0, BLOCK)).toBe(1);
  });
});

describe('the three rays a plume is sampled by', () => {
  it('reach the flame\'s edge at their own offset, so the core reaches furthest', () => {
    // Derived from the drawn plume rather than chosen: the flame is a triangle
    // narrowing to a point, so a ray a third of the width off the axis ends a
    // third of the way out.
    const one = thrusterGeometry({ ...engine(0, 0), width: 6 });
    const force = 1e6;
    const reach = nozzleReach(one, force);
    expect(reach).toBeGreaterThan(0);
    expect(rayReach(1, one, force)).toBeCloseTo(reach, 9);
    expect(rayReach(0, one, force)).toBeCloseTo(reach / 3, 9);
    expect(rayReach(2, one, force)).toBeCloseTo(reach / 3, 9);
  });

  it('are spread across the nozzle, not stacked on its axis', () => {
    const one = thrusterGeometry({ ...engine(0, 0), width: 6 });
    expect([0, 1, 2].map((ray) => rayOffset(ray, one))).toEqual([-2, 0, 2]);
  });

  it('give every nozzle of a cluster three of its own', () => {
    // A cluster is a row of separate flames, so three rays stretched across
    // the whole face would fall in the gaps between them rather than in the
    // fire. Two nozzles across six metres are three metres each, centred a
    // metre and a half either side.
    const two = thrusterGeometry({ ...engine(0, 0), width: 6, barrels: 2 });
    expect([0, 1, 2, 3, 4, 5].map((ray) => rayOffset(ray, two))).toEqual([
      -2.5, -1.5, -0.5, 0.5, 1.5, 2.5,
    ]);
  });

  it('catch a hull beside the axis that a single ray down the middle misses', () => {
    // The whole reason there is more than one. The target is offset far enough
    // that nothing on the axis meets it, and close enough that a side ray does.
    const firing = design();
    const victim = compileBlueprint({ name: 'Victim', modules: [hull(0, 4), hull(-4, 4)] });
    const at = nozzle(firing);

    const bodies = new Bodies();
    bodies.create({ x: 0, y: 0, angle: 0, mass: firing.mass, inertia: firing.inertia, radius: firing.radius });
    // Clear of the axis by more than the victim's half-width, so nothing down
    // the middle of the flame can reach it.
    bodies.create({
      x: at.x - 4,
      y: at.y + 4,
      angle: 0,
      mass: victim.mass,
      inertia: victim.inertia,
      radius: victim.radius,
    });
    const damage = new Damage();
    damage.register(0, firing);
    damage.register(1, victim);
    const grid = new SpatialGrid(64);
    grid.rebuild(bodies);
    const hulls = new Hulls({ designOf: (b: number) => [firing, victim][b] ?? null });
    const plumes = new Plumes();

    const thrust = firing.thrusters[0]!.maxThrust;
    expect(plumes.cast(firing, 0, 1, thrust, bodies, 0, grid, hulls)).toBe(false);
    const outer =
      plumes.cast(firing, 0, 0, thrust, bodies, 0, grid, hulls) ||
      plumes.cast(firing, 0, 2, thrust, bodies, 0, grid, hulls);
    expect(outer).toBe(true);
    expect(plumes.body).toBe(1);
  });
});

describe('the push a plume carries', () => {
  /** One engine burning on a hull placed `atY` off its axis, and what it does. */
  function blast(atY: number) {
    const firing = design();
    const victim = compileBlueprint({ name: 'Victim', modules: [hull(0, 4), hull(-4, 4)] });
    const at = nozzle(firing);
    const bodies = new Bodies();
    bodies.create({ x: 0, y: 0, angle: 0, mass: firing.mass, inertia: firing.inertia, radius: firing.radius });
    bodies.create({
      x: at.x - 5,
      y: at.y + atY,
      angle: 0,
      mass: victim.mass,
      inertia: victim.inertia,
      radius: victim.radius,
    });
    const damage = new Damage();
    damage.register(0, firing);
    damage.register(1, victim);
    const grid = new SpatialGrid(64);
    grid.rebuild(bodies);
    const hulls = new Hulls({ designOf: (b: number) => [firing, victim][b] ?? null });
    const plumes = new Plumes();
    const dt = 1 / 60;
    for (let step = 0; step < 60; step++) {
      plumes.burn(firing, 0, firing.thrusters[0]!.maxThrust, damage, bodies, 0, grid, hulls, dt);
    }
    return { vx: bodies.vx[1]!, vy: bodies.vy[1]!, spin: bodies.angularVel[1]! };
  }

  it('drives what it lands on away from the nozzle', () => {
    // The exhaust's own momentum arriving, so it acts along the exhaust.
    expect(blast(0).vx).toBeLessThan(0);
  });

  it('spins a hull it catches off centre, and one square on hardly at all', () => {
    // A plume on a flank is a couple as well as a push, which is what lets an
    // engine shove a ship off a firing solution rather than merely away.
    expect(Math.abs(blast(2).spin)).toBeGreaterThan(Math.abs(blast(0).spin) + 1e-9);
  });

  it('pushes nothing when the ray is buried in its own ship', () => {
    // That momentum was taken off the engine's thrust when the design was
    // compiled, so paying it again here would be a ship pushing itself.
    const reach = fullReach(design());
    const d = design(reach * 0.1);
    const w = world([d]);
    const before = w.bodies.vx[0]!;
    burn(w, d, 0, 5);
    expect(w.bodies.vx[0]!).toBe(before);
    // It still burns what it is buried in.
    expect(w.damage.integrity(0, BLOCK)).toBeLessThan(1);
  });
});

describe('an engine firing at somebody else', () => {
  it('burns the other ship, and only what is at the front of it', () => {
    // A hull parked squarely in the exhaust, a couple of metres back.
    const firing = design();
    const victim = compileBlueprint({ name: 'Victim', modules: [hull(0, 4), hull(-4, 4)] });

    const bodies = new Bodies();
    bodies.create({ x: 0, y: 0, angle: 0, mass: firing.mass, inertia: firing.inertia, radius: firing.radius });
    // Facing the firing ship's stern, close enough to stand in the flame —
    // which is a couple of metres rather than ten, an engine's flame being as
    // long as what its machinery can feed through its bell.
    bodies.create({ x: -9, y: 0, angle: 0, mass: victim.mass, inertia: victim.inertia, radius: victim.radius });
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
    // engine's exit, so what is on the screen is what is doing the damage: at
    // design pressure through a perfect bell, the constant's own widths.
    const width = 2;
    const force = width * DECK_HEIGHT * THRUST_PER_EXIT_AREA;
    expect(plumeReach(force, width)).toBeCloseTo(PLUME_CORE_WIDTHS * width, 9);
    expect(plumeReach(force * 0.9, width, 0.9)).toBeCloseTo(PLUME_CORE_WIDTHS * width * collimation(0.9), 9);
  });
});

describe('what the editor says about a buried engine', () => {
  it('reports what a clear engine throws, and nothing about the ship', () => {
    const layout = tug(30);
    const row = moduleReadout(layout[0]!, layout, 0).rows.find(([k]) => k === 'Thrust');
    expect(row?.[1]).not.toMatch(/fires into the ship/);
  });

  it('reports what a blocked one actually delivers, and says why', () => {
    // The feedback the envelope cannot give: which engine is paying.
    const layout = tug(1);
    const row = moduleReadout(layout[0]!, layout, 0).rows.find(([k]) => k === 'Thrust');
    expect(row?.[1]).toMatch(/of .* MN — the rest fires into the ship/);
  });
});

/** An engine on a hull, with a block `gap` metres behind its nozzle. */
function tug(gap: number): ModuleSpec[] {
  return [
    { kind: 'thruster', x: -5, y: 0, angle: 0, length: 2, width: 4 },
    { kind: 'core', x: 0, y: 0, angle: 0, length: 10, width: 6 },
    { kind: 'structure', x: -9 - gap, y: 0, angle: 0, length: 4, width: 6 },
  ];
}
