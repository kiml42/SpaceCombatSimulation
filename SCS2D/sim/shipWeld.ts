import { Bodies } from "./bodies.js";
import { weldDesigns, type DesignModule, type ShipDesign, type DockAt } from "./blueprint.js";
import { DamageEffect, DISASSEMBLY_WASTE } from "./damage.js";
import { isHullMount, moduleCentre, weldBox } from "./modules.js";
import { abs, cos, max, min, sin } from "./math.js";
import type { World } from "./world.js";
import { type Contacts, CLAW_ALIGN, Stab } from "./collision.js";
import { CLAW_SPEED_MAX } from "./shipClaw.js";
import * as shipRebuild from "./shipRebuild.js";
import {
    type Ships,
    WELD_SETTLE,
    REST_SPEED,
    REST_TIME,
    PORT_SPEED,
    CLAW_RETRY,
    CLAW_HEAT_RATE,
    CLAW_HEAT_ENERGY,
    ROBOT_SPENT,
    CLAW_GRIP_CHANCE,
} from "./ships.js";
import * as shipSupply from "./shipSupply.js";
import * as shipBreakup from "./shipBreakup.js";
import * as shipForage from "./shipForage.js";
import * as shipBuild from "./shipBuild.js";

/**
 * Welding: two hulls that meet slowly enough, or a claw that closes on what its
 * bow meets, become one body flown by both.
 */

/** How far past the end of a module's weldable part a contact may still weld it, metres. */
const WELD_REACH = 0.05;

/**
 * Closing speed at or below which a ragged edge hooks rather than glancing
 * off, m/s — a drift, not a ram. A dial, in ROADMAP.md §12 with the others.
 */
export const WELD_SPEED = 2;

/**
 * Whether world point `x`, `y` is on the part of `module` that may be welded,
 * with its body at `bx`, `by` turned `angle`: anywhere but a hull mount's
 * barrel. A stop-gap until a barrel collides where it is drawn rather than as
 * the rest of the module's rectangle. An engine's bell still welds, as debris
 * can snag on one even though a layout is never attached by it.
 */
export function onWeldablePart(module: DesignModule, bx: number, by: number, angle: number, x: number, y: number): boolean {
    const spec = module.spec;
    if (!isHullMount(spec.kind)) return true;
    const weld = weldBox(spec);
    const whole = moduleCentre(spec);
    const part = moduleCentre(weld);
    // The welded part's middle, along the module from its centre.
    const offset = (part.x - whole.x) * cos(module.angle) + (part.y - whole.y) * sin(module.angle);
    const c = cos(angle);
    const s = sin(angle);
    const cx = bx + module.x * c - module.y * s;
    const cy = by + module.x * s + module.y * c;
    const own = angle + module.angle;
    const along = (x - cx) * cos(own) + (y - cy) * sin(own);
    return abs(along - offset) <= weld.length * 0.5 + WELD_REACH;
}

/**
 * How hard a claw has to be pushed back, stabbing in (`collision.ts`), before
 * it bites, per metre of its width, N: a heavier ship bites coming in slower.
 */
export const CLAW_BITE_FORCE = 5e4;

/**
 * The chance a claw pushed back with `force` takes a module left at
 * `integrity`: none short of `bite`, and past it likelier the more the module
 * has already been torn open.
 */
export function clawChance(force: number, bite: number, integrity: number): number {
    if (!(force >= bite) || !(force > 0)) return 0;
    const worn = integrity < 0 ? 1 : integrity > 1 ? 0 : 1 - integrity;
    return CLAW_GRIP_CHANCE + (1 - CLAW_GRIP_CHANCE) * worn;
}

/** Share of a gripped module's capacity the jaws take as they close. */
export const CLAW_BITE = 0.1;

/** How much of the smaller module's narrower side a hooked edge catches. */
const HOOK_SHARE = 0.5;

