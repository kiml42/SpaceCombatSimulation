import type { ShipDesign } from "./blueprint.js";
import { berthGrid, ROBOT_BUILD_TIME, ROBOT_CHARGE, ROBOT_LOAD, ROBOT_REFILL_TIME } from "./modules.js";
import { atan2, cos, floor, length, max, min, sin, sqrt } from "./math.js";
import { doorBetween, legLength, robotShare, RobotMode, type Robot } from "./robots.js";
import type { Ships } from "./ships.js";

/**
 * Where each ship's robots are and what they are doing, as the renderer and the
 * inspector read them: berthed, docked, crewing, and each one's spot on the hull.
 */

/**
 * How full a robot's bar is drawn, 0 to 1: what it is carrying home while it
 * fetches, whether taking wreckage apart or bound for or out on rock, or else
 * what it still has to spend mending.
 */
function robotLoad(robot: Robot): number {
    const fetching = robot.strip || robot.bound >= 0 || robot.away >= 0 || robot.cargo + robot.cargoFuel > 0;
    return (fetching ? robot.cargo + robot.cargoFuel : robot.metal) / ROBOT_LOAD;
}

/** How much of a module's half-length and half-breadth the robots on it stand within, so all are seen on it. */
const ROBOT_SPOT_SHARE = 0.6;

/** How far about where its claw grips a robot of a moored ship stands, as a share of its spot on the claw. */
const ROBOT_GRIP_SPREAD = 0.3;

/**
 * How many robots are home in each module of ship `i`'s hull, by module,
 * into `out`: all nought unless `i` is the ship that flies the body.
 */
export function robotsBerthed(ships: Ships, i: number, out: number[]): void {
    const b = ships.bodyStore === null ? -1 : ships.bodyStore.indexOf(ships.bodyIds[i]!);
    const design = b >= 0 ? ships.hullDesign[b] : null;
    out.length = design?.modules.length ?? 0;
    out.fill(0);
    if (b < 0 || ships.shipByBody[b] !== i) return;
    for (const robot of ships.robots.on(b) ?? []) if (robot.mode === RobotMode.Berthed) out[robot.bay] = (out[robot.bay] ?? 0) + 1;
}

/**
 * Each robot home on ship `i`'s hull, four numbers apiece into `out`: its
 * bay, the share of its charge and of its metal it has, its metal counted
 * up over its refill, or what it brought home counted down as it unloads,
 * so that is seen happening, and its berth there. Nothing unless `i`
 * is the ship that flies the body.
 */
export function robotsDocked(ships: Ships, i: number, out: number[]): void {
    out.length = 0;
    const b = ships.bodyStore === null ? -1 : ships.bodyStore.indexOf(ships.bodyIds[i]!);
    if (b < 0 || ships.shipByBody[b] !== i) return;
    const robots = ships.robots.on(b) ?? [];
    for (let r = 0; r < robots.length; r++) {
        const robot = robots[r]!;
        if (robot.mode !== RobotMode.Berthed) continue;
        // Unloading what it fetched, its bar empties; topping up what it mends with, it fills.
        const left = robot.refill / ROBOT_REFILL_TIME;
        const metal = robot.refill > 0 ? (robot.brought > 0 ? robot.brought * left : 1 - left) : robot.metal / ROBOT_LOAD;
        out.push(robot.bay, robot.charge / ROBOT_CHARGE, metal, berthOf(robots, r));
    }
}

/**
 * For each module of ship `i`'s hull, how many robots it is the bay of,
 * home or out, into `crews`, and how many of those are aboard, holding a
 * berth, into `aboard`; and each robot a bay is building, as its bay and how
 * far it is through, 0 to 1, into `builds`, two numbers apiece, the most
 * nearly finished of a bay first. Nothing unless `i` is the ship that flies the body.
 */
