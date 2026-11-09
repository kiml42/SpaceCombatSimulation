import { Bodies } from "./bodies.js";
import type { ShipDesign } from "./blueprint.js";
import { HULL_LAYER, moduleLayers, WEAPONS_LAYER } from "./hull.js";
import { DamageEffect } from "./damage.js";
import { leakRate, leakSpeed } from "./fuel.js";
import { Claim, Resource } from "./supply.js";
import { geometryOf, plumeLayers, plumeRays, WEAPON_PLUME_SHARE } from "./exhaust.js";
import { cohesionUrge } from "./targeting.js";
import { abs, atan2, angleDelta, PI, brakingRate, clamp, cos, length, max, min, sin, sqrt } from "./math.js";
import { EngineLayout } from "./engines.js";
import { burnGain, pushBearing, pushTorque, spinWay, steerHeading, STEER_HOLD_SPEED, STEER_SPIN, turnTime } from "./helm.js";
import { addFlame, addTurret, attackBearing } from "./attack.js";
import { interceptTime } from "./turrets.js";
import { edgeFade } from "./doctrine.js";
import type { SpatialGrid } from "./index.js";
import { SLIPWAY_CLEAR_TIME } from "./modules.js";
import * as shipSupply from "./shipSupply.js";
import * as shipBreakup from "./shipBreakup.js";
import * as shipForage from "./shipForage.js";
import * as shipClaw from "./shipClaw.js";
import * as shipDocking from "./shipDocking.js";
import * as shipBuild from "./shipBuild.js";
import { type Ships, FACE, NO_TARGET, STEER, CLAW_RETRY, movable, type Spot, type Order } from "./ships.js";
import * as shipAim from "./shipAim.js";
import * as shipOrders from "./shipOrders.js";
import * as shipDecide from "./shipDecide.js";

/**
 * Flying a ship: what each of its orders asks of the hull as an acceleration,
 * the heading to turn to and the engines to burn for it, and the fuel the burn
 * and any leaks cost.
 */

/**
 * The weight an order is flown with, so a doctrine number of this much is
 * worth exactly as much as doing what it was told.
 */
export const URGE_REFERENCE = 100;

/**
 * The fastest a craft can be closing and still stop within `gap` metres
 * braking at `brake` m/s², once `delay` seconds have gone by at that speed.
 */
export function stoppingSpeed(brake: number, gap: number, delay: number): number {
    if (!(brake > 0) || !Number.isFinite(delay)) return 0;
    const lag = brake * delay;
    return sqrt(2 * brake * gap + lag * lag) - lag;
}

/** Half of each of a design's modules' diagonals, metres: the circle round its box. */
const SIZES = new WeakMap<ShipDesign, Float64Array>();

/**
 * What a craft with nothing pointing the way it would brake plans to stop on,
 * as a share of what it has pointing the other way. It has no such thing, so
 * it overshoots and comes about; without it, it would never set out. A
 * stop-gap until a craft can turn to brake (ROADMAP.md §12).
 */
const BRAKE_FLOOR = 0.25;

/**
 * How long a hull takes to settle the last few degrees onto its heading,
 * seconds. Landing in a single step instead asks for full torque over a
 * hundredth of a degree, and the hull rocks either side of its bearing with a
 * pair of its engines at full — which is thrust the ship meant to brake with.
 */
const HEADING_SETTLE_TIME = 0.25;

/**
 * How near, as a share of its own radius, a hull will let its turn swing a
 * part of it towards another hull, over and above the room it needs to stop.
 */
const TURN_CLEARANCE_RADII = 0.1;

/**
 * Roughly how long it takes to cover `gap` metres and stop: at the fastest of
 * `cruise` and what it can stop from (`stoppingSpeed`), then braking at
 * `brake` m/s². From that speed, so a measure of a plan, not of a craft.
 */
function arrivalTime(brake: number, gap: number, cruise: number, delay: number): number {
    const v = min(cruise, stoppingSpeed(brake, gap, delay));
    if (!(v > 0)) return Infinity;
    const braking = (v * v) / (2 * brake);
    return max(0, gap - braking) / v + v / brake;
}

/**
 * How far one of turning to burn and holding the guns on target has to
 * outscore the other to take over from it, as a share: enough that a craft
 * near the line between them does not flip its hull back and forth across it.
 */
const BURN_MARGIN = 0.25;

/** The least share of a change turning to burn must make sooner than holding would, to start. */
const BURN_START = 0.25;

/** How hard a fleeing ship eases off once clear of every enemy's reach, m/s². */
const FLEE_EASE = 3;

/** How many times a pilot may halve its ask for force to keep the torque to turn with. */
const FORCE_HALVINGS = 6;

const HURRY = 2;

/**
 * A turn short by less than this share of the torque the ship has is no turn
 * at all, and not worth giving up thrust for: a craft dead on its heading asks
 * for round-off.
 */
const TORQUE_NEGLIGIBLE = 1e-6;

/**
 * A turn asking less than this share of the torque a craft has is not worth
 * giving up thrust for, nor is one given more than this share of what it asked.
 */
const TURN_SHARE = 0.1;

/**
 * How long, seconds, a docking ship takes to trust a change in how what it is
 * docking with is accelerating: long enough that a knock does not throw it,
 * short enough to follow a carrier opening its throttle.
 */
const DOCK_ACCEL_SETTLE = 0.25;

function moduleSizes(design: ShipDesign): Float64Array {
    let sizes = SIZES.get(design);
    if (sizes === undefined) {
        sizes = new Float64Array(design.modules.length);
        for (let m = 0; m < sizes.length; m++) sizes[m] = 0.5 * length(design.modules[m]!.spec.length, design.modules[m]!.spec.width);
        SIZES.set(design, sizes);
    }
    return sizes;
}

/**
 * One ship's pilot: hold the range band of its order, or of what doctrine
 * chose, and face the target.
 *
 * It brakes into the band, holds station by matching the target's velocity,
 * and points the bow at whatever it is fighting, blended with escorting and
 * keeping clear. What to fight and how close to sit are doctrine's to say
 * (§2), not the pilot's; it only turns them into a demand wrench for the
 * allocator. There is no evasion, approach angle or propellant budget.
 */
