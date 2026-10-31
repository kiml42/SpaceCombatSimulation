import type { Bodies } from "./bodies.js";
import type { ShipDesign } from "./blueprint.js";
import { BOTH_LAYERS, HULL_LAYER, moduleLayers, OWN_LAYERS, type HullDesigns } from "./hull.js";
import { abs, cos, max, min, sin, sqrt } from "./math.js";
import { domeOf, isDomed, MOST_CORNERS, shapeOf } from "./shape.js";
import type { ModuleSpec } from "./modules.js";

/**
 * Hulls that are solid: ships meeting each other rather than passing through.
 *
 * **Impulse-based, single pass** (DESIGN.md §4). Stacking and resting contact
 * are artefacts of a persistent force pressing bodies together; in space there
 * is no such force, so the hard case a contact solver is usually built for
 * never arises. A collision here is a rare, violent event between two things
 * that were flying free a moment ago and will be flying free a moment later.
 *
 * Geometry is the same two-stage question shots ask: the bounding circles say
 * which pairs *could* have met, and the module boxes say whether they did and
 * where. A circle is not where the hull is, so resolving against one would
 * have ships bouncing off empty space beside each other's bows.
 *
 * A body with no hull does not collide. Everything in a battle is a ship or
 * the wreck of one, and a bare mass with a radius — a test fixture's drifting
 * target — is not a shape anything can hit.
 */

/** How much of the closing speed is given back. Ships are not billiard balls. */
export const RESTITUTION = 0.15;

/**
 * Overlap left alone, metres.
 *
 * Pushing out the last centimetre buys nothing and costs a jitter: two hulls
 * touching within this are treated as touching, not as overlapping.
 */
const PENETRATION_SLOP = 0.02;

/** How much of the remaining overlap is corrected each step. */
const CORRECTION = 0.8;

/**
 * Rock gives under a hull: within `ROCK_SINK` of overlap it pushes back like a
 * damper, `ROCK_DAMPING` newtons for each metre a second it is closing, and
 * nothing once the two stop, so a slow touch settles in rather than rings.
 * Deeper, it is met hard. A loaded Salvager at a claw's 2.5 m/s stops in about
 * a metre, spread over the steps it takes rather than in one blow.
 */
export const ROCK_DAMPING = 4e5;
export const ROCK_SINK = 1;

/**
 * Nothing sinks into rock further than this share of its own thinnest module,
 * or a piece thinner than `ROCK_SINK` would sink in whole and on through.
 */
export const ROCK_SINK_SHARE = 0.5;

/**
 * How hard what rests on rock or a kernel holds against sliding: the most
 * sideways impulse a contact gives, as a share of the impulse along it. A
 * wreck lying on a slowly turning major turns with it, rather than sliding
 * to and fro across a facet under the pull of its well.
 */
export const ROCK_FRICTION = 0.6;

/**
 * A claw meeting something square on stabs into it: pushed back by a spring,
 * per metre of the claw's width `CLAW_STIFFNESS` newtons for each metre in and
 * `CLAW_DAMPING` for each metre a second closing, no harder than the spring at
 * `CLAW_DEPTH` of its length in, where it stops hard. Sideways it gives nothing.
 */
export const CLAW_STIFFNESS = 1.5e6;
export const CLAW_DAMPING = 4.5e5;
export const CLAW_DEPTH = 0.5;

/** Cosine of how far off its bow a claw can meet something and still close on it: 45°. */
export const CLAW_ALIGN = 0.7071067811865476;

/** What a contact's claw is doing: nothing, stabbing in from `a` or from `b`, or going in too fast to stop short of its full depth. */
export const enum Stab {
    None = 0,
    A = 1,
    B = 2,
    Stopped = 3,
}

/**
 * Contacts found this step, in the order the bodies are indexed.
 *
 * Parallel arrays, reused between steps, so a fleet action's worth of contacts
 * allocates nothing — and the order is the body order, which is what keeps the
 * resolution reproducible.
 */
export class Contacts {
    /** The two bodies, always with `a` the lower index. */
    a = new Int32Array(64);
    b = new Int32Array(64);
    /** Where they met, world frame. */
    x = new Float64Array(64);
    y = new Float64Array(64);
    /** Unit normal, pointing from `a` towards `b`. */
    nx = new Float64Array(64);
    ny = new Float64Array(64);
    /** How far they overlap along that normal, metres. */
    depth = new Float64Array(64);
    /** Which module of each hull met, for a damage model to spend the hit on. */
    moduleA = new Int32Array(64);
    moduleB = new Int32Array(64);
    /** Closing speed along the normal when they met, m/s. Zero if separating. */
    closing = new Float64Array(64);
    /**
     * Impulse the solver put through the contact, newton-seconds, along the
     * normal — what `a` took one way and `b` the other. Zero for a pair already
     * coming apart, and what decides whether a hull holds together (§4).
     */
    impulse = new Float64Array(64);
    /** What the claw at the contact is doing (`Stab`), if one met it. */
    stab = new Uint8Array(64);
    count = 0;

