import { Bodies } from "./bodies.js";
import { originOf, type Seam, type ShipDesign } from "./blueprint.js";
import { jointBetween, joints } from "./connectivity.js";
import { DamageEffect, REPAIR_ENERGY_PER_JOULE, REPAIR_WASTE, repairWork } from "./damage.js";
import { buildWork, SHELL_STEPS } from "./rebuild.js";
import { Claim, mendClaim, priorityOf, Resource } from "./supply.js";
import { length, max, min } from "./math.js";
import type { Store } from "./store.js";
import { DEFAULT_DOCTRINE, type Approach } from "./doctrine.js";
import type { World } from "./world.js";
import { DOCK_POWER_PER_METRE, PAD_REPAIR_PER_AREA, SLIPWAY_BUILD_PER_METRE } from "./modules.js";
import * as shipRebuild from "./shipRebuild.js";
import * as shipWeld from "./shipWeld.js";
import { type Ships, short, originTier, repairTier, NO_TARGET } from "./ships.js";
import * as shipBreakup from "./shipBreakup.js";
import * as shipForage from "./shipForage.js";
import * as shipDocking from "./shipDocking.js";
import * as shipBuild from "./shipBuild.js";

/**
 * Supply between hulls: fuel, metal and charge pumped across docking seams and
 * claws, pads mending and building what is parked on them, and what each ship's
 * doctrine keeps back for itself.
 */

/** Seconds of closing at its approach speed that stand in for an unarmed rammer's reach in choosing a target. */
const RAM_HORIZON = 60;

/**
 * Pump what every working claw holds into its own piece of hull, and let go
 * once its piece is full or what it holds is dry, and say how many let go.
 *
 * A claw keeps hold while it cannot pump — its jaws are shut — so only one
 * that is still working decides it is done.
 */