export function flyOne(ships: Ships, dt: number, bodies: Bodies, i: number, grid?: SpatialGrid): void {
    const b = bodies.indexOf(ships.bodyIds[i]!);
    if (b < 0) return;

    // **Where a craft wants to go is several wants added up.** Holding the
    // station it has been given, staying with what it is covering, and keeping
    // out of everybody's way are not alternatives to choose between: a craft
    // does all three at once, more or less, and what decides how much of each
    // is one weight against another in metres per second — which is a currency
    // they all share, unlike a target's score.
    //
    // Every urge is a *velocity* it would like to have and how much it would
    // like it, and the result is their weighted average. With one urge that is
    // exactly the urge, so a craft with nothing to avoid and nobody to cover
    // flies its orders as it always did.
    ships.urgeVx = 0;
    ships.urgeVy = 0;
    ships.urgeAx = 0;
    ships.urgeAy = 0;
    ships.urgeWeight = 0;
    ships.intent = FACE;
    ships.steerSlack = STEER_HOLD_SPEED;
    ships.steerFree = false;
    ships.dodgeWeight = 0;
    ships.dodgeRock = false;
    ships.fightFade = 1;
    let wantAngle = bodies.angle[b]!;
    // What it is fighting, if anything: the body, and how far out it holds it.
    let fighting = -1;
    let holdOut = 0;

    // Of two ships docked by their ports, the smaller idles and the larger
    // flies the pair: two pilots on one body would pull it apart.
    const partner = shipDocking.portPartner(ships, i, b);
    if (partner >= 0) {
        const mass = shipDocking.ownMass(ships, i, b);
        const theirs = shipDocking.ownMass(ships, partner, b);
        if (mass < theirs || (mass === theirs && i > partner)) {
            ships.idle(i);
            return;
        }
    }

    // Sat on a pad, however it got there: the pad lets it go, and its engines
    // would only push the carrier and burn the deck.
    if (ships.onPad(i, b)) {
        ships.idle(i);
        return;
    }

    // Just off a slipway, drifting clear: its engines stay off while they would
    // burn its builder, unless it is drifting back into it, as a well under an
    // anchored builder pulls it.
    const builder = ships.clearing[i]!;
    if (builder >= 0) {
        const bb = ships.alive[builder] === 1 ? bodies.indexOf(ships.bodyIds[builder]!) : -1;
        const waited = (ships.now - ships.clearingSince[i]!) * dt;
        const back =
            bb >= 0 &&
            (bodies.x[b]! - bodies.x[bb]!) * (bodies.vx[b]! - bodies.vx[bb]!) +
                (bodies.y[b]! - bodies.y[bb]!) * (bodies.vy[b]! - bodies.vy[bb]!) <
                0;
        if (bb >= 0 && grid !== undefined && waited < SLIPWAY_CLEAR_TIME && !back && shipBuild.wouldBurn(ships, bodies, grid, i, bb)) {
            ships.idle(i);
            return;
        }
        ships.clearing[i] = -1;
    }

    // No order at all is the same problem as an order with no target: hold
    // what you are doing and wait to be told something.
    const order = shipOrders.effectiveOrder(ships, i);
    const target = order?.target ?? NO_TARGET;
    const fleeing = order?.flee === true;
    if (fleeing) {
        if (flee(ships, bodies, i, b, order!)) {
            ships.intent = STEER;
            ships.steerFree = true;
        }
        avoid(ships, bodies, i, b, NO_TARGET, NO_TARGET);
    } else if (order !== undefined && target !== NO_TARGET && ships.alive[target] === 1) {
        const tb = bodies.indexOf(ships.bodyIds[target]!);
        // Holding it in its claw, or sat on its pad: nothing to fly for while it drinks.
        if ((order.grapple || order.land) && tb === b) {
            ships.idle(i);
            return;
        }
        const claw = order.grapple ? shipClaw.workingClaw(ships, i, b) : -1;
        if (order.dock) {
            // Docked and the larger, it flies the pair, wanting nothing but to hold still.
            if (tb >= 0 && tb !== b) wantAngle = shipDocking.dockOn(ships, dt, bodies, i, b, tb, ships.dockPort[i]!, ships.ownPort[i]!);
        } else if (order.land && tb >= 0) {
            wantAngle = shipDocking.landOn(ships, dt, bodies, i, b, tb, ships.landingPad[i]!);
        } else if (order.grapple && claw < 0) {
            ships.salvaging[i] = NO_TARGET;
        } else if (claw >= 0 && tb >= 0) {
            // The jaws, not the bow, are what point at it.
            const jaws = ships.designs[i]!.modules[claw]!.spec.angle ?? 0;
            const across = shipDocking.hullAcross(ships, bodies, i, b, tb, target);
            if (across >= 0) {
                wantAngle = shipDocking.roundHull(ships, bodies, i, b, across, tb) - jaws;
            } else {
                const standOff = ships.now - ships.touchedSource[i]! < CLAW_RETRY / dt;
                let radial: number;
                // Lining up square takes turning both ways: one that cannot stop a turn closes on the middle.
                const layout = ships.layoutOf(i);
                if (layout.maxTorque(1) > 0 && layout.maxTorque(-1) > 0 && shipClaw.chooseGrip(ships, bodies, i, b, tb, target, claw, dt)) {
                    radial = shipClaw.squareUp(ships, bodies, i, b, tb, claw, standOff);
                    wantAngle = ships.gripHeading;
                } else {
                    wantAngle = atan2(bodies.y[tb]! - bodies.y[b]!, bodies.x[tb]! - bodies.x[b]!) - jaws;
                    radial = shipClaw.grapple(ships, bodies, i, b, tb, claw, wantAngle, standOff);
                }
                // An asteroid comes on in its orbit: match its motion on the mains first, then turn the jaws to it.
                if (ships.isAsteroid(target)) wantAngle = shipClaw.matchOrbit(ships, bodies, i, b, tb, wantAngle, radial);
            }
        } else if (tb >= 0 && tb !== b) {
            // Not hooked on to it, which would leave nowhere to steer for.
            const at = ships.locate(bodies, target, tb, ships.fightAt);
            wantAngle = atan2(at.y - bodies.y[b]!, at.x - bodies.x[b]!);
            if (!order.ram) {
                wantAngle = attackHeading(ships, i, b, at, bodies, wantAngle, target, tb);
                fighting = tb;
                holdOut = order.maxRange;
            }
            if (order.ram) {
                charge(ships, bodies, i, b, at, order.approachSpeed, tb);
                ships.intent = HURRY;
            } else hold(ships, bodies, i, b, at, order.minRange, order.maxRange, order.approachSpeed, URGE_REFERENCE, wantAngle);
            orbit(ships, bodies, i, b, at, tb);
        }
    }

    // A ram overrides the rest of the doctrine: no cover, and no keeping clear
    // but of rocks and friends; and so does closing on a source, which means
    // touching it, but for a hulk coming through. Landing keeps clear of all
    // but its carrier, since two making for neighbouring pads cross.
    if (order?.grapple === true) avoid(ships, bodies, i, b, target, NO_TARGET, true);
    if (order?.ram === true) avoid(ships, bodies, i, b, target, NO_TARGET, false, true);
    if (order?.land === true) avoid(ships, bodies, i, b, target, NO_TARGET, false, false, true);
    if (!fleeing && (order === undefined || !(order.ram || order.grapple || order.land || order.dock))) {
        const covering = cover(ships, bodies, i, b);
        if (target === NO_TARGET && covering >= 0) {
            const cb = bodies.indexOf(ships.bodyIds[covering]!);
            if (cb >= 0) wantAngle = atan2(bodies.y[cb]! - bodies.y[b]!, bodies.x[cb]! - bodies.x[b]!);
            // Defending and on station, it turns its main battery on the attacker.
            const attacker = covering === ships.defendingOf(i) ? ships.chosenOf(i) : NO_TARGET;
            const ab = attacker === NO_TARGET ? -1 : bodies.indexOf(ships.bodyIds[attacker]!);
            if (cb >= 0 && ab >= 0 && ab !== b) {
                const gap = length(bodies.x[cb]! - bodies.x[b]!, bodies.y[cb]! - bodies.y[b]!);
                if (gap <= shipDecide.escortBand(ships, i, ships.designs[i]!, covering)) {
                    const at = ships.locate(bodies, attacker, ab, ships.lookAt);
                    wantAngle = attackHeading(ships, i, b, at, bodies, atan2(at.y - bodies.y[b]!, at.x - bodies.x[b]!), attacker, ab);
                }
            }
        }
        // Clear of what it is covering, as of anything else: a charge is
        // stationed on, never flown into.
        avoid(ships, bodies, i, b, target, covering);
    }

    // Nothing to want is a want of its own: a craft with no orders, no charge
    // and nothing in its way kills its drift and waits.
    const wantVx = ships.urgeWeight > 0 ? ships.urgeVx / ships.urgeWeight : 0;
    const wantVy = ships.urgeWeight > 0 ? ships.urgeVy / ships.urgeWeight : 0;
    const leadAx = ships.urgeWeight > 0 ? ships.urgeAx / ships.urgeWeight : 0;
    const leadAy = ships.urgeWeight > 0 ? ships.urgeAy / ships.urgeWeight : 0;

    if (fighting < 0) ships.brakingOnMains[i] = 0;
    if (fighting >= 0) wantAngle = burnOrFight(ships, i, b, ships.fightAt, bodies, wantAngle, wantVx, wantVy, holdOut);
    else ships.burning[i] = 0;

    // Getting out of a rock's way, once that is most of what it wants, is a
    // matter of where it goes rather than which way it faces: held on target,
    // a heavy hull's thrusters push it aside too slowly to miss.
    if (ships.intent === FACE && ships.dodgeRock && 2 * ships.dodgeWeight >= ships.urgeWeight) ships.intent = STEER;

    const mass = bodies.mass[b]!;
    // The allocator works in the body frame, so the demand is rotated into it.
    const angle = bodies.angle[b]!;
    const response = ships.doctrines[i]!.approach.responseTime;
    const layout = ships.layoutOf(i);
    // Steering, the helm turns its push onto the change it needs, or, on a
    // layout that cannot hold a heading, keeps a slow spin and fires as its
    // push comes round. Hurrying never spins, which gives up two thirds of its
    // push: it turns its push round, the long way if it must, and burns.
    let spin = 0;
    if (ships.intent !== FACE) {
        const bearing = pushBearing(layout, ships.designs[i]!.thrustBearing);
        spin = ships.intent === STEER ? spinWay(layout, bearing) : 0;
        if (spin === 0) {
            const dvx = wantVx - bodies.vx[b]! + leadAx * response;
            const dvy = wantVy - bodies.vy[b]! + leadAy * response;
            wantAngle = steerHeading(dvx, dvy, angle, wantAngle, bearing, ships.steerSlack, ships.steerFree);
        }
    }
    // Hurrying asks for far more than any layout gives, and a saturated ask for
    // force leaves nothing to stop a turn with. So it points, then burns: the
    // force asked for falls away with how far off its heading still is.
    const hurry = ships.intent === HURRY && spin === 0;
    const aligned = hurry ? max(0, cos(angleDelta(angle, wantAngle))) : 1;
    const worldFx = aligned * mass * ((wantVx - bodies.vx[b]!) / response + leadAx);
    const worldFy = aligned * mass * ((wantVy - bodies.vy[b]!) / response + leadAy);
    const c = cos(angle);
    const s = sin(angle);
    const localFx = worldFx * c + worldFy * s;
    const localFy = -worldFx * s + worldFy * c;

    // Heading: the same braking law the turrets use, at hull scale. The
    // available angular acceleration comes from the layout rather than a
    // guess, so a sluggish ship turns sluggishly because of what it is made
    // of.
    const error = angleDelta(angle, wantAngle);
    const inertia = bodies.inertia[b]!;
    const maxTorque = layout.maxTorque(error >= 0 ? 1 : -1);
    // Planned on the torque that stops the turn, not the one that starts it.
    // On a lopsided layout those differ, and a turn planned on the stronger
    // overshoots past half round, where the error wraps and it goes round again.
    const brakeTorque = layout.maxTorque(error >= 0 ? -1 : 1);
    const maxAlpha = inertia > 0 ? brakeTorque / inertia : 0;
    const turn = min(brakingRate(error, maxAlpha, dt), (error >= 0 ? error : -error) / HEADING_SETTLE_TIME);
    let wantRate = error >= 0 ? turn : -turn;
    if (spin !== 0) wantRate = spin * STEER_SPIN;
    // Never round into something, but for what it means to touch: a turn that
    // would swing the hull into a neighbour is not started, and one already
    // under way is stopped.
    const touching = order !== undefined && (order.ram || order.grapple || order.land || order.dock) ? target : NO_TARGET;
    if (wantRate !== 0 && turnBlocked(ships, bodies, i, b, layout, wantRate > 0 ? 1 : -1, touching)) wantRate = 0;
    const localTorque = dt > 0 ? (inertia * (wantRate - bodies.angularVel[b]!)) / dt : 0;

    // Engines the designer meant as weapons, lit because something worth
    // burning is behind them. Decided before the allocation and taken off the
    // demand, so the rest of the layout spends its step cancelling the push
    // rather than discovering it next step and chasing it forever.
    const firing = aimEngines(ships, bodies, grid, i, layout);
    let demandFx = localFx;
    let demandFy = localFy;
    let demandTorque = clamp(localTorque, -layout.maxTorque(-1), layout.maxTorque(1));
    if (firing > 0) {
        const forced = ships.forced;
        for (let t = 0; t < layout.count; t++) {
            if (forced[t] === 0) continue;
            demandFx -= layout.wfx[t]!;
            demandFy -= layout.wfy[t]!;
            demandTorque -= layout.wt[t]!;
        }
    }

    // Spinning, it can turn back little or not at all, so a push adds to the spin:
    // it asks for what a straight push would turn it by, or a spin-up if more, rather
    // than for no turn, which the allocator would buy by not pushing at all.
    if (spin !== 0) demandTorque = spin * max(spin * demandTorque, spin * pushTorque(layout, demandFx, demandFy));
    const throttles = ships.throttles[i]!;
    layout.allocate(demandFx, demandFy, demandTorque, throttles, ships.allocation);
    // Asked for more force than it has, the allocator can give up the turn for
    // it, and a lopsided layout can even turn the wrong way. So ask for less:
    // hurrying, until it gets most of its turn; otherwise only while a turn worth
    // having is starved, since a lopsided hull loses a little whenever it pushes.
    for (let k = 0; k < FORCE_HALVINGS; k++) {
        const got = ships.allocation.torque;
        const short = demandTorque - got;
        if (abs(short) <= maxTorque * TORQUE_NEGLIGIBLE) break;
        if (hurry) {
            if (abs(short) <= 0.5 * abs(demandTorque)) break;
        } else {
            const sense = demandTorque >= 0 ? 1 : -1;
            if (abs(demandTorque) <= TURN_SHARE * layout.maxTorque(sense)) break;
            if (got * sense >= TURN_SHARE * abs(demandTorque)) break;
            const missX = demandFx - ships.allocation.fx;
            const missY = demandFy - ships.allocation.fy;
            if (missX * missX + missY * missY <= 0.25 * (demandFx * demandFx + demandFy * demandFy)) break;
        }
        demandFx *= 0.5;
        demandFy *= 0.5;
        layout.allocate(demandFx, demandFy, demandTorque, throttles, ships.allocation);
    }

    if (firing === 0) {
        ships.demandFx[i] = ships.allocation.fx;
        ships.demandFy[i] = ships.allocation.fy;
        ships.demandTorque[i] = ships.allocation.torque;
        return;
    }

    // A weapon engine burns flat out whatever the allocator made of it, and
    // the wrench is read back off the throttles rather than off the solve,
    // which knew nothing about them.
    let fx = 0;
    let fy = 0;
    let torque = 0;
    for (let t = 0; t < layout.count; t++) {
        if (ships.forced[t] === 1) throttles[t] = 1;
        const u = throttles[t]!;
        fx += layout.wfx[t]! * u;
        fy += layout.wfy[t]! * u;
        torque += layout.wt[t]! * u;
    }
    ships.demandFx[i] = fx;
    ships.demandFy[i] = fy;
    ships.demandTorque[i] = torque;
}

