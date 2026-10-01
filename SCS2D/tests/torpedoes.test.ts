import { describe, expect, it } from 'vitest';
import { compileBlueprint } from '../sim/index.js';
import { torpedoes } from '../scenarios/torpedoes.js';
import { TORPEDO } from '../scenarios/blueprints.js';

/**
 * A torpedo is a fighter with nothing to shoot and a doctrine that rams: the
 * test of fighters and torpedoes being the same thing.
 */

describe('a torpedo', () => {
  it('is a fighter with no weapons and a ram doctrine', () => {
    const design = compileBlueprint(TORPEDO);
    expect(design.fighter).toBe(true);
    expect(design.turrets).toHaveLength(0);
    expect(design.reach).toBe(0);
    expect(design.doctrine.approach.ramRadii).toBeGreaterThan(0);
  });
});

describe('a salvo of torpedoes', () => {
  it('lands some on the gunship, and loses some to its guns on the way in', () => {
    const count = 12;
    const battle = torpedoes(20260905, count);
    const ships = battle.ships;
    const salvo = Array.from({ length: count }, (_, k) => k + 1);
    const hit = new Set<number>();
    const downed = new Set<number>();
    for (let i = 0; i < 3000; i++) {
      battle.step();
      const contacts = battle.collisions.contacts;
      for (let k = 0; k < contacts.count; k++) {
        for (const body of [contacts.a[k]!, contacts.b[k]!]) {
          const pilot = ships.pilotAt(body);
          if (salvo.includes(pilot) && !downed.has(pilot)) hit.add(pilot);
        }
      }
      for (const t of salvo) if (!hit.has(t) && (!ships.isAlive(t) || !ships.hasControl(t))) downed.add(t);
    }
    expect(hit.size).toBeGreaterThan(0);
    expect(downed.size).toBeGreaterThan(0);
  });
});