    clear(): void {
        this.count = 0;
    }

    push(a: number, b: number, x: number, y: number, nx: number, ny: number, depth: number, moduleA: number, moduleB: number): void {
        if (this.count === this.a.length) this.grow();
        const i = this.count++;
        this.a[i] = a;
        this.b[i] = b;
        this.x[i] = x;
        this.y[i] = y;
        this.nx[i] = nx;
        this.ny[i] = ny;
        this.depth[i] = depth;
        this.moduleA[i] = moduleA;
        this.moduleB[i] = moduleB;
        this.closing[i] = 0;
        this.impulse[i] = 0;
        this.stab[i] = Stab.None;
    }

    private grow(): void {
        const size = this.a.length * 2;
        const a = new Int32Array(size);
        const b = new Int32Array(size);
        const x = new Float64Array(size);
        const y = new Float64Array(size);
        const nx = new Float64Array(size);
        const ny = new Float64Array(size);
        const depth = new Float64Array(size);
        const moduleA = new Int32Array(size);
        const moduleB = new Int32Array(size);
        const closing = new Float64Array(size);
        const impulse = new Float64Array(size);
        const stab = new Uint8Array(size);
        stab.set(this.stab);
        this.stab = stab;
        a.set(this.a);
        b.set(this.b);
        x.set(this.x);
        y.set(this.y);
        nx.set(this.nx);
        ny.set(this.ny);
        depth.set(this.depth);
        moduleA.set(this.moduleA);
        moduleB.set(this.moduleB);
        closing.set(this.closing);
        impulse.set(this.impulse);
        this.impulse = impulse;
        this.a = a;
        this.b = b;
        this.x = x;
        this.y = y;
        this.nx = nx;
        this.ny = ny;
        this.depth = depth;
        this.moduleA = moduleA;
        this.moduleB = moduleB;
        this.closing = closing;
    }
}

/**
 * One module's outline in the world: where it is, and what shape it is there.
 *
 * A box is held as its centre, its two axes and its half extents, which is
 * what the separating-axis test below wants and is two of our own sines to
 * build. A module that is not a box (`shape.ts`) carries its corners instead,
 * and `count` is which of the two it is: zero for a box, three for a triangle.
 */
interface Box {
    x: number;
    y: number;
    /** Unit axis along the module's length, and the one across it. */
    ux: number;
    uy: number;
    halfLength: number;
    halfWidth: number;
    /** Corner distance, for rejecting a pair before the separating-axis test. */
    radius: number;
    /** Corners in the world, `x, y` pairs, for a module that is not a box. */
    corners: Float64Array;
    /** How many of them there are, and zero for a box. */
    count: number;
}

/** Fill `out` with a module's outline in the world, given its body's pose. */
function boxOf(
    design: ShipDesign,
    module: number,
    bx: number,
    by: number,
    angle: number,
    out: Box,
    triangle: readonly number[] | null = shapeOf(design.modules[module]!.spec),
): void {
    const m = design.modules[module]!;
    const c = cos(angle);
    const s = sin(angle);
    out.x = bx + m.x * c - m.y * s;
    out.y = by + m.x * s + m.y * c;
    const own = angle + m.angle;
    out.ux = cos(own);
    out.uy = sin(own);
    if (triangle === null) {
        out.count = 0;
        out.halfLength = m.spec.length * 0.5;
        out.halfWidth = m.spec.width * 0.5;
        out.radius = sqrt(out.halfLength * out.halfLength + out.halfWidth * out.halfWidth);
        return;
    }
    // The corners are written about the module's own centre, which is where its
    // position puts it, so the pose turns them and the centre carries them.
    out.count = triangle.length / 2;
    let furthest = 0;
    for (let i = 0; i < triangle.length; i += 2) {
        const x = triangle[i]!;
        const y = triangle[i + 1]!;
        out.corners[i] = out.x + x * out.ux - y * out.uy;
        out.corners[i + 1] = out.y + x * out.uy + y * out.ux;
        furthest = max(furthest, sqrt(x * x + y * y));
    }
    out.halfLength = 0;
    out.halfWidth = 0;
    out.radius = furthest;
}

