import { describe, expect, it } from 'vitest';
import { mining } from '../scenarios/mining.js';
import { give } from '../scenarios/commands.js';

/** A Salvager moored to a minor in the Mining scene, after its robots have been at it a while. */
function moored(): { run: ReturnType<typeof mining>; miner: number; rock: number } {
  const run = mining();
  for (let t = 0; t < 120 * 60; t++) run.step();
  const miner = run.miners.find((i) => run.ships.isMoored(i))!;
  return { run, miner, rock: run.ships.parkedCarrier(miner) };
}

describe('a ship moored to an asteroid', () => {
  it('keeps its own body, and its robots bring ore home off the rock', () => {
    const run = mining();
    for (let t = 0; t < 60 * 60 && !run.miners.some((i) => run.ships.isMoored(i)); t++) run.step();
    const miner = run.miners.find((i) => run.ships.isMoored(i))!;
    const rock = run.ships.parkedCarrier(miner);
    const b = run.world.bodies;
    const metal = () => run.ships.metal.left(b.indexOf(run.ships.body(miner)));
    const rockMass = () => b.mass[b.indexOf(run.ships.body(rock))]!;
    const before = metal();
    const mass = rockMass();
    for (let t = 0; t < 240 * 60 && run.ships.isMoored(miner); t++) run.step();
    expect(run.ships.body(miner)).not.toBe(run.ships.body(rock));
    expect(run.ships.currentStructure(miner).modules.some((m) => m.spec.kind === 'rock')).toBe(false);
    expect(metal()).toBeGreaterThan(before);
    expect(rockMass()).toBeLessThan(mass);
  });

  it('lets go once given an order, its robots called in off the rock first', () => {
    const { run, miner } = moored();
    const b = run.world.bodies;
    const robots = () =>
      (run.ships as unknown as { robots: { on(b: number): unknown[] | null } }).robots.on(b.indexOf(run.ships.body(miner)))!.length;
    const crew = robots();
    const other = run.miners.find((i) => i !== miner)!;
    give(run, { kind: 'order', ships: [miner], order: { kind: 'defend', target: other }, append: false });
    for (let t = 0; t < 120 * 60 && run.ships.isMoored(miner); t++) run.step();
    expect(run.ships.isMoored(miner)).toBe(false);
    expect(robots()).toBe(crew);
  });

  it('holds on through a blow its claw can take, and is knocked off by one it cannot', () => {
    const { run, miner } = moored();
    const b = run.world.bodies;
    const body = () => b.indexOf(run.ships.body(miner));
    const at = () => ({ x: b.x[body()]!, y: b.y[body()]! });
    // A tap at its middle stays with the rock.
    const tap = at();
    run.ships.blow(body(), 0, 10, 0, tap.x, tap.y);
    run.step();
    expect(run.ships.isMoored(miner)).toBe(true);
    // A heavy blow at the same place sends it off the rock, moving the way it was hit.
    const hit = at();
    const rockBody = b.indexOf(run.ships.body(run.ships.parkedCarrier(miner)));
    const before = b.vx[body()]! - b.vx[rockBody]!;
    run.ships.blow(body(), 0, 5e7, 0, hit.x, hit.y);
    run.step();
    expect(run.ships.isMoored(miner)).toBe(false);
    expect(b.vx[body()]! - b.vx[rockBody]!).toBeGreaterThan(before + 1);
  });
});
