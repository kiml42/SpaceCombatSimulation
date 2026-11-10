import type { Bodies } from "./bodies.js";
import { footprintOf } from "./blueprint.js";
import { wellPull } from "./gravity.js";
import { abs, angleDelta, clamp, cos, length, max, min, PI, sin } from "./math.js";
import { Claim, Resource } from "./supply.js";
import { modulePlace, padFree } from "./shipDocking.js";
import * as shipSupply from "./shipSupply.js";
import { NO_TARGET, type Ships } from "./ships.js";

/**
 * A pad's field: magnets that take hold of a fighter over the pad it is
 * landing on and bring it to rest on it, centred and squared up, so the
 * fighter only has to get there, not settle there. It pushes and turns the
 * fighter as a damped spring towards the pad's middle, moving and turning
 * with it, and pushes and turns the carrier back as hard, so the pair's
 * momentum is kept. How hard it can is the pad's size; what it does costs
 * the carrier charge, and less charge holds less hard.
 */

/** The most a pad's field pushes with, newtons per square metre of pad. */
export const PAD_FIELD_PER_AREA = 400;
/** What the field draws, joules per newton-second of push; turning it costs as a push at the pad's edge would. */
export const PAD_FIELD_POWER_PER_NEWTON = 50;
/** How quickly the field brings a fighter to where it should be, rad/s: a critically damped spring's. */
const FIELD_RATE = 1;
/** How far out from the pad's edge, in the fighter's own radii, the field reaches. */
const FIELD_REACH_RADII = 1;
/** How long a fighter held by a pad takes to be lowered most of the way to it, and how quickly one let go rises, seconds. */
const LOWER_TIME = 4;
const RISE_TIME = 0.5;
/** How far a held fighter is lowered before it lands, as a share of the way: landing takes it the rest. */
const HELD_LOWEST = 0.9;

/**
 * Hold every fighter over the pad it is landing on, for this step: its push
 * and turn on the fighter and the carrier, into their bodies' forces, and
 * `padHeld` and `lowered` for the pilot and the view.
 */
export function holdOnPads(ships: Ships, bodies: Bodies, dt: number): void {
    for (let i = 0; i < ships.alive.length; i++) {
        const was = ships.lowered[i]!;
        ships.padHeld[i] = 0;
        if (ships.alive[i] === 0) continue;
        if (ships.isParked(i)) {
            ships.lowered[i] = 1;
            continue;
        }
        if (hold(ships, bodies, i, dt)) {
            ships.padHeld[i] = 1;
            ships.lowered[i] = min(HELD_LOWEST, was + dt / LOWER_TIME);
        } else ships.lowered[i] = max(0, was - dt / RISE_TIME);
    }
}

