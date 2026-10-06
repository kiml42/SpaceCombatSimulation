import { describe, expect, it } from 'vitest';
import { HullPath, Ships, World, compileBlueprint, resolveRound, type Blueprint } from '../sim/index.js';

/** A long tank ahead of a core, for shooting down the length of. */
const TANKER: Blueprint = {
  name: 'Tanker',
  modules: [
    { kind: 'core', x: 0, y: 0, length: 1, width: 1 },
    { kind: 'tank', x: 10.5, y: 0, length: 20, width: 4 },
  ],
};
const TANK = 1;
const tanker = compileBlueprint(TANKER);

/** A round down the tank's length, with what is left in it set first; its speed out and the tank's damage. */
function through(fill: number, mass: number, calibre: number, speed = 1200): { speed: number; taken: number } {
  const world = new World({ dt: 1 / 60, seed: 1 });
  const ships = new Ships();
  ships.spawn(world, { design: tanker, x: 0, y: 0, team: 0 });
  const full = tanker.modules[TANK]!.stats.fuel;
  ships.fuel.drain(0, 0, full * (1 - fill) + tanker.modules[0]!.stats.fuel);
  // In at the far end of the tank, aft along its axis, and stop at the core.
  const tip = 20.5 - tanker.centreOfMassX + 1;
  const out = resolveRound(
    tanker,
    ships.damage,
    world.bodies,
    0,
    new HullPath(),
    tip,
    0,
    -1,
    0,
    mass,
    calibre,
    speed,
    undefined,
    ships,
  );
  return { speed: out.speed, taken: ships.damage.absorbedAt(0, TANK) };
}

describe('a round through a tank', () => {
  it('is slowed by the fuel in it, the more the fuller', () => {
    const empty = through(0, 20, 0.1);
    const half = through(0.5, 20, 0.1);
    const full = through(1, 20, 0.1);
    expect(half.speed).toBeLessThan(empty.speed);
    expect(full.speed).toBeLessThan(half.speed);
    // What it lost went into the tank.
    expect(full.taken).toBeGreaterThan(empty.taken);
  });

  it('slows a light, wide fragment far more than a heavy shell', () => {
    const shell = through(1, 100, 0.2);
    const fragment = through(1, 1, 0.05);
    const share = (r: { speed: number }, e: { speed: number }): number => r.speed / e.speed;
    expect(share(fragment, through(0, 1, 0.05))).toBeLessThan(share(shell, through(0, 100, 0.2)));
  });

  it('is not slowed by a tank nothing reports the fuel of', () => {
    const world = new World({ dt: 1 / 60, seed: 1 });
    const ships = new Ships();
    ships.spawn(world, { design: tanker, x: 0, y: 0, team: 0 });
    const tip = 20.5 - tanker.centreOfMassX + 1;
    const plain = resolveRound(tanker, ships.damage, world.bodies, 0, new HullPath(), tip, 0, -1, 0, 20, 0.1, 1200);
    expect(plain.speed).toBeCloseTo(through(0, 20, 0.1).speed, 9);
  });
});
