import { describe, expect, it } from 'vitest';
import { serialiseFleet, shipFleet } from '../sim/index.js';
import { CORVETTE, GUNSHIP } from '../scenarios/blueprints.js';
import { customBattle } from '../scenarios/customBattle.js';
import { Activity, type Decision } from '../scenarios/decision.js';
import { roundBattle } from '../scenarios/skirmish.js';
import { EnemySearch } from '../evolution/answer.js';

const gunship = shipFleet(GUNSHIP);
const corvette = shipFleet(CORVETTE);
/** A seed the Gunship beats the Corvette on, from where a round sets them out. */
const WON = 7;

function decide(player = gunship, enemy = corvette, seed = WON): Decision {
  const battle = customBattle(roundBattle(player, enemy, seed));
  const activity = new Activity(2);
  let decision: Decision | null = null;
  while (decision === null) {
    battle.step();
    decision = activity.observe(battle);
  }
  return decision;
}

function search(seed: number): EnemySearch {
  const found = new EnemySearch(gunship, corvette, WON, seed);
  for (let slice = 0; slice < 200 && !found.advance(5000); slice++);
  return found;
}

describe("the skirmish enemy's answer", () => {
  it('starts from an enemy the player beat on the seed it was won on', () => {
    expect(decide().winner).toBe(0);
  });

  it('finds an enemy that beats the player on that seed, to the skirmish decision', { timeout: 120_000 }, () => {
    const found = search(11).progress.found;
    expect(found).not.toBeNull();
    expect(decide(gunship, found!).winner).toBe(1);
  });

  it('is decided by its seed', { timeout: 120_000 }, () => {
    // A fixed amount of work rather than a whole search, so the test costs the same on any seed.
    const run = (): EnemySearch => {
      const going = new EnemySearch(gunship, corvette, WON, 3);
      going.advance(15_000);
      return going;
    };
    const a = run().progress;
    const b = run().progress;
    expect(a.generation).toBeGreaterThan(0);
    expect(b.generation).toBe(a.generation);
    expect(serialiseFleet(b.best.enemy)).toEqual(serialiseFleet(a.best.enemy));
    expect(b.best.margin).toBe(a.best.margin);
  });

  it('reports each generation as it finishes', () => {
    const running = new EnemySearch(gunship, corvette, WON, 5);
    expect(running.progress.generation).toBe(0);
    while (running.progress.generation === 0 && !running.advance(1000));
    expect(running.progress.generation).toBeGreaterThanOrEqual(1);
    expect(running.progress.seeds).toBe(3);
  });
});
