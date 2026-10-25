import { describe, expect, it } from "vitest";
import {
    blueprintProblems,
    compileBlueprint,
    compileDraft,
    footprintOf,
    math,
    moduleOutline,
    printedCraft,
    printLength,
    type Blueprint,
    type ModuleSpec,
} from "../sim/index.js";
import { fittingOf } from "../sim/rebuild.js";
import { makeBattle } from "../scenarios/battle.js";
import type { Battle } from "../scenarios/types.js";
import { BARE_CORE, SCAVENGER } from "../scenarios/blueprints.js";
import { SHIPYARD } from "../scenarios/shipyard.js";

/** Slipways building ships bow first out of their face (ROADMAP.md §8 step 12, slice 3). */

const SLIPWAY = 1;

/** A slipway that lays what it builds bow first. */
const BOW_FIRST: ModuleSpec = { kind: "slipway", x: 0, y: 0, length: 1, width: 10 };

/** Short and broad: 2 m bow to stern and 8 m across the beam, wider than the Shipyard's slipway. */
const BAR: Blueprint = {
    name: "Bar",
    modules: [
        { kind: "core", x: 0, y: 0, length: 2, width: 2 },
        { kind: "structure", x: 0, y: 2.5, length: 2, width: 3 },
        { kind: "structure", x: 0, y: -2.5, length: 2, width: 3 },
    ],
};

/** A Shipyard keeping `keep` of `craft`. */
function yardOf(keep = 1, craft: Blueprint = SCAVENGER, slipway: Partial<ModuleSpec> = {}): Blueprint {
    return {
        ...SHIPYARD,
        modules: SHIPYARD.modules.map((m, i) => (i === SLIPWAY ? { ...m, craft: craft.name, keep, ...slipway } : m)),
        hangar: { [craft.name]: craft },
    };
}

/** A shipyard and an unarmed hulk far off, and anything else `more` adds. */
function battle(
    yard: Blueprint,
    more: (run: { ships: Battle["ships"]; world: Battle["world"] }) => void = () => {},
): Battle & { y: number } {
    return makeBattle({ seed: 7 }, (ships, world) => {
        const y = ships.spawn(world, { design: compileBlueprint(yard), x: 0, y: 0, angle: 0 });
        ships.spawn(world, { design: compileBlueprint(BARE_CORE), x: 5000, y: 0, team: 1 });
        more({ ships, world });
        return { y };
    });
}

/** The ships of the yard's side other than itself. */
function built(run: Battle & { y: number }): number[] {
    const out: number[] = [];
    for (let i = 0; i < run.ships.highWater; i++) {
        if (i !== run.y && run.ships.isAlive(i) && run.ships.teamOf(i) === run.ships.teamOf(run.y) && !run.ships.isDerelict(i)) out.push(i);
    }
    return out;
}

function runFor(run: Battle, seconds: number, until: () => boolean = () => false): void {
    for (let s = 0; s < seconds * 60 && !until(); s++) run.step();
}

describe("a ship built to a depth", () => {
    it("is whole ahead of the cut, a shell across it, and nothing behind it", () => {
        const craft = compileBlueprint(SCAVENGER);
        expect(printedCraft(craft, BOW_FIRST, 0)).toBeNull();
        const half = printedCraft(craft, BOW_FIRST, printLength(craft, BOW_FIRST) / 2)!;
        expect(half.modules.length).toBeLessThan(craft.modules.length);
        expect(half.design.modules.some((m) => m.shell !== undefined)).toBe(true);
        const whole = printedCraft(craft, BOW_FIRST, printLength(craft, BOW_FIRST))!;
        expect(whole.modules.length).toBe(craft.modules.length);
        expect(whole.design.modules.every((m) => m.shell === undefined)).toBe(true);
        expect(whole.design.mass).toBeCloseTo(craft.mass, 6);
    });

    it("is held by every piece it is in until it joins up", () => {
        // Two prongs a crossbeam at the stern ties.
        const fork = compileBlueprint({
            name: "Fork",
            modules: [
                { kind: "core", x: 0, y: 0, length: 2, width: 6 },
                { kind: "structure", x: 3, y: 2, length: 4, width: 2 },
                { kind: "structure", x: 3, y: -2, length: 4, width: 2 },
            ],
        });
        expect(printedCraft(fork, BOW_FIRST, 2)!.held.length).toBe(2);
        expect(printedCraft(fork, BOW_FIRST, 5)!.held.length).toBe(1);
    });
    it("never reaches back past the cut: a module turned off the axis waits until it is whole", () => {
        // A draft: only how it prints matters, not whether it holds together.
        const raked = compileDraft({
            name: "Raked",
            modules: [
                { kind: "core", x: 0, y: 0, length: 2, width: 2 },
                { kind: "structure", x: 2.5, y: 0, angle: math.PI / 4, length: 2, width: 2 },
            ],
        });
        const corners: number[] = [];
        for (let depth = 0.25; depth < 5; depth += 0.25) {
            const print = printedCraft(raked, BOW_FIRST, depth);
            const cut = raked.centreOfMassX + footprintOf(raked).maxX - depth;
            for (const module of print?.design.modules ?? []) {
                const n = moduleOutline(module.spec, corners);
                for (let v = 0; v < n; v++) expect(corners[v * 2]!).toBeGreaterThanOrEqual(cut - 1e-6);
            }
        }
    });
});

