import { describe, expect, it } from 'vitest';
import { shipFleet } from '../sim/index.js';
import { CORVETTE, GUNSHIP } from '../scenarios/blueprints.js';
import { customBattle } from '../scenarios/customBattle.js';
import { Activity } from '../scenarios/decision.js';
import { Rewind } from '../scenarios/rewind.js';
import { roundBattle } from '../scenarios/skirmish.js';

/** A skirmish round's decision, wound back with its battle (ROADMAP.md §8 step 14, slice 5). */

describe('a decision rule copied part way', () => {
  it('goes on to the same decision as the one it was copied from, from a battle wound back to there', () => {
    const fresh = () => customBattle(roundBattle(shipFleet(GUNSHIP), shipFleet(CORVETTE), 7));
    const decide = (activity: Activity, battle: ReturnType<typeof fresh>, at?: number) => {
      let copy: Activity | null = null;
      for (;;) {
        battle.step();
        const decision = activity.observe(battle);
        if (battle.world.tick === at) copy = activity.copy();
        if (decision !== null) return { decision, copy, tick: battle.world.tick };
      }
    };
    const first = decide(new Activity(2), fresh());
    const half = Math.floor(first.tick / 2);
    const again = decide(new Activity(2), fresh(), half);
    expect(again.copy).not.toBeNull();
    // Wound back to half way and played on, the copy decides as the original did.
    const rewind = new Rewind(fresh());
    rewind.seek(half);
    expect(rewind.battle.world.tick).toBe(half);
    const copy = again.copy!;
    let decision = null;
    while (decision === null) {
      rewind.step();
      decision = copy.observe(rewind.battle);
    }
    expect(decision).toEqual(first.decision);
  });
});
