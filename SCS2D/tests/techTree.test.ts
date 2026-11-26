import { describe, expect, it } from "vitest";
import { shipFleet, type ShipModuleKind } from "../sim/index.js";
import { BARE_CORE, GUNSHIP } from "../scenarios/blueprints.js";
import {
    canFight,
    enemyTech,
    lost,
    newSkirmish,
    overLimit,
    parseSkirmish,
    playerTech,
    serialiseSkirmish,
    type Skirmish,
} from "../scenarios/skirmish.js";
import { cardById, UNLOCK_CARDS } from "../skirmish/cards.js";
import { ALL_TECH, canUnlock, fleetKinds, lockedIn, PREREQUISITES, STARTING_TECH, TECH_STEPS, unlockable } from "../skirmish/techTree.js";
import { nearKinds, type KindWeights } from "../evolution/mutate.js";
import { breeding } from "../evolution/mutationFields.js";
import { withTech } from "../evolution/answer.js";

const core = shipFleet(BARE_CORE);
const gunship = shipFleet(GUNSHIP);

describe("the tech tree", () => {
    it("names only kinds there are, and every one can be reached from a core", () => {
        for (const groups of Object.values(PREREQUISITES))
            for (const group of groups) for (const kind of group) expect(ALL_TECH).toContain(kind);
        let have: ShipModuleKind[] = ["core"];
        for (let next = unlockable(have); next.length > 0; next = unlockable(have)) have = [...have, ...next];
        expect([...have].sort()).toEqual([...ALL_TECH].sort());
    });

    it("needs every group, and any one kind of a group", () => {
        expect(canUnlock("battery", ["core"])).toBe(false);
        expect(canUnlock("battery", ["core", "generator"])).toBe(true);
        expect(canUnlock("hullBeam", ["hullGun", "battery"])).toBe(true);
        expect(canUnlock("hullBeam", ["hullGun"])).toBe(false);
    });

    it("offers a new player what their start leads to", () => {
        expect(unlockable(STARTING_TECH)).toEqual(["structure", "tank", "hold", "generator"]);
    });

    it("finds what a fleet is built of, and what of that is locked", () => {
        expect(fleetKinds(core)).toEqual(["core"]);
        expect(fleetKinds(gunship)).toContain("turret");
        expect(lockedIn(gunship, STARTING_TECH)).not.toContain("engine");
        expect(lockedIn(core, STARTING_TECH)).toEqual([]);
    });
});

describe("a skirmish with a tech tree", () => {
    const start = (): Skirmish => newSkirmish(gunship, core, 5, undefined, undefined, undefined, STARTING_TECH);

    it("locks nothing in one started without it", () => {
        expect(playerTech(newSkirmish(gunship, core, 5))).toBeNull();
        expect(enemyTech(newSkirmish(gunship, core, 5))).toBeNull();
    });

    it("refuses a fleet built of a kind the player has not unlocked", () => {
        const skirmish = { ...start(), player: gunship };
        expect(overLimit(skirmish)).toMatch(/not unlocked: .*Turret/);
        expect(canFight(skirmish)).toBe(false);
        expect(overLimit(start())).toBeNull();
    });

    it("unlocks a kind with its card", () => {
        const skirmish = { ...start(), cards: ["unlock-structure"] };
        expect(playerTech(skirmish)).toEqual(["structure", "core", "engine", "hullGun"]);
    });

    it("gives the enemy what it started with and whatever the player has unlocked", () => {
        const skirmish = { ...start(), cards: ["unlock-hold"] };
        const tech = enemyTech(skirmish)!;
        for (const kind of fleetKinds(gunship)) expect(tech).toContain(kind);
        expect(tech).toContain("hold");
    });

    it("offers only unlocks the player has the prerequisites for and lacks", () => {
        for (let seed = 0; seed < 40; seed++) {
            const dealt = lost(lost(lost({ ...start(), seed, streak: 2, cards: ["unlock-structure"] })));
            for (const id of dealt.hand ?? []) {
                const unlocks = cardById(id)?.unlocks;
                if (unlocks === undefined) continue;
                expect(unlocks).not.toBe("structure");
                expect(canUnlock(unlocks, playerTech(dealt)!)).toBe(true);
            }
        }
    });

    it("offers no unlock in a skirmish without the tree", () => {
        for (let seed = 0; seed < 40; seed++) {
            const dealt = lost({ ...newSkirmish(gunship, core, seed), streak: 2 });
            for (const id of dealt.hand ?? []) expect(cardById(id)?.unlocks).toBeUndefined();
        }
    });

    it("keeps its tech through a file", () => {
        const skirmish = start();
        const back = parseSkirmish(JSON.parse(JSON.stringify(serialiseSkirmish(skirmish))));
        expect(back.tech).toEqual(skirmish.tech);
        expect(back.enemyTech).toEqual(skirmish.enemyTech);
    });
});

describe("the enemy's breeding under a tech tree", () => {
    it("never reaches for a kind it has not unlocked", () => {
        const bred = withTech(
            breeding(() => undefined),
            ["core", "engine", "hullGun"],
        );
        expect(bred.ship.kinds.turret).toBe(0);
        expect(bred.ship.kinds.engine).toBeGreaterThan(0);
        expect(
            withTech(
                breeding(() => undefined),
                null,
            ).ship.kinds.turret,
        ).toBeGreaterThan(0);
    });

    it("has an unlock card for every kind but the core", () => {
        expect(UNLOCK_CARDS.map((card) => card.unlocks)).toEqual(ALL_TECH.filter((kind) => kind !== "core"));
    });
});

describe("refits along the tech tree", () => {
    it("counts a kind and what it needs, or what needs it, a step apart, either way", () => {
        expect(TECH_STEPS.hullGun.turret).toBe(1);
        expect(TECH_STEPS.turret.hullGun).toBe(1);
        expect(TECH_STEPS.hullGun.hullGun).toBe(0);
        for (const a of ALL_TECH) for (const b of ALL_TECH) expect(TECH_STEPS[a][b]).toBe(TECH_STEPS[b][a]);
        for (const a of ALL_TECH) for (const b of ALL_TECH) expect(Number.isFinite(TECH_STEPS[a][b])).toBe(true);
    });

    it("makes a refit to a near kind likelier than to a far one", () => {
        const even = Object.fromEntries(ALL_TECH.map((kind) => [kind, 1])) as unknown as KindWeights;
        const near = nearKinds(even, "hullGun");
        expect(near.turret).toBe(1);
        expect(near.turret).toBeGreaterThan(near.slipway);
        expect(near.slipway).toBeGreaterThan(0);
    });
});
