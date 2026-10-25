import { NEUTRAL_TEAM, type Credit, type Ships } from "../sim/index.js";
import * as math from "../sim/math.js";

/**
 * When a skirmish battle is decided: once one side has fired or rammed in the
 * last `quietTime` (`QUIET_TIME` unless given) and no other has, counted only
 * once every side has fired at least once, so slow ships closing from far off
 * are not out before they are in range. A ship too far off to shoot is out of
 * it, and an unarmed ship never fires. A hit landing counts as firing, so a
 * slow round that wins after the last shot does not hand the battle to the
 * ship it disables, and a side left with nothing armed or ramming is out at
 * once. Ramming counts as firing only while the rammer is getting closer to
 * what it is ramming: one that circles instead goes quiet. A carrier that can still build an armed fighter is armed, and one
 * building a fighter is busy, though it is not firing: otherwise a carrier
 * with no gun of its own would be out before its first fighter was. A
 * stalemate ends at `TIME_CAP`.
 */

/** How long a side may go without firing or ramming before it is out of the battle, s. */
export const QUIET_TIME = 30;
/** When a battle nobody has won ends anyway, s. */
export const TIME_CAP = 600;

export interface Decision {
    /** The side that won, or -1 for a draw. */
    readonly winner: number;
    /** Why: the losers had nothing left to fight with, went quiet for `quietTime`, or time ran out. */
    readonly reason: "disarmed" | "quiet" | "time";
    /** Simulated time it was decided at, s. */
    readonly time: number;
}

/** What of a battle the rule reads. */
export interface Watched {
    readonly ships: Pick<
        Ships,
        | "highWater"
        | "isAlive"
        | "teamOf"
        | "hasControl"
        | "isRamming"
        | "isDisarmed"
        | "lastFired"
        | "pilotAt"
        | "canBuildArmed"
        | "lastBuilt"
        | "ramTarget"
        | "distanceBetween"
        | "nearestEnemy"
    >;
    readonly world: { readonly tick: number; readonly dt: number };
    readonly credit: Pick<Credit, "count" | "attacker" | "attackerModule" | "victim" | "module">;
}

/** How much closer than its best a ship must come to count as closing, m: drift and wobble are not an approach. */
const CLOSING_MARGIN = 1;
/** What a ship is closing on when it is not ramming anything: whichever enemy is nearest. */
const NEAREST = -2;
const UNSET = -3;

/**
 * Whether each ship is getting closer to what it is closing on: closer than it
 * has been since it started on it, by `CLOSING_MARGIN`. A ship circling at one
 * range never is. After a fresh start — the battle's, a new target, or a hit
 * it has just landed — the mark follows it out until it turns, so a ship
 * thrown clear by its own ram, or started moving away, is not held to where it
 * was.
 */
export class Closing {
    private best = new Float64Array(0);
    private subject = new Int32Array(0);
    private outbound = new Uint8Array(0);

    /** Ship `i`, `distance` from `subject` this step; whether it has come closer. `fresh` starts it again. */
    update(i: number, subject: number, distance: number, fresh: boolean): boolean {
        if (i >= this.best.length) this.grow(i + 1);
        if (fresh || this.subject[i] !== subject) {
            this.subject[i] = subject;
            this.best[i] = distance;
            this.outbound[i] = 1;
            return false;
        }
        if (!(distance < Infinity)) return false;
        if (distance < this.best[i]! - CLOSING_MARGIN) {
            this.best[i] = distance;
            this.outbound[i] = 0;
            return true;
        }
        if (this.outbound[i] === 1 && distance > this.best[i]!) this.best[i] = distance;
        return false;
    }

    /** Forget ship `i`, so its next update starts it again. */
    clear(i: number): void {
        if (i < this.subject.length) this.subject[i] = UNSET;
    }

    /** Another, as this one is now. */
    copy(): Closing {
        const out = new Closing();
        out.best = this.best.slice();
        out.subject = this.subject.slice();
        out.outbound = this.outbound.slice();
        return out;
    }

    private grow(size: number): void {
        const n = math.max(size, this.best.length * 2, 16);
        const best = new Float64Array(n);
        best.set(this.best);
        const subject = new Int32Array(n).fill(UNSET);
        subject.set(this.subject);
        const outbound = new Uint8Array(n);
        outbound.set(this.outbound);
        this.best = best;
        this.subject = subject;
        this.outbound = outbound;
    }
}

/**
 * Watches a battle step by step and says when it is decided. With `approach`,
 * closing on the nearest enemy counts as activity too, though not as a first
 * shot: evolution plays a match on until every side is quiet, and a ship on
 * its way into range is not.
 */
export class Activity {
    /** When each side last fired or rammed, s; the start counts, so nobody is out before `quietTime`. */
    private readonly lastActive: Float64Array;
    /** Whether each side has fired or rammed yet. */
    private readonly fired: Uint8Array;
    /** Whether each side has a ship under control that is armed or ramming, this step. */
    private readonly able: Uint8Array;
    /** Whether each side has landed a hit on another side's ship. */
    private readonly struck: Uint8Array;
    private closing = new Closing();
    /** Per ship this step: whether it landed a hit, which starts its approach again. */
    private landed = new Uint8Array(0);
    private now = 0;
    private decision: Decision | null = null;

