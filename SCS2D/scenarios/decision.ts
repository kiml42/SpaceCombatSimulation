import { NEUTRAL_TEAM } from '../sim/index.js';
import type { Battle } from './types.js';

/**
 * When a skirmish battle is decided: once one side has fired or rammed in the
 * last `QUIET_TIME` and no other has. A ship too far off to shoot is out of
 * it, and an unarmed ship never fires. A stalemate ends at `TIME_CAP`.
 */

/** How long a side may go without firing or ramming before it is out of the battle, s. */
export const QUIET_TIME = 30;
/** When a battle nobody has won ends anyway, s. */
export const TIME_CAP = 600;

export interface Decision {
  /** The side that won, or -1 for a draw. */
  readonly winner: number;
  readonly reason: 'quiet' | 'time';
  /** Simulated time it was decided at, s. */
  readonly time: number;
}

/** Watches a battle step by step and says when it is decided. */
export class Activity {
  /** When each side last fired or rammed, s; the start counts, so nobody is out before `QUIET_TIME`. */
  private readonly lastActive: Float64Array;
  /** Whether each side has a ship still under control, this step. */
  private readonly standing: Uint8Array;
  private decision: Decision | null = null;

  constructor(readonly sides: number) {
    this.lastActive = new Float64Array(sides);
    this.standing = new Uint8Array(sides);
  }

  /** Look at the battle after a step. Returns the decision, once there is one, and the same one after. */
  observe(battle: Battle): Decision | null {
    if (this.decision !== null) return this.decision;
    const { ships, world } = battle;
    const now = world.tick * world.dt;
    const tick = world.tick;
    this.standing.fill(0);
    for (let i = 0; i < ships.highWater; i++) {
      if (!ships.isAlive(i)) continue;
      const team = ships.teamOf(i);
      if (team === NEUTRAL_TEAM || team >= this.sides) continue;
      if (ships.hasControl(i)) this.standing[team] = 1;
      if (ships.lastFired(i) === tick || (ships.hasControl(i) && ships.isRamming(i))) this.lastActive[team] = now;
    }
    let active = -1;
    let count = 0;
    for (let team = 0; team < this.sides; team++) {
      // A side with nothing left under control is out at once, not 30 s later.
      if (this.standing[team] === 1 && now - this.lastActive[team]! < QUIET_TIME) {
        active = team;
        count++;
      }
    }
    if (count === 1 && this.sides > 1) this.decision = { winner: active, reason: 'quiet', time: now };
    else if (count === 0 && this.sides > 1 && !this.standing.includes(1)) this.decision = { winner: -1, reason: 'quiet', time: now };
    else if (now >= TIME_CAP) this.decision = { winner: -1, reason: 'time', time: now };
    return this.decision;
  }
}
