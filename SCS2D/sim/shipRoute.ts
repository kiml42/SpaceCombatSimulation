import type { Bodies } from "./bodies.js";
import { cos, length, max, min, sin, sqrt } from "./math.js";
import { moduleRadius } from "./modules.js";
import * as shipFlight from "./shipFlight.js";
import { type Ships, NO_TARGET, type Spot } from "./ships.js";

/**
 * Planning a way round what stands between a ship and where it wants to be.
 *
 * Keeping clear (`shipFlight.avoid`) only answers a near miss when it is close
 * and soon, so a ship flying straight at something behind an obstacle charges
 * at the obstacle and swerves late. This looks ahead instead: a ray to where
 * it wants to be, and round whatever it meets on the side that is shorter and
 * asks the least change of velocity to start on, at its clearance from it —
 * then round whatever stands in the way of that, until it has a clear line or
 * runs out of tries. What it keeps is the first corner, held relative to what
 * it goes round so that it moves with it, and replanned every `REPLAN_TICKS`.
 */

/** Steps between plans: a search is too heavy for every step. */
export const REPLAN_TICKS = 30;
/** Hulls this many times a ship's radius or more are planned round; smaller ones are only kept clear of. */
const BIG_HULL = 2;
/** How far outside an obstacle's clearance a corner is put, as a fraction of it, so the legs clear it. */
const CORNER_SLACK = 1.15;
/** Seconds the change of velocity a first leg asks for is worth, as distance at that speed. */
const DV_SECONDS = 2;
const MAX_OBSTACLES = 64;
const MAX_NODES = 32;

// Obstacles: centre, velocity, radius with clearance, and the ship and body each wraps.
const ox = new Float64Array(MAX_OBSTACLES);
const oy = new Float64Array(MAX_OBSTACLES);
const or = new Float64Array(MAX_OBSTACLES);
const oShip = new Int32Array(MAX_OBSTACLES);
const oBody = new Int32Array(MAX_OBSTACLES);
let obstacles = 0;

// The search: each node a point, the node it came from, the path length to it, and whether it is still open.
const nx = new Float64Array(MAX_NODES);
const ny = new Float64Array(MAX_NODES);
const nParent = new Int32Array(MAX_NODES);
const nCost = new Float64Array(MAX_NODES);
const nOpen = new Uint8Array(MAX_NODES);
const nVia = new Int32Array(MAX_NODES);
let nodes = 0;

const THEIRS: shipFlight.HitCircle = { x: 0, y: 0, vx: 0, vy: 0, r: 0 };

/**
 * Whether ship `i`, on body `b`, should go by a corner on its way to the
 * point (`gx`, `gy`), leaving it in `out` if so. `goal` is the ship it is
 * making for, never an obstacle itself; with `deck`, what stands up from its
 * deck is, at no clearance beyond touching, as for a fighter landing on it.
 * Replans every `REPLAN_TICKS`, or sooner once it reaches its corner.
 */
export function route(
    ships: Ships,
    bodies: Bodies,
    i: number,
    b: number,
    gx: number,
    gy: number,
    goal: number,
    deck: boolean,
    out: Spot,
): boolean {
    const due = ships.now - ships.routeAt[i]! >= REPLAN_TICKS || ships.routeGoal[i] !== goal;
    if (!due && ships.routeVia[i] !== NO_TARGET && cornerOf(ships, bodies, i, out)) {
        // Reached, or as good as: on to the next, or straight in.
        if (length(out.x - bodies.x[b]!, out.y - bodies.y[b]!) > ships.designs[i]!.radius * 2) return true;
    }
    if (!due && ships.routeVia[i] === NO_TARGET) return false;
    plan(ships, bodies, i, b, gx, gy, goal, deck);
    return ships.routeVia[i] !== NO_TARGET && cornerOf(ships, bodies, i, out);
}

/** Where ship `i`'s corner is now, moving with what it goes round, into `out`; false for none. */
export function cornerOf(ships: Ships, bodies: Bodies, i: number, out: Spot): boolean {
    const via = ships.routeVia[i]!;
    if (via === NO_TARGET || ships.alive[via] !== 1) return false;
    const vb = bodies.indexOf(ships.bodyIds[via]!);
    if (vb < 0) return false;
    out.x = bodies.x[vb]! + ships.routeDX[i]!;
    out.y = bodies.y[vb]! + ships.routeDY[i]!;
    out.vx = bodies.vx[vb]!;
    out.vy = bodies.vy[vb]!;
    out.radius = 0;
    return true;
}