describe("a slipway", () => {
    it("builds its ship bow first, out of its face, held and doing nothing until it is let go whole", () => {
        const run = battle(yardOf());
        const craft = compileBlueprint(SCAVENGER);
        runFor(run, 30, () => built(run).length > 0);
        const [s] = built(run);
        expect(s).toBeDefined();
        expect(run.ships.isPrinting(s!)).toBe(true);
        expect(run.ships.isUnfinished(s!)).toBe(true);
        // On the yard's body, ahead of the slipway's face.
        const body = run.ships.body(run.y);
        expect(run.ships.body(s!)).toEqual(body);
        let modules = 0;
        runFor(run, 240, () => {
            const now = run.ships.currentStructure(run.y).modules.length;
            if (now < modules) throw new Error("lost a slice");
            modules = now;
            return !run.ships.isPrinting(s!);
        });
        expect(run.ships.isPrinting(s!)).toBe(false);
        // Fitted out as it went, at the face, rather than all at the end: what is
        // left is no more than the stern's.
        const fittings = craft.modules.reduce((sum, m) => sum + fittingOf(m.stats), 0);
        const yardBody = run.world.bodies.indexOf(run.ships.body(run.y));
        expect(run.ships.damage.unbuiltMass(yardBody)).toBeLessThan(fittings / 2);
        runFor(run, 300, () => run.ships.body(s!) !== run.ships.body(run.y));
        expect(run.ships.body(s!)).not.toEqual(run.ships.body(run.y));
        expect(run.ships.isUnfinished(s!)).toBe(false);
        expect(run.ships.damage.unbuiltMass(run.world.bodies.indexOf(run.ships.body(s!)))).toBe(0);
        expect(run.ships.hasControl(s!)).toBe(true);
        expect(run.ships.currentStructure(s!).modules.length).toBe(craft.modules.length);
        // The Scavenger's bow is ahead of the yard: built out along the slipway's facing.
        const bodies = run.world.bodies;
        expect(bodies.x[bodies.indexOf(run.ships.body(s!))]!).toBeGreaterThan(bodies.x[bodies.indexOf(run.ships.body(run.y))]!);
        // Keeping one, it builds no more.
        runFor(run, 60);
        expect(built(run)).toEqual([s]);
    });

    it("pushes a ship it lets go off, and the ship lights its engines only once they would miss its builder", () => {
        const run = battle(yardOf());
        let s = -1;
        runFor(run, 400, () => {
            s = built(run)[0] ?? -1;
            return s >= 0 && run.ships.body(s) !== run.ships.body(run.y);
        });
        expect(s).toBeGreaterThanOrEqual(0);
        const bodies = run.world.bodies;
        const at = (i: number): number => bodies.indexOf(run.ships.body(i));
        const apart = (): number => Math.hypot(bodies.x[at(s)]! - bodies.x[at(run.y)]!, bodies.y[at(s)]! - bodies.y[at(run.y)]!);
        const parted = apart();
        let firstLit = -1;
        runFor(run, 30, () => {
            if (run.ships.currentStructure(s).engines.some((_, t) => run.ships.throttleOf(s, t) > 0)) firstLit = apart();
            return firstLit >= 0;
        });
        // Drifted clear on the push before it lit up, and never put its flame on the yard.
        expect(firstLit).toBeGreaterThan(parted + 10);
        const yard = at(run.y);
        let burnt = 0;
        for (let m = 0; m < run.ships.currentStructure(run.y).modules.length; m++) burnt += run.ships.damage.absorbedAt(yard, m);
        expect(burnt).toBe(0);
    });

    it("waits while something is in the way of the ship it pushes out", () => {
        const footprint = footprintOf(compileBlueprint(SCAVENGER));
        const run = battle(yardOf(), ({ ships, world }) => {
            // A hulk sat in the strip, a little way out.
            ships.spawn(world, { design: compileBlueprint(BARE_CORE), x: 10 + (footprint.maxX - footprint.minX) / 2, y: 0, team: 2 });
        });
        runFor(run, 240);
        const [s] = built(run);
        expect(s).toBeDefined();
        expect(run.ships.isPrinting(s!)).toBe(true);
    });

    it("counts as able to fight while it can build an armed ship, and its building as activity", () => {
        // A Scavenger is not armed; a core with a gun let into its bow is.
        expect(battle(yardOf()).ships.canBuildArmed(0)).toBe(false);
        const picket: Blueprint = {
            name: "Picket",
            modules: [
                { kind: "core", x: 0, y: 0, length: 3, width: 3 },
                { kind: "hullGun", x: 3.5, y: 0, angle: 0, length: 4, width: 2, barrels: 1 },
            ],
        };
        expect(blueprintProblems(yardOf(1, picket))).toEqual([]);
        const run = battle(yardOf(1, picket));
        run.step();
        expect(run.ships.canBuildArmed(run.y)).toBe(true);
        runFor(run, 20, () => run.ships.lastBuilt(run.y) >= 0);
        expect(run.ships.lastBuilt(run.y)).toBe(run.world.tick);
    });

    it("builds a ship turned side first, out of its face, and lets it go whole", () => {
        const run = battle(yardOf(1, BAR, { craftAngle: math.PI / 2 }));
        let s = -1;
        runFor(run, 300, () => {
            s = built(run)[0] ?? -1;
            return s >= 0 && run.ships.body(s) !== run.ships.body(run.y);
        });
        expect(s).toBeGreaterThanOrEqual(0);
        expect(run.ships.isUnfinished(s)).toBe(false);
        expect(run.ships.currentStructure(s).modules.length).toBe(BAR.modules.length);
        const bodies = run.world.bodies;
        expect(bodies.x[bodies.indexOf(run.ships.body(s))]!).toBeGreaterThan(bodies.x[bodies.indexOf(run.ships.body(run.y))]!);
    });

    it("builds the ship it is on, side first through its own slipway, as a ship of its own that builds itself too", () => {
        // As broad as it is long with its slipway, so turned it comes out through it.
        const seed: Blueprint = {
            name: "Seed",
            modules: [
                { kind: "core", x: 0, y: 0, length: 4, width: 4 },
                { kind: "hold", x: 0, y: 3.5, length: 4, width: 3 },
                { kind: "generator", x: 0, y: -3.5, length: 4, width: 3 },
                { kind: "slipway", x: -3, y: 0, angle: math.PI, length: 2, width: 6, craft: "Seed", keep: 1, craftAngle: math.PI / 2 },
            ],
        };
        const design = compileBlueprint(seed);
        const run = makeBattle({ seed: 7 }, (ships, world) => {
            ships.spawn(world, { design, x: 0, y: 0, angle: 0 });
            ships.spawn(world, { design: compileBlueprint(BARE_CORE), x: 5000, y: 0, team: 1 });
        });
        const copy = (): number => built({ ...run, y: 0 })[0] ?? -1;
        runFor(run, 1200, () => copy() >= 0 && run.ships.body(copy()) !== run.ships.body(0));
        const s = copy();
        expect(s).toBeGreaterThanOrEqual(0);
        expect(run.ships.body(s)).not.toEqual(run.ships.body(0));
        expect(run.ships.currentStructure(s).modules.length).toBe(seed.modules.length);
        // Its own design, though not the builder's identity, whose modules it was welded among.
        const launched = run.ships.blueprint(s);
        expect(launched).not.toBe(design);
        expect(launched.yards?.[0]?.design).toBe(design);
        // And let go, it lays down one of its own on its own slipway.
        const grandchild = (): number => built({ ...run, y: 0 }).find((g) => g !== s && run.ships.body(g) === run.ships.body(s)) ?? -1;
        runFor(run, 1800, () => grandchild() >= 0);
        expect(grandchild()).toBeGreaterThanOrEqual(0);
        expect(run.ships.isPrinting(grandchild())).toBe(true);
    });
});
