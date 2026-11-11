import { Bodies } from "./bodies.js";
import { footprintOf, type Footprint, type ShipDesign } from "./blueprint.js";
import { DamageEffect } from "./damage.js";
import { inSight, look, score } from "./targeting.js";
import type { ModuleSpec } from "./modules.js";
import { length, max, min } from "./math.js";
import type { World } from "./world.js";
import { hullsOverlap } from "./collision.js";
import * as shipSupply from "./shipSupply.js";
import * as shipForage from "./shipForage.js";
import * as shipClaw from "./shipClaw.js";
import * as shipFlight from "./shipFlight.js";
import * as shipAim from "./shipAim.js";
import * as shipOrders from "./shipOrders.js";
import { type Ships, NO_TARGET } from "./ships.js";

/**
 * What each ship decides to do with its current order: whom it fights, whether
 * it rams, withdraws to restock or falls back on a consort for cover.
 */

/**
 * Pick a fight, if nobody has picked one for this ship.
 *
 * Only when the order queue is empty: an order given is an order obeyed,
 * and doctrine is the fallback rather than a second voice. And only every
 * so often — a hull reconsiders at a rate its own mass can act on, which
 * also spreads the cost of looking at every enemy across the steps between.
 */
export function decide(ships: Ships, world: World, bodies: Bodies, i: number): void {
    // Told to defend, it still picks its own fight, from among the friend's attackers.
    const defending = ships.defendingOf(i);
    if (ships.orders[i]!.length > 0 && defending === NO_TARGET && ships.errandOf(i) === undefined) {
        // Being told what to do clears what it had decided for itself, so
        // running out of orders is a fresh look rather than a stale one.
        ships.chosen[i] = NO_TARGET;
        ships.consort[i] = NO_TARGET;
        ships.guarding[i] = 0;
        ships.ramming[i] = NO_TARGET;
        ships.salvaging[i] = NO_TARGET;
        ships.withdrawing[i] = 0;
        return;
    }
    if (defending !== NO_TARGET) {
        ships.ramming[i] = NO_TARGET;
        ships.salvaging[i] = NO_TARGET;
    }
    // A ram, once decided, is seen through: no second look at the target, and
    // no consort to break off for.
    const rammed = ships.ramming[i]!;
    if (rammed !== NO_TARGET) {
        if (ships.alive[rammed] === 1 && ships.derelict[rammed] === 0 && ships.hasControl(rammed) && !ships.isDisabled(i)) {
            ships.chosen[i] = rammed;
            ships.consort[i] = NO_TARGET;
            ships.guarding[i] = 0;
            return;
        }
        ships.ramming[i] = NO_TARGET;
    }
    if (world.tick < ships.rethinkAt[i]!) return;

    const design = ships.designs[i]!;
    ships.rethinkAt[i] = world.tick + ships.rethinkTicks(world, design.mass);

    // With no gun or engine that works, it can neither reach a fight nor
    // shoot one, so it stops looking until it is mended or refuelled.
    if (ships.isDisabled(i)) {
        ships.chosen[i] = NO_TARGET;
        ships.consort[i] = NO_TARGET;
        ships.guarding[i] = 0;
        ships.withdrawing[i] = 0;
        ships.hiding[i] = NO_TARGET;
        return;
    }

    const b = bodies.indexOf(ships.bodyIds[i]!);
    if (b < 0) return;

    const doctrine = ships.doctrines[i]!.targeting;
    const loyalTo = ships.chosen[i]!;

    // What it is fighting. A ship with nothing to shoot with has nothing to
    // choose between — but it may still have somewhere it would rather be,
    // which is why this no longer ends the question.
    let fighting = NO_TARGET;
    // A ship that can ram still has a fight with nothing left to shoot, or
    // nothing to shoot with at all.
    const approach = ships.doctrines[i]!.approach;
    const rammer = approach.ramRadii > 0;
    const reach = shipSupply.fightReach(ships, i);
    // No deeper into a well than it can climb back out of, but to ram.
    const lift = wouldRam(ships, bodies, i, b) ? Infinity : shipFlight.pushAbility(ships, bodies, i, b);
    if ((design.reach > 0 && !ships.isDisarmed(i)) || (rammer && reach > 0)) {
        const wanted = doctrine.ramMass > 0 && wouldRam(ships, bodies, i, b) ? doctrine.ramMass : doctrine.preferredMass;
        // Defending, only what is attacking its charge, while anything is.
        let attackers = false;
        if (defending !== NO_TARGET) {
            for (let t = 0; t < ships.alive.length && !attackers; t++) {
                attackers = ships.alive[t] === 1 && ships.hostile(i, t) && shipAim.focusOf(ships, t) === defending;
            }
        }
        ships.choice.begin();
        ships.maskedChoice.begin();
        // Facing is judged along the line to what it is already fighting, not
        // along its nose: turned away to burn, a hull's nose says nothing of
        // what it would rather fight, and judged by it a craft on a pass
        // changed its mind with every turn.
        const lb = loyalTo === NO_TARGET || ships.alive[loyalTo] !== 1 ? -1 : bodies.indexOf(ships.bodyIds[loyalTo]!);
        const lx = lb < 0 || lb === b ? 0 : bodies.x[lb]! - bodies.x[b]!;
        const ly = lb < 0 || lb === b ? 0 : bodies.y[lb]! - bodies.y[b]!;
        const ll = length(lx, ly);
        for (let t = 0; t < ships.alive.length; t++) {
            if (t === i || ships.alive[t] === 0) continue;
            if (attackers && shipAim.focusOf(ships, t) !== defending) continue;
            // Wreckage is matter, not an enemy, nor is anything not hostile, and
            // a hulk offers nothing worth closing on: nothing controls it, and no
            // shot fired at it will ever remove it from the battle, so scoring it
            // low is not enough to stop a ship parking next to one forever.
            //
            // **A hulk is a hull with its cores shot out, and nothing else is.**
            // A ship that has merely lost its guns and its engines is harmless
            // and still a target: its core still controls it, and a round
            // through the core finishes it. Excluding those as well would make
            // being harmless the safest thing a hull could be — untouchable by
            // everyone, for as long as it liked.
            if (ships.derelict[t] === 1 || !ships.hostile(i, t) || !ships.hasControl(t)) continue;
            const tb = bodies.indexOf(ships.bodyIds[t]!);
            if (tb < 0 || tb === b) continue;
            let seen = look(bodies, b, tb, t, ships.designs[t]!.mass, !ships.isDisarmed(t), !ships.hasNoEngines(t));
            // Sharing a body, it is as far off as its own modules are.
            const at = ships.locate(bodies, t, tb, ships.lookAt);
            if (shipAim.sharesBody(ships, t, tb)) seen = { ...seen, range: length(at.x - bodies.x[b]!, at.y - bodies.y[b]!) };
            if (!within(ships, bodies, lift, t, at.x, at.y, bodies.x[b]!, bodies.y[b]!, reach)) continue;
            if (ll > 0 && doctrine.facingWeight !== 0) {
                const cx = at.x - bodies.x[b]!;
                const cy = at.y - bodies.y[b]!;
                const cl = length(cx, cy);
                seen = { ...seen, facing: cl > 0 ? (cx * lx + cy * ly) / (cl * ll) : 1 };
            }
            // Behind an asteroid, it is gone for only when nothing in sight is there to fight.
            const hidden = shipAim.rockBetween(ships, bodies, bodies.x[b]!, bodies.y[b]!, at.x, at.y, b, tb);
            const candidate =
                doctrine.sightWeight !== 0 && !inSight(bodies, bodies.x[b]!, bodies.y[b]!, b, tb) ? { ...seen, clear: false } : seen;
            (hidden ? ships.maskedChoice : ships.choice).offer(
                candidate,
                score(doctrine, candidate, reach, design.mass, loyalTo, -1, wanted),
            );
        }
        fighting = ships.choice.ship !== NO_TARGET ? ships.choice.ship : ships.maskedChoice.ship;
    }
    // What it would rather be with. Offered at all only when the doctrine
    // says escorting is worth something, since every weight here may be
    // negative and a consort scored by the ordinary ones would beat a distant
    // enemy on proximity alone — which would have every fleet in the game
    // huddling rather than fighting.
    const wasGuarding = ships.guarding[i] === 1;
    ships.chosen[i] = fighting;
    ships.consort[i] = defending;
    ships.guarding[i] = 0;
    if (defending === NO_TARGET && withdraws(ships, i, b, fighting)) {
        ships.chosen[i] = NO_TARGET;
        ships.consort[i] = NO_TARGET;
        ships.withdrawing[i] = 1;
        ships.hiding[i] = coverFor(ships, bodies, i, b, lift);
        return;
    }
    ships.withdrawing[i] = 0;
    ships.hiding[i] = NO_TARGET;
    // Landing or the like, it would not fly a consort, so it does not look for one.
    if (!shipOrders.escorting(ships, i)) {
        ships.consort[i] = NO_TARGET;
        return;
    }
    if (defending !== NO_TARGET || !(doctrine.escortWeight > 0)) return;

    ships.choice.begin();
    for (let t = 0; t < ships.alive.length; t++) {
        if (t === i || ships.alive[t] === 0) continue;
        // Wreckage is nobody's consort. A live friendly that cannot fight is:
        // a thing worth covering is usually a thing that cannot cover itself.
        // So is a hulk with robots aboard, which may yet mend its core.
        if (ships.derelict[t] === 1 || ships.hostile(i, t)) continue;
        if (ships.hulk(t) && !ships.mending(bodies, t)) continue;
        // Nor is a rock: neutral, but scenery rather than an objective.
        if (ships.rockFlag[t] === 1) continue;
        // Nor is a friend too small for it to bother covering. A neutral is an
        // objective rather than a ship to look after, and is gone to whatever
        // its size: a goal is a marker far smaller than anything racing to it.
        if (ships.team[t] === ships.team[i] && ships.designs[t]!.radius < approach.escortMinRadii * design.radius) {
            continue;
        }
        const tb = bodies.indexOf(ships.bodyIds[t]!);
        if (tb < 0 || tb === b) continue;
        const band = escortBand(ships, i, design, t);
        if (!within(ships, bodies, lift, t, bodies.x[tb]!, bodies.y[tb]!, bodies.x[b]!, bodies.y[b]!, band)) continue;
        const candidate = look(bodies, b, tb, t, ships.designs[t]!.mass, !ships.isDisarmed(t), !ships.hasNoEngines(t));
        // Which consort is the ordinary stack's question — proximity dominating,
        // nearly always the nearest. How hard it pulls is the pilot's, and is
        // asked every step rather than on this schedule.
        ships.choice.offer(candidate, score(doctrine, candidate, design.reach, design.mass, loyalTo));
    }
    ships.consort[i] = ships.choice.ship;
    guard(ships, bodies, i, b, wasGuarding);
}

