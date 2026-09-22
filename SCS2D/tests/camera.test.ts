import { describe, expect, it } from 'vitest';
import { Snapshot, type ShipView } from '../sim/index.js';
import { frame, gridStep, moveWithVisibleShips, type Camera } from '../render/camera.js';

/**
 * The camera is arithmetic over a snapshot, so it can be tested without a
 * browser — which matters, because camera behaviour is far easier to get wrong
 * than to notice. Lag in particular looks like "the view feels sluggish"
 * rather than like a failure.
 */

const WIDTH = 1000;
const HEIGHT = 600;
const DT = 1 / 60;

function ship(x: number, y: number, vx = 0, vy = 0, isDisabled = false): ShipView {
  return {
    // The camera reads position, velocity and radius; the rest is for drawing.
    design: { radius: 20 } as ShipView['design'],
    team: 0,
    x,
    y,
    angle: 0,
    vx,
    vy,
    turretBearings: [],
    turretReady: [],
    throttles: [],
    integrity: [],
    body: -1,
    isDisabled,
    isDerelict: false,
    turretDisabled: [],
  };
}

/** A snapshot of ships, with the bounds the simulation would have filled in. */
function snapshotOf(ships: ShipView[]): Snapshot {
  const snapshot = new Snapshot();
  snapshot.ships = ships;
  snapshot.shipCount = ships.length;
  // As `capture` does: the ships still fighting are what is framed, and all of
  // them when none of them is.
  const framed = ships.some((s) => !s.isDisabled) ? ships.filter((s) => !s.isDisabled) : ships;
  snapshot.minX = Math.min(...framed.map((s) => s.x - 20));
  snapshot.maxX = Math.max(...framed.map((s) => s.x + 20));
  snapshot.minY = Math.min(...framed.map((s) => s.y - 20));
  snapshot.maxY = Math.max(...framed.map((s) => s.y + 20));
  return snapshot;
}

/**
 * Advance the ships and the camera together for `seconds`.
 *
 * The two halves are driven the way the viewer drives them: the feed-forward
 * takes the simulated step, the framing eases per frame.
 */
function follow(camera: Camera, ships: ShipView[], seconds: number, dt = DT): void {
  for (let n = 0; n < Math.round(seconds / dt); n++) {
    for (const s of ships) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
    const snapshot = snapshotOf(ships);
    moveWithVisibleShips(camera, snapshot, dt, WIDTH, HEIGHT);
    frame(camera, snapshot, WIDTH, HEIGHT);
  }
}

describe('the camera', () => {
  it('settles on a stationary scene', () => {
    const camera: Camera = { x: 0, y: 0, scale: 0.1 };
    follow(camera, [ship(500, -300), ship(900, 100)], 10);

    expect(camera.x).toBeCloseTo(700, 0);
    expect(camera.y).toBeCloseTo(-100, 0);
  });

  it('keeps up with ships under way instead of trailing behind them', () => {
    // The failure this guards against: easing toward where the ships *are*
    // means always chasing them, and the faster they go the further back the
    // camera sits.
    const ships = [ship(0, 0, 400, 0), ship(300, 120, 400, 0)];
    const camera: Camera = { x: 150, y: 60, scale: 0.1 };
    follow(camera, ships, 12);

    const centreX = (ships[0]!.x + ships[1]!.x) / 2;
    const centreY = (ships[0]!.y + ships[1]!.y) / 2;
    // Within a metre of the formation after twelve seconds at 400 m/s, having
    // travelled the better part of five kilometres.
    expect(Math.abs(camera.x - centreX)).toBeLessThan(1);
    expect(Math.abs(camera.y - centreY)).toBeLessThan(1);
  });

  it('trails far behind without the feed-forward, which is what it is for', () => {
    // The same run with `dt` withheld, which is exactly the old behaviour. The
    // comparison is the point rather than any particular distance: containment
    // caps how far the camera may fall back, so the absolute lag depends on
    // how much slack the view has.
    const run = (fedForward: boolean): number => {
      const ships = [ship(0, 0, 400, 0), ship(300, 120, 400, 0)];
      const camera: Camera = { x: 150, y: 60, scale: 0.1 };
      for (let n = 0; n < Math.round(12 / DT); n++) {
        for (const s of ships) s.x += s.vx * DT;
        const snapshot = snapshotOf(ships);
        if (fedForward) moveWithVisibleShips(camera, snapshot, DT, WIDTH, HEIGHT);
        frame(camera, snapshot, WIDTH, HEIGHT);
      }
      return Math.abs(camera.x - (ships[0]!.x + ships[1]!.x) / 2);
    };

    const withIt = run(true);
    const withoutIt = run(false);
    expect(withoutIt).toBeGreaterThan(20);
    expect(withoutIt).toBeGreaterThan(withIt * 20);
  });

  it('never crops the ships, however fast the scene spreads', () => {
    // Two ships flying apart at speed: the bounds grow faster than easing can
    // follow, so the camera has to widen at once rather than ease.
    const ships = [ship(0, 0, -600, -200), ship(0, 0, 600, 200)];
    const camera: Camera = { x: 0, y: 0, scale: 5 };

    for (let n = 0; n < Math.round(20 / DT); n++) {
      for (const s of ships) {
        s.x += s.vx * DT;
        s.y += s.vy * DT;
      }
      const snapshot = snapshotOf(ships);
      frame(camera, snapshot, WIDTH, HEIGHT, DT);

      const halfW = WIDTH / 2 / camera.scale;
      const halfH = HEIGHT / 2 / camera.scale;
      expect(snapshot.minX).toBeGreaterThanOrEqual(camera.x - halfW - 1e-6);
      expect(snapshot.maxX).toBeLessThanOrEqual(camera.x + halfW + 1e-6);
      expect(snapshot.minY).toBeGreaterThanOrEqual(camera.y - halfH - 1e-6);
      expect(snapshot.maxY).toBeLessThanOrEqual(camera.y + halfH + 1e-6);
    }
  });

  it('picks a round grid spacing that stays legible at any zoom', () => {
    for (const scale of [0.001, 0.01, 0.1, 1, 10, 100]) {
      const step = gridStep(scale);
      const px = step * scale;
      expect(px).toBeGreaterThan(40);
      expect(px).toBeLessThan(400);
      // 1, 2 or 5 times a power of ten.
      const mantissa = step / 10 ** Math.round(Math.log10(step / 1.0000001));
      expect([1, 2, 5, 10]).toContain(Math.round(mantissa));
    }
  });
});

