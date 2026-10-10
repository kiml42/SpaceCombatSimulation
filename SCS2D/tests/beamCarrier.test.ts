import { describe, expect, it } from 'vitest';
import { beamCarrier } from '../scenarios/beamCarrier.js';

/** The Beam Carrier scenario: a tender that scavenges, and fighters that recharge on their pads. */

const CARRIER = 0;
const TENDER = 1;
const FIGHTERS = [2, 3, 4, 5, 6, 7, 8, 9];

describe('the Beam Carrier', () => {
  const run = beamCarrier();
  const ships = run.ships;
  const body = (i: number): number => run.world.bodies.indexOf(ships.body(i));
  const battery = (i: number): number => ships.design(i).modules.findIndex((m) => m.spec.kind === 'battery');

  it('sets out with its tender docked and every pad laden', () => {
    expect(ships.body(TENDER)).toBe(ships.body(CARRIER));
    for (const f of FIGHTERS) expect(ships.body(f)).toBe(ships.body(CARRIER));
  });

  it('casts its tender off, having no fuel to spare it, and the tender drinks from a wreck', { timeout: 60_000 }, () => {
    for (let s = 0; s < 5 * 60; s++) run.step();
    expect(ships.body(TENDER)).not.toBe(ships.body(CARRIER));
    // Gripping a wreck rides it, so the tender's body is no longer its own.
    let gripped = false;
    for (let s = 0; s < 120 * 60 && !gripped; s++) {
      run.step();
      gripped = ships.isAlive(TENDER) && [10, 11].some((w) => ships.body(w) === ships.body(TENDER));
    }
    expect(gripped).toBe(true);
  });

  it('brings its fighters back to recharge, and sends them out full', { timeout: 60_000 }, () => {
    const out = new Set(FIGHTERS.filter((f) => ships.body(f) !== ships.body(CARRIER)));
    expect(out.size).toBe(FIGHTERS.length);
    let landed = -1;
    for (let s = 0; s < 120 * 60 && landed < 0; s++) {
      run.step();
      landed = FIGHTERS.find((f) => ships.isAlive(f) && ships.body(f) === ships.body(CARRIER)) ?? -1;
    }
    expect(landed).toBeGreaterThanOrEqual(0);
    for (let s = 0; s < 30 * 60 && ships.body(landed) === ships.body(CARRIER); s++) run.step();
    expect(ships.body(landed)).not.toBe(ships.body(CARRIER));
    // Full as far as damage leaves it, which its first step on its own reckons.
    run.step();
    const m = battery(landed);
    expect(ships.power.pieceRoom(body(landed), m)).toBeLessThan(0.05 * ships.design(landed).modules[m]!.stats.charge);
    expect(ships.power.held(body(landed), m)).toBeGreaterThan(0);
  });
});
