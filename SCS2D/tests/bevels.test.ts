import { describe, expect, it } from "vitest";
import { compileBlueprint, originOf, subDesign, type Blueprint, type ShipDesign } from "../sim/index.js";
import { rebuiltDesign } from "../sim/blueprint.js";
import { shellOf } from "../sim/rebuild.js";
import { DINKY, TANKER } from "../scenarios/blueprints.js";
import { BEVEL_STRIDE, bevelQuad, bevelsOf, drawnBevels } from "../render/bevels.js";

/** Three boxes in a row along x, each 4 by 4. */
const ROW: Blueprint = {
    name: "Row",
    modules: [
        { kind: "structure", x: -4, y: 0, length: 4, width: 4 },
        { kind: "core", x: 0, y: 0, length: 4, width: 4 },
        { kind: "structure", x: 4, y: 0, length: 4, width: 4 },
    ],
};

/** How long bevelled edges are in all, metres. */
const bevelled = (edges: readonly number[]): number => {
    let total = 0;
    for (let k = 0; k < edges.length; k += BEVEL_STRIDE) total += Math.hypot(edges[k + 2]! - edges[k]!, edges[k + 3]! - edges[k + 1]!);
    return total;
};

describe("bevels", () => {
    const row = compileBlueprint(ROW);
    const at = (x: number): number => row.modules.findIndex((m) => Math.abs(m.x - row.modules[1]!.x - x) < 1e-6);

    it("bevels a module's edges on the outline, not those it shares with a neighbour", () => {
        // The ends each show three sides, the middle its top and bottom.
        expect(bevelled(bevelsOf(row, at(-4)))).toBeCloseTo(12, 6);
        expect(bevelled(bevelsOf(row, at(0)))).toBeCloseTo(8, 6);
        expect(bevelled(bevelsOf(row, at(4)))).toBeCloseTo(12, 6);
        // Every bevel faces out of the hull: none faces along the row from the middle.
        const middle = bevelsOf(row, at(0));
        for (let k = 0; k < middle.length; k += BEVEL_STRIDE) expect(Math.abs(middle[k + 4]!)).toBeLessThan(1e-9);
        // Each 4 m box's bevels go no deeper than a quarter of the 4 m it reaches in.
        for (let k = 0; k < middle.length; k += BEVEL_STRIDE) expect(middle[k + 6]).toBeCloseTo(1, 9);
    });

    it("lets a thin plate's short ends take a bevel no deeper than they are wide", () => {
        // A plate 8 long and 1 wide, its long sides against a box either side.
        const strip = compileBlueprint({
            name: "Strip",
            modules: [
                { kind: "structure", x: 0, y: 1, length: 8, width: 1 },
                { kind: "core", x: 0, y: -1, length: 8, width: 3 },
                { kind: "structure", x: 0, y: 3, length: 8, width: 3 },
            ],
        });
        const plate = strip.modules.findIndex((m) => m.spec.width === 1);
        const edges = bevelsOf(strip, plate);
        // Only its two short ends are open: reaching 8 m in, but 1 m wide.
        expect(edges.length / BEVEL_STRIDE).toBe(2);
        for (let k = 0; k < edges.length; k += BEVEL_STRIDE) expect(edges[k + 6]).toBeCloseTo(1, 6);
    });

    it("keeps a cut-off piece's edges as built, rather than bevelling where it broke", () => {
        const piece = subDesign(row, [at(0)]);
        const origin = originOf(piece, 0);
        expect(origin.design).toBe(row);
        expect(bevelled(bevelsOf(origin.design, origin.module))).toBeCloseTo(8, 6);
    });

    it("bevels a module going up by its walls so far, not the whole of it", () => {
        // The end box, its walls a third of the way up from one end.
        const m = at(4);
        const whole = row.modules[m]!;
        const share = 1 / 3;
        const part = shellOf(whole.spec, whole.stats, 0, share);
        const shelled = rebuiltDesign(row, m, part.spec, part.stats, originOf(row, m), { share, face: 0 });
        const spec = shelled.modules[m]!.spec;
        const edges = drawnBevels(shelled, m);
        expect(edges.length).toBeGreaterThan(0);
        // Every end in the shell's own box, in its own frame.
        for (let k = 0; k < edges.length; k += BEVEL_STRIDE) {
            for (const [x, y] of [
                [edges[k]!, edges[k + 1]!],
                [edges[k + 2]!, edges[k + 3]!],
            ] as const) {
                expect(Math.abs(x)).toBeLessThanOrEqual(spec.length / 2 + 1e-6);
                expect(Math.abs(y)).toBeLessThanOrEqual(spec.width / 2 + 1e-6);
            }
        }
        // The whole module's would not have been.
        expect(bevelled(bevelsOf(row, m))).toBeGreaterThan(bevelled(edges));
    });

    /** Each bevel's four corners, `width` deep. */
    const quads = (edges: readonly number[], width: number): number[][] => {
        const out: number[][] = [];
        for (let k = 0; k < edges.length; k += BEVEL_STRIDE) {
            const quad: number[] = [];
            bevelQuad(edges, k, width, quad);
            out.push(quad);
        }
        return out;
    };
    /** The inside corners of the quads that run to or from `x`, `y`. */
    const insideAt = (all: number[][], x: number, y: number): number[][] =>
        all.flatMap((q) => [
            ...(Math.hypot(q[0]! - x, q[1]! - y) < 1e-3 ? [[q[6]!, q[7]!]] : []),
            ...(Math.hypot(q[2]! - x, q[3]! - y) < 1e-3 ? [[q[4]!, q[5]!]] : []),
        ]);

    it("mitres a module's bevels where they turn its corner, rather than overlapping", () => {
        // The left box's outer corners, in its own frame, at -2, ±2.
        const all = quads(bevelsOf(row, at(-4)), 0.5);
        for (const y of [-2, 2]) {
            const inside = insideAt(all, -2, y);
            expect(inside.length).toBe(2);
            // Both cut along the diagonal, to the same point.
            for (const [x, iy] of inside) {
                expect(x).toBeCloseTo(-1.5, 6);
                expect(iy).toBeCloseTo(y - Math.sign(y) * 0.5, 6);
            }
        }
        // Where the row runs on, its bevels meet square: the middle's run straight on.
        const middle = quads(bevelsOf(row, at(0)), 0.5);
        for (const [, y] of insideAt(middle, -2, 2)) expect(y).toBeCloseTo(1.5, 6);
    });

    it("takes a crack narrower than a bevel between two modules for a seam", () => {
        // Two boxes on a base, a hairline gap between them.
        const cracked = compileBlueprint({
            name: "Cracked",
            modules: [
                { kind: "core", x: 0, y: -3, length: 8.02, width: 2 },
                { kind: "structure", x: -2.01, y: 0, length: 4, width: 4 },
                { kind: "structure", x: 2.01, y: 0, length: 4, width: 4 },
            ],
        });
        const boxes = cracked.modules.flatMap((m, i) => (m.spec.kind === "structure" ? [i] : []));
        expect(boxes.length).toBe(2);
        for (let b = 0; b < 2; b++) {
            const m = boxes[b]!;
            // Their tops and outer sides only: none faces the other across the crack.
            const away = cracked.modules[m]!.x - cracked.modules[boxes[1 - b]!]!.x;
            const edges = bevelsOf(cracked, m);
            expect(edges.length / BEVEL_STRIDE).toBe(2);
            for (let k = 0; k < edges.length; k += BEVEL_STRIDE) expect(edges[k + 4]! * away).toBeGreaterThan(-1e-9);
        }
    });

    it("mitres bevels on different modules where they meet, inside a corner as outside", () => {
        // An L: a box with another on top of its left half.
        const l = compileBlueprint({
            name: "L",
            modules: [
                { kind: "core", x: 0, y: 0, length: 8, width: 4 },
                { kind: "structure", x: -2, y: 4, length: 4, width: 4 },
            ],
        });
        const bottom = l.modules.findIndex((m) => m.spec.length === 8);
        const top = 1 - bottom;
        const dx = l.modules[top]!.x - l.modules[bottom]!.x;
        const dy = l.modules[top]!.y - l.modules[bottom]!.y;
        // The inner corner, at 0, 2 from the bottom box's centre: its top edge's
        // bevel there runs on into the top box, to meet the top box's right side's.
        const below = insideAt(quads(bevelsOf(l, bottom), 0.5), 0, 2);
        const above = insideAt(quads(bevelsOf(l, top), 0.5), -dx, 2 - dy);
        expect(below.length).toBe(1);
        expect(above.length).toBe(1);
        expect(below[0]![0]).toBeCloseTo(-0.5, 3);
        expect(below[0]![1]).toBeCloseTo(1.5, 3);
        expect(above[0]![0] + dx).toBeCloseTo(-0.5, 3);
        expect(above[0]![1] + dy).toBeCloseTo(1.5, 3);
    });

    it("leaves a docking port unbevelled, being round", () => {
        const tanker = compileBlueprint(TANKER);
        const ports = tanker.modules.flatMap((m, i) => (m.spec.kind === "port" ? [i] : []));
        expect(ports.length).toBeGreaterThan(0);
        for (const m of ports) expect(bevelsOf(tanker, m)).toEqual([]);
    });

    it("joins each bevel to the one it meets, and that one back to it", () => {
        // On a ship as small as a Dinky, ends lie close enough together to be taken for each other's.
        const dinky = compileBlueprint(DINKY);
        /** Edge `k` of module `m` in the design's frame: its start, end, normal, and the normals it meets. */
        const edge = (design: ShipDesign, m: number, k: number) => {
            const module = design.modules[m]!;
            const e = bevelsOf(design, m);
            const c = Math.cos(module.angle);
            const s = Math.sin(module.angle);
            const at = (x: number, y: number): [number, number] => [module.x + x * c - y * s, module.y + x * s + y * c];
            const way = (x: number, y: number): [number, number] => [x * c - y * s, x * s + y * c];
            return {
                a: at(e[k]!, e[k + 1]!),
                b: at(e[k + 2]!, e[k + 3]!),
                n: way(e[k + 4]!, e[k + 5]!),
                before: way(e[k + 7]!, e[k + 8]!),
                after: way(e[k + 10]!, e[k + 11]!),
                met: [e[k + 9]!, e[k + 12]!],
            };
        };
        const all = dinky.modules.flatMap((_, m) =>
            Array.from({ length: bevelsOf(dinky, m).length / BEVEL_STRIDE }, (_, i) => edge(dinky, m, i * BEVEL_STRIDE)),
        );
        let joined = 0;
        for (const e of all) {
            if (e.met[1] === 0) continue;
            // What it meets at its end starts there, and meets it back.
            const next = all.find(
                (f) =>
                    Math.abs(f.n[0] - e.after[0]) < 1e-9 &&
                    Math.abs(f.n[1] - e.after[1]) < 1e-9 &&
                    Math.hypot(f.a[0] - e.b[0], f.a[1] - e.b[1]) < 0.05,
            );
            expect(next).toBeDefined();
            expect(next!.before[0]).toBeCloseTo(e.n[0], 9);
            expect(next!.before[1]).toBeCloseTo(e.n[1], 9);
            joined++;
        }
        expect(joined).toBeGreaterThan(10);
    });
});
