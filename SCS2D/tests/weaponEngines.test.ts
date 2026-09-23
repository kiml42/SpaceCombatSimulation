import { describe, expect, it } from 'vitest';
import {
  Ships,
  SpatialGrid,
  WEAPON_PLUME_SHARE,
  World,
  compileBlueprint,
  parseBlueprint,
  serialiseBlueprint,
  moduleProblem,
  nozzleReach,
  thrusterGeometry,
  type Blueprint,
  type ModuleSpec,
} from '../sim/index.js';

/**
 * An engine pointed at things on purpose.
 *
 * An exhaust burns whatever stands in it whoever meant it to, so nothing here
 * is about what a plume *does*. It is about when an engine burns: a mount the
 * designer marked as a weapon lights up on its own account when an enemy is
 * close enough behind it to take a real share of the flame, and the ship wears
 * the push that comes with it.
 */

const DT = 1 / 60;

/** A ship that is one engine on a hull, pointing its exhaust along -x. */
function tug(weapon: boolean): Blueprint {
  const engine: ModuleSpec = {
    kind: 'thruster',
    x: -5,
    y: 0,
    angle: 0,
    length: 2,
    width: 4,
  };
  return {
    name: weapon ? 'Armed tug' : 'Tug',
    // Nothing to want. A craft keeps out of its neighbours' way by burning at
    // them, so a hull parked a metre off another one's stern has a reason to
    // fire quite apart from the flag — and this is a test about the flag.
    doctrine: { targeting: {}, approach: { separation: 0 } },
    modules: [
      weapon ? { ...engine, weapon: true } : engine,
      { kind: 'core', x: 0, y: 0, angle: 0, length: 10, width: 6 },
      // Something to push the other way with, so the hull is not obliged to
      // fire the weapon engine merely to hold station.
      { kind: 'thruster', x: 5, y: 0, angle: Math.PI, length: 2, width: 4 },
    ],
  };
}

/**
 * Somebody to stand behind it — a ship rather than a hulk, since a ship that
 * can neither move nor shoot is never worth firing at.
 */
const TARGET: Blueprint = {
  name: 'Target',
  doctrine: { targeting: {}, approach: { separation: 0 } },
  modules: [
    { kind: 'core', x: 0, y: 0, angle: 0, length: 6, width: 6 },
    // Hung off the far face, so it is not itself the thing standing in the
    // plume — a thruster's position is the face it pushes from and its body
    // runs back from there, so this one lies beyond the core rather than in
    // front of it.
    { kind: 'thruster', x: -3, y: 0, angle: 0, length: 2, width: 4 },
  ],
};

/** Where the armed engine's nozzle sits in its ship's own frame, metres. */
function nozzleX(): number {
  const design = compileBlueprint(tug(true));
  const t = design.thrusters[0]!;
  return t.x - t.dirX * design.modules[t.module!]!.spec.length * 0.5;
}

/** How far the target's near face is from its own centre, metres. */
function targetNose(): number {
  const design = compileBlueprint(TARGET);
  let nose = 0;
  for (const m of design.modules) nose = Math.min(nose, m.x - m.spec.length / 2);
  return nose;
}

/** How far behind the nozzle the useful part of the plume ends. */
function usefulReach(): number {
  const design = compileBlueprint(tug(true));
  const t = design.thrusters[0]!;
  // Through the same geometry the burn reads, since a bell decides how far a
  // flame carries: taking it off the module's width alone would measure a
  // plume this engine does not throw.
  const geometry = thrusterGeometry(design.modules[t.module!]!.spec);
  return nozzleReach(geometry, t.maxThrust) * (1 - WEAPON_PLUME_SHARE);
}

/**
 * The armed (or unarmed) tug at the origin facing +x, with a hull `gap` metres
 * behind its nozzle, and what a few seconds of that does.
 *
 * Neither ship is given an order, so nothing wants to burn: what the engine
 * does, it does on its own account. The world is stepped so the push is real,
 * and only for a second — long enough for damage to register and short enough
 * that neither ship's own doctrine has closed the gap the test set.
 */