describe('what the camera keeps up with', () => {
  it('keeps up with the ships still fighting, not with the wreckage', () => {
    // A hulk blown clear of the battle would otherwise drag the view off it.
    const fighting = ship(0, 0, 100, 0);
    const hulk = ship(0, 0, -900, 0, true);
    const camera: Camera = { x: 0, y: 0, scale: 0.1 };
    moveWithVisibleShips(camera, snapshotOf([fighting, hulk]), 1, WIDTH, HEIGHT);
    expect(camera.x).toBeCloseTo(100, 9);
  });

  it('ignores a ship that is off screen', () => {
    // The camera holds still what the viewer is looking at. At this zoom the
    // view is 10 km across, so the second ship is a long way outside it.
    const watched = ship(0, 0, 100, 0);
    const elsewhere = ship(50_000, 0, -900, 0);
    const camera: Camera = { x: 0, y: 0, scale: 0.1 };
    moveWithVisibleShips(camera, snapshotOf([watched, elsewhere]), 1, WIDTH, HEIGHT);
    expect(camera.x).toBeCloseTo(100, 9);
  });

  it('counts a ship crossing the edge, so it does not flick in and out', () => {
    // Just outside by its centre, still in shot by its hull.
    const camera: Camera = { x: 0, y: 0, scale: 0.1 };
    const halfWidth = WIDTH / (2 * camera.scale);
    const straddling = ship(halfWidth + 10, 0, 300, 0);
    moveWithVisibleShips(camera, snapshotOf([straddling]), 1, WIDTH, HEIGHT);
    expect(camera.x).toBeCloseTo(300, 9);
  });

  it('holds still when nothing it could follow is in shot', () => {
    // Panned away, or every ship a hulk: either way there is nothing to keep
    // up with, and dividing by none of them would put the camera at NaN.
    const camera: Camera = { x: 10, y: -5, scale: 0.1 };
    moveWithVisibleShips(camera, snapshotOf([ship(0, 0, 400, 0, true)]), 1, WIDTH, HEIGHT);
    expect(camera.x).toBe(10);
    expect(camera.y).toBe(-5);

    const panned: Camera = { x: 100_000, y: 0, scale: 0.1 };
    moveWithVisibleShips(panned, snapshotOf([ship(0, 0, 400, 0)]), 1, WIDTH, HEIGHT);
    expect(panned.x).toBe(100_000);
  });

  it('still frames the wreckage when that is all there is', () => {
    // Otherwise the bounds are empty and the camera has nothing to fit.
    const camera: Camera = { x: 0, y: 0, scale: 0.1 };
    const hulks = [ship(1000, 0, 0, 0, true), ship(1400, 0, 0, 0, true)];
    for (let n = 0; n < 600; n++) frame(camera, snapshotOf(hulks), WIDTH, HEIGHT);
    expect(Number.isFinite(camera.x)).toBe(true);
    expect(camera.x).toBeCloseTo(1200, 0);
  });
});
