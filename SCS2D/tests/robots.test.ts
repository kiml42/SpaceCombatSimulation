import { describe, expect, it } from "vitest";
import {
    compileBlueprint,
    DAMAGE_ENERGY_PER_KG,
    DamageEffect,
    joints,
    moduleStats,
    REPAIR_WASTE,
    ROBOT_BERTH_PITCH,
    ROBOT_BERTH_VOLUME,
    berthGrid,
    berthRate,
    ROBOT_BUILD_TIME,
    ROBOT_MASS,
    ROBOT_REPAIR_RATE,
    ROBOT_ROOM,
    ROBOT_SPEED,
    ROBOT_TOP_SPEED,
    ROBOT_VIEW_STRIDE,
    doorBetween,
    robotSpeedOver,
    robotsOn,
    ROBOT_WORK_AREA,
    type Blueprint,
} from "../sim/index.js";
import { makeBattle } from "../scenarios/battle.js";
import { mending } from "../scenarios/mending.js";

/** Robots crawling a hull from their bay to mend it (ROADMAP.md §8, repair stage 3). */

/** A core at the bow, three blocks of structure, and a bay at the stern with a hold and a battery beside it. */
const LINE: Blueprint = {
    name: "Line",
    modules: [
        { kind: "core", x: 0, y: 0, length: 3, width: 3 },
        { kind: "structure", x: 4, y: 0, length: 5, width: 3 },
        { kind: "structure", x: 9, y: 0, length: 5, width: 3 },
        { kind: "structure", x: 14, y: 0, length: 5, width: 3 },
        { kind: "robotBay", x: 18.5, y: 0, length: 4, width: 4 },
        { kind: "hold", x: 18.5, y: 3.5, length: 4, width: 3 },
        { kind: "battery", x: 18.5, y: -3.5, length: 4, width: 3 },
    ],
};
const line = compileBlueprint(LINE);
const CORE = line.cores[0]!;
const of = (kind: string, n = 0): number => line.modules.map((m, k) => (m.spec.kind === kind ? k : -1)).filter((k) => k >= 0)[n]!;
const BAY = of("robotBay");
const NEAR = of("structure", 2);
const capacity = (m: number): number => line.modules[m]!.stats.hitPoints * DAMAGE_ENERGY_PER_KG;

function scene(hurt: (absorb: (m: number, share: number) => void) => void): ReturnType<typeof makeBattle<{ a: number }>> {
    return makeBattle({ seed: 1, pilots: false }, (ships, world) => {
        const a = ships.spawn(world, { design: line, x: 0, y: 0, angle: 0 });
        const b = world.bodies.indexOf(ships.body(a));
        hurt((m, share) => ships.damage.absorb(b, m, capacity(m) * share));
        return { a };
    });
}
type Run = ReturnType<typeof scene>;
const body = (run: Run): number => run.world.bodies.indexOf(run.ships.body(run.a));
const absorbed = (run: Run, m: number): number => run.ships.damage.absorbedAt(body(run), m);
const out = (run: Run): number => {
    const places: number[] = [];
    run.ships.robotViews(run.a, places);
    return places.length / ROBOT_VIEW_STRIDE;
};

describe("a robot bay", () => {
    const bay = (length: number, width: number) => moduleStats({ kind: "robotBay", x: 0, y: 0, length, width });

    it("berths as many robots as squares of its deck fit, in a grid, and weighs them", () => {
        expect(bay(4, 4).robots).toBe(4);
        expect(bay(7.5, 6).robots).toBe(9);
        expect(bay(5, 3).robots).toBe(2);
        expect(bay(1.5, 4).robots).toBe(0);
        for (const [length, width] of [
            [4, 4],
            [7.5, 6],
            [5, 3],
        ] as const) {
            const { across, down } = berthGrid({ kind: "robotBay", x: 0, y: 0, length, width });
            expect(across).toBe(Math.floor(length / ROBOT_BERTH_PITCH));
            expect(down).toBe(Math.floor(width / ROBOT_BERTH_PITCH));
            expect(bay(length, width).robots).toBe(across * down);
        }
        expect(bay(4, 4).fittingMass).toBeGreaterThan(bay(4, 4).robots * ROBOT_MASS);
    });

    it("builds and refills its robots faster the more room it has behind each berth", () => {
        // The same four berths, with more bay behind each in the bigger one.
        expect(bay(5.9, 5.9).robots).toBe(bay(4, 4).robots);
        expect(berthRate(bay(5.9, 5.9))).toBeGreaterThan(berthRate(bay(4, 4)));
        const standard = bay(4, 4);
        expect(berthRate(standard)).toBeCloseTo(standard.interior / standard.robots / ROBOT_BERTH_VOLUME, 9);
        expect(berthRate(bay(1.5, 4))).toBe(0);
    });
});