/**
 * Every module of a hull, in the world.
 *
 * Built once per hull per pair rather than once per module pair: the boxes
 * cost two of our own sines apiece, and a thirteen-module ship against another
 * is a hundred and sixty-nine pairs that would otherwise rebuild them.
 */
function boxesOf(design: ShipDesign, bx: number, by: number, angle: number, out: Box[]): void {
    for (let m = 0; m < design.modules.length; m++) {
        if (out.length <= m) {
            out.push({
                x: 0,
                y: 0,
                ux: 1,
                uy: 0,
                halfLength: 0,
                halfWidth: 0,
                radius: 0,
                corners: new Float64Array(MOST_CORNERS * 2),
                count: 0,
            });
        }
        boxOf(design, m, bx, by, angle, out[m]!);
    }
}

/** How far a box reaches along an axis from its centre. */
function reach(box: Box, ax: number, ay: number): number {
    // The across axis is the along axis turned a quarter turn: (-uy, ux).
    return abs(box.halfLength * (box.ux * ax + box.uy * ay)) + abs(box.halfWidth * (-box.uy * ax + box.ux * ay));
}

/**
 * The nearest and furthest an outline reaches along an axis, written into
 * `span` as absolute projections rather than as a reach from a centre.
 *
 * A box reaches the same distance either way from its middle, so a half extent
 * says everything about it; a triangle does not, and asking it for one would
 * put its centroid halfway between its corners' projections and leave contacts
 * resolving against a shape the ship has not got.
 */
function project(box: Box, ax: number, ay: number, span: { lo: number; hi: number }): void {
    if (box.count === 0) {
        const centre = box.x * ax + box.y * ay;
        const half = reach(box, ax, ay);
        span.lo = centre - half;
        span.hi = centre + half;
        return;
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < box.count * 2; i += 2) {
        const p = box.corners[i]! * ax + box.corners[i + 1]! * ay;
        lo = min(lo, p);
        hi = max(hi, p);
    }
    span.lo = lo;
    span.hi = hi;
}

/** The separating axes an outline contributes, written into `out`. */
function axesOf(box: Box, out: Float64Array, at: number): number {
    if (box.count === 0) {
        out[at] = box.ux;
        out[at + 1] = box.uy;
        out[at + 2] = -box.uy;
        out[at + 3] = box.ux;
        return 2;
    }
    for (let i = 0; i < box.count; i++) {
        const a = i * 2;
        const b = ((i + 1) % box.count) * 2;
        const ex = box.corners[b]! - box.corners[a]!;
        const ey = box.corners[b + 1]! - box.corners[a + 1]!;
        const span = sqrt(ex * ex + ey * ey);
        out[at + i * 2] = span > 0 ? ey / span : 1;
        out[at + i * 2 + 1] = span > 0 ? -ex / span : 0;
    }
    return box.count;
}

/**
 * The middle of the region two overlapping boxes share, written into `point`.
 *
 * The middle rather than the deepest corner, which is the difference between a
 * hull that shoves and a hull that spins: two boxes meeting face to face share
 * a strip of face, and the force acts through the middle of it. Taking a
 * corner instead invents a lever arm, and two ships meeting squarely nose to
 * nose would come apart tumbling.
 *
 * Measured along the contact normal and across it, which are orthogonal, so
 * the two midpoints are the point.
 */
function contactPoint(a: Box, b: Box, nx: number, ny: number): void {
    const tx = -ny;
    const ty = nx;

    // Across the normal: the strip both outlines cover.
    project(a, tx, ty, spanA);
    project(b, tx, ty, spanB);
    const across = (max(spanA.lo, spanB.lo) + min(spanA.hi, spanB.hi)) * 0.5;

    // Along it: between the face of one and the face of the other.
    project(a, nx, ny, spanA);
    project(b, nx, ny, spanB);
    const depth = (spanA.hi + spanB.lo) * 0.5;

    point.x = nx * depth + tx * across;
    point.y = ny * depth + ty * across;
}

