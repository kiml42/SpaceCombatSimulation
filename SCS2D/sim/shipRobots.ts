import { Bodies } from "./bodies.js";
import { originOf, type ShipDesign } from "./blueprint.js";
import { joints } from "./connectivity.js";
import { DAMAGE_ENERGY_PER_KG, DamageEffect, REPAIR_ENERGY_PER_JOULE, REPAIR_WASTE, repairWork, DISASSEMBLY_WASTE } from "./damage.js";
import { buildWork, fittingOf, SHELL_STEPS } from "./rebuild.js";
import { Claim, mendClaim, Resource } from "./supply.js";
import {
    robotsOn,
    ROBOT_BUILD_ENERGY,
    ROBOT_BUILD_TIME,
    berthRate,
    robotsKept,
    ROBOT_CHARGE,
    ROBOT_LOAD,
    ROBOT_MASS,
    ROBOT_REFILL_TIME,
    ROBOT_REPAIR_RATE,
} from "./modules.js";
import { ceil, length, max, min } from "./math.js";
import { crawl, legLength, pathTo, RobotMode, walk, walkTime, type Robot } from "./robots.js";
import type { World } from "./world.js";
import type { Approach } from "./doctrine.js";
import * as shipRobotViews from "./shipRobotViews.js";
import { type Ships, repairTier } from "./ships.js";
import * as shipRebuild from "./shipRebuild.js";
import * as shipSupply from "./shipSupply.js";
import * as shipBreakup from "./shipBreakup.js";
import * as shipForage from "./shipForage.js";

/**
 * Each hull's robots at their work: out from their bays to mend, rebuild or
 * take wreckage apart, out onto a rock to mine it, and home to be refilled.
 */

/** Less metal than this a robot carries, or a hull holds, is rounding rather than metal, kg. */
export const ROBOT_SPENT = 1e-6;

/** The module of its compiled design a hull module is, for what tier rebuilding it falls in. */
export function originTier(approach: Approach, design: ShipDesign, m: number): number {
    const origin = originOf(design, m);
    return repairTier(approach, origin.design, origin.module);
}

/**
 * What a ship is flown and worked on with: cores, robot bays and the
 * generators that charge its robots, which a refit puts up first and takes
 * down last, so as much of the work goes on as can.
 */
export function workforce(kind: string): boolean {
    return kind === "core" || kind === "robotBay" || kind === "generator";
}

/** Robots a bay is building, the most nearly finished first. */
function mostDone(a: number, b: number): number {
    return b - a;
}

/** Seconds of a robot's work short of `ROBOT_BUILD_TIME` that still counts as done, for what rounding leaves. */
const BUILD_SLACK = 1e-9;

/**
 * How much more charge a kilogram of rock takes robots to mine than a
 * kilogram of wreckage to strip: they smelt its ore and melt its ice as they
 * cut it out. A first guess.
 */
export const MINING_POWER = 3;

/**
 * Send every hull's robots about their work: out from their bays to what
 * needs mending most, mending it, and home to be refilled.
 *
 * A robot works only for the ship that works its bay, and only on that
 * ship's modules, but on what it carries: neither a ship with no control
 * nor a bay out of command or broken stops it, only one that cannot refill
 * it once it is spent. It goes
 * for cores first, then engines and weapons, then the rest, the nearest of
 * each, sharing out the work so two do not crowd one module while another
 * waits. Mending costs what it costs on a pad (`mend`): charge from what it
 * carries, and metal drawn from its piece of hull up to what it may spend.
 */
export function tend(ships: Ships, world: World): void {
    ships.tick = world.tick;
    const bodies = world.bodies;
    ships.bodyStore = bodies;
    const dt = world.dt;
    for (let b = 0; b < bodies.highWater; b++) {
        const robots = ships.robots.on(b);
        const design = ships.hullDesign[b];
        if (robots === null || design === null || design === undefined || bodies.alive[b] === 0) continue;
        // What was shed is settled before any of it comes back.
        ships.damage.takeUnsettledAt(b, ships);
        const mass = bodies.mass[b]!;
        const inertia = bodies.inertia[b]!;
        let mended = false;
        for (let r = 0; r < robots.length; r++) {
            const robot = robots[r]!;
            // Out on the rock its ship is moored to, it works there.
            if (robot.away >= 0) {
                const owner = ships.pilotAt(b, robot.bay);
                const kept = tendAway(ships, bodies, b, design, robot, owner, dt);
                if (kept === -2) {
                    ships.robots.lose(b, r--);
                    mended = true;
                    continue;
                }
                // Its ship gone from the rock: left there, for whichever friend comes for it.
                if (kept < 0) {
                    strand(ships, bodies, robot, owner >= 0 ? owner : ships.shipByBody[b]!);
                    ships.robots.lose(b, r--);
                }
                if (kept !== 0) mended = true;
                continue;
            }
            // A module destroyed under a robot takes it with it.
            const on = robotOn(design, robot);
            const left = ships.damage.integrity(b, on);
            if (robot.stoodOn === on && robot.stood > 0 && !(left > 0)) {
                ships.robots.lose(b, r--);
                mended = true;
                continue;
            }
            robot.stoodOn = on;
            robot.stood = left;
            const owner = ships.pilotAt(b, robot.bay);
            if (owner < 0) continue;
            // Home to a bay a refit is about to take down: taken apart, its metal to the holds.
            if (robot.mode === RobotMode.Berthed && shipRebuild.due(ships, owner, b, design, robot.bay)) {
                ships.metal.add(b, robot.bay, ROBOT_MASS + robot.cargo);
                if (robot.cargoFuel > 0) ships.fuel.add(b, robot.bay, robot.cargoFuel);
                ships.robots.lose(b, r--);
                mended = true;
                continue;
            }
            if (tendOne(ships, b, design, robots, robot, owner, dt)) mended = true;
        }
        if (buildRobots(ships, b, design, robots, dt)) mended = true;
        if (mended) {
            shipBreakup.settleMass(ships, bodies, b);
            shipBreakup.discardFrom(ships, bodies, b, mass, inertia);
        }
        shipRebuild.growAll(ships, world);
        const done = ships.stripped[b] ?? -1;
        if (done >= 0) {
            ships.stripped[b] = -1;
            shipRebuild.stepDown(ships, world, b, done);
        }
    }
    tendStranded(ships, bodies);
    // Rock robots from moored ships have taken a step of, which has none of its own.
    while (ships.rockSteps.length > 0) {
        const m = ships.rockSteps.pop()!;
        const rb = ships.rockSteps.pop()!;
        if (bodies.alive[rb] === 1) shipRebuild.stepDown(ships, world, rb, m);
    }
}

/** The module a robot is on: where it stands, or of the two its leg joins, the nearer. */
export function robotOn(design: ShipDesign, robot: Robot): number {
    if (robot.path === null || robot.leg >= robot.path.length - 1) return robot.at;
    return robot.along * 2 < legLength(design, robot.path, robot.leg) ? robot.at : robot.path[robot.leg + 1]!;
}

