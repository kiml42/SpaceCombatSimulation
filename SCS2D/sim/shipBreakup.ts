import { UNPAINTED } from "./debris.js";
import { Bodies } from "./bodies.js";
import { shotSpread, subDesign, triggerMask, type ShipDesign } from "./blueprint.js";
import { components, cuts, jointBetween, joints, type Joint } from "./connectivity.js";
import { DamageEffect, SHATTER } from "./damage.js";
import type { Leak } from "./fuel.js";
import { moduleOutline } from "./modules.js";
import { landedLength } from "./exhaust.js";
import { clamp, cos, length, max, min, round, sin, sqrt } from "./math.js";
import type { Robot } from "./robots.js";
import { overriddenDoctrine } from "./doctrine.js";
import type { World } from "./world.js";
import { fixed } from "./fixed.js";
import type { Contacts } from "./collision.js";
import { type Ships, SHOCK_REACH, NO_TARGET, WHOLE_SHIP } from "./ships.js";

/**
 * Hulls coming apart: blows and the shock they carry, welds cut and modules
 * shattered, a body split into the pieces still joined, each piece adopted by
 * whoever is aboard it, and loose wreckage culled once it can matter no more.
 */

/**
 * How much of a weld survives the metal at its ends being wrecked.
 *
 * A destroyed module keeps its mass and its place (§4), so it keeps holding
 * on to its neighbours — badly. Zero here would mean a hull whose middle had
 * been shot out fell to pieces at the first nudge.
 */
const WRECK_STRENGTH = 0.05;

/**
 * Below this mass, a severed piece is scrap and is never put in the world at
 * all, kilograms.
 *
 * Matter is conserved *within a hull* — a wrecked module keeps its mass and
 * its place, which is what makes a battered ship sluggish and its wreckage
 * free armour (§4). It is not conserved in the world: a shard this small is
 * too broken up to be worth going after and too light to be worth avoiding,
 * so tracking it buys nothing. What is discarded is counted rather than
 * quietly dropped, so a salvage economy can balance its books later, and is
 * seen to break up into debris (`debris.ts`) rather than vanish.
 *
 * Above most of a fighter's modules and under every capital one, so most of
 * a fighter's wreckage goes to debris and a capital's is kept.
 */
const SCRAP_MASS = 2000;

/**
 * How far past the fighting a piece has to drift before it stops being worth
 * tracking, in metres per kilogram above `SCRAP_MASS`.
 *
 * Continuous rather than a second threshold, and that is the point: a shard
 * just over the scrap mass is gone as soon as it leaves the battle, a tonne
 * of hull has to clear it by kilometres, and a serious chunk effectively
 * never leaves. "Worth hunting down for the rest of the battle" falls out of
 * that rather than being declared, which leaves one cliff in the rule instead
 * of two — and the one that is left is at a mass where nothing cares.
 */
const SALVAGE_REACH = 5;

/**
 * Below this mass, wreckage in the fight is let go once it is in nobody's way,
 * kilograms (`loose`).
 *
 * A fighter's parts weigh a few hundred kilograms to a few tonnes and a
 * capital's modules five to nine, so this reaches fighter debris and no more:
 * pieces too small to be worth a scavenger's trip, kept only as obstacles.
 */
const LOOSE_MASS = 5000;

/** How long a loose piece is kept whatever, seconds, so the eye sees it fly off. */
const LOOSE_AGE = 5;

/** How far ahead a loose piece looks for something under control to meet, seconds. */
const LOOSE_HORIZON = 10;

/** How near that has to pass beyond the two radii to count, metres. */
const LOOSE_CLEARANCE = 50;

/** How often loose pieces are looked over, seconds. */
const LOOSE_PERIOD = 1;

/**
 * How small the battle can get, metres.
 *
 * The area is drawn round the ships still in it, so it shrinks as they die
 * and would collapse to a point around the last one — taking the whole debris
 * field with it in a single step. A survivor going back for the wreckage has
 * to find it still there.
 */
const MINIMUM_BATTLE_RADIUS = 2000;

/** A module of a body, as one number. */
function blowKey(body: number, module: number): number {
    return body * 65536 + module;
}

/**
 * Remove a ship and its turrets. The body is the caller's to destroy, since
 * a dead ship's hull normally stays in the world as a wreck (§4).
 */
/**
 * Record a blow a hull has to survive: an impulse, newton-seconds, applied
 * at a world-frame point on the module it landed on.
 *
 * The momentum itself is the caller's to apply — the contact solver and the
 * gunnery each already do it, and doing it twice would be inventing
 * momentum. This is only the structural half: what the blow does to the
 * welds holding the ship together, answered by `sever`.
 */
export function blow(ships: Ships, bodyIndex: number, module: number, jx: number, jy: number, px: number, py: number): void {
    // Nothing breaks a hull that nothing can hurt.
    if (module < 0 || ships.damage.isProtected(bodyIndex)) return;
    if (!(jx !== 0 || jy !== 0)) return;
    const i = ships.blows++;
    ships.blowBody[i] = bodyIndex;
    ships.blowModule[i] = module;
    ships.blowJx[i] = jx;
    ships.blowJy[i] = jy;
    ships.blowX[i] = px;
    ships.blowY[i] = py;
}

/**
 * Answer this step's blows, breaking hulls where they could not take them,
 * and say how many pieces came off.
 *
 * **What parts a hull is a blow, not a wound.** Damage decides how much of
 * a weld is left; something still has to hit the ship hard enough to spend
 * it. So a ship shot to pieces around its spine goes on carrying its wings
 * until something *hits* it, which is the whole difference between a hull
 * coming apart and a hull dissolving.
 *
 * `contacts` are this step's collisions, which are blows like any other and
 * the heaviest a battle has.
 */
export function sever(ships: Ships, world: World, contacts?: Contacts): number {
    const bodies = world.bodies;
    ships.bodyStore = bodies;
    settleShed(ships, bodies);

    if (contacts !== undefined) {
        for (let k = 0; k < contacts.count; k++) {
            const j = contacts.impulse[k]!;
            if (!(j > 0)) continue;
            const jx = contacts.nx[k]! * j;
            const jy = contacts.ny[k]! * j;
            const x = contacts.x[k]!;
            const y = contacts.y[k]!;
            // The normal points from `a` towards `b`, so `a` took it the other way.
            blow(ships, contacts.a[k]!, contacts.moduleA[k]!, -jx, -jy, x, y);
            blow(ships, contacts.b[k]!, contacts.moduleB[k]!, jx, jy, x, y);
        }
    }

    let pieces = shatter(ships, world);
    pieces += partCutWelds(ships, world);
    for (let k = 0; k < ships.blows; k++) {
        ships.shakeLoose(world, k);
        pieces += answer(
            ships,
            world,
            ships.blowBody[k]!,
            ships.blowModule[k]!,
            ships.blowJx[k]!,
            ships.blowJy[k]!,
            ships.blowX[k]!,
            ships.blowY[k]!,
        );
    }
    ships.blows = 0;
    return pieces;
}