    constructor(
        readonly sides: number,
        private readonly cap = TIME_CAP,
        private readonly quietTime = QUIET_TIME,
        private readonly approach = false,
    ) {
        this.lastActive = new Float64Array(sides);
        this.fired = new Uint8Array(sides);
        this.able = new Uint8Array(sides);
        this.struck = new Uint8Array(sides);
    }

    /** The decision, once there is one. */
    get decided(): Decision | null {
        return this.decision;
    }

    /** Another, as this one is now, to go back to: a battle wound back takes its watcher with it. */
    copy(): Activity {
        const out = new Activity(this.sides, this.cap, this.quietTime, this.approach);
        out.lastActive.set(this.lastActive);
        out.fired.set(this.fired);
        out.able.set(this.able);
        out.struck.set(this.struck);
        out.closing = this.closing.copy();
        out.landed = this.landed.slice();
        out.now = this.now;
        out.decision = this.decision;
        return out;
    }

    /** Look at the battle after a step. Returns the decision, once there is one, and the same one after. */
    observe(battle: Watched): Decision | null {
        if (this.decision !== null) return this.decision;
        this.track(battle);
        const now = this.now;
        // Going quiet only counts once every side has fired.
        const quietCounts = !this.fired.includes(0);
        let active = -1;
        let count = 0;
        for (let team = 0; team < this.sides; team++) {
            // A side with nothing left to fight with is out at once, not `quietTime` later.
            if (this.able[team] === 1 && (!quietCounts || now - this.lastActive[team]! < this.quietTime)) {
                active = team;
                count++;
            }
        }
        if (count === 1 && this.sides > 1) {
            const disarmed = this.able.every((able, team) => team === active || able === 0);
            this.decision = { winner: active, reason: disarmed ? "disarmed" : "quiet", time: now };
        } else if (count === 0 && this.sides > 1 && !this.able.includes(1)) this.decision = { winner: -1, reason: "disarmed", time: now };
        else if (now >= this.cap) this.decision = { winner: -1, reason: "time", time: now };
        return this.decision;
    }

    /** Take in a step without deciding anything: who fired, hit, built or closed. */
    track(battle: Watched): void {
        const { ships, world, credit } = battle;
        const now = world.tick * world.dt;
        this.now = now;
        const tick = world.tick;
        if (this.landed.length < ships.highWater) this.landed = new Uint8Array(ships.highWater * 2);
        else this.landed.fill(0);
        for (let h = 0; h < credit.count; h++) {
            const attacker = ships.pilotAt(credit.attacker[h]!, credit.attackerModule[h]!);
            const victim = ships.pilotAt(credit.victim[h]!, credit.module[h]!);
            if (attacker < 0) continue;
            const team = ships.teamOf(attacker);
            if (team === NEUTRAL_TEAM || team >= this.sides) continue;
            if (victim >= 0 && ships.teamOf(victim) === team) continue;
            this.lastActive[team] = now;
            this.fired[team] = 1;
            this.landed[attacker] = 1;
            if (victim >= 0 && ships.teamOf(victim) !== NEUTRAL_TEAM) this.struck[team] = 1;
        }
        this.able.fill(0);
        for (let i = 0; i < ships.highWater; i++) {
            if (!ships.isAlive(i)) {
                this.closing.clear(i);
                continue;
            }
            const team = ships.teamOf(i);
            if (team === NEUTRAL_TEAM || team >= this.sides) continue;
            const ramming = ships.hasControl(i) && ships.isRamming(i);
            if (ramming || !ships.isDisarmed(i) || ships.canBuildArmed(i)) this.able[team] = 1;
            if (ships.lastFired(i) === tick) {
                this.lastActive[team] = now;
                this.fired[team] = 1;
            }
            if (ramming) {
                const target = ships.ramTarget(i);
                if (this.closing.update(i, target, ships.distanceBetween(i, target), this.landed[i] === 1)) {
                    this.lastActive[team] = now;
                    this.fired[team] = 1;
                }
            } else if (this.approach && ships.hasControl(i)) {
                if (this.closing.update(i, NEAREST, ships.nearestEnemy(i), this.landed[i] === 1)) this.lastActive[team] = now;
            } else this.closing.clear(i);
            // Busy, but not yet in it: building keeps a side from going quiet, and is not its first shot.
            if (ships.lastBuilt(i) === tick) this.lastActive[team] = now;
        }
    }

    /** Whether `side` has gone `quietTime` without firing, hitting, building or closing in; the start counts. */
    quiet(side: number): boolean {
        return this.now - this.lastActive[side]! >= this.quietTime;
    }

    /** Whether `side` has landed a hit on another side's ship. */
    hasStruck(side: number): boolean {
        return this.struck[side] === 1;
    }
}
