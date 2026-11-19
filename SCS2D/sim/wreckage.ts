import type { Bodies } from "./bodies.js";
import { OUTLET_A, OUTLET_B, type Contacts } from "./collision.js";
import { SHATTER } from "./damage.js";
import { moduleLayers } from "./hull.js";
import { abs, cos, log, max, min, pow, sin, sqrt, TAU } from "./math.js";
import { ROUND_SHRAPNEL, ROUND_WRECKAGE, type Projectiles } from "./projectiles.js";
import type { Rng } from "./rng.js";
import { blowKey, heldMass } from "./shipBreakup.js";
import type { Ships } from "./ships.js";
import type { World } from "./world.js";

/**
 * A module shattered in a collision flies on as wreckage.
 *
 * The collision has already stopped the whole hull by the time anything knows
 * a module broke, but a module that shattered broke before the rest of the
 * hull could stop it. So a share of it (`WRECKAGE_SHARE`) carries on as
 * fragments at the velocity its place on the hull had before the impulse,
 * spin and all, and the hull it struck gives back the momentum it spent
 * stopping them. Their energy against that hull is at most what the crush
 * could not spend on their side (`Contacts.spareA`/`spareB`): energy that was
 * thrown away goes on as wreckage instead, and none is made.
 *
 * The module is still discarded whole when it goes; what flew on is taken back
 * out of that account as it is thrown, at the velocity it had then.
 *
 * Fragments are rounds, of random sizes, so armour stops them as it stops any
 * round of their mass and calibre. They pass through the hull they came from,
 * which is going their way, and fly briefly.
 */

/** The share of a shattered module's mass that flies on as fragments; the rest is debris. */
export const WRECKAGE_SHARE = 0.5;
/** The most fragments one module breaks into. */
export const MOST_FRAGMENTS = 8;
/** The least a fragment weighs, kg, so a light module breaks into fewer. */
const LEAST_FRAGMENT = 1;
/** Their density, kg/m³, which sizes their calibre: steel's. */
const FRAGMENT_DENSITY = 7800;
/** Seconds a fragment flies: enough to cross what it struck. */
export const WRECKAGE_LIFE = 0.5;
/** How far a fragment's velocity strays from the module's, as a share of its speed against what it struck. */
const WRECKAGE_SPREAD = 0.1;

const masses: number[] = [];
const fvx: number[] = [];
const fvy: number[] = [];

/**
 * Throw on as wreckage every module this step's collisions have shattered so
 * far, into `projectiles`. Call after the collisions' damage is spent and
 * before anything else adds to it; returns how many fragments it threw.
 */