/**
 * The heading that puts a target lying at `towards` where this ship's
 * working main guns bear most (`attackBearing`), led by those guns' time of
 * flight, so a battery that cannot train far is pointed where its shot will
 * meet the target rather than where the target is.
 *
 * Where its main guns are after a part of `target` rather than the whole of
 * it (`aimedPart`), the hull is pointed at that part instead, led as a gun
 * leads it: by the part's own motion, spin and all.
 */
export function attackHeading(
    ships: Ships,
    i: number,
    b: number,
    at: Spot,
    bodies: Bodies,
    towards: number,
    target: number = NO_TARGET,
    tb: number = -1,
): number {
    const design = ships.designs[i]!;
    const arcs = ships.attackArcs;
    arcs.clear();
    for (let t = 0; t < design.turrets.length; t++) {
        const turret = design.turrets[t]!;
        if (turret.main && !ships.isTurretDisabled(i, t)) addTurret(arcs, turret.mount);
    }
    for (const t of design.mainWeaponEngines) {
        if (ships.left(i, b, design.engines[t]!.module ?? -1, DamageEffect.Thrust) > 0) addFlame(arcs, design, t);
    }
    let ax = at.x;
    let ay = at.y;
    let avx = at.vx;
    let avy = at.vy;
    const part = tb >= 0 ? aimedPart(ships, i, target, tb) : -1;
    if (part >= 0) {
        const module = ships.designs[target]!.modules[part]!;
        const angle = bodies.angle[tb]!;
        const rx = module.x * cos(angle) - module.y * sin(angle);
        const ry = module.x * sin(angle) + module.y * cos(angle);
        const spin = bodies.angularVel[tb]!;
        ax = bodies.x[tb]! + rx;
        ay = bodies.y[tb]! + ry;
        avx = bodies.vx[tb]! - spin * ry;
        avy = bodies.vy[tb]! + spin * rx;
        towards = atan2(ay - bodies.y[b]!, ax - bodies.x[b]!);
    }
    const current = angleDelta(bodies.angle[b]!, towards);
    const region = attackBearing(arcs, current, ships.doctrines[i]!.approach.turnBias, design.thrustBearing, ships.attackRegion);
    if (region.speed > 0) {
        const dx = ax - bodies.x[b]!;
        const dy = ay - bodies.y[b]!;
        const dvx = avx - bodies.vx[b]!;
        const dvy = avy - bodies.vy[b]!;
        const t = interceptTime(dx, dy, dvx, dvy, region.speed);
        if (t > 0) towards = atan2(dy + dvy * t, dx + dvx * t);
    }
    return towards - region.aim;
}

/**
 * The part of `target`, on body `tb`, that ship `i`'s main guns are after,
 * taken from the one the hull aims most nearly (its narrowest arc), or -1
 * where none is after a part of it: the whole ship, or another ship. A mount
 * that trains all the way round needs nothing of the hull, so is left out.
 */
function aimedPart(ships: Ships, i: number, target: number, tb: number): number {
    const design = ships.designs[i]!;
    const parts = ships.designs[target]?.modules.length ?? 0;
    let best = -1;
    let narrowest = Infinity;
    for (let t = 0; t < design.turrets.length; t++) {
        const turret = design.turrets[t]!;
        if (!turret.main || ships.isTurretDisabled(i, t) || ships.turretAiming[i]![t] !== target) continue;
        const part = ships.turretAimModule[i]![t]!;
        if (part < 0 || part >= parts || ships.damage.spent(tb, part)) continue;
        const arc = (turret.mount.leftArc ?? PI) + (turret.mount.rightArc ?? PI);
        if (arc < 2 * PI && arc < narrowest) {
            narrowest = arc;
            best = part;
        }
    }
    return best;
}

/**
 * The attack heading, or the heading that points the main thrust axis along
 * the change of velocity this ship wants, whichever its doctrine scores
 * higher: `burnWeight` for the share of that change turning makes before
 * holding would, turn included, against `rangeHold` for how near the band it
 * is. Held by `BURN_MARGIN` either way.
 *
 * A ship whose guns-on thrust already gives what the pilot asks for never
 * turns. When a dodge is most of what it wants, only what each makes
 * before the near miss counts, so a quick sidestep beats a slow flip.
 */
export function burnOrFight(
    ships: Ships,
    i: number,
    b: number,
    at: Spot,
    bodies: Bodies,
    attack: number,
    wantVx: number,
    wantVy: number,
    maxRange: number,
): number {
    const approach = ships.doctrines[i]!.approach;
    const layout = ships.layoutOf(i);
    const bearing = pushBearing(layout, ships.designs[i]!.thrustBearing);
    // What turning its push buys over holding its guns on is the helm's to say;
    // when a dodge is most of what it wants, only what each makes before the
    // near miss counts.
    const dodging = ships.dodgeWeight > 0 && 2 * ships.dodgeWeight >= ships.urgeWeight;
    const gain =
        approach.burnWeight > 0
            ? burnGain(
                  layout,
                  bodies.mass[b]!,
                  bodies.inertia[b]!,
                  attack,
                  wantVx - bodies.vx[b]!,
                  wantVy - bodies.vy[b]!,
                  approach.responseTime,
                  bearing,
                  dodging ? ships.dodgeWhen : Infinity,
              )
            : -1;
    if (gain < 0) {
        ships.burning[i] = 0;
        return attack;
    }

    const range = length(at.x - bodies.x[b]!, at.y - bodies.y[b]!);
    // On the run out of a pass or back in, its guns wait for its push.
    const near = ships.running[i] === 1 ? 0 : range > maxRange && maxRange > 0 ? maxRange / range : 1;
    // Worth less the further into its band's fade it is: the last of the
    // closing there is no reason to take its guns off.
    const burn = approach.burnWeight * gain * ships.fightFade;
    const hold = approach.rangeHold * near;
    // Committed to stopping on its push: it holds it against its way in
    // whatever the score, since its approach was planned on it.
    if (ships.brakingOnMains[i] === 1) {
        ships.burning[i] = 1;
        return atan2(bodies.y[b]! - at.y, bodies.x[b]! - at.x) - bearing;
    }
    // Turning has to be worth a share of the change to start, as well as
    // beating holding, so a craft whose want hovers where its guns-on thrust
    // can nearly make it does not flip its hull to and fro; once turned, it
    // stays turned while turning is worth anything. Turned, where it faces
    // is the helm's, onto any change at all.
    const now = ships.burning[i] === 1 ? burn * (1 + BURN_MARGIN) > hold : burn > hold * (1 + BURN_MARGIN) && gain > BURN_START;
    ships.burning[i] = now ? 1 : 0;
    if (now) {
        ships.intent = STEER;
        ships.steerSlack = 0;
    }
    return attack;
}

/**
 * Whether turning the way `sense` says (+1 anticlockwise) would swing part
 * of this hull into a neighbour other than `touching`.
 *
 * Module by module, each as the circle round its box, since what a turn
 * sweeps is the ends of a hull and not its middle. It would when a module
 * the turn carries towards a module of another hull is nearer it than the
 * hull needs to stop turning that way, from the rate it has, plus
 * `TURN_CLEARANCE_RADII`.
 */
