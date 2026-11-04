import { describe, expect, it } from "vitest";
import {
    BEAM_FLASH_LIFETIME,
    BURST_FLASH_LIFETIME,
    BURST_REFERENCE_ENERGY,
    burstLifetime,
    flashPosition,
    FLASH_REFERENCE_ENERGY,
    FLASH_REFERENCE_RADIUS,
    Flashes,
    ROUND_FLASH_LIFETIME,
    flashFade,
    flashRadius,
    flashSize,
    flashExtent,
    FLASH_BIRTH_SIZE,
    MUZZLE_FLASH_LIFETIME,
    muzzleLifetime,
    muzzleWedge,
} from "../render/flashes.js";
import { IMPACT_BEAM, IMPACT_BURST, IMPACT_COLLISION, IMPACT_MUZZLE, IMPACT_ROUND, ImpactLog } from "../sim/index.js";
import { Bodies, bodyIndex } from "../sim/bodies.js";
import { bit, bitCount, METAL_LIFE, seedOf, spark, sparkCount, type Bit, type Spark } from "../render/particles.js";

/**
 * Impact flashes: the arithmetic of how big and how bright, and the ageing
 * that keeps a sixtieth of a second visible for long enough to see.
 */

describe("how a flash is sized", () => {
    it("is the reference size at the reference energy", () => {
        expect(flashRadius(FLASH_REFERENCE_ENERGY)).toBeCloseTo(FLASH_REFERENCE_RADIUS, 9);
    });

    it("grows as a cube root, so a battle fits on one screen", () => {
        // Ten times the energy is about twice the flash. Anything steeper makes the
        // small hits invisible or the large ones a screen-filling disc.
        const small = flashRadius(FLASH_REFERENCE_ENERGY);
        const big = flashRadius(FLASH_REFERENCE_ENERGY * 10);
        expect(big / small).toBeGreaterThan(1.9);
        expect(big / small).toBeLessThan(2.3);
    });

    it("is nothing at all for nothing at all", () => {
        expect(flashRadius(0)).toBe(0);
        expect(flashRadius(-1)).toBe(0);
    });

    it("is clamped at both ends", () => {
        expect(flashRadius(1)).toBeGreaterThan(0);
        expect(flashRadius(1e15)).toBeLessThan(100);
    });
});

describe("how a flash fades", () => {
    it("is full at birth and gone at the end", () => {
        expect(flashFade(0, 1)).toBe(1);
        expect(flashFade(1, 1)).toBe(0);
        expect(flashFade(2, 1)).toBe(0);
    });

    it("is brief rather than lingering", () => {
        // Halfway through its life it is a quarter as bright, so it gets out of
        // the way of the ship it happened on.
        expect(flashFade(0.5, 1)).toBeCloseTo(0.25, 9);
    });
});

describe("the store", () => {
    it("keeps a flash until its life runs out", () => {
        const flashes = new Flashes();
        // A burst throws nothing, so is kept for its own light alone.
        flashes.add(10, 20, BURST_REFERENCE_ENERGY, IMPACT_BURST);
        expect(flashes.count).toBe(1);

        flashes.step(BURST_FLASH_LIFETIME * 0.5);
        expect(flashes.count).toBe(1);
        expect(flashes.age[0]).toBeCloseTo(BURST_FLASH_LIFETIME * 0.5, 9);

        flashes.step(BURST_FLASH_LIFETIME);
        expect(flashes.count).toBe(0);
    });

    it("keeps a hit after its light goes out, for as long as what it threw off flies", () => {
        const flashes = new Flashes();
        flashes.add(10, 20, FLASH_REFERENCE_ENERGY, IMPACT_ROUND);
        expect(flashes.kept[0]).toBe(METAL_LIFE);
        flashes.step(ROUND_FLASH_LIFETIME + 1e-9);
        expect(flashes.count).toBe(1);
        expect(flashFade(flashes.age[0]!, flashes.lifetime[0]!)).toBe(0);
        flashes.step(METAL_LIFE);
        expect(flashes.count).toBe(0);
    });

    it("gives a beam a shorter life than a round", () => {
        // A beam deposits energy every step it burns, so its flashes arrive as a
        // stream: a long life would pile them into one ever-brightening blob.
        expect(BEAM_FLASH_LIFETIME).toBeLessThan(ROUND_FLASH_LIFETIME);
        const flashes = new Flashes();
        flashes.add(0, 0, FLASH_REFERENCE_ENERGY, 1);
        flashes.add(0, 0, FLASH_REFERENCE_ENERGY, 0);
        expect(flashes.lifetime[0]).toBe(BEAM_FLASH_LIFETIME);
        expect(flashes.lifetime[1]).toBe(ROUND_FLASH_LIFETIME);
    });

    it("drops the dead ones without disturbing the living", () => {
        const flashes = new Flashes();
        flashes.add(1, 1, FLASH_REFERENCE_ENERGY, IMPACT_MUZZLE);
        flashes.add(2, 2, FLASH_REFERENCE_ENERGY, IMPACT_COLLISION);
        flashes.add(3, 3, FLASH_REFERENCE_ENERGY, IMPACT_MUZZLE);
        flashes.step(MUZZLE_FLASH_LIFETIME + 1e-9);
        expect(flashes.count).toBe(1);
        expect(flashes.x[0]).toBe(2);
    });

    it("grows past its initial room", () => {
        const flashes = new Flashes();
        for (let i = 0; i < 300; i++) flashes.add(i, 0, FLASH_REFERENCE_ENERGY, 0);
        expect(flashes.count).toBe(300);
        expect(flashes.x[299]).toBe(299);
    });

    it("ignores a hit that was worth nothing", () => {
        const flashes = new Flashes();
        flashes.add(0, 0, 0, 0);
        expect(flashes.count).toBe(0);
    });
});

