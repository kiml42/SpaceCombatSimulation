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

  it('keeps a craft with its consort while it goes to the fight', () => {
    // What the tether controls is the gap to the charge, so that is what is
    // measured — averaged over the battle rather than read off at the end of
    // it, since where four ships have got to after a minute of fighting is as
    // much about how the fighting went as about how they steer.
    //
    // Both halves matter. Covering is worthless if the craft never arrives,
    // and a craft that stays home is not escorting, it is hiding.
    function fly(escortWeight: number): { consort: number; enemy: number } {
      const design = compileBlueprint(escorting(CORVETTE, escortWeight));
      const enemy = compileBlueprint(GUNSHIP);
      const battle = makeBattle({ seed: 9, projectiles: 512 }, (ships, world) => {
        const covering = ships.spawn(world, { design, x: -2000, y: -400, angle: 0, team: 0 });
        const charge = ships.spawn(world, { design, x: -2000, y: 400, angle: 0, team: 0 });
        const foe = ships.spawn(world, { design: enemy, x: 2500, y: 0, angle: math.PI, team: 1 });
        return { covering, charge, foe };
      });

      const bodies = battle.world.bodies;
      const gap = (a: number, b: number): number => {
        const p = bodies.indexOf(battle.ships.body(a));
        const q = bodies.indexOf(battle.ships.body(b));
        return math.length(bodies.x[p]! - bodies.x[q]!, bodies.y[p]! - bodies.y[q]!);
      };

      let consort = 0;
      let foe = 0;
      const steps = 1800;
      for (let step = 0; step < steps; step++) {
        battle.step();
        consort += gap(battle.covering, battle.charge);
        foe += gap(battle.covering, battle.foe);
      }
      return { consort: consort / steps, enemy: foe / steps };
    }

    const alone = fly(0);
    const covering = fly(100);
    const harder = fly(400);
    // Tighter the more it is asked for, and no cliff between: a blend of urges
    // gives a knob that means something all the way along, which is what
    // deciding between two targets could not.
    expect(covering.consort).toBeLessThan(alone.consort * 0.7);
    expect(harder.consort).toBeLessThan(covering.consort);
    // And it costs almost nothing in getting there — which is the whole point
    // of wanting two things at once rather than choosing between them.
    expect(covering.enemy).toBeLessThan(alone.enemy * 1.1);
    expect(harder.enemy).toBeLessThan(alone.enemy * 1.1);
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
