import { Bodies } from "./bodies.js";
import type { ShipDesign } from "./blueprint.js";
import { DOCK_HOLD, JOINT_IMPULSE_PER_AREA, seamShare, seamThickness, weldFactor } from "./connectivity.js";
import { DAMAGE_ENERGY_PER_KG, DamageEffect, DISASSEMBLY_WASTE } from "./damage.js";

import { cos, exp, length, max, min, sin, sqrt } from "./math.js";
import { RobotMode } from "./robots.js";
import { pushBearing } from "./helm.js";
import type { World } from "./world.js";
import { ROBOT_REPAIR_RATE } from "./modules.js";
import * as shipRobots from "./shipRobots.js";
import * as shipRebuild from "./shipRebuild.js";
import * as shipSupply from "./shipSupply.js";
import * as shipBreakup from "./shipBreakup.js";
import { type Ships, NO_TARGET, NEUTRAL_TEAM, exhaustOf } from "./ships.js";
import * as shipClaw from "./shipClaw.js";
import * as shipDocking from "./shipDocking.js";
import * as shipBuild from "./shipBuild.js";
import * as shipOrders from "./shipOrders.js";
import * as shipDecide from "./shipDecide.js";
import * as shipFlight from "./shipFlight.js";
import { CLAW_HEAT_RATE, CLAW_HEAT_ENERGY } from "./shipWeld.js";
import { ROBOT_SPENT } from "./shipRobots.js";
import { SHOCK_REACH } from "./shipBreakup.js";

/**
 * The most of its thrust across its jaws a ship will spend being carried round
 * a spinning source at its gate: past it, there is too little left to steer
 * on to a face, and the source is too fast a spin to grip.
 */
const SPIN_HOLD = 0.5;

/**
 * Foraging: a ship with a claw going for fuel, ore or wreckage, mooring to a
 * rock to mine it, and delivering what it holds to a friend.
 */

/** With no working core, every engine cuts out and every turret brakes to a stop. */
/**
 * Break off for fuel, metal or charge, or go back to the fight.
 *
 * A ship with a working claw goes looking once its claw's piece of hull is
 * down to its doctrine's `scavengeFuelBelow` of a full load, and keeps at it,
 * source after source, until it is full; then the fight has it back. Where
 * to drink is reconsidered as often as a fight would be, and sooner when the
 * source is gone or dry. Without one, a fighter goes to a friend's pad, and
 * anything else with a port to a friend's port, once its fuel or charge is
 * down to `refuelBelow`; a fighter also goes once its metal is down to
 * `rearmBelow`, or it is no more whole than `repairBelow`, and whichever
 * sent it, it comes back for all of them.
 */