/**
 * Shatter every module that took more than `SHATTER` times what breaks it
 * this step: it is gone from its hull, its mass counted as discarded and
 * broken into debris, and what is left of the hull is split into the parts
 * still welded together without it, as severing splits one. A hull that was
 * nothing else goes altogether. Robots rebuild a shattered module as any
 * module lost. Not for a body more than one ship rides.
 */
export function shatter(ships: Ships, world: World): number {
    const damage = ships.damage;
    const bodies = world.bodies;
    let pieces = 0;
    // Each body once, with all it lost this step; rare, so allocating here is fine.
    let lost: Map<number, number[]> | null = null;
    for (let k = 0; k < damage.stepCount; k++) {
        const b = damage.stepBody[k]!;
        const m = damage.stepModule[k]!;
        const capacity = damage.capacityOf(b, m);
        if (!(capacity > 0) || damage.stepJoules[k]! < SHATTER * capacity) continue;
        if (bodies.alive[b] === 0 || (ships.shipByBody[b] ?? -1) < 0 || ships.pilots[b] != null) continue;
        lost ??= new Map();
        const modules = lost.get(b) ?? [];
        if (!modules.includes(m)) modules.push(m);
        lost.set(b, modules);
        // How hard it was struck, and where and which way, for how it is thrown.
        const struck = damage.stepStruck[k]!;
        ships.shatterBlows.set(
            blowKey(b, m),
            struck > 0
                ? [damage.stepJoules[k]!, damage.stepX[k]! / struck, damage.stepY[k]! / struck, damage.stepDx[k]!, damage.stepDy[k]!]
                : [damage.stepJoules[k]!, 0, 0, 0, 0],
        );
    }
    damage.clearStep();
    if (lost === null) return 0;

    for (const [b, shattered] of lost) {
        const i = ships.shipByBody[b]!;
        const design = ships.designs[i]!;
        const gone = new Set(shattered);
        const parts = components(design, (joint) => {
            if (gone.has(joint.a) || gone.has(joint.b)) return true;
            const k = jointBetween(design, joint.a, joint.b);
            return damage.weldIntegrity(b, k, joint.width) <= 0;
        }).filter((part) => !part.every((m) => gone.has(m)));
        if (parts.length > 0) {
            pieces += breakUp(ships, world, i, design, parts, shattered);
            continue;
        }
        // Nothing left of it.
        for (const m of shattered) discardModule(ships, world, i, design, m);
        ships.damage.forget(b);
        ships.fuel.forget(b);
        ships.metal.forget(b);
        ships.power.forget(b);
        ships.robots.forget(b);
        ships.shipByBody[b] = -1;
        ships.remove(i);
        world.destroy(ships.bodyIds[i]!);
    }
    ships.shatterBlows.clear();
    return pieces;
}

/**
 * Break module `m` of ship `i`'s `design`, the hull on body `b`, into debris
 * over its outline where it lies, in its paint; `hot` if blown apart, and
 * thrown by the blow that shattered it, if one did, its `mass` taking it.
 */
export function breakUpModule(
    ships: Ships,
    bodies: Bodies,
    i: number,
    b: number,
    design: ShipDesign,
    m: number,
    hot: boolean,
    mass = 0,
): void {
    if (!ships.debris.watched) return;
    const outline = ships.outline;
    const corners = moduleOutline(design.modules[m]!.spec, outline);
    const angle = bodies.angle[b]!;
    const c = cos(angle);
    const s = sin(angle);
    const bx = bodies.x[b]!;
    const by = bodies.y[b]!;
    for (let k = 0; k < 2 * corners; k += 2) {
        const x = outline[k]! - design.centreOfMassX;
        const y = outline[k + 1]! - design.centreOfMassY;
        outline[k] = bx + x * c - y * s;
        outline[k + 1] = by + x * s + y * c;
    }
    const kind = design.modules[m]!.spec.kind;
    const paint = kind === "rock" || kind === "kernel" ? UNPAINTED : ships.moduleSide(i, m);
    // The blow that shattered it, into the world: where it struck, and the way it drove, made a unit.
    const blow = ships.shatterBlows.get(blowKey(b, m));
    let ix = 0;
    let iy = 0;
    let nx = 0;
    let ny = 0;
    if (blow !== undefined) {
        ix = bx + blow[1]! * c - blow[2]! * s;
        iy = by + blow[1]! * s + blow[2]! * c;
        const run = length(blow[3]!, blow[4]!);
        if (run > 0) {
            nx = (blow[3]! * c - blow[4]! * s) / run;
            ny = (blow[3]! * s + blow[4]! * c) / run;
        }
    }
    const spin = bodies.angularVel[b]!;
    ships.debris.emit(outline, corners, bodies.vx[b]!, bodies.vy[b]!, spin, bx, by, paint, hot, blow?.[0] ?? 0, mass, ix, iy, nx, ny);
}

/**
 * Count module `m` of ship `i`, built to `design`, as discarded, with what
 * it holds and the velocity its place on the hull has, and break it into
 * debris there.
 */
export function discardModule(ships: Ships, world: World, i: number, design: ShipDesign, m: number): void {
    const bodies = world.bodies;
    const b = bodies.indexOf(ships.bodyIds[i]!);
    const placed = design.modules[m]!;
    const { stats } = placed;
    const mass = max(
        0,
        stats.mass - (stats.fuel - ships.fuel.held(b, m)) - (stats.metal - ships.metal.held(b, m)) - ships.damage.shedAt(b, m),
    );
    const angle = bodies.angle[b]!;
    const c = cos(angle);
    const sn = sin(angle);
    const ox = placed.x * c - placed.y * sn;
    const oy = placed.x * sn + placed.y * c;
    const spin = bodies.angularVel[b]!;
    const x = bodies.x[b]! + ox;
    const y = bodies.y[b]! + oy;
    const vx = bodies.vx[b]! - spin * oy;
    const vy = bodies.vy[b]! + spin * ox;
    ships.discarded += mass;
    ships.discardedPx += mass * vx;
    ships.discardedPy += mass * vy;
    ships.discardedL += mass * (x * vy - y * vx);
    if (mass > 0) breakUpModule(ships, bodies, i, b, design, m, true, mass);
}

/**
 * Let go of every weld that has been cut through.
 *
 * **A cut needs no blow.** Everything else here is a weld failing under a
 * load, but a weld with none of its section left is not a weak weld: it is
 * an absent one, and what it was holding is simply no longer attached.
 *
 * Walked only for hulls something has cut into since the last look, which
 * is a version comparison like the engine layout's.
 */