/** Scratch, so finding contacts allocates nothing after the first few steps. */
const boxesA: Box[] = [];
const boxesB: Box[] = [];
const blankBox = (): Box => ({
    x: 0,
    y: 0,
    ux: 1,
    uy: 0,
    halfLength: 0,
    halfWidth: 0,
    radius: 0,
    corners: new Float64Array(MOST_CORNERS * 2),
    count: 0,
});
/** A turret's dome on either hull of a pair, where they meet above the deck alone. */
const domeA = blankBox();
const domeB = blankBox();
/** The bodies that have hulls this step, and what they are built from. */
const solid: number[] = [];
const solidDesigns: ShipDesign[] = [];
/** The body each is parked on (`HullDesigns.carrierOf`), or -1. */
const solidCarriers: number[] = [];
/**
 * The layers each hull's modules are in: a fighter's all in whatever it
 * occupies, an ordinary ship's each its own (`OWN_LAYERS`). So a fighter
 * skimming a deck overflies thin hull and meets what stands above it.
 */
const solidLayers: number[] = [];
const point = { x: 0, y: 0 };

/**
 * The sweep: each solid body's left edge, the bodies in order of it, and the
 * pairs whose spans across x meet, as `a * count + b` in solid order. Grown,
 * never shrunk, so a step allocates nothing.
 */
let sweepLeft = new Float64Array(64);
let sweepOrder = new Int32Array(64);
let candidates = new Int32Array(256);
/** Slack on the sweep, metres: far more than rounding, so it only ever lets extra pairs through. */
const SWEEP_SLACK = 1e-3;
const axes = new Float64Array(MOST_CORNERS * 2 * 2);
const spanA = { lo: 0, hi: 0 };
const spanB = { lo: 0, hi: 0 };

/**
 * The shallowest way to push two boxes apart, or nothing if they are clear.
 *
 * Separating-axis test over the four face normals, which is all a pair of
 * rectangles has. Returns the overlap along the best axis, with the axis
 * written into `axes[0..1]` pointing from A towards B.
 */
function overlap(a: Box, b: Box): number {
    const used = axesOf(a, axes, 0) * 2;
    const count = used + axesOf(b, axes, used) * 2;

    const dx = b.x - a.x;
    const dy = b.y - a.y;

    let best = Infinity;
    let bestX = 0;
    let bestY = 0;
    // Two boxes are measured as half extents from their centres, which is the
    // same answer as the projections below and a handful of multiplications
    // cheaper — and it is the pair nearly every contact in a battle is.
    const boxes = a.count === 0 && b.count === 0;
    for (let k = 0; k < count; k += 2) {
        const ax = axes[k]!;
        const ay = axes[k + 1]!;
        let gap: number;
        if (boxes) {
            gap = reach(a, ax, ay) + reach(b, ax, ay) - abs(dx * ax + dy * ay);
        } else {
            project(a, ax, ay, spanA);
            project(b, ax, ay, spanB);
            gap = min(spanA.hi, spanB.hi) - max(spanA.lo, spanB.lo);
        }
        // A single axis with daylight along it is a proof of separation.
        if (gap <= 0) return 0;
        if (gap < best) {
            best = gap;
            // Always from A towards B, so the impulse has a side to push from.
            const centres = dx * ax + dy * ay;
            bestX = centres < 0 ? -ax : ax;
            bestY = centres < 0 ? -ay : ay;
        }
    }
    axes[0] = bestX;
    axes[1] = bestY;
    return best;
}

/**
 * Find every pair of hulls that are overlapping, one contact per pair.
 *
 * **Each body against its neighbours along x** (`sweep`), per §4, then the
 * bounding circles, taken in body order whatever the sort did, so the
 * contacts come out in the order every pair against every other gave them.
 *
 * One contact per pair — the deepest module meeting the deepest module — which
 * is the approximation this makes. A manifold of two points would hold two
 * hulls flat against each other; nothing in space presses them together for
 * long enough to need it.
 */
