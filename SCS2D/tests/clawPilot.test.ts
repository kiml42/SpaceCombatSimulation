import { describe, expect, it } from 'vitest';
import { compileBlueprint, DAMAGE_ENERGY_PER_KG, type ModuleSpec, type ShipDesign, type Ships } from '../sim/index.js';
import { makeBattle } from '../scenarios/battle.js';
import { CORVETTE, GUNSHIP, SCAVENGER } from '../scenarios/blueprints.js';
import type { World } from '../sim/world.js';
import { OrderCancelCondition } from '../sim/ships.js';
import { PI } from '../sim/math.js';

/** A pilot taking its claw to wrecks for their fuel (ROADMAP.md §8 step 9). */

const corvette = compileBlueprint(CORVETTE);
const gunship = compileBlueprint(GUNSHIP);
const TANK = 1;
const CLAW = 2;

/** The stock Scavenger with its tanks starting full, so each test says how much room it has. */
function scavenger(scavengeFuelBelow: number, scavengeDanger = 1): ShipDesign {
  const doctrine = compileBlueprint(SCAVENGER).doctrine;
  const modules = SCAVENGER.modules!.map((m) => {
    const { fill: _, ...full } = m as ModuleSpec;
    return full;
  });
  return compileBlueprint({
    ...SCAVENGER,
    modules,
    doctrine: { ...doctrine, approach: { ...doctrine.approach, scavengeFuelBelow, scavengeDanger } },
  });
}

/** Shoot out a hull's cores, leaving a wreck with its tanks full. */
function wreck(ships: Ships, world: World, ship: number): void {
  const body = world.bodies.indexOf(ships.body(ship));
  const design = ships.currentStructure(ship);
  for (const core of design.cores) ships.damage.absorb(body, core, design.modules[core]!.stats.hitPoints * DAMAGE_ENERGY_PER_KG * 0.7);
}

function salvaging(ships: Ships, i: number): number {
  return (ships as unknown as { salvaging: number[] }).salvaging[i]!;
}

interface Scene {
  a: number;
  wrecks: number[];
}

/**
 * A scavenger with `room` kg of room, and a wreck at each of `at`, with
 * `extra` setting up anything else.
 */
function scene(
  design: ShipDesign,
  room: number,
  at: readonly (readonly [number, number])[],
  extra?: (ships: Ships, world: World) => void,
): ReturnType<typeof makeBattle<Scene>> {
  return makeBattle({ seed: 3 }, (ships, world) => {
    const a = ships.spawn(world, { design, x: -400, y: 0, angle: 0 });
    ships.fuel.vent(world.bodies.indexOf(ships.body(a)), TANK, room);
    const wrecks = at.map(([x, y]) => {
      const w = ships.spawn(world, { design: corvette, x, y, angle: 1, team: 1 });
      wreck(ships, world, w);
      return w;
    });
    extra?.(ships, world);
    return { a, wrecks };
  });
}

const holding = (run: ReturnType<typeof scene>, w: number): boolean => run.ships.body(run.a) === run.ships.body(w);
const ownFuel = (run: ReturnType<typeof scene>): number => run.ships.fuel.pieceHeld(run.world.bodies.indexOf(run.ships.body(run.a)), CLAW);

function runUntil(run: ReturnType<typeof scene>, done: () => boolean, seconds: number): void {
  for (let s = 0; s < seconds * 60 && !done(); s++) run.step();
}