export function robotCrews(ships: Ships, i: number, crews: number[], aboard: number[], builds: number[]): void {
    const b = ships.bodyStore === null ? -1 : ships.bodyStore.indexOf(ships.bodyIds[i]!);
    const design = b >= 0 ? ships.hullDesign[b] : null;
    crews.length = aboard.length = design?.modules.length ?? 0;
    builds.length = 0;
    crews.fill(0);
    aboard.fill(0);
    if (b < 0 || ships.shipByBody[b] !== i) return;
    for (const robot of ships.robots.on(b) ?? []) {
        crews[robot.bay] = (crews[robot.bay] ?? 0) + 1;
        if (robot.away < 0) aboard[robot.bay] = (aboard[robot.bay] ?? 0) + 1;
    }
    const making = ships.robots.buildingOn(b);
    if (making !== null) for (let m = 0; m < making.length; m++) for (const done of making[m]!) builds.push(m, done / ROBOT_BUILD_TIME);
}

/**
 * Each robot out on ship `i`'s hull, `ROBOT_VIEW_STRIDE` numbers apiece into
 * `out`: where it is and which way it faces, in its body's frame, and the
 * share of its charge and of its metal it has left. Nothing unless `i` is
 * the ship that flies the body, so a hull two ships share shows its robots
 * once.
 */
export function robotViews(ships: Ships, i: number, out: number[]): void {
    out.length = 0;
    const b = ships.bodyStore === null ? -1 : ships.bodyStore.indexOf(ships.bodyIds[i]!);
    if (b < 0 || ships.shipByBody[b] !== i) return;
    const robots = ships.robots.on(b) ?? [];
    const design = ships.hullDesign[b];
    const bodies = ships.bodyStore!;
    if (design === null || design === undefined) return;
    ships.placeOwner = i;
    ships.placeHull = b;
    // A rock shows the robots stranded on it, where they stand, dotted over the module as any are.
    const here = ships.strandedHere;
    here.length = 0;
    for (let k = 0; k < ships.stranded.length; k++) {
        const robot = ships.stranded[k]!.robot;
        if (robot.awayDesign === design && bodies.indexOf(ships.bodyIds[robot.away]!) === b) here.push(robot);
    }
    for (let k = 0; k < here.length; k++) {
        const robot = here[k]!;
        const module = design.modules[robot.at]!;
        const heading = robotPlace(ships, design, here, k);
        out.push(
            module.x + ships.robotDx,
            module.y + ships.robotDy,
            heading,
            robot.charge / ROBOT_CHARGE,
            (robot.cargo + robot.cargoFuel) / ROBOT_LOAD,
        );
    }
    for (let r = 0; r < robots.length; r++) {
        const robot = robots[r]!;
        if (robot.mode === RobotMode.Berthed) continue;
        if (robot.away >= 0) {
            awayView(ships, b, robots, r, out);
            continue;
        }
        const here = design.modules[robot.at]!;
        const charge = robot.charge / ROBOT_CHARGE;
        // Taking wreckage apart, it fills with what it carries home.
        const metal = robotLoad(robot);
        const heading = robotPlace(ships, design, robots, r);
        out.push(here.x + ships.robotDx, here.y + ships.robotDy, heading, charge, metal);
    }
}

/**
 * Where robot `r` is drawn from the middle of the module it is on, into
 * `robotDx` and `robotDy`, and which way it faces. Each robot has its own
 * spot on each module (`spotOn`), works there, and crawls straight from its
 * spot on one module to its spot on the next, so it arrives where it works.
 */
export function robotPlace(ships: Ships, design: ShipDesign, robots: Robot[], r: number): number {
    const robot = robots[r]!;
    const here = design.modules[robot.at]!;
    spotFor(ships, design, robot.at, robots, r);
    const fromX = ships.spotX;
    const fromY = ships.spotY;
    const path = robot.path;
    if (path !== null && robot.leg < path.length - 1) {
        const next = path[robot.leg + 1]!;
        const there = design.modules[next]!;
        spotFor(ships, design, next, robots, r);
        const leg = legLength(design, path, robot.leg);
        const t = leg > 0 ? min(1, robot.along / leg) : 0;
        const toX = there.x + ships.spotX - here.x;
        const toY = there.y + ships.spotY - here.y;
        // By where the two meet, so it never crosses a gap between their corners.
        const door = doorBetween(design, robot.at, next);
        const doorX = door === null ? fromX : door[0] - here.x;
        const doorY = door === null ? fromY : door[1] - here.y;
        const first = length(doorX - fromX, doorY - fromY);
        const second = length(toX - doorX, toY - doorY);
        const gone = t * (first + second);
        if (gone < first) {
            const share = first > 0 ? gone / first : 0;
            ships.robotDx = fromX + (doorX - fromX) * share;
            ships.robotDy = fromY + (doorY - fromY) * share;
            // Facing the way it crawls.
            return atan2(doorY - fromY, doorX - fromX);
        }
        const share = second > 0 ? (gone - first) / second : 1;
        ships.robotDx = doorX + (toX - doorX) * share;
        ships.robotDy = doorY + (toY - doorY) * share;
        return atan2(toY - doorY, toX - doorX);
    }
    ships.robotDx = fromX;
    ships.robotDy = fromY;
    // Facing in to the middle of the module it is working on.
    return atan2(-fromY, -fromX);
}

