import type { Snapshot } from "../sim/index.js";
import type { Pose } from "./vapour.js";

/** How many poses a ship keeps: more than a few seconds of frames, for the longest-lived vapour. */
const KEPT = 512;
/** Seconds of poses kept, past which a ship's oldest are let go. */
const KEPT_FOR = 4;

/**
 * Where each leaking ship has been lately, frame by frame on the battle's
 * clock, so vapour can set out from where its hole was when it left. Kept by
 * the renderer as it draws, and cut back when the battle is wound back, so a
 * scrub shows what was there; a moment older than what is kept falls back on
 * the oldest kept.
 */
export class Poses {
    private readonly ships = new Map<number, Track>();
    private now = -Infinity;

    /** Note where every leaking ship is in this picture, once per moment however many times it is drawn. */
    record(snapshot: Snapshot): void {
        const t = snapshot.time;
        if (t === this.now) return;
        if (t < this.now) for (const track of this.ships.values()) track.cut(t);
        this.now = t;
        for (let i = 0; i < snapshot.shipCount; i++) {
            const ship = snapshot.ships[i]!;
            if (ship.leakX === undefined || ship.leakX.length === 0) continue;
            const key = keyOf(ship.body, ship.serial);
            let track = this.ships.get(key);
            if (track === undefined) {
                track = new Track();
                this.ships.set(key, track);
            }
            track.add(t, ship.x, ship.y, ship.angle, ship.vx, ship.vy);
        }
        for (const [key, track] of this.ships) if (track.latest < t - KEPT_FOR) this.ships.delete(key);
    }

    /** Where a ship was `ago` seconds before the picture last recorded, into `into`; false if it has none kept. */
    at(body: number, serial: number, ago: number, into: Pose): boolean {
        const track = this.ships.get(keyOf(body, serial));
        return track !== undefined && track.at(this.now - ago, into);
    }
}

function keyOf(body: number, serial: number): number {
    return body * 1048576 + serial;
}

/** One ship's poses, oldest first, in a ring. */
class Track {
    private readonly t = new Float64Array(KEPT);
    private readonly x = new Float64Array(KEPT);
    private readonly y = new Float64Array(KEPT);
    private readonly angle = new Float64Array(KEPT);
    private readonly vx = new Float64Array(KEPT);
    private readonly vy = new Float64Array(KEPT);
    private start = 0;
    private count = 0;

    get latest(): number {
        return this.count === 0 ? -Infinity : this.t[(this.start + this.count - 1) % KEPT]!;
    }

    add(t: number, x: number, y: number, angle: number, vx: number, vy: number): void {
        if (this.count === KEPT) {
            this.start = (this.start + 1) % KEPT;
            this.count--;
        }
        const k = (this.start + this.count++) % KEPT;
        this.t[k] = t;
        this.x[k] = x;
        this.y[k] = y;
        this.angle[k] = angle;
        this.vx[k] = vx;
        this.vy[k] = vy;
    }

    /** Forget what is later than `t`, as winding the battle back does. */
    cut(t: number): void {
        while (this.count > 0 && this.t[(this.start + this.count - 1) % KEPT]! > t) this.count--;
    }

    /** The pose at `t`, between the two kept either side of it, or the nearest end. */
    at(t: number, into: Pose): boolean {
        if (this.count === 0) return false;
        let lo = 0;
        let hi = this.count - 1;
        const time = (k: number): number => this.t[(this.start + k) % KEPT]!;
        if (t <= time(0)) return this.copy(0, 0, 0, into);
        if (t >= time(hi)) return this.copy(hi, hi, 0, into);
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (time(mid) <= t) lo = mid;
            else hi = mid;
        }
        const span = time(hi) - time(lo);
        return this.copy(lo, hi, span > 0 ? (t - time(lo)) / span : 0, into);
    }

    private copy(a: number, b: number, u: number, into: Pose): boolean {
        const ka = (this.start + a) % KEPT;
        const kb = (this.start + b) % KEPT;
        const mix = (arr: Float64Array): number => arr[ka]! + (arr[kb]! - arr[ka]!) * u;
        into.x = mix(this.x);
        into.y = mix(this.y);
        // The shorter way round.
        let turn = this.angle[kb]! - this.angle[ka]!;
        turn -= 2 * Math.PI * Math.round(turn / (2 * Math.PI));
        into.angle = this.angle[ka]! + turn * u;
        into.vx = mix(this.vx);
        into.vy = mix(this.vy);
        return true;
    }
}