export function turnBlocked(
    ships: Ships,
    bodies: Bodies,
    i: number,
    b: number,
    layout: EngineLayout,
    sense: number,
    touching: number,
): boolean {
    const design = ships.designs[i]!;
    const x = bodies.x[b]!;
    const y = bodies.y[b]!;
    const w = bodies.angularVel[b]! * sense;
    const inertia = bodies.inertia[b]!;
    // How far round it would go before it could stop, at most half a turn:
    // past that it reaches everything it can.
    const alpha = inertia > 0 ? layout.maxTorque(-sense) / inertia : 0;
    const stop = w > 0 ? (alpha > 0 ? min(PI, (w * w) / (2 * alpha)) : PI) : 0;
    // A point turned through that is moved this share of its distance out.
    const chord = 2 * sin(0.5 * stop);
    const margin = TURN_CLEARANCE_RADII * design.radius;
    const sweep = design.radius * chord + margin;
    let c = NaN;
    let sn = NaN;
    const myLayers = shipAim.shipLayers(ships, i);
    // By body: a carrier holding something in its claw is one body with it, which either may ride first.
    const touched = touching === NO_TARGET || ships.alive[touching] === 0 ? -1 : bodies.indexOf(ships.bodyIds[touching]!);
    for (let t = 0; t < ships.alive.length; t++) {
        if (t === i || t === touching || ships.alive[t] === 0) continue;
        const ob = bodies.indexOf(ships.bodyIds[t]!);
        if (ob < 0 || ob === b || ob === touched || bodies.ghost[ob] === 1 || !ships.meets(b, ob)) continue;
        // A body walked once, however many ships ride it.
        if (ships.shipByBody[ob] !== t) continue;
        const theirs = ships.designs[t]!;
        const ox = bodies.x[ob]!;
        const oy = bodies.y[ob]!;
        if (!(length(ox - x, oy - y) < design.radius + theirs.radius + sweep)) continue;
        if (c !== c) {
            c = cos(bodies.angle[b]!);
            sn = sin(bodies.angle[b]!);
        }
        const oc = cos(bodies.angle[ob]!);
        const os = sin(bodies.angle[ob]!);
        const mine = moduleSizes(design);
        const sizes = moduleSizes(theirs);
        const theirLayers = ships.layersOf(ob);
        for (let k = 0; k < design.modules.length; k++) {
            const m = design.modules[k]!;
            const layers = moduleLayers(m, myLayers);
            const rx = m.x * c - m.y * sn;
            const ry = m.x * sn + m.y * c;
            const room = length(rx, ry) * chord + margin;
            const size = mine[k]!;
            // Too far from the whole of the other hull to reach any of it.
            if (!(length(ox - x - rx, oy - y - ry) < size + theirs.radius + room)) continue;
            for (let q = 0; q < theirs.modules.length; q++) {
                const n = theirs.modules[q]!;
                // A fighter overflies thin hull, its own pad among it.
                if ((moduleLayers(n, theirLayers) & layers) === 0) continue;
                const dx = ox + n.x * oc - n.y * os - x - rx;
                const dy = oy + n.x * os + n.y * oc - y - ry;
                // Clearly out of reach, without the square root.
                const reach = size + sizes[q]! + room;
                if (dx * dx + dy * dy > reach * reach * (1 + 1e-9) + 1e-9) continue;
                // Anticlockwise carries this module along (-ry, rx).
                if (!(sense * (-ry * dx + rx * dy) > 0)) continue;
                if (length(dx, dy) - size - sizes[q]! < room) return true;
            }
        }
    }
    return false;
}

/**
 * Mark every engine this ship should fire as a weapon this step, in
 * `forced`, and say how many.
 *
 * An engine burns on its own account when something worth burning is in the
 * part of its plume that would actually hurt — asked at full throttle, since
 * the question is whether to open up rather than what the current burn
 * happens to reach. What counts as worth burning is what a gun would shoot
 * at: not its own hull, not a friend, not wreckage, and not a hulk, which
 * can never be finished off and is not worth being shoved about for.
 */
export function aimEngines(ships: Ships, bodies: Bodies, grid: SpatialGrid | undefined, i: number, layout: EngineLayout): number {
    const design = ships.designs[i]!;
    const armed = design.weaponEngines;
    const lit = ships.lit[i]!;
    lit.fill(0);
    if (grid === undefined || armed.length === 0) return 0;

    if (ships.forced.length < layout.count) ships.forced = new Uint8Array(layout.count);
    const forced = ships.forced;
    forced.fill(0);

    const b = bodies.indexOf(ships.bodyIds[i]!);
    if (b < 0) return 0;

    let firing = 0;
    for (let k = 0; k < armed.length; k++) {
        const t = armed[k]!;
        // What the nozzle throws rather than what the ship gets — a buried engine
        // has a full flame and no thrust, and it is the flame that burns — less
        // whatever damage has taken off it, since an engine that cannot burn
        // cannot burn anybody.
        const force = ships.exhaustOf(i, design, b, t);
        if (!(force > 0)) continue;
        // Any ray will do: a hull off to one side of a nozzle is as much worth
        // burning as one dead astern, and the rays exist precisely so that the
        // flame's width counts.
        let worth = false;
        // A thick engine's flame is in each layer, so is worth firing for
        // what either of them would burn.
        const engine = design.modules[design.engines[t]?.module ?? -1];
        const rays = engine === undefined ? 0 : plumeRays(geometryOf(engine));
        const layers = plumeLayers(design, t, ships.layersOf(b));
        for (let layer = HULL_LAYER; layer <= WEAPONS_LAYER && !worth; layer <<= 1) {
            if ((layers & layer) === 0) continue;
            for (let ray = 0; ray < rays && !worth; ray++) {
                if (!ships.plumes.cast(design, t, ray, force, bodies, b, grid, ships.hulls, layer)) continue;
                if (ships.plumes.share < WEAPON_PLUME_SHARE) continue;
                if (ships.plumes.body === b) continue;
                const other = ships.shipAt(bodies, ships.plumes.body);
                if (other < 0 || ships.derelict[other] === 1) continue;
                if (ships.team[other] === ships.team[i] || ships.isDisabled(other)) continue;
                worth = true;
            }
        }
        if (!worth) continue;
        forced[t] = 1;
        lit[t] = 1;
        firing++;
    }
    return firing;
}

/**
 * Add one want to the blend: a velocity, how much it is wanted, and the
 * acceleration of whatever that velocity is following, which is matched as
 * well as closed on: a velocity alone is always a step behind a target that
 * is speeding up.
 */
export function urge(ships: Ships, weight: number, vx: number, vy: number, ax = 0, ay = 0): void {
    if (!(weight > 0)) return;
    ships.urgeVx += weight * vx;
    ships.urgeVy += weight * vy;
    ships.urgeAx += weight * ax;
    ships.urgeAy += weight * ay;
    ships.urgeWeight += weight;
}

/**
 * How ship `i`, docking, sees the point it is docking with accelerating, from
 * that point's velocity now and when it last looked, into `dockAx`, `dockAy`.
 * A look that is not the step after the last starts afresh.
 */
export function dockingAccel(ships: Ships, i: number, vx: number, vy: number, dt: number): void {
    if (ships.dockSeenAt[i] === ships.now - 1 && dt > 0) {
        const settle = min(1, dt / DOCK_ACCEL_SETTLE);
        ships.dockAx[i] = ships.dockAx[i]! + ((vx - ships.dockSeenVx[i]!) / dt - ships.dockAx[i]!) * settle;
        ships.dockAy[i] = ships.dockAy[i]! + ((vy - ships.dockSeenVy[i]!) / dt - ships.dockAy[i]!) * settle;
    } else {
        ships.dockAx[i] = 0;
        ships.dockAy[i] = 0;
    }
    ships.dockSeenVx[i] = vx;
    ships.dockSeenVy[i] = vy;
    ships.dockSeenAt[i] = ships.now;
}

/**
 * Want to be somewhere between two ranges of another body, and moving with
 * it once there.
 *
 * Station-keeping is matching the other's velocity; closing or opening is
 * that plus a radial component. Inside the band a craft simply keeps pace,
 * which is what makes a range band a place to sit rather than a line to
 * oscillate across.
 *
 * **The radial part is flown down a stopping curve.** A craft speeds up
 * towards the band on `accelerate` of the thrust it has that way, holds
 * `approachSpeed`, and starts braking where `brake` of what it has the
 * other way will just stop it at the edge — so it arrives rather than
 * sailing through, however far out it started. Both are read off the layout
 * in the heading it is holding, since that is what it will have to do it
 * with: a hull whose guns keep it facing its target brakes on its retros.
 * For a craft fighting the other, that is `fightingAt`, its attack heading,
 * not however it lies mid-turn.
 *
 * Every positional want in the game is this one — an order and a charge to
 * cover are the same shape with different bands.
 */
/**
 * Close on `other` at `speed`, with nothing across the line between them,
 * and no braking to arrive: a ram is meant to hit.
 */
/**
 * Go round an asteroid hiding `at`, on body `tb`, from ship `i`: orbit it
 * the short way round to where `at` is, at the distance it is now, or clear
 * of it if that is too close. As fast as holds that distance in the rock's
 * pull, so it coasts round on a free orbit; a rock with no pull keeps it
 * going round at the speed it has. As loud as the rock is deep in the way.
 */