export function forage(ships: Ships, world: World, bodies: Bodies, i: number): void {
    const b = bodies.indexOf(ships.bodyIds[i]!);
    const held = ships.salvaging[i]!;
    const hb = held !== NO_TARGET && ships.alive[held] === 1 ? bodies.indexOf(ships.bodyIds[held]!) : -1;
    // On an errand, it takes on or gives all it can whatever its doctrine's thresholds.
    const errand = ships.errandOf(i);
    const ordered = errand === "dock";
    const scavengeOrder = errand === "scavenge";
    const deliverOrder = errand === "deliver";
    const only = errand !== undefined ? ships.getCurrentOrder(i)!.target : NO_TARGET;
    // Drinking: its claw or its pad lets go when it is done. First, since it
    // now rides the other's body under a design that is both of theirs, or
    // is parked on its pad.
    const docked = b >= 0 && (hb === b || (held !== NO_TARGET && ships.parkedOn[i] === held));
    if (docked && (ships.orders[i]!.length === 0 || errand !== undefined)) {
        if (errand !== undefined) ships.errandDocked[i] = 1;
        return;
    }
    if (errand !== undefined && ships.errandDocked[i] === 1) {
        // Let go: it has had all that dock or source would give, or given all it
        // could. Sent nowhere in particular, it scavenges or delivers on.
        if (ordered || only !== NO_TARGET) {
            finishErrand(ships, i);
            return;
        }
        ships.errandDocked[i] = 0;
        stopForaging(ships, i);
    }
    const design = ships.designs[i]!;
    const approach = ships.doctrines[i]!.approach;
    // An order given outranks it, as it outranks the rest of doctrine.
    const free = b >= 0 && (ships.orders[i]!.length === 0 || errand !== undefined);
    // Doctrine's own errands, when it is on none of an order's.
    const own = free && errand === undefined;
    if (errand !== undefined && errand !== "deliver" && ships.delivering[i] === 1) stopForaging(ships, i);
    // Taking fuel to a friend, it keeps at it while it has fuel to give.
    const giverPort =
        (own && !design.fighter && approach.deliverFuelAbove > 0) || (free && deliverOrder)
            ? shipDocking.workingPort(ships, bodies, i, b)
            : -1;
    if (deliverOrder) {
        if (giverPort >= 0 && hasToSpare(ships, b, giverPort)) deliver(ships, world, bodies, i, b, giverPort, only);
        if (ships.salvaging[i] === NO_TARGET) finishErrand(ships, i);
        return;
    }
    const deliverable = giverPort >= 0 && canDeliver(ships, b, giverPort, approach.deliverFuelAbove);
    if (ships.delivering[i] === 1) {
        if (deliverable) {
            deliver(ships, world, bodies, i, b, giverPort);
            return;
        }
        stopForaging(ships, i);
    }
    // A ship that builds only anchored goes to anchor when it would build.
    const anchors = own && shipBuild.wantsAnchor(ships, bodies, i);
    const forages = scavengeOrder || anchors || (own && (approach.scavengeFuelBelow > 0 || approach.scavengeMetalBelow > 0));
    const docks = ordered || (own && approach.refuelBelow > 0);
    const recharges = ordered || (own && approach.rechargeBelow > 0);
    const claw = forages && b >= 0 ? shipClaw.workingClaw(ships, i, b) : -1;
    if (scavengeOrder && claw < 0) {
        finishErrand(ships, i);
        return;
    }
    // A fighter with no claw lands on a friend's pad instead, and anything
    // else with a port of its own docks with a friend's. Only a pad mends.
    const rearms = claw < 0 && design.fighter && (ordered || (own && approach.rearmBelow >= 0));
    const repairs = claw < 0 && design.fighter && (ordered || (own && (approach.repairBelow > 0 || approach.repairArmed >= 0)));
    const lands = (docks || rearms || recharges || repairs) && claw < 0 && design.fighter;
    const port = docks && !design.fighter ? shipDocking.workingPort(ships, bodies, i, b) : -1;
    // A ship with a claw too docks only once it is down to `refuelBelow`, and
    // until it is full; otherwise it goes scavenging by `scavengeFuelBelow`.
    let viaPort = port >= 0 && claw < 0;
    if (port >= 0 && claw >= 0) {
        const portHeld = ships.fuel.pieceHeld(b, port);
        const portRoom = ships.fuel.pieceRoom(b, port);
        viaPort = portRoom > 0 && (ships.docking[i] === 1 || portHeld <= approach.refuelBelow * (portHeld + portRoom));
    }
    const scavenges = claw >= 0 && !viaPort;
    // Metal from a wreck comes by its robots taking it apart.
    const strips = scavenges && (scavengeOrder || approach.scavengeMetalBelow > 0) && shipRebuild.hasRobots(ships, b, i);
    const into = scavenges ? claw : lands ? (design.cores[0] ?? 0) : viaPort ? port : -1;
    if (into < 0) {
        if (ordered) finishErrand(ships, i);
        else stopForaging(ships, i);
        return;
    }
    const below = scavenges ? approach.scavengeFuelBelow : approach.refuelBelow;
    const ownHeld = ships.fuel.pieceHeld(b, into);
    const wantsFuel = scavenges ? scavengeOrder || approach.scavengeFuelBelow > 0 : docks;
    const room = wantsFuel ? ships.fuel.pieceRoom(b, into) : 0;
    const full = ownHeld + room;
    const metalRoom = rearms || strips || (ordered && viaPort) ? ships.metal.pieceRoom(b, into) : 0;
    const chargeRoom = (lands || (ordered && viaPort)) && recharges ? ships.power.pieceRoom(b, into) : 0;
    const charge = chargeRoom > 0 ? ships.power.pieceHeld(b, into) : 0;
    const thirsty = full > 0 && room > 0 && ownHeld <= below * full;
    const empty = rearms && metalRoom > 0 && outOfRounds(ships, i, b, into, approach.rearmBelow);
    const metalHeld = strips ? ships.metal.pieceHeld(b, into) : 0;
    const hungry = strips && metalRoom > 0 && metalHeld <= approach.scavengeMetalBelow * (metalHeld + metalRoom);
    // Only running flat sends it for charge, so it never lands for a sliver of it.
    const flat = chargeRoom > 0 && charge <= approach.rechargeBelow * (charge + chargeRoom);
    const recharging = chargeRoom > 0 && (ordered || flat || ships.recharging[i] === 1);
    // Mending only makes it more whole, so nothing need hold it to the trip.
    const hurt =
        repairs && (ordered ? wholeness(ships, b, i) < 1 : wholeness(ships, b, i) <= approach.repairBelow || disarmed(ships, i, b));
    const going = ordered
        ? room > 0 || metalRoom > 0 || recharging || hurt
        : scavengeOrder
          ? room > 0 || metalRoom > 0
          : thirsty ||
            empty ||
            hungry ||
            (anchors && scavenges) ||
            recharging ||
            hurt ||
            (ships.refuelling[i] === 1 && room > 0) ||
            (ships.rearming[i] === 1 && metalRoom > 0);
    ships.refuelling[i] = going && room > 0 ? 1 : 0;
    ships.docking[i] = going && viaPort && (room > 0 || ordered) ? 1 : 0;
    ships.rearming[i] = going && metalRoom > 0 ? 1 : 0;
    ships.recharging[i] = recharging ? 1 : 0;
    if (!going && errand !== undefined) {
        // Nothing it could take on: done, or done before it set out.
        finishErrand(ships, i);
        return;
    }
    if (!going) {
        // Full, or wanting nothing: what it can spare goes to a friend.
        if (deliverable) deliver(ships, world, bodies, i, b, giverPort);
        else stopForaging(ships, i);
        return;
    }
    if (held !== NO_TARGET) {
        // Gone, dry, taken, or no longer what it is after: look again now rather
        // than at the next rethink.
        const lost = lands
            ? hb < 0 || ships.landingPad[i]! < 0 || !shipDocking.padFree(ships, bodies, held, ships.landingPad[i]!)
            : viaPort
              ? hb < 0 ||
                ships.dockPort[i]! < 0 ||
                ships.ownPort[i] !== port ||
                !shipDocking.portFree(ships, bodies, held, ships.dockPort[i]!)
              : hb < 0 ||
                ships.landingPad[i]! >= 0 ||
                ships.dockPort[i]! >= 0 ||
                ships.shipByBody[hb] !== held ||
                !(
                    (room > 0 && fuelOffered(ships, i, held, hb)) ||
                    (metalRoom > 0 && strippableWreck(ships, held)) ||
                    (anchors && ships.isAsteroid(held))
                );
        if (lost && scavengeOrder && only !== NO_TARGET) {
            // Gone, or with nothing more to give: what it was sent to is done with.
            finishErrand(ships, i);
            return;
        }
        if (lost) {
            ships.salvaging[i] = NO_TARGET;
            ships.landingPad[i] = -1;
            ships.dockPort[i] = -1;
            ships.ownPort[i] = -1;
            ships.forageAt[i] = world.tick;
        }
    }
    if (world.tick < ships.forageAt[i]!) return;
    ships.forageAt[i] = world.tick + ships.rethinkTicks(world, design.mass);
    if (lands) {
        shipDocking.pickPad(ships, bodies, i, b, room, metalRoom, recharging ? chargeRoom : 0, hurt, only);
    } else if (viaPort) {
        shipDocking.pickPort(ships, bodies, i, b, port, room, ordered ? metalRoom : 0, ordered ? chargeRoom : 0, only);
    } else if (only !== NO_TARGET) {
        if (!clawCanTake(ships, bodies, i, b, claw, only)) {
            finishErrand(ships, i);
            return;
        }
        ships.salvaging[i] = only;
        ships.landingPad[i] = -1;
        ships.dockPort[i] = -1;
    } else {
        ships.salvaging[i] = pickSource(ships, bodies, i, b, claw, room, strips ? metalRoom : 0, anchors);
        ships.landingPad[i] = -1;
        ships.dockPort[i] = -1;
        if (scavengeOrder && ships.salvaging[i] === NO_TARGET) {
            // Nothing left anywhere worth the trip.
            finishErrand(ships, i);
            return;
        }
        // Nothing left to scavenge: what it has goes to a friend instead.
        if (ships.salvaging[i] === NO_TARGET && deliverable) deliver(ships, world, bodies, i, b, giverPort);
    }
}

