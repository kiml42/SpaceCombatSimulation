import { describe, expect, it } from "vitest";
import {
    compileBlueprint,
    fleetBill,
    fleetHulls,
    fleetMass,
    fleetReach,
    NO_BUDGET,
    Rng,
    serialiseFleet,
    shipFleet,
    type Fleet,
} from "../sim/index.js";
import { isFleet, Match, runMatch } from "../evolution/match.js";
import { DEFAULT_FLEET_LIMITS, fleetFits, mutateFleet, type FleetMutationLimits, type FleetOperator } from "../evolution/fleetMutate.js";
import { entrantOf, generationSize, runEvolution, shipCount } from "../evolution/run.js";
import { parseRunConfig, runConfigFileProblem, runConfigWarnings, serialiseRunConfig } from "../evolution/configFile.js";
import { DEFAULT_RUN } from "../evolution/run.js";
import { BARE_CORE, CORVETTE, DINKY, GUNSHIP } from "../scenarios/blueprints.js";
import { LINE_OF_BATTLE } from "../scenarios/fleets.js";
import { FACTORY } from "../scenarios/carrier.js";
import { addShip, emptyFleet } from "../editor/fleetEdit.js";

/** Fleets as entrants, bred as fleets. */

const SHORT = { duration: 20 };

/** Limits that make only the one change: a design, every ship's move, or one change to what the fleet is made of. */
function only(change: FleetOperator | "design" | "move"): Partial<FleetMutationLimits> {
    const operators = { add: 0, remove: 0, fork: 0, merge: 0, swap: 0, pad: 0, steal: 0, spread: 0 };
    if (change === "design") return { design: 1, move: 0, change: 0, operators };
    if (change === "move") return { design: 0, move: 1, change: 0, operators };
    operators[change] = 1;
    return { design: 0, move: 0, change: 1, operators };
}

/** A Factory, whose pad keeps a Dinky, and a Dinky beside it. */
function carrierFleet(): Fleet {
    return addShip(addShip(emptyFleet("Carrier"), FACTORY, 0, 0), DINKY, 60, 0);
}

function pair(): Fleet {
    return {
        name: "Pair",
        designs: { Dinky: DINKY },
        ships: [
            { design: "Dinky", x: 0, y: -40 },
            { design: "Dinky", x: 0, y: 40 },
        ],
    };
}