/**
 * Each of a body's working bays that is short of robots builds them.
 *
 * **Metal to start one, charge to finish it.** A bay starts a robot in each
 * free berth it is short of one for, so long as its piece of hull holds a
 * robot's mass of metal and `REPAIR_WASTE` more to pay for it then: the
 * metal is aboard from the start, as the robot it will be. Each then takes
 * `ROBOT_BUILD_TIME` of a berth's work, slower as the bay is damaged, and
 * `ROBOT_BUILD_ENERGY` of charge from the piece as it goes, so metal sets how
 * many it builds at once and charge how fast. Short of charge, the most
 * nearly finished are built first. Only from what is over what its doctrine
 * keeps for its own engines and weapons (`metalReserve`, `chargeReserve`). Short by `robotsKept`,
 * counting those out on a rock. Says whether one was started or finished.
 */
export function buildRobots(ships: Ships, b: number, design: ShipDesign, robots: Robot[], dt: number): boolean {
    const building = ships.robots.buildingOn(b);
    if (building === null) return false;
    let changed = false;
    const cost = ROBOT_MASS * (1 + REPAIR_WASTE);
    const perSecond = ROBOT_BUILD_ENERGY / ROBOT_BUILD_TIME;
    for (let m = 0; m < design.modules.length; m++) {
        const berths = design.modules[m]!.stats.robots;
        const owner = ships.pilotAt(b, m);
        if (!(berths > 0) || owner < 0) continue;
        // One a refit is taking down builds no more.
        if (ships.refitting[owner] === 1 && shipRebuild.wreckage(ships, owner, b, m)) continue;
        const working = ships.left(owner, b, m, DamageEffect.Tending);
        if (!(working > 0)) continue;
        const making = building[m]!;
        let crew = making.length;
        let aboard = making.length;
        for (let r = 0; r < robots.length; r++) {
            if (robots[r]!.bay !== m) continue;
            crew++;
            if (robots[r]!.away < 0) aboard++;
        }
        const kept = robotsKept(design.modules[m]!.spec, design.modules[m]!.stats, ships.isMoored(owner));
        const missing = min(kept - crew, berths - aboard);
        let metal = missing > 0 ? shipSupply.allowed(ships, Resource.Metal, b, m, Claim.Robots, missing * cost) : 0;
        while (crew < kept && aboard < berths && metal >= cost) {
            ships.metal.drain(b, m, cost);
            shipSupply.took(ships, Resource.Metal, b, m, Claim.Robots, cost);
            metal -= cost;
            ships.robots.start(b, m);
            crew++;
            aboard++;
            changed = true;
        }
        if (making.length === 0) continue;
        making.sort(mostDone);
        const step = dt * working * berthRate(design.modules[m]!.stats);
        let wanted = 0;
        for (let k = 0; k < making.length; k++) wanted += (ROBOT_BUILD_TIME - making[k]!) * perSecond;
        let spare = shipSupply.allowed(ships, Resource.Charge, b, m, Claim.Robots, wanted);
        for (let k = 0; k < making.length; k++) {
            const want = min(step, ROBOT_BUILD_TIME - making[k]!) * perSecond;
            if (!(spare > 0)) break;
            const got = ships.power.drain(b, m, want < spare ? want : spare);
            shipSupply.took(ships, Resource.Charge, b, m, Claim.Robots, got);
            spare -= got;
            making[k] = making[k]! + got / perSecond;
        }
        for (let k = making.length - 1; k >= 0; k--) {
            if (making[k]! < ROBOT_BUILD_TIME - BUILD_SLACK) continue;
            ships.robots.finish(b, m, k);
            changed = true;
        }
    }
    return changed;
}

/** One robot's step. Says whether it mended anything. */
export function tendOne(ships: Ships, b: number, design: ShipDesign, robots: Robot[], robot: Robot, owner: number, dt: number): boolean {
    if (robot.mode === RobotMode.Berthed) {
        // A working bay refills it, and tops its charge up from its piece of
        // hull, reserves and all, each step it waits.
        const working = ships.left(owner, b, robot.bay, DamageEffect.Tending) * berthRate(design.modules[robot.bay]!.stats);
        // What it brought home goes into the holds, as far as they have room.
        let unloaded = false;
        if (robot.cargo + robot.cargoFuel > 0) robot.brought = (robot.cargo + robot.cargoFuel) / ROBOT_LOAD;
        if (robot.cargoFuel > 0) {
            const put = ships.fuel.add(b, robot.bay, robot.cargoFuel);
            robot.cargoFuel = put < robot.cargoFuel ? robot.cargoFuel - put : 0;
            unloaded = put > 0;
            // What the tanks have no room for is let go, not carried out again.
            if (robot.cargoFuel > 0) {
                robot.cargoFuel = 0;
                unloaded = true;
            }
        }
        if (robot.cargo > 0) {
            const put = ships.metal.add(b, robot.bay, robot.cargo);
            robot.cargo = put < robot.cargo ? robot.cargo - put : 0;
            unloaded = unloaded || put > 0;
            // Taking its own hull down for a refit, or clearing a slipway, what the holds have no room for is thrown away.
            if (robot.cargo > 0 && (ships.refitting[owner] === 1 || ships.waitsOnWreck[owner] === 1)) {
                robot.cargo = 0;
                unloaded = true;
            }
        }
        if (working > 0) {
            if (robot.refill > 0) {
                robot.refill -= dt * working;
                if (!(robot.refill > 0)) {
                    robot.refill = 0;
                    robot.metal = ROBOT_LOAD;
                    robot.brought = 0;
                }
            }
            // Charged as it is filled, as fast as there is charge to give over
            // what the ship keeps for its engines and weapons.
            const want = min(ROBOT_CHARGE - robot.charge, (ROBOT_CHARGE / ROBOT_REFILL_TIME) * dt * working);
            const spare = shipSupply.allowed(ships, Resource.Charge, b, robot.bay, Claim.Robots, ROBOT_CHARGE - robot.charge);
            if (want > 0 && spare > 0) {
                const got = ships.power.drain(b, robot.bay, want < spare ? want : spare);
                shipSupply.took(ships, Resource.Charge, b, robot.bay, Claim.Robots, got);
                robot.charge += got;
            }
            // Waits to be full while its piece of hull has the charge to fill it.
            if (robot.refill > 0 || (robot.charge < ROBOT_CHARGE - 1 && spare > want)) return unloaded;
        }
        // It goes on what it carries, whether its bay can still refill it or not.
        if (!(robot.metal > ROBOT_SPENT) || !(robot.charge >= ROBOT_REPAIR_RATE * REPAIR_ENERGY_PER_JOULE * dt)) return unloaded;
        // Nothing has been hit, nor metal come aboard, since it last looked and found nothing to do.
        if (robot.idleAt !== idleKey(ships, b, robot.bay)) {
            sendOut(ships, b, design, robots, robot, owner);
            if (robot.target < 0) robot.idleAt = idleKey(ships, b, robot.bay);
        }
        // Nothing on its own hull: over to the rock its ship is moored to, if it has room for any.
        if (robot.target < 0) sendAcross(ships, b, design, robot, owner);
        return unloaded;
    }
    if (robot.mode === RobotMode.Out || robot.mode === RobotMode.Home) {
        if (robot.path === null) {
            // Come over to a remade hull with nowhere to be, or sent home from its own bay: home.
            route(ships, b, design, robot, owner, robot.bay);
            if (robot.path === null && robot.at !== robot.bay) return false;
            if (robot.path === null) robot.mode = RobotMode.Home;
        }
        const path = robot.path;
        if (path !== null) {
            crawl(design, robot, dt);
            if (robot.leg < path.length - 1) return false;
        }
        robot.path = null;
        robot.leg = 0;
        robot.along = 0;
        if (robot.mode === RobotMode.Home) {
            robot.mode = RobotMode.Berthed;
            robot.refill = ROBOT_REFILL_TIME;
            robot.target = -1;
            robot.strip = false;
        } else {
            robot.mode = RobotMode.Working;
        }
        return false;
    }
    if (robot.bound >= 0) {
        crossOver(ships, b, design, robots, robot, owner);
        return false;
    }
    if (robot.strip) return stripOne(ships, b, design, robots, robot, owner, dt);
    // Working: mending what is hurt before building any more of it.
    const m = robot.target;
    const owned = m >= 0 && ships.ownsAt(owner, b, m);
    const hurt = owned && robot.build < 0 && ships.damage.absorbedAt(b, m) > 0;
    if (owned && !hurt && (robot.build >= 0 || design.modules[m]!.shell !== undefined || ships.damage.unbuiltAt(b, m) > 0)) {
        return buildOne(ships, b, design, robots, robot, owner, dt);
    }
    if (!hurt) {
        sendOut(ships, b, design, robots, robot, owner);
        return false;
    }
    const work = repairWork(design.modules[m]!.stats);
    const step = (ROBOT_REPAIR_RATE * dt) / work;
    let undo = min(step, robot.charge / (work * REPAIR_ENERGY_PER_JOULE));
    // Short of charge for a full step's work: this is its last.
    let short = undo < step;
    const claim = mendClaim(design, m);
    const whole = ships.damage.repairMetal(b, m, ships.damage.absorbedAt(b, m)) * (1 + REPAIR_WASTE);
    const spare = min(robot.metal, shipSupply.allowed(ships, Resource.Metal, b, m, claim, whole));
    const kg = ships.damage.repairMetal(b, m, undo) * (1 + REPAIR_WASTE);
    if (kg > 0 && kg > spare) {
        undo *= spare > 0 ? spare / kg : 0;
        short = true;
    }
    const cost = ships.damage.repairMetal(b, m, undo) * (1 + REPAIR_WASTE);
    const undone = ships.damage.repair(b, m, undo);
    // Its holes are the first thing plugged.
    if (undone > 0) ships.fuel.seal(b, m);
    robot.charge -= undone * work * REPAIR_ENERGY_PER_JOULE;
    robot.metal -= cost;
    if (cost > 0) shipSupply.took(ships, Resource.Metal, b, m, claim, ships.metal.drain(b, m, cost));
    // Out of what this needs, short of finishing it: home for more.
    if (short && ships.damage.absorbedAt(b, m) > 0) sendHome(ships, b, design, robot, owner, m);
    return undone > 0;
}

