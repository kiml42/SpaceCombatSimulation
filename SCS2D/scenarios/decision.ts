import { NEUTRAL_TEAM, type Credit, type Ships } from '../sim/index.js';

/**
 * When a skirmish battle is decided: once one side has fired or rammed in the
 * last `QUIET_TIME` and no other has. A ship too far off to shoot is out of
 * it, and an unarmed ship never fires. A hit landing counts as firing, so a
 * slow round that wins after the last shot does not hand the battle to the
 * ship it disables, and a side left with nothing armed or ramming is out at
 * once. A stalemate ends at `TIME_CAP`.
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

/** What of a battle the rule reads. */
export interface Watched {
  readonly ships: Pick<Ships, 'highWater' | 'isAlive' | 'teamOf' | 'hasControl' | 'isRamming' | 'isDisarmed' | 'lastFired' | 'pilotAt'>;
  readonly world: { readonly tick: number; readonly dt: number };
  readonly credit: Pick<Credit, 'count' | 'attacker' | 'attackerModule' | 'victim' | 'module'>;
}

/** Watches a battle step by step and says when it is decided. */
export class Activity {
  /** When each side last fired or rammed, s; the start counts, so nobody is out before `QUIET_TIME`. */
  private readonly lastActive: Float64Array;
  /** Whether each side has a ship under control that is armed or ramming, this step. */
  private readonly able: Uint8Array;
  private decision: Decision | null = null;

  constructor(
    readonly sides: number,
    private readonly cap = TIME_CAP,
    private readonly quietTime = QUIET_TIME,
  ) {
    this.lastActive = new Float64Array(sides);
    this.able = new Uint8Array(sides);
  }

  /** Look at the battle after a step. Returns the decision, once there is one, and the same one after. */
  observe(battle: Watched): Decision | null {
    if (this.decision !== null) return this.decision;
    const { ships, world, credit } = battle;
    const now = world.tick * world.dt;
    const tick = world.tick;
    this.able.fill(0);
    for (let i = 0; i < ships.highWater; i++) {
      if (!ships.isAlive(i)) continue;
      const team = ships.teamOf(i);
      if (team === NEUTRAL_TEAM || team >= this.sides) continue;
      const ramming = ships.hasControl(i) && ships.isRamming(i);
      if (ramming || !ships.isDisarmed(i)) this.able[team] = 1;
      if (ships.lastFired(i) === tick || ramming) this.lastActive[team] = now;
    }
    for (let h = 0; h < credit.count; h++) {
      const attacker = ships.pilotAt(credit.attacker[h]!, credit.attackerModule[h]!);
      const victim = ships.pilotAt(credit.victim[h]!, credit.module[h]!);
      if (attacker < 0) continue;
      const team = ships.teamOf(attacker);
      if (team === NEUTRAL_TEAM || team >= this.sides) continue;
      if (victim >= 0 && ships.teamOf(victim) === team) continue;
      this.lastActive[team] = now;
    }
    let active = -1;
    let count = 0;
    for (let team = 0; team < this.sides; team++) {
      // A side with nothing left to fight with is out at once, not 30 s later.
      if (this.able[team] === 1 && now - this.lastActive[team]! < this.quietTime) {
        active = team;
        count++;
      }
    }
    if (count === 1 && this.sides > 1) this.decision = { winner: active, reason: 'quiet', time: now };
    else if (count === 0 && this.sides > 1 && !this.able.includes(1)) this.decision = { winner: -1, reason: 'quiet', time: now };
    else if (now >= this.cap) this.decision = { winner: -1, reason: 'time', time: now };
    return this.decision;
  }
}