export function orbit(ships: Ships, bodies: Bodies, i: number, b: number, at: Spot, tb: number): void {
    const approach = ships.doctrines[i]!.approach;
    if (!(approach.orbitWeight > 0)) return;
    const x = bodies.x[b]!;
    const y = bodies.y[b]!;
    const rock = shipAim.blockingRock(ships, bodies, x, y, at.x, at.y, b, tb);
    if (rock < 0) return;
    const rb = bodies.indexOf(ships.bodyIds[rock]!);
    const ox = x - bodies.x[rb]!;
    const oy = y - bodies.y[rb]!;
    const r = length(ox, oy);
    if (!(r > 0)) return;
    const ux = ox / r;
    const uy = oy / r;
    // The way round that is shorter to where the target is.
    const sense = ux * (at.y - bodies.y[rb]!) - uy * (at.x - bodies.x[rb]!) >= 0 ? 1 : -1;
    const rvx = bodies.vx[b]! - bodies.vx[rb]!;
    const rvy = bodies.vy[b]! - bodies.vy[rb]!;
    shipClaw.wellPullOn(ships, bodies, b, rb);
    const free = sqrt(length(ships.partAt.x, ships.partAt.y) * r);
    const speed = free > 0 ? free : min(length(rvx, rvy), approach.approachSpeed);
    const clear = bodies.radius[rb]! + ships.designs[i]!.radius * (1 + approach.separationRadii);
    const out = r < clear ? (clear - r) / approach.responseTime : 0;
    urge(
        ships,
        approach.orbitWeight * URGE_REFERENCE * ships.blockDepth,
        bodies.vx[rb]! - sense * uy * speed + ux * out,
        bodies.vy[rb]! + sense * ux * speed + uy * out,
    );
}

/**
 * Close on `at` at `speed`, cancelling any sideways drift on the way: far
 * out, speeding up matters as much as drift does; within `ramSettle` seconds
 * of impact only the drift does, easing over as long again before that, so
 * a ram coming in fast spends its last seconds lining up rather than
 * speeding up past a miss. With a rock or a friend's hull across the line to
 * body `tb`, it keeps the speed it has rather than adding to it, which leaves
 * keeping clear and going round the time they need.
 */
export function charge(ships: Ships, bodies: Bodies, i: number, b: number, at: Spot, speed: number, tb: number): void {
    const dx = at.x - bodies.x[b]!;
    const dy = at.y - bodies.y[b]!;
    const range = length(dx, dy);
    if (!(range > 0)) {
        urge(ships, URGE_REFERENCE, at.vx, at.vy);
        return;
    }
    const ux = dx / range;
    const uy = dy / range;
    const closing = (bodies.vx[b]! - at.vx) * ux + (bodies.vy[b]! - at.vy) * uy;
    const settle = ships.doctrines[i]!.approach.ramSettle;
    const toGo = closing > 0 ? range / closing : Infinity;
    const share = settle > 0 ? clamp((toGo - settle) / settle, 0, 1) : 1;
    const x = bodies.x[b]!;
    const y = bodies.y[b]!;
    // A fighter overflies a friend's hull until it commits, which is not until it is about to strike (`commitOne`).
    const friend = !ships.designs[i]!.fighter && shipAim.friendBetween(ships, bodies, i, b, at.x, at.y, tb);
    const blocked = friend || shipAim.blockingRock(ships, bodies, x, y, at.x, at.y, b, tb) >= 0;
    // Never kept faster than it was told to hit at.
    const want = blocked ? min(speed, max(0, closing)) : min(speed, closing + (speed - closing) * share);
    urge(ships, URGE_REFERENCE, at.vx + ux * want, at.vy + uy * want);
}

export function hold(
    ships: Ships,
    bodies: Bodies,
    i: number,
    b: number,
    at: Spot,
    minRange: number,
    maxRange: number,
    approachSpeed: number,
    weight: number,
    fightingAt?: number,
): void {
    const fighting = fightingAt !== undefined;
    // Set again below while it is still closing on a curve planned on its mains.
    const wasOnMains = ships.brakingOnMains[i] === 1;
    if (fighting) {
        ships.brakingOnMains[i] = 0;
        ships.running[i] = 0;
    }
    if (!(weight > 0)) return;
    const dx = at.x - bodies.x[b]!;
    const dy = at.y - bodies.y[b]!;
    const range = length(dx, dy);
    if (fighting && range > 0 && ships.doctrines[i]!.approach.tangentialMax > 0) {
        pass(ships, bodies, i, b, at, dx / range, dy / range, range, minRange, maxRange, approachSpeed, fightingAt, weight);
        return;
    }
    let vx = at.vx;
    let vy = at.vy;
    if (range > 0) {
        // How far into the fade at either edge, signed: positive means too far
        // away. Measured from the fade's inner side, where the pull starts.
        const fade = ships.doctrines[i]!.approach.bandFade;
        let near = minRange * (1 + fade);
        let far = maxRange * (1 - fade);
        if (near > far) near = far = (near + far) / 2;
        // A craft coming in plans to stop by the middle of the band rather than
        // at its edge, braking across the band's width, and so goes on gliding
        // in past the edge while it is still closing.
        const middle = (near + far) / 2;
        const closingIn = ((bodies.vx[b]! - vx) * dx + (bodies.vy[b]! - vy) * dy) / range;
        const sense = range > far || (range > middle && closingIn > 0) ? 1 : range < near ? -1 : 0;
        if (sense !== 0) {
            // The way the band lies, and how fast this craft is already heading
            // that way relative to the other.
            const share = sense > 0 ? edgeFade(range - maxRange, maxRange, fade) : edgeFade(minRange - range, minRange, fade);
            if (fighting) ships.fightFade = share;
            const ux = (sense * dx) / range;
            const uy = (sense * dy) / range;
            const making = sense * closingIn;

            const approach = ships.doctrines[i]!.approach;
            const facing = fightingAt ?? bodies.angle[b]!;
            const push = accelerationAlong(ships, bodies, i, b, ux, uy, facing);
            const retro = max(accelerationAlong(ships, bodies, i, b, -ux, -uy, facing), BRAKE_FLOOR * push);
            const accelerate = approach.accelerate * push;
            const brake = approach.brake * retro;

            // The fastest it can be making and still stop in the gap, allowing for
            // the pilot taking its response time to answer. Braking itself is
            // never capped: `brake` is what the curve plans on, and a craft that
            // has fallen behind it spends whatever it has.
            const gap = sense > 0 ? range - middle : near - range;
            const response = approach.responseTime;
            let stopping = stoppingSpeed(brake, gap, response);
            // A craft that turns to burn brakes on its mains, once it has turned,
            // and is held to it: a curve planned on them is one it cannot stop on
            // otherwise.
            if (fighting) {
                const onRetros = stopping;
                const mains = mainsBrake(ships, bodies, i, b, retro);
                // Turned away and back again: it fights facing the other way. Only
                // when that gets it there sooner, turns and all, since on a short run
                // in a flip costs more than it saves; and coming in, only when its
                // retros could not stop it by the middle of the band with its guns
                // on, allowing for the pilot running a response time behind its
                // curve: a wide band is room to brake gently, guns on.
                const turn = halfTurnTime(ships, bodies, i, b);
                const turned = mains > brake ? stoppingSpeed(mains, gap, response + turn) : 0;
                const flipped = arrivalTime(mains, gap, approachSpeed, response + turn) + turn;
                const held = arrivalTime(brake, gap, approachSpeed, response);
                const sooner = turned > stopping && flipped < held && (sense < 0 || making > stoppingSpeed(brake, gap, 0));
                if (sooner) stopping = turned;
                // Already turned onto them: planned on them, with no turn to allow for.
                if (wasOnMains && mains > 0) stopping = max(stopping, stoppingSpeed(mains, gap, response));
                // Once on it, held to it until it has stopped closing, or in the fade,
                // where it is asked for a crawl rather than a stop, until its retros
                // could stop it with its guns on.
                // On the curve: going as fast as it can stop from on its mains, so it
                // has to turn and start now.
                const onCurve = sooner && turned < approachSpeed && making >= turned;
                const done = share < 1 ? onRetros : 0;
                ships.brakingOnMains[i] = sense > 0 && making > done && (onCurve || wasOnMains) ? 1 : 0;
            }
            // Eased in across the fade, so it settles where this balances
            // whatever else it wants rather than bouncing off the edge. Coming in,
            // asked to speed up only by the pull into the band, and otherwise to
            // keep what it is making, down the curve that stops it by the middle.
            let radial =
                sense > 0
                    ? min(
                          approachSpeed,
                          stopping,
                          max(making, min(approachSpeed, stoppingSpeed(brake, max(0, range - far), response)) * share),
                      )
                    : min(approachSpeed, stopping) * share;
            // A share below one caps how much faster it asks to be going within
            // one response time, which caps the push the pilot demands. At one it
            // is left alone, since the layout is the cap then, and capping the want
            // as well would only let a sideways correction crowd it out.
            if (approach.accelerate < 1) {
                radial = min(radial, max(making, 0) + accelerate * response);
            }
            vx += ux * radial;
            vy += uy * radial;
        }
    }
    urge(ships, weight, vx, vy);
}

/**
 * Attack on the move, for a doctrine that wants sideways speed: hold it
 * between `tangentialMin` and `tangentialMax` relative to the target, going
 * round whichever way it already is, since that costs the least.
 *
 * Out past the band it flies the line that grazes a circle at the band's
 * inner edge, so it comes in aiming to miss and its speed is sideways by the
 * time it is in range; it may close faster than that far out, no faster
 * than it can slow to it by the band. In the band it circles if it has the
 * speed and its thrust can hold the turn at it, closing no further inside
 * the inner edge; otherwise it carries on through on a pass. Out past the
 * band on the far side, the same line points it back, which is a turn onto
 * its mains for the next pass.
 */