export function partCutWelds(ships: Ships, world: World): number {
    const bodies = world.bodies;
    let pieces = 0;
    for (let i = 0; i < ships.alive.length; i++) {
        if (ships.alive[i] === 0) continue;
        const b = bodies.indexOf(ships.bodyIds[i]!);
        // A body is walked once, by its primary, however many ships ride it.
        if (b < 0 || ships.shipByBody[b] !== i) continue;
        const version = ships.damage.cutVersion(b);
        if (ships.cutSeen[i] === version) continue;
        ships.cutSeen[i] = version;

        const design = ships.designs[i]!;
        const all = joints(design);
        let through = false;
        for (let k = 0; k < all.length; k++) {
            if (ships.damage.weldIntegrity(b, k, all[k]!.width) > 0) continue;
            through = true;
            break;
        }
        if (!through) continue;

        const parts = components(design, (joint) => {
            const k = jointBetween(design, joint.a, joint.b);
            return ships.damage.weldIntegrity(b, k, joint.width) <= 0;
        });
        if (parts.length < 2) continue;
        pieces += breakUp(ships, world, i, design, parts);
    }
    return pieces;
}

/**
 * Stop tracking wreckage that has drifted out of the fight, and say how
 * many pieces were let go.
 *
 * Between "too smashed to be worth harvesting" and "worth hunting down" is
 * a question about *relevance* rather than size: what matters is whether a
 * piece could still hit somebody or still be worth going after, and both
 * depend on how big it is and how far it is from where the fighting is. So
 * a piece is kept while it is within the battle plus its own reach, and its
 * reach grows with its mass — a shard goes as soon as it leaves, a tonne of
 * hull has to clear the fight by kilometres, and a serious chunk never
 * really leaves at all.
 *
 * Small debris goes sooner, wherever it is, once it is in nobody's way
 * (`loose`).
 *
 * Only wreckage. A ship is tracked wherever it goes, because a ship can
 * come back.
 */
export function cull(ships: Ships, world: World): number {
    const bodies = world.bodies;
    const area = battleArea(ships, bodies);
    const period = max(1, round(LOOSE_PERIOD / world.dt));
    const looking = world.tick % period === 0;
    let dropped = 0;

    for (let i = 0; i < ships.alive.length; i++) {
        if (ships.alive[i] === 0 || ships.derelict[i] === 0) continue;
        const b = bodies.indexOf(ships.bodyIds[i]!);
        if (b < 0) continue;
        const design = ships.designs[i]!;
        const reach = area.radius + (design.mass - SCRAP_MASS) * SALVAGE_REACH;
        const away = length(bodies.x[b]! - area.x, bodies.y[b]! - area.y) > reach;
        if (!away && !(looking && loose(ships, world, i, b))) continue;

        const mass = bodies.mass[b]!;
        // A loose piece goes where it can be seen, so it breaks up rather than vanishing.
        if (!away) for (let m = 0; m < design.modules.length; m++) breakUpModule(ships, bodies, i, b, design, m, false);
        ships.discarded += mass;
        ships.discardedPx += mass * bodies.vx[b]!;
        ships.discardedPy += mass * bodies.vy[b]!;
        ships.discardedL +=
            bodies.inertia[b]! * bodies.angularVel[b]! + mass * (bodies.x[b]! * bodies.vy[b]! - bodies.y[b]! * bodies.vx[b]!);
        ships.damage.forget(b);
        ships.fuel.forget(b);
        ships.metal.forget(b);
        ships.power.forget(b);
        ships.robots.forget(b);
        ships.shipByBody[b] = -1;
        ships.remove(i);
        world.destroy(ships.bodyIds[i]!);
        dropped++;
    }

    return dropped;
}

/**
 * Whether wreck `i`, on body `b`, is small debris in nobody's way: lighter
 * than `LOOSE_MASS`, loose for `LOOSE_AGE`, nobody's salvage, and with
 * nothing under control due to pass within `LOOSE_CLEARANCE` of it in the
 * next `LOOSE_HORIZON`, going as both are. Such a piece will not be gone
 * after and is not in the way, so it is only scenery. Another wreck does
 * not keep it: two that meet weld into something heavier.
 */
export function loose(ships: Ships, world: World, i: number, b: number): boolean {
    const bodies = world.bodies;
    if (!(bodies.mass[b]! < LOOSE_MASS) || (world.tick - ships.partedAt[i]!) * world.dt < LOOSE_AGE) return false;
    for (let t = 0; t < ships.alive.length; t++) {
        if (ships.alive[t] === 0 || ships.derelict[t] === 1) continue;
        if (ships.salvaging[t] === i) return false;
        if (!ships.hasControl(t)) continue;
        const tb = bodies.indexOf(ships.bodyIds[t]!);
        if (tb < 0 || tb === b) continue;
        const dx = bodies.x[tb]! - bodies.x[b]!;
        const dy = bodies.y[tb]! - bodies.y[b]!;
        const vx = bodies.vx[tb]! - bodies.vx[b]!;
        const vy = bodies.vy[tb]! - bodies.vy[b]!;
        const speedSq = vx * vx + vy * vy;
        const when = speedSq > 0 ? clamp(-(dx * vx + dy * vy) / speedSq, 0, LOOSE_HORIZON) : 0;
        const clear = bodies.radius[b]! + bodies.radius[tb]! + LOOSE_CLEARANCE;
        if (length(dx + vx * when, dy + vy * when) < clear) return false;
    }
    return true;
}

/**
 * Where the fighting is and how far it reaches: the ships still in it, and
 * the distance from the middle of them to the furthest.
 *
 * Their centre and their spread rather than the smallest circle that
 * contains them — the exact answer is either randomised or cubic, and what
 * this is for is the *scale* of the fight rather than a tight bound. Hulks
 * count, since a drifting wreck is still somewhere the battle was.
 */
export function battleArea(ships: Ships, bodies: Bodies): { x: number; y: number; radius: number } {
    let x = 0;
    let y = 0;
    let n = 0;
    for (let i = 0; i < ships.alive.length; i++) {
        if (ships.alive[i] === 0 || ships.derelict[i] === 1) continue;
        const b = bodies.indexOf(ships.bodyIds[i]!);
        if (b < 0) continue;
        x += bodies.x[b]!;
        y += bodies.y[b]!;
        n++;
    }
    if (n === 0) return { x: 0, y: 0, radius: Infinity };
    x /= n;
    y /= n;

    let radius = MINIMUM_BATTLE_RADIUS;
    for (let i = 0; i < ships.alive.length; i++) {
        if (ships.alive[i] === 0 || ships.derelict[i] === 1) continue;
        const b = bodies.indexOf(ships.bodyIds[i]!);
        if (b < 0) continue;
        radius = max(radius, length(bodies.x[b]! - x, bodies.y[b]! - y));
    }
    return { x, y, radius };
}

/**
 * What one blow does to one hull.
 *
 * The hull answers the blow as a rigid body would — every module has to
 * reach the new motion — and a weld's job is to drag whatever hangs off it
 * along. So the load through a weld is the impulse that has to *cross* it:
 * the far side's mass by the velocity change at the far side's centre. That
 * is the whole of why a hit on an outlying module takes it off while the
 * same hit amidships takes nothing: the wing's root has to carry the ship,
 * and the ship's middle barely has to carry the wing.
 *
 * **A blow is spent as it breaks things.** The worst-loaded weld goes
 * first, its strength comes off the blow, and what is left goes on to the
 * next — so a ram tears off as much as it has paid for and a nudge tears
 * off one thing or nothing. Answering every overloaded weld at once is what
 * makes a ship shatter rather than break.
 */