describe("a match of fleets", () => {
    it("scores a fleet of one exactly as the ship alone", () => {
        const ships = runMatch([CORVETTE, GUNSHIP, DINKY], { ...SHORT, seed: 3 });
        const fleets = runMatch([shipFleet(CORVETTE), GUNSHIP, shipFleet(DINKY)], { ...SHORT, seed: 3 });
        expect(JSON.stringify(fleets)).toEqual(JSON.stringify(ships));
    });

    it("fields every ship of every fleet, taking turns", () => {
        const match = new Match([pair(), CORVETTE], { seed: 1 });
        expect(match.battle.owners).toEqual([0, 1, 0]);
    });

    it("keeps survival a fraction however many ships a side has", () => {
        const result = runMatch([LINE_OF_BATTLE, pair()], { ...SHORT, seed: 2 });
        for (const score of result.scores) {
            expect(score.survival).toBeGreaterThanOrEqual(0);
            expect(score.survival).toBeLessThanOrEqual(1);
        }
    });

    it("scores survival as one fraction per fleet, not per ship", () => {
        // Over before the pair drift within reach of each other's flames.
        const unhurt = { duration: 15, seed: 2 };
        const alone = runMatch([shipFleet(DINKY)], unhurt);
        const two = runMatch([pair()], unhurt);
        expect(alone.scores[0]!.survival).toBeCloseTo(1, 9);
        expect(two.scores[0]!.survival).toBeCloseTo(1, 9);
    });

    it("races by the nearest ship, so a straggler costs nothing", () => {
        const straggler: Fleet = {
            name: "Straggler",
            designs: { Dinky: DINKY, Core: BARE_CORE },
            ships: [
                { design: "Dinky", x: 0, y: 0 },
                { design: "Core", x: -150, y: 0 },
            ],
        };
        const match = new Match([straggler, CORVETTE], { ...SHORT, seed: 2 });
        const { ships, world, slots, owners, marker } = match.battle;
        const nearest = (): number => {
            const goal = world.bodies.indexOf(ships.body(marker));
            let best = 0;
            let fighting = false;
            slots.forEach((slot, k) => {
                if (owners[k] !== 0 || !ships.isAlive(slot) || !ships.hasControl(slot)) return;
                const body = world.bodies.indexOf(ships.body(slot));
                const d = Math.sqrt(
                    (world.bodies.x[body]! - world.bodies.x[goal]!) ** 2 + (world.bodies.y[body]! - world.bodies.y[goal]!) ** 2,
                );
                best = Math.max(best, 500 / (500 + d));
                if (!ships.isDisabled(slot)) fighting = true;
            });
            // A fleet with nothing left that can fight races no further.
            return fighting ? best : 0;
        };
        const start = nearest();
        let sum = 0;
        let steps = 0;
        while (!match.done) {
            match.advance();
            steps++;
            const best = nearest();
            if (best > 0) sum += best - start;
        }
        expect(match.result().scores[0]!.race).toBeCloseTo(sum / steps, 6);
    });

    it("widens the ring rather than start two fleets on top of each other", () => {
        const wide: Fleet = { ...LINE_OF_BATTLE, ships: LINE_OF_BATTLE.ships.map((s) => ({ ...s, x: s.x * 3, y: s.y * 3 })) };
        const match = new Match([wide, wide, wide, wide], { seed: 4, radius: 100 });
        const { ships, world, owners, slots } = match.battle;
        const at = slots.map((slot) => {
            const body = world.bodies.indexOf(ships.body(slot));
            return { x: world.bodies.x[body]!, y: world.bodies.y[body]!, r: ships.currentStructure(slot).radius };
        });
        for (let i = 0; i < at.length; i++) {
            for (let k = i + 1; k < at.length; k++) {
                if (owners[i] === owners[k]) continue;
                const gap = Math.sqrt((at[i]!.x - at[k]!.x) ** 2 + (at[i]!.y - at[k]!.y) ** 2);
                expect(gap).toBeGreaterThan(at[i]!.r + at[k]!.r);
            }
        }
    });
});

