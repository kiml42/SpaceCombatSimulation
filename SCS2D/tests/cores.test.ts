import { describe, expect, it } from 'vitest';
import {
  Ships,
  World,
  blueprintProblem,
  blueprintProblems,
  compileBlueprint,
  joints,
  type Blueprint,
  type ModuleSpec,
  type ShipDesign,
} from '../sim/index.js';

/**
 * The module a ship is flown from.
 *
 * A core is what makes a layout a ship rather than a hull: it is the anchor
 * the layout rule is stated against, the thing a mission kill is aimed at, and
 * — the reason it exists at all — what decides which piece of a hull that has
 * come apart goes on being a ship. A hull built around two cores and cut
 * between them is two ships.
 */

const DT = 1 / 60;

function structure(x: number, y: number, length: number, width: number): ModuleSpec {
  return { kind: 'structure', x, y, length, width };
}

function core(x: number, y: number, length: number, width: number): ModuleSpec {
  return { kind: 'core', x, y, length, width };
}

/**
 * Two cores with a section of hull between them, which is the layout the
 * whole mechanism exists for: either weld can be cut and what is left on both
 * sides of the cut is still a ship.
 */
const TWIN_CORE: Blueprint = {
  name: 'Twin core',
  modules: [core(-4, 0, 4, 4), structure(0, 0, 4, 4), core(4, 0, 4, 4)],
};

interface Scene {
  world: World;
  ships: Ships;
  ship: number;
  body: number;
}

function scene(design: ShipDesign, spin = 0.2): Scene {
  const world = new World({ dt: DT, seed: 3 });
  const ships = new Ships();
  const ship = ships.spawn(world, { design, x: 0, y: 0, vx: 20, angularVel: spin, team: 2 });
  return { world, ships, ship, body: world.bodies.indexOf(ships.body(ship)) };
}

/** Cut the weld between two modules clean through, which parts them with no blow. */
function cutBetween(s: Scene, a: number, b: number): void {
  const all = joints(s.ships.design(s.ship));
  const index = all.findIndex((joint) => joint.a === a && joint.b === b);
  s.ships.damage.cutWeld(s.body, index, all[index]!.width);
}

describe('a layout needs a core', () => {
  it('refuses one with nothing to fly it', () => {
    const hull: Blueprint = { name: 'Hull', modules: [structure(0, 0, 10, 4)] };
    expect(blueprintProblem(hull)).toMatch(/no core/);
    expect(() => compileBlueprint(hull)).toThrow(/no core/);
  });

  it('says nothing about an empty layout beyond its being empty', () => {
    // One mistake, one complaint: a layout with no modules at all has not
    // also forgotten its core.
    const problems = blueprintProblems({ name: 'Nothing', modules: [] });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/at least one module/);
  });

  it('accepts more than one, which is what redundancy is', () => {
    expect(blueprintProblem(TWIN_CORE)).toBeNull();
    expect(compileBlueprint(TWIN_CORE).cores).toEqual([0, 2]);
  });

  it('is still one ship, so two cores in two pieces is a fault', () => {
    // Both halves would fly perfectly well, which is exactly the point: this
    // is two ships, and two ships are two blueprints.
    const apart: Blueprint = {
      name: 'Pair',
      modules: [core(0, 0, 4, 4), core(40, 0, 4, 4)],
    };
    expect(blueprintProblems(apart)).toEqual([expect.stringMatching(/module 1 touches nothing/)]);
  });

  it('lets a thruster be bolted straight to a core', () => {
    const flown: Blueprint = {
      name: 'Minimal',
      modules: [core(0, 0, 4, 4), { kind: 'thruster', x: -2, y: 0, angle: 0, length: 2, width: 4 }],
    };
    expect(blueprintProblem(flown)).toBeNull();
  });
});

