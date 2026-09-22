import { describe, expect, it } from 'vitest';
import {
  compileBlueprint,
  math,
  NEUTRAL_TEAM,
  type Blueprint,
  type Doctrine,
} from '../sim/index.js';
import { makeBattle } from '../scenarios/battle.js';
import { CORVETTE, GUNSHIP } from '../scenarios/blueprints.js';

/**
 * Something to fly at that is not something to shoot at.
 *
 * Two mechanisms, deliberately separate and tested apart. **Sides** decide
 * who may shoot whom, and a neutral is nobody's enemy. **Protection** decides
 * whether a hull can be hurt at all, and is about the object rather than
 * about sides. An objective wants both — it is shot at by nobody *and*
 * survives being in the way — and the two would be impossible to tell apart
 * if they were tested together, since either alone leaves a hull unmarked.
 */

const MARKER: Blueprint = {
  name: 'Marker',
  modules: [{ kind: 'core', x: 0, y: 0, length: 12, width: 12 }],
};

function escorting(blueprint: Blueprint, escortWeight: number): Blueprint {
  const doctrine = blueprint.doctrine!;
  const held: Doctrine = {
    targeting: { ...doctrine.targeting, escortWeight },
    approach: { ...doctrine.approach },
  };
  return { ...blueprint, doctrine: held };
}