export function answer(
    ships: Ships,
    world: World,
    bodyIndex: number,
    module: number,
    jx: number,
    jy: number,
    px: number,
    py: number,
): number {
    const bodies = world.bodies;
    const i = ships.shipAt(bodies, bodyIndex);
    if (i < 0) return 0;
    const design = ships.designs[i]!;
    if (design.modules.length < 2) return 0;
    if (module >= design.modules.length) return 0;

    const all = joints(design);
    const sides = cuts(design);
    if (all.length === 0) return 0;

    // The hull's response, in its own frame, where its modules live.
    const angle = bodies.angle[bodyIndex]!;
    const c = cos(angle);
    const s = sin(angle);
    const invMass = bodies.invMass[bodyIndex]!;
    const invInertia = bodies.invInertia[bodyIndex]!;
    const rcx = px - bodies.x[bodyIndex]!;
    const rcy = py - bodies.y[bodyIndex]!;
    const spin = (rcx * jy - rcy * jx) * invInertia;
    // Where the blow landed, in the hull's frame, to measure outward from.
    const hitX = rcx * c + rcy * s;
    const hitY = -rcx * s + rcy * c;
    const dvx = jx * invMass * c + jy * invMass * s;
    const dvy = -(jx * invMass) * s + jy * invMass * c;

    const failed = new Set<Joint>();
    // What the blow has left to give. Every load is linear in it, so spending
    // it is one scale over all of them.
    const delivered = sqrt(jx * jx + jy * jy);
    let budget = delivered;
    for (;;) {
        let worst = -1;
        let worstLoad = 0;
        let worstStrength = 0;
        for (let k = 0; k < all.length; k++) {
            const joint = all[k]!;
            if (failed.has(joint)) continue;
            const cut = sides[k];
            if (cut === null || cut === undefined) continue;
            const far = 1 - cut.side[module]!;
            const mass = cut.mass[far]!;
            if (!(mass > 0)) continue;
            // Velocity change where the far side's mass actually is.
            const fx = dvx - spin * cut.y[far]!;
            const fy = dvy + spin * cut.x[far]!;
            // What is left of the shock by the time it reaches this weld.
            const away = length(joint.x - hitX, joint.y - hitY);
            const carried = SHOCK_REACH / (SHOCK_REACH + away);
            const load = (mass * sqrt(fx * fx + fy * fy) * budget * carried) / delivered;
            const strength = weldStrength(ships, bodyIndex, joint, k);
            if (load <= strength) continue;
            if (load - strength <= worstLoad - worstStrength) continue;
            worst = k;
            worstLoad = load;
            worstStrength = strength;
        }
        if (worst < 0) break;
        failed.add(all[worst]!);
        // Tearing a weld costs the blow what the weld was worth.
        budget -= worstStrength;
        if (!(budget > 0)) break;
    }
    if (failed.size === 0) return 0;

    const parts = components(design, (joint) => failed.has(joint));
    if (parts.length < 2) return 0;
    return breakUp(ships, world, i, design, parts);
}

/**
 * Give every piece of a hull that has come apart a body of its own, and say
 * how many came off. Ship `i` is the body's primary and stays with it.
 *
 * With several ships aboard, each goes with the piece it is flown from — its
 * lowest working core, else its first core — so two ships hooked together
 * part as the two ships they were. A piece nobody is flown from is wreckage,
 * or a ship of its own if a working core is on it (`detach`).
 */
export function breakUp(
    ships: Ships,
    world: World,
    i: number,
    design: ShipDesign,
    parts: readonly number[][],
    shattered: readonly number[] = [],
): number {
    const bodies = world.bodies;
    settleShed(ships, bodies);
    momentum(ships, bodies);
    const beforeX = ships.momentumX;
    const beforeY = ships.momentumY;
    // Counted as discarded before the hull is reshaped without them, so their
    // momentum is not taken up by what stays.
    for (const m of shattered) discardModule(ships, world, i, design, m);
    ships.parted[i] = 0;
    const pieces = breakApart(ships, world, i, design, parts);
    // Cut between its cores, it is now the ship flown from the one it kept, as
    // each piece that flew off is the ship flown from its own.
    if (ships.parted[i] === 1) {
        const kept = ships.designs[i]!;
        const core =
            kept.cores.find((c) => ships.damage.remaining(bodies.indexOf(ships.bodyIds[i]!), c, DamageEffect.Control) > 0) ?? kept.cores[0];
        const name = core === undefined ? null : ships.paintAt(bodies.indexOf(ships.bodyIds[i]!), core);
        if (name !== null) ships.names[i] = name;
        ships.parted[i] = 0;
    }
    // Each piece leaves at the hull's velocity at its own centre of mass, which
    // conserves momentum only if the hull's mass is where its design put it.
    // What spending and damage have taken off unevenly says otherwise, so the
    // piece that stays with the ship takes up the difference.
    momentum(ships, bodies);
    const b = bodies.indexOf(ships.bodyIds[i]!);
    const mass = bodies.mass[b]!;
    if (mass > 0) {
        bodies.vx[b] = bodies.vx[b]! + (beforeX - ships.momentumX) / mass;
        bodies.vy[b] = bodies.vy[b]! + (beforeY - ships.momentumY) / mass;
    }
    return pieces;
}

/** The world's momentum, with what it has discarded, into `momentumX` and `momentumY`. */
export function momentum(ships: Ships, bodies: Bodies): void {
    let x = ships.discardedPx;
    let y = ships.discardedPy;
    for (let b = 0; b < bodies.highWater; b++) {
        // A parked fighter's is its carrier's.
        if (bodies.alive[b] === 0 || ships.isParkedBody(b)) continue;
        x += bodies.mass[b]! * bodies.vx[b]!;
        y += bodies.mass[b]! * bodies.vy[b]!;
    }
    ships.momentumX = x;
    ships.momentumY = y;
}

export function breakApart(ships: Ships, world: World, i: number, design: ShipDesign, parts: readonly number[][]): number {
    const bodies = world.bodies;
    const b = bodies.indexOf(ships.bodyIds[i]!);
    const pilots = ships.pilots[b] ?? null;
    let pieces = 0;
    if (pilots === null) {
        const keeper = keeperOf(ships, b, design, parts);
        for (let p = 0; p < parts.length; p++) {
            if (p === keeper) continue;
            if (detach(ships, world, i, design, parts[p]!)) pieces++;
        }
        reshape(ships, world, i, design, parts[keeper]!);
        return pieces;
    }

    const partOf = new Int32Array(design.modules.length);
    for (let p = 0; p < parts.length; p++) for (const m of parts[p]!) partOf[m] = p;
    const riders = ships.ridersOf(bodies, b);
    const home = riders.map((r) => partOf[anchorOf(ships, b, design, pilots, r)]!);
    const keeper = home[riders.indexOf(i)]!;
    for (let p = 0; p < parts.length; p++) {
        if (p === keeper) continue;
        const aboard = riders.filter((_, k) => home[k] === p);
        if (aboard.length > 0) {
            rehome(ships, world, i, aboard, design, parts[p]!, pilots);
            pieces++;
            continue;
        }
        // A second core of somebody's, flying on for that ship's side.
        const core = design.cores.find((c) => partOf[c] === p && ships.damage.remaining(b, c, DamageEffect.Control) > 0);
        const owner = core === undefined ? -1 : pilots[core]!;
        if (detach(ships, world, i, design, parts[p]!, owner >= 0 && ships.alive[owner] === 1 ? owner : i)) pieces++;
    }
    const staying = riders.filter((_, k) => home[k] === keeper);
    reshape(ships, world, i, design, parts[keeper]!);
    assignPilots(ships, b, i, staying, pilots, parts[keeper]!);
    return pieces;
}