export function pump(ships: Ships, world: World): number {
    ships.tick = world.tick;
    const bodies = world.bodies;
    ships.bodyStore = bodies;
    let released = 0;
    for (let i = 0; i < ships.alive.length; i++) {
        if (ships.alive[i] === 0) continue;
        const b = bodies.indexOf(ships.bodyIds[i]!);
        // A body is walked once, by its primary, however many ships ride it.
        if (b < 0 || ships.shipByBody[b] !== i) continue;
        const design = ships.designs[i]!;
        const seams = design.seams;
        if (seams === undefined || ships.damage.isProtected(b)) continue;
        let moved = false;
        for (const seam of seams) {
            if (seam.dock === undefined) continue;
            const working = ships.damage.remaining(b, seam.a, DamageEffect.Grip);
            if (!(working > 0)) continue;
            if (seam.dock === "slipway") {
                // Held while its walls go up, fitted out once they are, filled from
                // what the builder can spare, and let go once it has all it can take.
                const built = ships.pilotAt(b, seam.b);
                if (built >= 0 && ships.printing[built] === 1) continue;
                if (built >= 0 && ships.unfinished[built] === 1) {
                    const joules = SLIPWAY_BUILD_PER_METRE * design.modules[seam.a]!.spec.width * working * world.dt;
                    if (shipBuild.tendAtFace(ships, bodies, b, built, seam.a, joules)) ships.builtAt[ships.pilotAt(b, seam.a)] = world.tick;
                    else if (!shipBuild.atFace(ships, b, built, seam.a)) ships.unfinished[built] = 0;
                    continue;
                }
                if (built >= 0) {
                    const rate = design.modules[seam.a]!.stats.pumpRate * working * world.dt;
                    const cable = DOCK_POWER_PER_METRE * design.modules[seam.a]!.spec.width * working * world.dt;
                    if (dockPump(ships, Resource.Fuel, ships.fuel, b, seam.a, seam.b, rate, Claim.Slipway) > 0) moved = true;
                    if (dockPump(ships, Resource.Metal, ships.metal, b, seam.a, seam.b, rate, Claim.Slipway) > 0) moved = true;
                    dockPump(ships, Resource.Charge, ships.power, b, seam.a, seam.b, cable, Claim.Slipway);
                    // Held, as a pad holds a fighter, until it has what its doctrine leaves
                    // with, or its builder has no more to spare and is not anchored to get more.
                    const launch = ships.doctrines[built]!.approach;
                    const coming = ships.isMoored(ships.pilotAt(b, seam.a));
                    const fuelLeft =
                        short(ships.fuel, b, seam.b, launch.launchFuel) &&
                        (coming || ships.fuel.pieceHeld(b, seam.a) > fuelReserve(ships, b, seam.a));
                    const metalLeft =
                        short(ships.metal, b, seam.b, launch.launchMetal) &&
                        (coming || ships.metal.pieceHeld(b, seam.a) > metalReserve(ships, b, seam.a));
                    const chargeLeft =
                        short(ships.power, b, seam.b, launch.launchCharge) &&
                        (coming || ships.power.pieceHeld(b, seam.a) > chargeReserve(ships, b, seam.a));
                    if (fuelLeft || metalLeft || chargeLeft) continue;
                }
            }
            const rate = design.modules[seam.a]!.stats.pumpRate * working * world.dt;
            // A ship that minds danger lets go the moment an armed enemy is in reach.
            if (seam.dock !== "slipway" && !threatenedAt(ships, bodies, b, seam)) {
                if (seam.dock === "claw") {
                    // A claw drinks what it holds, and holds on while its robots can take it apart.
                    const holder = ships.pilotAt(b, seam.a);
                    const source = ships.pilotAt(b, seam.b);
                    // A friend still flying, which it was sent to, gives what it holds above its reserve.
                    const kept =
                        holder >= 0 && source >= 0 && !shipForage.drinkable(ships, holder, source) ? fuelReserve(ships, b, seam.b) : 0;
                    const offered = ships.fuel.pieceHeld(b, seam.b) - kept;
                    if (offered > 0 && ships.fuel.transfer(b, seam.b, seam.a, rate < offered ? rate : offered) > 0) moved = true;
                    if (ships.fuel.pieceRoom(b, seam.a) > 0 && ships.fuel.pieceHeld(b, seam.b) > kept) continue;
                    if (
                        holder >= 0 &&
                        shipRebuild.canStrip(ships, b, holder, seam.a, world.dt) &&
                        shipRebuild.strippable(ships, holder, b, design, seam.a)
                    )
                        continue;
                    // Anchored while it builds, it holds on until what it is building is let go.
                    if (holder >= 0 && shipBuild.wantsAnchor(ships, bodies, holder)) continue;
                    // With no robots to mine it, it melts the ice out of the rock itself.
                    if (holder >= 0 && shipWeld.heat(ships, b, design, seam.a, seam.b, working * world.dt)) {
                        moved = true;
                        continue;
                    }
                } else if (seam.dock === "port") {
                    // Two ports pass fuel, metal and charge into whichever ship is
                    // refuelling, from what the other can spare, and part once it is
                    // full, nothing more can be spared, or either is given an order.
                    const oa = ships.pilotAt(b, seam.a);
                    const ob = ships.pilotAt(b, seam.b);
                    // Or out of whichever is delivering, whether the other asked or not.
                    const intoB = (ships.docking[ob] === 1 && ships.docking[oa] !== 1) || ships.delivering[oa] === 1;
                    const intoA = (ships.docking[oa] === 1 && ships.docking[ob] !== 1) || ships.delivering[ob] === 1;
                    const ordered = ships.commanded(oa) || ships.commanded(ob);
                    const bothWorking = ships.damage.remaining(b, seam.b, DamageEffect.Grip);
                    if (!(bothWorking > 0)) continue;
                    if (!ordered && (intoA || intoB)) {
                        const from = intoB ? seam.a : seam.b;
                        const to = intoB ? seam.b : seam.a;
                        // Through the narrower of the two couplings, as worn as the worse.
                        const narrower = min(design.modules[seam.a]!.stats.pumpRate, design.modules[seam.b]!.stats.pumpRate);
                        const flow = narrower * min(working, bothWorking) * world.dt;
                        // Delivering, it keeps what it means to keep over its reserve.
                        const over = ships.fuel.pieceHeld(b, from) - shipForage.keepsBack(ships, b, from);
                        if (dockPump(ships, Resource.Fuel, ships.fuel, b, from, to, flow < over ? flow : over, Claim.Ports) > 0)
                            moved = true;
                        if (dockPump(ships, Resource.Metal, ships.metal, b, from, to, flow, Claim.Ports) > 0) moved = true;
                        // Charge alongside, through the narrower coupling's cabling.
                        const cable =
                            DOCK_POWER_PER_METRE *
                            min(design.modules[seam.a]!.spec.width, design.modules[seam.b]!.spec.width) *
                            min(working, bothWorking) *
                            world.dt;
                        dockPump(ships, Resource.Charge, ships.power, b, from, to, cable, Claim.Ports);
                        const fuelLeft =
                            ships.fuel.pieceRoom(b, to) > 0 && ships.fuel.pieceHeld(b, from) > shipForage.keepsBack(ships, b, from);
                        const metalLeft = ships.metal.pieceRoom(b, to) > 0 && ships.metal.pieceHeld(b, from) > metalReserve(ships, b, from);
                        const chargeLeft =
                            ships.power.pieceRoom(b, to) > 0 && ships.power.pieceHeld(b, from) > chargeReserve(ships, b, from);
                        if (fuelLeft || metalLeft || chargeLeft) continue;
                    }
                }
            }
            // Done: the dock lets go, which `sever` reads as the seam cut through.
            if (seam.dock === "slipway") {
                // What it built holds its engines until it is clear (`pushOff`).
                const built = ships.pilotAt(b, seam.b);
                if (built >= 0) {
                    ships.clearing[built] = ships.pilotAt(b, seam.a);
                    ships.clearingSince[built] = world.tick;
                }
            }
            const k = jointBetween(design, seam.a, seam.b);
            ships.damage.cutWeld(b, k, seam.width);
            released++;
        }
        if (moved) shipBreakup.settleMass(ships, bodies, b);
        shipRebuild.growAll(ships, world);
    }
    for (let k = 0; k < ships.parkedShips.length; k++) {
        const f = ships.parkedShips[k]!;
        if (ships.mooredClaw[f]! >= 0 ? shipForage.tendMoored(ships, world, f) : tendParked(ships, world, f)) continue;
        shipDocking.unpark(ships, bodies, f, world.tick);
        released++;
        k--;
    }
    shipRebuild.growAll(ships, world);
    return released;
}

