import { footprintOf } from "./blueprint.js";
import { holdBand } from "./doctrine.js";
import * as shipForage from "./shipForage.js";
import * as shipFlight from "./shipFlight.js";
import * as shipAim from "./shipAim.js";
import { type Ships, NO_TARGET, OrderCancelCondition, NEUTRAL_TEAM, type Order, type Errand } from "./ships.js";
import * as shipDecide from "./shipDecide.js";

/**
 * Each ship's queue of orders: what is pushed onto it, what the ship takes its
 * current order to be, and when an order is done or no longer makes sense.
 */

/**
 * The order whose band of ranges ship `i` is holding against what it is
 * fighting, or undefined: for nothing, or for an order that closes to touch
 * — a ram, a grip, a landing or a dock — rather than to a range.
 */
export function heldOrder(ships: Ships, i: number): Readonly<Order> | undefined {
    const standing = ships.standing[i];
    const order = getCurrentOrder(ships, i) ?? (standing !== undefined && standing.target === ships.chosenOf(i) ? standing : undefined);
    if (order === undefined || order.target === NO_TARGET) return undefined;
    if (
        order.ram ||
        order.grapple ||
        order.land ||
        order.dock ||
        order.defend === true ||
        order.errand !== undefined ||
        order.flee === true
    ) {
        return undefined;
    }
    if (!(order.maxRange > 0)) return undefined;
    return order;
}

/** Whether a ship flying `order` stays with a consort: not while it flees, rams, or closes on a pad, port or source. */
export function escorts(order: Readonly<Order> | undefined): boolean {
    return order === undefined || !(order.flee === true || order.ram || order.grapple || order.land || order.dock);
}

/** `escorts(effectiveOrder(ships, i))`, without writing the standing order, so the view can ask. */
export function escorting(ships: Ships, i: number): boolean {
    const given = getCurrentOrder(ships, i);
    if (given?.defend === true) return true;
    if (given !== undefined && given.errand === undefined) return escorts(given);
    const source = ships.salvaging[i]!;
    if (source !== NO_TARGET && ships.alive[source] === 1) return false;
    if (ships.withdrawing[i] === 1) return false;
    const target = ships.chosen[i]!;
    return target === NO_TARGET || ships.alive[target] !== 1 || !ships.hasControl(target) || ships.ramming[i] !== target;
}

/**
 * What this ship is actually doing: what it was told, or failing that what
 * its doctrine makes of the fight it picked.
 *
 * The doctrine order is built here rather than pushed onto the queue, so
 * that "has orders" goes on meaning "has been told something by somebody".
 */
export function effectiveOrder(ships: Ships, i: number): Order | undefined {
    const given = getCurrentOrder(ships, i);
    // Defending is covering, which the pilot flies as a consort rather than as a station.
    if (given?.defend === true) return undefined;
    // An errand is flown as doctrine's own trips to a dock are.
    if (given !== undefined && given.errand === undefined) {
        if (given.flee !== true) liveBand(ships, i, given);
        return given;
    }

    const design = ships.designs[i]!;
    const approach = ships.doctrines[i]!.approach;
    const standing = ships.standing[i]!;
    const source = ships.salvaging[i]!;
    if (source !== NO_TARGET && ships.alive[source] === 1) {
        standing.target = source;
        standing.minRange = 0;
        standing.maxRange = 0;
        standing.ram = false;
        standing.grapple = ships.landingPad[i]! < 0 && ships.dockPort[i]! < 0;
        standing.land = ships.landingPad[i]! >= 0;
        standing.dock = ships.dockPort[i]! >= 0;
        standing.flee = false;
        standing.hide = false;
        standing.approachSpeed = approach.approachSpeed;
        return standing;
    }
    standing.grapple = false;
    standing.land = false;
    standing.dock = false;
    standing.flee = false;
    standing.hide = false;

    if (ships.withdrawing[i] === 1) {
        const cover = ships.hiding[i]!;
        standing.target = cover !== NO_TARGET && ships.alive[cover] === 1 ? cover : NO_TARGET;
        standing.flee = true;
        standing.hide = standing.target !== NO_TARGET;
        standing.minRange = 0;
        standing.maxRange = 0;
        standing.ram = false;
        standing.approachSpeed = approach.approachSpeed;
        return standing;
    }

    const target = ships.chosen[i]!;
    if (target === NO_TARGET || ships.alive[target] !== 1 || !ships.hasControl(target)) {
        return undefined;
    }

    standing.target = target;

    // **Close until the target looks big enough to hit.** A gun misses
    // because its firing solution guessed wrong about where the target would
    // be, and how much of a guess it can afford depends on how much of the
    // sky the target fills — so a fighter has to be closed right in on and a
    // capital does not, and one number covers both because it is measured in
    // the target's own radii. Capped by what this ship's guns are good for,
    // so nothing stands off further than it can shoot.
    // **Measured from the target's skin, not from the middle of it.** A gun's
    // reach is how far it can throw a round past its own muzzle, and what it
    // is shooting at is the hull rather than the point the hull turns about —
    // which is the same thing on ships of a size and nothing like it when a
    // fighter attacks a capital. Left centre to centre, a TIE's doctrine sends
    // it to 460 metres from the middle of a Star Destroyer whose own radius is
    // 1,073: the station it is holding is a third of the way inside the ship,
    // so it flies into it, and no amount of keeping clear can save a craft
    // whose orders are to be there.
    const band = holdBand(approach, design.reach, shipAim.sizeOf(ships, target));
    standing.minRange = band.min;
    standing.maxRange = band.max;
    if (ships.ramming[i] !== target && shipDecide.rams(ships, i, target)) ships.ramming[i] = target;
    standing.ram = ships.ramming[i] === target;
    standing.approachSpeed = approach.approachSpeed;
    return standing;
}