/**
 * Whether the ship working port `port` of body `b` holds enough to deliver:
 * more than `above` of a full load on that port's piece of hull, and more
 * than it keeps back for itself.
 */
/** Whether the ship working port `port` of body `b` holds fuel or metal above what it keeps back for itself. */
export function hasToSpare(ships: Ships, b: number, port: number): boolean {
    return (
        ships.fuel.pieceHeld(b, port) > shipSupply.fuelReserve(ships, b, port) ||
        ships.metal.pieceHeld(b, port) > shipSupply.metalReserve(ships, b, port)
    );
}

/**
 * Whether ship `i`'s claw on body `b` could ever take anything from ship
 * `t`: what doctrine would drink from, or a friend still flying, which it
 * may when it is sent to.
 */
export function clawCanTake(ships: Ships, bodies: Bodies, i: number, b: number, claw: number, t: number): boolean {
    if (t === i || ships.alive[t] !== 1 || (ships.team[t] === NEUTRAL_TEAM && !ships.isAsteroid(t))) return false;
    const tb = bodies.indexOf(ships.bodyIds[t]!);
    if (tb < 0 || tb === b || !shipClaw.clawReaches(ships, b, claw, tb)) return false;
    return drinkable(ships, i, t) || ships.team[t] === ships.team[i];
}

/** Whether ship `t` on body `tb` has fuel for ship `i`'s claw: any at all, or from a friend still flying, any above its reserve. */
export function fuelOffered(ships: Ships, i: number, t: number, tb: number): boolean {
    if (drinkable(ships, i, t)) return ships.fuel.left(tb) > 0;
    const modules = ships.designs[t]!.modules;
    for (let m = 0; m < modules.length; m++) {
        if (ships.ownsAt(t, tb, m) && ships.fuel.pieceHeld(tb, m) > shipSupply.fuelReserve(ships, tb, m)) return true;
    }
    return false;
}

/** Whether ship `i` was sent to scavenge from `t`, a friend still flying, which doctrine never drinks from. */
export function sentToDrink(ships: Ships, i: number, t: number): boolean {
    const given = ships.getCurrentOrder(i);
    return given?.errand === "scavenge" && given.target === t;
}

export function canDeliver(ships: Ships, b: number, port: number, above: number): boolean {
    const held = ships.fuel.pieceHeld(b, port);
    const full = held + ships.fuel.pieceRoom(b, port);
    return full > 0 && held > above * full && held > shipSupply.fuelReserve(ships, b, port);
}

/**
 * What the ship working module `m` of body `b` keeps back from a friend
 * docked with it, kg: its `refuelBelow` of a full load, or, taking fuel to
 * a friend, its `deliverFuelAbove`, so it gives only what it holds above
 * that and is never left at its own threshold for refuelling.
 */
export function keepsBack(ships: Ships, b: number, m: number): number {
    const owner = ships.pilotAt(b, m);
    const kept = shipSupply.fuelReserve(ships, b, m);
    if (owner < 0 || ships.delivering[owner] !== 1 || ships.errandOf(owner) === "deliver") return kept;
    const above = ships.doctrines[owner]!.approach.deliverFuelAbove;
    return max(kept, above * (ships.fuel.pieceHeld(b, m) + ships.fuel.pieceRoom(b, m)));
}

/**
 * Take fuel to a friend: keep to the friend's port it is making for until it
 * is gone, taken or full, or it is time to look again, then pick afresh.
 */
export function deliver(ships: Ships, world: World, bodies: Bodies, i: number, b: number, port: number, only = NO_TARGET): void {
    ships.refuelling[i] = 0;
    ships.docking[i] = 0;
    ships.rearming[i] = 0;
    ships.recharging[i] = 0;
    ships.landingPad[i] = -1;
    const held = ships.salvaging[i]!;
    const hb = held !== NO_TARGET && ships.alive[held] === 1 ? bodies.indexOf(ships.bodyIds[held]!) : -1;
    const keep =
        ships.delivering[i] === 1 &&
        hb >= 0 &&
        ships.dockPort[i]! >= 0 &&
        ships.ownPort[i] === port &&
        shipDocking.portFree(ships, bodies, held, ships.dockPort[i]!) &&
        (ships.fuel.pieceRoom(hb, ships.dockPort[i]!) > 0 ||
            (ships.errandOf(i) === "deliver" && ships.metal.pieceRoom(hb, ships.dockPort[i]!) > 0));
    if (keep && world.tick < ships.forageAt[i]!) return;
    ships.forageAt[i] = world.tick + ships.rethinkTicks(world, ships.designs[i]!.mass);
    pickDelivery(ships, bodies, i, b, port, only);
    ships.delivering[i] = ships.salvaging[i] !== NO_TARGET ? 1 : 0;
}

/**
 * The best friend's port to take fuel to, as a port to be filled at is
 * chosen: the fuel it can give and the friend has room for, for the time to
 * get there and pump it through the slower of the two ports, put off by armed
 * enemies near it and by every other ship already making for it.
 */