export function findContacts(bodies: Bodies, hulls: HullDesigns, out: Contacts): void {
    out.clear();

    // The hulls, once. Asking which body has which design inside the pair loop
    // would ask it forty-five thousand times a step in a three-hundred-ship
    // action, and the answer cannot change while the loop runs.
    solid.length = 0;
    solidCarriers.length = 0;
    solidDesigns.length = 0;
    solidLayers.length = 0;
    for (let i = 0; i < bodies.highWater; i++) {
        if (bodies.alive[i] === 0 || bodies.ghost[i] === 1) continue;
        const design = hulls.designOf(i);
        if (design === null) continue;
        solid.push(i);
        solidCarriers.push(hulls.carrierOf?.(i) ?? -1);
        solidDesigns.push(design);
        solidLayers.push(hulls.layersOf?.(i) ?? OWN_LAYERS);
    }

    const pairs = sweep(bodies);
    let a = -1;
    // Built on the first pair that gets past the circles, and not at all for a
    // ship nothing is near — which is most of them, most of the time.
    let builtA = false;
    for (let k = 0; k < pairs; k++) {
        const pair = candidates[k]!;
        const b = pair % solid.length;
        if ((pair - b) / solid.length !== a) {
            a = (pair - b) / solid.length;
            builtA = false;
        }
        const i = solid[a]!;
        const designA = solidDesigns[a]!;
        const j = solid[b]!;
        const designB = solidDesigns[b]!;
        const layersA = solidLayers[a]!;
        const layersB = solidLayers[b]!;
        if ((reachOf(layersA) & reachOf(layersB)) === 0) continue;
        // A fighter parked on a pad never meets its carrier, nor what else is parked on it.
        const carrierA = solidCarriers[a]!;
        const carrierB = solidCarriers[b]!;
        if (carrierA === j || carrierB === i || (carrierA >= 0 && carrierA === carrierB)) continue;

        // Could they have met at all? Bounding circles, as the broad phase.
        const dx = bodies.x[j]! - bodies.x[i]!;
        const dy = bodies.y[j]! - bodies.y[i]!;
        const reach = bodies.radius[i]! + bodies.radius[j]!;
        if (dx * dx + dy * dy > reach * reach) continue;

        if (!builtA) {
            boxesOf(designA, bodies.x[i]!, bodies.y[i]!, bodies.angle[i]!, boxesA);
            builtA = true;
        }
        boxesOf(designB, bodies.x[j]!, bodies.y[j]!, bodies.angle[j]!, boxesB);

        let deepest = 0;
        let deepestX = 0;
        let deepestY = 0;
        let deepestNx = 0;
        let deepestNy = 0;
        let moduleA = -1;
        let moduleB = -1;

        for (let ma = 0; ma < designA.modules.length; ma++) {
            const inA = moduleLayers(designA.modules[ma]!, layersA);
            for (let mb = 0; mb < designB.modules.length; mb++) {
                const shared = inA & moduleLayers(designB.modules[mb]!, layersB);
                if (shared === 0) continue;
                let boxA = boxesA[ma]!;
                let boxB = boxesB[mb]!;
                // Met above the deck alone, a turret is its dome rather than its block.
                if ((shared & HULL_LAYER) === 0) {
                    const specA = designA.modules[ma]!.spec;
                    const specB = designB.modules[mb]!.spec;
                    if (isDomed(specA.kind)) {
                        boxOf(designA, ma, bodies.x[i]!, bodies.y[i]!, bodies.angle[i]!, domeA, domeOf(specA));
                        boxA = domeA;
                    }
                    if (isDomed(specB.kind)) {
                        boxOf(designB, mb, bodies.x[j]!, bodies.y[j]!, bodies.angle[j]!, domeB, domeOf(specB));
                        boxB = domeB;
                    }
                }
                // Corner circles first: most module pairs on two hulls that are
                // touching somewhere are nowhere near each other.
                const mx = boxB.x - boxA.x;
                const my = boxB.y - boxA.y;
                const corners = boxA.radius + boxB.radius;
                if (mx * mx + my * my > corners * corners) continue;

                const depth = overlap(boxA, boxB);
                if (!(depth > deepest)) continue;

                const nx = axes[0]!;
                const ny = axes[1]!;
                contactPoint(boxA, boxB, nx, ny);
                deepest = depth;
                deepestNx = nx;
                deepestNy = ny;
                deepestX = point.x;
                deepestY = point.y;
                moduleA = ma;
                moduleB = mb;
            }
        }

        if (deepest > 0) {
            out.push(i, j, deepestX, deepestY, deepestNx, deepestNy, deepest, moduleA, moduleB);
        }
    }
}

/**
 * The pairs of solid bodies whose spans across x meet, into `candidates` in
 * the order the pair loop always took them, and how many. Sorted along x so
 * each body is held against only its neighbours there, rather than everything.
 */
function sweep(bodies: Bodies): number {
    const n = solid.length;
    if (sweepLeft.length < n) {
        sweepLeft = new Float64Array(2 * n);
        sweepOrder = new Int32Array(2 * n);
    }
    for (let a = 0; a < n; a++) {
        const i = solid[a]!;
        sweepLeft[a] = bodies.x[i]! - bodies.radius[i]!;
        sweepOrder[a] = a;
    }
    sweepOrder.subarray(0, n).sort(byLeft);
    let count = 0;
    for (let s = 0; s < n; s++) {
        const p = sweepOrder[s]!;
        const right = bodies.x[solid[p]!]! + bodies.radius[solid[p]!]! + SWEEP_SLACK;
        for (let t = s + 1; t < n; t++) {
            const q = sweepOrder[t]!;
            if (!(sweepLeft[q]! <= right)) break;
            if (count === candidates.length) {
                const grown = new Int32Array(2 * count);
                grown.set(candidates);
                candidates = grown;
            }
            candidates[count++] = p < q ? p * n + q : q * n + p;
        }
    }
    candidates.subarray(0, count).sort();
    return count;
}