/** The module ship `r` is flown from: its lowest working core, its first core, or its lowest module. */
export function anchorOf(ships: Ships, b: number, design: ShipDesign, pilots: Int32Array, r: number): number {
    let first = -1;
    for (const core of design.cores) {
        if (pilots[core] !== r) continue;
        if (ships.damage.remaining(b, core, DamageEffect.Control) > 0) return core;
        if (first < 0) first = core;
    }
    if (first >= 0) return first;
    for (let m = 0; m < pilots.length; m++) if (pilots[m] === r) return m;
    return 0;
}

/**
 * Carry who works what over to body `b`, now cut down to `keep`, and put
 * everyone `aboard` on its primary `p`. One ship alone works all of it.
 */
export function assignPilots(
    ships: Ships,
    b: number,
    p: number,
    aboard: readonly number[],
    was: Int32Array,
    keep: readonly number[],
): void {
    if (aboard.length < 2) {
        ships.pilots[b] = null;
        return;
    }
    const pilots = new Int32Array(keep.length);
    for (let k = 0; k < keep.length; k++) {
        const owner = was[keep[k]!]!;
        pilots[k] = aboard.includes(owner) ? owner : -1;
    }
    ships.pilots[b] = pilots;
    for (const r of aboard) if (r !== p) ships.board(r, p);
}

/**
 * Move the ships `aboard` onto a new body made of the modules `keep` of the
 * body `from` is primary of — a ship parting from the one it was hooked to,
 * leaving as a rigid split does (`detach`) and taking its own orders and
 * mount state with it.
 */
export function rehome(
    ships: Ships,
    world: World,
    from: number,
    aboard: readonly number[],
    was: ShipDesign,
    keep: readonly number[],
    pilots: Int32Array,
): void {
    const bodies = world.bodies;
    const b = bodies.indexOf(ships.bodyIds[from]!);
    const chunk = subDesign(was, keep);
    const offset = offsetOf(bodies, b, was, chunk);
    const spin = bodies.angularVel[b]!;
    const id = world.spawn({
        x: bodies.x[b]! + offset.x,
        y: bodies.y[b]! + offset.y,
        angle: bodies.angle[b]!,
        vx: bodies.vx[b]! - spin * offset.y,
        vy: bodies.vy[b]! + spin * offset.x,
        angularVel: spin,
        mass: chunk.mass,
        inertia: chunk.inertia,
        radius: chunk.radius,
    });
    const nb = bodies.indexOf(id);
    const p = aboard[0]!;
    ships.hullBody[nb] = id;
    // Read from `from`, which still holds the old body and its mounts; those are
    // released when it is reshaped.
    adopt(
        ships,
        p,
        nb,
        chunk,
        () => from,
        (m) => keep[m]!,
        false,
    );
    ships.bodyIds[p] = id;
    ships.shipByBody[nb] = p;
    for (const r of aboard) ships.partedAt[r] = world.tick;
    assignPilots(ships, nb, p, aboard, pilots, keep);
}

/**
 * Which piece of a hull that has just come apart goes on being the ship,
 * as an index into `parts`.
 *
 * **The piece holding the lowest-numbered working core.** A ship is flown
 * from its cores, so that is where everything that belongs to the ship
 * rather than to its shape stays: its orders, its side, and what its guns
 * were doing. Lowest-numbered and not largest, for the reason the layout
 * rule anchors on the first core — the size of a piece says nothing about
 * which of them is still a ship, and an index gives the same answer every
 * time the same battle is run.
 *
 * Every *other* piece with a working core of its own becomes a ship too;
 * this only decides which of them is the one that was already there. A hull
 * with no working core left keeps the piece holding its first core, or its
 * lowest module if it has no core at all — a chunk coming apart further.
 * Both are wreckage whichever piece is chosen, so what this settles for them
 * is merely which body goes on being tracked. An asteroid keeps the piece
 * holding its kernel, which is the one its rail pins in place; rock knocked
 * off it goes free.
 */
export function keeperOf(ships: Ships, bodyIndex: number, design: ShipDesign, parts: readonly number[][]): number {
    const partOf = new Map<number, number>();
    for (let p = 0; p < parts.length; p++) {
        for (const module of parts[p]!) partOf.set(module, p);
    }
    for (let m = 0; m < design.modules.length; m++) {
        if (design.modules[m]!.spec.kind === "kernel") return partOf.get(m) ?? 0;
    }
    let fallback = -1;
    // `cores` is in module order, so the first one that works wins and the
    // first one at all is the fallback.
    for (const core of design.cores) {
        const p = partOf.get(core);
        if (p === undefined) continue;
        if (fallback < 0) fallback = p;
        if (ships.damage.remaining(bodyIndex, core, DamageEffect.Control) > 0) return p;
    }
    return fallback < 0 ? 0 : fallback;
}

/**
 * What a weld can still carry, newton-seconds.
 *
 * A weld is only as good as the metal at its ends, so damage to either
 * module takes it down — but never to nothing: **wreckage is still metal,
 * and still holds, badly.** Without that floor a hull whose middle had been
 * shot out would shed everything at the first nudge, which is the failure
 * this model exists to avoid.
 */
export function weldStrength(ships: Ships, bodyIndex: number, joint: Joint, index: number): number {
    const metal = min(ships.damage.integrity(bodyIndex, joint.a), ships.damage.integrity(bodyIndex, joint.b));
    // What is left of the section, which no amount of sound metal at its ends
    // can make up for: a weld cut through is not a weak weld but an absent one.
    const section = ships.damage.weldIntegrity(bodyIndex, index, joint.width);
    return joint.strength * section * (WRECK_STRENGTH + (1 - WRECK_STRENGTH) * metal);
}

/**
 * Put a piece of a ship into the world as a body of its own.
 *
 * It leaves with the velocity the point it broke off at already had —
 * `v + ω × r` — and the hull's spin, which is what a rigid split conserves:
 * no impulse is invented, so the momentum and the angular momentum of the
 * pieces together are the ones the whole hull had a moment earlier.
 *
 * **A piece with a working core leaves as a ship**, not as wreckage: it is
 * flown, it shoots, it keeps the side it was on, and it works through a copy
 * of the plan the ship was given, because the core it is flown from was given
 * that plan too. Everything else comes away as a piece of hull with nothing
 * controlling it. This is what a second core buys — a hull cut in two amidships
 * becomes two ships rather than a ship and a wreck.
 */