export function pickDelivery(ships: Ships, bodies: Bodies, i: number, b: number, own: number, only = NO_TARGET): void {
    const design = ships.designs[i]!;
    const approach = ships.doctrines[i]!.approach;
    ships.salvaging[i] = NO_TARGET;
    ships.dockPort[i] = -1;
    ships.ownPort[i] = -1;
    if (!(approach.approachSpeed > 0)) return;
    // Ordered, it gives all it can spare, metal too, whatever `deliverFuelAbove` says.
    const ordered = ships.errandOf(i) === "deliver";
    const held = ships.fuel.pieceHeld(b, own);
    const above = ordered ? 0 : approach.deliverFuelAbove * (held + ships.fuel.pieceRoom(b, own));
    const spare = held - max(shipSupply.fuelReserve(ships, b, own), above);
    const spareMetal = ordered ? ships.metal.pieceHeld(b, own) - shipSupply.metalReserve(ships, b, own) : 0;
    if (!(spare > 0) && !(spareMetal > 0)) return;
    const ownPump = design.modules[own]!.stats.pumpRate;
    const lift = shipFlight.pushAbility(ships, bodies, i, b);
    let bestScore = 0;
    for (let t = 0; t < ships.alive.length; t++) {
        if (t === i || ships.alive[t] === 0 || ships.derelict[t] === 1 || ships.delivering[t] === 1) continue;
        if (only !== NO_TARGET && t !== only) continue;
        if (ships.team[t] !== ships.team[i] || ships.hostile(i, t) || !ships.hasControl(t)) continue;
        const tb = bodies.indexOf(ships.bodyIds[t]!);
        if (tb < 0 || tb === b) continue;
        if (!shipDecide.within(ships, bodies, lift, t, bodies.x[tb]!, bodies.y[tb]!, bodies.x[b]!, bodies.y[b]!, bodies.radius[tb]!))
            continue;
        const host = ships.designs[t]!;
        // Sent to it, it goes whatever is near.
        let danger = only !== NO_TARGET ? 0 : -1;
        for (let p = 0; p < host.modules.length; p++) {
            if (host.modules[p]!.spec.kind !== "port" || !ships.ownsAt(t, tb, p) || !shipDocking.portFree(ships, bodies, t, p)) continue;
            const room = ships.fuel.pieceRoom(tb, p);
            const metalRoom = spareMetal > 0 ? ships.metal.pieceRoom(tb, p) : 0;
            const pump = min(ownPump, host.modules[p]!.stats.pumpRate);
            if (!((room > 0 && spare > 0) || metalRoom > 0) || !(pump > 0)) continue;
            const take = max(0, spare < room ? spare : room) + (spareMetal < metalRoom ? spareMetal : metalRoom);
            const gap = length(bodies.x[tb]! - bodies.x[b]!, bodies.y[tb]! - bodies.y[b]!);
            if (danger < 0) danger = approach.dockDanger > 0 ? dangerNear(ships, bodies, i, tb) : 0;
            let queue = 0;
            for (let o = 0; o < ships.alive.length; o++) {
                if (o !== i && ships.alive[o] === 1 && ships.salvaging[o] === t && ships.dockPort[o] === p) queue++;
            }
            const score = take / (gap / approach.approachSpeed + take / pump) / (1 + max(0, approach.dockDanger) * danger) / (1 + queue);
            if (score > bestScore) {
                bestScore = score;
                ships.salvaging[i] = t;
                ships.dockPort[i] = p;
                ships.ownPort[i] = own;
            }
        }
    }
}

/** Done with the errand at the head of its queue: on to the next order, or back to doctrine. */
export function finishErrand(ships: Ships, i: number): void {
    stopForaging(ships, i);
    ships.orders[i]!.shift();
    shipOrders.nextOrder(ships, i);
}

export function stopForaging(ships: Ships, i: number): void {
    ships.salvaging[i] = NO_TARGET;
    ships.landingPad[i] = -1;
    ships.dockPort[i] = -1;
    ships.ownPort[i] = -1;
    ships.refuelling[i] = 0;
    ships.docking[i] = 0;
    ships.delivering[i] = 0;
    ships.rearming[i] = 0;
    ships.recharging[i] = 0;
}

/**
 * Whether ship `i` is down to its doctrine's `below` of a full load of metal
 * on the piece of hull module `own` is on: at zero, too little for any of its
 * guns there to load a round. False for a ship with no gun there to feed.
 */
export function outOfRounds(ships: Ships, i: number, b: number, own: number, below: number): boolean {
    const design = ships.designs[i]!;
    let round = Infinity;
    for (const mount of design.turrets) {
        const kg = mount.gun.casing;
        if (kg > 0 && kg < round && ships.metal.pieceAt(b, mount.module) === ships.metal.pieceAt(b, own)) round = kg;
    }
    if (round === Infinity) return false;
    const held = ships.metal.pieceHeld(b, own);
    return held < round || held <= below * (held + ships.metal.pieceRoom(b, own));
}

/** How many armed enemies of ship `i` are within their own reach of body `tb`. */
export function dangerNear(ships: Ships, bodies: Bodies, i: number, tb: number): number {
    let danger = 0;
    for (let e = 0; e < ships.alive.length; e++) {
        if (ships.alive[e] === 0 || ships.derelict[e] === 1 || !ships.hostile(i, e) || ships.isDisarmed(e)) continue;
        const eb = bodies.indexOf(ships.bodyIds[e]!);
        if (eb < 0 || eb === tb) continue;
        const reach = ships.designs[e]!.reach + bodies.radius[tb]!;
        if (length(bodies.x[eb]! - bodies.x[tb]!, bodies.y[eb]! - bodies.y[tb]!) <= reach) danger++;
    }
    return danger;
}

/** Whether so few of fighter `i`'s main guns work that its doctrine's `repairArmed` sends it to be mended. */
export function disarmed(ships: Ships, i: number, b: number): boolean {
    const repairArmed = ships.doctrines[i]!.approach.repairArmed;
    if (repairArmed < 0) return false;
    const share = shipDecide.armedShare(ships, i, b, false);
    return ships.tools > 0 && share <= repairArmed;
}

/**
 * How whole ship `i` on body `b` is, as `repairBelow` measures it: the lower
 * of its weakest core's integrity and the share of the mass it set out with
 * still sound, a module lost counting for none.
 */
export function wholeness(ships: Ships, b: number, i: number): number {
    const design = ships.designs[i]!;
    let weakest = 1;
    let sound = 0;
    for (let m = 0; m < design.modules.length; m++) {
        if (!ships.ownsAt(i, b, m)) continue;
        const integrity = ships.damage.integrity(b, m);
        sound += integrity * design.modules[m]!.stats.mass;
        if (design.modules[m]!.spec.kind === "core" && integrity < weakest) weakest = integrity;
    }
    let full = 0;
    for (const module of (ships.launched[i] ?? design).modules) full += module.stats.mass;
    return full > 0 ? min(weakest, sound / full) : weakest;
}

/**
 * Moor ship `f` by claw `claw` of its hull to asteroid `rock`, gripping at
 * world point `gx`, `gy`: parked as a fighter is on a pad, but on the rock,
 * keeping its own body and design. The two move off together with the
 * momentum they had between them; a rock nothing moves takes none of it.
 */