/**
 * Pump up to `most` of resource `r` across a dock of body `b`, from module
 * `from`'s piece to module `to`'s, as `claim` of the giver, wanting what
 * the receiver has room for, and say how much went.
 */
export function dockPump(ships: Ships, r: Resource, store: Store, b: number, from: number, to: number, most: number, claim: Claim): number {
    if (!(most > 0)) return 0;
    const spare = allowed(ships, r, b, from, claim, store.pieceRoom(b, to));
    if (!(spare > 0)) return 0;
    const moved = store.transfer(b, from, to, most < spare ? most : spare);
    took(ships, r, b, from, claim, moved);
    return moved;
}

/**
 * Work the pad fighter `f` is parked on, and say whether it holds it still.
 * One being built is built, and held until it is whole whatever else is
 * going on. Anything else is filled with fuel, metal and charge, each from
 * what the carrier can spare, and mended, and let go once it holds what its
 * doctrine leaves with (`launchFuel` and its kind), or all the carrier can
 * spare if that is less and the carrier is not anchored, and is mended; or
 * at once once given an order. Danger lets it go once loaded, mended or not. A pad
 * gone, or one that can no longer grip, lets go of anything.
 */
export function tendParked(ships: Ships, world: World, f: number): boolean {
    const bodies = world.bodies;
    const pad = ships.parkedPadOf(bodies, f);
    const fb = bodies.indexOf(ships.bodyIds[f]!);
    if (pad < 0 || fb < 0 || ships.alive[f] === 0 || ships.derelict[f] === 1) return false;
    const c = ships.parkedOn[f]!;
    const cb = ships.carrierBodyOf(bodies, f);
    const working = ships.damage.remaining(cb, pad, DamageEffect.Grip);
    if (!(working > 0)) return false;
    if (ships.damage.isProtected(cb)) return true;
    const deck = ships.designs[c]!.modules[pad]!.spec;
    const work = PAD_REPAIR_PER_AREA * deck.length * deck.width * working * world.dt;
    if (ships.unfinished[f] === 1) {
        const progress = mend(ships, bodies, fb, f, pad, work, cb) || padBuild(ships, bodies, fb, f, cb, pad, work);
        if (progress) ships.builtAt[c] = world.tick;
        if (shipBuild.finished(ships, fb, f, ships.designs[f]!)) {
            ships.unfinished[f] = 0;
            // Its reach as the fighter it now is, for whether it waits aboard.
            const whole = ships.launched[f]!;
            const approach = ships.doctrines[f]!.approach;
            ships.landedReach[f] = whole.reach > 0 ? whole.reach : approach.ramRadii > 0 ? approach.approachSpeed * RAM_HORIZON : 0;
        }
        return true;
    }
    const into = ships.designs[f]!.cores[0] ?? 0;
    const rate = ships.designs[c]!.modules[pad]!.stats.pumpRate * working * world.dt;
    const cable = DOCK_POWER_PER_METRE * deck.width * working * world.dt;
    const fuel = across(ships, Resource.Fuel, ships.fuel, cb, pad, fb, into, rate);
    const metal = across(ships, Resource.Metal, ships.metal, cb, pad, fb, into, rate);
    across(ships, Resource.Charge, ships.power, cb, pad, fb, into, cable);
    if (fuel > 0 || metal > 0) {
        shipBreakup.settleMass(ships, bodies, fb);
        shipBreakup.settleMass(ships, bodies, cb);
    }
    // Mended first, and then built back to what it set out as.
    let repairLeft = mend(ships, bodies, fb, f, pad, work, cb);
    if (!repairLeft) repairLeft = padBuild(ships, bodies, fb, f, cb, pad, work);
    if (ships.commanded(f)) return false;
    // Loaded once it holds what its doctrine leaves with of each, or the
    // carrier has no more of it to spare and is not getting any: an anchored
    // carrier is mining or scavenging, so what it is short of is coming, and
    // it waits for it.
    const approach = ships.doctrines[f]!.approach;
    const coming = ships.isMoored(c);
    const fuelLeft =
        short(ships.fuel, fb, into, approach.launchFuel) && (coming || ships.fuel.pieceHeld(cb, pad) > fuelReserve(ships, cb, pad));
    const metalLeft =
        short(ships.metal, fb, into, approach.launchMetal) && (coming || ships.metal.pieceHeld(cb, pad) > metalReserve(ships, cb, pad));
    const chargeLeft =
        short(ships.power, fb, into, approach.launchCharge) && (coming || ships.power.pieceHeld(cb, pad) > chargeReserve(ships, cb, pad));
    const loaded = !fuelLeft && !metalLeft && !chargeLeft;
    // A ship that minds danger lets go once loaded if an armed enemy is in reach, mended or not.
    if (loaded && !ships.sentTo(f) && threatened(ships, bodies, f, cb, true)) return false;
    if (waitsAboard(ships, bodies, f, fb)) return true;
    return !loaded || repairLeft;
}