/**
 * One robot's step building module `robot.target`: putting its fittings in,
 * or for a shell, or a module lost against it (`robot.build`), the walls of
 * the next step, which go up when the step is paid for (`grow`). A
 * kilogram is the work of mending a kilogram's worth of damage, and costs
 * `REPAIR_WASTE` more metal than ends up in the module, off its piece of
 * hull, reserves and all. Says whether it put anything in.
 */
export function buildOne(ships: Ships, b: number, design: ShipDesign, robots: Robot[], robot: Robot, owner: number, dt: number): boolean {
    const m = robot.target;
    const fitting = robot.build < 0 && design.modules[m]!.shell === undefined;
    const rebuild = fitting ? null : shipRebuild.rebuildFor(ships, owner, design);
    const l = rebuild === null ? -1 : robot.build >= 0 ? robot.build : rebuild.at.indexOf(m);
    // Begun for a design it has since been refitted from: nothing to build there now.
    if (rebuild !== null && l < 0) {
        robot.build = -1;
        sendOut(ships, b, design, robots, robot, owner);
        return false;
    }
    const origin = rebuild === null ? null : originOf(ships.launched[owner]!, l);
    const whole = origin === null ? design.modules[m]!.stats : origin.design.modules[origin.module]!.stats;
    const work = buildWork(whole);
    const step = (ROBOT_REPAIR_RATE / work) * dt;
    const charge = work * REPAIR_ENERGY_PER_JOULE;
    const waste = 1 + REPAIR_WASTE;
    let kg = min(step, min(robot.charge / charge, robot.metal / waste));
    let short = kg < step;
    const claim = origin === null ? mendClaim(design, m) : mendClaim(origin.design, origin.module);
    const wanted = rebuild === null ? ships.damage.unbuiltAt(b, m) * waste : (whole.structureMass / SHELL_STEPS) * waste;
    const spare = shipSupply.allowed(ships, Resource.Metal, b, m, claim, wanted);
    let more: boolean;
    let put: number;
    if (rebuild === null) {
        if (kg * waste > spare) {
            kg = spare > 0 ? spare / waste : 0;
            short = true;
        }
        put = ships.damage.fit(b, m, kg);
        if (put > 0) shipSupply.took(ships, Resource.Metal, b, m, claim, ships.metal.drain(b, m, put * waste));
        more = ships.damage.unbuiltAt(b, m) > 0;
    } else {
        const wall = whole.structureMass / SHELL_STEPS;
        // Waiting on a step that is in the way of something: mending comes first, if any has come up since.
        if (rebuild.work[l]! >= wall && robot.idleAt !== idleKey(ships, b, robot.bay)) {
            robot.idleAt = idleKey(ships, b, robot.bay);
            sendOut(ships, b, design, robots, robot, owner);
            return false;
        }
        // Nothing to pay for the step with: no sense starting it.
        if (spare < wall * waste) {
            kg = 0;
            short = true;
        }
        kg = min(kg, wall - rebuild.work[l]!);
        if (kg > 0) rebuild.work[l] = rebuild.work[l]! + kg;
        put = kg > 0 ? kg : 0;
        if (rebuild.work[l]! >= wall) ships.grows.push(owner, l, m, m, -1);
        more = true;
    }
    robot.charge -= put * charge;
    robot.metal -= put * waste;
    // Out of what this needs, short of finishing it: home for more.
    if (short && more) {
        sendHome(ships, b, design, robot, owner, m);
        robot.build = -1;
    }
    return robot.build < 0 && design.modules[m]!.shell === undefined && put > 0;
}

/**
 * Send a robot home from module `m`, short of what its work there needs.
 * If that piece of hull has no metal left to give, it stays berthed until
 * something on the hull changes, rather than going straight back out.
 */
export function sendHome(ships: Ships, b: number, design: ShipDesign, robot: Robot, owner: number, m: number): void {
    route(ships, b, design, robot, owner, robot.bay);
    robot.mode = RobotMode.Home;
    if (!(ships.metal.pieceHeld(b, m) > ROBOT_SPENT)) robot.idleAt = idleKey(ships, b, robot.bay);
}