export function detach(ships: Ships, world: World, i: number, design: ShipDesign, keep: readonly number[], side = i): boolean {
    const bodies = world.bodies;
    const b = bodies.indexOf(ships.bodyIds[i]!);
    const chunk = subDesign(design, keep);
    const offset = offsetOf(bodies, b, design, chunk);
    const spin = bodies.angularVel[b]!;
    // Asked of the hull it is still part of, since that is where the damage
    // to these modules is recorded.
    const flies = chunk.cores.some((core) => ships.damage.remaining(b, keep[core]!, DamageEffect.Control) > 0);
    // Scrap never reaches the world, so nothing the eye was following ever
    // vanishes: a piece this small is not created rather than removed. A piece
    // that still flies is not scrap at whatever mass — it is a ship, and the
    // smallest ship in the game weighs less than this.
    let mass = chunk.mass;
    for (let m = 0; m < keep.length; m++) {
        const { stats } = chunk.modules[m]!;
        mass -= stats.fuel - ships.fuel.held(b, keep[m]!) + stats.metal - ships.metal.held(b, keep[m]!);
        mass -= ships.damage.shedAt(b, keep[m]!);
    }
    if (!flies && mass < SCRAP_MASS) {
        ships.discarded += mass;
        // Whatever it would have left with, had it been worth putting there.
        const vx = bodies.vx[b]! - spin * offset.y;
        const vy = bodies.vy[b]! + spin * offset.x;
        // Seen to break up rather than vanish.
        if (mass > 0) for (const m of keep) breakUpModule(ships, bodies, i, b, design, m, true);
        ships.discardedPx += mass * vx;
        ships.discardedPy += mass * vy;
        // Its inertia taken as its full design's, scaled to what it weighs.
        ships.discardedL +=
            ((chunk.inertia * mass) / chunk.mass) * spin + mass * ((bodies.x[b]! + offset.x) * vy - (bodies.y[b]! + offset.y) * vx);
        return false;
    }

    const j = ships.spawn(world, {
        design: chunk,
        x: bodies.x[b]! + offset.x,
        y: bodies.y[b]! + offset.y,
        angle: bodies.angle[b]!,
        vx: bodies.vx[b]! - spin * offset.y,
        vy: bodies.vy[b]! + spin * offset.x,
        angularVel: spin,
        team: ships.team[side]!,
        serial: ships.serial[side]!,
    });
    ships.partedAt[j] = world.tick;
    ships.couldFight[j] = ships.couldFight[side]!;
    if (flies) {
        ships.orders[j] = ships.orders[side]!.map((order) => ({ ...order }));
        // And what it was told of how to fight.
        ships.overrides[j] = ships.overrides[side];
        ships.keeps[j] = ships.keeps[side];
        ships.crafts[j] = ships.crafts[side];
        ships.doctrines[j] = overriddenDoctrine(ships.ownDoctrines[j]!, ships.overrides[j]);
        // Still that ship, so it rebuilds to the design that ship set out as: a
        // hull cut in two can grow back into two. Wreckage sets out as itself.
        ships.launched[j] = ships.launched[side]!;
        // Named for the core it is flown from, by what is painted on it.
        const core = chunk.cores.find((c) => ships.damage.remaining(b, keep[c]!, DamageEffect.Control) > 0);
        const name = core === undefined ? null : ships.paintAt(b, keep[core]!);
        if (name !== null) {
            ships.names[j] = name;
            if (side === i) ships.parted[i] = 1;
        }
    } else {
        ships.derelict[j] = 1;
    }

    // Its mounts keep pointing and slewing as they were rather than starting
    // at rest; with nothing to fly it, a fail-safe then brakes them where
    // they point.
    const from = ships.turretIndex[i]!;
    const to = ships.turretIndex[j]!;
    chunk.turrets.forEach((mount, t) => {
        const before = design.turrets.findIndex((m) => m.module === keep[mount.module]);
        if (before >= 0) ships.turrets.carry(from[before]!, to[t]!, 0);
    });

    const chunkBody = bodies.indexOf(ships.bodyIds[j]!);
    ships.damage.register(
        chunkBody,
        chunk,
        scarsOf(ships, b, keep),
        weldScarsOf(ships, b, design, chunk, keep),
        keep.map((m) => ships.damage.unbuiltAt(b, m)),
        keep.map((m) => ships.damage.scars.carriedAt(b, m)),
    );
    ships.fuel.register(
        chunkBody,
        chunk,
        keep.map((m) => ships.fuel.held(b, m)),
        leaksInto(ships, keep.length, (m) => ({ body: b, module: keep[m]! })),
    );
    ships.metal.register(
        chunkBody,
        chunk,
        keep.map((m) => ships.metal.held(b, m)),
    );
    ships.power.register(
        chunkBody,
        chunk,
        keep.map((m) => ships.power.held(b, m)),
    );
    const kept = new Int32Array(design.modules.length).fill(-1);
    for (let k = 0; k < keep.length; k++) kept[keep[k]!] = k;
    const madeBefore = ships.robots.buildingOn(b);
    ships.robots.register(
        chunkBody,
        chunk,
        ships.robots.take(b, (m) => kept[m] ?? -1),
        (m) => madeBefore?.[keep[m]!] ?? [],
    );
    settleMass(ships, bodies, chunkBody);
    ships.shipByBody[chunkBody] = j;
    ships.sides[chunkBody] = ships.sidesOf((m) => ships.sideAt(b, keep[m]!), keep.length, ships.team[j]!);
    ships.paint[chunkBody] = keep.map((m) => ships.paintAt(b, m));
    return true;
}

/**
 * Cut a ship down to the piece it is flown from, in place.
 *
 * Everything derived from the layout is derived again, because the layout
 * is what changed: mass and inertia, the centre of mass the body turns
 * about, the engine matrix, the mounts and their arcs. What is carried
 * over is state that belongs to the ship rather than to its shape — its
 * orders, its gun timers, where its surviving turrets were pointing, and
 * what each remaining module had already taken.
 */
export function reshape(ships: Ships, world: World, i: number, was: ShipDesign, keep: readonly number[]): void {
    const bodies = world.bodies;
    settleShed(ships, bodies);
    const id = ships.bodyIds[i]!;
    const b = bodies.indexOf(id);
    const design = subDesign(was, keep);
    const offset = offsetOf(bodies, b, was, design);
    const spin = bodies.angularVel[b]!;

    bodies.x[b] = bodies.x[b]! + offset.x;
    bodies.y[b] = bodies.y[b]! + offset.y;
    bodies.vx[b] = bodies.vx[b]! - spin * offset.y;
    bodies.vy[b] = bodies.vy[b]! + spin * offset.x;
    bodies.setMass(id, design.mass);
    bodies.setInertia(id, design.inertia);
    bodies.radius[b] = design.radius;

    ships.partedAt[i] = world.tick;
    adopt(
        ships,
        i,
        b,
        design,
        () => i,
        (m) => keep[m]!,
    );
}