export function moor(ships: Ships, bodies: Bodies, f: number, rock: number, claw: number, gx: number, gy: number): void {
    const cb = bodies.indexOf(ships.bodyIds[rock]!);
    const fb = bodies.indexOf(ships.bodyIds[f]!);
    if (cb < 0 || fb < 0 || !poseMoored(ships, bodies, f, cb, fb, gx, gy)) return;
    const mc = bodies.mass[cb]!;
    const mf = bodies.mass[fb]!;
    const vx = (mc * bodies.vx[cb]! + mf * bodies.vx[fb]!) / (mc + mf);
    const vy = (mc * bodies.vy[cb]! + mf * bodies.vy[fb]!) / (mc + mf);
    const rx = bodies.x[fb]! - bodies.x[cb]!;
    const ry = bodies.y[fb]! - bodies.y[cb]!;
    const spin =
        bodies.inertia[cb]! * bodies.angularVel[cb]! +
        bodies.inertia[fb]! * bodies.angularVel[fb]! +
        mf * (rx * (bodies.vy[fb]! - vy) - ry * (bodies.vx[fb]! - vx));
    const moves = mc > 0;
    if (moves) {
        bodies.vx[cb] = vx;
        bodies.vy[cb] = vy;
    }
    ships.parkedOn[f] = rock;
    ships.parkedPad[f] = -1;
    ships.mooredClaw[f] = claw;
    ships.parkedShips.push(f);
    shipBreakup.settleMass(ships, bodies, cb);
    if (moves) bodies.angularVel[cb] = spin / bodies.inertia[cb]!;
    pinMoored(ships, bodies, f);
}

/**
 * Where moored ship `f`, on body `fb`, sits on its rock, body `cb`, and
 * where its claw grips, world point `gx`, `gy`, kept in the rock's
 * blueprint frame. False for a body with no hull.
 */
export function poseMoored(ships: Ships, bodies: Bodies, f: number, cb: number, fb: number, gx: number, gy: number): boolean {
    const rd = ships.hullDesign[cb];
    const fd = ships.hullDesign[fb];
    if (rd === null || rd === undefined || fd === null || fd === undefined) return false;
    const angle = bodies.angle[cb]!;
    const c = cos(angle);
    const s = sin(angle);
    // Both blueprint origins, which stay put on their hulls as rock is mined away.
    const rox = bodies.x[cb]! - (rd.centreOfMassX * c - rd.centreOfMassY * s);
    const roy = bodies.y[cb]! - (rd.centreOfMassX * s + rd.centreOfMassY * c);
    const fc = cos(bodies.angle[fb]!);
    const fs = sin(bodies.angle[fb]!);
    const dx = bodies.x[fb]! - (fd.centreOfMassX * fc - fd.centreOfMassY * fs) - rox;
    const dy = bodies.y[fb]! - (fd.centreOfMassX * fs + fd.centreOfMassY * fc) - roy;
    ships.parkedX[f] = dx * c + dy * s;
    ships.parkedY[f] = -dx * s + dy * c;
    ships.parkedAngle[f] = bodies.angle[fb]! - angle;
    ships.mooredGripX[f] = (gx - rox) * c + (gy - roy) * s;
    ships.mooredGripY[f] = -(gx - rox) * s + (gy - roy) * c;
    return true;
}

/** Where each ship moored to asteroid `i` or `j` grips, in the world, before the two become one. */
export function holdMoorings(ships: Ships, bodies: Bodies, i: number, j: number): void {
    ships.rebasing.length = 0;
    ships.rebasingStranded.length = 0;
    for (let k = 0; k < ships.stranded.length; k++) {
        const robot = ships.stranded[k]!.robot;
        if (robot.away !== i && robot.away !== j) continue;
        const cb = bodies.indexOf(ships.bodyIds[robot.away]!);
        const here = robot.awayDesign?.modules[robot.at];
        if (cb < 0 || here === undefined) continue;
        const c = cos(bodies.angle[cb]!);
        const s = sin(bodies.angle[cb]!);
        ships.rebasingStranded.push(k, bodies.x[cb]! + here.x * c - here.y * s, bodies.y[cb]! + here.x * s + here.y * c);
    }
    for (let k = 0; k < ships.parkedShips.length; k++) {
        const f = ships.parkedShips[k]!;
        if (ships.mooredClaw[f]! < 0 || (ships.parkedOn[f] !== i && ships.parkedOn[f] !== j)) continue;
        const cb = ships.carrierBodyOf(bodies, f);
        const rd = cb < 0 ? null : ships.hullDesign[cb];
        if (rd === null || rd === undefined) continue;
        const c = cos(bodies.angle[cb]!);
        const s = sin(bodies.angle[cb]!);
        const lx = ships.mooredGripX[f]! - rd.centreOfMassX;
        const ly = ships.mooredGripY[f]! - rd.centreOfMassY;
        ships.rebasing.push(f, bodies.x[cb]! + lx * c - ly * s, bodies.y[cb]! + lx * s + ly * c);
    }
}

/**
 * Pose again, on the rock two have just made, each ship `holdMoorings`
 * noted, and step its robots out on the rock back to where its claw grips.
 */
export function rebaseMoorings(ships: Ships, bodies: Bodies): void {
    for (let k = 0; k < ships.rebasing.length; k += 3) {
        const f = ships.rebasing[k]!;
        const fb = bodies.indexOf(ships.bodyIds[f]!);
        const cb = ships.carrierBodyOf(bodies, f);
        if (fb < 0 || cb < 0) continue;
        poseMoored(ships, bodies, f, cb, fb, ships.rebasing[k + 1]!, ships.rebasing[k + 2]!);
        const held = heldRock(ships, bodies, f);
        for (const robot of ships.robots.on(fb) ?? []) {
            if (robot.away < 0) continue;
            robot.away = ships.parkedOn[f]!;
            robot.awayDesign = ships.hullDesign[cb]!;
            robot.at = held < 0 ? 0 : held;
            robot.path = null;
            robot.leg = 0;
            robot.along = 0;
            if (robot.mode !== RobotMode.Home) {
                robot.mode = RobotMode.Out;
                robot.target = -1;
            }
        }
    }
    ships.rebasing.length = 0;
    // A stranded robot stands where it stood, on the nearest of the rock they make.
    for (let k = 0; k < ships.rebasingStranded.length; k += 3) {
        const robot = ships.stranded[ships.rebasingStranded[k]!]!.robot;
        const cb = bodies.indexOf(ships.bodyIds[robot.away]!);
        const rd = cb < 0 ? null : ships.hullDesign[cb];
        if (rd === null || rd === undefined) continue;
        const dx = ships.rebasingStranded[k + 1]! - bodies.x[cb]!;
        const dy = ships.rebasingStranded[k + 2]! - bodies.y[cb]!;
        const c = cos(bodies.angle[cb]!);
        const s = sin(bodies.angle[cb]!);
        robot.at = shipRobots.nearestModule(rd, dx * c + dy * s, -dx * s + dy * c);
        robot.awayDesign = rd;
    }
    ships.rebasingStranded.length = 0;
}