export function pass(
    ships: Ships,
    bodies: Bodies,
    i: number,
    b: number,
    at: Spot,
    ux: number,
    uy: number,
    range: number,
    minRange: number,
    maxRange: number,
    approachSpeed: number,
    facing: number,
    weight: number,
): void {
    const approach = ships.doctrines[i]!.approach;
    const lo = approach.tangentialMin;
    const hi = approach.tangentialMax;
    const rvx = bodies.vx[b]! - at.vx;
    const rvy = bodies.vy[b]! - at.vy;
    const across = ux * rvy - uy * rvx;
    // Kept until it is plainly going round the other way, so a craft with
    // next to no sideways speed does not flip from side to side.
    let side = ships.passSide[i]!;
    if (side === 0 || across * side < -lo / 2) side = across < 0 ? -1 : 1;
    ships.passSide[i] = side;
    const tx = -uy * side;
    const ty = ux * side;
    const closing = rvx * ux + rvy * uy;
    const speed = clamp(across * side, lo, hi);
    const inner = minRange > 0 ? minRange : maxRange / 2;
    const arrive = clamp(approachSpeed, lo, hi);
    // Across the fade at the outer edge it is part way from going round to
    // coming back in, so a craft riding that edge leans on its mains gently
    // and steadily rather than in bursts each time it crosses the line.
    const out = edgeFade(range - maxRange, maxRange, approach.bandFade);
    let wantX = 0;
    let wantY = 0;
    if (range > maxRange) ships.running[i] = 1;
    if (out > 0) {
        const brake = approach.brake * accelerationAlong(ships, bodies, i, b, -ux, -uy, facing);
        const fly = max(arrive, min(approachSpeed, sqrt(arrive * arrive + 2 * brake * max(0, range - maxRange))));
        const graze = min(1, inner / range);
        const straight = sqrt(1 - graze * graze);
        wantX += (ux * straight + tx * graze) * fly * out;
        wantY += (uy * straight + ty * graze) * fly * out;
    }
    if (out < 1) {
        // Circles only once it has the speed. Short of it, it carries on through
        // if it is passing, or heads out if not, and the run back in on its
        // mains brings it.
        const pull = approach.accelerate * accelerationAlong(ships, bodies, i, b, ux, uy, facing);
        const circling = across * side >= lo && (speed * speed) / range <= pull;
        const passing = circling || closing > lo / 2;
        const inside = edgeFade(inner - range, inner, approach.bandFade);
        // Neither: it carries on the way it is going, which takes it out past the
        // band, and is pushed out only once into the inner edge's fade, harder
        // the deeper it is; a craft still on its way in turned to burn away
        // before it had come anywhere near.
        const radial = circling ? min(closing, 0) * inside : passing ? closing : closing + (min(closing, -arrive) - closing) * inside;
        if (!passing && inside > 0.5 && range <= maxRange) ships.running[i] = 1;
        wantX += (ux * radial + tx * speed) * (1 - out);
        wantY += (uy * radial + ty * speed) * (1 - out);
    }
    urge(ships, weight, at.vx + wantX, at.vy + wantY);
}

/**
 * What this craft plans to brake at turned onto its mains, m/s²: `brake` of
 * its main thrust axis's acceleration, if its doctrine would turn to burn for
 * that over the `retro` it has with its guns held on, and 0 if not. Weighed
 * as `burnOrFight` weighs a change too big for the turn to matter, against
 * holding its guns on inside the band.
 */
export function mainsBrake(ships: Ships, bodies: Bodies, i: number, b: number, retro: number): number {
    const design = ships.designs[i]!;
    const approach = ships.doctrines[i]!.approach;
    const layout = ships.layoutOf(i);
    const bearing = pushBearing(layout, design.thrustBearing);
    const axis = layout.maxThrustAlong(cos(bearing), sin(bearing)) / movable(bodies.mass[b]!);
    if (!(axis > retro)) return 0;
    const turns = approach.burnWeight * ((axis - retro) / axis) > approach.rangeHold * (1 + BURN_MARGIN);
    return turns ? approach.brake * axis : 0;
}

/**
 * How hard ship `i` on body `b` can push along its strongest push, m/s², as
 * the helm would deliver it, and in `pushDelay` how long before it starts to:
 * its response time and a half turn, or, spinning (`spinWay`), a 1/π share of
 * that push on average, with half a spin to bring it round.
 */
export function pushAbility(ships: Ships, bodies: Bodies, i: number, b: number): number {
    const layout = ships.layoutOf(i);
    const response = ships.doctrines[i]!.approach.responseTime;
    const bearing = pushBearing(layout, ships.designs[i]!.thrustBearing);
    const push = layout.maxThrustAlong(cos(bearing), sin(bearing)) / movable(bodies.mass[b]!);
    if (spinWay(layout, bearing) !== 0) {
        ships.pushDelay = response + PI / STEER_SPIN;
        return push / PI;
    }
    ships.pushDelay = response + halfTurnTime(ships, bodies, i, b);
    return push;
}

/** Seconds to turn half round from rest and stop there, flat out both ways. */
export function halfTurnTime(ships: Ships, bodies: Bodies, i: number, b: number): number {
    return hullTurnTime(ships, bodies, i, b, PI);
}

/** Seconds to turn through `by` radians from rest and stop there, flat out both ways. */
export function hullTurnTime(ships: Ships, bodies: Bodies, i: number, b: number, by: number): number {
    return turnTime(ships.layoutOf(i), bodies.inertia[b]!, by);
}

/** How hard this craft can accelerate along a world direction facing `angle`, m/s². */
export function accelerationAlong(ships: Ships, bodies: Bodies, i: number, b: number, dirX: number, dirY: number, angle: number): number {
    const c = cos(angle);
    const s = sin(angle);
    const force = ships.layoutOf(i).maxThrustAlong(dirX * c + dirY * s, -dirX * s + dirY * c);
    return force / movable(bodies.mass[b]!);
}

/**
 * Stay with what this craft is covering, and say what that is.
 *
 * The pull fades to nothing as the gap closes (`cohesionUrge`), so a craft
 * that has caught up is steered by the fight alone until the fight has drawn
 * it off again — which is what has a fleet close up, advance while it is
 * closed up, and gather when it straggles, rather than either huddling or
 * stringing out.
 */
export function cover(ships: Ships, bodies: Bodies, i: number, b: number): number {
    const consort = shipDecide.liveConsort(ships, bodies, i, b);
    if (consort === NO_TARGET) return NO_TARGET;
    const cb = bodies.indexOf(ships.bodyIds[consort]!);

    const design = ships.designs[i]!;
    const station = shipDecide.escortBand(ships, i, design, consort);
    const inner = shipDecide.escortInnerEdge(ships, i, design, consort, station);
    const gap = length(bodies.x[cb]! - bodies.x[b]!, bodies.y[cb]! - bodies.y[b]!);
    // Told to, it holds the band as firmly as it would a station.
    const weight =
        ships.defendingOf(i) === consort
            ? URGE_REFERENCE
            : cohesionUrge(ships.doctrines[i]!.targeting, gap, station, ships.doctrines[i]!.approach.bandFade, inner);
    const told = ships.getCurrentOrder(i);
    const speed = told?.defend === true && told.target === consort ? told.speed : undefined;
    hold(
        ships,
        bodies,
        i,
        b,
        ships.locate(bodies, consort, cb, ships.coverAt),
        inner,
        station,
        speed ?? ships.doctrines[i]!.approach.approachSpeed,
        weight,
    );
    return consort;
}

/**
 * Keep out of everybody's way.
 *
 * Whoever it is: a collision hurts both hulls whichever side they are on,
 * and a craft that swerved only for its friends would ram its enemies by
 * accident and call it tactics.
 *
 * **Steered by where a neighbour will be, not by where it is.** Distance
 * alone cannot do this job: a craft holding station a hull's width away is
 * no danger at all and one crossing at two hundred metres a second is,
 * and a bubble treats them the same — so it shoves at things already moving
 * apart and has nothing to say about the thing about to arrive. Measured,
 * a plain bubble moved a fleet action's contacts by a tenth and made some of
 * them worse.
 *
 * So: how long until this pair is at its closest, and how close that will
 * be. A pair that is already opening is left alone, and one that is closing
 * is answered by a want to be somewhere else *at that moment* — steering
 * away from where the gap will be, which is a heading change rather than a
 * stop, so a craft keeps the speed it is carrying and passes wider.
 *
 * The urgency is how little room the pass will leave and how soon it is, so
 * keeping clear is a whisper at the edge of the look-ahead and the loudest
 * thing in the blend just before a collision.
 */
/** Whether ship `e` can hurt anything: a main gun that can fire, or a ram doctrine and the control to fly it. */
export function armed(ships: Ships, e: number): boolean {
    if (ships.alive[e] !== 1 || ships.derelict[e] === 1) return false;
    return !ships.isDisarmed(e) || (ships.doctrines[e]!.approach.ramRadii > 0 && ships.hasControl(e));
}

/**
 * What a flee order runs from or hides behind now: its target, or
 * `NO_TARGET` for every armed enemy, which is also what it falls back on
 * once an enemy it was running from can no longer hurt it, or cover it was
 * hiding behind is gone altogether. Cover destroyed is still hidden behind,
 * as a wreck.
 */
export function fleeTarget(ships: Ships, order: Readonly<Order>): number {
    const t = order.target;
    if (t === NO_TARGET || ships.alive[t] !== 1) return NO_TARGET;
    return order.hide === true || armed(ships, t) ? t : NO_TARGET;
}

/**
 * Weigh the armed enemies of ship `i` whose reach, times its `fleeMargin`,
 * point (`x`, `y`) is inside: `only` alone, or all of them for `NO_TARGET`.
 * Each by how deep inside it is, and one with a gun on ship `i` by its
 * `aimedWeight` more. Leaves the weighted sum of directions to them in
 * `threatX` and `threatY`, and says how much they weigh in all.
 */