/** Cosine of how far from face to face two ports may meet and still mate: 30°. */
const PORT_ALIGN = 0.8660254037844386;

/**
 * Hook together the hulls this step's slow contacts pressed a ragged edge
 * into, and say how many pairs became one.
 *
 * Torn metal catches where a clean hull would glance off, so a contact
 * closing at no more than `WELD_SPEED` where either module is ragged
 * (`Damage.ragged`) makes the two bodies one, held by a seam. A ship hooked
 * onto a wreck carries it and gains nothing it can use, since command never
 * crosses a seam. Two ships hooked together both ride the one body, each
 * flying and fighting with what it brought, so they pull against each other.
 * A seam holds and tears like any weld, so a blow can part them again.
 *
 * **A claw closes on what its bow meets**, sound or torn, at up to
 * `CLAW_SPEED_MAX` and by chance (`clawChance`), and its seam holds
 * `DOCK_HOLD` times harder and carries a fuel line (`pump`).
 *
 * Every weld *removes* a body rather than holding two in a lasting contact.
 */
export function weld(ships: Ships, world: World, contacts: Contacts): number {
    const bodies = world.bodies;
    ships.bodyStore = bodies;
    let welded = 0;
    // Made only on a weld, which is rare, so a quiet step allocates nothing.
    let joined = null as Set<number> | null;
    const settled = world.tick - WELD_SETTLE / world.dt;
    for (let k = 0; k < contacts.count; k++) {
        const a = contacts.a[k]!;
        const b = contacts.b[k]!;
        const i = ships.shipAt(bodies, a);
        const j = ships.shipAt(bodies, b);
        // A pilot pressed against its source has to stand off and come again,
        // since leaning on it closes at nothing.
        if (i >= 0 && j >= 0 && ships.salvaging[i] === j) ships.touchedSource[i] = world.tick;
        if (i >= 0 && j >= 0 && ships.salvaging[j] === i) ships.touchedSource[j] = world.tick;
        // Pressed together, slowly: touching or drifting apart hooks nothing,
        // but for a claw stabbing in, which bites by how hard it is pushed back.
        const closing = contacts.closing[k]!;
        const stab = contacts.stab[k]!;
        // Rock meeting rock is judged by how fast it met, before giving slowed it.
        if (i >= 0 && j >= 0 && ships.isAsteroid(i) && ships.isAsteroid(j)) {
            rockTouch(ships, i, closing, world.tick);
            rockTouch(ships, j, closing, world.tick);
        }
        // Robots weld on loose wreckage lying slowly against their hull, to take it apart.
        const salvager = closing > WELD_SPEED ? -1 : salvages(ships, a, i, b, j) ? a : salvages(ships, b, j, a, i) ? b : -1;
        const salvage = salvager >= 0;
        // Wreckage come to rest on rock lodges there, for whoever mines the rock to take apart,
        // and so does a ship of any kind that has lain still against it a while.
        const restA = rests(ships, bodies, world, k, contacts, a, i, b, j);
        const restB = rests(ships, bodies, world, k, contacts, b, j, a, i);
        const lodged = closing <= WELD_SPEED && (lodges(ships, a, i, j) || lodges(ships, b, j, i) || restA || restB);
        if (stab !== Stab.A && stab !== Stab.B && !salvage && !lodged && (!(closing > 0) || closing > CLAW_SPEED_MAX)) continue;
        if (i < 0 || j < 0 || joined?.has(i) === true || joined?.has(j) === true) continue;
        if (ships.partedAt[i]! > settled || ships.partedAt[j]! > settled) continue;
        if (ships.damage.isProtected(a) || ships.damage.isProtected(b)) continue;
        // Nothing joins a hull parked on a pad: it would lose its pad. One moored
        // keeps its body and its grip, so may weld on what it salvages.
        if (ships.isParkedBody(a) && !(a === salvager && ships.mooredClaw[i]! >= 0)) continue;
        if (ships.isParkedBody(b) && !(b === salvager && ships.mooredClaw[j]! >= 0)) continue;
        const ma = contacts.moduleA[k]!;
        const mb = contacts.moduleB[k]!;
        // A claw closes on what its bow meets, ragged or not.
        const nx = contacts.nx[k]!;
        const ny = contacts.ny[k]!;
        let claw: "a" | "b" | null = null;
        const force = contacts.impulse[k]! / world.dt;
        if (stab === Stab.A && grips(ships, world, a, ma, b, mb, nx, ny, force)) claw = "a";
        else if (stab === Stab.B && grips(ships, world, b, mb, a, ma, -nx, -ny, force)) claw = "b";
        // Two ports nudged face to face mate, when one ship was making for the other.
        const port = claw === null && mates(ships, world, a, ma, b, mb, closing);
        // Rock meeting rock slowly sticks, as rubble does, torn or not; a minor
        // onto a major rides its rail, and two majors never meet on one.
        const pinnedA = bodies.pinned[a] === 1;
        const pinnedB = bodies.pinned[b] === 1;
        const rubble = claw === null && ships.isAsteroid(i) && ships.isAsteroid(j) && !(pinnedA && pinnedB);
        if (rubble && max(ships.rockMet[i]!, ships.rockMet[j]!) > WELD_SPEED) continue;
        // Nothing else but a claw or lodged wreckage holds on to an asteroid nothing moves.
        if ((pinnedA || pinnedB) && claw === null && !rubble && !lodged) continue;
        if (claw === null && !port && !rubble && !salvage && !lodged) {
            if (closing > WELD_SPEED) continue;
            if (!ships.damage.ragged(a, ma) && !ships.damage.ragged(b, mb)) continue;
            const x = contacts.x[k]!;
            const y = contacts.y[k]!;
            if (!weldsAt(ships, bodies, a, ma, x, y) || !weldsAt(ships, bodies, b, mb, x, y)) continue;
        }
        // A claw on an asteroid moors to it, keeping its own body, rather than becoming one with it.
        if (claw !== null) {
            const holderBody = claw === "a" ? a : b;
            const rockBody = claw === "a" ? b : a;
            const holder = ships.pilotAt(holderBody, claw === "a" ? ma : mb);
            const rock = ships.pilotAt(rockBody, claw === "a" ? mb : ma);
            if (rock >= 0 && ships.isAsteroid(rock)) {
                // Only a ship flying its own body moors: one riding another's has no body of its own to pin.
                if (holder < 0 || ships.shipByBody[holderBody] !== holder) continue;
                shipForage.moor(ships, bodies, holder, rock, claw === "a" ? ma : mb, contacts.x[k]!, contacts.y[k]!);
                joined ??= new Set<number>();
                joined.add(i);
                joined.add(j);
                contacts.impulse[k] = 0;
                welded++;
                continue;
            }
        }
        // A salvager keeps its body; rock what lodges on it; a pinned major its body and
        // its rail; otherwise a flown hull keeps its body; two wrecks keep the older's slot.
        const swap = salvage
            ? salvager === b
            : lodged
              ? ships.isAsteroid(j)
              : pinnedB || (!pinnedA && ships.derelict[i] === 1 && ships.derelict[j] === 0);
        // Whatever is moored to either rock stays where it is on the one they make.
        if (rubble) shipForage.holdMoorings(ships, bodies, i, j);
        const dock: DockAt | null = port
            ? { at: swap ? "b" : "a", kind: "port" }
            : claw === null
              ? null
              : { at: (claw === "a") !== swap ? "a" : "b", kind: "claw" };
        if (swap) merge(ships, world, j, i, mb, ma, dock);
        else merge(ships, world, i, j, ma, mb, dock);
        if (rubble) shipForage.rebaseMoorings(ships, bodies);
        joined ??= new Set<number>();
        joined.add(i);
        joined.add(j);
        // The contact is now inside one body: its impulse is no blow to answer.
        contacts.impulse[k] = 0;
        welded++;
    }
    return welded;
}

