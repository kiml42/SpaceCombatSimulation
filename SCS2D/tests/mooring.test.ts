import { describe, expect, it } from 'vitest';
import { mining } from '../scenarios/mining.js';
import { give } from '../scenarios/commands.js';

/** The robots on ship `i`'s body, and how many are out on its rock. */
function crew(run: ReturnType<typeof mining>, i: number): { all: number; away: number } {
  const robots = (run.ships as unknown as { robots: { on(b: number): { away: number }[] | null } }).robots.on(
    run.world.bodies.indexOf(run.ships.body(i)),
  )!;
  return { all: robots.length, away: robots.filter((r) => r.away >= 0).length };
}

/**
 * Part moored ship `i` from its rock as a knock-off does, but without the
 * blow, which at what it takes breaks pieces off the hull as well.
 */
function knockOff(run: ReturnType<typeof mining>, i: number): void {
  (run.ships as unknown as { unpark(...args: unknown[]): void }).unpark(run.world.bodies, i, run.world.tick);
  run.step();
}

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

  it('keeps bringing metal home once its tanks are full, its robots carrying no fuel', () => {
    const { run, miner } = moored();
    const b = run.world.bodies;
    const body = () => b.indexOf(run.ships.body(miner));
    // A moored ship burns nothing, so its tanks fill with what its robots bring off the rock.
    const modules = run.ships.currentStructure(miner).modules;
    for (let m = 0; m < modules.length; m++) run.ships.fuel.add(body(), m, run.ships.fuel.pieceRoom(body(), m));
    const robots = () => (run.ships as unknown as { robots: { on(b: number): { cargoFuel: number }[] | null } }).robots.on(body())!;
    for (let t = 0; t < 120 * 60; t++) run.step();
    const before = run.ships.metal.left(body());
    for (let t = 0; t < 180 * 60 && run.ships.isMoored(miner); t++) run.step();
    expect(run.ships.metal.left(body())).toBeGreaterThan(before);
    expect(Math.max(...robots().map((r) => r.cargoFuel))).toBeLessThan(1);
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

  it('leaves its robots stranded on the rock when parted from it, and takes them back when it moors there again', () => {
    const { run, miner, rock } = moored();
    const before = crew(run, miner);
    expect(before.away).toBeGreaterThan(0);
    knockOff(run, miner);
    run.step();
    expect(run.ships.strandedOn(rock)).toBe(before.away);
    expect(crew(run, miner).all).toBe(before.all - before.away);
    // Back where it was, it takes them aboard, and they walk home across its claw.
    const b = run.world.bodies;
    const claw = run.ships.currentStructure(miner).modules.findIndex((m) => m.spec.kind === 'claw');
    const body = b.indexOf(run.ships.body(miner));
    (run.ships as unknown as { moor(...args: unknown[]): void }).moor(b, miner, rock, claw, b.x[body]!, b.y[body]!);
    run.step();
    expect(run.ships.strandedOn(rock)).toBe(0);
    expect(crew(run, miner).all).toBe(before.all);
    for (let t = 0; t < 120 * 60 && crew(run, miner).away > 0; t++) run.step();
    expect(crew(run, miner).away).toBe(0);
  });

  it('gives stranded robots to a friend moored to the rock with a berth for them', () => {
    const { run, miner, rock } = moored();
    const lost = crew(run, miner).away;
    knockOff(run, miner);
    run.step();
    const friend = run.miners.find((i) => i !== miner)!;
    const b = run.world.bodies;
    const fb = b.indexOf(run.ships.body(friend));
    const ships = run.ships as unknown as {
      robots: { lose(b: number, r: number): void };
      unpark(...args: unknown[]): void;
      moor(...args: unknown[]): void;
    };
    // A friend a robot short, moored to the same rock.
    ships.robots.lose(fb, 0);
    if (run.ships.isMoored(friend)) ships.unpark(b, friend, run.world.tick);
    const claw = run.ships.currentStructure(friend).modules.findIndex((m) => m.spec.kind === 'claw');
    // Gripping a module of the rock, wherever it was left floating.
    const rb = b.indexOf(run.ships.body(rock));
    const grip = run.ships.currentStructure(rock).modules[0]!;
    const c = Math.cos(b.angle[rb]!);
    const sn = Math.sin(b.angle[rb]!);
    ships.moor(b, friend, rock, claw, b.x[rb]! + grip.x * c - grip.y * sn, b.y[rb]! + grip.x * sn + grip.y * c);
    run.step();
    // Its own robots out on the rock it left are stranded there in turn, so its berths take all they can.
    const taken = (run.ships as unknown as { robots: { on(b: number): { away: number }[] } }).robots
      .on(b.indexOf(run.ships.body(friend)))
      .filter((r) => r.away === rock).length;
    expect(taken).toBeGreaterThan(0);
    expect(run.ships.strandedOn(rock)).toBe(lost - taken);
  });
});