function plan(ships: Ships, bodies: Bodies, i: number, b: number, gx: number, gy: number, goal: number, deck: boolean): void {
    ships.routeAt[i] = ships.now;
    ships.routeGoal[i] = goal;
    ships.routeVia[i] = NO_TARGET;
    const sx = bodies.x[b]!;
    const sy = bodies.y[b]!;
    gather(ships, bodies, i, b, sx, sy, gx, gy, goal, deck);
    if (obstacles === 0 || blocking(sx, sy, gx, gy, -1) < 0) return;

    const approach = ships.doctrines[i]!.approach;
    // Its velocity relative to what it makes for, which the first leg asks it to change.
    const gb = goal === NO_TARGET ? -1 : bodies.indexOf(ships.bodyIds[goal]!);
    const rvx = bodies.vx[b]! - (gb >= 0 ? bodies.vx[gb]! : 0);
    const rvy = bodies.vy[b]! - (gb >= 0 ? bodies.vy[gb]! : 0);

    nodes = 1;
    nx[0] = sx;
    ny[0] = sy;
    nParent[0] = -1;
    nCost[0] = 0;
    nOpen[0] = 1;
    nVia[0] = -1;
    for (;;) {
        // The open node with the shortest way through it.
        let pick = -1;
        let best = Infinity;
        for (let n = 0; n < nodes; n++) {
            if (nOpen[n] !== 1) continue;
            const f = nCost[n]! + length(gx - nx[n]!, gy - ny[n]!);
            if (f < best) {
                best = f;
                pick = n;
            }
        }
        if (pick < 0) return;
        nOpen[pick] = 0;
        const hit = blocking(nx[pick]!, ny[pick]!, gx, gy, nVia[pick]!);
        if (hit < 0) {
            if (pick === 0) return;
            // The first corner on the way.
            let first = pick;
            while (nParent[first] !== 0) first = nParent[first]!;
            const k = nVia[first]!;
            const vb = oBody[k]!;
            ships.routeVia[i] = oShip[k]!;
            ships.routeDX[i] = nx[first]! - bodies.x[vb]!;
            ships.routeDY[i] = ny[first]! - bodies.y[vb]!;
            return;
        }
        for (let side = -1; side <= 1; side += 2) {
            if (nodes >= MAX_NODES) break;
            let k = hit;
            let cx = 0;
            let cy = 0;
            // Round the obstacle on this side; if something else stands in the way of
            // the corner, or the corner is inside it, round that first, on the same side.
            for (let tries = 0; tries < MAX_OBSTACLES && k >= 0; tries++) {
                corner(nx[pick]!, ny[pick]!, gx, gy, k, side);
                cx = cornerX;
                cy = cornerY;
                const next = inside(cx, cy) >= 0 ? inside(cx, cy) : blocking(nx[pick]!, ny[pick]!, cx, cy, k);
                if (next < 0 || next === k) break;
                k = next;
            }
            if (inside(cx, cy) >= 0) continue;
            let cost = nCost[pick]! + length(cx - nx[pick]!, cy - ny[pick]!);
            if (pick === 0) {
                const leg = length(cx - sx, cy - sy);
                if (leg > 0) {
                    const want = approach.approachSpeed;
                    cost += DV_SECONDS * length(((cx - sx) / leg) * want - rvx, ((cy - sy) / leg) * want - rvy);
                }
            }
            nx[nodes] = cx;
            ny[nodes] = cy;
            nParent[nodes] = pick;
            nCost[nodes] = cost;
            nOpen[nodes] = 1;
            nVia[nodes] = k;
            nodes++;
        }
    }
}

let cornerX = 0;
let cornerY = 0;

/** A corner beside obstacle `k`, on side `side` of the line from (`px`, `py`) to (`qx`, `qy`), into `cornerX`, `cornerY`. */
function corner(px: number, py: number, qx: number, qy: number, k: number, side: number): void {
    const dx = qx - px;
    const dy = qy - py;
    const d = length(dx, dy);
    const ux = d > 0 ? dx / d : 1;
    const uy = d > 0 ? dy / d : 0;
    const r = or[k]! * CORNER_SLACK;
    cornerX = ox[k]! - uy * side * r;
    cornerY = oy[k]! + ux * side * r;
}

