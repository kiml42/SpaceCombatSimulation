import { describe, expect, it } from 'vitest';
import {
  BEAM_FLASH_LIFETIME,
  flashPosition,
  FLASH_REFERENCE_ENERGY,
  FLASH_REFERENCE_RADIUS,
  Flashes,
  ROUND_FLASH_LIFETIME,
  flashFade,
  flashRadius,
} from '../render/flashes.js';

/**
 * Impact flashes: the arithmetic of how big and how bright, and the ageing
 * that keeps a sixtieth of a second visible for long enough to see.
 */

describe('how a flash is sized', () => {
  it('is the reference size at the reference energy', () => {
    expect(flashRadius(FLASH_REFERENCE_ENERGY)).toBeCloseTo(FLASH_REFERENCE_RADIUS, 9);
  });

  it('grows as a cube root, so a battle fits on one screen', () => {
    // Ten times the energy is about twice the flash. Anything steeper makes the
    // small hits invisible or the large ones a screen-filling disc.
    const small = flashRadius(FLASH_REFERENCE_ENERGY);
    const big = flashRadius(FLASH_REFERENCE_ENERGY * 10);
    expect(big / small).toBeGreaterThan(1.9);
    expect(big / small).toBeLessThan(2.3);
  });

  it('is nothing at all for nothing at all', () => {
    expect(flashRadius(0)).toBe(0);
    expect(flashRadius(-1)).toBe(0);
  });

  it('is clamped at both ends', () => {
    expect(flashRadius(1)).toBeGreaterThan(0);
    expect(flashRadius(1e15)).toBeLessThan(100);
  });
});

describe('how a flash fades', () => {
  it('is full at birth and gone at the end', () => {
    expect(flashFade(0, 1)).toBe(1);
    expect(flashFade(1, 1)).toBe(0);
    expect(flashFade(2, 1)).toBe(0);
  });

  it('is brief rather than lingering', () => {
    // Halfway through its life it is a quarter as bright, so it gets out of
    // the way of the ship it happened on.
    expect(flashFade(0.5, 1)).toBeCloseTo(0.25, 9);
  });
});

describe('the store', () => {
  it('keeps a flash until its life runs out', () => {
    const flashes = new Flashes();
    flashes.add(10, 20, FLASH_REFERENCE_ENERGY, 0);
    expect(flashes.count).toBe(1);

    flashes.step(ROUND_FLASH_LIFETIME * 0.5);
    expect(flashes.count).toBe(1);
    expect(flashes.age[0]).toBeCloseTo(ROUND_FLASH_LIFETIME * 0.5, 9);

    flashes.step(ROUND_FLASH_LIFETIME);
    expect(flashes.count).toBe(0);
  });

  it('gives a beam a shorter life than a round', () => {
    // A beam deposits energy every step it burns, so its flashes arrive as a
    // stream: a long life would pile them into one ever-brightening blob.
    expect(BEAM_FLASH_LIFETIME).toBeLessThan(ROUND_FLASH_LIFETIME);
    const flashes = new Flashes();
    flashes.add(0, 0, FLASH_REFERENCE_ENERGY, 1);
    flashes.add(0, 0, FLASH_REFERENCE_ENERGY, 0);
    flashes.step(BEAM_FLASH_LIFETIME + 1e-9);
    expect(flashes.count).toBe(1);
    expect(flashes.kind[0]).toBe(0);
  });

  it('drops the dead ones without disturbing the living', () => {
    const flashes = new Flashes();
    flashes.add(1, 1, FLASH_REFERENCE_ENERGY, 1);
    flashes.add(2, 2, FLASH_REFERENCE_ENERGY, 0);
    flashes.add(3, 3, FLASH_REFERENCE_ENERGY, 1);
    flashes.step(BEAM_FLASH_LIFETIME + 1e-9);
    expect(flashes.count).toBe(1);
    expect(flashes.x[0]).toBe(2);
  });

  it('grows past its initial room', () => {
    const flashes = new Flashes();
    for (let i = 0; i < 300; i++) flashes.add(i, 0, FLASH_REFERENCE_ENERGY, 0);
    expect(flashes.count).toBe(300);
    expect(flashes.x[299]).toBe(299);
  });

  it('ignores a hit that was worth nothing', () => {
    const flashes = new Flashes();
    flashes.add(0, 0, 0, 0);
    expect(flashes.count).toBe(0);
  });
});

describe('riding the hull it went off against', () => {
  it('puts a flash back through the ship\u2019s own frame', () => {
    // The same transform the hull's modules are drawn through: a hit ten
    // metres up the bow is ten metres up the bow after the ship turns.
    const straight = flashPosition(10, 0, { body: 0, x: 100, y: 50, angle: 0 });
    expect(straight.x).toBeCloseTo(110, 9);
    expect(straight.y).toBeCloseTo(50, 9);

    const turned = flashPosition(10, 0, { body: 0, x: 100, y: 50, angle: Math.PI / 2 });
    expect(turned.x).toBeCloseTo(100, 9);
    expect(turned.y).toBeCloseTo(60, 9);
  });

  it('keeps what it needs to follow a ship that is moving', () => {
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

  it('keeps a survivor\u2019s anchor when a neighbour burns out', () => {
    const flashes = new Flashes();
    flashes.add(1, 1, FLASH_REFERENCE_ENERGY, 1, 7, 1, 2);
    flashes.add(2, 2, FLASH_REFERENCE_ENERGY, 0, 9, 3, 4);
    flashes.step(BEAM_FLASH_LIFETIME + 1e-9);
    expect(flashes.count).toBe(1);
    expect(flashes.body[0]).toBe(9);
    expect(flashes.localX[0]).toBe(3);
    expect(flashes.localY[0]).toBe(4);
  });
});
