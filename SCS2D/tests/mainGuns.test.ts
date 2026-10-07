import { describe, expect, it } from 'vitest';
import {
  compileBlueprint,
  parseBlueprint,
  serialiseBlueprint,
  subDesign,
  World,
  type Blueprint,
  type ModuleSpec,
} from '../sim/index.js';
import { Ships } from '../sim/ships.js';
import { GUNSHIP, STAR_DESTROYER } from '../scenarios/blueprints.js';

/** A core with a big gun on the bow and a small one on the stern, either or both main. */
function twoGuns(bigMain: boolean, smallMain: boolean): Blueprint {
  const big: ModuleSpec = { kind: 'turret', x: 4, y: 0, length: 4, width: 4, barrels: 2 };
  // Holding its fire for close in, so its reach is the shorter.
  const small: ModuleSpec = {
    kind: 'turret',
    x: -3,
    y: 0,
    angle: Math.PI,
    length: 2,
    width: 2,
    targeting: { fireRange: 0.5 },
  };
  if (!bigMain) big.main = false;
  if (!smallMain) small.main = false;
  return {
    name: 'Two guns',
    modules: [{ kind: 'core', x: 0, y: 0, length: 4, width: 4 }, big, small],
  };
}

/** Shoot out the `t`-th mount of a ship. */
function knockOut(ships: Ships, world: World, ship: number, t: number): void {
  const b = world.bodies.indexOf(ships.body(ship));
  const module = ships.design(ship).turrets[t]!.module;
  ships.damage.absorb(b, module, ships.damage.capacityLeft(b, module));
}

describe('main guns', () => {
  it('are every weapon not marked secondary', () => {
    expect(compileBlueprint(twoGuns(true, true)).turrets.every((t) => t.main)).toBe(true);
    expect(compileBlueprint(twoGuns(true, false)).turrets.map((t) => t.main)).toEqual([true, false]);
  });

  it('can be none at all, for a ship with no main armament', () => {
    const design = compileBlueprint(twoGuns(false, false));
    expect(design.turrets.some((t) => t.main)).toBe(false);
    expect(design.reach).toBe(0);
  });

  it('set the ship’s reach, whatever its secondaries reach', () => {
    const all = compileBlueprint(twoGuns(true, true));
    const big = compileBlueprint(twoGuns(true, false));
    const small = compileBlueprint(twoGuns(false, true));
    expect(small.reach).toBeLessThan(big.reach);
    expect(all.reach).toBe(Math.max(big.reach, small.reach));
  });

  it('decide whether the ship is armed', () => {
    const world = new World({ dt: 1 / 60, seed: 1 });
    const ships = new Ships();
    const ship = ships.spawn(world, { design: compileBlueprint(twoGuns(true, false)), x: 0, y: 0, team: 0 });
    world.step();
    expect(ships.isDisarmed(ship)).toBe(false);
    knockOut(ships, world, ship, 0);
    // The secondary still works, and is not enough.
    expect(ships.isTurretDisabled(ship, 1)).toBe(false);
    expect(ships.isDisarmed(ship)).toBe(true);
  });

  it('leave a ship armed on any one gun when every one is main', () => {
    const world = new World({ dt: 1 / 60, seed: 1 });
    const ships = new Ships();
    const ship = ships.spawn(world, { design: compileBlueprint(twoGuns(true, true)), x: 0, y: 0, team: 0 });
    world.step();
    knockOut(ships, world, ship, 0);
    expect(ships.isDisarmed(ship)).toBe(false);
  });

  it('stay secondary on a piece broken off, so its point defence does not become its battery', () => {
    const design = compileBlueprint(twoGuns(true, false));
    const core = design.cores[0]!;
    const small = design.turrets[1]!.module;
    const piece = subDesign(design, [core, small]);
    expect(piece.turrets[0]!.main).toBe(false);
  });

  it('round-trip through a file, and only on a kind that reads them', () => {
    const file = serialiseBlueprint(twoGuns(true, false));
    expect(JSON.stringify(file)).toContain('"main":false');
    expect(parseBlueprint(file).modules[2]).toMatchObject({ main: false });
    const core: Blueprint = { name: 'Core', modules: [{ kind: 'core', x: 0, y: 0, length: 4, width: 4, main: false }] };
    expect(JSON.stringify(serialiseBlueprint(core))).not.toContain('"main"');
  });

  it('count a weapon engine unless it is marked secondary', () => {
    const engine: ModuleSpec = { kind: 'engine', x: 0, y: -2, angle: -Math.PI / 2, length: 2, width: 2, weapon: true };
    const ship = (main: boolean): Blueprint => ({
      ...twoGuns(true, false),
      modules: [...twoGuns(true, false).modules, main ? engine : { ...engine, main: false }],
    });
    expect(compileBlueprint(ship(false)).mainEngines).toEqual([]);
    expect(compileBlueprint(ship(true)).mainEngines).toEqual([0]);
  });

  it('are the spinal gun on the gunship and the heavy turrets on the Star Destroyer', () => {
    const gunship = compileBlueprint(GUNSHIP);
    expect(gunship.turrets.filter((t) => t.main).map((t) => gunship.modules[t.module]!.spec.kind)).toEqual(['hullGun']);
    const destroyer = compileBlueprint(STAR_DESTROYER);
    const heavy = destroyer.turrets.filter((t) => t.main);
    expect(heavy.length).toBe(8);
    expect(heavy.every((t) => destroyer.modules[t.module]!.spec.width === 140)).toBe(true);
  });
});