/**
 * Pump up to `most` of resource `r` from the piece of body `from` module
 * `out` is on, as far as its pads may have it, into the piece of body `to`
 * module `into` is on, as far as it has room, and say how much went.
 */
export function across(ships: Ships, r: Resource, store: Store, from: number, out: number, to: number, into: number, most: number): number {
    const room = store.pieceRoom(to, into);
    const amount = min(most, min(allowed(ships, r, from, out, Claim.Pads, room), room));
    if (!(amount > 0)) return 0;
    const taken = store.drain(from, out, amount);
    const put = store.add(to, into, taken);
    // Anything there turned out to be no room for goes back.
    if (put < taken) store.add(from, out, taken - put);
    took(ships, r, from, out, Claim.Pads, put);
    return put;
}

/**
 * Build some of what fighter `i`, on body `b` and parked on pad `pad` of
 * body `payB`, has lost since it set out, with `joules` of the pad's work: a
 * kilogram for each kilogram's worth of damage, as robots build, from the
 * metal and charge on the pad's piece of hull. Its fittings first, then a
 * shell's walls, then a module lost, against what is left of it, cores
 * first. Says whether it built anything.
 */
export function padBuild(ships: Ships, bodies: Bodies, b: number, i: number, payB: number, pad: number, joules: number): boolean {
    const launch = ships.launched[i];
    if (launch === undefined) return false;
    const design = ships.hullDesign[b]!;
    const rebuild = shipRebuild.rebuildFor(ships, i, design);
    let best = -1;
    let bestBuild = -1;
    let bestTier = Infinity;
    const approach = ships.doctrines[i]!.approach;
    for (let m = 0; m < design.modules.length; m++) {
        if (!ships.ownsAt(i, b, m)) continue;
        if (design.modules[m]!.shell === undefined && !(ships.damage.unbuiltAt(b, m) > 0)) continue;
        const tier = originTier(approach, design, m);
        if (tier < bestTier) {
            best = m;
            bestBuild = -1;
            bestTier = tier;
        }
    }
    if (best < 0 && rebuild.frame >= 0) {
        const compiled = originOf(design, rebuild.frame).design;
        for (const joint of joints(launch)) {
            if (joint.seam === true) continue;
            for (const [l, against] of [
                [joint.a, joint.b],
                [joint.b, joint.a],
            ] as const) {
                const m = rebuild.at[against]!;
                if (rebuild.at[l]! >= 0 || m < 0 || !ships.ownsAt(i, b, m)) continue;
                if (design.modules[m]!.shell !== undefined || originOf(design, m).design !== compiled) continue;
                const tier = repairTier(approach, launch, l);
                if (tier < bestTier) {
                    best = m;
                    bestBuild = l;
                    bestTier = tier;
                }
            }
        }
    }
    if (best < 0) return false;
    const fitting = bestBuild < 0 && design.modules[best]!.shell === undefined;
    const l = fitting ? -1 : bestBuild >= 0 ? bestBuild : rebuild.at.indexOf(best);
    const origin = fitting ? null : originOf(launch, l);
    const whole = origin === null ? design.modules[best]!.stats : origin.design.modules[origin.module]!.stats;
    const work = buildWork(whole);
    const perKg = work * REPAIR_ENERGY_PER_JOULE;
    const waste = 1 + REPAIR_WASTE;
    const wall = whole.structureMass / SHELL_STEPS;
    const most = joules / work;
    const metal = allowed(ships, Resource.Metal, payB, pad, Claim.Pads, fitting ? most * waste : wall * waste);
    let kg = min(most, allowed(ships, Resource.Charge, payB, pad, Claim.Pads, most * perKg) / perKg);
    if (fitting) {
        kg = min(kg, metal / waste);
        if (!(kg > 0)) return false;
        const mass = bodies.mass[payB]!;
        const inertia = bodies.inertia[payB]!;
        const put = ships.damage.fit(b, best, kg);
        if (!(put > 0)) return false;
        ships.metal.drain(payB, pad, put * waste);
        ships.power.drain(payB, pad, put * perKg);
        took(ships, Resource.Metal, payB, pad, Claim.Pads, put * waste);
        took(ships, Resource.Charge, payB, pad, Claim.Pads, put * perKg);
        shipBreakup.settleMass(ships, bodies, b);
        shipBreakup.settleMass(ships, bodies, payB);
        shipBreakup.discardFrom(ships, bodies, payB, mass, inertia);
        return true;
    }
    // Nothing to pay for the step with, or a step waiting on room to go up.
    if (metal < wall * waste) return false;
    kg = min(kg, wall - rebuild.work[l]!);
    if (!(kg > 0)) {
        if (rebuild.work[l]! >= wall) ships.grows.push(i, l, best, pad, payB);
        return false;
    }
    rebuild.work[l] = rebuild.work[l]! + kg;
    ships.power.drain(payB, pad, kg * perKg);
    took(ships, Resource.Charge, payB, pad, Claim.Pads, kg * perKg);
    if (rebuild.work[l]! >= wall) ships.grows.push(i, l, best, pad, payB);
    return true;
}