/**
 * Make a ship's body carry a new design in place, keeping whatever belongs to
 * the ship rather than its shape: each module's scars, each weld's cuts, and
 * each surviving mount's state. `shipOf` and `moduleOf` say which ship and
 * which of its modules each module of the new design was; a core new to the
 * hull is painted by `builder`.
 */
export function adopt(
    ships: Ships,
    i: number,
    b: number,
    design: ShipDesign,
    shipOf: (module: number) => number,
    moduleOf: (module: number) => number,
    release = true,
    keepRobots = false,
    builder = i,
): void {
    const bodies = ships.bodyStore!;
    const bodyOf = (ship: number): number => bodies.indexOf(ships.bodyIds[ship]!);
    // The claw it is moored by, where it went in the new layout: -1 if it went with a piece cut away.
    let claw = ships.mooredClaw[i]!;
    if (claw >= 0) {
        let at = -1;
        for (let m = 0; m < design.modules.length && at < 0; m++) if (shipOf(m) === i && moduleOf(m) === claw) at = m;
        claw = at;
    }
    // A module new to the hull (`moduleOf` -1) is its builder's, empty and unhurt.
    const sides = ships.sidesOf(
        (m) => (moduleOf(m) < 0 ? ships.team[i]! : ships.sideAt(bodyOf(shipOf(m)), moduleOf(m))),
        design.modules.length,
        ships.team[i]!,
    );
    const paint = design.modules.map((_, m) => {
        const was = moduleOf(m);
        return (was < 0 ? null : ships.paintAt(bodyOf(shipOf(m)), was)) ?? ships.painted(builder, design, m);
    });
    const scars: number[] = [];
    const fuel: number[] = [];
    const metal: number[] = [];
    const charge: number[] = [];
    const unbuilt: number[] = [];
    const marks: (Float64Array | null)[] = [];
    for (let m = 0; m < design.modules.length; m++) {
        const from = bodyOf(shipOf(m));
        const was = moduleOf(m);
        marks.push(was < 0 ? null : ships.damage.scars.carriedAt(from, was));
        scars.push(was < 0 ? 0 : ships.damage.absorbedAt(from, was));
        fuel.push(was < 0 ? 0 : ships.fuel.held(from, was));
        metal.push(was < 0 ? 0 : ships.metal.held(from, was));
        charge.push(was < 0 ? 0 : ships.power.held(from, was));
        unbuilt.push(was < 0 ? 0 : ships.damage.unbuiltAt(from, was));
    }
    // A weld half sawn through stays half sawn through; a seam is new.
    const weldScars: number[] = [];
    for (const joint of joints(design)) {
        const ship = shipOf(joint.a);
        if (shipOf(joint.b) !== ship || moduleOf(joint.a) < 0 || moduleOf(joint.b) < 0) {
            weldScars.push(0);
            continue;
        }
        const k = jointBetween(ships.designs[ship]!, moduleOf(joint.a), moduleOf(joint.b));
        weldScars.push(ships.damage.cutAt(bodyOf(ship), k));
    }

    // Mounts are added before the old ones go, so that a freed slot cannot be
    // handed straight back out and leave two turrets sharing an index.
    const indices = new Int32Array(design.turrets.length);
    const cooldown = new Float64Array(design.turrets.length);
    const states = new Uint8Array(design.turrets.length);
    const barrels = new Int32Array(design.turrets.length);
    const targets = new Int32Array(design.turrets.length).fill(NO_TARGET);
    const aiming = new Int32Array(design.turrets.length).fill(NO_TARGET);
    const aims = new Int32Array(design.turrets.length).fill(WHOLE_SHIP);
    const schedule = new Float64Array(design.turrets.length);
    const specs = sides === null ? [] : design.modules.map((m) => m.spec);
    for (let t = 0; t < design.turrets.length; t++) {
        const mount = design.turrets[t]!;
        // Two sides on one body: the other side's modules are not this mount's
        // own ship downrange but something to shoot at.
        const mask =
            sides === null
                ? (mount.mount.mask ?? [])
                : triggerMask(
                      specs,
                      mount.module,
                      (_spec, k) => sides[k] === sides[mount.module] && (mount.hullLayer || design.modules[k]!.weaponsLayer),
                      shotSpread(mount.gun),
                  );
        const index = ships.turrets.add({ ...mount.mount, mask, owner: b });
        indices[t] = index;
        // Which mount this was, by the module it sits on.
        const ship = shipOf(mount.module);
        const module = moduleOf(mount.module);
        const was = ships.designs[ship]!;
        let before = -1;
        for (let k = 0; module >= 0 && k < was.turrets.length; k++) {
            if (was.turrets[k]!.module === module) before = k;
        }
        if (before < 0) continue;
        // Pointing and slewing as it was, turned into this hull's frame: a ship
        // merged in was flying a heading of its own.
        const turn = bodies.angle[bodyOf(ship)]! - bodies.angle[b]!;
        ships.turrets.carry(ships.turretIndex[ship]![before]!, index, turn);
        cooldown[t] = ships.cooldown[ship]![before]!;
        states[t] = ships.turretStates[ship]![before]!;
        barrels[t] = ships.nextBarrelToFire[ship]![before]!;
        targets[t] = ships.turretTarget[ship]![before]!;
        // Not what it was aiming at: a weld lands between aiming and firing, so
        // it holds fire until the next `command` has aimed it from the new hull.
        aims[t] = ships.turretAimModule[ship]![before]!;
        schedule[t] = ships.turretRethinkAt[ship]![before]!;
    }
    if (release) {
        const old = ships.turretIndex[i]!;
        for (let t = 0; t < old.length; t++) ships.turrets.remove(old[t]!);
    }

    ships.designs[i] = design;
    ships.hullDesign[b] = design;
    ships.sides[b] = sides;
    ships.paint[b] = paint;
    ships.turretIndex[i] = fixed(indices);
    ships.cooldown[i] = cooldown;
    ships.turretStates[i] = states;
    ships.nextBarrelToFire[i] = barrels;
    ships.turretTarget[i] = targets;
    ships.turretAiming[i] = aiming;
    ships.turretAimModule[i] = aims;
    ships.turretRethinkAt[i] = schedule;
    ships.throttles[i] = new Float64Array(design.engines.length);
    ships.lit[i] = new Uint8Array(design.engines.length);
    ships.landed[i] = new Float64Array(landedLength(design));
    ships.layouts[i] = null;
    ships.layoutVersion[i] = -1;
    ships.damage.register(b, design, scars, weldScars, unbuilt, marks);
    const leaks = leaksInto(ships, design.modules.length, (m) => ({ body: bodyOf(shipOf(m)), module: moduleOf(m) }));
    ships.fuel.register(b, design, fuel, leaks);
    ships.metal.register(b, design, metal);
    ships.power.register(b, design, charge);
    // Grown in place, every robot is where it was and about what it was about.
    // The robots each bay was building, wherever the bay came from.
    const made = (m: number): readonly number[] => {
        const was = moduleOf(m);
        return was < 0 ? [] : (ships.robots.buildingOn(bodyOf(shipOf(m)))?.[was] ?? []);
    };
    ships.robots.register(
        b,
        design,
        keepRobots ? (ships.robots.on(b) ?? []) : robotsInto(ships, design.modules.length, bodyOf, shipOf, moduleOf),
        made,
    );
    settleMass(ships, bodies, b);
    ships.cutSeen[i] = ships.damage.cutVersion(b);
    if (ships.mooredClaw[i]! >= 0) {
        if (claw >= 0) ships.mooredClaw[i] = claw;
        else ships.unpark(bodies, i, ships.now);
    }
}

