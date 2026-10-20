import { describe, expect, it } from 'vitest';
import {
  BEAM_ABSORBED_SHARE,
  FLOOR_TRANSPARENCY,
  SHED_AT_BREAK,
  SHED_FLOOR,
  BeamHits,
  Beams,
  Impacts,
  Ships,
  SpatialGrid,
  World,
  compileBlueprint,
  joints,
  type ShipDesign,
} from '../sim/index.js';
import { BEAM_CORVETTE, CORVETTE } from '../scenarios/blueprints.js';

/**
 * A beam cutting a ship apart.
 *
 * A beam carries no momentum, so nothing it does can *tear* anything: it can
 * only leave nothing there to tear. What it does is boil along the seams it
 * shines through until one of them is gone, and whatever was held on by that
 * seam is then simply no longer attached.
 */

const corvette: ShipDesign = compileBlueprint(CORVETTE);
const beamShip: ShipDesign = compileBlueprint(BEAM_CORVETTE);
/**
 * Enough that a hull takes in what a real emitter on a real ship puts out, so
 * the rate means something.
 */
const POWER = beamShip.turrets[0]!.gun.beamPower / BEAM_ABSORBED_SHARE;

interface Burn {
  world: World;
  ships: Ships;
  target: number;
  body: number;
  fire: (y: number) => void;
}

/** A corvette held still, with a beam that can be pointed across it. */
function burn(): Burn {
  const world = new World({ dt: 1 / 60, seed: 5 });
  const ships = new Ships();
  const target = ships.spawn(world, { design: corvette, x: 0, y: 0, team: 1 });
  const body = world.bodies.indexOf(ships.body(target));
  const grid = new SpatialGrid(64);
  const beams = new Beams(8);
  const hits = new BeamHits();
  const impacts = new Impacts();

  return {
    world,
    ships,
    target,
    body,
    fire(y: number): void {
      grid.rebuild(world.bodies);
      beams.clear();
      hits.clear();
      const reach = corvette.radius * 2;
      beams.shoot(
        { startX: -reach, startY: y, endX: reach, endY: y, width: 0.2, power: POWER },
        world.bodies,
        grid,
        hits,
        ships.holedHulls,
      );
      impacts.beams(ships.damage, beams, hits, 1 / 60, world.bodies, ships);
      ships.sever(world);
    },
  };
}

/** How far through its worst-cut weld a hull is, 0 untouched and 1 cut free. */
function deepestCut(b: Burn): number {
  const design = b.ships.currentStructure(b.target);
  let worst = 0;
  joints(design).forEach((joint, k) => {
    worst = Math.max(worst, b.ships.damage.cutAt(b.body, k) / joint.width);
  });
  return worst;
}