/**
 * Whether a craft at (`fromX`, `fromY`) that can push `lift` could keep with
 * ship `t`, at (`x`, `y`), from `reach` of it on its own side
 * (`shipFlight.keepsWith`).
 */
export function within(
    ships: Ships,
    bodies: Bodies,
    lift: number,
    t: number,
    x: number,
    y: number,
    fromX: number,
    fromY: number,
    reach: number,
): boolean {
    const d = length(fromX - x, fromY - y);
    const k = d > reach ? reach / d : 1;
    return shipFlight.keepsWith(ships, bodies, lift, t, x + (fromX - x) * k, y + (fromY - y) * k);
}

/** How much further out than where it starts guarding an escort stops. */
const GUARD_LEAVE = 1.5;

/**
 * Escorting or fighting, never both at once.
 *
 * Weighed against each other, the two settle halfway: an escort chasing an
 * enemy that is moving away from its charge trails it at half its speed, and
 * stays with neither. So while an enemy is in ship `i`'s reach of where it
 * stations, it stays and fights the nearest such from there; while none is,
 * it leaves its charge to go after what it chose. Guarding already, it stays
 * until none is within `GUARD_LEAVE` of that, or an enemy hanging about the
 * edge would have it to and fro across it.
 */
function guard(ships: Ships, bodies: Bodies, i: number, b: number, wasGuarding: boolean): void {
    const consort = ships.consort[i]!;
    if (consort === NO_TARGET || ships.chosen[i] === NO_TARGET) return;
    const cb = bodies.indexOf(ships.bodyIds[consort]!);
    if (cb < 0) return;
    const reach = (shipSupply.fightReach(ships, i) + escortBand(ships, i, ships.designs[i]!, consort)) * (wasGuarding ? GUARD_LEAVE : 1);
    let nearest = NO_TARGET;
    let best = reach;
    for (let t = 0; t < ships.alive.length; t++) {
        if (ships.alive[t] !== 1 || ships.derelict[t] === 1 || !ships.hostile(i, t) || !ships.hasControl(t)) continue;
        const tb = bodies.indexOf(ships.bodyIds[t]!);
        if (tb < 0 || tb === b) continue;
        const d = length(bodies.x[tb]! - bodies.x[cb]!, bodies.y[tb]! - bodies.y[cb]!);
        if (d < best) {
            best = d;
            nearest = t;
        }
    }
    if (nearest === NO_TARGET) {
        ships.consort[i] = NO_TARGET;
        return;
    }
    ships.chosen[i] = nearest;
    ships.guarding[i] = 1;
}