/** The obstacle the segment from (`px`, `py`) to (`qx`, `qy`) first enters, but `skip`; -1 for none. */
function blocking(px: number, py: number, qx: number, qy: number, skip: number): number {
    const dx = qx - px;
    const dy = qy - py;
    const span = dx * dx + dy * dy;
    let first = -1;
    let soonest = Infinity;
    for (let k = 0; k < obstacles; k++) {
        if (k === skip) continue;
        const t = span > 0 ? max(0, min(1, ((ox[k]! - px) * dx + (oy[k]! - py) * dy) / span)) : 0;
        const cx = px + dx * t - ox[k]!;
        const cy = py + dy * t - oy[k]!;
        const r = or[k]!;
        if (cx * cx + cy * cy >= r * r) continue;
        // Where along it the segment comes into the circle.
        const along = t - sqrt(max(0, r * r - (cx * cx + cy * cy)) / max(span, 1e-9));
        if (along < soonest) {
            soonest = along;
            first = k;
        }
    }
    return first;
}

/** The obstacle point (`x`, `y`) is inside, or -1. */
function inside(x: number, y: number): number {
    for (let k = 0; k < obstacles; k++) {
        const dx = x - ox[k]!;
        const dy = y - oy[k]!;
        if (dx * dx + dy * dy < or[k]! * or[k]!) return k;
    }
    return -1;
}

/**
 * What ship `i` plans round on its way from (`sx`, `sy`) to (`gx`, `gy`):
 * rocks and hulls well larger than it, at their clearance; and with `deck`,
 * what stands up from `goal`'s deck, at touching.
 */
function gather(
    ships: Ships,
    bodies: Bodies,
    i: number,
    b: number,
    sx: number,
    sy: number,
    gx: number,
    gy: number,
    goal: number,
    deck: boolean,
): void {
    obstacles = 0;
    const mine = ships.designs[i]!.radius;
    const clearance = mine * ships.doctrines[i]!.approach.separationRadii;
    const reach = length(gx - sx, gy - sy);
    for (let t = 0; t < ships.alive.length && obstacles < MAX_OBSTACLES; t++) {
        if (t === i || ships.alive[t] === 0 || ships.home[t] === i) continue;
        const ob = bodies.indexOf(ships.bodyIds[t]!);
        if (ob < 0 || ob === b || bodies.ghost[ob] === 1 || !ships.meets(b, ob)) continue;
        if (t === goal) {
            if (deck) addDeck(ships, bodies, t, ob, mine);
            continue;
        }
        const big = ships.rockFlag[t] === 1 || ships.designs[t]!.radius >= BIG_HULL * mine;
        if (!big) continue;
        shipFlight.hitCircle(ships, bodies, t, ob, i, THEIRS);
        if (!(THEIRS.r > 0)) continue;
        const r = THEIRS.r + mine + clearance;
        // Only what could stand between: within its clearance of the way, or of a detour round it.
        if (distanceToSegment(THEIRS.x, THEIRS.y, sx, sy, gx, gy) > r + reach / 2) continue;
        add(THEIRS.x, THEIRS.y, r, t, ob);
    }
}

/** What stands up from ship `t`'s deck, on body `ob`, one module at a time, at touching a hull of radius `mine`. */
function addDeck(ships: Ships, bodies: Bodies, t: number, ob: number, mine: number): void {
    const design = ships.designs[t]!;
    const c = cos(bodies.angle[ob]!);
    const s = sin(bodies.angle[ob]!);
    for (let m = 0; m < design.modules.length && obstacles < MAX_OBSTACLES; m++) {
        const module = design.modules[m]!;
        if (!module.weaponsLayer || ships.damage.spent(ob, m)) continue;
        add(
            bodies.x[ob]! + module.x * c - module.y * s,
            bodies.y[ob]! + module.x * s + module.y * c,
            moduleRadius(module.spec) + mine,
            t,
            ob,
        );
    }
}

function add(x: number, y: number, r: number, ship: number, body: number): void {
    ox[obstacles] = x;
    oy[obstacles] = y;
    or[obstacles] = r;
    oShip[obstacles] = ship;
    oBody[obstacles] = body;
    obstacles++;
}

function distanceToSegment(x: number, y: number, px: number, py: number, qx: number, qy: number): number {
    const dx = qx - px;
    const dy = qy - py;
    const span = dx * dx + dy * dy;
    const t = span > 0 ? max(0, min(1, ((x - px) * dx + (y - py) * dy) / span)) : 0;
    return length(px + dx * t - x, py + dy * t - y);
}