/**
 * What a robot of body `b`, its bay module `bay`, last looked for work at:
 * the hull's damage as it was, and whether there was metal to mend with.
 * Either changing sends it to look again.
 */
export function idleKey(ships: Ships, b: number, bay: number): number {
    return ships.damage.version(b) * 2 + (ships.metal.pieceHeld(b, bay) > ROBOT_SPENT ? 1 : 0);
}

/**
 * Send a berthed robot of moored ship `owner` to its claw, body `b`, to
 * cross onto the rock and mine it, if the rock has any it has room for.
 */
export function sendAcross(ships: Ships, b: number, design: ShipDesign, robot: Robot, owner: number): boolean {
    const claw = ships.mooredClaw[owner]!;
    if (claw < 0 || ships.bodyStore === null || ships.commanded(owner)) return false;
    const cb = ships.carrierBodyOf(ships.bodyStore, owner);
    if (cb < 0 || !shipForage.strippableAcross(ships, owner, b, robot.bay, cb)) return false;
    route(ships, b, design, robot, owner, claw);
    if (robot.path === null && robot.at !== claw) return false;
    robot.bound = ships.parkedOn[owner]!;
    robot.target = claw;
    robot.strip = false;
    robot.mode = robot.path === null ? RobotMode.Working : RobotMode.Out;
    return true;
}

/** A robot of ship `owner` at its claw, body `b`, stepping onto the rock it is bound for, or home if it has let go. */
export function crossOver(ships: Ships, b: number, design: ShipDesign, robots: Robot[], robot: Robot, owner: number): void {
    const rock = robot.bound;
    robot.bound = -1;
    const bodies = ships.bodyStore!;
    const cb = ships.parkedOn[owner] === rock && ships.mooredClaw[owner]! >= 0 ? ships.carrierBodyOf(bodies, owner) : -1;
    const entry = cb < 0 ? -1 : shipForage.heldRock(ships, bodies, owner);
    if (entry < 0) {
        sendHome(ships, b, design, robot, owner, robot.at);
        return;
    }
    robot.away = rock;
    robot.awayDesign = ships.hullDesign[cb]!;
    robot.at = entry;
    robot.path = null;
    if (!sendOnRock(ships, b, cb, robots, robot, owner)) homeOnRock(ships, cb, robot, owner);
}

/**
 * Give a robot of ship `owner` out on its rock, body `cb`, rock to take
 * apart for what its bay on body `b` has room for: as `sendToStrip` does on
 * a hull, but for the rock its claw holds, which stays to hold it by. It
 * goes where a trip, there and back, brings home the most a second; a wedge
 * of rock is too big for robots to crowd, so fewer there only breaks a tie.
 */
export function sendOnRock(ships: Ships, b: number, cb: number, robots: Robot[], robot: Robot, owner: number): boolean {
    const rd = ships.hullDesign[cb]!;
    const metalRoom = ships.metal.pieceRoom(b, robot.bay) > ROBOT_SPENT;
    const fuelRoom = ships.fuel.pieceRoom(b, robot.bay) > ROBOT_SPENT;
    const room = ROBOT_LOAD - robot.cargo - robot.cargoFuel;
    if (!(metalRoom || fuelRoom) || !(room > ROBOT_SPENT)) return false;
    const held = shipForage.heldRock(ships, ships.bodyStore!, owner);
    const { dist, prev } = walkScratch(ships, rd.modules.length);
    walk(
        rd,
        robot.at,
        dist,
        prev,
        (m) => onRock(ships, cb, m, owner),
        (u, v) => onRock(ships, cb, u, owner) && onRock(ships, cb, v, owner),
    );
    let best = -1;
    let bestRate = -1;
    let bestCrowd = Infinity;
    // Wreckage lodged on the rock is cleared first, whatever the walk: it is in the way of what grips and lands.
    let bestWreck = false;
    for (let m = 0; m < rd.modules.length; m++) {
        if (m === held || !Number.isFinite(dist[m]!) || !onRock(ships, cb, m, owner) || !shipRebuild.comesOff(ships, owner, cb, rd, m))
            continue;
        if (!shipRebuild.minable(rd, m, metalRoom, fuelRoom)) continue;
        // What it would bring home, as `mineRock` takes it, and the time it would take.
        const spec = rd.modules[m]!.spec;
        const rock = spec.kind === "rock";
        // Wreckage lodged on it is all metal.
        const ore = rock ? (spec.ore ?? 0) : 1;
        const kept = ((metalRoom ? ore : 0) + (rock && fuelRoom ? (spec.ice ?? 0) : 0)) * (1 - DISASSEMBLY_WASTE);
        const step = shipRebuild.stripStep(ships, cb, rd, m);
        const work = buildWork(step.stats);
        let kg = robot.charge / (work * REPAIR_ENERGY_PER_JOULE * MINING_POWER);
        if (kept > 0) kg = min(kg, room / kept);
        const time = 2 * walkTime(rd, prev, m, robot.tag) + (kg * work) / ROBOT_REPAIR_RATE;
        const rate = time > 0 ? (kg * kept) / time : 0;
        let crowd = 0;
        for (let k = 0; k < robots.length; k++)
            if (robots[k] !== robot && robots[k]!.away === robot.away && robots[k]!.target === m) crowd++;
        // Wreckage comes first only while it wants more hands than it has: as
        // many loads as there is left of it, and one at least.
        const left = (step.kg - ships.damage.unbuiltAt(cb, m)) * (kept > 0 ? kept : 1);
        const wreck = rd.modules[m]!.spec.kind !== "rock" && crowd < max(1, ceil(left / ROBOT_LOAD));
        if (wreck !== bestWreck ? wreck : rate > bestRate || (rate === bestRate && crowd < bestCrowd)) {
            best = m;
            bestRate = rate;
            bestCrowd = crowd;
            bestWreck = wreck;
        }
    }
    if (best < 0) return false;
    robot.target = best;
    robot.strip = true;
    robot.path = pathTo(prev, dist, best);
    robot.leg = 0;
    robot.along = 0;
    robot.mode = robot.path !== null && robot.path.length > 1 ? RobotMode.Out : RobotMode.Working;
    if (robot.mode === RobotMode.Working) robot.path = null;
    return true;
}

/** Set a robot of ship `owner` out on its rock, body `cb`, walking back to where its claw grips. */
export function homeOnRock(ships: Ships, cb: number, robot: Robot, owner: number): void {
    const rd = ships.hullDesign[cb]!;
    const entry = shipForage.heldRock(ships, ships.bodyStore!, owner);
    robot.mode = RobotMode.Home;
    robot.target = -1;
    robot.strip = false;
    robot.leg = 0;
    robot.along = 0;
    robot.path = null;
    if (entry < 0 || robot.at === entry) return;
    const { dist, prev } = walkScratch(ships, rd.modules.length);
    walk(
        rd,
        robot.at,
        dist,
        prev,
        (m) => onRock(ships, cb, m, owner),
        (u, v) => onRock(ships, cb, u, owner) && onRock(ships, cb, v, owner),
    );
    const path = pathTo(prev, dist, entry);
    robot.path = path !== null && path.length > 1 ? path : null;
}