/**
 * How close a craft wants to sit to what it is covering, metres.
 *
 * The escort's own band, not the gunnery one: a standoff is where you sit
 * to *shoot* at something, which is the wrong answer by an order of
 * magnitude for something you are covering. Capped by a fraction of the
 * escort's own reach, since a consort inside that is a consort its guns can
 * do something about — and uncapped for a craft with no guns, which has no
 * reach for the cap to mean anything in.
 */
export function escortBand(ships: Ships, i: number, design: ShipDesign, target: number): number {
    const approach = ships.doctrines[i]!.approach;
    const theirs = shipAim.sizeOf(ships, target);
    const told = shipOrders.getCurrentOrder(ships, i);
    if (told?.defend === true && told.target === target && told.distance !== undefined) return theirs + design.radius + told.distance;
    const wanted = approach.escortRadii * theirs;
    // From skin to skin, for the same reason a standoff is from the target's:
    // keeping station a hundred metres off a thing a kilometre across is a
    // place inside it, and so is a station closer than two hulls the same
    // size can turn without touching.
    const skin = theirs + design.radius;
    if (!(design.reach > 0)) return skin + wanted;
    return skin + min(wanted, approach.escort * design.reach);
}

/**
 * The inside edge of the band `escortBand` gives, centre to centre, metres:
 * `escortInner` of the way out from touching, or 0 for none.
 */