/** Put moored ship `f` where it sits on its rock, moving with it. */
export function pinMoored(ships: Ships, bodies: Bodies, f: number): void {
    const fb = bodies.indexOf(ships.bodyIds[f]!);
    const cb = ships.carrierBodyOf(bodies, f);
    const rd = cb < 0 ? null : ships.hullDesign[cb];
    const fd = fb < 0 ? null : ships.hullDesign[fb];
    if (rd === null || rd === undefined || fd === null || fd === undefined) return;
    const angle = bodies.angle[cb]!;
    const c = cos(angle);
    const s = sin(angle);
    const heading = angle + ships.parkedAngle[f]!;
    const fc = cos(heading);
    const fs = sin(heading);
    const lx = ships.parkedX[f]! - rd.centreOfMassX;
    const ly = ships.parkedY[f]! - rd.centreOfMassY;
    const rx = lx * c - ly * s + fd.centreOfMassX * fc - fd.centreOfMassY * fs;
    const ry = lx * s + ly * c + fd.centreOfMassX * fs + fd.centreOfMassY * fc;
    const spin = bodies.angularVel[cb]!;
    bodies.x[fb] = bodies.x[cb]! + rx;
    bodies.y[fb] = bodies.y[cb]! + ry;
    bodies.angle[fb] = heading;
    bodies.vx[fb] = bodies.vx[cb]! - spin * ry;
    bodies.vy[fb] = bodies.vy[cb]! + spin * rx;
    bodies.angularVel[fb] = spin;
    if (bodies.mass[fb] !== ships.parkedMass[f]) shipBreakup.settleMass(ships, bodies, cb);
}

/** Whether ship `i` is moored to an asteroid by its claw. */
export function isMoored(ships: Ships, i: number): boolean {
    return ships.mooredClaw[i]! >= 0;
}

/**
 * The module of its rock that moored ship `f`'s claw grips: the nearest to
 * where it took hold, within reach of it, or -1 once that is mined away.
 */
export function heldRock(ships: Ships, bodies: Bodies, f: number): number {
    const cb = ships.carrierBodyOf(bodies, f);
    const rd = cb < 0 ? null : ships.hullDesign[cb];
    if (rd === null || rd === undefined) return -1;
    const gx = ships.mooredGripX[f]! - rd.centreOfMassX;
    const gy = ships.mooredGripY[f]! - rd.centreOfMassY;
    let best = -1;
    let bestGap = Infinity;
    for (let m = 0; m < rd.modules.length; m++) {
        const module = rd.modules[m]!;
        const reach = max(module.spec.length, module.spec.width);
        const gap = length(module.x - gx, module.y - gy);
        if (gap <= reach && gap < bestGap) {
            best = m;
            bestGap = gap;
        }
    }
    return best;
}

/**
 * Work the rock moored ship `f` holds, and say whether it keeps hold: its
 * robots taking it apart while its holds have room, or its claw melting
 * the ice out. It lets go once neither can, or it is given an order, when
 * its robots are back; and at once if its claw can no longer grip, what it
 * held is gone, or an armed enemy is in reach, unless it is anchored to build.
 */
export function tendMoored(ships: Ships, world: World, f: number): boolean {
    const bodies = world.bodies;
    const fb = bodies.indexOf(ships.bodyIds[f]!);
    const cb = ships.carrierBodyOf(bodies, f);
    const claw = ships.mooredClaw[f]!;
    if (fb < 0 || cb < 0 || ships.alive[f] === 0 || ships.derelict[f] === 1 || !ships.hasControl(f)) return false;
    const working = ships.damage.remaining(fb, claw, DamageEffect.Grip);
    if (!(working > 0)) return false;
    const held = heldRock(ships, bodies, f);
    if (held < 0) return false;
    if (ships.damage.isProtected(cb)) return true;
    if (!ships.sentTo(f) && !shipBuild.wantsAnchor(ships, bodies, f) && shipSupply.threatened(ships, bodies, f, cb, false)) return false;
    // Given an order, it calls its robots in and goes as soon as they are back.
    const ordered = ships.sentAway(f);
    if (!ordered && shipRebuild.canStrip(ships, fb, f, claw, world.dt) && strippableAcross(ships, f, fb, claw, cb)) return true;
    if (!ordered && heatAcross(ships, bodies, fb, claw, cb, held, working * world.dt)) return true;
    // Anchored while it builds, it holds on until what it builds is let go.
    if (!ordered && shipBuild.wantsAnchor(ships, bodies, f)) return true;
    // Done, but for its robots out on the rock, which it waits for.
    if (!shipRobots.anyAway(ships, fb, f)) return false;
    shipRobots.recallAway(ships, fb, ships.hullDesign[fb]!, f, cb);
    return true;
}

/**
 * Whether moored ship `f`'s robots could take anything of its rock, body
 * `cb`, apart for what the holds on its claw's piece of hull, at `into` of
 * body `fb`, have room for.
 */
export function strippableAcross(ships: Ships, f: number, fb: number, into: number, cb: number): boolean {
    const metalRoom = ships.metal.pieceRoom(fb, into) > ROBOT_SPENT;
    const fuelRoom = ships.fuel.pieceRoom(fb, into) > ROBOT_SPENT;
    if (!metalRoom && !fuelRoom) return false;
    const rd = ships.hullDesign[cb];
    if (rd === null || rd === undefined) return false;
    const held = heldRock(ships, ships.bodyStore!, f);
    for (let m = 0; m < rd.modules.length; m++) {
        if (
            m !== held &&
            shipRobots.onRock(ships, cb, m, f) &&
            shipRebuild.minable(rd, m, metalRoom, fuelRoom) &&
            shipRebuild.comesOff(ships, f, cb, rd, m)
        )
            return true;
    }
    return false;
}