/**
 * One step of a robot of ship `owner` out on the rock it is moored to, its
 * bay on body `b`: walking, mining, and back across to its claw. Says 1 if
 * it mined, -1 if it was lost, with its ship no longer moored there, -2 if
 * it was taken apart, with no berth to come home to, and 0 otherwise.
 */
export function tendAway(ships: Ships, bodies: Bodies, b: number, design: ShipDesign, robot: Robot, owner: number, dt: number): number {
    const rock = robot.away;
    if (owner < 0 || ships.parkedOn[owner] !== rock || !(ships.mooredClaw[owner]! >= 0)) return -1;
    const cb = ships.carrierBodyOf(bodies, owner);
    const rd = cb < 0 ? null : ships.hullDesign[cb];
    if (rd === null || rd === undefined) return -1;
    // The rock has changed under it: on the nearest of what is left, and about its work afresh.
    if (rd !== robot.awayDesign) {
        remapOnRock(robot, rd);
        robot.path = null;
        robot.leg = 0;
        robot.along = 0;
        if (robot.mode !== RobotMode.Home) {
            robot.mode = RobotMode.Out;
            robot.target = -1;
        }
    }
    if (robot.mode === RobotMode.Out || robot.mode === RobotMode.Home) {
        if (robot.path === null) {
            if (robot.mode === RobotMode.Out && robot.target < 0) {
                if (!sendOnRock(ships, b, cb, ships.robots.on(b)!, robot, owner)) homeOnRock(ships, cb, robot, owner);
                return 0;
            }
            if (robot.mode === RobotMode.Home && robot.at !== shipForage.heldRock(ships, bodies, owner)) {
                homeOnRock(ships, cb, robot, owner);
                if (robot.path === null) return 0;
            }
        }
        const path = robot.path;
        if (path !== null) {
            crawl(rd, robot, dt);
            if (robot.leg < path.length - 1) return 0;
        }
        robot.path = null;
        robot.leg = 0;
        robot.along = 0;
        if (robot.mode === RobotMode.Out) {
            robot.mode = RobotMode.Working;
            return 0;
        }
        // Back where its claw grips: across onto its own hull and home, once
        // its bay has a berth for it; the extra a moored bay keeps wait here,
        // and are taken apart into the holds once their ship is sent away.
        if (shipRobotViews.aboardIn(ships, b, robot.bay) >= design.modules[robot.bay]!.stats.robots) {
            if (!ships.sentAway(owner)) return 0;
            ships.metal.add(b, robot.bay, ROBOT_MASS + robot.cargo);
            if (robot.cargoFuel > 0) ships.fuel.add(b, robot.bay, robot.cargoFuel);
            return -2;
        }
        robot.away = -1;
        robot.awayDesign = null;
        robot.at = ships.mooredClaw[owner]!;
        route(ships, b, design, robot, owner, robot.bay);
        return 0;
    }
    return mineRock(ships, b, cb, rd, robot, owner, dt) ? 1 : 0;
}

/**
 * Put a robot out on a rock whose design has changed under it, as mining
 * does, on the nearest module of the new design to where it stood.
 */
export function remapOnRock(robot: Robot, rd: ShipDesign): void {
    const was = robot.awayDesign!.modules[robot.at];
    robot.at = nearestModule(
        rd,
        (was?.x ?? 0) + robot.awayDesign!.centreOfMassX - rd.centreOfMassX,
        (was?.y ?? 0) + robot.awayDesign!.centreOfMassY - rd.centreOfMassY,
    );
    robot.awayDesign = rd;
}

/** The module of `design` nearest body-frame point `x`, `y`. */
export function nearestModule(design: ShipDesign, x: number, y: number): number {
    let near = 0;
    let gap = Infinity;
    for (let m = 0; m < design.modules.length; m++) {
        const d = length(design.modules[m]!.x - x, design.modules[m]!.y - y);
        if (d < gap) {
            gap = d;
            near = m;
        }
    }
    return near;
}

/**
 * Leave a robot of ship `owner` where it is on the rock it is out on, its
 * ship no longer moored there: still carrying what it had mined, waiting
 * for a friend to moor there with a berth for it. Lost if the rock is.
 */
export function strand(ships: Ships, bodies: Bodies, robot: Robot, owner: number): void {
    const rock = robot.away;
    if (rock < 0 || ships.alive[rock] === 0 || bodies.indexOf(ships.bodyIds[rock]!) < 0 || owner < 0) return;
    robot.mode = RobotMode.Home;
    robot.target = -1;
    robot.strip = false;
    robot.bound = -1;
    robot.path = null;
    robot.leg = 0;
    robot.along = 0;
    ships.stranded.push({ robot, team: ships.team[owner]!, home: owner });
}

/**
 * Each robot stranded on a rock, waiting where it is, or taken aboard by a
 * ship of its side moored to that rock with a berth for it: the ship that
 * left it before any other. It then walks to that ship's claw and goes home
 * to its new bay with what it carries. One whose rock is gone is lost.
 */
export function tendStranded(ships: Ships, bodies: Bodies): void {
    for (let k = ships.stranded.length - 1; k >= 0; k--) {
        const { robot, team, home } = ships.stranded[k]!;
        const rock = robot.away;
        const cb = ships.alive[rock] === 1 ? bodies.indexOf(ships.bodyIds[rock]!) : -1;
        const rd = cb < 0 ? null : ships.hullDesign[cb];
        if (rd === null || rd === undefined) {
            ships.stranded.splice(k, 1);
            continue;
        }
        if (rd !== robot.awayDesign) remapOnRock(robot, rd);
        let taker = -1;
        let bay = -1;
        for (let p = 0; p < ships.parkedShips.length && taker !== home; p++) {
            const f = ships.parkedShips[p]!;
            if (ships.mooredClaw[f]! < 0 || ships.team[f] !== team || !ships.hasControl(f) || ships.carrierBodyOf(bodies, f) !== cb)
                continue;
            const berth = freeBerth(ships, bodies, f);
            if (berth < 0) continue;
            if (taker < 0 || f === home) {
                taker = f;
                bay = berth;
            }
        }
        if (taker < 0) continue;
        const fb = bodies.indexOf(ships.bodyIds[taker]!);
        ships.stranded.splice(k, 1);
        robot.bay = bay;
        robot.away = ships.parkedOn[taker]!;
        ships.robots.adopt(fb, robot);
        makeRoomFor(ships, fb, taker, bay);
        homeOnRock(ships, cb, robot, taker);
    }
}

/**
 * Bay `bay` of ship `f`, on body `fb`, having taken a robot aboard: if that
 * and those it is building are more than it keeps, it stops building the
 * least finished, and the metal goes back into its piece of hull.
 */