/**
 * Whether ship `i`, flying body `a`, would weld on ship `j`, flying body `b`:
 * `i` under control with robots aboard, `j` neither rock nor anyone's to fly or mend.
 */
export function salvages(ships: Ships, a: number, i: number, b: number, j: number): boolean {
    if (i < 0 || j < 0 || !ships.hasControl(i) || ships.hasControl(j) || ships.isAsteroid(i) || ships.isAsteroid(j)) return false;
    return shipRebuild.hasRobots(ships, a, i) && !shipRebuild.hasRobots(ships, b, j);
}

/**
 * Note ship `i`, on body `a`, touching asteroid `rock`, on body `b`, at
 * contact `k`, and say whether it has now lain still against it for
 * `REST_TIME`: under `REST_SPEED` where they touch, through a run of
 * touching steps.
 */
export function rests(
    ships: Ships,
    bodies: Bodies,
    world: World,
    k: number,
    contacts: Contacts,
    a: number,
    i: number,
    b: number,
    rock: number,
): boolean {
    if (i < 0 || rock < 0 || ships.isAsteroid(i) || !ships.isAsteroid(rock)) return false;
    const tick = world.tick;
    const x = contacts.x[k]!;
    const y = contacts.y[k]!;
    const ax = x - bodies.x[a]!;
    const ay = y - bodies.y[a]!;
    const bx = x - bodies.x[b]!;
    const by = y - bodies.y[b]!;
    const vx = bodies.vx[a]! - bodies.angularVel[a]! * ay - (bodies.vx[b]! - bodies.angularVel[b]! * by);
    const vy = bodies.vy[a]! + bodies.angularVel[a]! * ax - (bodies.vy[b]! + bodies.angularVel[b]! * bx);
    if (vx * vx + vy * vy > REST_SPEED * REST_SPEED) {
        ships.restFrom[i] = tick;
        ships.restAt[i] = tick;
        return false;
    }
    if (ships.restAt[i]! < tick - 1) ships.restFrom[i] = tick;
    ships.restAt[i] = tick;
    return tick - ships.restFrom[i]! >= REST_TIME / world.dt;
}