describe('a ship with its core shot out', () => {
  const design = compileBlueprint({
    name: 'One core',
    modules: [
      core(0, 0, 4, 4),
      structure(4, 0, 4, 4),
      { kind: 'turret', x: 8, y: 0, length: 4, width: 4, barrels: 1 },
      { kind: 'thruster', x: -2, y: 0, angle: 0, length: 2, width: 4 },
    ],
  });

  it('is flown while the core is merely damaged', () => {
    const s = scene(design);
    expect(s.ships.hasControl(s.ship)).toBe(true);
    s.ships.damage.absorb(s.body, 0, design.modules[0]!.stats.hitPoints * 0.2);
    expect(s.ships.hasControl(s.ship)).toBe(true);
  });

  it('is a hulk once the core is spent, sound engines and guns notwithstanding', () => {
    const s = scene(design);
    s.ships.damage.absorb(s.body, 0, 1e12);
    expect(s.ships.hasControl(s.ship)).toBe(false);
    // Nothing is wrong with either of them but what would tell them what to do.
    expect(s.ships.design(s.ship).turrets).toHaveLength(1);
    expect(s.ships.isTurretDisabled(s.ship, 0)).toBe(true);
    expect(s.ships.isDisarmed(s.ship)).toBe(true);
    expect(s.ships.hasNoEngines(s.ship)).toBe(true);
    expect(s.ships.isDisabled(s.ship)).toBe(true);
  });

  it('drifts: a ship with nothing flying it does not hold its heading', () => {
    const s = scene(design);
    s.ships.damage.absorb(s.body, 0, 1e12);
    const b = s.world.bodies;
    const spin = b.angularVel[s.body]!;
    const vx = b.vx[s.body]!;
    for (let step = 0; step < 60; step++) {
      s.ships.command(DT, s.world);
      s.world.step();
    }
    expect(b.vx[s.body]).toBeCloseTo(vx, 6);
    expect(b.angularVel[s.body]).toBeCloseTo(spin, 9);
  });
});

describe('a hull cut between its cores', () => {
  it('becomes two ships, each flown, each on the side it was', () => {
    const s = scene(compileBlueprint(TWIN_CORE));
    s.ships.pushOrder(s.ship, 5, 100, 400, 50);
    expect(s.ships.sever(s.world)).toBe(0);

    cutBetween(s, 0, 1);
    expect(s.ships.sever(s.world)).toBe(1);

    const other = s.ship + 1;
    expect(s.ships.design(s.ship).modules).toHaveLength(1);
    expect(s.ships.design(other).modules).toHaveLength(2);
    for (const i of [s.ship, other]) {
      expect(s.ships.isDerelict(i)).toBe(false);
      expect(s.ships.hasControl(i)).toBe(true);
      expect(s.ships.teamOf(i)).toBe(2);
      // Whoever was aboard was given the same plan, and works through it with
      // what is left.
      expect(s.ships.orderCount(i)).toBe(1);
    }
  });

  it('keeps the ship it was with the lowest-numbered core', () => {
    const s = scene(compileBlueprint(TWIN_CORE));
    const id = s.ships.body(s.ship);
    cutBetween(s, 0, 1);
    s.ships.sever(s.world);
    expect(s.ships.body(s.ship)).toBe(id);
    expect(s.ships.design(s.ship).cores).toEqual([0]);
  });

  it('hands the ship to the piece that can still be flown', () => {
    // The first core is wrecked, so the crew — such as it is — is the other
    // one, and the piece holding it is the ship. A wrecked core flies nothing.
    const s = scene(compileBlueprint(TWIN_CORE));
    const id = s.ships.body(s.ship);
    s.ships.damage.absorb(s.body, 0, 1e12);
    cutBetween(s, 0, 1);
    expect(s.ships.sever(s.world)).toBe(1);

    expect(s.ships.body(s.ship)).toBe(id);
    expect(s.ships.design(s.ship).modules).toHaveLength(2);
    expect(s.ships.hasControl(s.ship)).toBe(true);

    const gone = s.ship + 1;
    expect(s.ships.design(gone).modules).toHaveLength(1);
    expect(s.ships.isDerelict(gone)).toBe(true);
  });

  it('is scrap on neither side: a piece that flies is a ship at any mass', () => {
    // Under the mass below which a severed piece is not worth tracking, and
    // kept anyway, because the smallest ship in the game weighs less than
    // that and a ship is never scrap.
    const light = compileBlueprint({
      name: 'Light core',
      modules: [core(0, 0, 4, 4), structure(2.075, 0, 0.15, 0.15)],
    });
    const tip = light.modules[1]!;
    expect(tip.spec.kind).toBe('structure');

    const flown = compileBlueprint({
      name: 'Light second core',
      modules: [core(0, 0, 4, 4), core(2.075, 0, 0.15, 0.15)],
    });
    const chip = flown.modules[1]!.stats.mass;
    expect(chip).toBeLessThan(300);

    const wreckage = scene(light);
    cutBetween(wreckage, 0, 1);
    // Too light to be worth tracking, so it is never put in the world.
    expect(wreckage.ships.sever(wreckage.world)).toBe(0);
    expect(wreckage.ships.count).toBe(1);

    const ship = scene(flown);
    cutBetween(ship, 0, 1);
    expect(ship.ships.sever(ship.world)).toBe(1);
    expect(ship.ships.count).toBe(2);
    expect(ship.ships.isDerelict(ship.ship + 1)).toBe(false);
  });
});