describe('a beam held on a hull', () => {
  it('leaves only the share of its power the hull takes in', () => {
    const b = burn();
    b.fire(0);
    let taken = 0;
    for (let m = 0; m < corvette.modules.length; m++) taken += b.ships.damage.absorbedAt(b.body, m);
    expect(taken).toBeCloseTo((POWER * BEAM_ABSORBED_SHARE) / 60, 3);
    expect(BEAM_ABSORBED_SHARE).toBeLessThan(1);
  });

  it('goes on burning a module past breaking, and lets the rest through to the next', () => {
    const b = burn();
    b.fire(0);
    const absorbed = (): number[] => corvette.modules.map((_m, k) => b.ships.damage.absorbedAt(b.body, k));
    const outer = absorbed().findIndex((j) => j > 0);
    // Burn it to its floor, as holed as it gets.
    const capacity = b.ships.damage.capacityLeft(b.body, outer) + b.ships.damage.absorbedAt(b.body, outer);
    b.ships.damage.absorb(b.body, outer, capacity * (SHED_FLOOR / SHED_AT_BREAK));
    expect(b.ships.damage.transparency(b.body, outer)).toBe(FLOOR_TRANSPARENCY);
    const before = absorbed();
    b.fire(0);
    const gained = absorbed().map((j, k) => j - before[k]!);
    const step = (POWER * BEAM_ABSORBED_SHARE) / 60;
    expect(gained[outer]).toBeCloseTo(step * (1 - FLOOR_TRANSPARENCY), 3);
    // What it let through is taken further in.
    const inner = gained.reduce((sum, g, k) => (k === outer ? sum : sum + g), 0);
    expect(inner).toBeGreaterThan(0);
    expect(inner).toBeLessThanOrEqual(step * FLOOR_TRANSPARENCY + 1e-6);
  });

  it('lets nothing through a module until it breaks, and more the more it sheds', () => {
    const b = burn();
    const damage = b.ships.damage;
    const capacity = damage.capacityLeft(b.body, 0);
    expect(damage.transparency(b.body, 0)).toBe(0);
    damage.absorb(b.body, 0, capacity * 0.99);
    expect(damage.transparency(b.body, 0)).toBe(0);
    damage.absorb(b.body, 0, capacity);
    const holed = damage.transparency(b.body, 0);
    expect(holed).toBeGreaterThan(0);
    expect(holed).toBeLessThan(FLOOR_TRANSPARENCY);
    damage.absorb(b.body, 0, capacity * 10);
    expect(damage.transparency(b.body, 0)).toBe(FLOOR_TRANSPARENCY);
  });

  it('cuts nothing until it has bored its way in', () => {
    // A beam stopped at the outer plating has crossed no seam: it is making a
    // hole in one module, and a hole in a module is not a cut through a weld.
    const b = burn();
    for (let i = 0; i < 60; i++) b.fire(0);
    expect(deepestCut(b)).toBe(0);
    expect(b.ships.currentStructure(b.target).modules).toHaveLength(corvette.modules.length);
  });

  it('burns along every seam its tunnel crosses', () => {
    // Once it is through the first module it is shining along the seams
    // behind it, and it goes on cutting all of them for as long as it is held
    // there.
    const b = burn();
    let deepest = 0;
    for (let i = 0; i < 60 * 60; i++) {
      b.fire(0);
      deepest = Math.max(deepest, deepestCut(b));
    }
    expect(deepest).toBeGreaterThan(0);
  });

  it('cuts a piece off, given long enough', () => {
    const b = burn();
    const before = b.ships.currentStructure(b.target).modules.length;
    let cutFree = 0;
    for (let step = 1; step <= 60 * 150 && cutFree === 0; step++) {
      b.fire(0);
      if (b.ships.currentStructure(b.target).modules.length < before) cutFree = step;
    }
    // A minute or two of held fire, the burnt-out plating in front soaking up
    // much of it, and not the first touch.
    expect(cutFree).toBeGreaterThan(60);
    expect(cutFree / 60).toBeLessThan(150);
    expect(b.ships.count).toBe(2);
    expect(b.ships.isDerelict(b.target + 1)).toBe(true);
  });

  it('takes nothing off by shoving, since it has nothing to shove with', () => {
    // The hull it is cutting must not so much as drift: a beam carries no
    // momentum, and severing is otherwise driven entirely by blows.
    const b = burn();
    for (let i = 0; i < 60 * 20; i++) b.fire(0);
    const bodies = b.world.bodies;
    expect(bodies.vx[b.body]).toBe(0);
    expect(bodies.vy[b.body]).toBe(0);
    expect(bodies.angularVel[b.body]).toBe(0);
  });
});