/**
 * Undo up to `joules` of the damage to ship `i`'s modules on body `b`, from
 * the metal and charge on module `from`'s piece of hull, reserves and all: cores first,
 * then engines and weapons, then the rest. Each joule takes
 * `REPAIR_ENERGY_PER_JOULE` of charge, and the metal it had shed and
 * `REPAIR_WASTE` more, which leaves the world. Says whether it mended
 * something and has more to mend.
 */
export function mend(ships: Ships, bodies: Bodies, b: number, i: number, from: number, joules: number, payB = b): boolean {
    shipBreakup.settleShed(ships, bodies);
    const design = ships.hullDesign[b]!;
    const approach = ships.doctrines[i]!.approach;
    // What a step of it could use at most, for what its pads ask for.
    let wantMetal = 0;
    let hurt = false;
    for (let m = 0; m < design.modules.length; m++) {
        if (!ships.ownsAt(i, b, m) || !(ships.damage.absorbedAt(b, m) > 0)) continue;
        hurt = true;
        const most = min(joules / repairWork(design.modules[m]!.stats), ships.damage.absorbedAt(b, m));
        wantMetal = max(wantMetal, ships.damage.repairMetal(b, m, most) * (1 + REPAIR_WASTE));
    }
    if (!hurt) return false;
    let metal = allowed(ships, Resource.Metal, payB, from, Claim.Pads, wantMetal);
    let charge = allowed(ships, Resource.Charge, payB, from, Claim.Pads, joules * REPAIR_ENERGY_PER_JOULE);
    let budget = joules;
    let usedMetal = 0;
    let usedCharge = 0;
    let left = false;
    for (
        let tier = firstMend(ships, approach, i, b, design, Infinity);
        tier > -Infinity;
        tier = firstMend(ships, approach, i, b, design, tier)
    ) {
        for (let m = 0; m < design.modules.length; m++) {
            if (priorityOf(approach, mendClaim(design, m)) !== tier || !ships.ownsAt(i, b, m)) continue;
            const absorbed = ships.damage.absorbedAt(b, m);
            if (!(absorbed > 0)) continue;
            const work = repairWork(design.modules[m]!.stats);
            let undo = min(budget / work, charge / (work * REPAIR_ENERGY_PER_JOULE));
            // What it costs in metal rises no faster than the damage undone, so
            // cutting the damage down to the metal there is never asks for more.
            const kg = ships.damage.repairMetal(b, m, undo) * (1 + REPAIR_WASTE);
            if (kg > metal) undo *= metal / kg;
            const cost = ships.damage.repairMetal(b, m, undo) * (1 + REPAIR_WASTE);
            const undone = ships.damage.repair(b, m, undo);
            // Its holes are the first thing plugged.
            if (undone > 0) ships.fuel.seal(b, m);
            budget -= undone * work;
            metal -= cost;
            charge -= undone * work * REPAIR_ENERGY_PER_JOULE;
            usedMetal += cost;
            usedCharge += undone * work * REPAIR_ENERGY_PER_JOULE;
            if (ships.damage.absorbedAt(b, m) > 0) left = true;
        }
    }
    if (!(usedCharge > 0)) return false;
    const mass = bodies.mass[payB]!;
    const inertia = bodies.inertia[payB]!;
    if (usedMetal > 0) ships.metal.drain(payB, from, usedMetal);
    ships.power.drain(payB, from, usedCharge);
    took(ships, Resource.Metal, payB, from, Claim.Pads, usedMetal);
    took(ships, Resource.Charge, payB, from, Claim.Pads, usedCharge);
    shipBreakup.settleMass(ships, bodies, b);
    // Paid for from a carrier, which carries what it mends.
    if (payB !== b) shipBreakup.settleMass(ships, bodies, payB);
    shipBreakup.discardFrom(ships, bodies, payB, mass, inertia);
    return left;
}