describe("breeding a fleet", () => {
    it("breeds the same fleet from the same seed", () => {
        const one = mutateFleet(LINE_OF_BATTLE, new Rng(7));
        const two = mutateFleet(LINE_OF_BATTLE, new Rng(7));
        expect(JSON.stringify(one)).toEqual(JSON.stringify(two));
    });

    it("makes a change with every operator, each within the limits", () => {
        const limits = { radius: 500, maxShips: 24, budget: NO_BUDGET, rivals: [carrierFleet()] };
        const parents: Record<FleetOperator | "design" | "move", Fleet> = {
            design: LINE_OF_BATTLE,
            move: LINE_OF_BATTLE,
            add: pair(),
            remove: LINE_OF_BATTLE,
            fork: pair(),
            merge: LINE_OF_BATTLE,
            swap: LINE_OF_BATTLE,
            pad: carrierFleet(),
            steal: pair(),
            spread: LINE_OF_BATTLE,
        };
        for (const [operator, parent] of Object.entries(parents) as [FleetOperator | "design" | "move", Fleet][]) {
            const child = mutateFleet(parent, new Rng(11), { ...limits, ...only(operator) });
            expect(child.edits.length, operator).toBeGreaterThan(0);
            expect(fleetFits(child.fleet, limits), operator).toBe(true);
        }
    });

    it("steals a rival's design with the craft it builds, under names of its own", () => {
        const child = mutateFleet(pair(), new Rng(3), { ...only("steal"), rivals: [carrierFleet()] });
        expect(child.edits).toHaveLength(1);
        const fleet = child.fleet;
        expect(fleet.ships).toHaveLength(3);
        const added = fleet.ships[2]!;
        expect("design" in added && fleet.designs[added.design]).toBeTruthy();
        // Its own Dinky is left alone; the copy's pad builds the copied one, renamed.
        expect(JSON.stringify(fleet.designs["Dinky"])).toBe(JSON.stringify(DINKY));
        const crafts = (fleet.designs["Dinky 2"] === undefined ? [] : ["Dinky 2"]).concat(
            Object.values(fleet.designs).flatMap((design) =>
                design.modules.flatMap((p) => ("craft" in p && p.craft !== undefined ? [p.craft] : [])),
            ),
        );
        expect(crafts.every((name) => fleet.designs[name] !== undefined)).toBe(true);
        expect(fleetFits(fleet, { radius: 500, maxShips: 24, budget: NO_BUDGET })).toBe(true);
        // Nothing to copy from, nothing copied.
        expect(mutateFleet(pair(), new Rng(3), only("steal")).edits).toEqual([]);
    });

    it("steals a rival's heavier design more often than its lighter one", () => {
        const rival = addShip(addShip(emptyFleet("Rival"), BARE_CORE, 0, 0), GUNSHIP, 80, 0);
        const copied = (name: string): number =>
            [...Array(40).keys()].filter((seed) =>
                mutateFleet(pair(), new Rng(seed), { ...only("steal"), rivals: [rival] }).edits[0]?.includes(`Rival's ${name} stolen`),
            ).length;
        expect(copied(GUNSHIP.name)).toBeGreaterThan(3 * copied(BARE_CORE.name));
    });

    it("spreads a fleet out or draws it in about its middle, the same for every ship", () => {
        const ratios = new Set<string>();
        for (let seed = 0; seed < 20; seed++) {
            const child = mutateFleet(LINE_OF_BATTLE, new Rng(seed), { ...only("spread"), move: 0 });
            if (child.edits.length === 0) continue;
            expect(child.edits[0]).toMatch(/^fleet (spread out|drawn in) by /);
            const centre = (fleet: Fleet): { x: number; y: number } => ({
                x: fleet.ships.reduce((sum, e) => sum + e.x, 0) / fleet.ships.length,
                y: fleet.ships.reduce((sum, e) => sum + e.y, 0) / fleet.ships.length,
            });
            const before = centre(LINE_OF_BATTLE);
            const factors = LINE_OF_BATTLE.ships.flatMap((entry, i) => {
                const was = Math.hypot(entry.x - before.x, entry.y - before.y);
                const now = child.fleet.ships[i]!;
                return was > 1 ? [Math.hypot(now.x - before.x, now.y - before.y) / was] : [];
            });
            for (const factor of factors) expect(factor).toBeCloseTo(factors[0]!, 1);
            ratios.add(factors[0]! > 1 ? "out" : "in");
        }
        expect([...ratios].sort()).toEqual(["in", "out"]);
    });

    it("swaps a ship onto another of its fleet's designs, keeping the count", () => {
        const designs = (fleet: Fleet): string[] => fleet.ships.map((entry) => ("design" in entry ? entry.design : `group ${entry.group}`));
        const before = designs(LINE_OF_BATTLE);
        const child = mutateFleet(LINE_OF_BATTLE, new Rng(5), { ...only("swap") });
        expect(child.edits[0]).toMatch(/rebuilt as a/);
        const after = designs(child.fleet);
        expect(after).toHaveLength(before.length);
        const changed = after.filter((name, i) => name !== before[i]);
        expect(changed).toHaveLength(1);
        expect(before).toContain(changed[0]);
    });

    it("moves ships apart more often than together, the closer they stand", () => {
        // Two dinkies a little over a radius-sum apart.
        const crowded: Fleet = {
            name: "Crowded",
            designs: { Dinky: DINKY },
            ships: [
                { design: "Dinky", x: 0, y: 0 },
                { design: "Dinky", x: compileBlueprint(DINKY).radius * 2.2, y: 0 },
            ],
        };
        const gap = (f: Fleet): number => Math.hypot(f.ships[1]!.x - f.ships[0]!.x, f.ships[1]!.y - f.ships[0]!.y);
        const rng = new Rng(9);
        let apart = 0;
        let together = 0;
        for (let i = 0; i < 300; i++) {
            const child = mutateFleet(crowded, rng, { ...only("move") }).fleet;
            if (gap(child) > gap(crowded) + 1e-9) apart++;
            else if (gap(child) < gap(crowded) - 1e-9) together++;
        }
        expect(apart).toBeGreaterThan(together * 2);
    });

    it("mutates each design with a chance of its own, however many designs there are", () => {
        const share = (fleet: Fleet): number => {
            const rng = new Rng(4);
            let changed = 0;
            const tries = 200;
            for (let i = 0; i < tries; i++) {
                const child = mutateFleet(fleet, rng, { design: 0.5, move: 0, change: 0 });
                if (JSON.stringify(child.fleet.designs.Dinky) !== JSON.stringify(fleet.designs.Dinky)) changed++;
            }
            return changed / tries;
        };
        const many: Fleet = {
            name: "Many",
            designs: { Dinky: DINKY, Corvette: CORVETTE, Gunship: GUNSHIP, Core: BARE_CORE },
            ships: [
                { design: "Dinky", x: 0, y: 0 },
                { design: "Corvette", x: 300, y: 0 },
                { design: "Gunship", x: 0, y: 300 },
                { design: "Core", x: -300, y: 0 },
            ],
        };
        const alone = share(pair());
        expect(alone).toBeGreaterThan(0.35);
        expect(alone).toBeLessThan(0.65);
        expect(Math.abs(share(many) - alone)).toBeLessThan(0.15);
    });

    it("moves every ship in every child", () => {
        const rng = new Rng(2);
        for (let i = 0; i < 20; i++) {
            const child = mutateFleet(pair(), rng, { ...only("move") }).fleet;
            child.ships.forEach((entry, k) => {
                const was = pair().ships[k]!;
                expect(entry.x !== was.x || entry.y !== was.y).toBe(true);
            });
        }
    });

    it("never leaves the parent changed", () => {
        const before = JSON.stringify(LINE_OF_BATTLE);
        for (let seed = 0; seed < 20; seed++) mutateFleet(LINE_OF_BATTLE, new Rng(seed));
        expect(JSON.stringify(LINE_OF_BATTLE)).toEqual(before);
    });

    it("refuses what breaks a limit, and returns the parent", () => {
        const bill = fleetBill(fleetHulls(pair()));
        const parent = pair();
        const crowded = mutateFleet(parent, new Rng(3), { maxShips: 2, ...only("add") });
        expect(crowded.edits).toEqual([]);
        expect(crowded.fleet).toBe(parent);
        // Each of the three bounds the whole fleet on its own.
        for (const key of ["metal", "fuel", "build"] as const) {
            const dear = mutateFleet(pair(), new Rng(3), { budget: { ...NO_BUDGET, [key]: bill[key] * 1.2 }, ...only("add") });
            expect(dear.edits, key).toEqual([]);
        }
        const lone = shipFleet(DINKY);
        const cramped = mutateFleet(lone, new Rng(3), { radius: fleetReach(fleetHulls(lone)) + 1, ...only("add") });
        expect(cramped.edits).toEqual([]);
    });

    it("keeps one entry, however often entries are taken out", () => {
        let fleet = LINE_OF_BATTLE;
        const rng = new Rng(5);
        for (let i = 0; i < 20; i++) fleet = mutateFleet(fleet, rng, { ...only("remove") }).fleet;
        expect(fleet.ships).toHaveLength(1);
        expect(fleetFits(fleet, { radius: 500, maxShips: 24, budget: NO_BUDGET })).toBe(true);
    });

    it("merges back what it forked", () => {
        const forked = mutateFleet(pair(), new Rng(1), { ...only("fork") }).fleet;
        expect(Object.keys(forked.designs)).toEqual(["Dinky", "Dinky 2"]);
        const merged = mutateFleet(forked, new Rng(1), { ...only("merge") }).fleet;
        expect(Object.keys(merged.designs)).toHaveLength(1);
        expect(fleetHulls(merged)).toHaveLength(2);
    });
});

