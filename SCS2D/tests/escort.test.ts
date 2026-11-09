import { describe, expect, it } from "vitest";
import { compileBlueprint, joints, math, NEUTRAL_TEAM, type Blueprint, type Doctrine } from "../sim/index.js";
import { makeBattle } from "../scenarios/battle.js";
import { CATAMARAN, CORVETTE, GUNSHIP } from "../scenarios/blueprints.js";

/**
 * Something to fly at that is not something to shoot at.
 *
 * Two mechanisms, deliberately separate and tested apart. **Sides** decide
 * who may shoot whom, and a neutral is nobody's enemy. **Protection** decides
 * whether a hull can be hurt at all, and is about the object rather than
 * about sides. An objective wants both — it is shot at by nobody *and*
 * survives being in the way — and the two would be impossible to tell apart
 * if they were tested together, since either alone leaves a hull unmarked.
 */

const MARKER: Blueprint = {
    name: "Marker",
    modules: [{ kind: "core", x: 0, y: 0, length: 12, width: 12 }],
};

/**
 * A marker that stands up into the weapons layer, so turret fire can land on
 * it: the core alone is deck, and deck-level rounds pass over it. Wide enough
 * to stand in the line of a gunship's side turrets.
 */
const RAISED_MARKER: Blueprint = {
    name: "Thick marker",
    modules: [
        { kind: "structure", x: 0, y: 0, length: 12, width: 30, thick: true },
        { kind: "core", x: 7, y: 0, length: 2, width: 2 },
    ],
};

/**
 * The same hull with an engine on the back, for the one test that needs a
 * hostile hull somebody will deliberately shoot at: a ship that can neither
 * shoot nor move is a hulk, and nothing aims at a hulk whatever side it is
 * on. It carries no gun, so it still never fires.
 */
const MOBILE_MARKER: Blueprint = {
    name: "Mobile marker",
    modules: [
        { kind: "core", x: 0, y: 0, length: 12, width: 12 },
        { kind: "engine", x: -6, y: 0, angle: Math.PI, length: 4, width: 6 },
    ],
};

function escorting(blueprint: Blueprint, escortWeight: number): Blueprint {
    const doctrine = blueprint.doctrine!;
    const held: Doctrine = {
        targeting: { ...doctrine.targeting, escortWeight },
        approach: { ...doctrine.approach },
    };
    return { ...blueprint, doctrine: held };
}

