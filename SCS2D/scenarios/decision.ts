import { math, NEUTRAL_TEAM, NO_TARGET } from '../sim/index.js';
import type { Battle } from './types.js';

/** Seconds a side may go without firing or ramming before it is out of the fight. */
export const QUIET_LIMIT = 30;

/** Seconds after which a battle nobody has won is a draw. */
export const TIME_CAP = 600;

/** A side's team, or `DRAW`. */
export const DRAW = -1;

export interface DecisionOptions {
  readonly quietLimit?: number;
  readonly timeCap?: number;
}

/**
 * The skirmish's rule for when a battle is over (ROADMAP.md §8, step 5).
 *
 * A side is in the fight while it has fired or rammed in the last
 * `quietLimit` seconds; the battle goes to the one side still in it. A ship
 * too far off to shoot, or with nothing to shoot with, does not fire, so it
 * keeps nobody in. The clock starts at the battle's first shot rather than at
 * the start, so the approach decides nothing and a side gets `quietLimit` to
 * answer the opening salvo. A battle with only one side left armed is decided
 * at once, there being nothing to wait for; and one still undecided at
 * `timeCap` is a draw.
 *
 * Ramming counts for a ship its doctrine has committed to a ram, and only
 * against another side: two hulls drifting into each other is not an attack.
 *
 * Watches a battle from outside, so call `observe` once after every step.
 */
export class Decision {
  readonly quietLimit: number;
  readonly timeCap: number;
  /** Seconds since the battle started. */
  time = 0;
  /** When the first shot of the battle was fired or ram struck, or -1 before it. */
  opened = -1;
  private readonly lastActive: Float64Array;
  private readonly armed: Int32Array;
  private result: number | null = null;

  constructor(
    private readonly sides: number,
    options: DecisionOptions = {},
  ) {
    this.quietLimit = options.quietLimit ?? QUIET_LIMIT;
    this.timeCap = options.timeCap ?? TIME_CAP;
    this.lastActive = new Float64Array(sides).fill(-Infinity);
    this.armed = new Int32Array(sides);
  }

  /** The winning side's team, `DRAW`, or null while the battle goes on. */
  get outcome(): number | null {
    return this.result;
  }

  /** When side `team` last fired or rammed, seconds, or -Infinity if it never has. */
  lastActiveAt(team: number): number {
    return this.lastActive[team] ?? -Infinity;
  }

  observe(battle: Battle): void {
    if (this.result !== null) return;
    this.time += battle.dt;
    const { ships, credit } = battle;

    this.armed.fill(0);
    for (let i = 0; i < ships.highWater; i++) {
      if (!ships.isAlive(i) || !ships.hasControl(i)) continue;
      const team = this.side(ships.teamOf(i));
      if (team < 0) continue;
      if (!ships.isDisarmed(i)) this.armed[team]!++;
      if (ships.firedThisStep(i)) this.lastActive[team] = this.time;
    }

    // A collision is credited with the module that struck; fire is not.
    for (let h = 0; h < credit.count; h++) {
      if (credit.attackerModule[h]! < 0) continue;
      const rammer = ships.pilotAt(credit.attacker[h]!, credit.attackerModule[h]!);
      const victim = ships.pilotAt(credit.victim[h]!, credit.module[h]!);
      if (rammer < 0 || victim < 0 || ships.ramTarget(rammer) === NO_TARGET) continue;
      const team = this.side(ships.teamOf(rammer));
      const struck = this.side(ships.teamOf(victim));
      if (team >= 0 && struck >= 0 && team !== struck) this.lastActive[team] = this.time;
    }

    let standing = 0;
    let lastArmed = DRAW;
    for (let s = 0; s < this.sides; s++) {
      if (this.armed[s]! > 0) {
        standing++;
        lastArmed = s;
      }
    }
    if (standing <= 1) {
      this.result = lastArmed;
      return;
    }

    if (this.opened < 0) {
      for (let s = 0; s < this.sides; s++) if (this.lastActive[s] === this.time) this.opened = this.time;
    }
    if (this.opened >= 0) {
      let inFight = 0;
      let last = DRAW;
      for (let s = 0; s < this.sides; s++) {
        if (this.time - math.max(this.lastActive[s]!, this.opened) <= this.quietLimit) {
          inFight++;
          last = s;
        }
      }
      if (inFight === 1) {
        this.result = last;
        return;
      }
    }

    if (this.time >= this.timeCap) this.result = DRAW;
  }

  private side(team: number): number {
    return team === NEUTRAL_TEAM || team < 0 || team >= this.sides ? -1 : team;
  }
}