export function throwWreckage(ships: Ships, bodies: Bodies, projectiles: Projectiles, contacts: Contacts, rng: Rng): number {
    const damage = ships.damage;
    let thrown = 0;
    for (let e = 0; e < damage.stepCount; e++) {
        const b = damage.stepBody[e]!;
        const m = damage.stepModule[e]!;
        const capacity = damage.capacityOf(b, m);
        // As `shatter` will judge it.
        if (!(capacity > 0) || damage.stepJoules[e]! < SHATTER * capacity) continue;
        if (bodies.alive[b] === 0 || (ships.shipByBody[b] ?? -1) < 0 || ships.pilots[b] != null) continue;
        if (ships.thrown.has(blowKey(b, m))) continue;
        const design = ships.designs[ships.shipByBody[b]!]!;
        const placed = design.modules[m]!;

        // The module in the world.
        const c = cos(bodies.angle[b]!);
        const s = sin(bodies.angle[b]!);
        const rx = placed.x * c - placed.y * s;
        const ry = placed.x * s + placed.y * c;
        const mx = bodies.x[b]! + rx;
        const my = bodies.y[b]! + ry;

        // The contact on this body nearest it: what shattered it.
        let k = -1;
        let nearest = Infinity;
        for (let n = 0; n < contacts.count; n++) {
            if (!(contacts.impulse[n]! > 0) || (contacts.a[n] !== b && contacts.b[n] !== b)) continue;
            const d = (contacts.x[n]! - mx) ** 2 + (contacts.y[n]! - my) ** 2;
            if (d < nearest) {
                nearest = d;
                k = n;
            }
        }
        if (k < 0) continue;
        const isA = contacts.a[k] === b;
        const o = isA ? contacts.b[k]! : contacts.a[k]!;
        const spare = isA ? contacts.spareA[k]! : contacts.spareB[k]!;
        if (!(spare > 0)) continue;

        // Its velocity now, and before the contact's impulse: `a` took it against the normal.
        const spin = bodies.angularVel[b]!;
        const postX = bodies.vx[b]! - spin * ry;
        const postY = bodies.vy[b]! + spin * rx;
        const sign = isA ? -1 : 1;
        const jx = sign * contacts.nx[k]! * contacts.impulse[k]!;
        const jy = sign * contacts.ny[k]! * contacts.impulse[k]!;
        const cx = contacts.x[k]! - bodies.x[b]!;
        const cy = contacts.y[k]! - bodies.y[b]!;
        const turn = (cx * jy - cy * jx) * bodies.invInertia[b]!;
        const preX = postX - jx * bodies.invMass[b]! + turn * ry;
        const preY = postY - jy * bodies.invMass[b]! - turn * rx;

        // What it struck, where it struck it.
        const ox = contacts.x[k]! - bodies.x[o]!;
        const oy = contacts.y[k]! - bodies.y[o]!;
        const otherX = bodies.vx[o]! - bodies.angularVel[o]! * oy;
        const otherY = bodies.vy[o]! + bodies.angularVel[o]! * ox;
        const relX = preX - otherX;
        const relY = preY - otherY;
        // Only what was going into it: the normal runs from `a` to `b`.
        if (!(-sign * (relX * contacts.nx[k]! + relY * contacts.ny[k]!) > 0)) continue;
        const speed = sqrt(relX * relX + relY * relY);

        const mass = WRECKAGE_SHARE * heldMass(ships, b, design, m);
        const count = min(MOST_FRAGMENTS, max(1, (mass / LEAST_FRAGMENT) | 0), 2 + ((rng.nextFloat() * (MOST_FRAGMENTS - 1)) | 0));
        if (!(mass > 0)) continue;

        // Random sizes: an exponential share each, which gives a few large and many small.
        let total = 0;
        for (let f = 0; f < count; f++) {
            masses[f] = -log(1 - rng.nextFloat() * 0.999999);
            total += masses[f]!;
        }
        // Each the module's velocity against what it struck, strayed a little, the strays cancelling by mass.
        let meanX = 0;
        let meanY = 0;
        for (let f = 0; f < count; f++) {
            masses[f] = (mass * masses[f]!) / total;
            const angle = rng.nextFloat() * TAU;
            const stray = WRECKAGE_SPREAD * speed * sqrt(rng.nextFloat());
            fvx[f] = relX + cos(angle) * stray;
            fvy[f] = relY + sin(angle) * stray;
            meanX += masses[f]! * cos(angle) * stray;
            meanY += masses[f]! * sin(angle) * stray;
        }
        let energy = 0;
        for (let f = 0; f < count; f++) {
            fvx[f] = fvx[f]! - meanX / mass;
            fvy[f] = fvy[f]! - meanY / mass;
            energy += 0.5 * masses[f]! * (fvx[f]! * fvx[f]! + fvy[f]! * fvy[f]!);
        }
        // No more energy against it than the crush threw away on this side.
        const scale = energy > spare ? sqrt(spare / energy) : 1;

        const ux = relX / speed;
        const uy = relY / speed;
        const layers = moduleLayers(placed, ships.layersOf(b));
        let px = 0;
        let py = 0;
        for (let f = 0; f < count; f++) {
            const vx = otherX + fvx[f]! * scale;
            const vy = otherY + fvy[f]! * scale;
            px += masses[f]! * (vx - postX);
            py += masses[f]! * (vy - postY);
            // From somewhere across the module, behind its middle as it was going.
            const across = (rng.nextFloat() - 0.5) * placed.spec.width;
            const back = rng.nextFloat() * 0.5 * placed.spec.length;
            projectiles.spawn({
                x: mx - ux * back - uy * across,
                y: my - uy * back + ux * across,
                vx,
                vy,
                width: pow(masses[f]! / FRAGMENT_DENSITY, 1 / 3),
                ttl: WRECKAGE_LIFE,
                mass: masses[f]!,
                owner: b,
                ship: ships.shipByBody[b]!,
                layers,
                kind: ROUND_WRECKAGE,
            });
        }
        // What it struck spent that momentum stopping them, and did not.
        const turnO = (ox * -py - oy * -px) * bodies.invInertia[o]!;
        bodies.vx[o]! -= px * bodies.invMass[o]!;
        bodies.vy[o]! -= py * bodies.invMass[o]!;
        bodies.angularVel[o]! += turnO;
        ships.thrown.add(blowKey(b, m));
        // The whole module is counted discarded when it goes, at its hull's velocity
        // then; what flew on is counted here instead, as it was before it flew.
        ships.discarded -= mass;
        ships.discardedPx -= mass * postX;
        ships.discardedPy -= mass * postY;
        ships.discardedL -= mass * (mx * postY - my * postX);
        thrown += count;
    }
    return thrown;
}

/**
 * Throw on as shrapnel every piece broken off this step too small to keep
 * (`detach`), into `projectiles`, and say how many. Call after severing.
 *
 * Such a piece is never put in the world as a body, but its metal is still
 * going where its hull was going: a torpedo cut apart on its way in, or torn
 * apart on its target, goes on into it. Each flies on as one round of its own
 * mass, as wide as its footprint, at the velocity it broke off with, through
 * the hull it came off and for `WRECKAGE_LIFE`. It was counted discarded as
 * it broke off, and is taken back out of that account here.
 */