describe("where a fleet's ships go", () => {
    it("moves a ship by a share of its own size", () => {
        // A Dinky and a Gunship well apart, so neither move is refused for the other.
        const fleet: Fleet = {
            name: "Odd pair",
            designs: { Dinky: DINKY, Gunship: GUNSHIP },
            ships: [
                { design: "Dinky", x: 0, y: -150 },
                { design: "Gunship", x: 0, y: 150 },
            ],
        };
        const moved = { Dinky: [] as number[], Gunship: [] as number[] };
        for (let seed = 0; seed < 60; seed++) {
            const child = mutateFleet(fleet, new Rng(seed), { ...only("move") }).fleet;
            child.ships.forEach((entry, i) => {
                const was = fleet.ships[i]!;
                const by = Math.sqrt((entry.x - was.x) ** 2 + (entry.y - was.y) ** 2);
                if (by > 0 && "design" in entry) moved[entry.design as "Dinky" | "Gunship"].push(by);
            });
        }
        const median = (values: number[]): number => [...values].sort((a, b) => a - b)[values.length >> 1]!;
        const ratio = compileBlueprint(GUNSHIP).radius / compileBlueprint(DINKY).radius;
        expect(median(moved.Gunship) / median(moved.Dinky)).toBeGreaterThan(ratio / 3);
    });

    it("adds a ship clear of the one beside it by both their sizes", () => {
        const lone: Fleet = { name: "Lone", designs: { Gunship: GUNSHIP }, ships: [{ design: "Gunship", x: 0, y: 0 }] };
        const radius = compileBlueprint(GUNSHIP).radius;
        let seen = 0;
        for (let seed = 0; seed < 30; seed++) {
            const child = mutateFleet(lone, new Rng(seed), { ...only("add") }).fleet;
            const added = child.ships[1];
            if (added === undefined || !("design" in added) || added.design !== "Gunship") continue;
            seen++;
            expect(Math.sqrt(added.x ** 2 + added.y ** 2)).toBeGreaterThanOrEqual(2 * radius);
        }
        expect(seen).toBeGreaterThan(0);
    });
});