/**
 * Robot `r`'s spot on module `m` of `design`, its own hull's or, out, its
 * rock's, from the module's middle, into `spotX` and `spotY`. Its own bay's
 * is its berth, so it walks home onto its pad. Moored, its claw's is where
 * the claw grips, and the gripped rock's is the same place, so it steps
 * across without moving; elsewhere, its own spot on the module (`spotOn`).
 */
export function spotFor(ships: Ships, design: ShipDesign, m: number, robots: Robot[], r: number): void {
    const robot = robots[r]!;
    const owner = ships.placeOwner;
    const hull = ships.placeHull;
    if (robot.away < 0 && m === robot.bay) {
        berthSpot(ships, design, m, robots, r);
        return;
    }
    const claw = ships.mooredClaw[owner]!;
    const bodies = ships.bodyStore!;
    const cb = claw >= 0 ? ships.carrierBodyOf(bodies, owner) : -1;
    const atClaw = robot.away < 0 && m === claw;
    const atGrip = robot.away >= 0 && robot.away === ships.parkedOn[owner] && m === ships.heldRock(bodies, owner);
    if (cb < 0 || hull < 0 || !(atClaw || atGrip)) {
        spotOn(ships, design, m, robot.tag);
        return;
    }
    // The grip, in the hull's frame, by way of the world, with a little of its own spot on the claw about it.
    const hd = ships.hullDesign[hull]!;
    const rd = ships.hullDesign[cb]!;
    const rc = cos(bodies.angle[cb]!);
    const rs = sin(bodies.angle[cb]!);
    const gx = ships.mooredGripX[owner]! - rd.centreOfMassX;
    const gy = ships.mooredGripY[owner]! - rd.centreOfMassY;
    const wx = bodies.x[cb]! + gx * rc - gy * rs - bodies.x[hull]!;
    const wy = bodies.y[cb]! + gx * rs + gy * rc - bodies.y[hull]!;
    const hc = cos(bodies.angle[hull]!);
    const hs = sin(bodies.angle[hull]!);
    spotOn(ships, hd, claw, robot.tag);
    const px = wx * hc + wy * hs + ROBOT_GRIP_SPREAD * ships.spotX;
    const py = -wx * hs + wy * hc + ROBOT_GRIP_SPREAD * ships.spotY;
    if (atClaw) {
        ships.spotX = px - hd.modules[claw]!.x;
        ships.spotY = py - hd.modules[claw]!.y;
        return;
    }
    // And back out into the rock's frame, as the design it is out on has it.
    const qx = bodies.x[hull]! + px * hc - py * hs - bodies.x[cb]!;
    const qy = bodies.y[hull]! + px * hs + py * hc - bodies.y[cb]!;
    ships.spotX = qx * rc + qy * rs + rd.centreOfMassX - design.centreOfMassX - design.modules[m]!.x;
    ships.spotY = -qx * rs + qy * rc + rd.centreOfMassY - design.centreOfMassY - design.modules[m]!.y;
}

/**
 * Robot `r`'s berth in its bay `m`, from the bay's middle, into `spotX` and
 * `spotY`: the pad of the bay's grid (`berthGrid`) its place among the
 * bay's robots gives it, where it is drawn once home.
 */
export function berthSpot(ships: Ships, design: ShipDesign, m: number, robots: Robot[], r: number): void {
    const spec = design.modules[m]!.spec;
    const { across, down } = berthGrid(spec);
    const slot = berthOf(robots, r);
    const along = -0.5 * spec.length + (spec.length / max(1, across)) * ((slot % max(1, across)) + 0.5);
    const side = -0.5 * spec.width + (spec.width / max(1, down)) * (floor(slot / max(1, across)) + 0.5);
    const angle = spec.angle ?? 0;
    const c = cos(angle);
    const s = sin(angle);
    ships.spotX = along * c - side * s;
    ships.spotY = along * s + side * c;
}