/**
 * The highest priority below `below` that mending any of ship `i`'s damaged
 * modules on body `b` has by doctrine `approach`; -Infinity for none.
 */
export function firstMend(ships: Ships, approach: Approach, i: number, b: number, design: ShipDesign, below: number): number {
    let best = -Infinity;
    for (let m = 0; m < design.modules.length; m++) {
        if (!(ships.damage.absorbedAt(b, m) > 0) || !ships.ownsAt(i, b, m)) continue;
        const p = priorityOf(approach, mendClaim(design, m));
        if (p < below && p > best) best = p;
    }
    return best;
}

/** Whether the ship a dock is filling minds danger and has an armed enemy in reach of the pair. */
export function threatenedAt(ships: Ships, bodies: Bodies, b: number, seam: Seam): boolean {
    let receiver: number;
    if (seam.dock === "claw") receiver = ships.pilotAt(b, seam.a);
    else {
        const oa = ships.pilotAt(b, seam.a);
        const ob = ships.pilotAt(b, seam.b);
        receiver = ships.docking[oa] === 1 ? oa : ships.docking[ob] === 1 ? ob : -1;
    }
    if (receiver < 0 || ships.sentTo(receiver)) return false;
    if (threatened(ships, bodies, receiver, b, seam.dock !== "claw")) return true;
    // Holding a wreck, it cannot get out of the way of anything: what can
    // will, but a hulk cannot.
    return seam.dock === "claw" && hulkBearingDown(ships, bodies, receiver, b);
}