describe("riding the hull it went off against", () => {
    it("puts a flash back through the ship\u2019s own frame", () => {
        // The same transform the hull's modules are drawn through: a hit ten
        // metres up the bow is ten metres up the bow after the ship turns.
        const straight = flashPosition(10, 0, { body: 0, x: 100, y: 50, angle: 0 });
        expect(straight.x).toBeCloseTo(110, 9);
        expect(straight.y).toBeCloseTo(50, 9);

        const turned = flashPosition(10, 0, { body: 0, x: 100, y: 50, angle: Math.PI / 2 });
        expect(turned.x).toBeCloseTo(100, 9);
        expect(turned.y).toBeCloseTo(60, 9);
    });

    it("keeps what it needs to follow a ship that is moving", () => {
        const flashes = new Flashes();
        flashes.add(100, 0, FLASH_REFERENCE_ENERGY, 0, 3, 5, -2);
        expect(flashes.body[0]).toBe(3);
        expect(flashes.localX[0]).toBe(5);
        expect(flashes.localY[0]).toBe(-2);

        // And a hit on nothing rides nothing, which is what the world position is
        // there for.
        flashes.add(0, 0, FLASH_REFERENCE_ENERGY, 0);
        expect(flashes.body[1]).toBe(-1);
    });

    it("drifts with what made it, for one that rides nothing", () => {
        const flashes = new Flashes();
        flashes.add(10, 20, FLASH_REFERENCE_ENERGY, 0, -1, 0, 0, 600, -40);
        flashes.step(0.1);
        expect(flashes.x[0]).toBeCloseTo(70, 9);
        expect(flashes.y[0]).toBeCloseTo(16, 9);
    });

    it("keeps a survivor\u2019s anchor when a neighbour burns out", () => {
        const flashes = new Flashes();
        flashes.add(1, 1, FLASH_REFERENCE_ENERGY, IMPACT_MUZZLE, 7, 1, 2);
        flashes.add(2, 2, FLASH_REFERENCE_ENERGY, IMPACT_COLLISION, 9, 3, 4);
        flashes.step(MUZZLE_FLASH_LIFETIME + 1e-9);
        expect(flashes.count).toBe(1);
        expect(flashes.body[0]).toBe(9);
        expect(flashes.localX[0]).toBe(3);
        expect(flashes.localY[0]).toBe(4);
    });
});

