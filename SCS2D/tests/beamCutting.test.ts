import { describe, expect, it } from 'vitest';
import {
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
/** What a real emitter on a real ship puts out, so the rate means something. */
const POWER = beamShip.turrets[0]!.gun.beamPower;

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
        ships.beamHulls,
      );
      impacts.beams(ships.damage, beams, hits, 1 / 60, world.bodies, ships);
      ships.sever(world);
    },
  };
}

/** How far through its worst-cut weld a hull is, 0 untouched and 1 cut free. */
function deepestCut(b: Burn): number {
  const design = b.ships.design(b.target);
  let worst = 0;
  joints(design).forEach((joint, k) => {
    worst = Math.max(worst, b.ships.damage.cutAt(b.body, k) / joint.width);
  });
  return worst;
}

describe('a beam held on a hull', () => {
  it('cuts nothing until it has bored its way in', () => {
    // A beam stopped at the outer plating has crossed no seam: it is making a
    // hole in one module, and a hole in a module is not a cut through a weld.
    const b = burn();
    for (let i = 0; i < 60; i++) b.fire(0);
    expect(deepestCut(b)).toBe(0);
    expect(b.ships.design(b.target).modules).toHaveLength(corvette.modules.length);
  });

  it('burns along every seam its tunnel crosses', () => {
    // Once it is through the first module it is shining along the seams
    // behind it, and it goes on cutting all of them for as long as it is held
    // there.
    const b = burn();
    let deepest = 0;
    for (let i = 0; i < 60 * 20; i++) {
      b.fire(0);
      deepest = Math.max(deepest, deepestCut(b));
    }
    expect(deepest).toBeGreaterThan(0);
  });

  it('cuts a piece off, given long enough', () => {
    const b = burn();
    const before = b.ships.design(b.target).modules.length;
    let cutFree = 0;
    for (let step = 1; step <= 60 * 30 && cutFree === 0; step++) {
      b.fire(0);
      if (b.ships.design(b.target).modules.length < before) cutFree = step;
    }
    // Seconds of held fire, not minutes, and not the first touch.
    expect(cutFree).toBeGreaterThan(60);
    expect(cutFree / 60).toBeLessThan(30);
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