export function threats(ships: Ships, bodies: Bodies, i: number, b: number, x: number, y: number, only: number): number {
    const approach = ships.doctrines[i]!.approach;
    const mine = ships.designs[i]!.radius;
    let tx = 0;
    let ty = 0;
    let total = 0;
    for (let e = 0; e < ships.alive.length; e++) {
        if ((only !== NO_TARGET && e !== only) || !ships.hostile(i, e) || !armed(ships, e)) continue;
        const eb = bodies.indexOf(ships.bodyIds[e]!);
        if (eb < 0 || eb === b) continue;
        const clear = (shipSupply.fightReach(ships, e) + mine) * approach.fleeMargin;
        const dx = bodies.x[eb]! - x;
        const dy = bodies.y[eb]! - y;
        const d = length(dx, dy);
        if (!(d < clear) || !(d > 0)) continue;
        const weight = (1 - d / clear) * (aimsAt(ships, e, i) ? approach.aimedWeight : 1);
        tx += (weight * dx) / d;
        ty += (weight * dy) / d;
        total += weight;
    }
    ships.threatX = tx;
    ships.threatY = ty;
    return total;
}

/** Whether any of ship `e`'s mounts is aimed at ship `i`. */
export function aimsAt(ships: Ships, e: number, i: number): boolean {
    const aiming = ships.turretAiming[e]!;
    for (let t = 0; t < aiming.length; t++) if (aiming[t] === i) return true;
    return false;
}

/**
 * Fly a flee order. Running from what is within reach of it, straight away
 * at its approach speed; clear of them all, easing off at `FLEE_EASE`, so it
 * neither leaves its friends behind nor has to brake hard to run again.
 * Hiding, round to its cover's side away from the threats to it, as close as
 * its keeping clear of anything holds it, and moving with it there. Says
 * whether it is running, to point its mains that way.
 */
export function flee(ships: Ships, bodies: Bodies, i: number, b: number, order: Readonly<Order>): boolean {
    const approach = ships.doctrines[i]!.approach;
    const from = fleeTarget(ships, order);
    const vx = bodies.vx[b]!;
    const vy = bodies.vy[b]!;
    const cb = from !== NO_TARGET && order.hide === true ? bodies.indexOf(ships.bodyIds[from]!) : -1;
    if (cb >= 0 && cb !== b) return hide(ships, bodies, i, b, cb);

    const weight = threats(ships, bodies, i, b, bodies.x[b]!, bodies.y[b]!, from);
    if (weight > 0) {
        const away = length(ships.threatX, ships.threatY);
        if (away > 0) {
            urge(ships, URGE_REFERENCE, (-ships.threatX / away) * approach.approachSpeed, (-ships.threatY / away) * approach.approachSpeed);
            return true;
        }
    }
    const speed = length(vx, vy);
    const keep = speed > 0 ? max(0, 1 - (FLEE_EASE * approach.responseTime) / speed) : 0;
    urge(ships, URGE_REFERENCE, vx * keep, vy * keep);
    return false;
}

/** Fly round behind cover `cb`, from the threats to it, or the nearest armed enemy when none is in reach of it. */
export function hide(ships: Ships, bodies: Bodies, i: number, b: number, cb: number): boolean {
    const approach = ships.doctrines[i]!.approach;
    const cx = bodies.x[cb]!;
    const cy = bodies.y[cb]!;
    let tx = 0;
    let ty = 0;
    if (threats(ships, bodies, i, b, cx, cy, NO_TARGET) > 0) {
        tx = ships.threatX;
        ty = ships.threatY;
    } else {
        let nearest = Infinity;
        for (let e = 0; e < ships.alive.length; e++) {
            if (!ships.hostile(i, e) || !armed(ships, e)) continue;
            const eb = bodies.indexOf(ships.bodyIds[e]!);
            if (eb < 0 || eb === b || eb === cb) continue;
            const d = length(bodies.x[eb]! - cx, bodies.y[eb]! - cy);
            if (d < nearest && d > 0) {
                nearest = d;
                tx = (bodies.x[eb]! - cx) / d;
                ty = (bodies.y[eb]! - cy) / d;
            }
        }
    }
    // With nothing to hide from, it stays on whichever side it is.
    let sx = cx - bodies.x[b]!;
    let sy = cy - bodies.y[b]!;
    const toward = length(tx, ty);
    if (toward > 0) {
        sx = tx / toward;
        sy = ty / toward;
    } else {
        const d = length(sx, sy);
        if (d > 0) {
            sx /= d;
            sy /= d;
        }
    }
    const touching = ships.designs[i]!.radius + bodies.radius[cb]!;
    const off = touching * (1 + max(0, approach.separationRadii));
    // The spot, and the way to it.
    const dx = cx - sx * off - bodies.x[b]!;
    const dy = cy - sy * off - bodies.y[b]!;
    const gap = length(dx, dy);
    let wx = bodies.vx[cb]!;
    let wy = bodies.vy[cb]!;
    if (gap > 0) {
        const ux = dx / gap;
        const uy = dy / gap;
        const push = accelerationAlong(ships, bodies, i, b, ux, uy, bodies.angle[b]!);
        const brake = approach.brake * max(accelerationAlong(ships, bodies, i, b, -ux, -uy, bodies.angle[b]!), BRAKE_FLOOR * push);
        const speed = min(approach.approachSpeed, stoppingSpeed(brake, gap, approach.responseTime));
        wx += ux * speed;
        wy += uy * speed;
    }
    urge(ships, URGE_REFERENCE, wx, wy);
    return gap > touching;
}

export function avoid(
    ships: Ships,
    bodies: Bodies,
    i: number,
    b: number,
    flying: number,
    covering: number,
    hulksOnly = false,
    ramming = false,
    landing = false,
): void {
    const approach = ships.doctrines[i]!.approach;
    if (!(approach.separation > 0) || !(approach.separationRadii > 0)) return;
    const mine = ships.designs[i]!.radius;
    // A rock or a friend it is ramming rides the body it is ramming.
    const flyingBody = flying === NO_TARGET ? -1 : bodies.indexOf(ships.bodyIds[flying]!);
    // Landing, nor the rock its carrier is moored to, which its pad sits against.
    const under = landing && flying !== NO_TARGET ? ships.carrierBodyOf(bodies, flying) : -1;
    const x = bodies.x[b]!;
    const y = bodies.y[b]!;
    const vx = bodies.vx[b]!;
    const vy = bodies.vy[b]!;

    for (let t = 0; t < ships.alive.length; t++) {
        if (t === i || ships.alive[t] === 0) continue;
        // Never the thing it is flying at. Where a craft wants to be relative to
        // that is already decided, by an order or by the doctrine that chose it,
        // and a second opinion here is this code arguing with the orders it is
        // meant to be carrying out — a ship told to ram would sheer off at the
        // last moment and call it seamanship.
        if (t === flying) continue;
        // Nor its own fighters: a carrier trusts what flies from its pads to
        // keep clear of it, rather than running from its wing as it comes and goes.
        if (ships.home[t] === i) continue;
        // Closing on a rock, it keeps clear of hulks, and of a friend moored to that rock, which stands where it is.
        const neighbour = hulksOnly && ships.hasControl(t) && shipForage.isMoored(ships, t) && ships.parkedOn[t] === flying;
        if (hulksOnly && ships.hasControl(t) && !neighbour) continue;
        // Ramming, it keeps clear of rocks and its own side, which nothing rams on purpose.
        if (ramming && !ships.isAsteroid(t) && !(ships.team[t] === ships.team[i] && ships.hasControl(t))) continue;
        const ob = bodies.indexOf(ships.bodyIds[t]!);
        // Nothing to keep clear of in something that cannot be hit.
        if (ob < 0 || ob === b || bodies.ghost[ob] === 1 || !ships.meets(b, ob)) continue;
        // Coming in to grip or land, it is among rocks on purpose, and keeps clear of them as of anything.
        const rock = ships.rockFlag[t] === 1 && !hulksOnly && !landing;
        // Landing, nothing riding the hull it lands on: a copy on its carrier's slipway is that hull.
        if ((ramming || rock || landing) && ob === flyingBody) continue;
        if (ob === under) continue;

        const touching = mine + ships.designs[t]!.radius;
        // Clear by its own size, not the other's, which would keep it a rock's or a carrier's breadth off.
        let room = (ramming ? mine : touching) * approach.separationRadii;
        // From a neighbour on the rock only by its own size, or it could never grip the face beside it.
        if (neighbour) room = mine;
        // Closing straight in on a face chosen clear of both (`wayInClear`), only from touching them.
        if (hulksOnly && ships.gripClosing[i] === 1) room = 0;
        // Its charge no further out than its station, or the two wants fight:
        // covering pulls it in to where keeping clear pushes it out.
        if (t === covering) room = min(room, max(0, shipDecide.escortBand(ships, i, ships.designs[i]!, t) - touching));
        const dx = bodies.x[ob]! - x;
        const dy = bodies.y[ob]! - y;
        const rvx = bodies.vx[ob]! - vx;
        const rvy = bodies.vy[ob]! - vy;

        // When they will be at their closest, and how far apart that is. A pair
        // already opening is at its closest *now*, which is what the clamp says
        // — and saying it that way rather than dropping the pair is what keeps
        // this continuous: an urge that vanished the instant two craft stopped
        // closing would step from its loudest to nothing at the very moment it
        // was loudest, and that discontinuity is enough to make two runs of the
        // same battle diverge from a rounding difference.
        const speedSq = rvx * rvx + rvy * rvy;
        const closing = dx * rvx + dy * rvy;
        let closest = speedSq > 0 ? max(0, -closing / speedSq) : 0;
        let missX = dx + rvx * closest;
        let missY = dy + rvy * closest;
        let miss = length(missX, missY);
        if (miss >= touching + room) continue;
        // Soon is when they touch, if they will: the closest the middles come is
        // far later than that for anything large.
        let when = miss < touching && speedSq > 0 ? max(0, closest - sqrt((touching * touching - miss * miss) / speedSq)) : closest;
        // Its charge, which covering pulls it towards, is kept clear of with a
        // soft edge, so the two settle where they balance; anything else is
        // dodged flat out, since nothing pulls it back, and so is a rock, which
        // will not move.
        const soft = t === covering && !rock;
        // Its charge already too close, and drawing closer too slowly to matter
        // within the look-ahead: answered as it stands now, or a pair drifting
        // together at a crawl, or at rest, would never be kept apart at all.
        if (soft && when > approach.avoidHorizon && length(dx, dy) < touching + room) {
            closest = 0;
            when = 0;
            missX = dx;
            missY = dy;
            miss = length(dx, dy);
        }
        // A pass that would come within its own clearance of a rock is looked for
        // however far ahead it is: a rock is big, and does not get out of the way.
        const clearance = mine * approach.separationRadii;
        const need = rock ? touching + clearance - miss : 0;
        if (when > approach.avoidHorizon && !(need > 0)) continue;
        // Nor a friend coming to land on it, dock with it or drink from it with
        // its claw: shying away from that is refusing it.
        if (ships.salvaging[t] === i && (ships.landingPad[t]! >= 0 || ships.dockPort[t]! >= 0 || !ships.hostile(t, i))) continue;

        // Away from where the gap is going to be. A pass that would be dead on
        // has no side to go to, so the side is taken across the closing motion
        // — either way opens it, and taking the same one every time is what
        // keeps this deterministic.
        let awayX: number;
        let awayY: number;
        if (miss > 0) {
            awayX = -missX / miss;
            awayY = -missY / miss;
        } else if (speedSq > 0) {
            const speed = sqrt(speedSq);
            awayX = -rvy / speed;
            awayY = rvx / speed;
        } else {
            continue;
        }

        const depth = 1 - miss / (touching + room);
        let weight = when < approach.avoidHorizon ? approach.separation * depth * (1 - when / approach.avoidHorizon) : 0;
        if (need > 0) weight = max(weight, approach.separation * rockUrgency(ships, bodies, i, b, need, clearance, when, awayX, awayY));
        if (weight > ships.dodgeWeight) {
            ships.dodgeWeight = weight;
            ships.dodgeWhen = when;
            ships.dodgeRock = rock;
        }
        // From its charge, opening at a speed that grows with how deep inside
        // the clearance it is, less what it is opening at already, so a pair
        // drawing apart eases off as it leaves rather than flying apart flat out.
        const ds = approach.dodgeSpeed;
        const opening = -(rvx * awayX + rvy * awayY);
        let dodge: number;
        if (!soft) dodge = ds;
        else if (closest > 0) dodge = clamp(ds * depth - opening, 0, ds);
        else {
            // Not closing, so nothing to dodge in time for: it opens no faster
            // than it can stop from by the edge, and slows if it is, so it
            // comes to rest there rather than sailing on past what pulls it back.
            const push = accelerationAlong(ships, bodies, i, b, awayX, awayY, bodies.angle[b]!);
            const brake =
                approach.brake * max(accelerationAlong(ships, bodies, i, b, -awayX, -awayY, bodies.angle[b]!), BRAKE_FLOOR * push);
            const opens = min(ds * depth, stoppingSpeed(brake, touching + room - miss, approach.responseTime));
            dodge = clamp(opens - opening, -ds, ds);
        }
        urge(ships, weight, vx + awayX * dodge, vy + awayY * dodge);
    }
}