export function escortInnerEdge(ships: Ships, i: number, design: ShipDesign, target: number, band: number): number {
    const inner = min(1, ships.doctrines[i]!.approach.escortInner);
    if (!(inner > 0)) return 0;
    const touching = shipAim.sizeOf(ships, target) + design.radius;
    return touching + inner * max(0, band - touching);
}

/**
 * Whether this ship's doctrine would ram its target now: close enough, by
 * `ramRadii` of the target's radius from its edge, and with no more of its
 * own guns working than `ramArmed` says. Guns that are only empty count as
 * working while a friend's pad could fill them.
 */
export function rams(ships: Ships, i: number, target: number): boolean {
    const approach = ships.doctrines[i]!.approach;
    if (!(approach.ramRadii > 0)) return false;
    const bodies = ships.bodyStore;
    if (bodies === null) return false;
    const b = bodies.indexOf(ships.bodyIds[i]!);
    const tb = bodies.indexOf(ships.bodyIds[target]!);
    if (b < 0 || tb < 0) return false;
    const gap = length(bodies.x[tb]! - bodies.x[b]!, bodies.y[tb]! - bodies.y[b]!) - bodies.radius[tb]!;
    if (gap > approach.ramRadii * bodies.radius[tb]!) return false;
    return wouldRam(ships, bodies, i, b);
}

/** Whether this ship's doctrine would have it ram whatever came near enough: its guns gone, and no stores to restock them. */
export function wouldRam(ships: Ships, bodies: Bodies, i: number, b: number): boolean {
    const approach = ships.doctrines[i]!.approach;
    if (!(approach.ramRadii > 0)) return false;
    if (armedShare(ships, i, b, true) > approach.ramArmed) return false;
    return armedShare(ships, i, b, false) <= approach.ramArmed || !canRestock(ships, bodies, i, b);
}

/**
 * Whether this ship's doctrine would have it withdraw rather than fight
 * `fighting`: nothing to fight or work with, though a reach of its own, a
 * plume's or a ram's, is something; or no more of it working than
 * `fleeArmed`. Not while it would ram what it is fighting, close enough by
 * `ramRadii`, nor with no armed enemy anywhere to keep clear of.
 */
export function withdraws(ships: Ships, i: number, b: number, fighting: number): boolean {
    const approach = ships.doctrines[i]!.approach;
    const share = armedShare(ships, i, b, false);
    const leaving = ships.tools === 0 ? !(shipSupply.fightReach(ships, i) > 0) : share <= approach.fleeArmed;
    if (!leaving) return false;
    if (fighting !== NO_TARGET && rams(ships, i, fighting)) return false;
    for (let e = 0; e < ships.alive.length; e++) if (ships.hostile(i, e) && shipFlight.armed(ships, e)) return true;
    return false;
}

/**
 * Cover for withdrawing ship `i` to hide behind: what it hides behind
 * already while that still serves, or the nearest friend or body on no
 * side, a wreck included, within `hideRange` of its radii, at least
 * `hideSize` of its radius, and no armed enemy's reach on it. `NO_TARGET`
 * for none, to flee instead.
 */