/** Whether ship `i`, on body `a`, is wreckage that lodges on asteroid `rock`: no one's to fly or mend. */
export function lodges(ships: Ships, a: number, i: number, rock: number): boolean {
    if (i < 0 || rock < 0 || ships.isAsteroid(i) || !ships.isAsteroid(rock)) return false;
    return !ships.hasControl(i) && !shipRebuild.hasRobots(ships, a, i);
}

/** Note asteroid `i` touching rock at `closing` m/s at `tick`: the fastest of a run of touching steps, afresh after a step apart. */
export function rockTouch(ships: Ships, i: number, closing: number, tick: number): void {
    if (ships.rockMetAt[i]! < tick - 1) ships.rockMet[i] = 0;
    ships.rockMetAt[i] = tick;
    if (closing > ships.rockMet[i]!) ships.rockMet[i] = closing;
}

/** `onWeldablePart` for module `m` of body `b`, as it is posed now. */
export function weldsAt(ships: Ships, bodies: Bodies, b: number, m: number, x: number, y: number): boolean {
    const module = ships.hullDesign[b]?.modules[m];
    return module === undefined || onWeldablePart(module, bodies.x[b]!, bodies.y[b]!, bodies.angle[b]!, x, y);
}

/**
 * Whether port `ma` of body `a` and port `mb` of body `b` mate: both still
 * working, worked by two friends both under control, met within 30° of face
 * to face at no more than `PORT_SPEED`, and one of the two making for
 * exactly this pair of ports.
 */