/**
 * Add an order to the end of this ship's queue.
 *
 * Orders are carried out in the order they were given: the ship works on the
 * first one until `cancelOn` says it is finished, then takes up the next.
 */
export function pushOrder(
    ships: Ships,
    i: number,
    target: number,
    minRange: number,
    maxRange: number,
    approachSpeed: number,
    cancelOn: OrderCancelCondition = OrderCancelCondition.CompleteDisable,
): void {
    const order = {
        target: target,
        minRange: minRange,
        maxRange: maxRange,
        approachSpeed: approachSpeed,
        cancelOn: cancelOn,
        ram: false,
        grapple: false,
        land: false,
        dock: false,
    };
    ships.orders[i]!.push(order);
}

/** Add an order to ram `target`, closing at `approachSpeed` (its doctrine's, if not given), to the end of this ship's queue. */
export function pushRam(
    ships: Ships,
    i: number,
    target: number,
    approachSpeed?: number,
    cancelOn: OrderCancelCondition = OrderCancelCondition.CompleteDisable,
): void {
    const speed = approachSpeed ?? ships.doctrines[i]!.approach.approachSpeed;
    ships.orders[i]!.push({
        target,
        minRange: 0,
        maxRange: 0,
        approachSpeed: speed,
        cancelOn,
        ram: true,
        grapple: false,
        land: false,
        dock: false,
        ...(approachSpeed === undefined ? { live: true } : { speed: approachSpeed }),
    });
}

/** Drop every order this ship has. It holds its heading and its fire. */
export function clearOrder(ships: Ships, i: number): void {
    if (ships.orders[i]?.[0]?.errand !== undefined) shipForage.stopForaging(ships, i);
    ships.orders[i] = [];
    ships.errandDocked[i] = 0;
}

/**
 * Add an order to attack `target`, fought as this ship's doctrine would fight
 * one it chose: its standoff band and approach speed.
 */
export function pushAttack(
    ships: Ships,
    i: number,
    target: number,
    cancelOn: OrderCancelCondition = OrderCancelCondition.CompleteDisable,
    distance?: number,
    speed?: number,
): void {
    pushOrder(ships, i, target, 0, 0, 0, cancelOn);
    const order = ships.orders[i]!.at(-1)!;
    order.live = true;
    if (distance !== undefined) order.distance = distance;
    if (speed !== undefined) order.speed = speed;
    liveBand(ships, i, order);
}

/**
 * Bring an order's band and speed up to date: from what it was told, or
 * from its doctrine as it is now and the target as it now is.
 */