export function coverFor(ships: Ships, bodies: Bodies, i: number, b: number, lift = Infinity): number {
    const approach = ships.doctrines[i]!.approach;
    const mine = ships.designs[i]!.radius;
    const range = approach.hideRange * mine;
    if (!(range > 0)) return NO_TARGET;
    const serves = (t: number): number => {
        if (t === i || ships.alive[t] !== 1 || (ships.derelict[t] === 0 && ships.hostile(i, t))) return -1;
        const tb = bodies.indexOf(ships.bodyIds[t]!);
        if (tb < 0 || tb === b || bodies.ghost[tb] === 1 || bodies.radius[tb]! < approach.hideSize * mine) return -1;
        const d = length(bodies.x[tb]! - bodies.x[b]!, bodies.y[tb]! - bodies.y[b]!);
        if (d > range || shipForage.dangerNear(ships, bodies, i, tb) > 0) return -1;
        if (!within(ships, bodies, lift, t, bodies.x[tb]!, bodies.y[tb]!, bodies.x[b]!, bodies.y[b]!, bodies.radius[tb]! + mine)) return -1;
        return d;
    };
    const held = ships.hiding[i]!;
    if (held !== NO_TARGET && serves(held) >= 0) return held;
    let best = NO_TARGET;
    let nearest = Infinity;
    for (let t = 0; t < ships.alive.length; t++) {
        const d = serves(t);
        if (d >= 0 && d < nearest) {
            nearest = d;
            best = t;
        }
    }
    return best;
}

/**
 * The share of what this ship fights or works with that still works, none
 * for a ship with nothing: its main mounts, with `stores` only those with a
 * shot to fire; its claws while doctrine has it out scavenging, and its
 * ports while delivering, wanted whether or not they work. How many there
 * are is left in `tools`.
 */
export function armedShare(ships: Ships, i: number, b: number, stores: boolean): number {
    const design = ships.designs[i]!;
    const turrets = design.turrets;
    let mounts = 0;
    let working = 0;
    for (let t = 0; t < turrets.length; t++) {
        if (!turrets[t]!.main) continue;
        mounts++;
        if (stores ? ships.canFire(i, b, t) : !ships.isTurretDisabled(i, t)) working++;
    }
    const trip = ships.orders[i]!.length === 0 && ships.salvaging[i] !== NO_TARGET;
    const wanted = !trip ? "" : ships.delivering[i] === 1 ? "port" : ships.landingPad[i]! < 0 && ships.dockPort[i]! < 0 ? "claw" : "";
    if (wanted !== "") {
        for (let m = 0; m < design.modules.length; m++) {
            if (design.modules[m]!.spec.kind !== wanted || !ships.ownsAt(i, b, m)) continue;
            mounts++;
            if (ships.left(i, b, m, DamageEffect.Grip) > 0) working++;
        }
    }
    ships.tools = mounts;
    return mounts === 0 ? 0 : working / mounts;
}

/**
 * Whether a friend has a pad this ship would land on for the metal or charge
 * it has room for, as `forage` would send it. Taken or not: a pad in use is
 * a wait, not a dead end.
 */
export function canRestock(ships: Ships, bodies: Bodies, i: number, b: number): boolean {
    const design = ships.designs[i]!;
    const approach = ships.doctrines[i]!.approach;
    if (!design.fighter || !(approach.approachSpeed > 0)) return false;
    if (approach.scavengeFuelBelow > 0 && shipClaw.workingClaw(ships, i, b) >= 0) return false;
    const own = design.cores[0] ?? 0;
    const metalRoom = approach.rearmBelow >= 0 ? ships.metal.pieceRoom(b, own) : 0;
    const chargeRoom = approach.rechargeBelow > 0 ? ships.power.pieceRoom(b, own) : 0;
    if (!(metalRoom > 0 || chargeRoom > 0)) return false;
    const box = footprintOf(design);
    for (let t = 0; t < ships.alive.length; t++) {
        if (t === i || ships.alive[t] === 0 || ships.derelict[t] === 1) continue;
        if (ships.team[t] !== ships.team[i] || ships.hostile(i, t)) continue;
        const tb = bodies.indexOf(ships.bodyIds[t]!);
        if (tb < 0 || tb === b) continue;
        const modules = ships.designs[t]!.modules;
        for (let pad = 0; pad < modules.length; pad++) {
            if (modules[pad]!.spec.kind !== "pad" || !(modules[pad]!.stats.pumpRate > 0)) continue;
            if (!fitsPad(box, modules[pad]!.spec) || !(ships.left(t, tb, pad, DamageEffect.Grip) > 0)) continue;
            if (metalRoom > 0 && ships.metal.pieceHeld(tb, pad) > shipSupply.metalReserve(ships, tb, pad)) return true;
            if (chargeRoom > 0 && ships.power.pieceHeld(tb, pad) > shipSupply.chargeReserve(ships, tb, pad)) return true;
        }
    }
    return false;
}