describe("escort and neutrals", () => {
    it("aims at nothing on the neutral side", () => {
        // Off to one side of the battle, so a hit on it could only be a hit
        // somebody meant. Deliberately *not* protected: what is being tested is
        // that nobody aims at it, and a hull nothing can hurt would pass this
        // test while being fired on constantly.
        const marker = compileBlueprint(MARKER);
        const gunship = compileBlueprint(GUNSHIP);
        const battle = makeBattle({ seed: 3, projectiles: 512 }, (ships, world) => {
            ships.spawn(world, { design: gunship, x: -700, y: 0, angle: 0, team: 0 });
            ships.spawn(world, { design: gunship, x: 700, y: 0, angle: math.PI, team: 1 });
            const neutral = ships.spawn(world, { design: marker, x: 0, y: 2500, team: NEUTRAL_TEAM });
            return { neutral };
        });

        const body = battle.world.bodies.indexOf(battle.ships.body(battle.neutral));
        let struck = 0;
        for (let step = 0; step < 1800; step++) {
            battle.step();
            for (let h = 0; h < battle.credit.count; h++) {
                if (battle.credit.victim[h] === body) struck++;
            }
        }
        expect(struck).toEqual(0);
        expect(battle.ships.damage.integrity(body, 0)).toEqual(1);
    });

    it("is solid, whoever is not shooting at it", () => {
        // The same marker put between the two fleets rather than beside them,
        // and now it is hit constantly — by rounds meant for what is behind it.
        // That is the whole difference between an objective that is an object and
        // one that is a coordinate: this one can be sheltered behind, run into,
        // and shoved out of somebody's way.
        const marker = compileBlueprint(RAISED_MARKER);
        const gunship = compileBlueprint(GUNSHIP);
        const battle = makeBattle({ seed: 3, projectiles: 512 }, (ships, world) => {
            ships.spawn(world, { design: gunship, x: -700, y: 0, angle: 0, team: 0 });
            ships.spawn(world, { design: gunship, x: 700, y: 0, angle: math.PI, team: 1 });
            const neutral = ships.spawn(world, { design: marker, x: 0, y: 0, team: NEUTRAL_TEAM });
            return { neutral };
        });

        const body = battle.world.bodies.indexOf(battle.ships.body(battle.neutral));
        let struck = 0;
        // Read while it is whole: a gunship's ram can tear the structure off later,
        // leaving module 0 the untouched core.
        let worn = 1;
        for (let step = 0; step < 1800; step++) {
            battle.step();
            for (let h = 0; h < battle.credit.count; h++) {
                if (battle.credit.victim[h] === body) struck++;
            }
            if (battle.ships.currentStructure(battle.neutral).modules.length === marker.modules.length) {
                worn = Math.min(worn, battle.ships.damage.integrity(body, 0));
            }
        }
        expect(struck).toBeGreaterThan(0);
        // Unprotected, so what it is hit by tells: an objective left like this
        // would be worn away by a battle fought over it.
        expect(worn).toBeLessThan(1);
    });

    it("leaves a protected hull unmarked by what does hit it", () => {
        // The other half: on a side everyone is shooting at, so it is hit — and
        // nothing comes of it.
        const marker = compileBlueprint(MOBILE_MARKER);
        const gunship = compileBlueprint(GUNSHIP);
        const battle = makeBattle({ seed: 3, projectiles: 512 }, (ships, world) => {
            ships.spawn(world, { design: gunship, x: -700, y: 0, angle: 0, team: 0 });
            const target = ships.spawn(world, {
                design: marker,
                x: 300,
                y: 0,
                team: 1,
                invulnerable: true,
            });
            return { target };
        });

        const body = battle.world.bodies.indexOf(battle.ships.body(battle.target));
        let struck = 0;
        for (let step = 0; step < 1800; step++) {
            battle.step();
            for (let h = 0; h < battle.credit.count; h++) {
                if (battle.credit.victim[h] === body) struck++;
            }
        }
        expect(struck).toBeGreaterThan(0);
        expect(battle.ships.damage.integrity(body, 0)).toEqual(1);
        expect(battle.ships.isAlive(battle.target)).toBe(true);
        expect(battle.totalSevered).toEqual(0);
    });

    it("covers a consort rather than going to the fight", () => {
        // The same battle twice, differing in one number. With nothing to escort
        // the ship closes on the enemy; with a consort worth covering it stays
        // with it — and this is a preference rather than a mode, so what decides
        // it is one weight against the rest of the doctrine.
        function fly(escortWeight: number): number {
            const consort = compileBlueprint(MARKER);
            const escort = compileBlueprint(escorting(CORVETTE, escortWeight));
            const enemy = compileBlueprint(GUNSHIP);
            const battle = makeBattle({ seed: 5, projectiles: 512 }, (ships, world) => {
                const covering = ships.spawn(world, { design: escort, x: 0, y: 0, angle: 0, team: 0 });
                const charge = ships.spawn(world, { design: consort, x: 0, y: 300, team: NEUTRAL_TEAM });
                ships.spawn(world, { design: enemy, x: 2500, y: 0, angle: math.PI, team: 1 });
                return { covering, charge };
            });
            for (let step = 0; step < 1800; step++) battle.step();
            const bodies = battle.world.bodies;
            const a = bodies.indexOf(battle.ships.body(battle.covering));
            const b = bodies.indexOf(battle.ships.body(battle.charge));
            return math.length(bodies.x[a]! - bodies.x[b]!, bodies.y[a]! - bodies.y[b]!);
        }

        const alone = fly(0);
        const covering = fly(400);
        // Not by as much as it might: the enemy breaks the escort in two early,
        // and it will not turn into its own wreckage while that lies alongside.
        expect(covering).toBeLessThan(alone * 0.6);
    });

    it("covers no friend smaller than it will bother with", () => {
        // The same escort, told to cover only what is at least its own size: a
        // friendly marker is a fraction of a corvette's radius, so it goes to the
        // fight as though there were nothing to cover. Told to cover anything, it
        // stays with it.
        function fly(escortMinRadii: number): number {
            const consort = compileBlueprint(MARKER);
            const base = escorting(CORVETTE, 400);
            const escort = compileBlueprint({
                ...base,
                doctrine: { ...base.doctrine!, approach: { ...base.doctrine!.approach, escortMinRadii } },
            });
            expect(consort.radius).toBeLessThan(escort.radius);
            const enemy = compileBlueprint(GUNSHIP);
            const battle = makeBattle({ seed: 5, projectiles: 512 }, (ships, world) => {
                const covering = ships.spawn(world, { design: escort, x: 0, y: 0, angle: 0, team: 0 });
                const charge = ships.spawn(world, { design: consort, x: 0, y: 300, team: 0 });
                ships.spawn(world, { design: enemy, x: 2500, y: 0, angle: math.PI, team: 1 });
                return { covering, charge };
            });
            // Before the gunship arrives and takes the escort apart.
            for (let step = 0; step < 1200; step++) battle.step();
            const bodies = battle.world.bodies;
            const a = bodies.indexOf(battle.ships.body(battle.covering));
            const b = bodies.indexOf(battle.ships.body(battle.charge));
            return math.length(bodies.x[a]! - bodies.x[b]!, bodies.y[a]! - bodies.y[b]!);
        }

        expect(fly(1)).toBeGreaterThan(fly(0) * 2);
    });

    it("keeps outside the inside of its band, where it has one", () => {
        // A corvette beside a friend of its size, nothing else about, with a band
        // far wider than keeping clear holds it off by: with no inside edge it
        // sits where keeping clear puts it; with one, inside the band.
        function fly(escortInner: number): number {
            const base = escorting(CORVETTE, 400);
            const escort = compileBlueprint({
                ...base,
                doctrine: { ...base.doctrine!, approach: { ...base.doctrine!.approach, escortRadii: 40, escort: 5, escortInner } },
            });
            // Not escorting back, or it follows.
            const consort = compileBlueprint(escorting(CORVETTE, 0));
            const battle = makeBattle({ seed: 5 }, (ships, world) => {
                const covering = ships.spawn(world, { design: escort, x: 0, y: 0, angle: 0, team: 0 });
                const charge = ships.spawn(world, { design: consort, x: 0, y: 60, team: 0 });
                return { covering, charge };
            });
            for (let step = 0; step < 1800; step++) battle.step();
            const bodies = battle.world.bodies;
            const a = bodies.indexOf(battle.ships.body(battle.covering));
            const b = bodies.indexOf(battle.ships.body(battle.charge));
            return math.length(bodies.x[a]! - bodies.x[b]!, bodies.y[a]! - bodies.y[b]!);
        }

        expect(fly(0)).toBeLessThan(300);
        // The band is 35 m–732 m, its inside edge at 0.8 near 593 m.
        expect(fly(0.8)).toBeGreaterThan(550);
    });

    it("covers no friend with its core shot out", () => {
        // A friend nothing controls is nothing to cover: the escort goes to the fight as
        // though there were nothing there, as it does for a hulk it might shoot.
        function fly(hulk: boolean): number {
            const consort = compileBlueprint(MARKER);
            const base = escorting(CORVETTE, 400);
            const escort = compileBlueprint({
                ...base,
                doctrine: { ...base.doctrine!, approach: { ...base.doctrine!.approach, escortMinRadii: 0 } },
            });
            const enemy = compileBlueprint(GUNSHIP);
            const battle = makeBattle({ seed: 5, projectiles: 512 }, (ships, world) => {
                const covering = ships.spawn(world, { design: escort, x: 0, y: 0, angle: 0, team: 0 });
                const charge = ships.spawn(world, { design: consort, x: 0, y: 300, team: 0 });
                ships.spawn(world, { design: enemy, x: 2500, y: 0, angle: math.PI, team: 1 });
                return { covering, charge };
            });
            const bodies = battle.world.bodies;
            if (hulk) {
                // Only until it stops flying, so the hull is still there to cover.
                const b = bodies.indexOf(battle.ships.body(battle.charge));
                const blow = consort.modules[0]!.stats.hitPoints * 0.01;
                while (battle.ships.hasControl(battle.charge)) battle.ships.damage.absorb(b, 0, blow);
                expect(battle.ships.damage.spent(b, 0)).toBe(false);
            }
            // Before the gunship arrives and takes the escort apart.
            for (let step = 0; step < 1200; step++) battle.step();
            const a = bodies.indexOf(battle.ships.body(battle.covering));
            const b = bodies.indexOf(battle.ships.body(battle.charge));
            return math.length(bodies.x[a]! - bodies.x[b]!, bodies.y[a]! - bodies.y[b]!);
        }

        expect(fly(true)).toBeGreaterThan(fly(false) * 2);
    });

    it("leaves a charge nothing threatens to go and fight, as fast as one with no charge", () => {
        // Escorting or fighting, not both: weighed together, an escort trailed
        // an enemy moving away from its charge at half its speed.
        function fly(escortWeight: number): { left: boolean; enemy: number } {
            const base = escorting(CORVETTE, escortWeight);
            const design = compileBlueprint({
                ...base,
                doctrine: { ...base.doctrine!, approach: { ...base.doctrine!.approach, escortMinRadii: 0 } },
            });
            const battle = makeBattle({ seed: 9, projectiles: 512 }, (ships, world) => {
                const covering = ships.spawn(world, { design, x: 0, y: -100, angle: 0, team: 0 });
                ships.spawn(world, { design: compileBlueprint(MARKER), x: 0, y: 0, team: 0 });
                const foe = ships.spawn(world, { design: compileBlueprint(GUNSHIP), x: 6000, y: 0, angle: math.PI, team: 1 });
                return { covering, foe };
            });
            const bodies = battle.world.bodies;
            for (let step = 0; step < 900; step++) battle.step();
            const p = bodies.indexOf(battle.ships.body(battle.covering));
            const q = bodies.indexOf(battle.ships.body(battle.foe));
            return {
                left: battle.ships.consort[battle.covering] === -1 && battle.ships.chosenOf(battle.covering) === battle.foe,
                enemy: math.length(bodies.x[p]! - bodies.x[q]!, bodies.y[p]! - bodies.y[q]!),
            };
        }
        const alone = fly(0);
        const covering = fly(400);
        expect(covering.left).toBe(true);
        expect(covering.enemy).toBeLessThan(alone.enemy * 1.1);
    });

    it("stays with a charge an enemy has in reach, and fights that enemy from its station", () => {
        const base = escorting(CORVETTE, 400);
        const design = compileBlueprint({
            ...base,
            doctrine: { ...base.doctrine!, approach: { ...base.doctrine!.approach, escortMinRadii: 0 } },
        });
        const enemy = compileBlueprint(GUNSHIP);
        const clear = (enemy.reach + design.radius) * design.doctrine.approach.fleeMargin;
        const battle = makeBattle({ seed: 9, projectiles: 512 }, (ships, world) => {
            const covering = ships.spawn(world, { design, x: 0, y: -100, angle: 0, team: 0 });
            const charge = ships.spawn(world, { design: compileBlueprint(MARKER), x: 0, y: 0, team: 0, invulnerable: true });
            const foe = ships.spawn(world, { design: enemy, x: clear / 2, y: 0, angle: math.PI, team: 1 });
            return { covering, charge, foe };
        });
        const { ships } = battle;
        const bodies = battle.world.bodies;
        let guarded = 0;
        let worst = 0;
        const steps = 600;
        for (let step = 0; step < steps; step++) {
            battle.step();
            if (ships.alive[battle.covering] !== 1) break;
            if (ships.guarding[battle.covering] === 1 && ships.chosenOf(battle.covering) === battle.foe) guarded++;
            const p = bodies.indexOf(ships.body(battle.covering));
            const q = bodies.indexOf(ships.body(battle.charge));
            worst = Math.max(worst, math.length(bodies.x[p]! - bodies.x[q]!, bodies.y[p]! - bodies.y[q]!));
        }
        expect(guarded).toBeGreaterThan(steps * 0.8);
        expect(worst).toBeLessThan(ships.coverBandOf(battle.covering, battle.charge) * 1.5);
    });

    it("goes on fighting while it covers", () => {
        // An escort stations on its charge and its guns fight whatever they can
        // reach: covering is where the hull goes, not what the mounts do. If the
        // station were taken for what the ship is fighting, every mount would be
        // concentrating on something no mount may shoot at.
        const consort = compileBlueprint(MARKER);
        const escort = compileBlueprint(escorting(CORVETTE, 400));
        const enemy = compileBlueprint(CORVETTE);
        const battle = makeBattle({ seed: 7, projectiles: 512 }, (ships, world) => {
            const covering = ships.spawn(world, { design: escort, x: 0, y: 0, angle: 0, team: 0 });
            ships.spawn(world, { design: consort, x: 0, y: 200, team: NEUTRAL_TEAM });
            ships.spawn(world, { design: enemy, x: 900, y: 0, angle: math.PI, team: 1 });
            return { covering };
        });

        const from = battle.world.bodies.indexOf(battle.ships.body(battle.covering));
        let dealt = 0;
        for (let step = 0; step < 1800; step++) {
            battle.step();
            for (let h = 0; h < battle.credit.count; h++) {
                if (battle.credit.attacker[h] === from) dealt += battle.credit.energy[h]!;
            }
        }
        expect(dealt).toBeGreaterThan(0);
    });
});