/**
 * The claw at `claw` of body `fb` melting fuel out of the rock at `held` of
 * the rock it is moored to, body `cb`, as `heat` does one it has welded to.
 */
export function heatAcross(ships: Ships, bodies: Bodies, fb: number, claw: number, cb: number, held: number, dt: number): boolean {
    const rd = ships.hullDesign[cb]!;
    const spec = rd.modules[held]!.spec;
    if (spec.kind !== "rock") return false;
    const ice = (spec.ice ?? 0) * (1 - DISASSEMBLY_WASTE);
    if (!(ice > 0) || !(dt > 0)) return false;
    const left = rd.modules[held]!.stats.mass - ships.damage.unbuiltAt(cb, held);
    let fuel = min(CLAW_HEAT_RATE * dt, ships.fuel.pieceRoom(fb, claw), left * ice);
    fuel = min(fuel, ships.power.pieceHeld(fb, claw) / CLAW_HEAT_ENERGY);
    if (!(fuel > ROBOT_SPENT)) return false;
    ships.power.drain(fb, claw, fuel * CLAW_HEAT_ENERGY);
    ships.damage.unfit(cb, held, fuel / ice);
    ships.fuel.add(fb, claw, fuel);
    shipBreakup.settleMass(ships, bodies, cb);
    shipBreakup.settleMass(ships, bodies, fb);
    return true;
}

/**
 * Whether the blow `k` of this step's knocks a moored ship off its rock:
 * one landing on it harder than its claw holds, the shock spent with
 * distance as it is through a weld, the rest of it then the ship's own.
 */
export function shakeLoose(ships: Ships, world: World, k: number): boolean {
    const bodies = world.bodies;
    const fb = ships.blowBody[k]!;
    const f = ships.shipByBody[fb];
    if (f === undefined || f < 0 || ships.mooredClaw[f]! < 0) return false;
    const cb = ships.carrierBodyOf(bodies, f);
    const held = heldRock(ships, bodies, f);
    const fd = ships.hullDesign[fb];
    const rd = cb < 0 ? null : ships.hullDesign[cb];
    if (held < 0 || fd === null || fd === undefined || rd === null || rd === undefined) return false;
    const claw = ships.mooredClaw[f]!;
    const thickness = min(seamThickness(fd, claw), seamThickness(rd, held));
    const grip = ships.damage.remaining(fb, claw, DamageEffect.Grip);
    const width = fd.modules[claw]!.spec.width;
    const factor = weldFactor(
        seamShare(fd.modules[claw]!.spec, rd.modules[held]!.spec, width),
        fd.modules[claw]!.stats.thickness,
        rd.modules[held]!.stats.thickness,
    );
    const strength = width * thickness * JOINT_IMPULSE_PER_AREA * DOCK_HOLD * grip * factor;
    const jx = ships.blowJx[k]!;
    const jy = ships.blowJy[k]!;
    const place = shipDocking.modulePlace(bodies, fb, fd, claw);
    const carried = SHOCK_REACH / (SHOCK_REACH + length(ships.blowX[k]! - place.x, ships.blowY[k]! - place.y));
    const load = length(jx, jy) * carried;
    if (!(load > strength)) return false;
    shipDocking.unpark(ships, bodies, f, world.tick);
    // What the rock took of the blow beyond the grip, the ship takes now it is free.
    const share = 1 - strength / load;
    bodies.vx[fb] = bodies.vx[fb]! + jx * share * bodies.invMass[fb]!;
    bodies.vy[fb] = bodies.vy[fb]! + jy * share * bodies.invMass[fb]!;
    bodies.vx[cb] = bodies.vx[cb]! - jx * share * bodies.invMass[cb]!;
    bodies.vy[cb] = bodies.vy[cb]! - jy * share * bodies.invMass[cb]!;
    return true;
}

/** What an asteroid's rock still holds, kg: all of it, and the ore and ice in it less what mining wastes. */
export function rockHeld(ships: Ships, b: number, design: ShipDesign): { rock: number; ore: number; ice: number } {
    let rock = 0;
    let ore = 0;
    let ice = 0;
    for (let m = 0; m < design.modules.length; m++) {
        const { spec, stats } = design.modules[m]!;
        if (spec.kind !== "rock") continue;
        const left = max(0, stats.mass - ships.damage.unbuiltAt(b, m));
        rock += left;
        ore += left * (spec.ore ?? 0) * (1 - DISASSEMBLY_WASTE);
        ice += left * (spec.ice ?? 0) * (1 - DISASSEMBLY_WASTE);
    }
    return { rock, ore, ice };
}

/**
 * Seconds mining `take` of fuel and `strip` of metal out of an asteroid
 * takes: its robots cutting rock until they have both, or with none, a claw
 * melting the fuel alone.
 */
export function miningTime(held: { rock: number; ore: number; ice: number }, take: number, strip: number, stripRate: number): number {
    if (!(stripRate > 0)) return take / CLAW_HEAT_RATE;
    const forOre = held.ore > 0 ? (strip / held.ore) * held.rock : 0;
    const forIce = held.ice > 0 ? (take / held.ice) * held.rock : 0;
    return max(forOre, forIce) / stripRate;
}

/**
 * The source a claw ship goes for: what pays most for the time it takes.
 * Wanting an anchor (`wantsAnchor`), an asteroid with nothing it could take
 * still serves, the nearest first.
 */