function standOff(options: { weapon: boolean; gap: number; team: number; seconds?: number }) {
  const design = compileBlueprint(tug(options.weapon));
  const target = compileBlueprint(TARGET);
  const world = new World({ dt: DT, seed: 4 });
  const ships = new Ships();
  world.addForceProvider(ships.forceProvider());
  const grid = new SpatialGrid(64);

  const mine = ships.spawn(world, { design, x: 0, y: 0, team: 0 });
  // Placed off the compiled geometry rather than off the blueprint's own
  // frame, which compiling re-expresses about the centre of mass: the target's
  // near face ends up exactly `gap` metres aft of the nozzle.
  const them = ships.spawn(world, {
    design: target,
    x: nozzleX() - options.gap - -targetNose(),
    y: 0,
    team: options.team,
  });

  const bodies = world.bodies;
  const body = bodies.indexOf(ships.body(mine));
  grid.rebuild(bodies);
  for (let i = 0; i < Math.round((options.seconds ?? 1) * 60); i++) {
    ships.command(DT, world, grid);
    world.step();
    grid.rebuild(bodies);
    ships.scorch(world, grid, DT);
  }

  return {
    ships,
    mine,
    them,
    /** How much the target's only module has lost. */
    hurt: 1 - ships.damage.integrity(bodies.indexOf(ships.body(them)), 0),
    /** Which way the tug has been driven, +x being away from the target. */
    vx: bodies.vx[body]!,
  };
}

describe('an engine marked as a weapon', () => {
  it('burns an enemy that gets close behind it, with nowhere to be', () => {
    const fired = standOff({ weapon: true, gap: 1, team: 1 });
    expect(fired.hurt).toBeGreaterThan(0);
  });

  it('leaves the same enemy alone when it is not marked', () => {
    // The identical layout and the identical approach: the flag is the whole
    // difference, which is what makes it a decision the designer makes.
    const held = standOff({ weapon: false, gap: 1, team: 1 });
    expect(held.hurt).toBe(0);
  });

  it('holds when the target is out past the useful half of the flame', () => {
    const useful = usefulReach();
    expect(standOff({ weapon: true, gap: useful * 0.5, team: 1 }).hurt).toBeGreaterThan(0);
    expect(standOff({ weapon: true, gap: useful * 1.5, team: 1 }).hurt).toBe(0);
  });

  it('holds for one of its own side', () => {
    // The same rule a gun follows: what is in the way decides, not what is
    // being aimed at, and nobody burns a consort that drifts astern.
    expect(standOff({ weapon: true, gap: 1, team: 0 }).hurt).toBe(0);
  });

  it('shoves the ship that fires it, which is what it costs', () => {
    // An engine is an engine. Burning it drives the hull away from what it is
    // burning, and the rest of the layout spends the step fighting that.
    const fired = standOff({ weapon: true, gap: 1, team: 1 });
    const held = standOff({ weapon: false, gap: 1, team: 1 });
    expect(fired.vx).toBeGreaterThan(held.vx);
  });
});

describe('the flag itself', () => {
  it('is refused on anything but an engine', () => {
    expect(
      moduleProblem({ kind: 'turret', x: 0, y: 0, length: 4, width: 3, weapon: true }),
    ).toMatch(/only a thruster/);
    expect(
      moduleProblem({ kind: 'thruster', x: 0, y: 0, length: 2, width: 2, weapon: true }),
    ).toBeNull();
  });

  it('survives a round trip through a blueprint file', () => {
    const back = parseBlueprint(JSON.parse(JSON.stringify(serialiseBlueprint(tug(true)))));
    expect(typeof back).not.toBe('string');
    const modules = (back as Blueprint).modules as ModuleSpec[];
    expect(modules[0]!.weapon).toBe(true);
    expect(modules[2]!.weapon).toBeUndefined();
  });
});