describe("designs a fleet carries but does not fly", () => {
    const flown = (fleet: Fleet): string[] => [...new Set(fleet.ships.map((entry) => ("design" in entry ? entry.design : "")))];

    it("keeps the design of a ship taken out", () => {
        const fleet: Fleet = {
            ...pair(),
            designs: { Dinky: DINKY, Corvette: CORVETTE },
            ships: [...pair().ships, { design: "Corvette", x: 80, y: 0 }],
        };
        for (let seed = 0; seed < 10; seed++) {
            const child = mutateFleet(fleet, new Rng(seed), { ...only("remove") }).fleet;
            expect(Object.keys(child.designs)).toEqual(["Dinky", "Corvette"]);
        }
    });

    it("adds a ship of a design it does not fly, or a bare core, the heavier the likelier", () => {
        const fleet: Fleet = { ...pair(), designs: { Dinky: DINKY, Gunship: GUNSHIP } };
        const built = new Map<string, number>();
        for (let seed = 0; seed < 200; seed++) {
            const child = mutateFleet(fleet, new Rng(seed), { ...only("add") }).fleet;
            expect(child.ships).toHaveLength(3);
            const added = child.ships[2]!;
            const name = "design" in added ? added.design : "";
            built.set(name, (built.get(name) ?? 0) + 1);
            if (child.designs["Bare Core"] !== undefined) expect(child.designs["Bare Core"].modules).toEqual(BARE_CORE.modules);
        }
        expect([...built.keys()].sort()).toEqual(["Bare Core", "Dinky", "Gunship"]);
        expect(built.get("Gunship")!).toBeGreaterThan(built.get("Dinky")!);
        expect(built.get("Dinky")!).toBeGreaterThan(built.get("Bare Core")!);
    });

    it("adds a bare core it already carries without a second copy of the design", () => {
        const fleet: Fleet = { ...pair(), designs: { Dinky: DINKY, Core: { ...BARE_CORE, name: "Core" } } };
        for (let seed = 0; seed < 20; seed++) {
            expect(Object.keys(mutateFleet(fleet, new Rng(seed), { ...only("add") }).fleet.designs)).toEqual(["Dinky", "Core"]);
        }
    });

    it("never mutates a design it does not fly", () => {
        const fleet: Fleet = { ...pair(), designs: { Dinky: DINKY, Gunship: GUNSHIP } };
        const before = JSON.stringify(GUNSHIP);
        let child = fleet;
        const rng = new Rng(9);
        for (let i = 0; i < 30; i++) {
            child = mutateFleet(child, rng, {
                operators: { add: 0, remove: 0, fork: 1, merge: 1, swap: 1, pad: 0, steal: 0, spread: 0 },
                design: 1,
                change: 1,
            }).fleet;
            expect(flown(child)).not.toContain("Gunship");
        }
        expect(JSON.stringify(child.designs.Gunship)).toEqual(before);
    });
});