/** Whether a hulk will hit body `b` within ship `i`'s look-ahead. */
export function hulkBearingDown(ships: Ships, bodies: Bodies, i: number, b: number): boolean {
    const approach = ships.doctrines[i]!.approach;
    if (!(approach.separation > 0)) return false;
    const mine = bodies.radius[b]!;
    for (let t = 0; t < ships.alive.length; t++) {
        if (ships.alive[t] === 0 || ships.hasControl(t)) continue;
        const ob = bodies.indexOf(ships.bodyIds[t]!);
        if (ob < 0 || ob === b || bodies.ghost[ob] === 1 || !ships.meets(b, ob)) continue;
        const dx = bodies.x[ob]! - bodies.x[b]!;
        const dy = bodies.y[ob]! - bodies.y[b]!;
        const rvx = bodies.vx[ob]! - bodies.vx[b]!;
        const rvy = bodies.vy[ob]! - bodies.vy[b]!;
        const closing = dx * rvx + dy * rvy;
        if (!(closing < 0)) continue;
        const when = -closing / (rvx * rvx + rvy * rvy);
        if (when > approach.avoidHorizon) continue;
        if (length(dx + rvx * when, dy + rvy * when) < mine + bodies.radius[ob]!) return true;
    }
    return false;
}

/** How far ship `i` fights from, metres: its guns' reach, or a ram's run if it has none. */
export function fightReach(ships: Ships, i: number): number {
    const reach = ships.designs[i]!.reach;
    const approach = ships.doctrines[i]!.approach;
    return reach > 0 ? reach : approach.ramRadii > 0 ? approach.approachSpeed * RAM_HORIZON : 0;
}