describe("an escort and a friend that has lost control", () => {
    const WRECKED: Blueprint = {
        name: "Wrecked",
        modules: [
            { kind: "core", x: 0, y: 0, length: 6, width: 6 },
            { kind: "hold", x: 0, y: 4.5, length: 6, width: 3 },
        ],
    };
    const MENDING: Blueprint = {
        name: "Wrecked with robots",
        modules: [...WRECKED.modules, { kind: "robotBay", x: 0, y: -5, length: 6, width: 4 }],
    };

    /** How far an escort ends up from a friend whose core is shot out. */
    function after(friend: Blueprint): number {
        const corvette = compileBlueprint(escorting(CORVETTE, 400));
        const escort = compileBlueprint({
            ...escorting(CORVETTE, 400),
            doctrine: { ...corvette.doctrine, approach: { ...corvette.doctrine.approach, escortMinRadii: 0 } },
        });
        const hulk = compileBlueprint(friend);
        const run = makeBattle({ seed: 1 }, (ships, world) => {
            const e = ships.spawn(world, { design: escort, x: 0, y: 0, team: 0 });
            const h = ships.spawn(world, { design: hulk, x: 800, y: 0, team: 0 });
            const b = world.bodies.indexOf(ships.body(h));
            ships.damage.absorb(b, hulk.cores[0]!, hulk.modules[hulk.cores[0]!]!.stats.hitPoints * 1000 * 5);
            // Shot out before it begins, not in one blow now, which would shatter it.
            ships.damage.clearStep();
            return { e, h };
        });
        for (let s = 0; s < 120 * 60; s++) run.step();
        const a = run.world.bodies.indexOf(run.ships.body(run.e));
        const b = run.world.bodies.indexOf(run.ships.body(run.h));
        return Math.hypot(run.world.bodies.x[a]! - run.world.bodies.x[b]!, run.world.bodies.y[a]! - run.world.bodies.y[b]!);
    }

    it("stays with it while it has robots aboard that may mend it, and not otherwise", () => {
        expect(after(MENDING)).toBeLessThan(300);
        expect(after(WRECKED)).toBeGreaterThan(700);
    });
});