export function liveBand(ships: Ships, i: number, order: Order): void {
    if (order.live !== true) return;
    const approach = ships.doctrines[i]!.approach;
    order.approachSpeed = order.speed ?? approach.approachSpeed;
    if (order.ram || order.defend === true || order.target === NO_TARGET || ships.alive[order.target] !== 1) return;
    const band = holdBand(approach, ships.designs[i]!.reach, ships.designs[order.target]!.radius, order.distance);
    order.minRange = band.min;
    order.maxRange = band.max;
}

/** Add an order to defend `friend` until it is gone, `distance` off its skin and closing at `speed` where told. */
export function pushDefend(ships: Ships, i: number, friend: number, distance?: number, speed?: number): void {
    const approach = ships.doctrines[i]!.approach;
    ships.orders[i]!.push({
        target: friend,
        minRange: 0,
        maxRange: 0,
        approachSpeed: speed ?? approach.approachSpeed,
        live: true,
        ...(distance === undefined ? {} : { distance }),
        ...(speed === undefined ? {} : { speed }),
        cancelOn: OrderCancelCondition.CompletelyDead,
        ram: false,
        grapple: false,
        land: false,
        dock: false,
        defend: true,
    });
    // A fresh look at who is attacking it, rather than at the next rethink.
    ships.rethinkAt[i] = 0;
}

/**
 * Add an order to dock and take on all it can: at `friend`, or with
 * `NO_TARGET` wherever its doctrine would go. False, and nothing added, for
 * a friend it could not dock with: no pad it fits, or for a ship that is
 * not a fighter, no port where it has one.
 */
export function pushDock(ships: Ships, i: number, friend: number): boolean {
    if (friend !== NO_TARGET && !couldDockAt(ships, i, friend)) return false;
    return pushErrand(ships, i, "dock", friend);
}

/**
 * Add an order to fill its claw: from `source` (a wreck, an enemy, a friend
 * out of control, or one still flying, which gives only fuel above its own
 * reserve), or with `NO_TARGET` from source after source as its doctrine
 * would choose, until it is full. False, and nothing added, for a ship with
 * no claw, or a source on no side.
 */
export function pushScavenge(ships: Ships, i: number, source: number): boolean {
    if (!ships.designs[i]!.modules.some((m) => m.spec.kind === "claw")) return false;
    if (
        source !== NO_TARGET &&
        (source === i || ships.alive[source] !== 1 || (ships.team[source] === NEUTRAL_TEAM && !ships.isAsteroid(source)))
    )
        return false;
    return pushErrand(ships, i, "scavenge", source);
}

/**
 * Add an order to give all it can spare through its port: to `friend`, or
 * with `NO_TARGET` to friend after friend as its doctrine would choose,
 * until it has nothing left to spare. False, and nothing added, for a ship
 * with no port, or a friend without one.
 */
export function pushDeliver(ships: Ships, i: number, friend: number): boolean {
    const design = ships.designs[i]!;
    if (design.fighter || !design.modules.some((m) => m.spec.kind === "port")) return false;
    if (friend !== NO_TARGET) {
        if (friend === i || ships.alive[friend] !== 1 || ships.team[friend] !== ships.team[i]) return false;
        if (!ships.designs[friend]!.modules.some((m) => m.spec.kind === "port")) return false;
    }
    return pushErrand(ships, i, "deliver", friend);
}

/**
 * Replace this ship's orders with running away: from every armed enemy for
 * `NO_TARGET`, from `target` if it is an armed enemy, or hiding behind it if
 * it is a friend or on no side, a wreck included. False, and nothing
 * changed, for itself or an enemy with nothing to run from.
 */
export function pushFlee(ships: Ships, i: number, target: number): boolean {
    let hide = false;
    if (target !== NO_TARGET) {
        if (target === i || ships.alive[target] !== 1) return false;
        hide = ships.derelict[target] === 1 || !ships.hostile(i, target);
        if (!hide && !shipFlight.armed(ships, target)) return false;
    }
    clearOrder(ships, i);
    ships.orders[i]!.push({
        target,
        minRange: 0,
        maxRange: 0,
        approachSpeed: ships.doctrines[i]!.approach.approachSpeed,
        cancelOn: OrderCancelCondition.None,
        ram: false,
        grapple: false,
        land: false,
        dock: false,
        flee: true,
        hide,
    });
    return true;
}