export function makeRoomFor(ships: Ships, fb: number, f: number, bay: number): void {
    const design = ships.hullDesign[fb];
    const robots = ships.robots.on(fb);
    if (design === null || design === undefined || robots === null) return;
    let crew = ships.robots.buildingOn(fb)?.[bay]?.length ?? 0;
    for (let r = 0; r < robots.length; r++) if (robots[r]!.bay === bay) crew++;
    if (crew > robotsKept(design.modules[bay]!.spec, design.modules[bay]!.stats, ships.isMoored(f)) && ships.robots.cancel(fb, bay)) {
        ships.metal.add(fb, bay, ROBOT_MASS);
    }
}

/** A robot bay of ship `f`'s short of the robots it keeps (`robotsKept`), or -1. */
export function freeBerth(ships: Ships, bodies: Bodies, f: number): number {
    const fb = bodies.indexOf(ships.bodyIds[f]!);
    const design = fb < 0 ? null : ships.hullDesign[fb];
    const robots = ships.robots.on(fb);
    if (design === null || design === undefined || robots === null) return -1;
    for (let m = 0; m < design.modules.length; m++) {
        const berths = design.modules[m]!.stats.robots;
        if (!(berths > 0) || ships.pilotAt(fb, m) !== f) continue;
        // Not counting those it is building: one it takes aboard takes the place of one of them.
        let crew = 0;
        for (let r = 0; r < robots.length; r++) if (robots[r]!.bay === m) crew++;
        if (crew < robotsKept(design.modules[m]!.spec, design.modules[m]!.stats, ships.isMoored(f))) return m;
    }
    return -1;
}

/** How many robots are stranded on asteroid `rock`, by its ship. */
export function strandedOn(ships: Ships, rock: number): number {
    let count = 0;
    for (const { robot } of ships.stranded) if (robot.away === rock) count++;
    return count;
}

/**
 * One step of a robot out on its rock, body `cb`, taking module
 * `robot.target` apart as `stripOne` does wreckage: ore smelted and ice
 * melted into what it carries, for its charge, until it is full or short
 * of charge, when it walks back. Says whether it took any.
 */
export function mineRock(ships: Ships, b: number, cb: number, rd: ShipDesign, robot: Robot, owner: number, dt: number): boolean {
    const m = robot.target;
    if (
        m < 0 ||
        m >= rd.modules.length ||
        m === shipForage.heldRock(ships, ships.bodyStore!, owner) ||
        !onRock(ships, cb, m, owner) ||
        !shipRebuild.comesOff(ships, owner, cb, rd, m)
    ) {
        if (!sendOnRock(ships, b, cb, ships.robots.on(b)!, robot, owner)) homeOnRock(ships, cb, robot, owner);
        return false;
    }
    const room = ROBOT_LOAD - robot.cargo - robot.cargoFuel;
    if (!(room > ROBOT_SPENT)) {
        homeOnRock(ships, cb, robot, owner);
        return false;
    }
    const spec = rd.modules[m]!.spec;
    // Wreckage lodged on it is all metal.
    const ore = spec.kind === "rock" ? (spec.ore ?? 0) : 1;
    // Its ice is kept only while its bay's tanks have room for it.
    const ice = spec.kind === "rock" && ships.fuel.pieceRoom(b, robot.bay) > ROBOT_SPENT ? (spec.ice ?? 0) : 0;
    const step = shipRebuild.stripStep(ships, cb, rd, m);
    const work = buildWork(step.stats);
    const per = work * REPAIR_ENERGY_PER_JOULE * MINING_POWER;
    const done = ships.damage.unbuiltAt(cb, m);
    let kg = min((ROBOT_REPAIR_RATE / work) * dt, robot.charge / per);
    const short = kg < (ROBOT_REPAIR_RATE / work) * dt;
    const yieldPerKg = (ore + ice) * (1 - DISASSEMBLY_WASTE);
    kg = min(kg, yieldPerKg > 0 ? room / yieldPerKg : Infinity, step.kg - done);
    if (kg > 0) {
        ships.damage.unfit(cb, m, kg);
        robot.charge -= kg * per;
        robot.cargo += kg * ore * (1 - DISASSEMBLY_WASTE);
        robot.cargoFuel += kg * ice * (1 - DISASSEMBLY_WASTE);
        shipBreakup.settleMass(ships, ships.bodyStore!, cb);
    }
    if (done + (kg > 0 ? kg : 0) >= step.kg - ROBOT_SPENT && !rockStepped(ships, cb)) ships.rockSteps.push(cb, m);
    if (short || !(ROBOT_LOAD - robot.cargo - robot.cargoFuel > ROBOT_SPENT)) homeOnRock(ships, cb, robot, owner);
    return kg > 0;
}

/**
 * Whether module `m` of rock body `cb` is one a moored ship's robots may
 * walk and mine: the asteroid's, or wreckage lodged on it.
 */
export function onRock(ships: Ships, cb: number, m: number, owner: number): boolean {
    const p = ships.pilotAt(cb, m);
    if (p < 0 || ships.isAsteroid(p) || ships.derelict[p] === 1 || !ships.hasControl(p)) return true;
    // A ship lodged there still flown: an enemy's to take, a friend's once it can do nothing.
    return p !== owner && (ships.hostile(owner, p) || ships.isMissionKilled(p));
}

/** Whether a step of rock body `cb` is already due to come down this step. */
export function rockStepped(ships: Ships, cb: number): boolean {
    for (let k = 0; k < ships.rockSteps.length; k += 2) if (ships.rockSteps[k] === cb) return true;
    return false;
}

/** Whether any robot of ship `f`'s, on body `b`, is out on its rock or on its way there. */
export function anyAway(ships: Ships, b: number, f: number): boolean {
    for (const robot of ships.robots.on(b) ?? [])
        if (ships.pilotAt(b, robot.bay) === f && (robot.away >= 0 || robot.bound >= 0)) return true;
    return false;
}

/** Call ship `f`'s robots on body `b` in off its rock, body `cb`: those out there walk back, those on their way turn round. */
export function recallAway(ships: Ships, b: number, design: ShipDesign, f: number, cb: number): void {
    for (const robot of ships.robots.on(b) ?? []) {
        if (ships.pilotAt(b, robot.bay) !== f) continue;
        if (robot.bound >= 0) {
            robot.bound = -1;
            sendHome(ships, b, design, robot, f, robot.at);
        } else if (robot.away >= 0 && robot.mode !== RobotMode.Home) {
            homeOnRock(ships, cb, robot, f);
        }
    }
}

/**
 * Give a robot something of its ship's launch design to rebuild, once there
 * is nothing to mend: the fittings of a module whose walls are up, the
 * walls of a shell, or a module lost, against a module of its hull that is
 * whole. The first tier with anything in it, of that what fewest robots are
 * after, the nearest of those. Says whether it found anything.
 */