describe('a beam in the weapons layer', () => {
  /** A core with three blocks ahead of it, thick or not, and a beam down them. */
  function deck(thick: boolean): { cut: number; hits: number } {
    const design = compileBlueprint({
      name: 'deck',
      modules: [
        { kind: 'core', x: 0, y: 0, length: 4, width: 4 },
        { kind: 'structure', x: 4, y: 0, length: 4, width: 4, thick },
        { kind: 'structure', x: 8, y: 0, length: 4, width: 4, thick },
        { kind: 'structure', x: 12, y: 0, length: 4, width: 4, thick },
      ],
    });
    const world = new World({ dt: 1 / 60, seed: 5 });
    const ships = new Ships();
    const target = ships.spawn(world, { design, x: 0, y: 0, team: 1 });
    const body = world.bodies.indexOf(ships.body(target));
    const grid = new SpatialGrid(64);
    const beams = new Beams(8);
    const hits = new BeamHits();
    const impacts = new Impacts();
    let landed = 0;
    for (let i = 0; i < 60 * 60; i++) {
      grid.rebuild(world.bodies);
      beams.clear();
      hits.clear();
      beams.shoot(
        { startX: 40, startY: 0, endX: -40, endY: 0, width: 0.2, power: POWER, weaponsLayer: true },
        world.bodies,
        grid,
        hits,
        ships.holedHulls,
      );
      landed += hits.count;
      impacts.beams(ships.damage, beams, hits, 1 / 60, world.bodies, ships);
    }
    let cut = 0;
    joints(ships.currentStructure(target)).forEach((_joint, k) => {
      cut = Math.max(cut, ships.damage.cutAt(body, k));
    });
    return { cut, hits: landed };
  }

  it('burns the seams between thick modules', () => {
    const thick = deck(true);
    expect(thick.hits).toBeGreaterThan(0);
    expect(thick.cut).toBeGreaterThan(0);
  });

  it('passes over a deck with nothing thick on it', () => {
    expect(deck(false)).toEqual({ cut: 0, hits: 0 });
  });
});

describe('a beam through a wreck', () => {
  /** A block hull with another behind it, and a beam down the line of both. */
  function line(holed: boolean): { front: number; back: number; endX: number } {
    const block = compileBlueprint({
      name: 'block',
      modules: [
        { kind: 'core', x: 0, y: 0, length: 4, width: 4 },
        { kind: 'structure', x: 4, y: 0, length: 4, width: 4 },
      ],
    });
    const world = new World({ dt: 1 / 60, seed: 5 });
    const ships = new Ships();
    const wreck = world.bodies.indexOf(ships.body(ships.spawn(world, { design: block, x: 0, y: 0, team: 1 })));
    const behind = world.bodies.indexOf(ships.body(ships.spawn(world, { design: block, x: 40, y: 0, team: 1 })));
    if (holed) {
      for (let m = 0; m < block.modules.length; m++) {
        const capacity = ships.damage.capacityLeft(wreck, m);
        ships.damage.absorb(wreck, m, capacity * (SHED_FLOOR / SHED_AT_BREAK));
      }
    }
    const grid = new SpatialGrid(64);
    grid.rebuild(world.bodies);
    const beams = new Beams(8);
    const hits = new BeamHits();
    const index = beams.shoot(
      { startX: -20, startY: 0, endX: 100, endY: 0, width: 0.2, power: POWER },
      world.bodies,
      grid,
      hits,
      ships.holedHulls,
    );
    let front = 0;
    let back = 0;
    for (let i = 0; i < hits.count; i++) {
      // Only the beam fired, not what it reflects.
      if (hits.beam[i] !== index) continue;
      if (hits.body[i] === wreck) front += hits.share[i]!;
      if (hits.body[i] === behind) back += hits.share[i]!;
    }
    return { front, back, endX: beams.endX[index]! };
  }

  it('stops at a hull that is still whole', () => {
    const { front, back, endX } = line(false);
    expect(front).toBeCloseTo(1, 9);
    expect(back).toBe(0);
    expect(endX).toBeLessThan(10);
  });

  it('carries on out of a holed hull, at what the hull let through, to the next', () => {
    const { front, back, endX } = line(true);
    // Two modules at their floor, each letting half on.
    const through = FLOOR_TRANSPARENCY * FLOOR_TRANSPARENCY;
    expect(front).toBeCloseTo(1 - through, 9);
    expect(back).toBeCloseTo(through, 9);
    // Drawn on to where it stops, in the hull behind.
    expect(endX).toBeGreaterThan(30);
    expect(endX).toBeLessThan(50);
  });
});
