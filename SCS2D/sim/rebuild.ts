import { cos, sin } from "./math.js";
import { DAMAGE_ENERGY_PER_KG } from "./damage.js";
import { boxAngle, COMPLEXITY_WORK, isThick, moduleOutline, ROBOT_MASS, type ModuleSpec, type ModuleStats } from "./modules.js";
import { distanceToOutline, polygonArea, polygonMomentOfArea, triangleBounds } from "./shape.js";

/**
 * Rebuilding a lost module (ROADMAP.md §8, repair stage 5): the walls go up
 * first, as a shell growing across the module from the face it is built
 * against, and the fittings go in after, while the module stands full size
 * and does nothing. What robots do with this is `Ships`'s; this is the shape.
 */

/** How many steps a shell grows in: each is a remade hull, so not every tick. */
export const SHELL_STEPS = 10;

/** What a module's fittings weigh beyond the robots it berths, kg: what goes in once its walls are up. */
export function fittingOf(stats: ModuleStats): number {
    const kg = stats.fittingMass - stats.robots * ROBOT_MASS;
    return kg > 0 ? kg : 0;
}

/**
 * The work building a kilogram of a module takes, J: a kilogram's worth of
 * damage, and its share of the module's complexity, spread over its walls and
 * fittings alike.
 */
export function buildWork(stats: ModuleStats): number {
    const kg = stats.structureMass + fittingOf(stats);
    return kg > 0 ? DAMAGE_ENERGY_PER_KG + (stats.complexity * COMPLEXITY_WORK) / kg : DAMAGE_ENERGY_PER_KG;
}

/** The edge of a module's outline nearest another's: the face it is built against. */
export function faceToward(spec: ModuleSpec, against: ModuleSpec): number {
    const corners: number[] = [];
    const other: number[] = [];
    const count = moduleOutline(spec, corners);
    const otherCount = moduleOutline(against, other);
    let best = 0;
    let bestDist = Infinity;
    for (let e = 0; e < count; e++) {
        const f = (e + 1) % count;
        const x = (corners[e * 2]! + corners[f * 2]!) * 0.5;
        const y = (corners[e * 2 + 1]! + corners[f * 2 + 1]!) * 0.5;
        const d = distanceToOutline(other, otherCount, x, y);
        if (d < bestDist) {
            bestDist = d;
            best = e;
        }
    }
    return best;
}

/** The edge of a module's outline whose middle is nearest a point: the face to lay its walls from towards it. */
export function faceNearest(spec: ModuleSpec, x: number, y: number): number {
    const corners: number[] = [];
    const count = moduleOutline(spec, corners);
    let best = 0;
    let bestDist = Infinity;
    for (let e = 0; e < count; e++) {
        const f = (e + 1) % count;
        const dx = (corners[e * 2]! + corners[f * 2]!) * 0.5 - x;
        const dy = (corners[e * 2 + 1]! + corners[f * 2 + 1]!) * 0.5 - y;
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
            bestDist = d;
            best = e;
        }
    }
    return best;
}

/**
 * The walls of a module, up across `share` of it from edge `face`: a strip of
 * a box, or a triangle of a triangle with its apex drawn in towards the face.
 * Structure, since that is all it is yet, weighing that share of the module's
 * walls and stopping as much as they do. A thick module's shell is thick, as
 * deep as the module whole (`stats.thickness`) from the first step.
 */
export function shellOf(spec: ModuleSpec, stats: ModuleStats, face: number, share: number): { spec: ModuleSpec; stats: ModuleStats } {
    const corners: number[] = [];
    const count = moduleOutline(spec, corners);
    const angle = boxAngle(spec);
    const at = (k: number): [number, number] => [corners[(k % count) * 2]!, corners[(k % count) * 2 + 1]!];
    const [ax, ay] = at(face);
    const [bx, by] = at(face + 1);
    const shell: ModuleSpec = { kind: "structure", x: 0, y: 0, length: spec.length, width: spec.width, angle };
    if (isThick(spec)) shell.thick = true;
    let vertices: number[];
    if (count === 3) {
        // The apex drawn in towards the middle of the face.
        const [cx, cy] = at(face + 2);
        const mx = (ax + bx) * 0.5;
        const my = (ay + by) * 0.5;
        const px = mx + (cx - mx) * share;
        const py = my + (cy - my) * share;
        const gx = (ax + bx + px) / 3;
        const gy = (ay + by + py) / 3;
        const c = cos(angle);
        const s = sin(angle);
        vertices = [];
        for (const [x, y] of [
            [ax, ay],
            [bx, by],
            [px, py],
        ] as const) {
            vertices.push((x - gx) * c + (y - gy) * s, -(x - gx) * s + (y - gy) * c);
        }
        const bounds = triangleBounds(vertices);
        shell.x = gx;
        shell.y = gy;
        shell.length = bounds.length;
        shell.width = bounds.width;
        shell.vertices = vertices;
    } else {
        // Faces 0 and 2 are the ends of the box, 1 and 3 its sides.
        const [cx, cy] = at(face + 2);
        const [dx, dy] = at(face + 3);
        const px = bx + (cx - bx) * share;
        const py = by + (cy - by) * share;
        const qx = ax + (dx - ax) * share;
        const qy = ay + (dy - ay) * share;
        shell.x = (ax + bx + px + qx) * 0.25;
        shell.y = (ay + by + py + qy) * 0.25;
        if (face % 2 === 0) shell.length = spec.length * share;
        else shell.width = spec.width * share;
        vertices = [ax, ay, bx, by, px, py, qx, qy];
    }
    const area = polygonArea(vertices);
    const moment = count === 3 ? polygonMomentOfArea(vertices) : (area * (shell.length * shell.length + shell.width * shell.width)) / 12;
    const mass = stats.structureMass * share;
    return {
        spec: shell,
        stats: {
            ...stats,
            structureMass: mass,
            fittingMass: 0,
            mass,
            capacity: 0,
            inertia: area > 0 ? (mass * moment) / area : 0,
            hitPoints: stats.hitPoints * share,
            thrust: 0,
            exhaustVelocity: 0,
            fuel: 0,
            metal: 0,
            lining: 0,
            interior: 0,
            gun: null,
            traverseMass: 0,
            swingInertia: 0,
            pumpRate: 0,
            charge: 0,
            chargeRate: 0,
            generation: 0,
            robots: 0,
            complexity: stats.complexity * share,
            controlRadius: 0,
        },
    };
}

/**
 * A module of a compiled design, laid out in the frame a hull has since been
 * welded into: turned and moved as `was` was to become `now`, which are one
 * module of that design before and after. The same spec when nothing moved.
 */
export function inFrame(spec: ModuleSpec, was: ModuleSpec, now: ModuleSpec): ModuleSpec {
    if (was === now) return spec;
    const turn = (now.angle ?? 0) - (was.angle ?? 0);
    const c = cos(turn);
    const s = sin(turn);
    const dx = now.x - (was.x * c - was.y * s);
    const dy = now.y - (was.x * s + was.y * c);
    return { ...spec, x: dx + spec.x * c - spec.y * s, y: dy + spec.x * s + spec.y * c, angle: (spec.angle ?? 0) + turn };
}