export function mates(ships: Ships, world: World, a: number, ma: number, b: number, mb: number, closing: number): boolean {
    if (closing > PORT_SPEED) return false;
    const da = ships.hullDesign[a];
    const db = ships.hullDesign[b];
    if (da === null || da === undefined || db === null || db === undefined) return false;
    const sa = da.modules[ma]!.spec;
    const sb = db.modules[mb]!.spec;
    if (sa.kind !== "port" || sb.kind !== "port") return false;
    const i = ships.pilotAt(a, ma);
    const j = ships.pilotAt(b, mb);
    if (i < 0 || j < 0 || i === j || ships.hostile(i, j) || ships.team[i] !== ships.team[j]) return false;
    if (!ships.hasControl(i) || !ships.hasControl(j)) return false;
    if (!(ships.left(i, a, ma, DamageEffect.Grip) > 0) || !(ships.left(j, b, mb, DamageEffect.Grip) > 0)) return false;
    const bodies = world.bodies;
    const fa = bodies.angle[a]! + (sa.angle ?? 0);
    const fb = bodies.angle[b]! + (sb.angle ?? 0);
    if (cos(fa - fb) > -PORT_ALIGN) return false;
    const wants = (s: number, t: number, own: number, theirs: number): boolean =>
        ships.salvaging[s] === t &&
        ships.ownPort[s] === own &&
        ships.dockPort[s] === theirs &&
        !shipSupply.threatened(ships, bodies, s, s === i ? b : a, true);
    return wants(i, j, ma, mb) || wants(j, i, mb, ma);
}

/**
 * Whether module `m` of body `b` is a claw that closes on module `mo` of
 * body `o`, met along `nx`, `ny` (pointing from the claw into what it met)
 * pushed back with `force`. Rolls for it, so only a claw that could take asks the
 * battle's generator anything; a miss leaves the claw's ship waiting
 * `CLAW_RETRY`. Taking bites the module it closes on.
 *
 * A claw goes for wrecks and enemies, never a friend still under control,
 * and only for fuel it has room for, or for a wreck its ship's robots could
 * take apart into metal it has room for.
 */
export function grips(
    ships: Ships,
    world: World,
    b: number,
    m: number,
    o: number,
    mo: number,
    nx: number,
    ny: number,
    force: number,
): boolean {
    const design = ships.hullDesign[b];
    if (design === null || design === undefined) return false;
    const spec = design.modules[m]!.spec;
    if (spec.kind !== "claw") return false;
    const bite = CLAW_BITE_FORCE * spec.width;
    if (!(force >= bite)) return false;
    if (!(ships.damage.remaining(b, m, DamageEffect.Grip) > 0)) return false;
    const bodies = world.bodies;
    const facing = bodies.angle[b]! + (spec.angle ?? 0);
    if (nx * cos(facing) + ny * sin(facing) < CLAW_ALIGN) return false;
    const holder = ships.pilotAt(b, m);
    const held = ships.pilotAt(o, mo);
    if (holder < 0 || held < 0 || holder === held) return false;
    const friend = !shipForage.drinkable(ships, holder, held);
    if (friend && !shipForage.sentToDrink(ships, holder, held)) return false;
    // A friend still flying gives only what it holds above its own reserve.
    const drinks = ships.fuel.pieceRoom(b, m) > 0 && ships.fuel.pieceHeld(o, mo) > (friend ? shipSupply.fuelReserve(ships, o, mo) : 0);
    // Rock is mined for its ice as well as its ore, and a claw alone can melt the ice out.
    const rock = ships.hullDesign[o]?.modules[mo]?.spec;
    const ice = rock?.kind === "rock" ? (rock.ice ?? 0) : 0;
    const heats = ice > 0 && ships.fuel.pieceRoom(b, m) > 0 && ships.power.pieceHeld(b, m) > 0;
    const strips =
        (ships.metal.pieceRoom(b, m) > 0 || (ice > 0 && ships.fuel.pieceRoom(b, m) > 0)) &&
        (ships.derelict[held] === 1 || (!ships.hasControl(held) && !shipRebuild.hasRobots(ships, o, held))) &&
        shipRebuild.canStrip(ships, b, holder, m, world.dt);
    if (!drinks && !strips && !heats && !shipBuild.wantsAnchor(ships, bodies, holder)) return false;
    // One anchoring to build holds its ground: let go, it would only come back to the rock.
    if (!ships.sentTo(holder) && !shipBuild.wantsAnchor(ships, bodies, holder) && shipSupply.threatened(ships, bodies, holder, o, false))
        return false;
    if (world.tick - ships.clawTried[holder]! < CLAW_RETRY / world.dt) return false;
    ships.clawTried[holder] = world.tick;
    if (world.rng.nextFloat() >= clawChance(force, bite, ships.damage.integrity(o, mo))) return false;
    const capacity = ships.damage.capacityLeft(o, mo) + ships.damage.absorbedAt(o, mo);
    ships.damage.absorb(o, mo, CLAW_BITE * capacity);
    return true;
}