export function pushErrand(ships: Ships, i: number, errand: Errand, target: number): boolean {
    ships.orders[i]!.push({
        target,
        minRange: 0,
        maxRange: 0,
        approachSpeed: ships.doctrines[i]!.approach.approachSpeed,
        cancelOn: OrderCancelCondition.CompletelyDead,
        ram: false,
        grapple: false,
        land: false,
        dock: false,
        errand,
    });
    if (ships.orders[i]!.length === 1) startErrand(ships, i);
    return true;
}

/** Set ship `i` off on the errand now at the head of its queue, rather than at its next rethink. */
export function startErrand(ships: Ships, i: number): void {
    shipForage.stopForaging(ships, i);
    ships.errandDocked[i] = 0;
    ships.forageAt[i] = 0;
}

/** Whether ship `i` has the kind of dock that could ever mate with one of `t`'s, worn or not. */
export function couldDockAt(ships: Ships, i: number, t: number): boolean {
    if (t === i || ships.alive[t] !== 1 || ships.team[t] !== ships.team[i]) return false;
    const design = ships.designs[i]!;
    const host = ships.designs[t]!;
    if (design.fighter) {
        const box = footprintOf(design);
        return host.modules.some((m) => m.spec.kind === "pad" && shipDecide.fitsPad(box, m.spec));
    }
    return design.modules.some((m) => m.spec.kind === "port") && host.modules.some((m) => m.spec.kind === "port");
}

/** Drop the order at `n` in this ship's queue, the current one being 0. */
export function dropOrder(ships: Ships, i: number, n: number): void {
    ships.orders[i]?.splice(n, 1);
    if (n === 0) nextOrder(ships, i);
}

/** What follows an order leaving the head of the queue: a fresh start on the next one, if that is an errand. */
export function nextOrder(ships: Ships, i: number): void {
    ships.errandDocked[i] = 0;
    if (ships.errandOf(i) !== undefined) startErrand(ships, i);
}

/** This ship's orders, the current one first. */
export function ordersOf(ships: Ships, i: number): readonly Readonly<Order>[] {
    return ships.orders[i] ?? [];
}

/**
 * Drop every order this ship is finished with, wherever it sits in the
 * queue — not only the one it is working on.
 *
 * A target killed by somebody else while the queue waited its turn is just
 * as finished as one this ship killed itself, and leaving it in would send
 * the ship off to fight a wreck later.
 */
export function removeInvalidOrders(ships: Ships, i: number): void {
    const orders = ships.orders[i];
    if (orders === undefined) return;
    const kept: Order[] = [];
    for (const order of orders) {
        if (!orderFinished(ships, order)) kept.push(order);
    }
    ships.orders[i] = kept;
    if (kept[0] === orders[0]) return;
    if (orders[0]?.errand !== undefined) shipForage.stopForaging(ships, i);
    nextOrder(ships, i);
}

/** Whether an order's `cancelOn` condition has been met. */
export function orderFinished(ships: Ships, order: Order): boolean {
    // Station-keeping: held whatever becomes of the target, including nothing.
    if (order.cancelOn === OrderCancelCondition.None) return false;
    // An errand for doctrine to direct has no target to lose.
    if (order.errand !== undefined && order.target === NO_TARGET) return false;

    // Everything else needs a target that is still there to be finished with.
    if (order.target === NO_TARGET || ships.alive[order.target] !== 1) return true;

    const disarmed = ships.isDisarmed(order.target);
    const stranded = ships.hasNoEngines(order.target);
    switch (order.cancelOn) {
        case OrderCancelCondition.CompletelyDead:
            return false;
        case OrderCancelCondition.Disarm:
            return disarmed;
        case OrderCancelCondition.NoEngines:
            return stranded;
        case OrderCancelCondition.DisarmOrNoEngines:
            return disarmed || stranded;
        case OrderCancelCondition.CompleteDisable:
            return disarmed && stranded;
        default:
            return false;
    }
}

/**
 * The order this ship is working on: the oldest it has not finished with, or
 * `undefined` when it has none and is free to hold its heading and its fire.
 */
export function getCurrentOrder(ships: Ships, i: number): Order | undefined {
    return ships.orders[i]?.[0];
}

/** How many orders this ship still has, the current one included. */
export function orderCount(ships: Ships, i: number): number {
    return ships.orders[i]?.length ?? 0;
}