describe("a burst", () => {
    it("lasts longer the more charge it had, between one frame and fifteen", () => {
        expect(burstLifetime(BURST_REFERENCE_ENERGY)).toBeCloseTo(BURST_FLASH_LIFETIME, 12);
        // A Dinky's: under a frame, so it shows once.
        expect(burstLifetime(2.9e4)).toBeLessThan(1 / 60);
        // A 40 cm gun's: a quarter of a second, never a fireball.
        expect(burstLifetime(2.3e8)).toBe(0.25);
    });

    it("is a short flash, gone well before a hit\u2019s", () => {
        const flashes = new Flashes();
        flashes.add(0, 0, BURST_REFERENCE_ENERGY, 3);
        flashes.add(0, 0, FLASH_REFERENCE_ENERGY, 0);
        flashes.step(burstLifetime(BURST_REFERENCE_ENERGY) + 1e-9);
        expect(flashes.count).toBe(1);
        expect(flashes.kind[0]).toBe(0);
    });

    it("is at its brightest before it was born, so an exposure reaching back is", () => {
        expect(flashFade(-0.01, BURST_FLASH_LIFETIME)).toBe(1);
    });
});

describe("a flash growing", () => {
    it("starts small and reaches its full size as it dies", () => {
        expect(flashSize(0, 1)).toBeCloseTo(FLASH_BIRTH_SIZE, 12);
        expect(flashSize(0.25, 1)).toBeGreaterThan(flashSize(0.1, 1));
        expect(flashSize(1, 1)).toBe(1);
    });
});

describe("a blast", () => {
    it("starts at its full size and spreads as fast as its fragments", () => {
        expect(flashExtent(2, 650, 0, BURST_FLASH_LIFETIME)).toBe(2);
        expect(flashExtent(2, 650, 0.01, BURST_FLASH_LIFETIME)).toBeCloseTo(8.5, 12);
        // Without a growth, it grows by its share of a full size instead.
        expect(flashExtent(2, 0, 0, 1)).toBeCloseTo(2 * FLASH_BIRTH_SIZE, 12);
    });
});

describe("a muzzle flash", () => {
    it("is smaller than a hit of the same energy, and gone sooner", () => {
        const flashes = new Flashes();
        flashes.add(0, 0, FLASH_REFERENCE_ENERGY, IMPACT_MUZZLE);
        flashes.add(0, 0, FLASH_REFERENCE_ENERGY, IMPACT_ROUND);
        expect(flashes.radius[0]).toBeLessThan(flashes.radius[1]!);
        flashes.step(MUZZLE_FLASH_LIFETIME + 1e-9);
        expect(flashes.count).toBe(1);
        expect(flashes.kind[0]).toBe(IMPACT_ROUND);
    });

    it("lasts longer the bigger the gun", () => {
        expect(muzzleLifetime(FLASH_REFERENCE_ENERGY)).toBeCloseTo(MUZZLE_FLASH_LIFETIME, 12);
        expect(muzzleLifetime(2.8e8)).toBeGreaterThan(muzzleLifetime(3.5e4));
        const flashes = new Flashes();
        flashes.add(0, 0, 2.8e8, IMPACT_MUZZLE);
        expect(flashes.lifetime[0]).toBe(muzzleLifetime(2.8e8));
    });

    it("is a wedge, widening forward and moving out ahead of the barrel as it grows", () => {
        const born = muzzleWedge(1, 0, MUZZLE_FLASH_LIFETIME);
        const old = muzzleWedge(1, MUZZLE_FLASH_LIFETIME, MUZZLE_FLASH_LIFETIME);
        expect(born.back).toBe(0);
        expect(born.frontWidth).toBeGreaterThan(born.backWidth);
        expect(old.back).toBeGreaterThan(born.back);
        expect(old.front).toBeGreaterThan(born.front);
        expect(old.frontWidth).toBeGreaterThan(born.frontWidth);
    });

    it("keeps the way it points", () => {
        const flashes = new Flashes();
        flashes.add(0, 0, FLASH_REFERENCE_ENERGY, IMPACT_ROUND);
        flashes.add(0, 0, FLASH_REFERENCE_ENERGY, IMPACT_MUZZLE, 2, 1, 1, 0, 0, 0, 0, 1);
        flashes.step(ROUND_FLASH_LIFETIME * 0.1);
        expect(flashes.dirY[1]).toBe(1);
    });
});

describe("copying flashes", () => {
    it("gives a copy that ages apart from the original, and can be taken back on", () => {
        const flashes = new Flashes();
        for (let i = 0; i < 100; i++) flashes.add(i, 0, FLASH_REFERENCE_ENERGY, IMPACT_ROUND);
        const copy = flashes.copy();
        flashes.step(METAL_LIFE);
        expect(flashes.count).toBe(0);
        expect(copy.count).toBe(100);
        expect(copy.x[99]).toBe(99);
        flashes.set(copy);
        copy.clear();
        expect(flashes.count).toBe(100);
        expect(flashes.age[0]).toBe(0);
    });
});