/**
 * Every robot that comes over to a new design from the bodies its modules
 * were on, renumbered by where each module went.
 */
export function robotsInto(
    ships: Ships,
    n: number,
    bodyOf: (ship: number) => number,
    shipOf: (module: number) => number,
    moduleOf: (module: number) => number,
): Robot[] {
    const out: Robot[] = [];
    const sources: number[] = [];
    for (let m = 0; m < n; m++) {
        const body = bodyOf(shipOf(m));
        if (!sources.includes(body)) sources.push(body);
    }
    for (const body of sources) {
        const into = new Map<number, number>();
        for (let m = 0; m < n; m++) if (bodyOf(shipOf(m)) === body) into.set(moduleOf(m), m);
        for (const robot of ships.robots.take(body, (m) => into.get(m) ?? -1)) out.push(robot);
    }
    return out;
}

/** Every hole in a body that comes over to a new design, renumbered by where each module went. */
export function leaksInto(ships: Ships, n: number, from: (module: number) => { body: number; module: number }): Leak[] {
    const out: Leak[] = [];
    for (let m = 0; m < n; m++) {
        const { body, module } = from(m);
        for (const leak of ships.fuel.leaksOf(body)) if (leak.module === module) out.push({ ...leak, module: m });
    }
    return out;
}

/**
 * A body's mass and inertia: its design's, less the fuel and metal spent
 * from it and what damage has shed, and with every fighter parked on it.
 * Its centre of mass stays put.
 */
export function settleMass(ships: Ships, bodies: Bodies, b: number): void {
    const design = ships.hullDesign[b];
    // Something nothing moves stays that way.
    if (design === null || design === undefined || !(bodies.mass[b]! > 0)) return;
    const id = ships.hullBody[b]!;
    let parkedMass = 0;
    let parkedInertia = 0;
    for (let k = 0; k < ships.parkedShips.length; k++) {
        const f = ships.parkedShips[k]!;
        const fb = bodies.indexOf(ships.bodyIds[f]!);
        if (fb < 0 || bodies.indexOf(ships.bodyIds[ships.parkedOn[f]!]!) !== b) continue;
        const dx = bodies.x[fb]! - bodies.x[b]!;
        const dy = bodies.y[fb]! - bodies.y[b]!;
        ships.parkedMass[f] = bodies.mass[fb]!;
        parkedMass += bodies.mass[fb]!;
        parkedInertia += bodies.inertia[fb]! + bodies.mass[fb]! * (dx * dx + dy * dy);
    }
    bodies.setMass(
        id,
        parkedMass +
            design.mass -
            ships.fuel.spentMass(b) -
            ships.metal.spentMass(b) -
            ships.damage.shedMass(b) -
            ships.robots.missingMass(b) -
            ships.damage.unbuiltMass(b) +
            ships.robots.cargoMass(b),
    );
    bodies.setInertia(
        id,
        parkedInertia +
            design.inertia -
            ships.fuel.spentInertia(b) -
            ships.metal.spentInertia(b) -
            ships.damage.shedInertia(b) -
            ships.robots.missingInertia(b) -
            ships.damage.unbuiltInertia(b),
    );
}

/**
 * Settle every hull damage has shed mass from since last asked, counting
 * what it shed as discarded: it left at the hull's own speed, so the books
 * still balance. Done before anything reads a hull's mass to remake it.
 */
export function settleShed(ships: Ships, bodies: Bodies): void {
    ships.bodyStore = bodies;
    ships.damage.takeUnsettled(ships);
}

/** Damage's call back, for `settleShed`. */
export function settleShedOf(ships: Ships, b: number): void {
    const bodies = ships.bodyStore!;
    const mass = bodies.mass[b]!;
    const inertia = bodies.inertia[b]!;
    settleMass(ships, bodies, b);
    discardFrom(ships, bodies, b, mass, inertia);
}

/**
 * Count as discarded what body `b` lost since it weighed `mass` and turned
 * with `inertia`: it left at the body's own speed, so the books still
 * balance. Nothing, for a body nothing moves.
 */
export function discardFrom(ships: Ships, bodies: Bodies, b: number, mass: number, inertia: number): void {
    const kg = mass - bodies.mass[b]!;
    ships.discarded += kg;
    ships.discardedPx += kg * bodies.vx[b]!;
    ships.discardedPy += kg * bodies.vy[b]!;
    // Its share of the hull's turning, and of the hull's motion about the origin.
    ships.discardedL +=
        (inertia - bodies.inertia[b]!) * bodies.angularVel[b]! + kg * (bodies.x[b]! * bodies.vy[b]! - bodies.y[b]! * bodies.vx[b]!);
}

/** What each kept module has already absorbed, in the new design's order. */
export function scarsOf(ships: Ships, bodyIndex: number, keep: readonly number[]): number[] {
    const scars: number[] = [];
    for (let k = 0; k < keep.length; k++) scars.push(ships.damage.absorbedAt(bodyIndex, keep[k]!));
    return scars;
}

/**
 * What has already been cut out of each weld the piece keeps, in the new
 * design's joint order — a weld half sawn through stays half sawn through.
 */
export function weldScarsOf(ships: Ships, bodyIndex: number, was: ShipDesign, piece: ShipDesign, keep: readonly number[]): number[] {
    const scars: number[] = [];
    for (const joint of joints(piece)) {
        scars.push(ships.damage.cutAt(bodyIndex, jointBetween(was, keep[joint.a]!, keep[joint.b]!)));
    }
    return scars;
}

/**
 * Where a piece's centre of mass sits relative to the whole hull's, world
 * frame — the arm its share of the spin acts through.
 */
export function offsetOf(bodies: Bodies, b: number, was: ShipDesign, piece: ShipDesign): { x: number; y: number } {
    // Both centres are measured in the blueprint's frame, which is the body's
    // frame shifted rather than turned, so the difference needs only the
    // hull's angle to reach the world.
    const dx = piece.centreOfMassX - was.centreOfMassX;
    const dy = piece.centreOfMassY - was.centreOfMassY;
    const angle = bodies.angle[b]!;
    const c = cos(angle);
    const s = sin(angle);
    return { x: dx * c - dy * s, y: dx * s + dy * c };
}