/** Fighter `i` held over its pad this step, if it is over the one it is landing on and the carrier has the charge to; whether it was. */
function hold(ships: Ships, bodies: Bodies, i: number, dt: number): boolean {
    const pad = ships.landingPad[i]!;
    const c = ships.salvaging[i]!;
    const design = ships.designs[i]!;
    if (pad < 0 || c === NO_TARGET || ships.alive[c] === 0 || ships.committed[i] === 1 || !design.fighter) return false;
    const b = bodies.indexOf(ships.bodyIds[i]!);
    const cb = bodies.indexOf(ships.bodyIds[c]!);
    if (b < 0 || cb < 0 || b === cb || !padFree(ships, bodies, c, pad)) return false;
    const host = ships.designs[c]!;
    const module = host.modules[pad];
    if (module === undefined) return false;
    const spec = module.spec;
    const place = modulePlace(bodies, cb, host, pad);

    // Over the pad, or within reach of its edge, in the pad's own frame.
    const pc = cos(place.angle);
    const ps = sin(place.angle);
    const rx = bodies.x[b]! - place.x;
    const ry = bodies.y[b]! - place.y;
    const reach = FIELD_REACH_RADII * bodies.radius[b]!;
    if (abs(rx * pc + ry * ps) > spec.length / 2 + reach || abs(-rx * ps + ry * pc) > spec.width / 2 + reach) return false;

    // Squared up whichever way round it fits that is nearest how it lies.
    const box = footprintOf(design);
    const long = box.maxX - box.minX;
    const wide = box.maxY - box.minY;
    const heading = bodies.angle[b]!;
    const lengthwise = long <= spec.length && wide <= spec.width;
    const crosswise = long <= spec.width && wide <= spec.length;
    let want = place.angle;
    let off = Infinity;
    for (let k = 0; k < 4; k++) {
        if (k % 2 === 0 ? !lengthwise && crosswise : !crosswise) continue;
        const angle = place.angle + (k * PI) / 2;
        const d = abs(angleDelta(heading, angle));
        if (d < off) {
            off = d;
            want = angle;
        }
    }
    // Its outline, not its centre of mass, centred on the pad.
    const ox = (box.minX + box.maxX) / 2;
    const oy = (box.minY + box.maxY) / 2;
    const gx = place.x - (ox * cos(heading) - oy * sin(heading));
    const gy = place.y - (ox * sin(heading) + oy * cos(heading));

    // A critically damped spring to there, moving with the pad, holding it up against a rock the carrier is anchored to.
    const k2 = FIELD_RATE * FIELD_RATE;
    let ax = k2 * (gx - bodies.x[b]!) + 2 * FIELD_RATE * (place.vx - bodies.vx[b]!);
    let ay = k2 * (gy - bodies.y[b]!) + 2 * FIELD_RATE * (place.vy - bodies.vy[b]!);
    const root = ships.carrierOf(c);
    const well = ships.rides[root >= 0 ? root : c];
    if (well !== undefined) {
        const pull = wellPull(well, bodies.x[b]!, bodies.y[b]!);
        ax -= (well.x - bodies.x[b]!) * pull;
        ay -= (well.y - bodies.y[b]!) * pull;
    }
    const alpha = k2 * angleDelta(heading, want) + 2 * FIELD_RATE * (bodies.angularVel[cb]! - bodies.angularVel[b]!);

    // As hard as the pad can, and its charge lets it.
    const area = spec.length * spec.width;
    const most = PAD_FIELD_PER_AREA * area * ships.damage.integrity(cb, pad);
    const lever = min(spec.length, spec.width) / 2;
    const mass = bodies.mass[b]!;
    let fx = mass * ax;
    let fy = mass * ay;
    const push = length(fx, fy);
    if (push > most) {
        fx *= most / push;
        fy *= most / push;
    }
    const torque = clamp(bodies.inertia[b]! * alpha, -most * lever, most * lever);
    const need = PAD_FIELD_POWER_PER_NEWTON * (length(fx, fy) + abs(torque) / lever) * dt;
    if (!(need > 0)) return true;
    const allowed = shipSupply.allowed(ships, Resource.Charge, cb, pad, Claim.Pads, need);
    const got = ships.power.draw(cb, pad, need < allowed ? need : allowed);
    shipSupply.took(ships, Resource.Charge, cb, pad, Claim.Pads, got);
    if (!(got > 0)) return false;
    const share = min(1, got / need);
    fx *= share;
    fy *= share;
    const turn = torque * share;

    // On the fighter, and back on whatever holds the carrier still: the carrier, or the rock it is moored to.
    const hb = holdingBody(ships, bodies, c, cb);
    bodies.fx[b] = bodies.fx[b]! + fx;
    bodies.fy[b] = bodies.fy[b]! + fy;
    bodies.torque[b] = bodies.torque[b]! + turn;
    bodies.fx[hb] = bodies.fx[hb]! - fx;
    bodies.fy[hb] = bodies.fy[hb]! - fy;
    bodies.torque[hb] = bodies.torque[hb]! - turn - ((bodies.x[b]! - bodies.x[hb]!) * fy - (bodies.y[b]! - bodies.y[hb]!) * fx);
    return true;
}

/** The body that takes the carrier's half of the field's push: its own, or that of whatever it is parked or moored on, all the way down. */
function holdingBody(ships: Ships, bodies: Bodies, c: number, cb: number): number {
    let ship = c;
    let body = cb;
    for (let depth = 0; depth < 8 && ships.isParked(ship); depth++) {
        const under = ships.carrierBodyOf(bodies, ship);
        if (under < 0) break;
        ship = ships.parkedCarrier(ship);
        body = under;
    }
    return body;
}