describe("what a hit and a collision throw off", () => {
    it("is mostly sparks from a round and mostly metal from a collision, some of each from both", () => {
        const energy = 1e7;
        const seed = seedOf(0, 0, energy, IMPACT_ROUND);
        expect(sparkCount(IMPACT_ROUND, energy, seed)).toBeGreaterThan(bitCount(IMPACT_ROUND, energy));
        expect(bitCount(IMPACT_ROUND, energy)).toBeGreaterThan(0);
        expect(bitCount(IMPACT_COLLISION, energy)).toBeGreaterThan(sparkCount(IMPACT_COLLISION, energy, seed));
        expect(sparkCount(IMPACT_COLLISION, energy, seed)).toBeGreaterThan(0);
    });
});

describe("what is thrown off a hull", () => {
    it("leaves from the hull as it was when it happened, and flies free of it after", () => {
        const bodies = new Bodies();
        const body = bodyIndex(bodies.create({ x: 10, y: 0, angle: Math.PI / 2, mass: 1, inertia: 1, radius: 1 }));
        bodies.vx[body] = 30;
        bodies.vy[body] = -5;
        const log = new ImpactLog();
        // Sliding along +x against a face whose normal is +y, in the world.
        log.push(10, 1, 1e7, IMPACT_COLLISION, bodies, body, 0, 0, 0, 1, 0, 0, 1, 20);
        expect([log.hullAngle[0], log.hullVx[0], log.hullVy[0]]).toEqual([Math.PI / 2, 30, -5]);

        const flashes = new Flashes();
        // As logged, in the hull's frame; then the same in the world's, on nothing that turns.
        flashes.add(
            10,
            1,
            1e7,
            IMPACT_COLLISION,
            body,
            0,
            0,
            0,
            0,
            0,
            log.dirX[0]!,
            log.dirY[0]!,
            log.normalX[0]!,
            log.normalY[0]!,
            20,
            Math.PI / 2,
            30,
            -5,
        );
        flashes.add(10, 1, 1e7, IMPACT_COLLISION, -1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 20, 0, 30, -5);
        const seed = seedOf(10, 1, 1e7, IMPACT_COLLISION);
        const a: Spark = { x: 0, y: 0, vx: 0, vy: 0, width: 0, t: 0 };
        const b: Spark = { ...a };
        expect(spark(flashes, 0, 0, seed, 0.1, a)).toBe(true);
        expect(spark(flashes, 1, 0, seed, 0.1, b)).toBe(true);
        expect(a.x).toBeCloseTo(b.x, 9);
        expect(a.y).toBeCloseTo(b.y, 9);
        const m: Bit = { x: 0, y: 0, angle: 0, length: 0, width: 0, glint: 0, t: 0 };
        const n: Bit = { ...m };
        expect(bit(flashes, 0, 0, seed, 0.1, m)).toBe(true);
        expect(bit(flashes, 1, 0, seed, 0.1, n)).toBe(true);
        expect(m.x).toBeCloseTo(n.x, 9);
        expect(m.y).toBeCloseTo(n.y, 9);
    });
});

describe("telling events alike apart", () => {
    it("seeds a beam's every step on one spot differently, so their sparks do not line up", () => {
        const flashes = new Flashes();
        const seeds = new Set<number>();
        for (let k = 0; k < 12; k++) {
            flashes.add(60, -56, 1e5, IMPACT_BEAM);
            flashes.step(1 / 60);
        }
        for (let i = 0; i < flashes.count; i++) {
            seeds.add(seedOf(flashes.x[i]!, flashes.y[i]!, flashes.energy[i]!, flashes.kind[i]!, flashes.born[i]!));
        }
        expect(seeds.size).toBe(flashes.count);
    });

    it("keeps when each was born as it ages, and the clock through a copy and back", () => {
        const flashes = new Flashes();
        flashes.step(2);
        flashes.add(0, 0, 1e7, IMPACT_ROUND);
        flashes.step(0.1);
        expect(flashes.born[0]).toBe(2);
        const copy = flashes.copy();
        expect(copy.now).toBeCloseTo(2.1, 12);
        copy.step(0.1);
        flashes.set(copy);
        expect(flashes.now).toBeCloseTo(2.2, 12);
        expect(flashes.born[0]).toBe(2);
    });
});
