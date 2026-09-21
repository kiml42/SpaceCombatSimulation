import { describe, expect, it } from 'vitest';
import { Ships, World, compileBlueprint, joints, type ShipDesign } from '../sim/index.js';
import { CORVETTE, DINKY } from '../scenarios/blueprints.js';

/**
 * Wreckage the world stops accounting for.
 *
 * Matter is conserved *within a hull* — that is what makes a battered ship
 * sluggish and its own wreckage free armour (§4) — but not in the world. A
 * shard too smashed to be worth harvesting is never created, and a piece that
 * has drifted out of the fight is let go, with what it weighed counted rather
 * than quietly dropped.
 */

const dinky: ShipDesign = compileBlueprint(DINKY);
const corvette: ShipDesign = compileBlueprint(CORVETTE);

/** A fighter's smallest thruster, and the weld holding it on. */
const SHARD = 9;
const SHARD_JOINT = joints(dinky).findIndex((j) => j.a === 7 && j.b === SHARD);
/** One worth keeping, held on by a weld of its own. */
const KEEPER = 4;
const KEEPER_JOINT = joints(dinky).findIndex((j) => j.a === 0 && j.b === KEEPER);

interface Scene {
  world: World;
  ships: Ships;
  ship: number;
  body: number;
}

function scene(design: ShipDesign = dinky): Scene {
  const world = new World({ dt: 1 / 60, seed: 11 });
  const ships = new Ships();
  const ship = ships.spawn(world, { design, x: 0, y: 0, team: 1 });
  return { world, ships, ship, body: world.bodies.indexOf(ships.body(ship)) };
}

/**
 * Cut exactly one weld through, which parts exactly one piece.
 *
 * Cutting rather than hitting, so that what is under test is what becomes of
 * the piece rather than how many pieces a blow makes.
 */
function breakOff(s: Scene, joint: number): number {
  const all = joints(s.ships.design(s.ship));
  s.ships.damage.cutWeld(s.body, joint, all[joint]!.width);
  return s.ships.sever(s.world);
}

/** Put a body somewhere else, as drifting for a long time would. */
function driftTo(s: Scene, ship: number, x: number): void {
  const b = s.world.bodies;
  b.x[b.indexOf(s.ships.body(ship))] = x;
}

describe('scrap, which is never created', () => {
  it('leaves the smallest pieces out of the world altogether', () => {
    expect(dinky.modules[SHARD]!.stats.mass).toBeLessThan(300);
    const s = scene();
    expect(breakOff(s, SHARD_JOINT)).toBe(0);
    // The ship has still lost it: this is scrap, not a miss.
    expect(s.ships.design(s.ship).modules.length).toBeLessThan(dinky.modules.length);
    expect(s.ships.count).toBe(1);
  });

  it('counts what it threw away rather than dropping it quietly', () => {
    const s = scene();
    expect(s.ships.discarded).toBe(0);
    breakOff(s, SHARD_JOINT);
    expect(s.ships.discarded).toBeGreaterThan(0);
    expect(s.ships.discarded).toBeLessThan(300);
  });

  it('keeps a piece worth keeping', () => {
    const s = scene();
    expect(dinky.modules[KEEPER]!.stats.mass).toBeGreaterThan(300);
    expect(breakOff(s, KEEPER_JOINT)).toBe(1);
    expect(s.ships.count).toBe(2);
    expect(s.ships.discarded).toBe(0);
  });
});

describe('wreckage that has drifted out of the fight', () => {
  function broken(design: ShipDesign = dinky, joint = KEEPER_JOINT) {
    const s = scene(design);
    expect(breakOff(s, joint)).toBe(1);
    return { ...s, piece: s.ship + 1 };
  }

  it('is kept while it is anywhere near', () => {
    const s = broken();
    expect(s.ships.cull(s.world)).toBe(0);
    expect(s.ships.count).toBe(2);
  });

  it('is let go once it is past what a piece that size is worth', () => {
    const s = broken();
    driftTo(s, s.piece, 500_000);
    expect(s.ships.cull(s.world)).toBe(1);
    expect(s.ships.count).toBe(1);
    expect(s.ships.discarded).toBeGreaterThan(0);
    // The body is gone from the world, not merely forgotten by the store.
    expect(s.world.bodies.isAlive(s.ships.body(s.piece))).toBe(false);
  });

  it('lets a light piece go where a heavy one is still worth having', () => {
    // The whole of the rule in one comparison: same distance, different mass.
    const out = 8000;

    const light = broken();
    const heavy = broken(corvette, 0);
    expect(light.ships.design(light.piece).mass).toBeLessThan(
      heavy.ships.design(heavy.piece).mass,
    );

    driftTo(light, light.piece, out);
    driftTo(heavy, heavy.piece, out);
    expect(light.ships.cull(light.world)).toBe(1);
    expect(heavy.ships.cull(heavy.world)).toBe(0);
  });

  it('never lets go of a ship, however far it goes', () => {
    // The battle is wherever the ships are, so taking the ship five thousand
    // kilometres away leaves its own wreckage behind and out of the fight —
    // but the ship is still a ship, and a ship can come back.
    const s = broken();
    driftTo(s, s.ship, 5_000_000);
    s.ships.cull(s.world);
    expect(s.ships.isAlive(s.ship)).toBe(true);
    expect(s.world.bodies.isAlive(s.ships.body(s.ship))).toBe(true);
  });

  it('keeps the wreckage around the last ship standing', () => {
    // The battle area shrinks as ships die and would collapse to a point
    // around a survivor, taking the field with it in one step. A ship that
    // goes back for the wreckage has to find it still there.
    const s = broken();
    driftTo(s, s.piece, 1900);
    expect(s.ships.cull(s.world)).toBe(0);
    expect(s.ships.count).toBe(2);
  });
});