describe("robots", () => {
    it("show where they are going and what they carry", () => {
        const run = scene((absorb) => absorb(CORE, 0.3));
        run.step();
        const views: number[] = [];
        run.ships.robotViews(run.a, views);
        expect(views.length).toBe(line.modules[BAY]!.stats.robots * ROBOT_VIEW_STRIDE);
        // Crawling forward, towards the core, from its berth to where the bay meets the hull ahead, full of both.
        const heading = views[2]!;
        expect(Math.cos(heading)).toBeLessThan(-0.5);
        expect(views[3]).toBeCloseTo(1, 6);
        expect(views[4]).toBeCloseTo(1, 6);
    });

    it("are drawn moving steadily from spot to spot, never jumping, and work spread over the module they are on", () => {
        const run = scene((absorb) => absorb(CORE, 0.3));
        const b = (): number => run.world.bodies.indexOf(run.ships.body(run.a));
        const robots = () =>
            (run.ships as unknown as { robots: { on(b: number): { mode: number; at: number; path: unknown; tag: number }[] } }).robots.on(
                b(),
            );
        const views: number[] = [];
        const last = new Map<number, [number, number]>();
        let working = 0;
        for (let s = 0; s < 40 * 60; s++) {
            run.step();
            run.ships.robotViews(run.a, views);
            const out = robots().filter((r) => r.mode !== 0);
            const spots = new Map<number, [number, number][]>();
            out.forEach((robot, k) => {
                const x = views[k * ROBOT_VIEW_STRIDE]!;
                const y = views[k * ROBOT_VIEW_STRIDE + 1]!;
                const was = last.get(robot.tag);
                // Never a jump: a step's crawl, stretched a little between its spots, and well short of its own length.
                if (was !== undefined) expect(Math.hypot(x - was[0], y - was[1])).toBeLessThan(0.25);
                last.set(robot.tag, [x, y]);
                if (robot.path !== null) return;
                // Working: on its module, and where no other working there is.
                const m = line.modules[robot.at]!;
                expect(Math.abs(x - m.x)).toBeLessThanOrEqual(m.spec.length / 2);
                expect(Math.abs(y - m.y)).toBeLessThanOrEqual(m.spec.width / 2);
                for (const [ox, oy] of spots.get(robot.at) ?? []) expect(Math.hypot(x - ox, y - oy)).toBeGreaterThan(0.1);
                spots.set(robot.at, [...(spots.get(robot.at) ?? []), [x, y]]);
                working++;
            });
            for (const tag of [...last.keys()]) if (!out.some((r) => r.tag === tag)) last.delete(tag);
        }
        expect(working).toBeGreaterThan(0);
    });

    it("crawl carefully over a ship's modules, and faster over broad ones such as rock, up to a cap", () => {
        const at = (across: number): number => robotSpeedOver({ kind: "structure", x: 0, y: 0, length: 300, width: across });
        expect(at(3)).toBe(ROBOT_SPEED);
        expect(at(ROBOT_ROOM)).toBe(ROBOT_SPEED);
        expect(at(1.5 * ROBOT_ROOM)).toBeCloseTo(1.5 * ROBOT_SPEED, 9);
        expect(at(200)).toBe(ROBOT_TOP_SPEED);
    });

    it("mend a module no more of them at once than it has room for, by its area", () => {
        expect(robotsOn({ kind: "claw", x: 0, y: 0, length: 2.5, width: 2 })).toBe(2);
        expect(robotsOn({ kind: "structure", x: 0, y: 0, length: 1, width: 1 })).toBe(1);
        expect(robotsOn({ kind: "hold", x: 0, y: 0, length: 4, width: 8 })).toBe((4 * 8) / ROBOT_WORK_AREA);
        // A small core and a big bay: more robots than the core has room for.
        const crowded = compileBlueprint({
            name: "Crowded",
            modules: [
                { kind: "core", x: 0.5, y: 0, length: 2, width: 2 },
                { kind: "structure", x: 4, y: 0, length: 5, width: 3 },
                { kind: "structure", x: 9, y: 0, length: 5, width: 3 },
                { kind: "structure", x: 14, y: 0, length: 5, width: 3 },
                { kind: "robotBay", x: 20.5, y: 0, length: 8, width: 8 },
                { kind: "hold", x: 20.5, y: 5.5, length: 4, width: 3 },
                { kind: "battery", x: 20.5, y: -5.5, length: 4, width: 3 },
            ],
        });
        const core = crowded.cores[0]!;
        const run = makeBattle({ seed: 1, pilots: false }, (ships, world) => {
            const a = ships.spawn(world, { design: crowded, x: 0, y: 0, angle: 0 });
            const b = world.bodies.indexOf(ships.body(a));
            ships.damage.absorb(b, core, crowded.modules[core]!.stats.hitPoints * DAMAGE_ENERGY_PER_KG * 0.5);
            return { a };
        });
        const robots = () =>
            (run.ships as unknown as { robots: { on(b: number): { target: number; mode: number }[] } }).robots.on(
                run.world.bodies.indexOf(run.ships.body(run.a)),
            );
        expect(crowded.modules.find((m) => m.spec.kind === "robotBay")!.stats.robots).toBeGreaterThan(
            robotsOn(crowded.modules[core]!.spec),
        );
        let most = 0;
        for (let s = 0; s < 20 * 60; s++) {
            run.step();
            most = Math.max(most, robots().filter((r) => r.mode !== 0 && r.target === core).length);
        }
        expect(most).toBe(robotsOn(crowded.modules[core]!.spec));
    });

    it("each have a berth of their own in their bay, where they are drawn home", () => {
        const run = scene(() => {});
        run.step();
        const docked: number[] = [];
        run.ships.robotsDocked(run.a, docked);
        const berths = new Set<string>();
        for (let r = 0; r < docked.length; r += 4) berths.add(`${docked[r]}:${docked[r + 3]}`);
        expect(berths.size).toBe(docked.length / 4);
        expect(berths.size).toBe(line.modules[BAY]!.stats.robots);
    });

    it("cross from one module to the next where they meet, not straight across between their middles", () => {
        // The core's bow face, 3 m across, meets the first block of structure at its middle.
        const core = line.modules[CORE]!;
        const door = doorBetween(line, CORE, of("structure"))!;
        expect(door[0]).toBeCloseTo(core.x + core.spec.length / 2, 6);
        expect(door[1]).toBeCloseTo(core.y, 6);
        expect(doorBetween(line, CORE, BAY)).toBeNull();
    });

    it("stay in their bay while nothing needs mending", () => {
        const run = scene(() => {});
        for (let s = 0; s < 120; s++) run.step();
        expect(out(run)).toBe(0);
    });

    it("crawl out to what is damaged, mend the core first, and come home once all is whole", () => {
        // Short of ragged, which would cut the bay off from command (and so from work).
        const run = scene((absorb) => {
            absorb(CORE, 0.3);
            absorb(NEAR, 0.7);
        });
        const metal = (): number => run.ships.metal.pieceHeld(body(run), BAY);
        const shed = run.ships.damage.shedAt(body(run), CORE) + run.ships.damage.shedAt(body(run), NEAR);
        // Settled by a step, so the shedding is not counted below.
        run.step();
        const metalBefore = metal();
        const discardedBefore = run.ships.discarded;
        expect(out(run)).toBeGreaterThan(0);
        // Not mended before a robot could have crawled there from the bay.
        const reach = Math.abs(line.modules[BAY]!.x - line.modules[CORE]!.x);
        for (let s = 1; s < Math.floor((reach / ROBOT_SPEED) * 60) - 1; s++) run.step();
        expect(absorbed(run, CORE)).toBe(capacity(CORE) * 0.3);
        // The nearer structure is left until a robot is free of the core.
        let steps = 0;
        while (absorbed(run, CORE) > 0 && steps++ < 600 * 60) run.step();
        expect(absorbed(run, CORE)).toBe(0);
        while ((absorbed(run, NEAR) > 0 || out(run) > 0) && steps++ < 600 * 60) run.step();
        expect(absorbed(run, NEAR)).toBe(0);
        expect(out(run)).toBe(0);
        // What they shed went back in, with a tenth more lost.
        expect(metalBefore - metal()).toBeCloseTo(shed * (1 + REPAIR_WASTE), 3);
        expect(run.ships.discarded - discardedBefore).toBeCloseTo(shed * REPAIR_WASTE, 3);
    });

    it("run short mending their own bay, and berth there to refill", { timeout: 60_000 }, () => {
        const run = scene((absorb) => absorb(BAY, 0.6));
        for (const robot of run.ships.robots.on(body(run))!) robot.metal = 10;
        let steps = 0;
        while (absorbed(run, BAY) > 0 && steps++ < 600 * 60) run.step();
        expect(absorbed(run, BAY)).toBe(0);
    });

    it("with only rounding left of their metal and a bay that cannot refill them, stay berthed", () => {
        // No core working, so no command reaches the bay.
        const run = scene((absorb) => absorb(CORE, 1.5));
        for (const robot of run.ships.robots.on(body(run))!) robot.metal = 1e-13;
        for (let s = 0; s < 60 * 60; s++) {
            run.step();
            expect(out(run)).toBe(0);
        }
    });

    it("come home and stay there when their hull has no metal left to mend with", () => {
        const run = scene((absorb) => absorb(NEAR, 0.5));
        const b = body(run);
        run.ships.metal.drain(b, NEAR, run.ships.metal.pieceHeld(b, NEAR));
        expect(run.ships.metal.pieceHeld(b, NEAR)).toBe(0);
        let steps = 0;
        while (out(run) === 0 && steps++ < 60 * 60) run.step();
        while (out(run) > 0 && steps++ < 120 * 60) run.step();
        expect(out(run)).toBe(0);
        for (let s = 0; s < 60 * 60; s++) {
            run.step();
            expect(out(run)).toBe(0);
        }
        expect(absorbed(run, NEAR)).toBeGreaterThan(0);
    });

    it("mend their own bay before structure, since it makes every other job quicker", { timeout: 60_000 }, () => {
        const run = scene((absorb) => {
            absorb(BAY, 0.3);
            absorb(NEAR, 0.3);
        });
        let steps = 0;
        while (absorbed(run, BAY) > 0 && steps++ < 600 * 60) run.step();
        expect(absorbed(run, BAY)).toBe(0);
        expect(absorbed(run, NEAR)).toBe(capacity(NEAR) * 0.3);
    });

    it("plug every hole in a tank they mend, however wide", { timeout: 60_000 }, () => {
        const TANKED: Blueprint = {
            name: "Tanked",
            modules: [...LINE.modules, { kind: "tank", x: 23, y: 0, length: 5, width: 4 }],
        };
        const tanked = compileBlueprint(TANKED);
        const tank = tanked.modules.findIndex((m) => m.spec.kind === "tank");
        const run = makeBattle({ seed: 1, pilots: false }, (ships, world) => {
            const a = ships.spawn(world, { design: tanked, x: 0, y: 0, angle: 0 });
            const b = world.bodies.indexOf(ships.body(a));
            // Too wide for any lining to close, and the damage the round that made it did.
            ships.fuel.hole(b, { module: tank, x: 2.5, y: 0, nx: 1, ny: 0, width: 0.5, floor: 0.5, closing: 0, rate: 0 });
            ships.damage.absorb(b, tank, tanked.modules[tank]!.stats.hitPoints * DAMAGE_ENERGY_PER_KG * 0.2);
            return { a };
        });
        const b = (): number => run.world.bodies.indexOf(run.ships.body(run.a));
        expect(run.ships.fuel.leaksOf(b())).toHaveLength(1);
        let steps = 0;
        while (run.ships.fuel.leaksOf(b()).length > 0 && steps++ < 120 * 60) run.step();
        expect(run.ships.fuel.leaksOf(b())).toHaveLength(0);
        const held = run.ships.fuel.held(b(), tank);
        for (let s = 0; s < 60; s++) run.step();
        expect(run.ships.fuel.held(b(), tank)).toBe(held);
    });

    it("mend no faster than the robots there can work", () => {
        const run = scene((absorb) => absorb(NEAR, 0.5));
        let steps = 0;
        while (absorbed(run, NEAR) > 0 && steps++ < 600 * 60) run.step();
        const robots = line.modules[BAY]!.stats.robots;
        expect(steps / 60).toBeGreaterThanOrEqual((capacity(NEAR) * 0.5) / (ROBOT_REPAIR_RATE * robots));
    });

    it("work on for a ship that has lost control, and give it back", () => {
        const run = scene((absorb) => {
            absorb(CORE, 0.9);
            absorb(NEAR, 0.5);
        });
        expect(run.ships.hasControl(run.a)).toBe(false);
        let steps = 0;
        while ((absorbed(run, CORE) > 0 || absorbed(run, NEAR) > 0) && steps++ < 600 * 60) run.step();
        expect(absorbed(run, CORE)).toBe(0);
        expect(absorbed(run, NEAR)).toBe(0);
        expect(run.ships.hasControl(run.a)).toBe(true);
    });

    it("mend the ragged spine that cuts their bay off from command", () => {
        // Torn past ragged beside the bay, so no command reaches it.
        const run = scene((absorb) => absorb(NEAR, 2));
        run.step();
        expect(run.ships.damage.remaining(body(run), BAY, DamageEffect.Tending)).toBe(0);
        expect(out(run)).toBeGreaterThan(0);
        let steps = 0;
        while (absorbed(run, NEAR) > 0 && steps++ < 600 * 60) run.step();
        expect(absorbed(run, NEAR)).toBe(0);
        expect(run.ships.damage.remaining(body(run), BAY, DamageEffect.Tending)).toBe(1);
    });

    it("cut off from their bay are lost with the piece they were on", () => {
        const run = scene((absorb) => absorb(CORE, 0.3));
        // Out on the hull, past the bay's neighbour, then the spine is cut behind them.
        for (let s = 0; s < 3 * 60; s++) run.step();
        const berths = line.modules[BAY]!.stats.robots;
        const outside = out(run);
        expect(outside).toBe(berths);
        const b = body(run);
        const all = joints(line);
        const cut = all.findIndex((j) => (j.a === NEAR || j.b === NEAR) && (j.a === BAY || j.b === BAY));
        run.ships.damage.cutWeld(b, cut, all[cut]!.width * 2);
        run.step();
        expect(run.world.bodies.count).toBe(2);
        let left = 0;
        for (let k = 0; k < run.world.bodies.highWater; k++) left += run.ships.robots.on(k)?.length ?? 0;
        expect(left).toBe(berths - outside);
    });

    it("mend a battered ship whole and come home, never stalling at a trickle", { timeout: 60_000 }, () => {
        const run = mending();
        const ships = run.ships;
        const total = (): number => {
            const b = run.world.bodies.indexOf(ships.body(0));
            let sum = 0;
            for (let m = 0; m < ships.currentStructure(0).modules.length; m++) sum += ships.damage.absorbedAt(b, m);
            return sum;
        };
        const places: number[] = [];
        for (let s = 0; s < 300 * 60; s++) run.step();
        ships.robotViews(0, places);
        expect(total()).toBe(0);
        expect(places.length).toBe(0);
    });

    describe("lost and built anew", () => {
        const HOLD = of("hold");
        const count = (run: Run): number => run.ships.robots.on(body(run))?.length ?? 0;
        const working = (run: Run, m: number): number =>
            (run.ships.robots.on(body(run)) ?? []).filter((r) => r.mode === 2 && r.target === m).length;

        it("are lost with a module destroyed under them, and their bay builds them again", () => {
            const run = scene((absorb) => absorb(HOLD, 0.3));
            const berths = line.modules[BAY]!.stats.robots;
            let steps = 0;
            while (working(run, HOLD) === 0 && steps++ < 60 * 60) run.step();
            const caught = working(run, HOLD);
            expect(caught).toBeGreaterThan(0);
            const mass = run.world.bodies.mass[body(run)]!;
            const discarded = run.ships.discarded;
            // Torn apart while they are on it.
            run.ships.damage.absorb(body(run), HOLD, capacity(HOLD) * 2);
            run.step();
            expect(count(run)).toBe(berths - caught);
            expect(mass - run.world.bodies.mass[body(run)]!).toBeGreaterThanOrEqual(caught * ROBOT_MASS - 1e-6);
            expect(run.ships.discarded - discarded).toBeGreaterThanOrEqual(caught * ROBOT_MASS - 1e-6);
            // Built again, side by side as its metal allows: no sooner than one takes,
            // and sooner than one at a time.
            steps = 0;
            while (count(run) < berths && steps++ < 600 * 60) run.step();
            expect(count(run)).toBe(berths);
            const one = ROBOT_BUILD_TIME / berthRate(line.modules[BAY]!.stats);
            expect(steps / 60).toBeGreaterThanOrEqual(one - 1);
            if (caught > 1) expect(steps / 60).toBeLessThan(caught * one);
        });

        it("start as many as the metal aboard pays for, the metal counted as the robots from the start", () => {
            const run = scene(() => {});
            run.step();
            const b = body(run);
            const cost = ROBOT_MASS * (1 + REPAIR_WASTE);
            for (let k = 0; k < 3; k++) run.ships.robots.lose(b, 0);
            // Metal for two of the three, and no more.
            run.ships.metal.drain(b, BAY, run.ships.metal.pieceHeld(b, BAY) - 2.5 * cost);
            const missing = run.ships.robots.missingMass(b);
            run.step();
            expect(run.ships.robots.buildingOn(b)![BAY]!.length).toBe(2);
            expect(run.ships.metal.pieceHeld(b, BAY)).toBeCloseTo(0.5 * cost, 3);
            // What went from the hold is aboard as the two robots, but for the waste.
            expect(missing - run.ships.robots.missingMass(b)).toBeCloseTo(2 * ROBOT_MASS, 3);
            // Both finish together, a robot's build time on.
            const one = ROBOT_BUILD_TIME / berthRate(line.modules[BAY]!.stats);
            for (let s = 0; s < (one - 1) * 60; s++) run.step();
            expect(count(run)).toBe(line.modules[BAY]!.stats.robots - 3);
            for (let s = 0; s < 2 * 60; s++) run.step();
            expect(count(run)).toBe(line.modules[BAY]!.stats.robots - 1);
        });

        it("are not lost going to mend a module already destroyed", () => {
            const run = scene((absorb) => absorb(HOLD, 1.5));
            const berths = line.modules[BAY]!.stats.robots;
            let steps = 0;
            while (absorbed(run, HOLD) > 0 && steps++ < 600 * 60) run.step();
            expect(absorbed(run, HOLD)).toBe(0);
            expect(count(run)).toBe(berths);
        });

        it("in a bay that is destroyed are lost, and none are built", () => {
            const run = scene(() => {});
            run.step();
            run.ships.damage.absorb(body(run), BAY, capacity(BAY) * 2);
            run.step();
            expect(count(run)).toBe(0);
            for (let s = 0; s < (ROBOT_BUILD_TIME + 5) * 60; s++) run.step();
            expect(count(run)).toBe(0);
        });
    });
});