export function pickSource(
    ships: Ships,
    bodies: Bodies,
    i: number,
    b: number,
    claw: number,
    room: number,
    metalRoom: number,
    anchors = false,
): number {
    const design = ships.designs[i]!;
    const approach = ships.doctrines[i]!.approach;
    const pump = design.modules[claw]!.stats.pumpRate;
    if (!(pump > 0) || !(approach.clawSpeed > 0)) return NO_TARGET;
    const mass = bodies.mass[b]!;
    const layout = ships.layoutOf(i);
    const bearing = pushBearing(layout, design.thrustBearing);
    const mains = layout.maxThrustAlong(cos(bearing), sin(bearing)) / mass;
    const exhaust = exhaustOf(design);
    // Its weaker way across its jaws, for following a spinning source.
    const jaws = design.modules[claw]!.spec.angle ?? 0;
    const across = min(layout.maxThrustAlong(-sin(jaws), cos(jaws)), layout.maxThrustAlong(sin(jaws), -cos(jaws))) / mass;
    let robots = 0;
    if (metalRoom > 0) for (const robot of ships.robots.on(b) ?? []) if (ships.pilotAt(b, robot.bay) === i) robots++;
    const stripRate = (robots * ROBOT_REPAIR_RATE) / DAMAGE_ENERGY_PER_KG;
    const lift = shipFlight.pushAbility(ships, bodies, i, b);
    let best = NO_TARGET;
    let bestScore = 0;
    for (let t = 0; t < ships.alive.length; t++) {
        if (t === i || ships.alive[t] === 0) continue;
        // What a claw will close on, and of the enemies only those that cannot shoot back.
        if (!drinkable(ships, i, t) || (ships.hasControl(t) && !ships.isDisarmed(t))) continue;
        const tb = bodies.indexOf(ships.bodyIds[t]!);
        // A body is offered once, by the ship it is, and only if the claw can touch it.
        if (tb < 0 || tb === b || ships.shipByBody[tb] !== t || !shipClaw.clawReaches(ships, b, claw, tb)) continue;
        // An asteroid is worth what its rock holds: ore its robots smelt, and ice
        // they melt, or the claw alone does, slower.
        const asteroid = ships.isAsteroid(t);
        if (asteroid && !(approach.rockWeight > 0)) continue;
        // One that pulls cannot be closed on slowly jaws first without thrust to hold off its pull.
        if (asteroid && !(shipClaw.holdsOff(ships, bodies, i, b, claw, tb) > 1)) continue;
        // Nor one an enemy has hold of: it would be closing on the enemy as much as on the rock.
        if (asteroid && enemyMoored(ships, i, t)) continue;
        // Nor anything down a well it could not climb back out of.
        if (!shipDecide.within(ships, bodies, lift, t, bodies.x[tb]!, bodies.y[tb]!, bodies.x[b]!, bodies.y[b]!, bodies.radius[tb]!))
            continue;
        // Nor one spinning too fast to be carried round with at its gate.
        const spin = bodies.angularVel[tb]!;
        if (spin * spin * (bodies.radius[tb]! + bodies.radius[b]!) > SPIN_HOLD * across) continue;
        const held = asteroid ? rockHeld(ships, tb, ships.designs[t]!) : null;
        const fuel = held !== null ? held.ice : ships.fuel.left(tb);
        const take = fuel < room ? fuel : room;
        // What its robots would bring home of it, less what taking it apart wastes.
        const metal =
            held !== null
                ? robots > 0
                    ? held.ore
                    : 0
                : metalRoom > 0 && strippableWreck(ships, t)
                  ? (bodies.mass[tb]! - fuel) * (1 - DISASSEMBLY_WASTE)
                  : 0;
        const strip = metal < metalRoom ? metal : metalRoom;
        const anchor = anchors && asteroid;
        if (!(take > 0 || strip > 0 || anchor)) continue;
        const dx = bodies.x[tb]! - bodies.x[b]!;
        const dy = bodies.y[tb]! - bodies.y[b]!;
        const apart = length(dx, dy);
        // Getting there at its closing speed less however fast the source is
        // going away: one it cannot gain on is no source at all.
        const gap = max(0, apart - bodies.radius[tb]!);
        // Already alongside the one it is after, a miss that bounced it off is
        // a reposition, not a trip: neither how fast it is now drifting off nor
        // the speed to match counts against it.
        const alongside = t === ships.salvaging[i] && gap <= 2 * bodies.radius[b]!;
        const receding =
            alongside || !(apart > 0) ? 0 : ((bodies.vx[tb]! - bodies.vx[b]!) * dx + (bodies.vy[tb]! - bodies.vy[b]!) * dy) / apart;
        const closing = approach.clawSpeed - receding;
        if (!(closing > 0)) continue;
        // What the trip burns: matching the source's motion, then speeding up
        // and slowing down again, no faster than the gap gives room for. A
        // source has to pay more than that to be worth going for at all.
        const cruise = min(closing, sqrt(mains * gap));
        const dv = (alongside ? 0 : length(bodies.vx[tb]! - bodies.vx[b]!, bodies.vy[tb]! - bodies.vy[b]!)) + 2 * cruise;
        const cost = exhaust > 0 ? mass * (1 - exp(-dv / exhaust)) : 0;
        let gain = (take + strip * approach.fuelPerMetal) * (held !== null ? approach.rockWeight : 1) - cost;
        // An anchor is worth having however little it gives, so the soonest reached wins.
        if (anchor && !(gain > 0)) gain = 1;
        if (!(gain > 0)) continue;
        const time =
            (gap / closing) * approach.tripWeight +
            (held !== null ? miningTime(held, take, strip, stripRate) : take / pump + (strip > 0 ? strip / stripRate : 0));
        const danger = approach.scavengeDanger > 0 ? dangerNear(ships, bodies, i, tb) : 0;
        const score = gain / max(time, 1e-3) / (1 + max(0, approach.scavengeDanger) * danger);
        if (score > bestScore) {
            best = t;
            bestScore = score;
        }
    }
    return best;
}

/** Whether a ship hostile to ship `i` is moored to asteroid `t`. */
export function enemyMoored(ships: Ships, i: number, t: number): boolean {
    for (let k = 0; k < ships.parkedShips.length; k++) {
        const j = ships.parkedShips[k]!;
        if (ships.parkedOn[j] === t && ships.mooredClaw[j]! >= 0 && ships.hostile(i, j)) return true;
    }
    return false;
}

/** Whether ship `t` is wreckage whole, as robots take it apart: nobody flies it, or nobody mends it. */
export function strippableWreck(ships: Ships, t: number): boolean {
    if (ships.derelict[t] === 1) return true;
    if (ships.hasControl(t)) return false;
    const bodies = ships.bodyStore;
    const tb = bodies === null ? -1 : bodies.indexOf(ships.bodyIds[t]!);
    return tb >= 0 && !shipRebuild.hasRobots(ships, tb, t);
}

/** Whether ship `i`'s claw will close on ship `t`: a wreck of either side, or an enemy. */
export function drinkable(ships: Ships, i: number, t: number): boolean {
    return ships.derelict[t] === 1 || ships.hostile(i, t) || !ships.hasControl(t);
}