/**
 * A claw melting fuel out of the rock it grips, for `dt` seconds of its
 * working: as fast as `CLAW_HEAT_RATE`, its piece's tanks have room and its
 * charge pays for, the rock it heats taken off whatever it gives. Says
 * whether it melted any.
 */
export function heat(ships: Ships, b: number, design: ShipDesign, claw: number, held: number, dt: number): boolean {
    const spec = design.modules[held]!.spec;
    if (spec.kind !== "rock") return false;
    const ice = (spec.ice ?? 0) * (1 - DISASSEMBLY_WASTE);
    if (!(ice > 0) || !(dt > 0)) return false;
    const left = design.modules[held]!.stats.mass - ships.damage.unbuiltAt(b, held);
    let fuel = min(CLAW_HEAT_RATE * dt, ships.fuel.pieceRoom(b, claw), left * ice);
    fuel = min(fuel, ships.power.pieceHeld(b, claw) / CLAW_HEAT_ENERGY);
    if (!(fuel > ROBOT_SPENT)) return false;
    ships.power.drain(b, claw, fuel * CLAW_HEAT_ENERGY);
    ships.damage.unfit(b, held, fuel / ice);
    ships.fuel.add(b, claw, fuel);
    return true;
}

/**
 * Make `other` part of `keep`, hooked where module `mk` of one met module
 * `mo` of the other. Momentum and angular momentum come out as they went in:
 * one rigid body moving as the two did between them.
 */
