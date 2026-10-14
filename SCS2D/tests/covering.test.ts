import { describe, expect, it } from 'vitest';
import { DAMAGE_ENERGY_PER_KG } from '../sim/index.js';
import { capture, Snapshot } from '../sim/snapshot.js';
import { duel } from '../scenarios/duel.js';

/** What a ship is escorting, carried to the picture so a selected ship's framing can take it in. */
describe('what a ship is escorting', () => {
  it('is a friend’s body, and -1 for a ship with no friend to stay with', () => {
    // Two corvettes against a gunship: each corvette covers the other.
    const battle = duel();
    for (let s = 0; s < 60; s++) battle.step();
    const view = capture(new Snapshot(), battle.world, battle.ships, battle.projectiles, battle.beams);
    const ships = view.ships.slice(0, view.shipCount);
    const corvettes = ships.filter((ship) => ship.design.name === 'Corvette');
    expect(corvettes).toHaveLength(2);
    expect(corvettes[0]!.covering).toBe(corvettes[1]!.body);
    expect(corvettes[1]!.covering).toBe(corvettes[0]!.body);
    expect(ships.find((ship) => ship.design.name === 'Gunship')!.covering).toBe(-1);
  });

  it('is -1 for a ship whose cores are out, whatever it was covering', () => {
    const battle = duel();
    for (let s = 0; s < 60; s++) battle.step();
    const { ships, world } = battle;
    const corvette = [0, 1, 2].find((i) => ships.design(i).name === 'Corvette' && ships.coveringOf(i) >= 0)!;
    expect(corvette).toBeDefined();
    const body = world.bodies.indexOf(ships.body(corvette));
    for (const core of ships.design(corvette).cores) {
      ships.damage.absorb(body, core, ships.design(corvette).modules[core]!.stats.hitPoints * DAMAGE_ENERGY_PER_KG);
    }
    expect(ships.hasControl(corvette)).toBe(false);
    expect(ships.coveringOf(corvette)).toBe(-1);
  });
});