/**
 * How loudly ship `i` should keep clear of a rock it will pass `need` metres
 * too close to in `when` seconds, from nothing to one.
 *
 * Against how long a sidestep takes it: turning its mains to (`awayX`,
 * `awayY`), and then pushing `need` metres aside on them. Loudest from when it
 * must start to make it, rising from nothing `rockMargin` seconds before
 * that, so a heavy hull that turns slowly looks further ahead than a fighter.
 * A dodge that only grew with nearness had a ship keep its guns on target
 * until a rock was too close to miss. Scaled by `need` against `clearance`
 * too, so it fades out at the edge of the clearance rather than stopping dead.
 */
export function rockUrgency(
    ships: Ships,
    bodies: Bodies,
    i: number,
    b: number,
    need: number,
    clearance: number,
    when: number,
    awayX: number,
    awayY: number,
): number {
    const design = ships.designs[i]!;
    const approach = ships.doctrines[i]!.approach;
    const layout = ships.layoutOf(i);
    const bearing = pushBearing(layout, design.thrustBearing);
    const push = layout.maxThrustAlong(cos(bearing), sin(bearing)) / bodies.mass[b]!;
    const turn = hullTurnTime(ships, bodies, i, b, angleDelta(bodies.angle[b]!, atan2(awayY, awayX) - bearing));
    const takes = turn + approach.responseTime + (push > 0 ? sqrt((2 * need) / push) : Infinity);
    const soon = clamp((takes + approach.rockMargin - when) / approach.rockMargin, 0, 1);
    return (clearance > 0 ? min(1, need / clearance) : 1) * soon;
}

/**
 * The share of a magnetic engine's thrust its ring's power keeps this step,
 * having drawn it: 1 when powered, its bell's own aim when not, and 1 for any
 * other engine.
 */
function ringAim(ships: Ships, design: ShipDesign, b: number, module: number, u: number, dt: number): number {
    const placed = design.modules[module];
    const need = u * (placed?.stats.ringPower ?? 0) * dt;
    if (!(need > 0)) return 1;
    const allowed = shipSupply.allowed(ships, Resource.Charge, b, module, Claim.Thrust, need);
    const got = ships.power.draw(b, module, need < allowed ? need : allowed);
    shipSupply.took(ships, Resource.Charge, b, module, Claim.Thrust, got);
    const bell = geometryOf(placed!).bellDivergence;
    return bell + (1 - bell) * (got / need);
}

/**
 * Draw what this ship's engines burned this step from its tanks, and throttle
 * back any engine whose tanks could not supply it.
 *
 * Paid by gas thrown rather than by thrust delivered: an engine firing into
 * its own hull burns its fuel all the same (`exhaustOf`). A magnetic nozzle
 * also draws its ring's power; short of it, the same gas leaves aimed only as
 * well as its bell aims it, so it pushes with less.
 */
export function burn(ships: Ships, dt: number, bodies: Bodies, i: number): void {
    const b = bodies.indexOf(ships.bodyIds[i]!);
    if (b < 0) return;
    const design = ships.designs[i]!;
    const throttles = ships.throttles[i]!;
    let burned = false;
    let short = false;
    for (let t = 0; t < design.engines.length; t++) {
        const u = throttles[t]!;
        if (!(u > 0)) continue;
        const module = design.engines[t]!.module ?? -1;
        const exhaust = design.modules[module]?.stats.exhaustVelocity ?? 0;
        // A layout built by hand has no modules, and so nothing to run dry.
        if (!(exhaust > 0)) continue;
        const wanted = (u * ships.exhaustOf(i, design, b, t) * dt) / exhaust;
        if (!(wanted > 0)) continue;
        const allowed = shipSupply.allowed(ships, Resource.Fuel, b, module, Claim.Thrust, wanted);
        const got = ships.fuel.feed(b, module, wanted < allowed ? wanted : allowed, ships.damage);
        shipSupply.took(ships, Resource.Fuel, b, module, Claim.Thrust, got);
        burned = true;
        const aimed = ringAim(ships, design, b, module, u, dt);
        if (got < wanted || aimed < 1) {
            throttles[t] = ((u * got) / wanted) * aimed;
            short = true;
        }
    }
    if (burned) shipBreakup.settleMass(ships, bodies, b);
    if (!short) return;

    // What the engines that ran short actually push with.
    const layout = ships.layoutOf(i);
    let fx = 0;
    let fy = 0;
    let torque = 0;
    for (let t = 0; t < layout.count; t++) {
        const u = throttles[t]!;
        fx += layout.wfx[t]! * u;
        fy += layout.wfy[t]! * u;
        torque += layout.wt[t]! * u;
    }
    ships.demandFx[i] = fx;
    ships.demandFy[i] = fy;
    ships.demandTorque[i] = torque;
}

/**
 * Let fuel out of every hole in this ship's body, and push the body the
 * other way. Once per body: a ship riding another's leaks nothing of its own.
 */
export function leak(ships: Ships, dt: number, bodies: Bodies, i: number): void {
    ships.leakFx[i] = 0;
    ships.leakFy[i] = 0;
    ships.leakTorque[i] = 0;
    const b = bodies.indexOf(ships.bodyIds[i]!);
    if (b < 0 || ships.shipByBody[b] !== i || !(dt > 0)) return;
    const leaks = ships.fuel.leaksOf(b);
    if (leaks.length === 0) return;
    const design = ships.hullDesign[b]!;
    let fx = 0;
    let fy = 0;
    let torque = 0;
    let vented = false;
    for (const leak of leaks) {
        leak.age += dt;
        // The lining swells into the hole, pinching it off as far as it can reach.
        if (leak.width > leak.floor) {
            leak.width = max(leak.floor, leak.width - leak.closing * dt);
            if (!(leak.width > 0) && leak.closed < 0) leak.closed = leak.age;
        }
        const fill = ships.fuel.fill(b, leak.module);
        const taken = ships.fuel.vent(b, leak.module, leakRate(PI * 0.25 * leak.width * leak.width, fill) * dt);
        leak.rate = taken / dt;
        if (!(taken > 0)) continue;
        vented = true;
        const m = design.modules[leak.module]!;
        const c = cos(m.angle);
        const s = sin(m.angle);
        const hx = m.x + leak.x * c - leak.y * s;
        const hy = m.y + leak.x * s + leak.y * c;
        // Pushed against the jet, at the hole.
        const thrust = leak.rate * leakSpeed(fill);
        const px = -(leak.nx * c - leak.ny * s) * thrust;
        const py = -(leak.nx * s + leak.ny * c) * thrust;
        fx += px;
        fy += py;
        torque += hx * py - hy * px;
    }
    if (vented) shipBreakup.settleMass(ships, bodies, b);
    ships.leakFx[i] = fx;
    ships.leakFy[i] = fy;
    ships.leakTorque[i] = torque;
}