const byLeft = (p: number, q: number): number => sweepLeft[p]! - sweepLeft[q]!;

/** Every layer some module of a hull could be in: all of them, if each module has its own. */
function reachOf(layers: number): number {
    return layers === OWN_LAYERS ? BOTH_LAYERS : layers;
}

/** Whether any module of one hull overlaps any of another's, whatever layers they are in. */
export function hullsOverlap(bodies: Bodies, i: number, designA: ShipDesign, j: number, designB: ShipDesign): boolean {
    const dx = bodies.x[j]! - bodies.x[i]!;
    const dy = bodies.y[j]! - bodies.y[i]!;
    const reach = bodies.radius[i]! + bodies.radius[j]!;
    if (dx * dx + dy * dy > reach * reach) return false;
    boxesOf(designA, bodies.x[i]!, bodies.y[i]!, bodies.angle[i]!, boxesA);
    boxesOf(designB, bodies.x[j]!, bodies.y[j]!, bodies.angle[j]!, boxesB);
    for (let ma = 0; ma < designA.modules.length; ma++) {
        for (let mb = 0; mb < designB.modules.length; mb++) {
            if (overlap(boxesA[ma]!, boxesB[mb]!) > 0) return true;
        }
    }
    return false;
}

const lone: Box[] = [];

/** Whether module `m` of a hull posed at `bx`, `by`, `angle` would overlap any module of body `j`'s. */
export function moduleOverlapsHull(
    design: ShipDesign,
    m: number,
    bx: number,
    by: number,
    angle: number,
    bodies: Bodies,
    j: number,
    other: ShipDesign,
): boolean {
    const dx = bodies.x[j]! - bx;
    const dy = bodies.y[j]! - by;
    const reach = design.radius + bodies.radius[j]!;
    if (dx * dx + dy * dy > reach * reach) return false;
    if (lone.length === 0) {
        lone.push({
            x: 0,
            y: 0,
            ux: 1,
            uy: 0,
            halfLength: 0,
            halfWidth: 0,
            radius: 0,
            corners: new Float64Array(MOST_CORNERS * 2),
            count: 0,
        });
    }
    boxOf(design, m, bx, by, angle, lone[0]!);
    boxesOf(other, bodies.x[j]!, bodies.y[j]!, bodies.angle[j]!, boxesB);
    for (let mb = 0; mb < other.modules.length; mb++) if (overlap(lone[0]!, boxesB[mb]!) > 0) return true;
    return false;
}

/**
 * Turn the contacts into impulses, and push the hulls out of each other.
 *
 * One pass, in contact order. Each contact is solved as if it were the only
 * one, which is what "single pass" costs and what §4 says is affordable: a
 * second contact on the same hull in the same step is already the rare case,
 * and a third is a pile-up that does not happen without gravity to make one.
 */