/**
 * Whether fighter `i`, aboard body `b`, waits: it has no target, or its
 * target is further off than its `sortieRange` times its reach. A fighter
 * with no way to fight never waits.
 */
export function waitsAboard(ships: Ships, bodies: Bodies, i: number, b: number): boolean {
    const reach = ships.landedReach[i]!;
    if (!(reach > 0)) return false;
    const target = ships.chosen[i]!;
    if (target === NO_TARGET) return true;
    const tb = bodies.indexOf(ships.bodyIds[target]!);
    if (tb < 0) return true;
    const apart = length(bodies.x[tb]! - bodies.x[b]!, bodies.y[tb]! - bodies.y[b]!);
    return apart > ships.doctrines[i]!.approach.sortieRange * reach;
}

/**
 * Whether ship `i` minds danger and has an armed enemy within reach of body
 * `at`: by its `scavengeDanger` at a source, by its `dockDanger` at a friend's dock.
 */
export function threatened(ships: Ships, bodies: Bodies, i: number, at: number, dock: boolean): boolean {
    const approach = ships.doctrines[i]!.approach;
    return (dock ? approach.dockDanger : approach.scavengeDanger) > 0 && shipForage.dangerNear(ships, bodies, i, at) > 0;
}

/**
 * The fuel the ship working module `m` of body `b` keeps back from that
 * module's piece of hull for its own engines and weapons, kg: its
 * doctrine's `fuelReserve` of a full load.
 */
export function fuelReserve(ships: Ships, b: number, m: number): number {
    const owner = ships.pilotAt(b, m);
    const kept = owner < 0 ? 0 : ships.doctrines[owner]!.approach.fuelReserve;
    return kept > 0 ? kept * (ships.fuel.pieceHeld(b, m) + ships.fuel.pieceRoom(b, m)) : 0;
}

/** The same for charge, its doctrine's `chargeReserve`. */
export function chargeReserve(ships: Ships, b: number, m: number): number {
    const owner = ships.pilotAt(b, m);
    const kept = owner < 0 ? 0 : ships.doctrines[owner]!.approach.chargeReserve;
    return kept > 0 ? kept * (ships.power.pieceHeld(b, m) + ships.power.pieceRoom(b, m)) : 0;
}

/** The same for metal, its doctrine's `metalReserve`. */
export function metalReserve(ships: Ships, b: number, m: number): number {
    const owner = ships.pilotAt(b, m);
    const kept = owner < 0 ? 0 : ships.doctrines[owner]!.approach.metalReserve;
    return kept > 0 ? kept * (ships.metal.pieceHeld(b, m) + ships.metal.pieceRoom(b, m)) : 0;
}

/** The doctrine of whoever works module `m` of body `b`, or the default for nobody's. */
export function approachAt(ships: Ships, b: number, m: number): Approach {
    const owner = ships.pilotAt(b, m);
    return owner < 0 ? DEFAULT_DOCTRINE.approach : ships.doctrines[owner]!.approach;
}

/**
 * How much `claim` may take of resource `r` now from module `m`'s piece of
 * body `b` (`Supply.allow`), wanting `want` in all. Ask once a step with
 * what it wants, and again with nothing to look again.
 */
export function allowed(ships: Ships, r: Resource, b: number, m: number, claim: Claim, want: number): number {
    const reserve =
        r === Resource.Fuel ? fuelReserve(ships, b, m) : r === Resource.Metal ? metalReserve(ships, b, m) : chargeReserve(ships, b, m);
    return ships.supply.allow(b, r, m, claim, want, reserve, approachAt(ships, b, m), ships.tick);
}

/** Note what `claim` took (`Supply.took`). */
export function took(ships: Ships, r: Resource, b: number, m: number, claim: Claim, amount: number): void {
    ships.supply.took(b, r, m, claim, amount);
}