describe("a run of fleets", () => {
    const settings = { seed: 2, generations: 2, population: 4, winners: 2, group: 2, minMatches: 1, match: SHORT };

    it("records each individual as a fleet, with its whole mass", () => {
        const run = runEvolution([pair()], settings);
        for (const generation of run.generations) {
            for (const individual of generation.individuals) {
                const fleet = entrantOf(individual);
                expect(isFleet(fleet)).toBe(true);
                expect(individual.blueprint).toBeUndefined();
                expect(individual.mass).toBeCloseTo(fleetMass(fleetHulls(fleet as Fleet)));
                expect(individual.bill).toEqual(fleetBill(fleetHulls(fleet as Fleet)));
            }
        }
        const bred = run.generations.flatMap((g) => g.individuals).filter((i) => i.parent >= 0);
        expect(bred.some((i) => i.edits.length > 0)).toBe(true);
    });

    it("takes a ship among fleet founders as a fleet of one", () => {
        const run = runEvolution([pair(), CORVETTE], { ...settings, generations: 1 });
        const founder = run.generations[0]!.individuals.find((i) => i.id === 1)!;
        const fleet = entrantOf(founder) as Fleet;
        expect(fleet.ships).toHaveLength(1);
        expect(fleetMass(fleetHulls(fleet))).toBeCloseTo(compileBlueprint(CORVETTE).mass);
    });

    it("lets a ship founder grow into a fleet", () => {
        const run = runEvolution([DINKY], { ...settings, generations: 3 });
        for (const generation of run.generations) {
            for (const individual of generation.individuals) expect(isFleet(entrantOf(individual))).toBe(true);
        }
    });

    it("sizes a generation by its mean and by its fittest", () => {
        const run = runEvolution([pair()], settings);
        for (const generation of run.generations) {
            const size = generationSize(generation);
            const all = generation.individuals;
            const fittest = all.find((i) => i.fitness === generation.bestFitness)!;
            expect(size.bestMass).toBe(fittest.mass);
            expect(size.bestShips).toBe((entrantOf(fittest) as Fleet).ships.length);
            expect(size.meanMass).toBeCloseTo(all.reduce((sum, i) => sum + i.mass, 0) / all.length);
            expect(size.meanShips).toBeCloseTo(all.reduce((sum, i) => sum + shipCount(i), 0) / all.length);
        }
    });

    it("stays a run of ships when a ship may not grow", () => {
        const run = runEvolution([DINKY], { ...settings, generations: 1, fleet: { maxShips: 1 } });
        expect(generationSize(run.generations[0]!).meanShips).toBe(1);
        for (const individual of run.generations[0]!.individuals) {
            expect(individual.fleet).toBeUndefined();
            expect(isFleet(entrantOf(individual))).toBe(false);
        }
    });
});

describe("a run-config file with fleets", () => {
    it("round-trips the fleets and their limits", () => {
        const setup = {
            founders: [CORVETTE],
            fleets: [LINE_OF_BATTLE],
            config: {
                ...DEFAULT_RUN,
                fleet: {
                    radius: 300,
                    maxShips: 8,
                    design: 0.8,
                    move: 1.5,
                    change: 0.2,
                    operators: { ...DEFAULT_FLEET_LIMITS.operators, add: 3 },
                },
            },
        };
        const read = parseRunConfig(JSON.parse(JSON.stringify(serialiseRunConfig(setup))));
        expect(read.fleets!.map(serialiseFleet)).toEqual([serialiseFleet(LINE_OF_BATTLE)]);
        expect(read.config.fleet).toEqual(setup.config.fleet);
    });

    it("warns of a change it has never heard of, and refuses a negative weight", () => {
        expect(runConfigFileProblem({ fleet: { operators: { teleport: 1 } } })).toBeNull();
        expect(runConfigWarnings({ fleet: { operators: { teleport: 1 } } }).join("\n")).toMatch(/teleport/);
        expect(runConfigFileProblem({ fleet: { operators: { add: -1 } } })).toMatch(/zero or more/);
    });

    it("writes the fleet limits for a run of ships, which may grow into fleets", () => {
        const file = serialiseRunConfig({ founders: [CORVETTE], config: DEFAULT_RUN });
        expect(file["fleets"]).toBeUndefined();
        expect(file["fleet"]).toMatchObject({ maxShips: DEFAULT_FLEET_LIMITS.maxShips });
    });
});
