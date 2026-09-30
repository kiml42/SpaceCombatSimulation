import { describe, expect, it } from 'vitest';
import {
  BOTH_LAYERS,
  compileBlueprint,
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
import { mutate } from '../evolution/mutate.js';
import { DINKY } from '../scenarios/blueprints.js';

/**
 * Fighters (ROADMAP.md §8 step 7, DESIGN.md §3): strike craft that fly in the
 * weapons layer and drop into the hull layer as well when their doctrine
 * commits them.
 */

const DT = 1 / 60;

/** The Dinky as a strike craft. */
function fighter(): Blueprint {
  return { ...DINKY, fighter: true };
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
    const back = parseBlueprint(serialiseBlueprint(fighter()));
    expect(back.fighter).toBe(true);
  });

  it('can evolve', () => {
    const rng = new Rng(7);
    let flipped = false;
    for (let i = 0; i < 400 && !flipped; i++) flipped = mutate(DINKY, rng).blueprint.fighter === true;
    expect(flipped).toBe(true);
  });
});

describe('a fighter in battle', () => {
  /** A fighter `gap` off a hulk. */
  function scene(gap: number): { world: World; ships: Ships; craft: number; hulk: number } {
    const world = new World({ dt: DT, seed: 2 });
    const ships = new Ships();
    world.addForceProvider(ships.forceProvider());
    const hulk = ships.spawn(world, { design: compileBlueprint(HULK), x: 0, y: 0, team: 1 });
    const craft = ships.spawn(world, { design: compileBlueprint(fighter()), x: gap, y: 0, team: 0 });
    return { world, ships, craft, hulk };
  }

  it('flies in the weapons layer', () => {
    const s = scene(80);
    expect(s.ships.layersOf(s.world.bodies.indexOf(s.ships.body(s.craft)))).toBe(WEAPONS_LAYER);
  });

  /** Whether a round in `layers` flying at the fighter meets it. */
  function struck(layers: number): boolean {
    const s = scene(80);
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

  it('is hit by turret fire and fragments, and hull fire passes under it', () => {
    expect(struck(WEAPONS_LAYER)).toBe(true);
    expect(struck(BOTH_LAYERS)).toBe(true);
    expect(struck(HULL_LAYER)).toBe(false);
  });

  it('overflies a hull, and meets another fighter', () => {
    const s = scene(6);
    const contacts = new Contacts();
    findContacts(s.world.bodies, s.ships, contacts);
    expect(contacts.count).toBe(0);

    const other = s.ships.spawn(s.world, { design: compileBlueprint(fighter()), x: 6.5, y: 0, team: 1 });
    expect(other).toBeGreaterThan(0);
    findContacts(s.world.bodies, s.ships, contacts);
    expect(contacts.count).toBeGreaterThan(0);
  });
});
