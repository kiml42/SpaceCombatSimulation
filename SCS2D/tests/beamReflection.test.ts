import { describe, expect, it } from 'vitest';
import {
  BEAM_ABSORBED_SHARE,
  BEAM_REFLECTANCE,
  BeamHits,
  Beams,
  MAX_REFLECTIONS,
  MIN_REFLECTED_POWER,
  Ships,
  SpatialGrid,
  World,
  compileBlueprint,
  reflectance,
  type ShipDesign,
} from '../sim/index.js';

/** A beam thrown back off the face of a hull, as a dimmer beam of its own. */

const block: ShipDesign = compileBlueprint({
  name: 'block',
  modules: [
    { kind: 'core', x: 0, y: 0, length: 4, width: 4 },
    { kind: 'structure', x: 4, y: 0, length: 4, width: 4 },
  ],
});

const wall: ShipDesign = compileBlueprint({
  name: 'wall',
  modules: [
    { kind: 'core', x: 0, y: 0, length: 4, width: 2 },
    { kind: 'structure', x: 22, y: 0, length: 40, width: 2 },
    { kind: 'structure', x: -22, y: 0, length: 40, width: 2 },
  ],
});

const POWER = 1e8;

interface Range {
  world: World;
  ships: Ships;
  body: (ship: number) => number;
  fire: (x0: number, y0: number, x1: number, y1: number, power?: number, owner?: number) => { beams: Beams; hits: BeamHits; index: number };
}

function range(place: { design: ShipDesign; x: number; y: number }[]): Range {
  const world = new World({ dt: 1 / 60, seed: 5 });
  const ships = new Ships();
  for (const p of place) ships.spawn(world, { design: p.design, x: p.x, y: p.y, team: 1 });
  world.step();
  const body = (ship: number): number => world.bodies.indexOf(ships.body(ship));
  return {
    world,
    ships,
    body,
    fire(x0, y0, x1, y1, power = POWER, owner) {
      const grid = new SpatialGrid(64);
      grid.rebuild(world.bodies);
      const beams = new Beams(8);
      const hits = new BeamHits();
      const spec = { startX: x0, startY: y0, endX: x1, endY: y1, width: 0.2, power, ...(owner === undefined ? {} : { owner }) };
      const index = beams.shoot(spec, world.bodies, grid, hits, ships.holedHulls);
      return { beams, hits, index };
    },
  };
}

/** The live beams a shot became, other than the one fired. */
function reflections(beams: Beams): number[] {
  const out: number[] = [];
  for (let i = 0; i < beams.highWater; i++) if (beams.alive[i] === 1 && beams.bounces[i]! > 0) out.push(i);
  return out;
}

describe('how much a face reflects', () => {
  it('is BEAM_REFLECTANCE head on, rising to all it would not take in at grazing', () => {
    expect(reflectance(1)).toBeCloseTo(BEAM_REFLECTANCE, 12);
    expect(reflectance(0)).toBeCloseTo(1 - BEAM_ABSORBED_SHARE, 12);
    let last = reflectance(1);
    for (let c = 0.9; c >= 0; c -= 0.1) {
      expect(reflectance(c)).toBeGreaterThanOrEqual(last);
      last = reflectance(c);
    }
  });
});

describe('a beam reflected', () => {
  it('comes straight back off a face met square on, at BEAM_REFLECTANCE of the power, and takes nothing from the damage', () => {
    const r = range([{ design: block, x: 0, y: 0 }]);
    const { beams, hits, index } = r.fire(-40, 0, 100, 0);
    const back = reflections(beams);
    expect(back).toHaveLength(1);
    const b = back[0]!;
    expect(beams.power[b]).toBeCloseTo(POWER * BEAM_REFLECTANCE, 3);
    expect(beams.startX[b]).toBeCloseTo(beams.endX[index]!, 9);
    expect(beams.endX[b]!).toBeLessThan(beams.startX[b]! - 1000);
    expect(Math.abs(beams.endY[b]! - beams.startY[b]!)).toBeLessThan(1e-6);
    // The hull still takes all of the beam fired at it.
    let share = 0;
    for (let i = 0; i < hits.count; i++) if (hits.beam[i] === index) share += hits.share[i]!;
    expect(share).toBeCloseTo(1, 9);
  });

  it('lands on what it is thrown at', () => {
    // At a slant off the block's face; where it goes, put a second block.
    const alone = range([{ design: block, x: 0, y: 0 }]).fire(-40, -20, 60, 30);
    const first = reflections(alone.beams)[0]!;
    const sx = alone.beams.startX[first]!;
    const sy = alone.beams.startY[first]!;
    const dx = alone.beams.endX[first]! - sx;
    const dy = alone.beams.endY[first]! - sy;
    const length = Math.hypot(dx, dy);
    const r = range([
      { design: block, x: 0, y: 0 },
      { design: block, x: sx + (dx / length) * 40, y: sy + (dy / length) * 40 },
    ]);
    const { beams, hits } = r.fire(-40, -20, 60, 30);
    const back = reflections(beams);
    expect(back.length).toBeGreaterThan(0);
    const landed = Array.from({ length: hits.count }, (_v, i) => i).filter((i) => back.includes(hits.beam[i]!) && hits.body[i] === r.body(1));
    expect(landed.length).toBeGreaterThan(0);
    expect(beams.power[back[0]!]!).toBeGreaterThan(POWER * BEAM_REFLECTANCE);
  });

  it('is not followed below MIN_REFLECTED_POWER', () => {
    const r = range([{ design: block, x: 0, y: 0 }]);
    const { beams } = r.fire(-40, 0, 100, 0, (0.9 * MIN_REFLECTED_POWER) / BEAM_REFLECTANCE);
    expect(reflections(beams)).toHaveLength(0);
  });

  it('never lands on the ship that fired it', () => {
    const r = range([
      { design: block, x: 0, y: 0 },
      { design: block, x: -40, y: 0 },
    ]);
    const shooter = r.body(1);
    const { beams, hits } = r.fire(-34, 0, 100, 0, POWER, shooter);
    expect(reflections(beams)).toHaveLength(1);
    for (let i = 0; i < hits.count; i++) expect(hits.body[i]).not.toBe(shooter);
  });

  it('bounces no more than MAX_REFLECTIONS times', () => {
    // Two long walls facing each other, and a beam fired at a slant between them.
    const r = range([
      { design: wall, x: 0, y: 6 },
      { design: wall, x: 0, y: -6 },
    ]);
    const { beams } = r.fire(-40, 0, 40, 30, 1e12);
    let deepest = 0;
    for (const b of reflections(beams)) deepest = Math.max(deepest, beams.bounces[b]!);
    expect(deepest).toBe(MAX_REFLECTIONS);
  });
});
