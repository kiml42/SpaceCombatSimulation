import { describe, expect, it } from 'vitest';
import { beamCarrier } from '../scenarios/beamCarrier.js';

/** The Beam Carrier scenario: a tender that scavenges, and fighters that recharge on their pads. */

const CARRIER = 0;
const TENDER = 1;
const FIGHTERS = [2, 3, 4, 5, 6, 7, 8, 9];

describe('the Beam Carrier', () => {
  const run = beamCarrier();
  const ships = run.ships;
  // Gripping a wreck rides it, so the tender's body is no longer its own. Watched
  // from the start, since when it does so turns on how the raid goes.
  let gripped = false;
  const step = (): void => {
    run.step();
    gripped ||= ships.isAlive(TENDER) && [10, 11].some((w) => ships.body(w) === ships.body(TENDER));
  };
  const body = (i: number): number => run.world.bodies.indexOf(ships.body(i));

  it('sets out with its tender docked and every pad laden', () => {
    expect(ships.body(TENDER)).toBe(ships.body(CARRIER));
    for (const f of FIGHTERS) expect(ships.body(f)).toBe(ships.body(CARRIER));
  });

  it('casts its tender off at once, the tender being above its refuelBelow, without taking the carrier\'s fuel', () => {
    const tank = (): number => ships.fuel.pieceHeld(body(TENDER), ships.design(TENDER).modules.findIndex((m) => m.spec.kind === 'claw'));
    for (let s = 0; s < 5 * 60; s++) step();
    expect(ships.body(TENDER)).not.toBe(ships.body(CARRIER));
    const after = tank();
    for (let s = 0; s < 60; s++) step();
    expect(tank()).toBeLessThanOrEqual(after);
  });

  it('brings its fighters back to recharge, and fills every store aboard', { timeout: 60_000 }, () => {
    const out = new Set(FIGHTERS.filter((f) => ships.body(f) !== ships.body(CARRIER)));
    expect(out.size).toBe(FIGHTERS.length);
    let landed = -1;
    for (let s = 0; s < 120 * 60 && landed < 0; s++) {
      step();
      landed = FIGHTERS.find((f) => ships.isAlive(f) && ships.body(f) === ships.body(CARRIER)) ?? -1;
    }
    expect(landed).toBeGreaterThanOrEqual(0);
    for (let s = 0; s < 30 * 60; s++) step();
    // With the raid beaten, nothing is left to sortie for, so it is still aboard.
    expect(ships.body(landed)).toBe(ships.body(CARRIER));
    const design = ships.design(landed);
    const own = (kind: string): number => design.modules.findIndex((m, k) => m.spec.kind === kind && ships.owns(landed, k));
    const m = own('battery');
    expect(ships.power.pieceRoom(body(landed), m)).toBeLessThan(0.05 * design.modules[m]!.stats.charge);
    expect(ships.power.held(body(landed), m)).toBeGreaterThan(0);
    // Its fuel topped up too, the carrier keeping back only a tenth.
    expect(ships.fuel.pieceRoom(body(landed), own('core'))).toBeCloseTo(0, 0);
  });

  it('has its tender drink from the wrecks instead', { timeout: 60_000 }, () => {
    for (let s = 0; s < 150 * 60 && !gripped; s++) step();
    expect(gripped).toBe(true);
  });
});

describe('the Beam Carrier with no raid', () => {
  // Away from the fighting, so whether the tender lives to come home does not
  // turn on where the wreckage of the raid drifts.
  const run = beamCarrier(undefined, 0);
  const ships = run.ships;
  const body = (i: number): number => run.world.bodies.indexOf(ships.body(i));

  it('has its tender bring what it scavenges back to the carrier, unasked, once it is full', { timeout: 60_000 }, () => {
    const carrierFuel = (): number => ships.fuel.pieceHeld(body(CARRIER), 1);
    for (let s = 0; s < 5 * 60; s++) run.step();
    expect(ships.body(TENDER)).not.toBe(ships.body(CARRIER));
    const before = carrierFuel();
    let docked = false;
    for (let s = 0; s < 300 * 60 && !docked; s++) {
      run.step();
      docked = ships.body(TENDER) === ships.body(CARRIER);
    }
    expect(docked).toBe(true);
    for (let s = 0; s < 120 * 60 && ships.body(TENDER) === ships.body(CARRIER); s++) run.step();
    expect(ships.body(TENDER)).not.toBe(ships.body(CARRIER));
    expect(carrierFuel()).toBeGreaterThan(before);
  });
});