/** Which of its bay's berths robot `r` has: its place among the robots of that bay aboard. */
export function berthOf(robots: Robot[], r: number): number {
    let slot = 0;
    for (let k = 0; k < r; k++) if (robots[k]!.bay === robots[r]!.bay && robots[k]!.away < 0) slot++;
    return slot;
}

/** How many berths of body `b`'s bay `bay` are taken: its robots aboard, not out on a rock, and those it is building. */
export function aboardIn(ships: Ships, b: number, bay: number): number {
    const robots = ships.robots.on(b);
    let aboard = ships.robots.buildingOn(b)?.[bay]?.length ?? 0;
    if (robots !== null) for (let r = 0; r < robots.length; r++) if (robots[r]!.bay === bay && robots[r]!.away < 0) aboard++;
    return aboard;
}

/**
 * Robot `tag`'s spot on module `m`, from its middle, into `spotX` and
 * `spotY`: over the middle of the module, the robots of one body dotted
 * evenly over it, each module laid out its own way.
 */
export function spotOn(ships: Ships, design: ShipDesign, m: number, tag: number): void {
    const spec = design.modules[m]!.spec;
    // A low-discrepancy sequence by tag, so robots numbered together stand apart.
    const u = (tag * 0.7548776662 + robotShare(m, 1)) % 1;
    const v = (tag * 0.5698402911 + robotShare(m, 2)) % 1;
    const corners = spec.vertices;
    if (corners !== undefined) {
        // A shaped module's box is not centred on it: one triangle of the fan
        // from its middle, and a point within it, so the spot is on the matter.
        const n = corners.length / 2;
        const k = floor(u * n);
        const f = u * n - k;
        const reach = ROBOT_SPOT_SHARE * sqrt(v);
        const j = (k + 1) % n;
        const x = reach * ((1 - f) * corners[2 * k]! + f * corners[2 * j]!);
        const y = reach * ((1 - f) * corners[2 * k + 1]! + f * corners[2 * j + 1]!);
        const c = cos(spec.angle ?? 0);
        const s = sin(spec.angle ?? 0);
        ships.spotX = x * c - y * s;
        ships.spotY = x * s + y * c;
        return;
    }
    const along = (2 * u - 1) * ROBOT_SPOT_SHARE * 0.5 * spec.length;
    const across = (2 * v - 1) * ROBOT_SPOT_SHARE * 0.5 * spec.width;
    const angle = spec.angle ?? 0;
    const c = cos(angle);
    const s = sin(angle);
    ships.spotX = along * c - across * s;
    ships.spotY = along * s + across * c;
}

/** `robotViews` for robot `r`, out on its rock, put in the frame of its own ship's body `b`. */
export function awayView(ships: Ships, b: number, robots: Robot[], r: number, out: number[]): void {
    const bodies = ships.bodyStore!;
    const robot = robots[r]!;
    const rock = robot.away;
    const cb = ships.alive[rock] === 1 ? bodies.indexOf(ships.bodyIds[rock]!) : -1;
    const rd = robot.awayDesign;
    const here = rd?.modules[robot.at];
    if (cb < 0 || rd === null || here === undefined) return;
    const heading = robotPlace(ships, rd, robots, r);
    const x = here.x + ships.robotDx;
    const y = here.y + ships.robotDy;
    // From the rock's frame to the world's, and into its own ship's.
    const rc = cos(bodies.angle[cb]!);
    const rs = sin(bodies.angle[cb]!);
    const wx = bodies.x[cb]! + x * rc - y * rs - bodies.x[b]!;
    const wy = bodies.y[cb]! + x * rs + y * rc - bodies.y[b]!;
    const turn = bodies.angle[cb]! - bodies.angle[b]!;
    const c = cos(-bodies.angle[b]!);
    const s = sin(-bodies.angle[b]!);
    const metal = robotLoad(robot);
    out.push(wx * c - wy * s, wx * s + wy * c, heading + turn, robot.charge / ROBOT_CHARGE, metal);
}