/** Whether a ship of footprint `box` fits on `pad`, either way round. */
export function fitsPad(box: Footprint, pad: ModuleSpec): boolean {
    const long = box.maxX - box.minX;
    const wide = box.maxY - box.minY;
    return (long <= pad.length && wide <= pad.width) || (long <= pad.width && wide <= pad.length);
}

/**
 * Whether a fighter takes the hull layer as well: whenever it is grappling,
 * or ramming — by its doctrine's decision or by order — and due to strike
 * within `ramCommit` seconds. Until then it flies the ram in the weapons
 * layer, where the hulls it passes on the way are no obstacle.
 *
 * Only while clear of every hull, in either direction (DESIGN.md §3), so a
 * fighter cannot drop into a capital's structure or climb back out of one it
 * has struck. Clear of its modules rather than its bounding circle, so a
 * fighter alongside a long hull can still commit.
 */
export function commitOne(ships: Ships, bodies: Bodies, i: number): void {
    if (!ships.designs[i]!.fighter) return;
    // Spent on the way in, it has given up its ram but is still armed: it coasts on into what it was aimed at.
    if (ships.committed[i] === 1 && ships.isDisabled(i)) return;
    const b = bodies.indexOf(ships.bodyIds[i]!);
    if (b < 0) return;
    const order = shipOrders.effectiveOrder(ships, i);
    // Parked, it meets nothing of its carrier, so would look clear on the pad and drop into its hull when let go.
    const ramming = order !== undefined && order.target !== NO_TARGET && (order.ram || order.grapple) && ships.parkedOn[i]! < 0;
    const want = ramming && (order.grapple || strikesWithin(ships, bodies, i, b, order.target)) ? 1 : 0;
    if (want === ships.committed[i] || !clearOfHulls(ships, bodies, b)) return;
    ships.committed[i] = want;
}

/** Whether ship `i`, on body `b`, will reach `target`'s bounding circle within its doctrine's `ramCommit` seconds, or has. */
export function strikesWithin(ships: Ships, bodies: Bodies, i: number, b: number, target: number): boolean {
    const tb = bodies.indexOf(ships.bodyIds[target]!);
    if (tb < 0) return false;
    const dx = bodies.x[tb]! - bodies.x[b]!;
    const dy = bodies.y[tb]! - bodies.y[b]!;
    const range = length(dx, dy);
    const gap = range - bodies.radius[tb]! - bodies.radius[b]!;
    if (!(gap > 0)) return true;
    const closing = ((bodies.vx[b]! - bodies.vx[tb]!) * dx + (bodies.vy[b]! - bodies.vy[tb]!) * dy) / range;
    return gap <= closing * ships.doctrines[i]!.approach.ramCommit;
}

/** Whether no module of this body overlaps any other hull's. */
export function clearOfHulls(ships: Ships, bodies: Bodies, b: number): boolean {
    const own = ships.designOf(b);
    if (own === null) return true;
    for (let j = 0; j < bodies.highWater; j++) {
        if (j === b || bodies.alive[j] === 0 || bodies.ghost[j] === 1 || !ships.meets(b, j)) continue;
        const other = ships.designOf(j);
        if (other !== null && hullsOverlap(bodies, b, own, j, other)) return false;
    }
    return true;
}

/** Ship `i`'s consort while it is one worth staying with: alive, not a hulk left to itself, and on a body of its own. */
export function liveConsort(ships: Ships, bodies: Bodies, i: number, b: number): number {
    const consort = ships.consort[i] ?? NO_TARGET;
    if (consort === NO_TARGET || ships.alive[consort] !== 1) return NO_TARGET;
    if (ships.hulk(consort) && !ships.mending(bodies, consort)) return NO_TARGET;
    const cb = bodies.indexOf(ships.bodyIds[consort]!);
    return cb < 0 || cb === b ? NO_TARGET : consort;
}
