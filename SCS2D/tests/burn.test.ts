import { describe, expect, it } from 'vitest';
import { compileBlueprint, DEFAULT_DOCTRINE, type Blueprint, type Doctrine } from '../sim/index.js';
import { OrderCancelCondition } from '../sim/ships.js';
import { makeBattle } from '../scenarios/battle.js';
import { BARE_CORE, BROADSIDE } from '../scenarios/blueprints.js';

const deg = (d: number): number => (d * Math.PI) / 180;

/** `blueprint` with its approach doctrine changed by `approach`. */
function withApproach(blueprint: Blueprint, approach: Partial<Doctrine['approach']>): Blueprint {
  const doctrine = blueprint.doctrine ?? DEFAULT_DOCTRINE;
  return { ...blueprint, doctrine: { ...doctrine, approach: { ...doctrine.approach, ...approach } } };
}

/**
 * One big engine that pushes it forward and is its only weapon, flame aft:
 * it closes bow first and fights stern first, braking on the flame.
 */
const ONE_ENGINE: Blueprint = withApproach(
  {
    name: 'One engine',
    modules: [
      { kind: 'core', x: 0, y: 0, length: 4, width: 4 },
      { kind: 'engine', x: -2, y: 0, angle: Math.PI, length: 8, width: 4, weapon: true },
      { kind: 'engine', x: 1, y: 2, angle: Math.PI / 2, length: 1, width: 1 },
      { kind: 'engine', x: 1, y: -2, angle: -Math.PI / 2, length: 1, width: 1 },
      { kind: 'engine', x: 2, y: 0, angle: 0, length: 1, width: 1 },
    ],
  },
  { burnWeight: 4, approachSpeed: 150 },
);

/**
 * `blueprint` at the origin facing +x, ordered onto an engineless core 3 km
 * ahead: what it is pointing the target at, off its bow, and whether it is
 * burning, each second.
 */
function fly(blueprint: Blueprint, seconds: number): { off: number; burning: boolean; range: number }[] {
  const run = makeBattle({ seed: 4 }, (ships, world) => {
    const mine = ships.spawn(world, { design: compileBlueprint(blueprint), x: 0, y: 0, team: 0 });
    const them = ships.spawn(world, { design: compileBlueprint(BARE_CORE), x: 3000, y: 0, team: 1 });
    ships.clearOrder(mine);
    ships.pushOrder(mine, them, 300, 500, 150, OrderCancelCondition.None);
    return { mine, them };
  });
  const out: { off: number; burning: boolean; range: number }[] = [];
  const bodies = run.world.bodies;
  for (let s = 0; s < seconds * 60; s++) {
    run.step();
    if (s % 60 !== 59) continue;
    const i = bodies.indexOf(run.ships.body(run.mine));
    const j = bodies.indexOf(run.ships.body(run.them));
    const dx = bodies.x[j]! - bodies.x[i]!;
    const dy = bodies.y[j]! - bodies.y[i]!;
    const d = Math.atan2(dy, dx) - bodies.angle[i]!;
    out.push({ off: Math.atan2(Math.sin(d), Math.cos(d)), burning: run.ships.isBurning(run.mine), range: Math.hypot(dx, dy) });
  }
  return out;
}

describe('turning to burn', () => {
  it('never happens at a burn weight of zero', () => {
    const track = fly(withApproach(BROADSIDE, { burnWeight: 0 }), 20);
    expect(track.some((t) => t.burning)).toBe(false);
    expect(Math.abs(track.at(-1)!.off - Math.PI / 2)).toBeLessThan(deg(10));
  });

  it('turns the Broadside bow on to close, and beam on once it is going fast enough', () => {
    const track = fly(withApproach(BROADSIDE, { burnWeight: 4, approachSpeed: 150 }), 40);
    expect(track[0]!.burning).toBe(true);
    expect(Math.abs(track[1]!.off)).toBeLessThan(deg(10));
    const last = track.at(-1)!;
    expect(last.burning).toBe(false);
    expect(Math.abs(last.off - Math.PI / 2)).toBeLessThan(deg(10));
  });

  it('holds the guns on target against the same push when it is told to mind its range more', () => {
    const track = fly(withApproach(BROADSIDE, { burnWeight: 4, approachSpeed: 150, rangeHold: 100 }), 10);
    expect(track.some((t) => t.burning)).toBe(false);
  });

  it('flies a one-engine ship in bow first and fights it stern first on its flame', () => {
    const track = fly(ONE_ENGINE, 60);
    // Closing: the engine pushes it at the target.
    expect(track[1]!.burning).toBe(true);
    expect(Math.abs(track[1]!.off)).toBeLessThan(deg(15));
    // Arrived: the flame is on the target.
    const arrived = track.filter((t) => t.range < 600);
    expect(arrived.length).toBeGreaterThan(0);
    expect(arrived.some((t) => !t.burning && Math.abs(t.off) > Math.PI - deg(15))).toBe(true);
  });
});