export function resolveContacts(bodies: Bodies, contacts: Contacts, hulls?: HullDesigns, dt = 0): void {
    for (let k = 0; k < contacts.count; k++) {
        // A fighter parked on a pad cannot move, so its carrier moves for it.
        const parkedA = hulls?.carrierOf?.(contacts.a[k]!) ?? -1;
        const parkedB = hulls?.carrierOf?.(contacts.b[k]!) ?? -1;
        const a = parkedA >= 0 ? parkedA : contacts.a[k]!;
        const b = parkedB >= 0 ? parkedB : contacts.b[k]!;
        const nx = contacts.nx[k]!;
        const ny = contacts.ny[k]!;
        const depth = contacts.depth[k]!;

        // Arms from each centre of mass to the contact, which is what turns a
        // glancing hit into a spin.
        const rax = contacts.x[k]! - bodies.x[a]!;
        const ray = contacts.y[k]! - bodies.y[a]!;
        const rbx = contacts.x[k]! - bodies.x[b]!;
        const rby = contacts.y[k]! - bodies.y[b]!;

        // Velocity of each hull *at the contact*, its spin included.
        const vax = bodies.vx[a]! - bodies.angularVel[a]! * ray;
        const vay = bodies.vy[a]! + bodies.angularVel[a]! * rax;
        const vbx = bodies.vx[b]! - bodies.angularVel[b]! * rby;
        const vby = bodies.vy[b]! + bodies.angularVel[b]! * rbx;
        const vn = (vbx - vax) * nx + (vby - vay) * ny;

        const crossA = rax * ny - ray * nx;
        const crossB = rbx * ny - rby * nx;
        const invMassSum =
            bodies.invMass[a]! + bodies.invMass[b]! + crossA * crossA * bodies.invInertia[a]! + crossB * crossB * bodies.invInertia[b]!;
        // Two immovable objects. Neither can give, so nothing happens to either.
        if (!(invMassSum > 0)) continue;

        // What met: a claw square on stabs in, and rock gives.
        let give = 0;
        let rough = false;
        if (hulls !== undefined && dt > 0) {
            const specA = hulls.designOf(contacts.a[k]!)?.modules[contacts.moduleA[k]!]?.spec;
            const specB = hulls.designOf(contacts.b[k]!)?.modules[contacts.moduleB[k]!]?.spec;
            rough = isGround(specA) || isGround(specB);
            const clawA = specA?.kind === "claw" && facing(bodies, contacts.a[k]!, specA.angle ?? 0, nx, ny) >= CLAW_ALIGN;
            const clawB = !clawA && specB?.kind === "claw" && facing(bodies, contacts.b[k]!, specB.angle ?? 0, -nx, -ny) >= CLAW_ALIGN;
            const claw = clawA ? specA : clawB ? specB : undefined;
            if (claw !== undefined) {
                const reach = CLAW_DEPTH * claw.length;
                // It yields no harder than its spring at full depth, so what it cannot
                // stop in the depth it has left drives it in to the stop, met hard there.
                const hardest = CLAW_STIFFNESS * claw.width * reach;
                const force = min(hardest, (CLAW_STIFFNESS * depth - CLAW_DAMPING * vn) * claw.width);
                const stops = vn >= 0 || (0.5 * vn * vn) / invMassSum <= 0.5 * (max(0, force) + hardest) * (reach - depth);
                if (depth < reach) {
                    // One it cannot stop goes on in to the stop, and glances.
                    contacts.stab[k] = !stops ? Stab.Stopped : clawA ? Stab.A : Stab.B;
                    contacts.closing[k] = vn < 0 ? -vn : 0;
                    // Out along the normal no harder than would stop it and lift it clear in a step: a light hull is not flung.
                    const most = (max(0, -vn) + depth / dt) / invMassSum;
                    const impulse = min(max(0, force * dt), most);
                    contacts.impulse[k] = impulse;
                    push(bodies, a, b, impulse * nx, impulse * ny, crossA * impulse, crossB * impulse);
                    // Stiff sideways: what slides across the jaws is stopped.
                    const tx = -ny;
                    const ty = nx;
                    const vt = (vbx - vax) * tx + (vby - vay) * ty;
                    const tA = rax * ty - ray * tx;
                    const tB = rbx * ty - rby * tx;
                    const invTSum =
                        bodies.invMass[a]! + bodies.invMass[b]! + tA * tA * bodies.invInertia[a]! + tB * tB * bodies.invInertia[b]!;
                    if (invTSum > 0) {
                        const jt = -vt / invTSum;
                        push(bodies, a, b, jt * tx, jt * ty, tA * jt, tB * jt);
                    }
                    continue;
                }
                contacts.stab[k] = Stab.Stopped;
                give = reach;
            } else if (specA?.kind === "rock" || specB?.kind === "rock") {
                if (vn >= 0) continue;
                contacts.closing[k] = -vn;
                const sink = min(ROCK_SINK, ROCK_SINK_SHARE * min(thinnest(specA), thinnest(specB)));
                if (depth < sink) {
                    const impulse = min(ROCK_DAMPING * -vn * dt, -vn / invMassSum);
                    contacts.impulse[k] = impulse;
                    push(bodies, a, b, impulse * nx, impulse * ny, crossA * impulse, crossB * impulse);
                    rub(bodies, a, b, nx, ny, rax, ray, rbx, rby, impulse, depth);
                    continue;
                }
                give = sink;
            }
        }

        // Already coming apart: they met on an earlier step and are leaving.
        if (vn >= 0) continue;
        contacts.closing[k] = -vn;

        const impulse = (-(1 + RESTITUTION) * vn) / invMassSum;
        contacts.impulse[k] = impulse;
        push(bodies, a, b, impulse * nx, impulse * ny, crossA * impulse, crossB * impulse);
        if (rough) rub(bodies, a, b, nx, ny, rax, ray, rbx, rby, impulse, depth);

        // And out of each other, or a fast hull meeting a heavy one sinks into it
        // faster than the impulse can carry it back out. What gives is left in.
        const correction = (max(depth - give - PENETRATION_SLOP, 0) * CORRECTION) / invMassSum;
        bodies.x[a]! -= correction * nx * bodies.invMass[a]!;
        bodies.y[a]! -= correction * ny * bodies.invMass[a]!;
        bodies.x[b]! += correction * nx * bodies.invMass[b]!;
        bodies.y[b]! += correction * ny * bodies.invMass[b]!;
    }
}

