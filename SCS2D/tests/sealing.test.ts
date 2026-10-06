import { describe, expect, it } from 'vitest';
import {
  SEAL_REACH,
  SEAL_SPEED,
  Ships,
  World,
  compileBlueprint,
  moduleProblem,
  moduleStats,
  parseBlueprint,
  serialiseBlueprint,
  type Blueprint,
  type Rng,
} from '../sim/index.js';
import { moduleReadout } from '../editor/stats.js';

const always = { nextFloat: () => 0 } as unknown as Rng;

/** A core and a tank with a lining `sealing` metres thick, and nothing to fly with. */
function drum(sealing: number): Blueprint {
  return {
    name: 'Drum',
    modules: [
      { kind: 'core', x: 0, y: 0, length: 1, width: 1 },
      { kind: 'tank', x: 3.5, y: 0, length: 6, width: 4, sealing },
    ],
  };
}
const TANK = 1;

/** A drum holed in the bow by a round `calibre` wide; how wide the hole is, and its flow, as time goes on. */
function holed(sealing: number, calibre: number): { at: (seconds: number) => { width: number; rate: number } } {
  const design = compileBlueprint(drum(sealing));
  const world = new World({ dt: 1 / 60, seed: 2 });
  const ships = new Ships();
  world.addForceProvider(ships.forceProvider());
  const ship = ships.spawn(world, { design, x: 0, y: 0, team: 0 });
  const body = world.bodies.indexOf(ships.body(ship));
  const tank = design.modules[TANK]!;
  ships.holed(body, TANK, 1, tank.x + tank.spec.length / 2, 0, 1, 0, calibre, always);
  let steps = 0;
  return {
    at(seconds) {
      for (; steps < Math.round(seconds * 60); steps++) {
        ships.command(1 / 60, world);
        world.step();
      }
      const leak = ships.fuel.leaksOf(body)[0]!;
      return { width: leak.width, rate: leak.rate };
    },
  };
}

describe('a sealing lining', () => {
  it('weighs, and takes room from the fuel, but is no armour', () => {
    const bare = moduleStats({ kind: 'tank', x: 0, y: 0, length: 6, width: 4 });
    const lined = moduleStats({ kind: 'tank', x: 0, y: 0, length: 6, width: 4, sealing: 0.05 });
    expect(lined.fuel).toBeLessThan(bare.fuel);
    expect(lined.mass - lined.fuel).toBeGreaterThan(bare.mass - bare.fuel);
    expect(lined.hitPoints).toBe(bare.hitPoints);
    expect(lined.lining).toBe(0.05);
  });

  it('cannot fill the tank', () => {
    expect(moduleProblem({ kind: 'tank', x: 0, y: 0, length: 6, width: 4, sealing: 0.5 })).toBeNull();
    expect(moduleProblem({ kind: 'tank', x: 0, y: 0, length: 6, width: 4, sealing: 2 })).toMatch(/no room/);
    expect(moduleProblem({ kind: 'tank', x: 0, y: 0, length: 6, width: 4, sealing: -0.01 })).toMatch(/at least 0/);
  });

  it('pinches a small hole shut over a moment, not at once', () => {
    const lining = 0.02;
    const width = 0.01;
    const hole = holed(lining, width);
    const first = hole.at(1 / 60);
    const later = hole.at((0.5 * width) / (lining * SEAL_SPEED));
    expect(later.width).toBeLessThan(first.width);
    expect(later.rate).toBeGreaterThan(0);
    expect(later.rate).toBeLessThan(first.rate);
    const shut = hole.at((1.1 * width) / (lining * SEAL_SPEED));
    expect(shut.width).toBe(0);
    expect(shut.rate).toBe(0);
  });

  it('narrows a hole too wide for it, and never closes it', () => {
    const lining = 0.01;
    const width = 0.3;
    const hole = holed(lining, width);
    const settled = hole.at(60);
    expect(settled.width).toBeCloseTo(width - lining * SEAL_REACH, 9);
    expect(settled.rate).toBeGreaterThan(0);
  });

  it('leaves a hole open for good with none', () => {
    const hole = holed(0, 0.01);
    const settled = hole.at(5);
    expect(settled.width).toBe(0.01);
    expect(settled.rate).toBeGreaterThan(0);
  });

  it('is kept by the file format on what holds fuel, and nowhere else', () => {
    const file = serialiseBlueprint(drum(0.02)) as { modules: Record<string, unknown>[] };
    expect(file.modules[TANK]!['sealing']).toBe(0.02);
    const back = parseBlueprint(JSON.parse(JSON.stringify(file)));
    expect((back.modules[TANK] as { sealing?: number }).sealing).toBe(0.02);
    const plate = serialiseBlueprint({
      name: 'Plate',
      modules: [
        { kind: 'core', x: 0, y: 0, length: 1, width: 1 },
        { kind: 'structure', x: 3.5, y: 0, length: 6, width: 4, sealing: 0.02 },
      ],
    }) as { modules: Record<string, unknown>[] };
    expect(plate.modules[1]!['sealing']).toBeUndefined();
  });

  it('is read out in the editor as what it can close and how fast', () => {
    const lined = moduleReadout({ kind: 'tank', x: 0, y: 0, length: 6, width: 4, sealing: 0.02 });
    expect(lined.rows.find(([k]) => k === 'Sealing')?.[1]).toBe('closes a hole up to 200 mm across, 20 mm a second');
    const bare = moduleReadout({ kind: 'tank', x: 0, y: 0, length: 6, width: 4 });
    expect(bare.rows.find(([k]) => k === 'Sealing')?.[1]).toMatch(/none/);
  });
});