export function sendToBuild(
    ships: Ships,
    b: number,
    design: ShipDesign,
    robots: Robot[],
    robot: Robot,
    owner: number,
    dist: Float64Array,
): boolean {
    const launch = ships.launched[owner];
    if (launch === undefined) return false;
    const rebuild = shipRebuild.rebuildFor(ships, owner, design);
    const crowdOf = (m: number, l: number): number => {
        let crowd = 0;
        for (let k = 0; k < robots.length; k++) {
            const other = robots[k]!;
            if (other !== robot && other.target === m && other.build === l) crowd++;
        }
        return crowd;
    };
    let best = -1;
    let bestBuild = -1;
    let bestTier = Infinity;
    const approach = ships.doctrines[owner]!.approach;
    let bestCrowd = Infinity;
    let bestDist = Infinity;
    // Refitted, what flies and works on the ship goes up first, to get more of the work going sooner.
    const refit = ships.refitting[owner] === 1;
    const consider = (m: number, l: number, kept: number): void => {
        const kind = l >= 0 ? launch.modules[l]!.spec.kind : originOf(design, m).design.modules[originOf(design, m).module]!.spec.kind;
        const tier = refit && workforce(kind) ? -Infinity : kept;
        const crowd = crowdOf(m, l);
        if (tier < bestTier || (tier === bestTier && (crowd < bestCrowd || (crowd === bestCrowd && dist[m]! < bestDist)))) {
            best = m;
            bestBuild = l;
            bestTier = tier;
            bestCrowd = crowd;
            bestDist = dist[m]!;
        }
    };
    for (let m = 0; m < design.modules.length; m++) {
        if (!Number.isFinite(dist[m]!) || !ships.ownsAt(owner, b, m) || shipRebuild.wreckage(ships, owner, b, m)) continue;
        // Building takes metal: a trip's worth not to be had, nothing to build with.
        if (!affords(ships, b, m, design, m, robot)) continue;
        if (design.modules[m]!.shell !== undefined || ships.damage.unbuiltAt(b, m) > 0) consider(m, -1, originTier(approach, design, m));
    }
    if (rebuild.frame >= 0) {
        const compiled = originOf(design, rebuild.frame).design;
        for (const joint of joints(launch)) {
            if (joint.seam === true) continue;
            for (const [l, against] of [
                [joint.a, joint.b],
                [joint.b, joint.a],
            ] as const) {
                const m = rebuild.at[against]!;
                if (rebuild.at[l]! >= 0 || m < 0 || !Number.isFinite(dist[m]!) || !ships.ownsAt(owner, b, m)) continue;
                if (shipRebuild.wreckage(ships, owner, b, m) || !affords(ships, b, m, launch, l, robot)) continue;
                if (design.modules[m]!.shell !== undefined || originOf(design, m).design !== compiled) continue;
                // Refitted, what is in the way comes down before this goes up.
                if (ships.refitting[owner] === 1 && shipRebuild.inTheWay(design, rebuild, launch, l)) continue;
                consider(m, l, repairTier(approach, launch, l));
            }
        }
    }
    if (best < 0) return false;
    robot.target = best;
    robot.build = bestBuild;
    return true;
}

/**
 * Whether module `m` of body `b`'s piece of hull can give robot `robot` the
 * metal for a trip's work on part `part` of `of`: what that work's claim may
 * take there (`allowed`), against what the robot can spend, or `needs` if
 * the work wants less. A robot short of it goes mining instead.
 */
export function affords(ships: Ships, b: number, m: number, of: ShipDesign, part: number, robot: Robot, needs = Infinity): boolean {
    const trip = min(robot.metal, needs);
    if (!(trip > ROBOT_SPENT)) return true;
    return shipSupply.allowed(ships, Resource.Metal, b, m, mendClaim(of, part), 0) >= trip;
}

/**
 * Give a robot the next module to mend, from where it is: the first tier
 * with anything in it, and of that the module fewest robots are already
 * after, the nearest of those. With nothing to mend, something to rebuild
 * (`sendToBuild`). Home when there is nothing.
 */
export function sendOut(ships: Ships, b: number, design: ShipDesign, robots: Robot[], robot: Robot, owner: number): void {
    const n = design.modules.length;
    const { dist, prev } = walkScratch(ships, n);
    walkFrom(ships, b, design, robot, owner, dist, prev);
    let best = -1;
    let bestTier = Infinity;
    let bestCrowd = Infinity;
    let bestDist = Infinity;
    const approach = ships.doctrines[owner]!.approach;
    for (let m = 0; m < n; m++) {
        if (!Number.isFinite(dist[m]!) || !(ships.damage.absorbedAt(b, m) > 0) || !ships.ownsAt(owner, b, m)) continue;
        if (shipRebuild.wreckage(ships, owner, b, m)) continue;
        // Nothing to mend it with: no sense walking there.
        const mendMetal = ships.damage.repairMetal(b, m, ships.damage.absorbedAt(b, m)) * (1 + REPAIR_WASTE);
        if (mendMetal > ROBOT_SPENT && !affords(ships, b, m, design, m, robot, mendMetal)) continue;
        const tier = repairTier(approach, design, m);
        let crowd = 0;
        for (let k = 0; k < robots.length; k++) if (robots[k] !== robot && robots[k]!.target === m) crowd++;
        // No more on it than it has room for: the rest mend something else, or go mining.
        if (crowd >= robotsOn(design.modules[m]!.spec)) continue;
        if (tier < bestTier || (tier === bestTier && (crowd < bestCrowd || (crowd === bestCrowd && dist[m]! < bestDist)))) {
            best = m;
            bestTier = tier;
            bestCrowd = crowd;
            bestDist = dist[m]!;
        }
    }
    robot.build = -1;
    robot.strip = false;
    if (best < 0 && sendToBuild(ships, b, design, robots, robot, owner, dist)) best = robot.target;
    if (best < 0 && sendToStrip(ships, b, design, robots, robot, owner, dist)) best = robot.target;
    if (best < 0) {
        robot.target = -1;
        if (robot.mode !== RobotMode.Berthed) {
            route(ships, b, design, robot, owner, robot.bay);
            robot.mode = robot.at === robot.bay ? RobotMode.Berthed : RobotMode.Home;
        }
        return;
    }
    robot.target = best;
    robot.path = pathTo(prev, dist, best);
    robot.leg = 0;
    robot.along = 0;
    robot.mode = robot.path !== null && robot.path.length > 1 ? RobotMode.Out : RobotMode.Working;
    if (robot.mode === RobotMode.Working) robot.path = null;
}

/** Set a robot walking from where it is to module `to`, over its owner's modules; no path if it cannot. */
export function route(ships: Ships, b: number, design: ShipDesign, robot: Robot, owner: number, to: number): void {
    robot.leg = 0;
    robot.along = 0;
    if (robot.at === to) {
        robot.path = null;
        return;
    }
    const { dist, prev } = walkScratch(ships, design.modules.length);
    walkFrom(ships, b, design, robot, owner, dist, prev);
    const path = pathTo(prev, dist, to);
    robot.path = path !== null && path.length > 1 ? path : null;
}

/**
 * Distances from where a robot of ship `owner` stands to every module it may
 * go to: over its own hull's welds, and across a seam onto wreckage and over
 * that, but never onto a ship still in the fight. A ship its slipways are
 * building it may cross, to reach wreckage caught on it.
 */