describe('escort and neutrals', () => {
  it('aims at nothing on the neutral side', () => {
    // Off to one side of the battle, so a hit on it could only be a hit
    // somebody meant. Deliberately *not* protected: what is being tested is
    // that nobody aims at it, and a hull nothing can hurt would pass this
    // test while being fired on constantly.
    const marker = compileBlueprint(MARKER);
    const gunship = compileBlueprint(GUNSHIP);
    const battle = makeBattle({ seed: 3, projectiles: 512 }, (ships, world) => {
      ships.spawn(world, { design: gunship, x: -700, y: 0, angle: 0, team: 0 });
      ships.spawn(world, { design: gunship, x: 700, y: 0, angle: math.PI, team: 1 });
      const neutral = ships.spawn(world, { design: marker, x: 0, y: 2500, team: NEUTRAL_TEAM });
      return { neutral };
    });

    const body = battle.world.bodies.indexOf(battle.ships.body(battle.neutral));
    let struck = 0;
    for (let step = 0; step < 1800; step++) {
      battle.step();
      for (let h = 0; h < battle.credit.count; h++) {
        if (battle.credit.victim[h] === body) struck++;
      }
    }
    expect(struck).toEqual(0);
    expect(battle.ships.damage.integrity(body, 0)).toEqual(1);
  });

  it('is solid, whoever is not shooting at it', () => {
    // The same marker put between the two fleets rather than beside them,
    // and now it is hit constantly — by rounds meant for what is behind it.
    // That is the whole difference between an objective that is an object and
    // one that is a coordinate: this one can be sheltered behind, run into,
    // and shoved out of somebody's way.
    const marker = compileBlueprint(MARKER);
    const gunship = compileBlueprint(GUNSHIP);
    const battle = makeBattle({ seed: 3, projectiles: 512 }, (ships, world) => {
      ships.spawn(world, { design: gunship, x: -700, y: 0, angle: 0, team: 0 });
      ships.spawn(world, { design: gunship, x: 700, y: 0, angle: math.PI, team: 1 });
      const neutral = ships.spawn(world, { design: marker, x: 0, y: 0, team: NEUTRAL_TEAM });
      return { neutral };
    });

    const body = battle.world.bodies.indexOf(battle.ships.body(battle.neutral));
    let struck = 0;
    for (let step = 0; step < 1800; step++) {
      battle.step();
      for (let h = 0; h < battle.credit.count; h++) {
        if (battle.credit.victim[h] === body) struck++;
      }
    }
    expect(struck).toBeGreaterThan(0);
    // Unprotected, so what it is hit by tells: an objective left like this
    // would be worn away by a battle fought over it.
    expect(battle.ships.damage.integrity(body, 0)).toBeLessThan(1);
  });

  it('leaves a protected hull unmarked by what does hit it', () => {
    // The other half: on a side everyone is shooting at, so it is hit — and
    // nothing comes of it.
    const marker = compileBlueprint(MARKER);
    const gunship = compileBlueprint(GUNSHIP);
    const battle = makeBattle({ seed: 3, projectiles: 512 }, (ships, world) => {
      ships.spawn(world, { design: gunship, x: -700, y: 0, angle: 0, team: 0 });
      const target = ships.spawn(world, {
        design: marker,
        x: 300,
        y: 0,
        team: 1,
        invulnerable: true,
      });
      return { target };
    });

    const body = battle.world.bodies.indexOf(battle.ships.body(battle.target));
    let struck = 0;
    for (let step = 0; step < 1800; step++) {
      battle.step();
      for (let h = 0; h < battle.credit.count; h++) {
        if (battle.credit.victim[h] === body) struck++;
      }
    }
    expect(struck).toBeGreaterThan(0);
    expect(battle.ships.damage.integrity(body, 0)).toEqual(1);
    expect(battle.ships.isAlive(battle.target)).toBe(true);
    expect(battle.totalSevered).toEqual(0);
  });

  it('covers a consort rather than going to the fight', () => {
    // The same battle twice, differing in one number. With nothing to escort
    // the ship closes on the enemy; with a consort worth covering it stays
    // with it — and this is a preference rather than a mode, so what decides
    // it is one weight against the rest of the doctrine.
    function fly(escortWeight: number): number {
      const consort = compileBlueprint(MARKER);
      const escort = compileBlueprint(escorting(CORVETTE, escortWeight));
      const enemy = compileBlueprint(GUNSHIP);
      const battle = makeBattle({ seed: 5, projectiles: 512 }, (ships, world) => {
        const covering = ships.spawn(world, { design: escort, x: 0, y: 0, angle: 0, team: 0 });
        const charge = ships.spawn(world, { design: consort, x: 0, y: 300, team: NEUTRAL_TEAM });
        ships.spawn(world, { design: enemy, x: 2500, y: 0, angle: math.PI, team: 1 });
        return { covering, charge };
      });
      for (let step = 0; step < 1800; step++) battle.step();
      const bodies = battle.world.bodies;
      const a = bodies.indexOf(battle.ships.body(battle.covering));
      const b = bodies.indexOf(battle.ships.body(battle.charge));
      return math.length(bodies.x[a]! - bodies.x[b]!, bodies.y[a]! - bodies.y[b]!);
    }

    const alone = fly(0);
    const covering = fly(400);
    expect(covering).toBeLessThan(alone / 2);
  });

  it('closes a fleet up and advances it anyway', () => {
    // The point of the leash. A craft closes up when it has strayed past it
    // and goes back to the battle once it is on station, so a fleet given one
    // arrives at the enemy *and* arrives together — which is more than a
    // fleet with no doctrine about its consorts manages, since that one
    // simply strings out behind whoever accelerates hardest.
    function advance(escortWeight: number): { spread: number; centre: number } {
      const design = compileBlueprint(escorting(CORVETTE, escortWeight));
      const enemy = compileBlueprint(GUNSHIP);
      const battle = makeBattle({ seed: 9, projectiles: 512 }, (ships, world) => {
        const fleet: number[] = [];
        for (let i = 0; i < 4; i++) {
          fleet.push(ships.spawn(world, { design, x: -2000, y: -600 + i * 400, angle: 0, team: 0 }));
        }
        ships.spawn(world, { design: enemy, x: 2500, y: 0, angle: math.PI, team: 1 });
        return { fleet };
      });
      for (let step = 0; step < 3600; step++) battle.step();

      const bodies = battle.world.bodies;
      const at = battle.fleet
        .filter((ship) => battle.ships.isAlive(ship))
        .map((ship) => bodies.indexOf(battle.ships.body(ship)));
      let spread = 0;
      for (const a of at) {
        for (const b of at) {
          spread = math.max(spread, math.length(bodies.x[a]! - bodies.x[b]!, bodies.y[a]! - bodies.y[b]!));
        }
      }
      const centre = at.reduce((total, b) => total + bodies.x[b]!, 0) / at.length;
      return { spread, centre };
    }

    const loose = advance(0);
    const together = advance(30);
    expect(together.spread).toBeLessThan(loose.spread);
    expect(together.centre).toBeGreaterThan(loose.centre);
  });

  it('goes on fighting while it covers', () => {
    // An escort stations on its charge and its guns fight whatever they can
    // reach: covering is where the hull goes, not what the mounts do. If the
    // station were taken for what the ship is fighting, every mount would be
    // concentrating on something no mount may shoot at.
    const consort = compileBlueprint(MARKER);
    const escort = compileBlueprint(escorting(CORVETTE, 400));
    const enemy = compileBlueprint(CORVETTE);
    const battle = makeBattle({ seed: 7, projectiles: 512 }, (ships, world) => {
      const covering = ships.spawn(world, { design: escort, x: 0, y: 0, angle: 0, team: 0 });
      ships.spawn(world, { design: consort, x: 0, y: 200, team: NEUTRAL_TEAM });
      ships.spawn(world, { design: enemy, x: 900, y: 0, angle: math.PI, team: 1 });
      return { covering };
    });

    const from = battle.world.bodies.indexOf(battle.ships.body(battle.covering));
    let dealt = 0;
    for (let step = 0; step < 1800; step++) {
      battle.step();
      for (let h = 0; h < battle.credit.count; h++) {
        if (battle.credit.attacker[h] === from) dealt += battle.credit.energy[h]!;
      }
    }
    expect(dealt).toBeGreaterThan(0);
  });
});
