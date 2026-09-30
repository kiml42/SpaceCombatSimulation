import { describe, expect, it } from 'vitest';
import {
  BOTH_LAYERS,
  compileBlueprint,
  DEFAULT_DOCTRINE,
  fighterProblem,
  HULL_LAYER,
  parseBlueprint,
  ProjectileHits,
  Projectiles,
  Rng,
  serialiseBlueprint,
  Ships,
  SpatialGrid,
  World,
  WEAPONS_LAYER,
  type Blueprint,
} from '../sim/index.js';
import { findContacts, Contacts } from '../sim/collision.js';
import { OrderCancelCondition } from '../sim/ships.js';
import { mutate } from '../evolution/mutate.js';
import { DINKY } from '../scenarios/blueprints.js';

/**
 * Fighters (ROADMAP.md §8 step 7, DESIGN.md §3): strike craft that fly in the
 * weapons layer and drop into the hull layer as well when their doctrine
 * commits them.
 */

const DT = 1 / 60;

/** The Dinky as a strike craft, committing once its target's edge is `radii` of its radius off. */
function fighter(radii = 0): Blueprint {
  return {
    ...DINKY,
    fighter: true,
    doctrine: { ...DEFAULT_DOCTRINE, approach: { ...DEFAULT_DOCTRINE.approach, commitRadii: radii } },
  };
}

const HULK: Blueprint = {
  name: 'Hulk',
  modules: [
    { kind: 'core', x: 0, y: 0, length: 4, width: 4 },
    { kind: 'structure', x: 6, y: 0, length: 8, width: 8 },
  ],
};

describe('a fighter flag', () => {
  it('flies a ship with no turret and nothing thick as a fighter', () => {
    expect(compileBlueprint(fighter()).fighter).toBe(true);
    expect(compileBlueprint(DINKY).fighter).toBe(false);
  });

  it('is ignored on a ship that carries a turret or anything thick', () => {
    const turret: Blueprint = { ...HULK, fighter: true, modules: [...HULK.modules, { kind: 'turret', x: -3.5, y: 0, length: 3, width: 3 }] };
    expect(compileBlueprint(turret).fighter).toBe(false);
    expect(fighterProblem(compileBlueprint(turret).modules.map((m) => m.spec))).toMatch(/no turrets/);
    const thick: Blueprint = { ...HULK, fighter: true, modules: [HULK.modules[0]!, { kind: 'structure', x: 6, y: 0, length: 8, width: 8, thick: true }] };
    expect(compileBlueprint(thick).fighter).toBe(false);
  });

  it('is kept in a file', () => {
    const back = parseBlueprint(serialiseBlueprint(fighter(2)));
    expect(back.fighter).toBe(true);
    expect(back.doctrine!.approach.commitRadii).toBe(2);
  });

  it('can evolve', () => {
    const rng = new Rng(7);
    let flipped = false;
    for (let i = 0; i < 400 && !flipped; i++) flipped = mutate(DINKY, rng).blueprint.fighter === true;
    expect(flipped).toBe(true);
  });
});

describe('a fighter in battle', () => {
  function scene(radii: number, gap: number): { world: World; ships: Ships; craft: number; hulk: number } {
    const world = new World({ dt: DT, seed: 2 });
    const ships = new Ships();
    world.addForceProvider(ships.forceProvider());
    const hulk = ships.spawn(world, { design: compileBlueprint(HULK), x: 0, y: 0, team: 1 });
    const craft = ships.spawn(world, { design: compileBlueprint(fighter(radii)), x: gap, y: 0, team: 0 });
    ships.pushOrder(craft, hulk, 0, 0, 10, OrderCancelCondition.None);
    return { world, ships, craft, hulk };
  }

  function layersOf(s: ReturnType<typeof scene>, ship: number): number {
    return s.ships.layersOf(s.world.bodies.indexOf(s.ships.body(ship)));
  }

  it('flies in the weapons layer until its doctrine commits it', () => {
    const s = scene(0, 80);
    s.ships.command(DT, s.world);
    expect(s.ships.isCommitted(s.craft)).toBe(false);
    expect(layersOf(s, s.craft)).toBe(WEAPONS_LAYER);
  });

  it('commits within its range, clear of every hull', () => {
    const s = scene(20, 80);
    s.ships.command(DT, s.world);
    expect(s.ships.isCommitted(s.craft)).toBe(true);
    expect(layersOf(s, s.craft)).toBe(BOTH_LAYERS);
  });

  it('does not commit while it overlaps a hull', () => {
    const s = scene(20, 4);
    s.ships.command(DT, s.world);
    expect(s.ships.isCommitted(s.craft)).toBe(false);
  });

  /** Whether a round in `layers` flying at the fighter meets it. */
  function struck(committed: boolean, layers: number): boolean {
    const s = scene(committed ? 20 : 0, 80);
    s.ships.command(DT, s.world);
    const grid = new SpatialGrid(64);
    grid.rebuild(s.world.bodies);
    const projectiles = new Projectiles(4);
    const hits = new ProjectileHits();
    projectiles.spawn({ x: 80, y: -40, vx: 0, vy: 1200, width: 0.1, ttl: 1, layers });
    for (let i = 0; i < 10 && hits.count === 0; i++) {
      projectiles.step(DT, s.world.bodies, grid, hits, undefined, s.ships.hulls);
    }
    return hits.count > 0;
  }

  it('is hit by turret fire, and hull fire only once committed', () => {
    expect(struck(false, WEAPONS_LAYER)).toBe(true);
    expect(struck(false, HULL_LAYER)).toBe(false);
    expect(struck(false, BOTH_LAYERS)).toBe(true);
    expect(struck(true, HULL_LAYER)).toBe(true);
  });

  it('overflies a hull until committed', () => {
    const touching = (radii: number): number => {
      const s = scene(radii, 80);
      s.ships.command(DT, s.world);
      // Parked on the hulk's structure, after the decision was made clear of it.
      const b = s.world.bodies.indexOf(s.ships.body(s.craft));
      s.world.bodies.x[b] = 6;
      const contacts = new Contacts();
      findContacts(s.world.bodies, s.ships, contacts);
      return contacts.count;
    };
    expect(touching(0)).toBe(0);
    expect(touching(20)).toBeGreaterThan(0);
  });
});