export function merge(ships: Ships, world: World, keep: number, other: number, mk: number, mo: number, dock: DockAt | null = null): void {
    const bodies = world.bodies;
    shipBreakup.settleShed(ships, bodies);
    const idK = ships.bodyIds[keep]!;
    const bk = bodies.indexOf(idK);
    const bo = bodies.indexOf(ships.bodyIds[other]!);
    const dk = ships.designs[keep]!;
    const dO = ships.designs[other]!;

    // The other's blueprint frame, in the keeper's.
    const angleK = bodies.angle[bk]!;
    const turn = bodies.angle[bo]! - angleK;
    const ck = cos(angleK);
    const sk = sin(angleK);
    const ct = cos(turn);
    const st = sin(turn);
    const wx = bodies.x[bo]! - bodies.x[bk]!;
    const wy = bodies.y[bo]! - bodies.y[bk]!;
    const dx = dk.centreOfMassX + (wx * ck + wy * sk) - (dO.centreOfMassX * ct - dO.centreOfMassY * st);
    const dy = dk.centreOfMassY + (-wx * sk + wy * ck) - (dO.centreOfMassX * st + dO.centreOfMassY * ct);
    const specK = dk.modules[mk]!.spec;
    const specO = dO.modules[mo]!.spec;
    // A dock holds across the whole of its part; torn metal catches on part of an edge.
    const width =
        dock === null
            ? HOOK_SHARE * min(min(specK.length, specK.width), min(specO.length, specO.width))
            : dock.at === "a"
              ? specK.width
              : specO.width;
    const design = weldDesigns(dk, dO, dx, dy, turn, mk, mo, width, dock);

    const massK = bodies.mass[bk]!;
    const massO = bodies.mass[bo]!;
    const total = massK + massO;
    const cx = bodies.x[bk]! + (design.centreOfMassX - dk.centreOfMassX) * ck - (design.centreOfMassY - dk.centreOfMassY) * sk;
    const cy = bodies.y[bk]! + (design.centreOfMassX - dk.centreOfMassX) * sk + (design.centreOfMassY - dk.centreOfMassY) * ck;
    // A pinned keeper goes on as its rail has it, whatever joins it.
    const pinned = bodies.pinned[bk] === 1;
    const vx = pinned ? bodies.vx[bk]! : (massK * bodies.vx[bk]! + massO * bodies.vx[bo]!) / total;
    const vy = pinned ? bodies.vy[bk]! : (massK * bodies.vy[bk]! + massO * bodies.vy[bo]!) / total;
    // About the new centre: each body's own spin, and its motion around it.
    const spinOf = (body: number, mass: number): number =>
        bodies.inertia[body]! * bodies.angularVel[body]! +
        mass * ((bodies.x[body]! - cx) * bodies.vy[body]! - (bodies.y[body]! - cy) * bodies.vx[body]!);
    const angular = spinOf(bk, massK) + spinOf(bo, massO);

    bodies.x[bk] = cx;
    bodies.y[bk] = cy;
    bodies.vx[bk] = vx;
    bodies.vy[bk] = vy;
    bodies.setMass(idK, design.mass);
    bodies.setInertia(idK, design.inertia);
    bodies.angularVel[bk] = angular / design.inertia;
    bodies.radius[bk] = design.radius;

    // Who works what: a wreck is nobody's once a second pilot is aboard, and a
    // ship alone keeps working all of it.
    const n = dk.modules.length;
    const flown = ships.derelict[other] === 0;
    const staying = ships.ridersOf(bodies, bk);
    const moving = flown ? ships.ridersOf(bodies, bo) : [];
    const wasK = ships.pilots[bk] ?? null;
    const wasO = ships.pilots[bo] ?? null;
    let pilots: Int32Array | null = null;
    if (flown || wasK !== null) {
        pilots = new Int32Array(design.modules.length);
        for (let m = 0; m < n; m++) pilots[m] = wasK === null ? keep : wasK[m]!;
        for (let m = n; m < pilots.length; m++) pilots[m] = !flown ? -1 : wasO === null ? other : wasO[m - n]!;
    }

    shipBreakup.adopt(
        ships,
        keep,
        bk,
        design,
        (m) => (m < n ? keep : other),
        (m) => (m < n ? m : m - n),
    );
    ships.pilots[bk] = pilots;
    // Spun up against the inertia the fuel left aboard gives it.
    bodies.angularVel[bk] = angular / bodies.inertia[bk]!;

    const gone = ships.bodyIds[other]!;
    ships.damage.forget(bo);
    ships.fuel.forget(bo);
    ships.metal.forget(bo);
    ships.power.forget(bo);
    ships.robots.forget(bo);
    ships.shipByBody[bo] = -1;
    ships.pilots[bo] = null;
    ships.sides[bo] = null;
    ships.paint[bo] = null;
    // Everyone already aboard takes the new design, wreckage hooked on or not:
    // a ship left on the old one would be drawn, aimed and fired from a layout
    // the body no longer has.
    for (const r of staying) if (r !== keep) ships.board(r, keep);
    if (flown) {
        const old = ships.turretIndex[other]!;
        for (let t = 0; t < old.length; t++) ships.turrets.remove(old[t]!);
        for (const r of moving) ships.board(r, keep);
    } else {
        ships.remove(other);
    }
    world.destroy(gone);
}