export function walkFrom(
    ships: Ships,
    b: number,
    design: ShipDesign,
    robot: Robot,
    owner: number,
    dist: Float64Array,
    prev: Int32Array,
): void {
    const over = (m: number): boolean => shipRebuild.wreckage(ships, owner, b, m) || shipRebuild.buildingFor(ships, owner, b, m);
    walk(
        design,
        robot.at,
        dist,
        prev,
        (m) => ships.ownsAt(owner, b, m) || over(m),
        (u, v) => over(u) || over(v),
    );
}

/**
 * Give a robot wreckage to take apart, once there is nothing to mend or
 * build and its bay's holds have room for what it brings home: a module
 * whose going leaves the rest held on, so a wreck comes off from its far
 * end inwards and never drifts free. Fewest robots already at it first, the
 * nearest of those. Says whether it found any.
 */
export function sendToStrip(
    ships: Ships,
    b: number,
    design: ShipDesign,
    robots: Robot[],
    robot: Robot,
    owner: number,
    dist: Float64Array,
): boolean {
    const metalRoom = ships.metal.pieceRoom(b, robot.bay) > ROBOT_SPENT || ships.refitting[owner] === 1 || ships.waitsOnWreck[owner] === 1;
    const fuelRoom = ships.fuel.pieceRoom(b, robot.bay) > ROBOT_SPENT;
    if (!(metalRoom || fuelRoom) || !(robot.cargo + robot.cargoFuel < ROBOT_LOAD - ROBOT_SPENT)) return false;
    let best = -1;
    let bestCrowd = Infinity;
    let bestDist = Infinity;
    for (let m = 0; m < design.modules.length; m++) {
        if (!Number.isFinite(dist[m]!) || !shipRebuild.wreckage(ships, owner, b, m) || !shipRebuild.comesOff(ships, owner, b, design, m))
            continue;
        // Rock is worth taking only for what the bay has room for of what it holds.
        if (!shipRebuild.minable(design, m, metalRoom, fuelRoom)) continue;
        // Its own hull's cores, bays and generators come down last of all, and only when due.
        if (shipRebuild.ownWorkforce(ships, owner, b, design, m) && !shipRebuild.due(ships, owner, b, design, m)) continue;
        // A bay comes down once its robots are home and taken apart; its own go home for that.
        if (design.modules[m]!.spec.kind === "robotBay" && shipRebuild.ownWorkforce(ships, owner, b, design, m)) {
            if (robot.bay === m) {
                sendHome(ships, b, design, robot, owner, m);
                return true;
            }
            if (robots.some((other) => other.bay === m)) continue;
        }
        let crowd = 0;
        for (let k = 0; k < robots.length; k++) if (robots[k] !== robot && robots[k]!.target === m) crowd++;
        if (crowd < bestCrowd || (crowd === bestCrowd && dist[m]! < bestDist)) {
            best = m;
            bestCrowd = crowd;
            bestDist = dist[m]!;
        }
    }
    if (best < 0) return false;
    robot.target = best;
    robot.strip = true;
    return true;
}

/**
 * One robot's step taking wreckage apart, which is building run backwards:
 * any metal the wreck holds first, as it is, then its fittings out and its
 * walls down a step at a time (`stepDown`), a kilogram the work it took to
 * build, paid for in charge. What comes off goes into the robot, less
 * `DISASSEMBLY_WASTE`, and once it is full, or short of charge, it takes it
 * home to its bay's holds.
 */
export function stripOne(ships: Ships, b: number, design: ShipDesign, robots: Robot[], robot: Robot, owner: number, dt: number): boolean {
    const m = robot.target;
    if (
        m < 0 ||
        m >= design.modules.length ||
        !shipRebuild.wreckage(ships, owner, b, m) ||
        !shipRebuild.comesOff(ships, owner, b, design, m)
    ) {
        sendOut(ships, b, design, robots, robot, owner);
        return false;
    }
    const room = ROBOT_LOAD - robot.cargo - robot.cargoFuel;
    if (!(room > ROBOT_SPENT)) {
        sendHome(ships, b, design, robot, owner, robot.bay);
        return false;
    }
    const lift = (ROBOT_REPAIR_RATE / DAMAGE_ENERGY_PER_KG) * dt;
    // On its own piece of hull, what the module holds is its ship's: poured
    // into the rest of its stores before any of it comes down, and the rest
    // of the piece's metal left where it is.
    const own = (design.pieces?.[m] ?? 0) === (design.pieces === undefined ? 0 : shipRebuild.ownPiece(ships, owner, b));
    if (own && ships.fuel.spill(b, m) + ships.metal.spill(b, m) + ships.power.spill(b, m) > 0) return true;
    const loose = own ? 0 : ships.metal.pieceHeld(b, m);
    if (loose > ROBOT_SPENT) {
        robot.cargo += ships.metal.drain(b, m, min(lift, room));
        return true;
    }
    const step = shipRebuild.stripStep(ships, b, design, m);
    // Refitted in place, only its fittings come out.
    if (shipRebuild.swapFor(ships, owner, b, design, m) >= 0)
        step.kg = fittingOf(step.stats) * (1 - ships.damage.shedAt(b, m) / (step.stats.structureMass + step.stats.fittingMass));
    const work = buildWork(step.stats);
    // Rock is mined, not unbuilt: its ore smelted to metal and its ice melted
    // to fuel as it comes off, for more charge, and the rest of it lost.
    const spec = design.modules[m]!.spec;
    const rock = spec.kind === "rock";
    const ore = rock ? (spec.ore ?? 0) : 1;
    const ice = rock && ships.fuel.pieceRoom(b, robot.bay) > ROBOT_SPENT ? (spec.ice ?? 0) : 0;
    const per = work * REPAIR_ENERGY_PER_JOULE * (rock ? MINING_POWER : 1);
    const done = ships.damage.unbuiltAt(b, m);
    let kg = min((ROBOT_REPAIR_RATE / work) * dt, robot.charge / per);
    // Short of charge for a full step's work: this is its last.
    const short = kg < (ROBOT_REPAIR_RATE / work) * dt;
    const yieldPerKg = (ore + ice) * (1 - DISASSEMBLY_WASTE);
    kg = min(kg, yieldPerKg > 0 ? room / yieldPerKg : Infinity, step.kg - done);
    if (kg > 0) {
        ships.damage.unfit(b, m, kg);
        robot.charge -= kg * per;
        robot.cargo += kg * ore * (1 - DISASSEMBLY_WASTE);
        robot.cargoFuel += kg * ice * (1 - DISASSEMBLY_WASTE);
    }
    if (done + (kg > 0 ? kg : 0) >= step.kg - ROBOT_SPENT) ships.stripped[b] = m;
    if (short || !(ROBOT_LOAD - robot.cargo - robot.cargoFuel > ROBOT_SPENT)) sendHome(ships, b, design, robot, owner, robot.bay);
    return kg > 0;
}

export function walkScratch(ships: Ships, n: number): { dist: Float64Array; prev: Int32Array } {
    if (ships.walkDist.length < n) {
        ships.walkDist = new Float64Array(n);
        ships.walkPrev = new Int32Array(n);
    }
    return { dist: ships.walkDist, prev: ships.walkPrev };
}