/** How square on to the normal `nx`, `ny` a module turned `turn` on body `body` faces: the cosine between them. */
function facing(bodies: Bodies, body: number, turn: number, nx: number, ny: number): number {
    const angle = bodies.angle[body]! + turn;
    return nx * cos(angle) + ny * sin(angle);
}

/** Whether a module is the ground of an asteroid: rock, or its kernel. */
function isGround(spec: ModuleSpec | undefined): boolean {
    return spec?.kind === "rock" || spec?.kind === "kernel";
}

/** A module's thinnest extent, metres, and no bound for none. */
function thinnest(spec: ModuleSpec | undefined): number {
    return spec === undefined ? Infinity : min(spec.length, spec.width);
}

/**
 * Friction across the normal `nx`, `ny`, at the arms `ra`, `rb`: what stops
 * the two sliding over each other, no more than `ROCK_FRICTION` of the
 * impulse `normal` the contact put through along it. What has sunk `depth`
 * in cannot roll freely either: the same share of it, on that arm, holds it
 * against turning, or one point of contact turns sliding into rolling.
 */
function rub(
    bodies: Bodies,
    a: number,
    b: number,
    nx: number,
    ny: number,
    rax: number,
    ray: number,
    rbx: number,
    rby: number,
    normal: number,
    depth: number,
): void {
    const tx = -ny;
    const ty = nx;
    const vt =
        (bodies.vx[b]! - bodies.angularVel[b]! * rby - bodies.vx[a]! + bodies.angularVel[a]! * ray) * tx +
        (bodies.vy[b]! + bodies.angularVel[b]! * rbx - bodies.vy[a]! - bodies.angularVel[a]! * rax) * ty;
    const tA = rax * ty - ray * tx;
    const tB = rbx * ty - rby * tx;
    const invTSum = bodies.invMass[a]! + bodies.invMass[b]! + tA * tA * bodies.invInertia[a]! + tB * tB * bodies.invInertia[b]!;
    if (invTSum > 0) {
        const most = ROCK_FRICTION * normal;
        const jt = max(-most, min(most, -vt / invTSum));
        push(bodies, a, b, jt * tx, jt * ty, tA * jt, tB * jt);
    }
    const invISum = bodies.invInertia[a]! + bodies.invInertia[b]!;
    if (invISum > 0) {
        const most = ROCK_FRICTION * normal * depth;
        const spin = max(-most, min(most, (bodies.angularVel[a]! - bodies.angularVel[b]!) / invISum));
        bodies.angularVel[a]! -= spin * bodies.invInertia[a]!;
        bodies.angularVel[b]! += spin * bodies.invInertia[b]!;
    }
}

/** Put an impulse `jx`, `jy` through a contact into `b`, and its opposite into `a`, with the torques `ta`, `tb` its arms give it. */
function push(bodies: Bodies, a: number, b: number, jx: number, jy: number, ta: number, tb: number): void {
    bodies.vx[a]! -= jx * bodies.invMass[a]!;
    bodies.vy[a]! -= jy * bodies.invMass[a]!;
    bodies.angularVel[a]! -= ta * bodies.invInertia[a]!;
    bodies.vx[b]! += jx * bodies.invMass[b]!;
    bodies.vy[b]! += jy * bodies.invMass[b]!;
    bodies.angularVel[b]! += tb * bodies.invInertia[b]!;
}

/**
 * Finding and resolving together, with the contacts kept for whatever wants to
 * read them — a damage model, or a renderer drawing where two hulls met.
 *
 * Call it after the world has stepped and before the index is rebuilt: the
 * impulse belongs to the positions the hulls actually reached.
 */
export class Collisions {
    readonly contacts = new Contacts();

    step(bodies: Bodies, hulls: HullDesigns, dt = 0): void {
        findContacts(bodies, hulls, this.contacts);
        resolveContacts(bodies, this.contacts, hulls, dt);
    }
}
