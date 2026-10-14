import { describe, expect, it } from 'vitest';
import { Credit, NO_TARGET, type Fleet } from '../sim/index.js';
import { DINKY } from '../scenarios/blueprints.js';
import { LINE_OF_BATTLE } from '../scenarios/fleets.js';
import { customBattle } from '../scenarios/customBattle.js';
import { Decision, DRAW } from '../scenarios/decision.js';
import type { Battle } from '../scenarios/types.js';

/** Ships reduced to what the rule asks of them: one ship a side, each a body of its own. */
class Stub {
  readonly fired = [false, false];
  readonly armed = [true, true];
  readonly ramming = [NO_TARGET, NO_TARGET];
  readonly credit = new Credit();
  readonly battle = {
    dt: 1,
    credit: this.credit,
    ships: {
      highWater: 2,
      isAlive: () => true,
      hasControl: () => true,
      teamOf: (i: number) => i,
      isDisarmed: (i: number) => !this.armed[i],
      firedThisStep: (i: number) => this.fired[i],
      pilotAt: (body: number) => body,
      ramTarget: (i: number) => this.ramming[i],
    },
  } as unknown as Battle;

  /** Step `seconds` times, with `firing` the sides that fire on every one. */
  run(decision: Decision, seconds: number, ...firing: number[]): void {
    for (let s = 0; s < seconds; s++) {
      this.fired.fill(false);
      for (const side of firing) this.fired[side] = true;
      decision.observe(this.battle);
    }
  }
}

describe('the skirmish decision', () => {
  it('decides nothing before the first shot', () => {
    const stub = new Stub();
    const decision = new Decision(2, { quietLimit: 30 });
    stub.run(decision, 100);
    expect(decision.opened).toBe(-1);
    expect(decision.outcome).toBeNull();
  });

  it('gives a side the quiet limit to answer the opening shot', () => {
    const stub = new Stub();
    const decision = new Decision(2, { quietLimit: 30 });
    stub.run(decision, 31, 0);
    expect(decision.opened).toBe(1);
    expect(decision.outcome).toBeNull();
    stub.run(decision, 1, 0);
    expect(decision.outcome).toBe(0);
  });

  it('keeps going while both sides fire', () => {
    const stub = new Stub();
    const decision = new Decision(2, { quietLimit: 30, timeCap: 1000 });
    stub.run(decision, 200, 0, 1);
    expect(decision.outcome).toBeNull();
  });

  it('puts a side out once it has stopped firing for the quiet limit', () => {
    const stub = new Stub();
    const decision = new Decision(2, { quietLimit: 30 });
    stub.run(decision, 50, 0, 1);
    stub.run(decision, 30, 1);
    expect(decision.outcome).toBeNull();
    stub.run(decision, 1, 1);
    expect(decision.outcome).toBe(1);
  });

  it('calls a stalemate a draw at the time cap', () => {
    const stub = new Stub();
    const decision = new Decision(2, { quietLimit: 30, timeCap: 120 });
    stub.run(decision, 119);
    expect(decision.outcome).toBeNull();
    stub.run(decision, 1);
    expect(decision.outcome).toBe(DRAW);
  });

  it('decides at once when only one side is armed', () => {
    const stub = new Stub();
    const decision = new Decision(2);
    stub.armed[1] = false;
    stub.run(decision, 1);
    expect(decision.outcome).toBe(0);
  });

  it('counts a ram only from a ship committed to one', () => {
    const stub = new Stub();
    const decision = new Decision(2, { quietLimit: 5 });
    const bump = (): void => {
      stub.credit.clear();
      stub.credit.push(0, 1, 1000, 0, 0);
      stub.credit.push(1, 0, 1000, 0, 0);
    };
    bump();
    stub.run(decision, 1);
    expect(decision.opened).toBe(-1);
    stub.ramming[0] = 1;
    bump();
    stub.run(decision, 1);
    expect(decision.lastActiveAt(0)).toBe(2);
    expect(decision.lastActiveAt(1)).toBe(-Infinity);
  });

  it('decides a real battle for the side that wins it', () => {
    const lone: Fleet = { name: 'Lone', designs: { Dinky: DINKY }, ships: [{ design: 'Dinky', x: 0, y: 0 }] };
    const battle = customBattle({ fleets: [LINE_OF_BATTLE, lone], range: 1000, closingSpeed: 20, crossingSpeed: 0, rotation: 0, seed: 7 });
    const decision = new Decision(2);
    while (decision.outcome === null) {
      battle.step();
      decision.observe(battle);
    }
    expect(decision.opened).toBeGreaterThan(0);
    expect(decision.outcome).toBe(0);
    expect(decision.time).toBeLessThan(decision.timeCap);
  });
});
