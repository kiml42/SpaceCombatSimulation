import { describe, expect, it } from 'vitest';
import { compileBlueprint, DEFAULT_DOCTRINE, type Blueprint, type Placement } from '../sim/index.js';
import { OrderCancelCondition } from '../sim/ships.js';
import { makeBattle } from '../scenarios/battle.js';
import { CORVETTE, GUNSHIP } from '../scenarios/blueprints.js';
import { QUARRY } from './fixtures/quarry.js';

/** A ram order (`Ships.pushRam`) overrides the rest of a ship's movement doctrine. */

describe('a ram order', () => {
  /** Steps until the rammer first touches a target crossing its bow, or -1. */
  function stepsToContact(ram: boolean): number {
    const corvette = compileBlueprint(CORVETTE);
    // A target that keeps its guns on rather than burning clear, so this is
    // about how the rammer flies and not about the target dodging it.
    const doctrine = CORVETTE.doctrine ?? DEFAULT_DOCTRINE;
    const sitting = compileBlueprint({
      ...CORVETTE,
      doctrine: { ...doctrine, approach: { ...doctrine.approach, burnWeight: 0 } },
    });
    const battle = makeBattle({ seed: 4 }, (ships, world) => {
      const target = ships.spawn(world, { design: sitting, x: 0, y: 0, vy: 30, team: 0 });
      const rammer = ships.spawn(world, { design: corvette, x: 300, y: 0, angle: Math.PI, team: 1 });
      ships.clearOrder(rammer);
      ships.clearOrder(target);
      if (ram) ships.pushRam(rammer, target, 40, OrderCancelCondition.None);
      else ships.pushOrder(rammer, target, 0, 0, 40, OrderCancelCondition.None);
    });
    for (let i = 0; i < 60 * 30; i++) {
      battle.step();
      if (battle.collisions.contacts.count > 0) return i;
    }
    return -1;
  }

  it('flies into a moving target rather than braking to arrive alongside it', () => {
    expect(stepsToContact(true)).toBeGreaterThan(0);
  });

  it('hits sooner than an order to close to nothing', () => {
    const band = stepsToContact(false);
    const ram = stepsToContact(true);
    expect(band < 0 || ram < band).toBe(true);
  });
});

describe('an unarmed rammer', () => {
  const WEAPONS = new Set(['turret', 'beamTurret', 'hullGun', 'hullBeam']);
  /** The corvette, or `from`, with every weapon taken off, ramming within `radii` of its target. */
  function unarmed(radii: number, from: Blueprint = CORVETTE): Blueprint {
    const strip = (modules: readonly Placement[]): Placement[] => modules.filter((m) => !('kind' in m && WEAPONS.has(m.kind)));
    const assemblies = Object.fromEntries(
      Object.entries(from.assemblies ?? {}).map(([name, a]) => [name, { ...a, modules: strip(a.modules) }]),
    );
    const doctrine = from.doctrine ?? DEFAULT_DOCTRINE;
    return {
      ...from,
      name: 'Ram',
      assemblies,
      modules: strip(from.modules),
      doctrine: { ...doctrine, approach: { ...doctrine.approach, ramRadii: radii, ramArmed: 0 } },
    };
  }

  /** Whether it touches an enemy within 40 s, on its own doctrine. */
  function hits(radii: number): boolean {
    const design = compileBlueprint(unarmed(radii));
    expect(design.reach).toBe(0);
    const battle = makeBattle({ seed: 4 }, (ships, world) => {
      // A target that neither rams back nor shoots, since a corvette's shells
      // knock pieces off the rammer that touch it, nor runs, as an unarmed
      // ship with engines would from a rammer.
      ships.spawn(world, { design: QUARRY, x: 0, y: 0, team: 0 });
      ships.spawn(world, { design, x: 400, y: 0, angle: Math.PI, team: 1 });
    });
    for (let i = 0; i < 60 * 40; i++) {
      battle.step();
      if (battle.collisions.contacts.count > 0) return true;
    }
    return false;
  }

  it('picks a target and rams it with nothing to shoot', () => {
    // Far enough out to ram from where it starts: nearer, it would hold its
    // doctrine's standoff instead and never close.
    expect(hits(40)).toBe(true);
  });

  it('picks nothing without a ram doctrine', () => {
    expect(hits(0)).toBe(false);
  });

  /** What the rammer picks between a corvette near it and a heavier gunship further off. */
  function picks(ramMass: number, armed = false): 'near' | 'heavy' | 'none' {
    const base = armed ? { ...CORVETTE, doctrine: unarmed(40).doctrine! } : unarmed(40);
    const doctrine = base.doctrine!;
    const rammer = compileBlueprint({
      ...base,
      doctrine: { ...doctrine, targeting: { ...doctrine.targeting, preferredMass: 1, ramMass, massWeight: 400 } },
    });
    const near = compileBlueprint(unarmed(0));
    const heavy = compileBlueprint(unarmed(0, GUNSHIP));
    expect(heavy.mass).toBeGreaterThan(near.mass * 2);
    let ids = { rammer: -1, near: -1, heavy: -1 };
    const battle = makeBattle({ seed: 4 }, (ships, world) => {
      ids = {
        near: ships.spawn(world, { design: near, x: 0, y: 200, team: 0 }),
        heavy: ships.spawn(world, { design: heavy, x: 0, y: -400, team: 0 }),
        rammer: ships.spawn(world, { design: rammer, x: 0, y: 0, team: 1 }),
      };
    });
    // Its first pick, on its own schedule.
    let fighting = -1;
    for (let k = 0; k < 120 && fighting < 0; k++) {
      battle.step();
      fighting = battle.ships.fightingOf(ids.rammer);
    }
    return fighting === ids.near ? 'near' : fighting === ids.heavy ? 'heavy' : 'none';
  }

  it('goes after the size its ram doctrine wants once it would ram, and its usual size otherwise', () => {
    expect(picks(0)).toBe('near');
    expect(picks(8)).toBe('heavy');
    // With its guns, it would not ram, so it wants what it always wants.
    expect(picks(8, true)).toBe('near');
  });
});