describe('a pilot with a claw', () => {
  it('flies to a wreck when it runs low, takes it in its claw and drinks', () => {
    const run = scene(scavenger(0.5), 15_000, [[0, 0]]);
    const before = ownFuel(run);
    runUntil(run, () => holding(run, run.wrecks[0]!), 90);
    expect(holding(run, run.wrecks[0]!)).toBe(true);
    const held = ownFuel(run);
    for (let s = 0; s < 120; s++) run.step();
    expect(ownFuel(run)).toBeGreaterThan(held);
    expect(ownFuel(run)).toBeGreaterThan(before);
  });

  it('lets go full, and leaves what is left', () => {
    const run = scene(scavenger(0.95), 2_000, [[0, 0]]);
    runUntil(run, () => holding(run, run.wrecks[0]!), 90);
    runUntil(run, () => !holding(run, run.wrecks[0]!), 60);
    expect(holding(run, run.wrecks[0]!)).toBe(false);
    const b = run.world.bodies.indexOf(run.ships.body(run.a));
    expect(run.ships.fuel.pieceRoom(b, CLAW)).toBeCloseTo(0, 3);
    for (let s = 0; s < 60; s++) run.step();
    expect(salvaging(run.ships, run.a)).toBe(-1);
  });

  it('stays out of it with doctrine that never refuels', () => {
    const run = scene(scavenger(0), 15_000, [[0, 0]]);
    runUntil(run, () => run.totalWelded > 0, 60);
    expect(run.totalWelded).toBe(0);
    expect(salvaging(run.ships, run.a)).toBe(-1);
  });

  it('waits to run low', () => {
    const run = scene(scavenger(0.5), 2_000, [[0, 0]]);
    for (let s = 0; s < 120; s++) run.step();
    expect(salvaging(run.ships, run.a)).toBe(-1);
  });

  it('goes round a friend in the way of its wreck, rather than through it', () => {
    // A friendly gunship, under control and keeping still, square across the line.
    const still = compileBlueprint({
      ...GUNSHIP,
      doctrine: { ...gunship.doctrine, approach: { ...gunship.doctrine.approach, separation: 0 } },
    });
    const friend = (ships: Ships, world: World): void => {
      ships.spawn(world, { design: still, x: -300, y: 0, angle: PI / 2, team: 0 });
    };
    const run = scene(scavenger(0.5), 15_000, [[0, 0]], friend);
    runUntil(run, () => holding(run, run.wrecks[0]!), 120);
    expect(holding(run, run.wrecks[0]!)).toBe(true);
    expect(run.totalContacts).toBeLessThan(10);
  });

  it('drinking, gets out of the way of a wreck coasting at it', () => {
    // Looking far enough ahead to get clear on its own engines, which are
    // slow; and a second wreck, far off until the first is in its claw.
    const design = scavenger(0.5);
    const watchful = compileBlueprint({
      ...SCAVENGER,
      modules: design.modules.map((m) => m.spec),
      doctrine: { ...design.doctrine, approach: { ...design.doctrine.approach, avoidHorizon: 20 } },
    });
    const run = scene(watchful, 15_000, [
      [0, 0],
      [0, 5000],
    ]);
    runUntil(run, () => holding(run, run.wrecks[0]!), 90);
    expect(holding(run, run.wrecks[0]!)).toBe(true);
    const bodies = run.world.bodies;
    const at = bodies.indexOf(run.ships.body(run.a));
    const hulk = bodies.indexOf(run.ships.body(run.wrecks[1]!));
    // Dead on, a long way short of how far it could have dodged at a standstill.
    bodies.x[hulk] = bodies.x[at]!;
    bodies.y[hulk] = bodies.y[at]! + 800;
    bodies.vx[hulk] = bodies.vx[at]!;
    bodies.vy[hulk] = bodies.vy[at]! - 40;
    let hit = 0;
    for (let s = 0; s < 40 * 60; s++) {
      run.step();
      const c = run.collisions.contacts;
      const mine = bodies.indexOf(run.ships.body(run.a));
      const theirs = bodies.indexOf(run.ships.body(run.wrecks[1]!));
      for (let k = 0; k < c.count; k++) if ((c.a[k] === mine && c.b[k] === theirs) || (c.a[k] === theirs && c.b[k] === mine)) hit++;
    }
    expect(hit).toBe(0);
  });

  it('goes for the nearer of two wrecks alike', () => {
    const run = scene(scavenger(0.5), 15_000, [
      [600, 0],
      [0, 0],
    ]);
    for (let s = 0; s < 120; s++) run.step();
    expect(salvaging(run.ships, run.a)).toBe(run.wrecks[1]);
  });

  it('passes over a wreck going away faster than it can follow for a farther one', () => {
    // The nearer wreck recedes at 40 m/s, past the stock Scavenger's 30.
    const fleeing = (ships: Ships, world: World): void => {
      world.bodies.vx[world.bodies.indexOf(ships.body(1))] = 40;
    };
    const run = scene(
      scavenger(0.5),
      15_000,
      [
        [0, 0],
        [0, -4000],
      ],
      fleeing,
    );
    for (let s = 0; s < 120; s++) run.step();
    expect(salvaging(run.ships, run.a)).toBe(run.wrecks[1]);
  });

  it('passes over a wreck an armed enemy is near for one nobody guards', () => {
    const guard = (ships: Ships, world: World): void => {
      ships.spawn(world, { design: gunship, x: 0, y: 300, angle: 0, team: 1 });
    };
    const wary = scene(
      scavenger(0.5, 4),
      15_000,
      [
        [0, 0],
        [0, -4000],
      ],
      guard,
    );
    for (let s = 0; s < 120; s++) wary.step();
    expect(salvaging(wary.ships, wary.a)).toBe(wary.wrecks[1]);
    // Without the weight the nearer one wins.
    const bold = scene(
      scavenger(0.5, 0),
      15_000,
      [
        [0, 0],
        [0, -4000],
      ],
      guard,
    );
    for (let s = 0; s < 120; s++) bold.step();
    expect(salvaging(bold.ships, bold.a)).toBe(bold.wrecks[0]);
  });

  it('leaves a live friend alone, and does as it is told', () => {
    const run = makeBattle({ seed: 3 }, (ships, world) => {
      const a = ships.spawn(world, { design: scavenger(0.5), x: -400, y: 0, angle: 0 });
      ships.fuel.vent(world.bodies.indexOf(ships.body(a)), TANK, 15_000);
      const friend = ships.spawn(world, { design: corvette, x: 0, y: 0, angle: 1 });
      const w = ships.spawn(world, { design: corvette, x: 0, y: -900, angle: 1, team: 1 });
      wreck(ships, world, w);
      return { a, friend, w };
    });
    for (let s = 0; s < 120; s++) run.step();
    expect(salvaging(run.ships, run.a)).toBe(run.w);
    run.ships.pushOrder(run.a, run.friend, 100, 200, 20, OrderCancelCondition.None);
    run.step();
    expect(salvaging(run.ships, run.a)).toBe(-1);
  });
});