export function throwShrapnel(ships: Ships, projectiles: Projectiles): number {
    const s = ships.shrapnel;
    for (let k = 0; k < s.count; k++) {
        const mass = s.mass[k]!;
        const x = s.x[k]!;
        const y = s.y[k]!;
        const vx = s.vx[k]!;
        const vy = s.vy[k]!;
        projectiles.spawn({
            x,
            y,
            vx,
            vy,
            width: s.size[k]!,
            ttl: WRECKAGE_LIFE,
            mass,
            owner: s.owner[k]!,
            ship: s.ship[k]!,
            layers: s.layers[k]!,
            kind: ROUND_SHRAPNEL,
        });
        ships.discarded -= mass;
        ships.discardedPx -= mass * vx;
        ships.discardedPy -= mass * vy;
        ships.discardedL -= mass * (x * vy - y * vx);
    }
    const thrown = s.count;
    s.count = 0;
    return thrown;
}

/**
 * Spend every hull this step's collisions would destroy outright
 * (`Contacts.spent`) on what it met, as rounds, and say how many it spent.
 *
 * A hull that meets another so hard that its share of the blow is more than
 * all of it can stand does not bounce: it comes apart, and what it does is
 * what each part of it does, arriving. So every module goes on as a
 * round of its mass, at the velocity its place on the hull had, as wide as it
 * is across the way it is going, from where it was, taken back out of what
 * it struck. The nose meets the plate first and the tail after it, each by
 * the law any round meets armour by: what gets through goes on into the
 * internals, and what stops spends all it has there. The rounds carry the
 * ship's mass and momentum between them, and are credited to it.
 */
export function spendHulls(ships: Ships, world: World, projectiles: Projectiles, contacts: Contacts): number {
    const bodies = world.bodies;
    let spent = 0;
    for (let k = 0; k < contacts.count; k++) {
        const sides = contacts.spent[k]!;
        for (const side of [OUTLET_A, OUTLET_B]) {
            if ((sides & side) === 0) continue;
            const r = side === OUTLET_A ? contacts.a[k]! : contacts.b[k]!;
            const o = side === OUTLET_A ? contacts.b[k]! : contacts.a[k]!;
            const i = ships.shipByBody[r] ?? -1;
            if (i < 0 || bodies.alive[r] === 0 || ships.alive[i] === 0) continue;
            const design = ships.designs[i]!;

            // The way it is going into what it struck, at the contact.
            const ox = contacts.x[k]! - bodies.x[o]!;
            const oy = contacts.y[k]! - bodies.y[o]!;
            const relX = bodies.vx[r]! - (bodies.vx[o]! - bodies.angularVel[o]! * oy);
            const relY = bodies.vy[r]! - (bodies.vy[o]! + bodies.angularVel[o]! * ox);
            const speed = sqrt(relX * relX + relY * relY);
            if (!(speed > 0)) continue;
            const ux = relX / speed;
            const uy = relY / speed;
            // Back out of what it struck: as deep as it is in, along the way it came.
            const square = abs(ux * contacts.nx[k]! + uy * contacts.ny[k]!);
            const back = contacts.depth[k]! / max(0.2, square) + 0.05;

            let held = 0;
            for (let m = 0; m < design.modules.length; m++) held += heldMass(ships, r, design, m);
            if (!(held > 0)) continue;
            // So the rounds weigh what the body does, to the gram.
            const scale = bodies.mass[r]! / held;
            const c = cos(bodies.angle[r]!);
            const s = sin(bodies.angle[r]!);
            const spin = bodies.angularVel[r]!;
            for (let m = 0; m < design.modules.length; m++) {
                const mass = heldMass(ships, r, design, m) * scale;
                if (!(mass > 0)) continue;
                const placed = design.modules[m]!;
                const rx = placed.x * c - placed.y * s;
                const ry = placed.x * s + placed.y * c;
                // Its extent across the way it is going.
                const along = bodies.angle[r]! + placed.angle;
                const ax = cos(along);
                const ay = sin(along);
                const across = abs(placed.spec.length * (-ax * uy + ay * ux)) + abs(placed.spec.width * (ay * uy + ax * ux));
                projectiles.spawn({
                    x: bodies.x[r]! + rx - ux * back,
                    y: bodies.y[r]! + ry - uy * back,
                    vx: bodies.vx[r]! - spin * ry,
                    vy: bodies.vy[r]! + spin * rx,
                    width: max(across, 0.01),
                    ttl: WRECKAGE_LIFE,
                    mass,
                    ship: i,
                    // In what it was flying in: a fighter above the deck meets only what stands up out of it.
                    layers: moduleLayers(placed, ships.layersOf(r)),
                    kind: ROUND_WRECKAGE,
                });
            }

            ships.damage.forget(r);
            ships.fuel.forget(r);
            ships.metal.forget(r);
            ships.power.forget(r);
            ships.robots.forget(r);
            ships.shipByBody[r] = -1;
            ships.remove(i);
            world.destroy(ships.bodyIds[i]!);
            spent++;
        }
    }
    return spent;
}