describe("two ships the same size covering each other", () => {
    it("keep further apart than either can reach turning, and never touch", () => {
        // Wide for their guns' reach, so a station off the other's skin alone
        // would be inside the circle the pair sweep as they turn.
        const pair = compileBlueprint(CATAMARAN);
        const run = makeBattle({ seed: 1 }, (ships, world) => ({
            a: ships.spawn(world, { design: pair, x: 0, y: 0, angle: 0, angularVel: 0.5 }),
            b: ships.spawn(world, { design: pair, x: pair.radius * 3, y: 0, angle: 1, angularVel: -0.5 }),
        }));
        let contacts = 0;
        for (let s = 0; s < 90 * 60; s++) {
            run.step();
            contacts += run.collisions.contacts.count;
        }
        const a = run.world.bodies.indexOf(run.ships.body(run.a));
        const b = run.world.bodies.indexOf(run.ships.body(run.b));
        const gap = Math.hypot(run.world.bodies.x[a]! - run.world.bodies.x[b]!, run.world.bodies.y[a]! - run.world.bodies.y[b]!);
        expect(contacts).toBe(0);
        expect(gap).toBeGreaterThan(pair.radius * 2);
    });
});

describe("the halves of a cut Catamaran covering each other", () => {
    it("hold station without spinning, and keep most of their fuel", { timeout: 60_000 }, () => {
        // Each half is lopsided: its engines turn it far harder one way than the
        // other, and pushing it at all turns it.
        const catamaran = compileBlueprint(CATAMARAN);
        const run = makeBattle({ seed: 1 }, (ships, world) => ({ a: ships.spawn(world, { design: catamaran, x: 0, y: 0, angle: 0 }) }));
        const all = joints(catamaran);
        const mid = all.findIndex((j) => Math.abs(catamaran.modules[j.a]!.spec.y) < 3 && Math.abs(catamaran.modules[j.b]!.spec.y) < 3);
        const at = (i: number): number => run.world.bodies.indexOf(run.ships.body(i));
        run.ships.damage.cutWeld(at(0), mid, all[mid]!.width * 2);
        run.step();
        expect(run.ships.count).toBe(2);
        run.world.bodies.y[at(1)] = run.world.bodies.y[at(1)]! - 200;
        const full = [run.ships.fuel.left(at(0)), run.ships.fuel.left(at(1))];
        let contacts = 0;
        for (let s = 0; s < 600 * 60; s++) {
            run.step();
            contacts += run.collisions.contacts.count;
        }
        expect(run.ships.count).toBe(2);
        expect(contacts).toBe(0);
        for (const i of [0, 1]) {
            expect(run.ships.fuel.left(at(i))).toBeGreaterThan(0.9 * full[i]!);
            expect(Math.abs(run.world.bodies.angularVel[at(i)]!)).toBeLessThan(0.01);
        }
    });
});
